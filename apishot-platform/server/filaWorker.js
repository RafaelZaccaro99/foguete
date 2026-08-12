/**
 * Worker de disparo — roda em intervalo (chamado pelo setInterval em server.js).
 * Processa a fila de cada campanha 'em_andamento' respeitando compliance: só roda
 * dentro da janela de horário, tira quem está na lista de não-perturbe na hora,
 * reveza entre os canhões do pool pulando quem está pausado/RED/sem quota hoje.
 *
 * Melhorias de produção:
 *  - Reatribuição: contatos presos num número pausado/RED são remanejados pros
 *    números saudáveis do pool (não ficam parados pra sempre).
 *  - Envio paralelo por tick (respeitando a cota de cada número dentro do tick).
 *  - Retry: erro transitório (instabilidade/rate limit) re-tenta até o limite;
 *    só erro permanente marca 'falhou'.
 */
const { query } = require('./db');
const { horarioPermitidoAgora, estaNaListaNaoPerturbe, quotaRestante } = require('./compliance');
const { obterGruposTemplates } = require('./templatesCache');
const { enviarTemplate } = require('./graphApi');
const { classificarErro } = require('./disparo');

async function configInt(chave, padrao) {
  const cfg = await query('SELECT valor FROM config WHERE chave = ?', [chave]);
  return parseInt(cfg[0]?.valor) || padrao;
}

async function processarFilaDisparo() {
  if (!(await horarioPermitidoAgora())) return; // fora da janela — fica tudo pendente, não cancela

  const campanhas = await query("SELECT * FROM campanhas WHERE status = 'em_andamento'");
  if (!campanhas.length) return;

  const concorrencia = await configInt('disparo_concorrencia', 8);
  const maxTentativas = await configInt('disparo_max_tentativas', 3);
  const grupos = await obterGruposTemplates();

  for (const campanha of campanhas) {
    await processarCampanha(campanha, concorrencia, maxTentativas, grupos);
  }
}

// Um número está apto a disparar agora? (existe, não pausado, não RED)
function numeroApto(numero) {
  return numero && numero.status !== 'pausado' && numero.quality_rating !== 'RED';
}

// Reatribui pendentes cujo número está inapto pros números saudáveis do pool da campanha.
// Round-robin simples; só reatribui pra número que tem o template (auto ou mapeado).
async function reatribuirPresos(campanha, grupo) {
  const poolRows = await query('SELECT * FROM campanha_numeros WHERE campanha_id = ? ORDER BY ordem', [campanha.id]);
  if (poolRows.length < 2) return; // sem alternativa pra onde remanejar
  const numeros = await query(
    `SELECT n.* FROM numeros n JOIN campanha_numeros cn ON cn.numero_id = n.id WHERE cn.campanha_id = ?`,
    [campanha.id]
  );
  const porId = Object.fromEntries(numeros.map(n => [n.id, n]));
  const saudaveis = poolRows
    .map(p => porId[p.numero_id])
    .filter(n => numeroApto(n) && grupo?.variantes.some(v => v.waba === n.waba_id));
  if (!saudaveis.length) return; // ninguém saudável pra receber

  // pendentes cujo número atual está inapto
  const presos = await query(
    `SELECT f.id, f.numero_id FROM fila_disparo f
     WHERE f.campanha_id = ? AND f.status = 'pendente'`,
    [campanha.id]
  );
  let i = 0, movidos = 0;
  for (const p of presos) {
    if (numeroApto(porId[p.numero_id]) && grupo?.variantes.some(v => v.waba === porId[p.numero_id]?.waba_id)) continue;
    const destino = saudaveis[i % saudaveis.length];
    i++;
    await query('UPDATE fila_disparo SET numero_id = ? WHERE id = ?', [destino.id, p.id]);
    movidos++;
  }
  if (movidos) {
    await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
      'reatribuicao_contatos', JSON.stringify({ campanha_id: campanha.id, movidos }),
    ]);
  }
}

async function processarCampanha(campanha, concorrencia, maxTentativas, grupos) {
  const grupo = grupos.find(g => g.nome === campanha.template_nome && g.idioma === campanha.template_idioma);

  await reatribuirPresos(campanha, grupo);

  const pendentes = await query(
    "SELECT * FROM fila_disparo WHERE campanha_id = ? AND status = 'pendente' ORDER BY id LIMIT ?",
    [campanha.id, concorrencia * 4]
  );

  if (!pendentes.length) {
    await query(
      `UPDATE campanhas SET status = 'concluida'
       WHERE id = ? AND NOT EXISTS (SELECT 1 FROM fila_disparo WHERE campanha_id = ? AND status = 'pendente')`,
      [campanha.id, campanha.id]
    );
    return;
  }

  const numeroCache = new Map();
  const poolCache = new Map();
  const cotaRestanteTick = new Map(); // numero_id -> quantos ainda cabem hoje (decrementa no tick)

  async function carregarNumero(id) {
    if (!numeroCache.has(id)) {
      const rows = await query('SELECT * FROM numeros WHERE id = ?', [id]);
      numeroCache.set(id, rows[0] || null);
    }
    return numeroCache.get(id);
  }
  async function carregarPoolRow(id) {
    if (!poolCache.has(id)) {
      const rows = await query('SELECT * FROM campanha_numeros WHERE campanha_id = ? AND numero_id = ?', [campanha.id, id]);
      poolCache.set(id, rows[0] || null);
    }
    return poolCache.get(id);
  }

  // 1ª passada (sequencial, barata): seleciona os candidatos deste tick, aplicando
  // compliance e cota. Assim o envio em paralelo depois não estoura o limite diário.
  const aEnviar = [];
  for (const item of pendentes) {
    if (aEnviar.length >= concorrencia) break;

    if (await estaNaListaNaoPerturbe(item.telefone)) {
      await query("UPDATE fila_disparo SET status='bloqueada', motivo='lista_nao_perturbe' WHERE id=?", [item.id]);
      continue;
    }
    const numero = await carregarNumero(item.numero_id);
    if (!numeroApto(numero)) continue; // fica pendente (será reatribuído no próximo tick)

    if (!cotaRestanteTick.has(numero.id)) cotaRestanteTick.set(numero.id, await quotaRestante(numero));
    if (cotaRestanteTick.get(numero.id) <= 0) continue; // sem cota hoje

    const poolRow = await carregarPoolRow(item.numero_id);
    const variante = grupo?.variantes.find(v => v.waba === numero.waba_id);
    if (!variante) continue; // template não confirmado agora — fica pendente

    const template = poolRow?.modo === 'manual'
      ? { name: poolRow.template_nome, language: poolRow.template_idioma, components: variante.components }
      : { name: campanha.template_nome, language: campanha.template_idioma, components: variante.components };

    cotaRestanteTick.set(numero.id, cotaRestanteTick.get(numero.id) - 1);
    aEnviar.push({ item, numero, poolRow, template });
  }

  // 2ª passada: envia em paralelo.
  await Promise.all(aEnviar.map(({ item, numero, poolRow, template }) => enviarUm(campanha, item, numero, poolRow, template, maxTentativas)));
}

async function enviarUm(campanha, item, numero, poolRow, template, maxTentativas) {
  try {
    const extras = campanha.variaveis_extras ? campanha.variaveis_extras.split(';').map(s => s.trim()) : [];
    const r = await enviarTemplate(numero.phone_number_id, item.telefone, item.nome, template, {
      mediaId: poolRow?.media_id,
      mediaUrl: poolRow?.media_id ? undefined : campanha.media_url,
      extras,
    });
    const wamid = r.messages?.[0]?.id || null;
    await query("UPDATE fila_disparo SET status='enviada', wamid=? WHERE id=?", [wamid, item.id]);
    await query(
      'INSERT INTO mensagens (wamid, campanha_id, numero_id, contato_telefone, direcao, texto, status, criado_em) VALUES (?, ?, ?, ?, "saida", ?, "enviada", NOW())',
      [wamid, campanha.id, numero.id, item.telefone, campanha.mensagem_corpo]
    );
  } catch (erro) {
    const tipo = classificarErro(erro);
    const tentativas = (item.tentativas || 0) + 1;
    if (tipo === 'transitorio' && tentativas < maxTentativas) {
      // re-tenta no próximo tick — mantém pendente, só conta a tentativa
      await query("UPDATE fila_disparo SET tentativas=?, motivo=? WHERE id=?", [tentativas, 'retry_transitorio', item.id]);
    } else {
      await query("UPDATE fila_disparo SET status='falhou', tentativas=?, motivo=? WHERE id=?",
        [tentativas, String(erro).slice(0, 60), item.id]);
      await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
        'erro_disparo_campanha', JSON.stringify({ campanha_id: campanha.id, telefone: item.telefone, tipo, erro: String(erro) }),
      ]);
    }
  }
}

module.exports = { processarFilaDisparo };
