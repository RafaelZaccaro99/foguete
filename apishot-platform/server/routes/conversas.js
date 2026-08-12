const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { enviarTexto } = require('../graphApi');
const asyncHandler = require('../asyncHandler');

// Tela de conversas — consulta/auditoria, não é inbox de atendimento completo.
router.get('/', asyncHandler(async (req, res) => {
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
}));

router.get('/:telefone', asyncHandler(async (req, res) => {
  const mensagens = await query(
    'SELECT * FROM mensagens WHERE contato_telefone = ? ORDER BY criado_em ASC',
    [req.params.telefone]
  );
  res.json(mensagens);
}));

// resposta manual — só usada quando a automação "atendente_humano" foi acionada.
// Usa o numero_id gravado na última mensagem de entrada desse contato (ver webhook.js)
// pra saber por qual número da conta responder.
router.post('/:telefone/responder', asyncHandler(async (req, res) => {
  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ erro: 'informe texto' });

  const ultima = await query(
    "SELECT numero_id FROM mensagens WHERE contato_telefone = ? AND direcao = 'entrada' AND numero_id IS NOT NULL ORDER BY criado_em DESC LIMIT 1",
    [req.params.telefone]
  );
  const numeroId = ultima[0]?.numero_id;
  if (!numeroId) {
    return res.status(400).json({ erro: 'não foi possível identificar por qual número esse contato conversou (mensagem de entrada sem numero_id)' });
  }
  const numeros = await query('SELECT phone_number_id FROM numeros WHERE id = ?', [numeroId]);
  const phoneNumberId = numeros[0]?.phone_number_id;
  if (!phoneNumberId) return res.status(404).json({ erro: 'número não encontrado' });

  const r = await enviarTexto(phoneNumberId, req.params.telefone, texto);
  await query(
    'INSERT INTO mensagens (numero_id, contato_telefone, direcao, texto, criado_em) VALUES (?, ?, "saida", ?, NOW())',
    [numeroId, req.params.telefone, texto]
  );
  res.status(201).json(r);
}));

module.exports = router;
