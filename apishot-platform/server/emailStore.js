/**
 * Fonte única da configuração de email (SMTP + remetente + rastreio).
 * Mesmo modelo do tokenStore: o que foi salvo pela tela (tabela config) tem
 * prioridade sobre o .env; tudo fica em cache na memória pra leitura síncrona.
 * A senha SMTP NUNCA vai pro navegador — a tela só manda ela pra cá e consulta
 * o status mascarado.
 *
 * Chaves (config → fallback .env):
 *   smtp_host            → SMTP_HOST
 *   smtp_porta           → SMTP_PORT        (587 padrão)
 *   smtp_usuario         → SMTP_USER
 *   smtp_senha           → SMTP_PASS
 *   smtp_seguro          → SMTP_SECURE      ('1' = TLS direto porta 465)
 *   email_remetente      → EMAIL_FROM       (ex: contato@vendimais.digital)
 *   email_remetente_nome → EMAIL_FROM_NAME  (ex: Vendi+)
 *   email_base_url       → EMAIL_BASE_URL   (URL pública do painel, pros links de
 *                                            rastreio/descadastro; sem ela o email
 *                                            sai sem pixel e sem link de descadastro)
 */
const crypto = require('crypto');
const { query } = require('./db');

const CAMPOS = [
  ['smtp_host', 'SMTP_HOST'],
  ['smtp_porta', 'SMTP_PORT'],
  ['smtp_usuario', 'SMTP_USER'],
  ['smtp_senha', 'SMTP_PASS'],
  ['smtp_seguro', 'SMTP_SECURE'],
  ['email_remetente', 'EMAIL_FROM'],
  ['email_remetente_nome', 'EMAIL_FROM_NAME'],
  ['email_base_url', 'EMAIL_BASE_URL'],
];

const cache = {};
for (const [chave, env] of CAMPOS) cache[chave] = process.env[env] || null;
let segredoRastreio = null; // gerado no primeiro boot e persistido (links antigos continuam válidos)

async function carregar() {
  try {
    const chaves = CAMPOS.map(c => c[0]).concat('email_rastreio_segredo');
    const rows = await query(
      `SELECT chave, valor FROM config WHERE chave IN (${chaves.map(() => '?').join(',')})`,
      chaves
    );
    for (const r of rows) {
      if (r.chave === 'email_rastreio_segredo') segredoRastreio = r.valor;
      else if (r.valor) cache[r.chave] = r.valor;
    }
    if (!segredoRastreio) {
      segredoRastreio = crypto.randomBytes(24).toString('hex');
      await query(
        "INSERT INTO config (chave, valor) VALUES ('email_rastreio_segredo', ?) ON DUPLICATE KEY UPDATE valor = valor",
        [segredoRastreio]
      );
    }
  } catch (erro) {
    // banco indisponível no boot — segue com o .env; carregar() roda de novo via getConfigEmail
  }
  return cache;
}

function getConfigEmail() {
  return {
    host: cache.smtp_host,
    porta: parseInt(cache.smtp_porta) || 587,
    usuario: cache.smtp_usuario,
    senha: cache.smtp_senha,
    seguro: cache.smtp_seguro === '1' || cache.smtp_seguro === 'true',
    remetente: cache.email_remetente,
    remetenteNome: cache.email_remetente_nome,
    baseUrl: (cache.email_base_url || '').replace(/\/+$/, ''),
  };
}

function configurado() {
  const c = getConfigEmail();
  return !!(c.host && c.usuario && c.senha && c.remetente);
}

function getSegredoRastreio() {
  return segredoRastreio || 'sem-segredo-ainda'; // só acontece se o banco nunca subiu
}

async function salvar(valores) {
  for (const [chave] of CAMPOS) {
    if (!(chave in valores)) continue;
    const valor = valores[chave] == null ? '' : String(valores[chave]).trim();
    if (chave === 'smtp_senha' && !valor) continue; // senha em branco = manter a atual
    cache[chave] = valor || null;
    await query(
      'INSERT INTO config (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
      [chave, valor]
    );
  }
}

module.exports = { carregar, getConfigEmail, configurado, getSegredoRastreio, salvar };
