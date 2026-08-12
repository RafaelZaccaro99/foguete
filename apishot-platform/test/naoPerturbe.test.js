const test = require('node:test');
const assert = require('node:assert/strict');
const { scrubTelefones } = require('../server/disparo');

test('scrubTelefones remove quem está no set de bloqueados e conta certo', () => {
  const contatos = [
    { telefone: '5511111111111', nome: 'A' },
    { telefone: '5522222222222', nome: 'B' },
    { telefone: '5533333333333', nome: 'C' },
  ];
  const bloqueados = new Set(['5522222222222']);
  const { filtrados, removidos } = scrubTelefones(contatos, bloqueados);
  assert.equal(removidos, 1);
  assert.equal(filtrados.length, 2);
  assert.ok(!filtrados.some(c => c.telefone === '5522222222222'));
});

test('scrubTelefones não remove nada quando o set está vazio', () => {
  const contatos = [{ telefone: '551', nome: 'A' }, { telefone: '552', nome: 'B' }];
  const { filtrados, removidos } = scrubTelefones(contatos, new Set());
  assert.equal(removidos, 0);
  assert.equal(filtrados.length, 2);
});

test('scrubTelefones remove todos quando todos estão bloqueados', () => {
  const contatos = [{ telefone: '551' }, { telefone: '552' }];
  const { filtrados, removidos } = scrubTelefones(contatos, new Set(['551', '552']));
  assert.equal(removidos, 2);
  assert.equal(filtrados.length, 0);
});
