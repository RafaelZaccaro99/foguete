const express = require('express');
const router = express.Router();
const { criarTemplate, clonarTemplateEmWabas, listarTemplatesDaWaba } = require('../graphApi');
const { query } = require('../db');
const asyncHandler = require('../asyncHandler');

// Biblioteca de templates: TODOS os status (aprovado/pendente/recusado) de todas as WABAs
// cadastradas, agrupados por nome+idioma, cada grupo dizendo em quais contas existe e o
// status em cada. Cache curto pra não bater na Graph API a cada abertura da tela.
const TTL_MS = 5 * 60 * 1000;
let cache = { ts: 0, dados: [] };

router.get('/', asyncHandler(async (req, res) => {
  if (!req.query.forcar && Date.now() - cache.ts < TTL_MS) return res.json(cache.dados);
  const numeros = await query('SELECT waba_id, label FROM numeros');
  const nomeWaba = {};
  const wabaIds = [];
  for (const n of numeros) {
    if (!nomeWaba[n.waba_id]) { nomeWaba[n.waba_id] = n.label; wabaIds.push(n.waba_id); }
  }
  let todos = [];
  for (const wabaId of wabaIds) {
    try { todos = todos.concat(await listarTemplatesDaWaba(wabaId, nomeWaba[wabaId])); }
    catch (erro) { /* WABA instável — segue as outras */ }
  }
  const grupos = {};
  for (const t of todos) {
    const chave = `${t.name}|${t.language}`;
    if (!grupos[chave]) grupos[chave] = { nome: t.name, idioma: t.language, categoria: t.category, variantes: [] };
    grupos[chave].variantes.push({ waba: t.__waba, wabaNome: t.__wabaName, status: t.status, components: t.components });
  }
  cache = { ts: Date.now(), dados: Object.values(grupos) };
  res.json(cache.dados);
}));

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
