/**
 * Rotas públicas do email (montadas em /e — SEM login, como o /webhook):
 * o destinatário do email acessa estes links. A proteção é a assinatura HMAC
 * embutida em cada link (ver emailDisparo.assinarRastreio) — sem assinatura
 * válida a rota responde 404, então não dá pra enumerar ids nem usar o
 * redirect de clique como open-redirect.
 */
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const asyncHandler = require('../asyncHandler');
const { getSegredoRastreio } = require('../emailStore');
const { rastreioValido } = require('../emailDisparo');

// gif transparente 1x1 (pixel de abertura)
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// abertura: marca aberto_em na primeira vez e devolve o pixel
router.get('/abrir/:id/:sig.gif', asyncHandler(async (req, res) => {
  const { id, sig } = req.params;
  if (rastreioValido(getSegredoRastreio(), 'abrir', id, sig)) {
    await query('UPDATE email_fila SET aberto_em = COALESCE(aberto_em, NOW()) WHERE id = ?', [id]);
  }
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store');
  res.send(GIF); // pixel sempre responde — não denuncia se o link era válido
}));

// clique: marca clicado_em (e aberto_em — quem clicou abriu) e redireciona pro destino
router.get('/clique/:id/:sig', asyncHandler(async (req, res) => {
  const { id, sig } = req.params;
  const destino = String(req.query.u || '');
  if (!rastreioValido(getSegredoRastreio(), 'clique', id, sig, destino)) return res.sendStatus(404);
  await query(
    'UPDATE email_fila SET clicado_em = COALESCE(clicado_em, NOW()), aberto_em = COALESCE(aberto_em, NOW()) WHERE id = ?',
    [id]
  );
  res.redirect(302, destino);
}));

// descadastro: adiciona o email da fila na lista e confirma numa página simples
router.get('/descadastro/:id/:sig', asyncHandler(async (req, res) => {
  const { id, sig } = req.params;
  if (!rastreioValido(getSegredoRastreio(), 'descadastro', id, sig)) return res.sendStatus(404);
  const rows = await query('SELECT email FROM email_fila WHERE id = ?', [id]);
  if (rows[0]) {
    await query(
      "INSERT INTO email_descadastro (email, origem) VALUES (?, 'link_descadastro') ON DUPLICATE KEY UPDATE origem = origem",
      [rows[0].email]
    );
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(
    '<!doctype html><meta charset="utf-8"><title>Descadastrado</title>' +
    '<body style="font-family:sans-serif;display:grid;place-items:center;min-height:90vh">' +
    '<div style="text-align:center"><h2>Pronto, você foi removido da lista. ✅</h2>' +
    '<p>Você não vai mais receber emails nossos.</p></div>'
  );
}));

module.exports = router;
