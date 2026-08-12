const test = require('node:test');
const assert = require('node:assert/strict');
const { AUTOMACOES, encontrarAutomacao } = require('../server/automations');

test('opt-out vence mesmo quando o texto também bate em outra automação', () => {
  // "quero falar com alguem, pode parar de mandar" bate em atendente_humano E em opt_out
  const auto = encontrarAutomacao('quero falar com alguem, mas pare de mandar');
  assert.equal(auto.id, 'opt_out');
});

test('cada uma das 17 automações é encontrada pelo próprio gatilho', () => {
  for (const auto of AUTOMACOES) {
    for (const gatilho of auto.gatilhos) {
      const encontrada = encontrarAutomacao(gatilho);
      assert.ok(encontrada, `gatilho "${gatilho}" não encontrou nenhuma automação`);
      assert.equal(encontrada.id, auto.id, `gatilho "${gatilho}" encontrou "${encontrada.id}" em vez de "${auto.id}"`);
    }
  }
  assert.equal(AUTOMACOES.length, 17);
});

test('mensagem sem gatilho conhecido não encontra automação', () => {
  assert.equal(encontrarAutomacao('bom dia, tudo bem?'), null);
});

test('normalização ignora acento e maiúscula/minúscula', () => {
  const auto = encontrarAutomacao('QUANTO CUSTA, tem MENSALIDADE?');
  assert.equal(auto.id, 'preco_mensalidade');
});
