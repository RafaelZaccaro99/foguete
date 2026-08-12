const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { enviarTexto } = require('../graphApi');
const asyncHandler = require('../asyncHandler');

// Tela de conversas — consulta/auditoria, não é inbox de atendimento completo.
// ?numero_id=X filtra pra ver só as conversas que passaram por aquele número.
// numero_id devolvido = o número da mensagem mais recente do contato (o front resolve o label).
router.get('/', asyncHandler(async (req, res) => {
  const numeroId = req.query.numero_id ? parseInt(req.query.numero_id) : null;
  const where = numeroId ? 'WHERE m.numero_id = ?' : '';
  const params = numeroId ? [numeroId] : [];
  const contatos = await query(`
    SELECT m.contato_telefone,
           MAX(m.criado_em) AS ultima_mensagem,
           COUNT(*) AS total_mensagens,
           CAST(SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(m.numero_id, 0) ORDER BY m.criado_em DESC), ',', 1) AS UNSIGNED) AS numero_id,
           COALESCE(MAX(c.qualificacao), 'novo') AS qualificacao
    FROM mensagens m
    LEFT JOIN contatos c ON c.telefone = m.contato_telefone
    ${where}
    GROUP BY m.contato_telefone
    ORDER BY ultima_mensagem DESC
    LIMIT 200
  `, params);
  res.json(contatos);
}));

router.get('/:telefone', asyncHandler(async (req, res) => {
  const mensagens = await query(
    'SELECT * FROM mensagens WHERE contato_telefone = ? ORDER BY criado_em ASC',
    [req.params.telefone]
  );
  const etiquetas = await query(
    `SELECT e.id, e.nome, e.cor FROM contato_etiquetas ce
     JOIN etiquetas e ON e.id = ce.etiqueta_id WHERE ce.telefone = ?`,
    [req.params.telefone]
  ).catch(() => []);
  res.json({ mensagens, etiquetas });
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

// LGPD — apagar todos os dados de um contato (mensagens, cadastro, etiquetas).
// Opcional: adicionar à lista de não-perturbe pra não voltar a receber.
router.delete('/:telefone/dados', asyncHandler(async (req, res) => {
  const tel = req.params.telefone;
  await query('DELETE FROM contato_etiquetas WHERE telefone = ?', [tel]);
  await query('DELETE FROM mensagens WHERE contato_telefone = ?', [tel]);
  await query('DELETE FROM contatos WHERE telefone = ?', [tel]);
  if (req.query.bloquear === '1') {
    await query(
      "INSERT INTO nao_perturbe (telefone, origem) VALUES (?, 'upload_manual') ON DUPLICATE KEY UPDATE origem = origem",
      [tel]
    );
  }
  await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
    'lgpd_exclusao_contato', JSON.stringify({ telefone: tel }),
  ]);
  res.json({ ok: true });
}));

module.exports = router;
