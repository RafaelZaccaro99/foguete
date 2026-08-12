const express = require('express');
const router = express.Router();
const { senhaConfere, definirSenha, criarSessao, limparSessao, sessaoValida } = require('../auth');
const asyncHandler = require('../asyncHandler');

router.get('/status', (req, res) => {
  res.json({ autenticado: sessaoValida(req) });
});

router.post('/login', asyncHandler(async (req, res) => {
  const { senha } = req.body;
  if (await senhaConfere(senha)) {
    criarSessao(res);
    return res.json({ ok: true });
  }
  res.status(401).json({ erro: 'senha incorreta' });
}));

router.post('/logout', (req, res) => {
  limparSessao(res);
  res.json({ ok: true });
});

// trocar senha — exige estar logado e confirmar a senha atual
router.post('/senha', asyncHandler(async (req, res) => {
  if (!sessaoValida(req)) return res.status(401).json({ erro: 'nao_autenticado' });
  const { atual, nova } = req.body;
  if (!nova || nova.length < 6) return res.status(400).json({ erro: 'a nova senha precisa ter ao menos 6 caracteres' });
  if (!(await senhaConfere(atual))) return res.status(401).json({ erro: 'senha atual incorreta' });
  await definirSenha(nova);
  criarSessao(res); // renova o cookie
  res.json({ ok: true });
}));

module.exports = router;
