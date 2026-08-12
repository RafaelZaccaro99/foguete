/**
 * Fonte única do token do WhatsApp (usuário de sistema).
 * O token pode vir de dois lugares, nesta ordem de prioridade:
 *   1. o que foi salvo pela tela (tabela config, chave 'whatsapp_token')
 *   2. o WHATSAPP_TOKEN do .env (fallback)
 * Fica em cache na memória pra `getToken()` ser síncrono (a Graph API usa como
 * default de argumento). `carregar()` roda no boot; `setToken()` grava e atualiza o cache.
 * O token NUNCA vai pro navegador — a tela só manda ele pra cá e consulta status mascarado.
 */
const { query } = require('./db');

let cache = process.env.WHATSAPP_TOKEN || null;

async function carregar() {
  try {
    const r = await query("SELECT valor FROM config WHERE chave = 'whatsapp_token'");
    if (r[0]?.valor) cache = r[0].valor;
  } catch (erro) {
    // banco ainda indisponível no boot — segue com o valor do .env
  }
  return cache;
}

function getToken() {
  return cache;
}

async function setToken(valor) {
  cache = valor || null;
  await query(
    "INSERT INTO config (chave, valor) VALUES ('whatsapp_token', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
    [valor || '']
  );
}

// de onde veio o token atualmente em uso (pra mostrar na tela)
async function origem() {
  const r = await query("SELECT valor FROM config WHERE chave = 'whatsapp_token'").catch(() => []);
  if (r[0]?.valor) return 'config';
  if (process.env.WHATSAPP_TOKEN) return 'env';
  return null;
}

module.exports = { carregar, getToken, setToken, origem };
