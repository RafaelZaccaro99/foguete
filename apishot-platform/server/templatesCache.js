/**
 * Cache curto (5 min) dos templates aprovados agrupados por nome+idioma — evita
 * bater na Graph API toda vez que a tela de disparo ou a criação de campanha
 * precisam saber quem tem qual template aprovado.
 */
const { query } = require('./db');
const { listarTemplatesDaWaba } = require('./graphApi');

const TTL_MS = 5 * 60 * 1000;
let cache = { ts: 0, dados: [] };

async function obterGruposTemplates(forcar = false) {
  if (!forcar && Date.now() - cache.ts < TTL_MS) return cache.dados;

  const numeros = await query('SELECT waba_id, label FROM numeros');
  const nomeWaba = {};
  const wabaIds = [];
  for (const n of numeros) {
    if (!nomeWaba[n.waba_id]) { nomeWaba[n.waba_id] = n.label; wabaIds.push(n.waba_id); }
  }

  let todos = [];
  for (const wabaId of wabaIds) {
    const tpls = await listarTemplatesDaWaba(wabaId, nomeWaba[wabaId]);
    todos = todos.concat(tpls.filter(t => t.status === 'APPROVED'));
  }

  const grupos = {};
  for (const t of todos) {
    const chave = `${t.name}|${t.language}`;
    if (!grupos[chave]) grupos[chave] = { nome: t.name, idioma: t.language, categoria: t.category, variantes: [] };
    grupos[chave].variantes.push({ waba: t.__waba, wabaNome: t.__wabaName, components: t.components });
  }
  cache = { ts: Date.now(), dados: Object.values(grupos) };
  return cache.dados;
}

module.exports = { obterGruposTemplates };
