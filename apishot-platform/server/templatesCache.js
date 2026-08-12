/**
 * Cache curto (5 min) dos templates aprovados agrupados por nome+idioma — evita
 * bater na Graph API toda vez que a tela de disparo ou a criação de campanha
 * precisam saber quem tem qual template aprovado.
 */
const { query } = require('./db');
const { listarTemplatesDaWaba } = require('./graphApi');

const TTL_MS = 5 * 60 * 1000;
let cache = { ts: 0, dados: [] };

// Uma falha passageira na Graph API (rate limit, instabilidade da Meta) não pode travar
// quem depende disto (ex: o worker de disparo, que precisa continuar rodando a checagem
// de não-perturbe mesmo sem conseguir atualizar os templates agora). Por isso: cada WABA
// é tentada separadamente, e se a atualização inteira falhar, cai pro cache anterior
// (mesmo vencido) em vez de propagar o erro e derrubar quem chamou.
async function obterGruposTemplates(forcar = false) {
  if (!forcar && Date.now() - cache.ts < TTL_MS) return cache.dados;

  try {
    const numeros = await query('SELECT waba_id, label FROM numeros');
    const nomeWaba = {};
    const wabaIds = [];
    for (const n of numeros) {
      if (!nomeWaba[n.waba_id]) { nomeWaba[n.waba_id] = n.label; wabaIds.push(n.waba_id); }
    }

    let todos = [];
    for (const wabaId of wabaIds) {
      try {
        const tpls = await listarTemplatesDaWaba(wabaId, nomeWaba[wabaId]);
        todos = todos.concat(tpls.filter(t => t.status === 'APPROVED'));
      } catch (erro) {
        await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
          'erro_listar_templates_waba', JSON.stringify({ waba_id: wabaId, erro: String(erro) }),
        ]).catch(() => {});
      }
    }

    const grupos = {};
    for (const t of todos) {
      const chave = `${t.name}|${t.language}`;
      if (!grupos[chave]) grupos[chave] = { nome: t.name, idioma: t.language, categoria: t.category, variantes: [] };
      grupos[chave].variantes.push({ waba: t.__waba, wabaNome: t.__wabaName, components: t.components });
    }
    cache = { ts: Date.now(), dados: Object.values(grupos) };
    return cache.dados;
  } catch (erro) {
    console.error('Não deu pra atualizar o cache de templates, usando o último conhecido.', erro);
    return cache.dados;
  }
}

module.exports = { obterGruposTemplates };
