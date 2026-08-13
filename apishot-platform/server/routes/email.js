/**
 * API do painel pro módulo de email (tudo atrás de login — montado em /email).
 * Config SMTP, campanhas, fila, descadastro e relatório.
 */
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const asyncHandler = require('../asyncHandler');
const emailStore = require('../emailStore');
const { enviarEmail, verificarConexao, invalidar } = require('../emailSender');
const {
  normalizarLista, emailValido, renderizarVariaveis, textoParaHtml,
} = require('../emailDisparo');

// ---------- config SMTP ----------

// status mascarado — NUNCA devolve a senha
router.get('/config', asyncHandler(async (req, res) => {
  await emailStore.carregar();
  const c = emailStore.getConfigEmail();
  res.json({
    configurado: emailStore.configurado(),
    host: c.host, porta: c.porta, usuario: c.usuario, seguro: c.seguro,
    senha_definida: !!c.senha,
    remetente: c.remetente, remetente_nome: c.remetenteNome,
    base_url: c.baseUrl,
  });
}));

router.post('/config', asyncHandler(async (req, res) => {
  const { host, porta, usuario, senha, seguro, remetente, remetente_nome, base_url } = req.body;
  if (remetente && !emailValido(remetente)) return res.status(400).json({ erro: 'remetente inválido' });
  await emailStore.salvar({
    smtp_host: host, smtp_porta: porta, smtp_usuario: usuario, smtp_senha: senha,
    smtp_seguro: seguro ? '1' : '0',
    email_remetente: remetente, email_remetente_nome: remetente_nome, email_base_url: base_url,
  });
  invalidar(); // força recriar o transporte com a config nova
  res.status(201).json({ ok: true });
}));

// testa a conexão SMTP com a config SALVA (sem enviar nada)
router.post('/config/testar', asyncHandler(async (req, res) => {
  try {
    await verificarConexao();
    res.json({ ok: true });
  } catch (erro) {
    res.status(400).json({ ok: false, erro: String(erro.message || erro) });
  }
}));

// ---------- campanhas ----------

router.post('/campanhas', asyncHandler(async (req, res) => {
  const { nome, assunto, corpo } = req.body;
  if (!nome || !assunto || !corpo) {
    return res.status(400).json({ erro: 'informe nome, assunto e corpo' });
  }
  const r = await query(
    'INSERT INTO email_campanhas (nome, assunto, corpo, status) VALUES (?, ?, ?, "rascunho")',
    [nome, assunto, corpo]
  );
  res.status(201).json({ id: r.insertId });
}));

router.get('/campanhas', asyncHandler(async (req, res) => {
  const campanhas = await query(
    `SELECT c.*,
       SUM(f.status = 'pendente')  AS pendente,
       SUM(f.status = 'enviada')   AS enviada,
       SUM(f.status = 'bloqueada') AS bloqueada,
       SUM(f.status = 'falhou')    AS falhou,
       SUM(f.aberto_em IS NOT NULL)  AS abertos,
       SUM(f.clicado_em IS NOT NULL) AS cliques
     FROM email_campanhas c
     LEFT JOIN email_fila f ON f.campanha_id = c.id
     GROUP BY c.id ORDER BY c.criado_em DESC`
  );
  res.json(campanhas);
}));

router.get('/campanhas/:id', asyncHandler(async (req, res) => {
  const rows = await query('SELECT * FROM email_campanhas WHERE id = ?', [req.params.id]);
  const campanha = rows[0];
  if (!campanha) return res.sendStatus(404);
  const contadores = await query(
    `SELECT status, COUNT(*) AS total,
       SUM(aberto_em IS NOT NULL) AS abertos, SUM(clicado_em IS NOT NULL) AS cliques
     FROM email_fila WHERE campanha_id = ? GROUP BY status`,
    [campanha.id]
  );
  const resumo = { pendente: 0, enviada: 0, bloqueada: 0, falhou: 0, abertos: 0, cliques: 0 };
  contadores.forEach(c => {
    resumo[c.status] = c.total;
    resumo.abertos += Number(c.abertos) || 0;
    resumo.cliques += Number(c.cliques) || 0;
  });
  res.json({ ...campanha, contadores: resumo });
}));

// Recebe o texto colado na tela (uma linha por contato) e enfileira — dedupe de
// quem já recebeu qualquer email (opcional) e scrub da lista de descadastro.
router.post('/campanhas/:id/contatos', asyncHandler(async (req, res) => {
  const { lista, ignorar_ja_enviados = true } = req.body;
  const { contatos, invalidos } = normalizarLista(lista);
  if (!contatos.length) {
    return res.status(400).json({ erro: 'nenhum email válido na lista', invalidos });
  }

  const campanhas = await query('SELECT * FROM email_campanhas WHERE id = ?', [req.params.id]);
  if (!campanhas[0]) return res.sendStatus(404);
  const campanha = campanhas[0];

  const emails = contatos.map(c => c.email);
  const placeholders = emails.map(() => '?').join(',');

  let filtrados = contatos;
  let jaEnviados = 0;
  if (ignorar_ja_enviados) {
    const enviados = await query(
      `SELECT DISTINCT email FROM email_fila WHERE status = 'enviada' AND email IN (${placeholders})`,
      emails
    );
    const setEnviados = new Set(enviados.map(e => e.email));
    jaEnviados = filtrados.filter(c => setEnviados.has(c.email)).length;
    filtrados = filtrados.filter(c => !setEnviados.has(c.email));
  }

  let removidosDescadastro = 0;
  if (filtrados.length) {
    const restantes = filtrados.map(c => c.email);
    const ph = restantes.map(() => '?').join(',');
    const bloqueados = await query(
      `SELECT email FROM email_descadastro WHERE email IN (${ph})`, restantes
    );
    const setBloq = new Set(bloqueados.map(b => b.email));
    removidosDescadastro = filtrados.filter(c => setBloq.has(c.email)).length;
    filtrados = filtrados.filter(c => !setBloq.has(c.email));
  }

  for (const c of filtrados) {
    await query(
      'INSERT INTO email_fila (campanha_id, email, nome, status) VALUES (?, ?, ?, "pendente")',
      [campanha.id, c.email, c.nome]
    );
  }

  res.status(201).json({
    enfileirados: filtrados.length,
    ja_enviados_ignorados: jaEnviados,
    removidos_descadastro: removidosDescadastro,
    invalidos,
  });
}));

router.post('/campanhas/:id/iniciar', asyncHandler(async (req, res) => {
  if (!emailStore.configurado()) return res.status(400).json({ erro: 'configure o SMTP antes de iniciar' });
  await query("UPDATE email_campanhas SET status = 'em_andamento' WHERE id = ?", [req.params.id]);
  res.sendStatus(200);
}));

router.post('/campanhas/:id/pausar', asyncHandler(async (req, res) => {
  await query("UPDATE email_campanhas SET status = 'pausada' WHERE id = ?", [req.params.id]);
  res.sendStatus(200);
}));

router.get('/campanhas/:id/relatorio.csv', asyncHandler(async (req, res) => {
  const linhas = await query(
    `SELECT f.email, f.nome, c.nome AS campanha, f.status, f.motivo,
            f.aberto_em, f.clicado_em, f.atualizado_em
     FROM email_fila f JOIN email_campanhas c ON c.id = f.campanha_id
     WHERE f.campanha_id = ? ORDER BY f.atualizado_em`,
    [req.params.id]
  );
  const esc = v => String(v ?? '').replace(/;/g, ',');
  let csv = 'email;nome;campanha;status;motivo;aberto_em;clicado_em;atualizado_em\n';
  csv += linhas.map(l => [l.email, esc(l.nome), esc(l.campanha), l.status, esc(l.motivo),
    l.aberto_em || '', l.clicado_em || '', l.atualizado_em].join(';')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="email_campanha_${req.params.id}.csv"`);
  res.send('﻿' + csv);
}));

// 1 envio avulso de teste — fora da fila (ação manual explícita), sem rastreio.
router.post('/teste-envio', asyncHandler(async (req, res) => {
  const { email, nome, assunto, corpo } = req.body;
  if (!emailValido(email) || !assunto || !corpo) {
    return res.status(400).json({ erro: 'informe email válido, assunto e corpo' });
  }
  const contato = { email, nome: nome || null };
  try {
    const messageId = await enviarEmail({
      para: email,
      assunto: renderizarVariaveis(assunto, contato),
      html: textoParaHtml(renderizarVariaveis(corpo, contato)),
      texto: renderizarVariaveis(corpo, contato),
    });
    await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
      'teste_envio_email', JSON.stringify({ email }),
    ]);
    res.json({ ok: true, message_id: messageId });
  } catch (erro) {
    res.status(400).json({ ok: false, erro: String(erro.message || erro) });
  }
}));

// ---------- descadastro (a lista de "não perturbe" do email) ----------

router.get('/descadastro', asyncHandler(async (req, res) => {
  const rows = await query('SELECT * FROM email_descadastro ORDER BY criado_em DESC LIMIT 500');
  res.json(rows);
}));

// importa emails (um por linha) direto pra lista de descadastro
router.post('/descadastro/importar', asyncHandler(async (req, res) => {
  const { contatos } = normalizarLista(req.body.lista);
  for (const c of contatos) {
    await query(
      "INSERT INTO email_descadastro (email, origem) VALUES (?, 'upload_manual') ON DUPLICATE KEY UPDATE origem = origem",
      [c.email]
    );
  }
  res.status(201).json({ importados: contatos.length });
}));

module.exports = router;
