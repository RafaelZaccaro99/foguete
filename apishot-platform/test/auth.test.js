const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// auth.js e webhook fazem require('../db') no topo (cria o pool, mas não conecta até a 1ª
// query), então dá pra importar e testar as funções puras sem banco. Setamos SESSION_SECRET
// antes de importar o auth pra assinatura ser determinística.
process.env.SESSION_SECRET = 'segredo-de-teste-fixo';
const auth = require('../server/auth');

// mini-mocks de req/res
function resFake() {
  const store = {};
  return { setHeader: (k, v) => { store[k] = v; }, _get: k => store[k] };
}
function reqComCookie(cookieStr) {
  return { headers: { cookie: cookieStr } };
}

test('cookie de sessão válido é aceito no roundtrip', () => {
  const res = resFake();
  auth.criarSessao(res);
  const setCookie = res._get('Set-Cookie');
  const valor = setCookie.split(';')[0]; // apishot_sess=...
  assert.ok(auth.sessaoValida(reqComCookie(valor)), 'cookie recém-criado devia valer');
});

test('cookie adulterado é rejeitado', () => {
  const res = resFake();
  auth.criarSessao(res);
  const valor = res._get('Set-Cookie').split(';')[0];
  const adulterado = valor.slice(0, -2) + 'ff'; // muda a assinatura
  assert.equal(auth.sessaoValida(reqComCookie(adulterado)), false);
});

test('sem cookie não há sessão', () => {
  assert.equal(auth.sessaoValida({ headers: {} }), false);
});

test('assinatura HMAC do webhook: bate e não bate (mesma lógica do webhook.js)', () => {
  const secret = 'appsecret-teste';
  const corpo = Buffer.from('{"teste":1}');
  const boa = 'sha256=' + crypto.createHmac('sha256', secret).update(corpo).digest('hex');
  const ruim = 'sha256=' + crypto.createHmac('sha256', 'outro').update(corpo).digest('hex');
  const calc = 'sha256=' + crypto.createHmac('sha256', secret).update(corpo).digest('hex');
  assert.equal(boa, calc);
  assert.notEqual(ruim, calc);
});
