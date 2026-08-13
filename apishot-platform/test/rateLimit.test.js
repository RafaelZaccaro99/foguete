const test = require('node:test');
const assert = require('node:assert');
const { criarFreio } = require('../server/rateLimit');
const { conferir } = require('../server/env');

function fingirRequisicao(ip = '1.2.3.4') {
  const res = {
    locals: {}, statusCode: null, corpo: null, headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.corpo = o; return this; },
  };
  return [{ ip, socket: {} }, res];
}

test('freio: só bloqueia depois do limite de falhas, e o acerto zera o contador', () => {
  const freio = criarFreio({ maxTentativas: 3, janelaMs: 60_000 });

  for (let i = 0; i < 3; i++) {
    const [req, res] = fingirRequisicao();
    let passou = false;
    freio(req, res, () => { passou = true; });
    assert.ok(passou, `tentativa ${i + 1} deveria passar`);
    res.locals.registrarFalha();
  }

  // 4ª tentativa: bloqueada
  const [req, res] = fingirRequisicao();
  let passou = false;
  freio(req, res, () => { passou = true; });
  assert.ok(!passou, 'deveria bloquear depois de 3 falhas');
  assert.strictEqual(res.statusCode, 429);
  assert.ok(res.headers['Retry-After'], 'informa quando tentar de novo');

  // outro IP não é afetado
  const [req2, res2] = fingirRequisicao('9.9.9.9');
  let passou2 = false;
  freio(req2, res2, () => { passou2 = true; });
  assert.ok(passou2, 'o bloqueio é por IP');
  res2.locals.limparFalhas();
});

test('freio: acertar a senha limpa as falhas acumuladas', () => {
  const freio = criarFreio({ maxTentativas: 2, janelaMs: 60_000 });
  const [req1, res1] = fingirRequisicao('5.5.5.5');
  freio(req1, res1, () => {});
  res1.locals.registrarFalha();

  const [req2, res2] = fingirRequisicao('5.5.5.5');
  freio(req2, res2, () => {});
  res2.locals.limparFalhas(); // acertou

  const [req3, res3] = fingirRequisicao('5.5.5.5');
  let passou = false;
  freio(req3, res3, () => { passou = true; });
  assert.ok(passou, 'depois de acertar, o contador volta do zero');
});

test('conferir: em produção, configuração insegura vira erro (e não sobe)', () => {
  const original = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: 'production',
    DB_NAME: 'apishot', DB_USER: 'u', DB_PASS: 'p', DB_HOST: 'localhost',
    SESSION_SECRET: 'troque-esse-segredo-no-env',
    VERIFY_TOKEN: 'abc',
  });
  delete process.env.META_APP_SECRET;

  const { erros } = conferir();
  assert.ok(erros.some(e => e.includes('SESSION_SECRET')), 'segredo de exemplo é erro');
  assert.ok(erros.some(e => e.includes('META_APP_SECRET')), 'webhook sem assinatura é erro');

  process.env.SESSION_SECRET = 'a'.repeat(64);
  process.env.META_APP_SECRET = 'segredo-do-app';
  assert.deepStrictEqual(conferir().erros, [], 'configuração completa não acusa erro');

  for (const k of Object.keys(process.env)) if (!(k in original)) delete process.env[k];
  Object.assign(process.env, original);
});
