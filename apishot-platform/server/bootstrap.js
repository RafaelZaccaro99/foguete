/**
 * Preparo do banco no boot — o passo que antes era manual (phpMyAdmin + SSH) e que é
 * onde todo deploy quebrava: subia o app com o banco vazio e tudo estourava em 500.
 *
 * Faz, nesta ordem e de forma idempotente:
 *   1. espera o MySQL responder (container/serviço pode subir depois do app);
 *   2. aplica o schema.sql (CREATE TABLE IF NOT EXISTS — não apaga nada);
 *   3. roda as migrações de coluna (server/migrate.js);
 *   4. carrega os agentes-padrão se a tabela estiver vazia (server/seedAgentes.js);
 *   5. confere se dá pra logar no painel (hash salvo ou PAINEL_SENHA no ambiente).
 *
 * Rodar de novo num banco já pronto não muda nada. Dá pra desligar com
 * BOOTSTRAP_DB=false (quem prefere aplicar schema/migração na mão).
 *
 * Também roda sozinho, sem subir o servidor:  node server/bootstrap.js
 */
if (require.main === module) require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, query } = require('./db');
const { migrate } = require('./migrate');
const { seed } = require('./seedAgentes');

const SCHEMA = path.join(__dirname, '..', 'schema.sql');

/**
 * Quebra um arquivo .sql em comandos. Precisa ser um mini-parser (e não um split(';'))
 * porque o schema tem comentários `--` e strings com vírgula/dois-pontos; um `;` dentro
 * de aspas ou de comentário não pode virar separador.
 */
function separarComandos(sql) {
  const comandos = [];
  let atual = '';
  let aspas = null;          // qual aspa abriu a string atual (' " `)
  let comentarioLinha = false;
  let comentarioBloco = false;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const prox = sql[i + 1];

    if (comentarioLinha) {
      if (c === '\n') { comentarioLinha = false; atual += c; }
      continue;
    }
    if (comentarioBloco) {
      if (c === '*' && prox === '/') { comentarioBloco = false; i++; }
      continue;
    }
    if (aspas) {
      atual += c;
      if (c === '\\') { atual += prox ?? ''; i++; continue; } // escape: pula o próximo
      if (c === aspas) aspas = null;
      continue;
    }
    if (c === '-' && prox === '-') { comentarioLinha = true; i++; continue; }
    if (c === '#') { comentarioLinha = true; continue; }
    if (c === '/' && prox === '*') { comentarioBloco = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { aspas = c; atual += c; continue; }
    if (c === ';') { comandos.push(atual); atual = ''; continue; }
    atual += c;
  }
  comandos.push(atual);
  return comandos.map(s => s.trim()).filter(Boolean);
}

/** Espera o MySQL aceitar conexão (tentativas com espera crescente, até ~1 min). */
async function esperarBanco(tentativas = 15) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      await query('SELECT 1');
      return;
    } catch (erro) {
      if (i === tentativas) throw erro;
      const espera = Math.min(1000 * i, 5000);
      console.log(`banco ainda não respondeu (${erro.code || erro.message}) — nova tentativa em ${espera / 1000}s`);
      await new Promise(r => setTimeout(r, espera));
    }
  }
}

async function aplicarSchema() {
  const sql = fs.readFileSync(SCHEMA, 'utf8');
  const comandos = separarComandos(sql);
  for (const cmd of comandos) await query(cmd);
  return comandos.length;
}

/** Sem isso ninguém entra no painel — e o sintoma ("senha incorreta") não explica nada. */
async function conferirAcessoPainel() {
  const r = await query("SELECT valor FROM config WHERE chave = 'painel_senha_hash'").catch(() => []);
  if (r[0]?.valor) return;
  if (!process.env.PAINEL_SENHA) {
    throw new Error(
      'Nenhuma senha de painel definida: não há hash salvo no banco e PAINEL_SENHA não está no ambiente. ' +
      'Defina PAINEL_SENHA para o primeiro login (depois dá pra trocar pela tela).'
    );
  }
}

async function bootstrap() {
  await esperarBanco();
  const comandos = await aplicarSchema();
  const colunas = await migrate();
  const agentes = await seed();
  await conferirAcessoPainel();
  return { comandos, colunas, agentes };
}

if (require.main === module) {
  bootstrap()
    .then(r => {
      console.log(`banco pronto: ${r.comandos} comandos do schema aplicados,`,
        r.colunas.length ? `colunas adicionadas: ${r.colunas.join(', ')},` : 'nenhuma coluna a migrar,',
        r.agentes.pulado ? `agentes já carregados (${r.agentes.total})` : `${r.agentes.criados} agentes criados`);
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { bootstrap, separarComandos, esperarBanco };
