const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { adicionarNaoPerturbe } = require('../compliance');
const asyncHandler = require('../asyncHandler');

// visão geral: contagem + amostra
router.get('/', asyncHandler(async (req, res) => {
  const total = (await query('SELECT COUNT(*) AS total FROM nao_perturbe'))[0].total;
  const amostra = await query('SELECT telefone, origem, criado_em FROM nao_perturbe ORDER BY criado_em DESC LIMIT 50');
  res.json({ total, amostra });
}));

// preview antes de disparar: quantos da lista já estão bloqueados
router.post('/checar', asyncHandler(async (req, res) => {
  const { telefones } = req.body;
  if (!Array.isArray(telefones) || !telefones.length) return res.json({ bloqueados: 0, total: 0 });
  const ph = telefones.map(() => '?').join(',');
  const rows = await query(`SELECT COUNT(*) AS bloqueados FROM nao_perturbe WHERE telefone IN (${ph})`, telefones);
  res.json({ bloqueados: rows[0].bloqueados, total: telefones.length });
}));

// importar lista de exclusão (telefones já normalizados no navegador) -> nao_perturbe.
// É o caminho pra carregar um export de Anatel/Procon/própria quando o Rafael tiver a fonte.
router.post('/importar', asyncHandler(async (req, res) => {
  const { telefones } = req.body;
  if (!Array.isArray(telefones) || !telefones.length) return res.status(400).json({ erro: 'informe telefones: []' });
  let adicionados = 0;
  for (const tel of telefones) {
    if (!tel) continue;
    await adicionarNaoPerturbe(String(tel), 'upload_manual');
    adicionados++;
  }
  await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
    'importou_lista_exclusao', JSON.stringify({ adicionados }),
  ]);
  res.status(201).json({ adicionados });
}));

module.exports = router;
