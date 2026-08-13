require('dotenv').config();
const path = require('path');
const express = require('express');
const { conferirOuMorrer, ehProducao } = require('./env');

// Antes de qualquer coisa: se a configuração está incompleta/insegura, nem sobe.
conferirOuMorrer();

const app = express();

// Atrás de proxy (Hostinger, nginx, Railway, Render, Cloudflare) o IP real e o
// protocolo chegam nos headers X-Forwarded-*. Sem isso o freio de login vê todo mundo
// como o mesmo IP (o do proxy) e o req.secure é sempre falso.
app.set('trust proxy', process.env.TRUST_PROXY || 1);
app.disable('x-powered-by');

// Cabeçalhos de segurança básicos (o painel não carrega nada de terceiros).
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  if (ehProducao()) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// captura o corpo cru pra validar a assinatura do webhook (HMAC precisa dos bytes originais)
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

const { sessaoValida, requireAuth } = require('./auth');
const authRoutes = require('./routes/auth');
const webhookRoutes = require('./routes/webhook');
const numerosRoutes = require('./routes/numeros');
const conversasRoutes = require('./routes/conversas');
const templatesRoutes = require('./routes/templates');
const campanhasRoutes = require('./routes/campanhas');
const agentesRoutes = require('./routes/agentes');
const naoPerturbeRoutes = require('./routes/naoPerturbe');
const configRoutes = require('./routes/config');
const { atualizarQualityRatingTodosNumeros } = require('./compliance');
const { processarFilaDisparo } = require('./filaWorker');
const { getToken, carregar: carregarToken } = require('./tokenStore');
const { bootstrap } = require('./bootstrap');
const { pool, query } = require('./db');

// health check público (sem login) — pra UptimeRobot manter o processo acordado.
// Não toca no banco de propósito: é prova de vida do processo, e um blip do MySQL não
// pode fazer a plataforma ser reiniciada por um health check.
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// readiness: esse SIM confere o banco — pra monitorar de verdade / debugar deploy
app.get('/health/db', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, banco: 'ok' });
  } catch (erro) {
    console.error('health/db falhou:', erro.message);
    res.status(503).json({ ok: false, banco: 'indisponivel' });
  }
});

app.use('/auth', authRoutes);
app.use('/webhook', webhookRoutes); // protegido por ASSINATURA (não por login — a Meta precisa alcançar)

// Guarda das páginas: assets e login são públicos; qualquer outra página exige sessão.
const PUBLICAS = new Set(['/login.html', '/style.css', '/app.js', '/favicon.ico']);
app.use((req, res, next) => {
  const p = req.path;
  const ehPagina = p === '/' || p.endsWith('.html');
  if (ehPagina && !PUBLICAS.has(p) && !sessaoValida(req)) {
    return res.redirect('/login.html');
  }
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// APIs do painel: todas exigem login
app.use('/numeros', requireAuth, numerosRoutes);
app.use('/conversas', requireAuth, conversasRoutes);
app.use('/templates', requireAuth, templatesRoutes);
app.use('/campanhas', requireAuth, campanhasRoutes);
app.use('/agentes', requireAuth, agentesRoutes);
app.use('/nao-perturbe', requireAuth, naoPerturbeRoutes);
app.use('/config', requireAuth, configRoutes);

// captura qualquer erro que escapou dos handlers (via asyncHandler ou next(err)) —
// sem isso, uma promise rejeitada (ex: MySQL fora do ar por um instante) derruba
// o processo inteiro e tira webhook/disparo/tudo do ar por causa de UMA query.
// O detalhe do erro é logado no servidor; pro cliente vai só uma mensagem genérica
// (não vazar SQL/stack pra quem está do outro lado).
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ erro: 'erro interno' });
});

const PORT = process.env.PORT || 3000;
const UMA_HORA = 60 * 60 * 1000;
const timers = [];

/** Rotinas de fundo: monitor de qualidade, limpeza de log e worker da fila. */
async function iniciarRotinas() {
  // monitora quality rating de todos os números a cada 1h (e promove aquecendo → ativo)
  timers.push(setInterval(() => {
    atualizarQualityRatingTodosNumeros(getToken()).catch(console.error);
  }, UMA_HORA));

  // limpeza diária do eventos_log (a tabela cresce pra sempre) — aproveita o tick horário,
  // mas só executa de fato 1x/dia (guarda a última data). Retenção configurável.
  let ultimaLimpezaLog = null;
  timers.push(setInterval(async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    if (ultimaLimpezaLog === hoje) return;
    ultimaLimpezaLog = hoje;
    try {
      const cfg = await query("SELECT valor FROM config WHERE chave = 'log_retencao_dias'");
      const dias = parseInt(cfg[0]?.valor) || 90;
      await query('DELETE FROM eventos_log WHERE criado_em < (NOW() - INTERVAL ? DAY)', [dias]);
    } catch (erro) {
      console.error('Falha na limpeza do eventos_log:', erro);
    }
  }, UMA_HORA));

  // worker da fila de disparo — intervalo lido do config no start (ajustável no banco,
  // só precisa reiniciar o processo pra pegar uma mudança de intervalo)
  let segundos = 30;
  try {
    const cfg = await query("SELECT valor FROM config WHERE chave = 'disparo_intervalo_segundos'");
    segundos = parseInt(cfg[0]?.valor) || 30;
  } catch (erro) {
    console.error('Não deu pra ler disparo_intervalo_segundos do config, usando 30s padrão.', erro);
  }
  timers.push(setInterval(() => {
    processarFilaDisparo().catch(console.error);
  }, segundos * 1000));
}

async function subir() {
  // Prepara o banco antes de aceitar tráfego: schema, migrações e agentes-padrão.
  // Quem prefere fazer isso na mão (phpMyAdmin/SSH) desliga com BOOTSTRAP_DB=false.
  if (process.env.BOOTSTRAP_DB !== 'false') {
    const r = await bootstrap();
    console.log('banco pronto —',
      r.colunas.length ? `colunas migradas: ${r.colunas.join(', ')};` : 'nada a migrar;',
      r.agentes.pulado ? `agentes já carregados (${r.agentes.total})` : `${r.agentes.criados} agentes criados`);
  }

  // carrega o token salvo (config da tela) por cima do .env
  await carregarToken().catch(() => {});

  const servidor = app.listen(PORT, () => console.log(`Apishot Platform rodando na porta ${PORT}`));
  await iniciarRotinas();
  return servidor;
}

/**
 * Desligar limpo: para de aceitar conexão nova, deixa as em andamento terminarem e
 * fecha o pool. Importa porque o worker de disparo está no meio de envios — matar o
 * processo no grito deixa registro na fila em estado ambíguo. 10s de teto pro caso
 * de uma conexão travada segurar o processo pra sempre.
 */
function desligar(servidor, sinal) {
  console.log(`recebido ${sinal} — desligando`);
  for (const t of timers) clearInterval(t);
  servidor.close(async () => {
    await pool.end().catch(() => {});
    console.log('desligado');
    process.exit(0);
  });
  // conexões keep-alive ociosas (o painel deixa várias abertas) segurariam o close()
  // até o timeout; as que estão no meio de uma requisição continuam até terminar.
  servidor.closeIdleConnections?.();
  const prazo = setTimeout(() => {
    console.error('desligamento demorou demais, encerrando à força');
    servidor.closeAllConnections?.();
    process.exit(1);
  }, 10_000);
  prazo.unref();
}

if (require.main === module) {
  subir()
    .then(servidor => {
      for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => desligar(servidor, sinal));
    })
    .catch(erro => {
      console.error('falha ao subir:', erro);
      process.exit(1);
    });
}

module.exports = { app, subir };
