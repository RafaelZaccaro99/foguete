const test = require('node:test');
const assert = require('node:assert/strict');
const { percentualAquecimento } = require('../server/compliance');

test('percentualAquecimento segue a curva por semana desde a conexão', () => {
  const curva = [20, 40, 70, 100];
  assert.equal(percentualAquecimento(0, curva), 0.20);   // dia 0 — semana 1
  assert.equal(percentualAquecimento(6, curva), 0.20);   // ainda semana 1
  assert.equal(percentualAquecimento(7, curva), 0.40);   // semana 2
  assert.equal(percentualAquecimento(14, curva), 0.70);  // semana 3
  assert.equal(percentualAquecimento(21, curva), 1.00);  // semana 4 — fim da curva
});

test('percentualAquecimento não passa do último valor da curva mesmo depois de muito tempo', () => {
  const curva = [20, 40, 70, 100];
  assert.equal(percentualAquecimento(365, curva), 1.00);
});

test('percentualAquecimento nunca fica negativo mesmo com dias negativos', () => {
  const curva = [20, 40, 70, 100];
  assert.equal(percentualAquecimento(-5, curva), 0.20);
});
