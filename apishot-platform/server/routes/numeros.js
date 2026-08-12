const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { listarWabas, listarNumerosDaWaba } = require('../graphApi');
const { enviosHojeDoNumero, limiteDiarioEfetivo } = require('../compliance');
const { obterGruposTemplates } = require('../templatesCache');
const asyncHandler = require('../asyncHandler');

// Tela de gestão de números
router.get('/', asyncHandler(async (req, res) => {
  const numeros = await query('SELECT * FROM numeros ORDER BY label');
  res.json(numeros);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { phone_number_id, waba_id, label, limite_diario } = req.body;
  await query(
    'INSERT INTO numeros (phone_number_id, waba_id, label, limite_diario, status) VALUES (?, ?, ?, ?, "aquecendo")',
    [phone_number_id, waba_id, label, limite_diario || 200]
  );
  res.sendStatus(201);
}));

router.post('/:id/pausar', asyncHandler(async (req, res) => {
  await query('UPDATE numeros SET status = "pausado" WHERE id = ?', [req.params.id]);
  res.sendStatus(200);
}));

router.post('/:id/ativar', asyncHandler(async (req, res) => {
  await query('UPDATE numeros SET status = "ativo" WHERE id = ?', [req.params.id]);
  res.sendStatus(200);
}));

// status do dia (quota efetiva já considerando aquecimento + quanto já disparou hoje)
router.get('/:id/status', asyncHandler(async (req, res) => {
  const rows = await query('SELECT * FROM numeros WHERE id = ?', [req.params.id]);
  const numero = rows[0];
  if (!numero) return res.sendStatus(404);
  const enviadosHoje = await enviosHojeDoNumero(numero.id);
  const limiteEfetivo = await limiteDiarioEfetivo(numero);
  res.json({
    ...numero,
    enviados_hoje: enviadosHoje,
    limite_efetivo_hoje: limiteEfetivo,
    quota_restante: Math.max(0, limiteEfetivo - enviadosHoje),
  });
}));

// varre o Business Manager (via WHATSAPP_TOKEN do .env) e sincroniza numeros — equivalente
// ao "Descobrir arsenal" do Foguete antigo, agora sem precisar colar token no navegador.
router.post('/sync', asyncHandler(async (req, res) => {
  const wabas = await listarWabas();
  let novos = 0, atualizados = 0;
  for (const w of wabas) {
    const numerosDaConta = await listarNumerosDaWaba(w.id);
    for (const n of numerosDaConta) {
      const existentes = await query('SELECT id FROM numeros WHERE phone_number_id = ?', [n.phoneNumberId]);
      if (existentes.length) {
        await query('UPDATE numeros SET waba_id = ?, label = ?, quality_rating = ? WHERE phone_number_id = ?', [
          n.wabaId, n.label, n.qualityRating, n.phoneNumberId,
        ]);
        atualizados++;
      } else {
        await query(
          'INSERT INTO numeros (phone_number_id, waba_id, label, limite_diario, status, quality_rating) VALUES (?, ?, ?, ?, "aquecendo", ?)',
          [n.phoneNumberId, n.wabaId, n.label, 200, n.qualityRating]
        );
        novos++;
      }
    }
  }
  await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
    'numeros_sync', JSON.stringify({ wabas: wabas.length, novos, atualizados }),
  ]);
  res.json({ wabas: wabas.length, novos, atualizados });
}));

// templates aprovados de todas as WABAs cadastradas, agrupados por nome+idioma
// (o mesmo template aprovado em várias contas vira 1 opção só, como no Foguete antigo)
router.get('/templates', asyncHandler(async (req, res) => {
  const grupos = await obterGruposTemplates(!!req.query.forcar);
  res.json(grupos);
}));

module.exports = router;
