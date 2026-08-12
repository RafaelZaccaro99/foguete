/**
 * Autenticação do painel — senha única compartilhada.
 * Sem dependências: usa o módulo `crypto` nativo.
 *   - senha guardada como hash scrypt na tabela config (chave 'painel_senha_hash');
 *     se não houver hash ainda, aceita PAINEL_SENHA do .env e grava no primeiro acerto.
 *   - sessão stateless por cookie assinado (HMAC-SHA256 com SESSION_SECRET), com
 *     validade de 7 dias — sobrevive a restart, não precisa de store.
 */
const crypto = require('crypto');
const { query } = require('./db');

const COOKIE = 'apishot_sess';
const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;
const segredoSessao = () => process.env.SESSION_SECRET || 'troque-esse-segredo-no-env';

// ---------- senha (scrypt) ----------
function gerarHash(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(senha, salt, 64).toString('hex');
  return `${salt}:${dk}`;
}

function conferemHash(senha, hashGuardado) {
  const [salt, dk] = String(hashGuardado).split(':');
  if (!salt || !dk) return false;
  const calc = crypto.scryptSync(senha, salt, 64);
  const alvo = Buffer.from(dk, 'hex');
  return calc.length === alvo.length && crypto.timingSafeEqual(calc, alvo);
}

async function hashSalvo() {
  const r = await query("SELECT valor FROM config WHERE chave = 'painel_senha_hash'").catch(() => []);
  return r[0]?.valor || null;
}

async function definirSenha(novaSenha) {
  const hash = gerarHash(novaSenha);
  await query(
    "INSERT INTO config (chave, valor) VALUES ('painel_senha_hash', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
    [hash]
  );
}

// Confere a senha. Bootstrap: se ainda não há hash salvo, valida contra PAINEL_SENHA
// do .env e grava o hash (a partir daí o .env não é mais necessário pra login).
async function senhaConfere(senha) {
  if (!senha) return false;
  const hash = await hashSalvo();
  if (hash) return conferemHash(senha, hash);
  const doEnv = process.env.PAINEL_SENHA;
  if (doEnv && senha === doEnv) {
    await definirSenha(senha);
    return true;
  }
  return false;
}

// ---------- cookie de sessão (assinado) ----------
function assinar(payloadB64) {
  return crypto.createHmac('sha256', segredoSessao()).update(payloadB64).digest('hex');
}

function criarSessao(res) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + VALIDADE_MS })).toString('base64');
  const cookie = `${payload}.${assinar(payload)}`;
  res.setHeader('Set-Cookie',
    `${COOKIE}=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${VALIDADE_MS / 1000}`);
}

function limparSessao(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function lerCookie(req, nome) {
  const raw = req.headers.cookie || '';
  for (const par of raw.split(';')) {
    const [k, ...v] = par.trim().split('=');
    if (k === nome) return v.join('=');
  }
  return null;
}

function sessaoValida(req) {
  const cookie = lerCookie(req, COOKIE);
  if (!cookie) return false;
  const idx = cookie.lastIndexOf('.');
  if (idx < 0) return false;
  const payload = cookie.slice(0, idx);
  const assinatura = cookie.slice(idx + 1);
  const esperada = assinar(payload);
  if (assinatura.length !== esperada.length ||
      !crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64').toString());
    return typeof exp === 'number' && Date.now() < exp;
  } catch (e) {
    return false;
  }
}

// middleware pra rotas de API (401 se não logado)
function requireAuth(req, res, next) {
  if (sessaoValida(req)) return next();
  res.status(401).json({ erro: 'nao_autenticado' });
}

module.exports = {
  senhaConfere, definirSenha, criarSessao, limparSessao, sessaoValida, requireAuth, COOKIE,
};
