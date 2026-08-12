const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { query } = require('../db');
const { encontrarAutomacao } = require('../automations');
const { adicionarNaoPerturbe } = require('../compliance');
const { enviarTexto } = require('../graphApi');

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Confere a assinatura que a Meta manda (X-Hub-Signature-256 = HMAC-SHA256 do corpo cru
// com o App Secret). Sem isso, qualquer um poderia forjar uma mensagem "de um cliente"
// e fazer o bot responder de verdade. Se META_APP_SECRET não estiver configurado (dev),
// pula a checagem mas avisa no log — em produção, configure o secret.
function assinaturaValida(req) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.warn('META_APP_SECRET não configurado — webhook SEM verificação de assinatura (ok em dev, NÃO em produção).');
    return true;
  }
  const header = req.get('X-Hub-Signature-256') || '';
  const esperada = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.from('')).digest('hex');
  if (header.length !== esperada.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(esperada));
  } catch (e) {
    return false;
  }
}

async function resolverNumeroId(phoneNumberId) {
  const rows = await query('SELECT id FROM numeros WHERE phone_number_id = ? LIMIT 1', [phoneNumberId]);
  return rows[0]?.id || null;
}

// registra/atualiza o contato no inbound (a tabela contatos antes ficava vazia).
async function upsertContato(telefone, numeroId) {
  await query(
    `INSERT INTO contatos (telefone, numero_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE numero_id = VALUES(numero_id)`,
    [telefone, numeroId]
  );
}

// aplica os efeitos de um agente que casou: etiqueta e/ou qualificação do lead.
async function aplicarEfeitosAgente(telefone, agente) {
  if (agente.etiqueta_id) {
    await query(
      'INSERT IGNORE INTO contato_etiquetas (telefone, etiqueta_id) VALUES (?, ?)',
      [telefone, agente.etiqueta_id]
    );
  }
  if (agente.qualificacao) {
    await query('UPDATE contatos SET qualificacao = ? WHERE telefone = ?', [agente.qualificacao, telefone]);
  }
}

// controle de repetição em memória (6h) — pode virar tabela própria depois se quiser persistir entre restarts
const JANELA_REPETICAO_MS = 6 * 60 * 60 * 1000;
const ultimaExecucao = new Map();

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

router.post('/', async (req, res) => {
  if (!assinaturaValida(req)) return res.sendStatus(401);
  res.sendStatus(200);
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    if (!value) return;
    const phoneNumberId = value.metadata?.phone_number_id;

    if (value.statuses) {
      for (const s of value.statuses) {
        await query('UPDATE mensagens SET status = ? WHERE wamid = ?', [s.status, s.id]);
      }
    }

    if (value.messages) {
      const numeroId = await resolverNumeroId(phoneNumberId);
      for (const m of value.messages) {
        const de = m.from;
        const texto = m.text?.body || '';

        await upsertContato(de, numeroId);
        await query(
          'INSERT INTO mensagens (numero_id, contato_telefone, direcao, texto, criado_em) VALUES (?, ?, "entrada", ?, NOW())',
          [numeroId, de, texto]
        );
        await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
          'mensagem_recebida', JSON.stringify({ de, texto }),
        ]);

        if (m.type !== 'text') continue;

        const agente = await encontrarAutomacao(texto);
        if (!agente) {
          await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
            'automacao_nao_encontrada', JSON.stringify({ de, texto }),
          ]);
          continue;
        }
        const agenteRef = agente.chave || String(agente.id); // id estável pra log/mensagens

        const chaveRep = `${de}:${agente.id}`;
        const ultima = ultimaExecucao.get(chaveRep);
        if (!agente.prioridade_maxima && ultima && Date.now() - ultima < JANELA_REPETICAO_MS) {
          continue; // bloqueado por repetição — exceto opt-out, que sempre processa
        }

        // registra a ação de compliance ANTES de tentar responder — se o envio da
        // confirmação falhar (Meta fora do ar, rate limit etc.), o contato tem que
        // entrar na lista de não-perturbe do mesmo jeito. É a prioridade 1 do bot.
        if (agente.acao_extra === 'adicionar_nao_perturbe') {
          await adicionarNaoPerturbe(de, 'opt_out_automatico');
        }
        // etiqueta/qualificação valem mesmo que o envio falhe (é registro do lead, não depende da Meta)
        await aplicarEfeitosAgente(de, agente);

        try {
          if (agente.resposta) await enviarTexto(phoneNumberId, de, agente.resposta);
          ultimaExecucao.set(chaveRep, Date.now());

          await query(
            'INSERT INTO mensagens (numero_id, contato_telefone, direcao, texto, automacao_id, criado_em) VALUES (?, ?, "saida", ?, ?, NOW())',
            [numeroId, de, agente.resposta || '', agenteRef]
          );
          await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
            'automacao_executada', JSON.stringify({ de, automacao: agenteRef }),
          ]);
        } catch (erro) {
          await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
            'erro_envio_automacao', JSON.stringify({ de, automacao: agenteRef, erro: String(erro) }),
          ]);
        }
      }
    }
  } catch (erro) {
    await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
      'erro_processamento_webhook', JSON.stringify({ erro: String(erro) }),
    ]).catch(() => {});
  }
});

module.exports = router;
