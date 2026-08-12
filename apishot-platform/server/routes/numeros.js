const express = require('express');
const router = express.Router();
const { query } = require('../db');

// Tela de gestão de números
router.get('/', async (req, res) => {
  const numeros = await query('SELECT * FROM numeros ORDER BY label');
  res.json(numeros);
});

router.post('/', async (req, res) => {
  const { phone_number_id, waba_id, label, limite_diario } = req.body;
  await query(
    'INSERT INTO numeros (phone_number_id, waba_id, label, limite_diario, status) VALUES (?, ?, ?, ?, "aquecendo")',
    [phone_number_id, waba_id, label, limite_diario || 200]
  );
  res.sendStatus(201);
});

router.post('/:id/pausar', async (req, res) => {
  await query('UPDATE numeros SET status = "pausado" WHERE id = ?', [req.params.id]);
  res.sendStatus(200);
});

router.post('/:id/ativar', async (req, res) => {
  await query('UPDATE numeros SET status = "ativo" WHERE id = ?', [req.params.id]);
  res.sendStatus(200);
});

module.exports = router;
