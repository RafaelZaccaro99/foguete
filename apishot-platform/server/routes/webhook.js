const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { encontrarAutomacao } = require('../automations');
const { adicionarNaoPerturbe } = require('../compliance');
const { enviarTexto } = require('../graphApi');

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

async function resolverNumeroId(phoneNumberId) {
  const rows = await query('SELECT id FROM numeros WHERE phone_number_id = ? LIMIT 1', [phoneNumberId]);
  return rows[0]?.id || null;
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

        await query(
          'INSERT INTO mensagens (numero_id, contato_telefone, direcao, texto, criado_em) VALUES (?, ?, "entrada", ?, NOW())',
          [numeroId, de, texto]
        );
        await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
          'mensagem_recebida', JSON.stringify({ de, texto }),
        ]);

        if (m.type !== 'text') continue;

        const automacao = encontrarAutomacao(texto);
        if (!automacao) {
          await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
            'automacao_nao_encontrada', JSON.stringify({ de, texto }),
          ]);
          continue;
        }

        const chave = `${de}:${automacao.id}`;
        const ultima = ultimaExecucao.get(chave);
        if (!automacao.prioridade_maxima && ultima && Date.now() - ultima < JANELA_REPETICAO_MS) {
          continue; // bloqueado por repetição — exceto opt-out, que sempre processa
        }

        // registra a ação de compliance ANTES de tentar responder — se o envio da
        // confirmação falhar (Meta fora do ar, rate limit etc.), o contato tem que
        // entrar na lista de não-perturbe do mesmo jeito. É a prioridade 1 do bot.
        if (automacao.acao_extra === 'adicionar_nao_perturbe') {
          await adicionarNaoPerturbe(de, 'opt_out_automatico');
        }

        try {
          await enviarTexto(phoneNumberId, de, automacao.resposta);
          ultimaExecucao.set(chave, Date.now());

          await query(
            'INSERT INTO mensagens (numero_id, contato_telefone, direcao, texto, automacao_id, criado_em) VALUES (?, ?, "saida", ?, ?, NOW())',
            [numeroId, de, automacao.resposta, automacao.id]
          );
          await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
            'automacao_executada', JSON.stringify({ de, automacao: automacao.id }),
          ]);
        } catch (erro) {
          await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
            'erro_envio_automacao', JSON.stringify({ de, automacao: automacao.id, erro: String(erro) }),
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
