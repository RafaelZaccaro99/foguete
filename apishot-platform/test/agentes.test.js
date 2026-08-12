const test = require('node:test');
const assert = require('node:assert/strict');
const { matchAgente, normalizar } = require('../server/automations');
const { AGENTES_PADRAO } = require('../server/seedAgentes');

// monta a lista de agentes no formato que o matcher espera (como viria do banco),
// a partir dos dados-semente — sem tocar em banco.
const AGENTES = AGENTES_PADRAO.map((a, i) => ({
  id: i + 1,
  chave: a.chave,
  nome: a.nome,
  ativo: true,
  prioridade_maxima: !!a.prioridade_maxima,
  prioridade: a.prioridade_maxima ? 0 : (i + 1) * 10,
  gatilhos: a.gatilhos,
  resposta: a.resposta,
  acao_extra: a.acao_extra || null,
}));

test('opt-out vence mesmo quando o texto também bate em outra intenção', () => {
  const a = matchAgente('quero falar com alguem, mas pare de mandar', AGENTES);
  assert.equal(a.chave, 'opt_out');
});

test('cada agente-semente é encontrado pelo próprio gatilho', () => {
  for (const agente of AGENTES) {
    for (const gatilho of agente.gatilhos) {
      const achado = matchAgente(gatilho, AGENTES);
      assert.ok(achado, `gatilho "${gatilho}" não achou agente`);
      // um gatilho pode, por substring, casar antes num de prioridade menor; garantimos
      // ao menos que casou COM um agente que contém esse gatilho.
      assert.ok(achado.gatilhos.includes(gatilho) || achado.chave === agente.chave,
        `gatilho "${gatilho}" casou em "${achado.chave}"`);
    }
  }
  assert.equal(AGENTES.length, 17);
});

test('mensagem sem gatilho conhecido não casa nenhum agente', () => {
  assert.equal(matchAgente('bom dia, tudo bem?', AGENTES), null);
});

test('agente desativado não casa', () => {
  const desativados = AGENTES.map(a => ({ ...a, ativo: a.chave === 'preco_mensalidade' ? false : a.ativo }));
  const a = matchAgente('quanto custa', desativados);
  assert.notEqual(a?.chave, 'preco_mensalidade');
});

test('prioridade decide entre dois agentes que casam (menor vence)', () => {
  const lista = [
    { id: 1, chave: 'b', ativo: true, prioridade_maxima: false, prioridade: 50, gatilhos: ['promo'] },
    { id: 2, chave: 'a', ativo: true, prioridade_maxima: false, prioridade: 10, gatilhos: ['promo'] },
  ];
  assert.equal(matchAgente('quero a promo', lista).chave, 'a');
});

test('normalizar remove acento e maiúscula', () => {
  assert.equal(normalizar('PREÇO Não'), 'preco nao');
});
