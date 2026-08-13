require('dotenv').config();
const path = require('path');
const express = require('express');
const app = express();
// captura o corpo cru pra validar a assinatura do webhook (HMAC precisa dos bytes originais)
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

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
const emailRoutes = require('./routes/email');
const emailPublicoRoutes = require('./routes/emailPublico');
const { atualizarQualityRatingTodosNumeros } = require('./compliance');
const { processarFilaDisparo } = require('./filaWorker');
const { processarFilaEmail } = require('./emailFilaWorker');
const { getToken, carregar: carregarToken } = require('./tokenStore');
const { carregar: carregarConfigEmail } = require('./emailStore');
const { query } = require('./db');

// health check público (sem login) — pra UptimeRobot manter o processo acordado
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/auth', authRoutes);
app.use('/webhook', webhookRoutes); // protegido por ASSINATURA (não por login — a Meta precisa alcançar)
app.use('/e', emailPublicoRoutes);  // rastreio/descadastro de email — protegido por assinatura HMAC nos links

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
app.use('/email', requireAuth, emailRoutes);

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
app.listen(PORT, () => console.log(`Apishot Platform rodando na porta ${PORT}`));

// carrega o token salvo (config da tela) por cima do .env, assim que o banco estiver pronto
carregarToken().catch(() => {});
carregarConfigEmail().catch(() => {});

// monitora quality rating de todos os números a cada 1h (e promove aquecendo → ativo)
const UMA_HORA = 60 * 60 * 1000;
setInterval(() => {
  atualizarQualityRatingTodosNumeros(getToken()).catch(console.error);
}, UMA_HORA);

// limpeza diária do eventos_log (a tabela cresce pra sempre) — aproveita o tick horário,
// mas só executa de fato 1x/dia (guarda a última data). Retenção configurável.
let ultimaLimpezaLog = null;
setInterval(async () => {
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
}, UMA_HORA);

// worker da fila de disparo — intervalo lido do config no start (ajustável no banco,
// só precisa reiniciar o processo pra pegar uma mudança de intervalo)
(async () => {
  let segundos = 30;
  try {
    const cfg = await query("SELECT valor FROM config WHERE chave = 'disparo_intervalo_segundos'");
    segundos = parseInt(cfg[0]?.valor) || 30;
  } catch (erro) {
    console.error('Não deu pra ler disparo_intervalo_segundos do config, usando 30s padrão.', erro);
  }
  setInterval(() => {
    processarFilaDisparo().catch(console.error);
  }, segundos * 1000);
})();

// worker da fila de EMAIL — mesmo modelo do disparo (intervalo lido no start)
(async () => {
  let segundos = 60;
  try {
    const cfg = await query("SELECT valor FROM config WHERE chave = 'email_intervalo_segundos'");
    segundos = parseInt(cfg[0]?.valor) || 60;
  } catch (erro) {
    console.error('Não deu pra ler email_intervalo_segundos do config, usando 60s padrão.', erro);
  }
  setInterval(() => {
    processarFilaEmail().catch(console.error);
  }, segundos * 1000);
})();
