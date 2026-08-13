const { test } = require('node:test');
const assert = require('node:assert');
const {
  emailValido, normalizarLista, renderizarVariaveis, textoParaHtml,
  assinarRastreio, rastreioValido, aplicarRastreio, classificarErroEmail,
} = require('../server/emailDisparo');

test('emailValido aceita endereços normais e rejeita lixo', () => {
  assert.ok(emailValido('larissasilva@3pontoscompany.com.br'));
  assert.ok(emailValido('a.b+c@dominio.co'));
  assert.ok(!emailValido('sem-arroba.com'));
  assert.ok(!emailValido('a@b'));
  assert.ok(!emailValido('com espaco@x.com'));
  assert.ok(!emailValido(''));
  assert.ok(!emailValido(null));
});

test('normalizarLista entende "email", "nome;email" e "email;nome", dedupe e inválidos', () => {
  const { contatos, invalidos } = normalizarLista(
    'Farmácia Central;contato@central.com\n' +
    'drogaria@silva.com;Drogaria Silva\n' +
    'solto@x.com.br\n' +
    'CONTATO@central.com\n' +   // duplicado (case-insensitive)
    'linha sem email\n' +
    '\n'
  );
  assert.deepStrictEqual(contatos, [
    { email: 'contato@central.com', nome: 'Farmácia Central' },
    { email: 'drogaria@silva.com', nome: 'Drogaria Silva' },
    { email: 'solto@x.com.br', nome: null },
  ]);
  assert.deepStrictEqual(invalidos, ['linha sem email']);
});

test('renderizarVariaveis troca {{nome}} e {{email}}', () => {
  const c = { nome: 'Larissa', email: 'l@x.com' };
  assert.strictEqual(renderizarVariaveis('Oi {{nome}} ({{ email }})', c), 'Oi Larissa (l@x.com)');
  assert.strictEqual(renderizarVariaveis('Oi {{nome}}', { email: 'a@b.co' }), 'Oi ');
  assert.strictEqual(renderizarVariaveis('sem variavel {{outra}}', c), 'sem variavel {{outra}}');
});

test('textoParaHtml faz parágrafos, <br>, auto-link e escapa HTML', () => {
  const html = textoParaHtml('Linha 1\nLinha 2\n\nVeja https://x.com/a?b=1 <b>agora</b>');
  assert.ok(html.includes('Linha 1<br>Linha 2'));
  assert.ok(html.includes('<a href="https://x.com/a?b=1">'));
  assert.ok(html.includes('&lt;b&gt;agora&lt;/b&gt;'));
  assert.strictEqual((html.match(/<p /g) || []).length, 2);
});

test('assinatura de rastreio valida e rejeita adulteração', () => {
  const sig = assinarRastreio('segredo', 'clique', 42, 'https://destino.com');
  assert.ok(rastreioValido('segredo', 'clique', 42, sig, 'https://destino.com'));
  assert.ok(!rastreioValido('segredo', 'clique', 42, sig, 'https://outro.com'));   // trocou a URL
  assert.ok(!rastreioValido('segredo', 'clique', 43, sig, 'https://destino.com')); // trocou o id
  assert.ok(!rastreioValido('outro', 'clique', 42, sig, 'https://destino.com'));   // segredo errado
  assert.ok(!rastreioValido('segredo', 'abrir', 42, sig, 'https://destino.com'));  // tipo errado
});

test('aplicarRastreio reescreve links, injeta pixel e rodapé de descadastro', () => {
  const html = aplicarRastreio('<p><a href="https://lp.vendimais.digital/ifood">aqui</a></p>', {
    baseUrl: 'https://painel.x.com', segredo: 's', filaId: 7,
  });
  assert.ok(html.includes('https://painel.x.com/e/clique/7/'));
  assert.ok(html.includes(encodeURIComponent('https://lp.vendimais.digital/ifood')));
  assert.ok(html.includes('/e/abrir/7/'));
  assert.ok(html.includes('/e/descadastro/7/'));
  // sem baseUrl: devolve como está
  const cru = aplicarRastreio('<a href="https://x.com">a</a>', { baseUrl: '', segredo: 's', filaId: 7 });
  assert.strictEqual(cru, '<a href="https://x.com">a</a>');
  // mailto não é reescrito
  const mailto = aplicarRastreio('<a href="mailto:x@y.com">a</a>', { baseUrl: 'https://p.com', segredo: 's', filaId: 7 });
  assert.ok(mailto.includes('href="mailto:x@y.com"'));
});

test('classificarErroEmail: 5xx permanente, 4xx/rede transitório, auth permanente', () => {
  assert.strictEqual(classificarErroEmail({ responseCode: 550 }), 'permanente');
  assert.strictEqual(classificarErroEmail({ responseCode: 421 }), 'transitorio');
  assert.strictEqual(classificarErroEmail(new Error('connect ECONNREFUSED 1.2.3.4:465')), 'transitorio');
  assert.strictEqual(classificarErroEmail(new Error('Invalid login: 535 auth failed')), 'permanente');
  assert.strictEqual(classificarErroEmail(new Error('qualquer coisa')), 'transitorio');
});
