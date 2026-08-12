const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { invalidarCacheAgentes } = require('../automations');
const asyncHandler = require('../asyncHandler');

// ---------- Etiquetas ----------
router.get('/etiquetas', asyncHandler(async (req, res) => {
  res.json(await query('SELECT * FROM etiquetas ORDER BY nome'));
}));

router.post('/etiquetas', asyncHandler(async (req, res) => {
  const { nome, cor } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ erro: 'informe nome' });
  await query('INSERT INTO etiquetas (nome, cor) VALUES (?, ?) ON DUPLICATE KEY UPDATE cor = VALUES(cor)', [nome.trim(), cor || '#16c95f']);
  res.sendStatus(201);
}));

router.delete('/etiquetas/:id', asyncHandler(async (req, res) => {
  await query('DELETE FROM etiquetas WHERE id = ?', [req.params.id]);
  res.sendStatus(200);
}));

// ---------- Leads (contatos com etiquetas + qualificação) ----------
router.get('/leads', asyncHandler(async (req, res) => {
  const contatos = await query(`
    SELECT c.telefone, c.nome, c.qualificacao, c.numero_id, c.atualizado_em,
           GROUP_CONCAT(e.nome ORDER BY e.nome SEPARATOR '|||') AS etiquetas
    FROM contatos c
    LEFT JOIN contato_etiquetas ce ON ce.telefone = c.telefone
    LEFT JOIN etiquetas e ON e.id = ce.etiqueta_id
    GROUP BY c.telefone
    ORDER BY c.atualizado_em DESC
    LIMIT 500
  `);
  res.json(contatos.map(c => ({ ...c, etiquetas: c.etiquetas ? c.etiquetas.split('|||') : [] })));
}));

// ---------- Agentes ----------
async function carregarComGatilhos(where = '', params = []) {
  const agentes = await query(`SELECT * FROM agentes ${where} ORDER BY prioridade_maxima DESC, prioridade, id`, params);
  if (!agentes.length) return [];
  const ids = agentes.map(a => a.id);
  const gatilhos = await query(
    `SELECT agente_id, gatilho FROM agente_gatilhos WHERE agente_id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  const porAgente = {};
  for (const g of gatilhos) { (porAgente[g.agente_id] || (porAgente[g.agente_id] = [])).push(g.gatilho); }
  return agentes.map(a => ({ ...a, gatilhos: porAgente[a.id] || [] }));
}

router.get('/', asyncHandler(async (req, res) => {
  res.json(await carregarComGatilhos());
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nome, gatilhos, resposta, etiqueta_id, qualificacao, prioridade, ativo } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ erro: 'informe nome' });
  const lista = Array.isArray(gatilhos) ? gatilhos.map(g => String(g).trim()).filter(Boolean) : [];
  const r = await query(
    'INSERT INTO agentes (nome, ativo, prioridade, resposta, etiqueta_id, qualificacao) VALUES (?, ?, ?, ?, ?, ?)',
    [nome.trim(), ativo === false ? 0 : 1, prioridade || 100, resposta || null, etiqueta_id || null, qualificacao || null]
  );
  for (const g of lista) await query('INSERT INTO agente_gatilhos (agente_id, gatilho) VALUES (?, ?)', [r.insertId, g]);
  invalidarCacheAgentes();
  res.status(201).json({ id: r.insertId });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { nome, gatilhos, resposta, etiqueta_id, qualificacao, prioridade, ativo } = req.body;
  const existe = await query('SELECT id FROM agentes WHERE id = ?', [req.params.id]);
  if (!existe.length) return res.sendStatus(404);
  await query(
    'UPDATE agentes SET nome = ?, ativo = ?, prioridade = ?, resposta = ?, etiqueta_id = ?, qualificacao = ? WHERE id = ?',
    [nome, ativo === false ? 0 : 1, prioridade || 100, resposta || null, etiqueta_id || null, qualificacao || null, req.params.id]
  );
  if (Array.isArray(gatilhos)) {
    await query('DELETE FROM agente_gatilhos WHERE agente_id = ?', [req.params.id]);
    for (const g of gatilhos.map(x => String(x).trim()).filter(Boolean)) {
      await query('INSERT INTO agente_gatilhos (agente_id, gatilho) VALUES (?, ?)', [req.params.id, g]);
    }
  }
  invalidarCacheAgentes();
  res.sendStatus(200);
}));

router.post('/:id/toggle', asyncHandler(async (req, res) => {
  await query('UPDATE agentes SET ativo = NOT ativo WHERE id = ?', [req.params.id]);
  invalidarCacheAgentes();
  res.sendStatus(200);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await query('DELETE FROM agentes WHERE id = ?', [req.params.id]);
  invalidarCacheAgentes();
  res.sendStatus(200);
}));

module.exports = router;
