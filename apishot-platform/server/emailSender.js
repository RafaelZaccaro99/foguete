/**
 * Envio SMTP num lugar só (equivalente ao graphApi.js do WhatsApp).
 * O transporte é recriado quando a config muda (a tela salva → invalidar()).
 * Funciona com qualquer SMTP: Hostinger (smtp.hostinger.com:465 seguro),
 * Gmail com senha de app (smtp.gmail.com:465), Brevo, etc.
 */
const nodemailer = require('nodemailer');
const { getConfigEmail, configurado } = require('./emailStore');

let transporte = null;
let chaveTransporte = null; // detecta mudança de config sem precisar de evento

function obterTransporte() {
  const c = getConfigEmail();
  const chave = [c.host, c.porta, c.usuario, c.senha, c.seguro].join('|');
  if (!transporte || chave !== chaveTransporte) {
    transporte = nodemailer.createTransport({
      host: c.host,
      port: c.porta,
      secure: c.seguro || c.porta === 465,
      auth: { user: c.usuario, pass: c.senha },
      connectionTimeout: 15000,
      socketTimeout: 30000,
    });
    chaveTransporte = chave;
  }
  return transporte;
}

function invalidar() {
  transporte = null;
  chaveTransporte = null;
}

/** Envia um email. `texto` é o fallback texto-puro do `html`. */
async function enviarEmail({ para, assunto, html, texto }) {
  if (!configurado()) throw new Error('smtp_nao_configurado');
  const c = getConfigEmail();
  const from = c.remetenteNome ? `"${c.remetenteNome.replace(/"/g, '')}" <${c.remetente}>` : c.remetente;
  const info = await obterTransporte().sendMail({
    from,
    to: para,
    subject: assunto,
    html,
    text: texto,
  });
  return info.messageId || null;
}

/** Valida a config atual abrindo conexão com o servidor SMTP (sem enviar nada). */
async function verificarConexao() {
  if (!configurado()) throw new Error('smtp_nao_configurado');
  await obterTransporte().verify();
  return true;
}

module.exports = { enviarEmail, verificarConexao, invalidar };
