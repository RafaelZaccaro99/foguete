const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });
const { query } = require('../db');
const { resolverCanhoes, montarPlano, sequenciaCanhoes, scrubTelefones } = require('../disparo');
const { obterGruposTemplates } = require('../templatesCache');
const { uploadMedia, enviarTemplate } = require('../graphApi');
const asyncHandler = require('../asyncHandler');

// Cria a campanha e resolve o pool de canhões (revezamento) pro template escolhido —
// equivalente ao "resolverCanhoes" do Foguete antigo, gravado em campanha_numeros.
router.post('/', asyncHandler(async (req, res) => {
  const { nome, template_nome, template_idioma, numeros_marcados, mapeamento_manual = {}, cotas_manuais = {}, media_url = null, variaveis_extras = null } = req.body;
  if (!nome || !template_nome || !template_idioma || !Array.isArray(numeros_marcados) || !numeros_marcados.length) {
    return res.status(400).json({ erro: 'informe nome, template_nome, template_idioma e numeros_marcados' });
  }

  const grupos = await obterGruposTemplates();
  const grupo = grupos.find(g => g.nome === template_nome && g.idioma === template_idioma);
  if (!grupo) return res.status(404).json({ erro: 'template não encontrado — rode a sincronização de números/templates' });

  const placeholders = numeros_marcados.map(() => '?').join(',');
  const numerosRows = await query(
    `SELECT * FROM numeros WHERE id IN (${placeholders}) AND status IN ('ativo','aquecendo')`,
    numeros_marcados
  );
  const numerosPlanos = numerosRows.map(n => ({ id: n.id, label: n.label, wabaId: n.waba_id }));

  const mapeamentoResolvido = {};
  for (const [numeroId, escolha] of Object.entries(mapeamento_manual || {})) {
    const numero = numerosRows.find(n => String(n.id) === String(numeroId));
    if (!numero || !escolha) continue;
    const grupoAlt = grupos.find(g => g.nome === escolha.nome && g.idioma === escolha.idioma);
    const variante = grupoAlt?.variantes.find(v => v.waba === numero.waba_id);
    if (variante) mapeamentoResolvido[numeroId] = { name: escolha.nome, language: escolha.idioma, components: variante.components };
  }

  const { pool, skipped } = resolverCanhoes(numerosPlanos, grupo, mapeamentoResolvido);
  if (!pool.length) {
    return res.status(400).json({ erro: 'nenhum número marcado consegue disparar este template', skipped });
  }

  const corpo = (grupo.variantes[0].components || []).find(c => c.type === 'BODY')?.text || '';
  const r = await query(
    'INSERT INTO campanhas (nome, template_nome, template_idioma, categoria, mensagem_corpo, media_url, variaveis_extras, status) VALUES (?, ?, ?, ?, ?, ?, ?, "rascunho")',
    [nome, grupo.nome, grupo.idioma, grupo.categoria, corpo, media_url || null, variaveis_extras || null]
  );
  const campanhaId = r.insertId;

  let ordem = 0;
  for (const c of pool) {
    await query(
      'INSERT INTO campanha_numeros (campanha_id, numero_id, template_nome, template_idioma, modo, cota_manual, ordem) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [campanhaId, c.numeroId, c.template.name, c.template.language, c.modo, cotas_manuais[c.numeroId] ?? null, ordem++]
    );
  }

  res.status(201).json({
    id: campanhaId,
    pool: pool.map(c => ({ numero_id: c.numeroId, label: c.label, modo: c.modo })),
    skipped,
  });
}));

router.get('/', asyncHandler(async (req, res) => {
  const campanhas = await query('SELECT * FROM campanhas ORDER BY criado_em DESC');
  res.json(campanhas);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const rows = await query('SELECT * FROM campanhas WHERE id = ?', [req.params.id]);
  const campanha = rows[0];
  if (!campanha) return res.sendStatus(404);
  const contadores = await query(
    'SELECT status, COUNT(*) AS total FROM fila_disparo WHERE campanha_id = ? GROUP BY status',
    [campanha.id]
  );
  const resumo = { pendente: 0, enviada: 0, bloqueada: 0, falhou: 0 };
  contadores.forEach(c => { resumo[c.status] = c.total; });
  res.json({ ...campanha, contadores: resumo });
}));

// Recebe a lista já normalizada no navegador ([{nome, telefone}]) e enfileira —
// dedupe contra quem já recebeu (equivalente ao "skipSent" do localStorage antigo,
// agora em banco) e distribui entre os canhões do pool (montarPlano + sequenciaCanhoes).
router.post('/:id/contatos', asyncHandler(async (req, res) => {
  const { contatos, ignorar_ja_enviados = true } = req.body;
  if (!Array.isArray(contatos) || !contatos.length) {
    return res.status(400).json({ erro: 'informe contatos: [{nome, telefone}]' });
  }

  const campanhas = await query('SELECT * FROM campanhas WHERE id = ?', [req.params.id]);
  const campanha = campanhas[0];
  if (!campanha) return res.sendStatus(404);

  const poolRows = await query('SELECT * FROM campanha_numeros WHERE campanha_id = ? ORDER BY ordem', [campanha.id]);
  if (!poolRows.length) return res.status(400).json({ erro: 'campanha sem pool de números resolvido' });

  let filtrados = contatos;
  let jaEnviados = 0;
  if (ignorar_ja_enviados) {
    const telefones = contatos.map(c => c.telefone);
    const placeholders = telefones.map(() => '?').join(',');
    const enviados = await query(
      `SELECT DISTINCT contato_telefone FROM mensagens WHERE direcao='saida' AND contato_telefone IN (${placeholders})`,
      telefones
    );
    const setEnviados = new Set(enviados.map(e => e.contato_telefone));
    const r = scrubTelefones(filtrados, setEnviados);
    filtrados = r.filtrados;
    jaEnviados = r.removidos;
  }

  // scrub da lista de não-perturbe (opt-out, denúncia, exclusão importada) — remove
  // upfront quem não pode receber, além da checagem que o worker já faz por segurança.
  let removidosNaoPerturbe = 0;
  if (filtrados.length) {
    const telefones = filtrados.map(c => c.telefone);
    const placeholders = telefones.map(() => '?').join(',');
    const bloqueados = await query(
      `SELECT telefone FROM nao_perturbe WHERE telefone IN (${placeholders})`,
      telefones
    );
    const setBloqueados = new Set(bloqueados.map(b => b.telefone));
    const r = scrubTelefones(filtrados, setBloqueados);
    filtrados = r.filtrados;
    removidosNaoPerturbe = r.removidos;
  }

  const pool = poolRows.map(p => ({ numeroId: p.numero_id }));
  const cotasManuais = {};
  poolRows.forEach(p => { if (p.cota_manual !== null) cotasManuais[p.numero_id] = p.cota_manual; });

  const { counts, soma, fora } = montarPlano(pool, filtrados.length, cotasManuais);
  const seq = sequenciaCanhoes(counts);
  const fila = filtrados.slice(0, seq.length);

  for (let i = 0; i < fila.length; i++) {
    const numeroId = pool[seq[i]].numeroId;
    await query(
      'INSERT INTO fila_disparo (campanha_id, telefone, nome, status, numero_id) VALUES (?, ?, ?, "pendente", ?)',
      [campanha.id, fila[i].telefone, fila[i].nome || null, numeroId]
    );
  }

  res.status(201).json({
    enfileirados: fila.length,
    ja_enviados_ignorados: jaEnviados,
    removidos_nao_perturbe: removidosNaoPerturbe,
    fora_do_plano: fora,
    planejado: soma,
  });
}));

// Sobe o arquivo de mídia (header do template) pra cada canhão do pool.
router.post('/:id/media', upload.single('arquivo'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'envie o arquivo no campo "arquivo"' });
  const poolRows = await query(
    'SELECT cn.*, n.phone_number_id FROM campanha_numeros cn JOIN numeros n ON n.id = cn.numero_id WHERE cn.campanha_id = ?',
    [req.params.id]
  );
  if (!poolRows.length) return res.status(404).json({ erro: 'campanha sem pool' });

  const resultados = [];
  for (const c of poolRows) {
    try {
      const mediaId = await uploadMedia(c.phone_number_id, req.file.buffer, req.file.originalname, req.file.mimetype);
      await query('UPDATE campanha_numeros SET media_id = ? WHERE id = ?', [mediaId, c.id]);
      resultados.push({ numero_id: c.numero_id, ok: true });
    } catch (erro) {
      resultados.push({ numero_id: c.numero_id, ok: false, erro: String(erro) });
    }
  }
  res.json({ resultados });
}));

router.post('/:id/iniciar', asyncHandler(async (req, res) => {
  await query("UPDATE campanhas SET status = 'em_andamento' WHERE id = ?", [req.params.id]);
  res.sendStatus(200);
}));

router.post('/:id/pausar', asyncHandler(async (req, res) => {
  await query("UPDATE campanhas SET status = 'pausada' WHERE id = ?", [req.params.id]);
  res.sendStatus(200);
}));

// 1 envio avulso de teste — fora da fila, sem passar pelo compliance (ação manual explícita).
router.post('/teste-envio', asyncHandler(async (req, res) => {
  const { numero_id, telefone, nome, template_nome, template_idioma, media_id, media_url, extras } = req.body;
  if (!numero_id || !telefone || !template_nome || !template_idioma) {
    return res.status(400).json({ erro: 'informe numero_id, telefone, template_nome e template_idioma' });
  }
  const numeros = await query('SELECT * FROM numeros WHERE id = ?', [numero_id]);
  const numero = numeros[0];
  if (!numero) return res.status(404).json({ erro: 'número não encontrado' });

  const grupos = await obterGruposTemplates();
  const grupo = grupos.find(g => g.nome === template_nome && g.idioma === template_idioma);
  const variante = grupo?.variantes.find(v => v.waba === numero.waba_id);
  if (!variante) return res.status(400).json({ erro: 'esta conta não tem esse template aprovado' });

  const template = { name: grupo.nome, language: grupo.idioma, components: variante.components };
  const r = await enviarTemplate(numero.phone_number_id, telefone, nome, template, { mediaId: media_id, mediaUrl: media_url, extras });
  await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', ['teste_envio', JSON.stringify({ telefone, numero_id })]);
  res.json(r);
}));

router.get('/:id/relatorio.csv', asyncHandler(async (req, res) => {
  const linhas = await query(
    `SELECT f.telefone, f.nome, c.nome AS campanha, n.label AS canhao, f.status, f.wamid, f.motivo, f.atualizado_em
     FROM fila_disparo f
     JOIN campanhas c ON c.id = f.campanha_id
     LEFT JOIN numeros n ON n.id = f.numero_id
     WHERE f.campanha_id = ?
     ORDER BY f.atualizado_em`,
    [req.params.id]
  );
  const esc = v => String(v ?? '').replace(/;/g, ',');
  let csv = 'telefone;nome;campanha;canhao;status;wamid;motivo;atualizado_em\n';
  csv += linhas.map(l => [l.telefone, esc(l.nome), esc(l.campanha), esc(l.canhao), l.status, l.wamid || '', l.motivo || '', l.atualizado_em].join(';')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="campanha_${req.params.id}.csv"`);
  res.send('﻿' + csv);
}));

module.exports = router;
