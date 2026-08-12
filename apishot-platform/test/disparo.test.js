const test = require('node:test');
const assert = require('node:assert/strict');
const { resolverCanhoes, montarPlano, sequenciaCanhoes, classificarErro } = require('../server/disparo');

test('classificarErro: HTTP 5xx e rate limit são transitórios; resto é permanente', () => {
  assert.equal(classificarErro('Error: HTTP 500'), 'transitorio');
  assert.equal(classificarErro('Error: HTTP 503'), 'transitorio');
  assert.equal(classificarErro('(#130429) Rate limit hit'), 'transitorio');
  assert.equal(classificarErro('please try again later'), 'transitorio');
  assert.equal(classificarErro('Error: HTTP 400 invalid number'), 'permanente');
  assert.equal(classificarErro('(#131026) Message undeliverable'), 'permanente');
  assert.equal(classificarErro(''), 'permanente');
});

test('montarPlano divide igual quando não há cota fixa', () => {
  const pool = [{ numeroId: 1 }, { numeroId: 2 }, { numeroId: 3 }];
  const { counts, soma, fora } = montarPlano(pool, 10);
  assert.deepEqual(counts.reduce((a, b) => a + b, 0), 10);
  assert.equal(soma, 10);
  assert.equal(fora, 0);
  // 10/3 = 3 resto 1 — o primeiro canhão leva a sobra
  assert.deepEqual(counts, [4, 3, 3]);
});

test('montarPlano respeita cota manual e divide o resto entre os livres', () => {
  const pool = [{ numeroId: 1 }, { numeroId: 2 }, { numeroId: 3 }];
  const { counts, soma } = montarPlano(pool, 10, { 1: 2 });
  assert.equal(counts[0], 2);
  assert.equal(counts[1] + counts[2], 8);
  assert.equal(soma, 10);
});

test('montarPlano não deixa lead de fora quando cotas fixas somam menos que o total', () => {
  const pool = [{ numeroId: 1 }, { numeroId: 2 }];
  const { soma, fora } = montarPlano(pool, 7, { 1: 1 });
  assert.equal(soma, 7);
  assert.equal(fora, 0);
});

test('montarPlano corta do fim quando cotas fixas somam mais que o total', () => {
  const pool = [{ numeroId: 1 }, { numeroId: 2 }];
  const { counts, soma } = montarPlano(pool, 5, { 1: 4, 2: 4 });
  assert.equal(soma, 5);
  assert.equal(counts[0] + counts[1], 5);
});

test('sequenciaCanhoes intercala em vez de esgotar um canhão primeiro', () => {
  const seq = sequenciaCanhoes([2, 1, 3]);
  assert.equal(seq.length, 6);
  assert.equal(seq.filter(k => k === 0).length, 2);
  assert.equal(seq.filter(k => k === 1).length, 1);
  assert.equal(seq.filter(k => k === 2).length, 3);
  // primeira rodada passa por todo mundo que tem saldo, na ordem
  assert.deepEqual(seq.slice(0, 3), [0, 1, 2]);
});

test('resolverCanhoes: número cuja WABA tem o template entra no modo auto', () => {
  const numerosMarcados = [{ id: 1, label: 'A', wabaId: 'w1' }];
  const grupo = { nome: 't', idioma: 'pt_BR', variantes: [{ waba: 'w1', components: [] }] };
  const { pool, skipped } = resolverCanhoes(numerosMarcados, grupo);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].modo, 'auto');
  assert.equal(skipped.length, 0);
});

test('resolverCanhoes: número sem o template e sem mapeamento manual é pulado', () => {
  const numerosMarcados = [{ id: 1, label: 'A', wabaId: 'w1' }, { id: 2, label: 'B', wabaId: 'w2' }];
  const grupo = { nome: 't', idioma: 'pt_BR', variantes: [{ waba: 'w1', components: [] }] };
  const { pool, skipped } = resolverCanhoes(numerosMarcados, grupo);
  assert.equal(pool.length, 1);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].numeroId, 2);
});

test('resolverCanhoes: mapeamento manual resgata número que não tem o template principal', () => {
  const numerosMarcados = [{ id: 2, label: 'B', wabaId: 'w2' }];
  const grupo = { nome: 't', idioma: 'pt_BR', variantes: [{ waba: 'w1', components: [] }] };
  const mapeamentoManual = { 2: { name: 'outro', language: 'pt_BR', components: [] } };
  const { pool, skipped } = resolverCanhoes(numerosMarcados, grupo, mapeamentoManual);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].modo, 'manual');
  assert.equal(skipped.length, 0);
});
