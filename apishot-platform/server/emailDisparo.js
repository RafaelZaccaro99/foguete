/**
 * Funções puras do disparo de email — validação, normalização de lista, montagem
 * do HTML (com variáveis, auto-link, pixel de abertura, rastreio de clique e
 * rodapé de descadastro) e assinatura dos links públicos de rastreio.
 * Nada aqui toca banco ou rede — tudo testável (test/email.test.js).
 */
const crypto = require('crypto');

// validação pragmática (não é o RFC inteiro): algo@algo.tld, sem espaços
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function emailValido(email) {
  return typeof email === 'string' && RE_EMAIL.test(email.trim());
}

/**
 * Recebe o texto colado na tela (uma entrada por linha: "email" ou "nome;email"
 * ou "email;nome" — detecta qual lado é o email) e devolve lista normalizada,
 * sem duplicados, com os inválidos separados pra mostrar na tela.
 */
function normalizarLista(texto) {
  const contatos = [];
  const invalidos = [];
  const vistos = new Set();
  for (const linhaCrua of String(texto || '').split(/\r?\n/)) {
    const linha = linhaCrua.trim();
    if (!linha) continue;
    const partes = linha.split(/[;,\t]/).map(p => p.trim()).filter(Boolean);
    let email = null, nome = null;
    for (const p of partes) {
      if (!email && emailValido(p)) email = p.toLowerCase();
      else if (!nome) nome = p;
    }
    if (!email) { invalidos.push(linha); continue; }
    if (vistos.has(email)) continue;
    vistos.add(email);
    contatos.push({ email, nome: nome || null });
  }
  return { contatos, invalidos };
}

// substitui {{nome}} (e {{email}}) no assunto/corpo — chaves desconhecidas ficam como estão
function renderizarVariaveis(texto, contato) {
  return String(texto || '')
    .replace(/\{\{\s*nome\s*\}\}/gi, contato.nome || '')
    .replace(/\{\{\s*email\s*\}\}/gi, contato.email || '');
}

const escapeHtml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Converte o corpo em texto puro pra um HTML simples de email: parágrafos por
 * linha em branco, <br> em quebra simples, URLs viram <a> (pra dar pra rastrear clique).
 */
function textoParaHtml(texto) {
  const paragrafos = String(texto || '').split(/\n\s*\n/);
  const html = paragrafos.map(p => {
    const comLinks = escapeHtml(p).replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1">$1</a>'
    );
    return '<p style="margin:0 0 16px;line-height:1.5">' + comLinks.replace(/\n/g, '<br>') + '</p>';
  }).join('');
  return html;
}

// ---------- assinatura dos links públicos (/e/…) ----------
// Formato: HMAC-SHA256(`${tipo}:${id}:${extra}`) — o extra é a URL de destino no
// clique (assim ninguém usa a rota de redirect como open-redirect) e vazio nos demais.
function assinarRastreio(segredo, tipo, id, extra = '') {
  return crypto.createHmac('sha256', String(segredo))
    .update(`${tipo}:${id}:${extra}`)
    .digest('hex').slice(0, 20);
}

function rastreioValido(segredo, tipo, id, assinatura, extra = '') {
  const esperada = assinarRastreio(segredo, tipo, id, extra);
  const a = Buffer.from(String(assinatura || ''));
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Prepara o HTML final de um envio: reescreve os links pra passar pelo redirect
 * de clique, injeta o pixel de abertura e o rodapé com o link de descadastro.
 * Sem baseUrl configurada, devolve o HTML como está (sem rastreio nem descadastro).
 */
function aplicarRastreio(html, { baseUrl, segredo, filaId }) {
  if (!baseUrl) return html;
  let resultado = String(html || '').replace(/href="([^"]+)"/g, (m, url) => {
    if (!/^https?:\/\//i.test(url)) return m; // mailto:, âncoras etc. ficam como estão
    const sig = assinarRastreio(segredo, 'clique', filaId, url);
    return `href="${baseUrl}/e/clique/${filaId}/${sig}?u=${encodeURIComponent(url)}"`;
  });
  const sigAbrir = assinarRastreio(segredo, 'abrir', filaId);
  resultado += `<img src="${baseUrl}/e/abrir/${filaId}/${sigAbrir}.gif" width="1" height="1" alt="" style="display:none">`;
  const sigDesc = assinarRastreio(segredo, 'descadastro', filaId);
  resultado += `<p style="margin:24px 0 0;font-size:12px;color:#8a8a8a">` +
    `Não quer mais receber estes emails? ` +
    `<a href="${baseUrl}/e/descadastro/${filaId}/${sigDesc}" style="color:#8a8a8a">Clique aqui pra se descadastrar</a>.</p>`;
  return resultado;
}

/**
 * Classifica erro de SMTP: transitório (re-tenta) vs permanente (marca falhou).
 * 4xx = temporário no protocolo SMTP; 5xx = permanente (caixa inexistente, bloqueio).
 * Erros de rede/conexão são transitórios.
 */
function classificarErroEmail(erro) {
  const code = erro && erro.responseCode;
  if (code >= 500) return 'permanente';
  if (code >= 400) return 'transitorio';
  const msg = String(erro && erro.message || erro || '').toLowerCase();
  if (/econn|etimedout|esocket|epipe|dns|getaddrinfo|greeting/.test(msg)) return 'transitorio';
  if (/invalid login|auth|credentials/.test(msg)) return 'permanente'; // re-tentar não resolve senha errada
  return 'transitorio';
}

module.exports = {
  emailValido, normalizarLista, renderizarVariaveis, textoParaHtml,
  assinarRastreio, rastreioValido, aplicarRastreio, classificarErroEmail,
};
