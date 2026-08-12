/**
 * Motor de agentes (antigas 17 automações, agora configuráveis no banco).
 * Reconhece intenção por gatilho de palavra-chave e devolve o agente que casa —
 * NUNCA gera texto, só aponta pra resposta já cadastrada (regra do briefing).
 *
 * `matchAgente` é puro (recebe a lista pronta) pra dar pra testar sem banco.
 * `encontrarAutomacao` carrega os agentes do banco com cache e usa o matcher.
 */
const { query } = require('./db');

function normalizar(txt) {
  return (txt || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// matcher puro. agentes: [{id, prioridade, prioridade_maxima, gatilhos:[...], ...}]
// Opt-out (prioridade_maxima) sempre vence, mesmo que o texto também bata em outro.
function matchAgente(mensagemTexto, agentes) {
  const texto = normalizar(mensagemTexto);
  const ativos = agentes.filter(a => a.ativo !== false);

  const casa = a => a.gatilhos.some(g => texto.includes(normalizar(g)));

  const prioritarios = ativos.filter(a => a.prioridade_maxima);
  for (const a of prioritarios) if (casa(a)) return a;

  const resto = ativos
    .filter(a => !a.prioridade_maxima)
    .sort((x, y) => (x.prioridade - y.prioridade) || (x.id - y.id));
  for (const a of resto) if (casa(a)) return a;

  return null;
}

// ---------- carga do banco com cache ----------
const TTL_MS = 60 * 1000;
let cache = { ts: 0, agentes: [] };

async function carregarAgentes(forcar = false) {
  if (!forcar && Date.now() - cache.ts < TTL_MS) return cache.agentes;
  const linhas = await query('SELECT * FROM agentes WHERE ativo = TRUE');
  const gatilhos = await query('SELECT agente_id, gatilho FROM agente_gatilhos');
  const porAgente = {};
  for (const g of gatilhos) {
    if (!porAgente[g.agente_id]) porAgente[g.agente_id] = [];
    porAgente[g.agente_id].push(g.gatilho);
  }
  const agentes = linhas.map(a => ({
    ...a,
    gatilhos: porAgente[a.id] || [],
    prioridade_maxima: !!a.prioridade_maxima,
    ativo: !!a.ativo,
  }));
  cache = { ts: Date.now(), agentes };
  return agentes;
}

function invalidarCacheAgentes() {
  cache = { ts: 0, agentes: [] };
}

async function encontrarAutomacao(mensagemTexto) {
  const agentes = await carregarAgentes();
  return matchAgente(mensagemTexto, agentes);
}

module.exports = { normalizar, matchAgente, encontrarAutomacao, carregarAgentes, invalidarCacheAgentes };
