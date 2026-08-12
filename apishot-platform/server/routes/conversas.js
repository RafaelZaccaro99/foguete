const express = require('express');
const router = express.Router();
const { query } = require('../db');

// Tela de conversas — consulta/auditoria, não é inbox de atendimento completo.
router.get('/', async (req, res) => {
  const contatos = await query(`
    SELECT contato_telefone,
           MAX(criado_em) AS ultima_mensagem,
           COUNT(*) AS total_mensagens
    FROM mensagens
    GROUP BY contato_telefone
    ORDER BY ultima_mensagem DESC
    LIMIT 200
  `);
  res.json(contatos);
});

router.get('/:telefone', async (req, res) => {
  const mensagens = await query(
    'SELECT * FROM mensagens WHERE contato_telefone = ? ORDER BY criado_em ASC',
    [req.params.telefone]
  );
  res.json(mensagens);
});

// resposta manual — só usada quando a automação "atendente_humano" foi acionada
router.post('/:telefone/responder', async (req, res) => {
  // implementar chamada à Graph API igual ao webhook.js (enviarResposta) quando o Rafael
  // conectar essa tela ao token/número certo. Deixado como TODO proposital — ver seção 6
  // do PROMPT_IMPLEMENTACAO.md.
  res.status(501).json({ erro: 'TODO: implementar envio manual — ver PROMPT_IMPLEMENTACAO.md seção 6' });
});

module.exports = router;
