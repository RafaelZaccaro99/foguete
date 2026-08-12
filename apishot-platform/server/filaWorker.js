/**
 * Worker de disparo — roda em intervalo (chamado pelo setInterval em server.js).
 * Processa a fila de cada campanha 'em_andamento' respeitando compliance: só roda
 * dentro da janela de horário, tira quem está na lista de não-perturbe na hora,
 * reveza entre os canhões do pool pulando quem está pausado/RED/sem quota hoje —
 * quem é pulado fica 'pendente' pro próximo tick (ou pro dia seguinte), nunca é
 * cancelado.
 */
const { query } = require('./db');
const { horarioPermitidoAgora, estaNaListaNaoPerturbe, quotaRestante } = require('./compliance');
const { obterGruposTemplates } = require('./templatesCache');
const { enviarTemplate } = require('./graphApi');

async function concorrenciaConfigurada() {
  const cfg = await query("SELECT valor FROM config WHERE chave = 'disparo_concorrencia'");
  return parseInt(cfg[0]?.valor) || 8;
}

async function processarFilaDisparo() {
  if (!(await horarioPermitidoAgora())) return; // fora da janela — fica tudo pendente, não cancela

  const campanhas = await query("SELECT * FROM campanhas WHERE status = 'em_andamento'");
  if (!campanhas.length) return;

  const concorrencia = await concorrenciaConfigurada();
  const grupos = await obterGruposTemplates();

  for (const campanha of campanhas) {
    await processarCampanha(campanha, concorrencia, grupos);
  }
}

async function processarCampanha(campanha, concorrencia, grupos) {
  const pendentes = await query(
    "SELECT * FROM fila_disparo WHERE campanha_id = ? AND status = 'pendente' ORDER BY id LIMIT ?",
    [campanha.id, concorrencia * 4] // lote maior que a concorrência, dá margem pra pular bloqueados/sem quota
  );

  if (!pendentes.length) {
    await query(
      `UPDATE campanhas SET status = 'concluida'
       WHERE id = ? AND NOT EXISTS (SELECT 1 FROM fila_disparo WHERE campanha_id = ? AND status = 'pendente')`,
      [campanha.id, campanha.id]
    );
    return;
  }

  const grupo = grupos.find(g => g.nome === campanha.template_nome && g.idioma === campanha.template_idioma);
  const poolCache = new Map();
  const numeroCache = new Map();

  let enviosNesteTick = 0;
  for (const item of pendentes) {
    if (enviosNesteTick >= concorrencia) break;

    if (await estaNaListaNaoPerturbe(item.telefone)) {
      await query("UPDATE fila_disparo SET status='bloqueada', motivo='lista_nao_perturbe' WHERE id=?", [item.id]);
      continue;
    }

    let numero = numeroCache.get(item.numero_id);
    if (numero === undefined) {
      const rows = await query('SELECT * FROM numeros WHERE id = ?', [item.numero_id]);
      numero = rows[0] || null;
      numeroCache.set(item.numero_id, numero);
    }
    if (!numero || numero.status === 'pausado' || numero.quality_rating === 'RED') continue; // fica pendente

    const restante = await quotaRestante(numero);
    if (restante <= 0) continue; // sem cota hoje — fica pendente pro dia seguinte

    let poolRow = poolCache.get(item.numero_id);
    if (poolRow === undefined) {
      const rows = await query('SELECT * FROM campanha_numeros WHERE campanha_id = ? AND numero_id = ?', [campanha.id, item.numero_id]);
      poolRow = rows[0] || null;
      poolCache.set(item.numero_id, poolRow);
    }
    const variante = grupo?.variantes.find(v => v.waba === numero.waba_id);
    if (!variante) continue; // não deu pra confirmar o template desta conta agora (Meta instável) — fica pendente
    const template = poolRow?.modo === 'manual'
      ? { name: poolRow.template_nome, language: poolRow.template_idioma, components: variante.components }
      : { name: campanha.template_nome, language: campanha.template_idioma, components: variante.components };

    try {
      const r = await enviarTemplate(numero.phone_number_id, item.telefone, item.nome, template, {
        mediaId: poolRow?.media_id,
        mediaUrl: poolRow?.media_id ? undefined : campanha.media_url,
      });
      const wamid = r.messages?.[0]?.id || null;
      await query("UPDATE fila_disparo SET status='enviada', wamid=? WHERE id=?", [wamid, item.id]);
      await query(
        'INSERT INTO mensagens (wamid, campanha_id, numero_id, contato_telefone, direcao, texto, status, criado_em) VALUES (?, ?, ?, ?, "saida", ?, "enviada", NOW())',
        [wamid, campanha.id, numero.id, item.telefone, campanha.mensagem_corpo]
      );
      enviosNesteTick++;
    } catch (erro) {
      await query("UPDATE fila_disparo SET status='falhou', motivo=? WHERE id=?", [String(erro).slice(0, 60), item.id]);
      await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
        'erro_disparo_campanha', JSON.stringify({ campanha_id: campanha.id, telefone: item.telefone, erro: String(erro) }),
      ]);
    }
  }
}

module.exports = { processarFilaDisparo };
