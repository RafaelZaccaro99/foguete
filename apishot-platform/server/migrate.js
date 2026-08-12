/**
 * Migração idempotente de colunas — para quem já tinha o banco de uma versão anterior.
 *
 * `schema.sql` usa CREATE TABLE IF NOT EXISTS, então ele cria tabelas novas mas NÃO
 * adiciona colunas em tabelas que já existiam. Este script preenche essa lacuna: pra
 * cada coluna esperada, checa o information_schema e só faz o ALTER se ela faltar.
 * Roda em MySQL e MariaDB (não usa "ADD COLUMN IF NOT EXISTS", que é só do MariaDB).
 *
 * Seguro rodar sempre (fresh install ou update): num banco já atual, não faz nada.
 *   node server/migrate.js
 */
if (require.main === module) require('dotenv').config();
const { query } = require('./db');

// [tabela, coluna, definição] — colunas adicionadas depois do schema inicial do scaffold.
const COLUNAS = [
  ['contatos', 'qualificacao', "VARCHAR(30) NOT NULL DEFAULT 'novo'"],
  ['contatos', 'numero_id', 'INT NULL'],
  ['contatos', 'atualizado_em', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  ['campanhas', 'template_nome', 'VARCHAR(160)'],
  ['campanhas', 'template_idioma', 'VARCHAR(20)'],
  ['campanhas', 'categoria', 'VARCHAR(20)'],
  ['campanhas', 'mensagem_corpo', 'TEXT'],
  ['campanhas', 'media_url', 'VARCHAR(500) DEFAULT NULL'],
  ['campanhas', 'status', "ENUM('rascunho','em_andamento','pausada','concluida') NOT NULL DEFAULT 'rascunho'"],
  ['agentes', 'chave', 'VARCHAR(60) DEFAULT NULL'],
];

async function colunaExiste(tabela, coluna) {
  const rows = await query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [tabela, coluna]
  );
  return rows.length > 0;
}

async function tabelaExiste(tabela) {
  const rows = await query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
    [tabela]
  );
  return rows.length > 0;
}

async function migrate() {
  const aplicadas = [];
  for (const [tabela, coluna, definicao] of COLUNAS) {
    if (!(await tabelaExiste(tabela))) continue; // tabela nova é criada pelo schema.sql
    if (await colunaExiste(tabela, coluna)) continue;
    await query(`ALTER TABLE \`${tabela}\` ADD COLUMN \`${coluna}\` ${definicao}`);
    aplicadas.push(`${tabela}.${coluna}`);
  }
  return aplicadas;
}

if (require.main === module) {
  migrate()
    .then(a => { console.log(a.length ? 'colunas adicionadas: ' + a.join(', ') : 'banco já está atualizado (nada a migrar)'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { migrate };
