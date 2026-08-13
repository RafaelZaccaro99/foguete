const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { separarComandos } = require('../server/bootstrap');

test('separarComandos ignora comentários e não quebra o schema real', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const comandos = separarComandos(sql);

  assert.ok(comandos.length > 5, 'o schema tem vários comandos');
  for (const cmd of comandos) {
    assert.ok(!cmd.startsWith('--'), `comando começando com comentário: ${cmd.slice(0, 40)}`);
    assert.ok(/^(CREATE|INSERT|ALTER|DROP|SET)/i.test(cmd), `comando inesperado: ${cmd.slice(0, 40)}`);
  }
  // todas as tabelas do schema precisam ser criadas de forma idempotente
  const creates = comandos.filter(c => /^CREATE TABLE/i.test(c));
  for (const c of creates) assert.match(c, /CREATE TABLE IF NOT EXISTS/i);
});

test('separarComandos: ponto e vírgula dentro de string ou comentário não separa comando', () => {
  const sql = `
    -- um comentário com ponto e vírgula; não pode separar nada
    INSERT INTO config (chave, valor) VALUES ('horario', '08:00; 20:00');
    /* bloco; também com ponto e vírgula */
    SELECT 1;
  `;
  const comandos = separarComandos(sql);
  assert.strictEqual(comandos.length, 2);
  assert.match(comandos[0], /^INSERT INTO config/);
  assert.ok(comandos[0].includes("'08:00; 20:00'"), 'a string ficou inteira');
  assert.strictEqual(comandos[1], 'SELECT 1');
});

test('separarComandos preserva aspas escapadas', () => {
  const comandos = separarComandos("INSERT INTO t (a) VALUES ('não; \\' ainda na string'); SELECT 2;");
  assert.strictEqual(comandos.length, 2);
  assert.strictEqual(comandos[1], 'SELECT 2');
});
