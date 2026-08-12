const express = require('express');
const router = express.Router();
const { criarTemplate, clonarTemplateEmWabas, listarTemplatesDaWaba } = require('../graphApi');
const { query } = require('../db');

// Sobe um template novo pra aprovação da Meta numa WABA.
router.post('/', async (req, res) => {
  try {
    const { waba_id, name, category, language, components } = req.body;
    if (!waba_id || !name || !category || !components) {
      return res.status(400).json({ erro: 'informe waba_id, name, category e components' });
    }
    const r = await criarTemplate(waba_id, { name, category, language: language || 'pt_BR', components });
    res.status(201).json(r);
  } catch (erro) {
    res.status(500).json({ erro: String(erro) });
  }
});

// Clona um template existente (mesmo nome/idioma/texto/botões) pras WABAs informadas
// que ainda não têm — mesmo comportamento do "clonarTemplate" do Foguete antigo.
router.post('/clonar', async (req, res) => {
  try {
    const { waba_origem, name, language, waba_destinos } = req.body;
    if (!waba_origem || !name || !language || !Array.isArray(waba_destinos) || !waba_destinos.length) {
      return res.status(400).json({ erro: 'informe waba_origem, name, language e waba_destinos (array)' });
    }
    const numeros = await query('SELECT label FROM numeros WHERE waba_id = ? LIMIT 1', [waba_origem]);
    const templates = await listarTemplatesDaWaba(waba_origem, numeros[0]?.label || waba_origem);
    const base = templates.find(t => t.name === name && t.language === language);
    if (!base) return res.status(404).json({ erro: 'template não encontrado na WABA de origem' });
    const resultados = await clonarTemplateEmWabas(base, waba_destinos);
    res.json({ resultados });
  } catch (erro) {
    res.status(500).json({ erro: String(erro) });
  }
});

module.exports = router;
