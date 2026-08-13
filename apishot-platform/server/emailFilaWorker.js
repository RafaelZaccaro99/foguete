/**
 * Worker do disparo de email — roda em intervalo (setInterval em server.js),
 * espelhando o filaWorker do WhatsApp. Processa a fila de cada campanha de email
 * 'em_andamento' respeitando:
 *   - a mesma janela de horário do WhatsApp (config horario_inicio/fim);
 *   - a lista de descadastro (checada na hora do envio, além do scrub no enfileirar);
 *   - o limite por hora (email_limite_hora) — protege a reputação do domínio;
 *   - retry só em erro transitório (rede/4xx), até email_max_tentativas.
 */
const { query } = require('./db');
const { horarioPermitidoAgora } = require('./compliance');
const { getConfigEmail, getSegredoRastreio, configurado } = require('./emailStore');
const { enviarEmail } = require('./emailSender');
const {
  renderizarVariaveis, textoParaHtml, aplicarRastreio, classificarErroEmail,
} = require('./emailDisparo');

async function configInt(chave, padrao) {
  const cfg = await query('SELECT valor FROM config WHERE chave = ?', [chave]);
  return parseInt(cfg[0]?.valor) || padrao;
}

async function estaDescadastrado(email) {
  const rows = await query('SELECT 1 FROM email_descadastro WHERE email = ? LIMIT 1', [email]);
  return rows.length > 0;
}

// quantos ainda cabem nesta hora (limite deslizante de 60 min sobre os enviados)
async function quotaHoraRestante(limiteHora) {
  const rows = await query(
    "SELECT COUNT(*) AS n FROM email_fila WHERE status = 'enviada' AND atualizado_em > (NOW() - INTERVAL 1 HOUR)"
  );
  return Math.max(0, limiteHora - (rows[0]?.n || 0));
}

async function processarFilaEmail() {
  if (!configurado()) return;                  // sem SMTP configurado, nada a fazer
  if (!(await horarioPermitidoAgora())) return; // fora da janela — fica pendente

  const campanhas = await query("SELECT * FROM email_campanhas WHERE status = 'em_andamento'");
  if (!campanhas.length) return;

  const lote = await configInt('email_lote', 5);
  const limiteHora = await configInt('email_limite_hora', 100);
  const maxTentativas = await configInt('email_max_tentativas', 3);

  let quota = await quotaHoraRestante(limiteHora);
  for (const campanha of campanhas) {
    if (quota <= 0) return;
    quota = await processarCampanha(campanha, Math.min(lote, quota), maxTentativas, quota);
  }
}

async function processarCampanha(campanha, lote, maxTentativas, quota) {
  const pendentes = await query(
    "SELECT * FROM email_fila WHERE campanha_id = ? AND status = 'pendente' ORDER BY id LIMIT ?",
    [campanha.id, lote * 2]
  );

  if (!pendentes.length) {
    await query(
      `UPDATE email_campanhas SET status = 'concluida'
       WHERE id = ? AND NOT EXISTS (SELECT 1 FROM email_fila WHERE campanha_id = ? AND status = 'pendente')`,
      [campanha.id, campanha.id]
    );
    return quota;
  }

  const cfg = getConfigEmail();
  const segredo = getSegredoRastreio();
  let enviados = 0;

  for (const item of pendentes) {
    if (enviados >= lote || quota <= 0) break;

    if (await estaDescadastrado(item.email)) {
      await query("UPDATE email_fila SET status='bloqueada', motivo='descadastrado' WHERE id=?", [item.id]);
      continue;
    }

    quota--;
    enviados++;
    try {
      const contato = { nome: item.nome, email: item.email };
      const assunto = renderizarVariaveis(campanha.assunto, contato);
      const corpo = renderizarVariaveis(campanha.corpo, contato);
      const html = aplicarRastreio(textoParaHtml(corpo), { baseUrl: cfg.baseUrl, segredo, filaId: item.id });
      const messageId = await enviarEmail({ para: item.email, assunto, html, texto: corpo });
      await query("UPDATE email_fila SET status='enviada', message_id=?, motivo=NULL WHERE id=?", [messageId, item.id]);
    } catch (erro) {
      const tipo = classificarErroEmail(erro);
      const tentativas = (item.tentativas || 0) + 1;
      if (tipo === 'transitorio' && tentativas < maxTentativas) {
        await query("UPDATE email_fila SET tentativas=?, motivo='retry_transitorio' WHERE id=?", [tentativas, item.id]);
      } else {
        await query("UPDATE email_fila SET status='falhou', tentativas=?, motivo=? WHERE id=?",
          [tentativas, String(erro).slice(0, 60), item.id]);
        await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
          'erro_disparo_email', JSON.stringify({ campanha_id: campanha.id, email: item.email, tipo, erro: String(erro) }),
        ]);
      }
    }
  }
  return quota;
}

module.exports = { processarFilaEmail };
