const express = require('express');
const router = express.Router();
const { getToken, setToken, origem } = require('../tokenStore');
const { gapi } = require('../graphApi');
const asyncHandler = require('../asyncHandler');

// status do token — NUNCA devolve o token inteiro, só mascarado.
router.get('/token-status', asyncHandler(async (req, res) => {
  const t = getToken();
  const org = await origem();
  res.json({
    configurado: !!t,
    origem: org, // 'config' (salvo na tela) | 'env' (.env) | null
    preview: t ? '…' + String(t).slice(-6) : null,
  });
}));

// salva o token (vai pro banco, fica no servidor). Opcionalmente valida antes.
router.post('/token', asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token || !token.trim()) return res.status(400).json({ erro: 'informe o token' });
  await setToken(token.trim());
  res.status(201).json({ ok: true });
}));

// testa um token contra a Graph API (/me) sem precisar salvar — usa o informado
// ou, se nenhum vier, o que já está configurado.
router.post('/testar-token', asyncHandler(async (req, res) => {
  const token = (req.body.token && req.body.token.trim()) || getToken();
  if (!token) return res.status(400).json({ erro: 'nenhum token pra testar' });
  try {
    const me = await gapi('/me', token);
    res.json({ ok: true, nome: me.name || me.id });
  } catch (erro) {
    res.status(400).json({ ok: false, erro: String(erro) });
  }
}));

module.exports = router;
