/**
 * Módulo de compliance — roda ANTES de disparar e periodicamente pra monitorar números.
 * Objetivo: nunca deixar o sistema mandar mensagem pra quem não pode, fora de horário,
 * ou continuar usando um número que já está com qualidade caindo.
 */
const { query } = require('./db');

// ---------- 1. Lista de não perturbe ----------
async function estaNaListaNaoPerturbe(telefone) {
  const rows = await query('SELECT 1 FROM nao_perturbe WHERE telefone = ? LIMIT 1', [telefone]);
  return rows.length > 0;
}

async function adicionarNaoPerturbe(telefone, origem) {
  await query(
    'INSERT INTO nao_perturbe (telefone, origem) VALUES (?, ?) ON DUPLICATE KEY UPDATE origem = origem',
    [telefone, origem]
  );
}

// ---------- 2. Janela de horário ----------
async function horarioPermitidoAgora() {
  const cfg = await query('SELECT chave, valor FROM config WHERE chave IN (?,?,?)', [
    'horario_inicio', 'horario_fim', 'timezone',
  ]);
  const map = Object.fromEntries(cfg.map(c => [c.chave, c.valor]));
  const tz = map.timezone || 'America/Sao_Paulo';
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const horaAtual = agora.getHours() + agora.getMinutes() / 60;

  const [hIni] = (map.horario_inicio || '08:00').split(':').map(Number);
  const [hFim] = (map.horario_fim || '20:00').split(':').map(Number);

  return horaAtual >= hIni && horaAtual < hFim;
}

// ---------- 3. Filtro completo antes de disparar ----------
// Recebe uma lista de telefones, devolve só quem pode receber agora.
async function filtrarListaParaDisparo(telefones) {
  if (!(await horarioPermitidoAgora())) {
    return { liberados: [], bloqueados: telefones, motivo: 'fora_da_janela_de_horario' };
  }
  const bloqueados = [];
  const liberados = [];
  for (const tel of telefones) {
    if (await estaNaListaNaoPerturbe(tel)) {
      bloqueados.push(tel);
    } else {
      liberados.push(tel);
    }
  }
  return { liberados, bloqueados, motivo: bloqueados.length ? 'lista_nao_perturbe' : null };
}

// ---------- 3b. Aquecimento e limite diário por número ----------
// Função pura (sem DB) — dado quantos dias o número está conectado e a curva
// configurada (% do limite normal por semana), devolve a fração (0-1) do
// limite_diario que vale hoje. Fica separada pra dar pra testar sem banco.
function percentualAquecimento(diasConectado, curva) {
  const semana = Math.floor(Math.max(0, diasConectado) / 7);
  const pct = curva[Math.min(semana, curva.length - 1)];
  return pct / 100;
}

function parseCurva(valorConfig) {
  return String(valorConfig || '20,40,70,100')
    .split(',')
    .map(s => parseFloat(s.trim()))
    .filter(n => !isNaN(n));
}

async function limiteDiarioEfetivo(numero) {
  if (numero.status !== 'aquecendo') return numero.limite_diario;
  const cfg = await query('SELECT valor FROM config WHERE chave = ?', ['aquecimento_curva_pct']);
  const curva = parseCurva(cfg[0]?.valor);
  const diasConectado = Math.floor((Date.now() - new Date(numero.criado_em).getTime()) / 86400000);
  return Math.round(numero.limite_diario * percentualAquecimento(diasConectado, curva));
}

async function enviosHojeDoNumero(numeroId) {
  const rows = await query(
    "SELECT COUNT(*) AS total FROM mensagens WHERE numero_id = ? AND direcao = 'saida' AND DATE(criado_em) = CURDATE()",
    [numeroId]
  );
  return rows[0]?.total || 0;
}

async function quotaRestante(numero) {
  const efetivo = await limiteDiarioEfetivo(numero);
  const enviados = await enviosHojeDoNumero(numero.id);
  return Math.max(0, efetivo - enviados);
}

// dias de aquecimento cobertos pela curva configurada — usado pra saber quando promover pra 'ativo'
async function diasFimAquecimento() {
  const cfg = await query('SELECT valor FROM config WHERE chave = ?', ['aquecimento_curva_pct']);
  const curva = parseCurva(cfg[0]?.valor);
  return curva.length * 7;
}

// ---------- 4. Quality rating dos números (consulta a Meta) ----------
async function consultarQualityRating(phoneNumberId, whatsappToken, graphVersion = 'v21.0') {
  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}?fields=quality_rating,messaging_limit_tier`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${whatsappToken}` } });
  const data = await resp.json();
  if (!resp.ok) throw new Error(JSON.stringify(data));
  return data; // { quality_rating: 'GREEN'|'YELLOW'|'RED', messaging_limit_tier: '...' }
}

async function atualizarQualityRatingTodosNumeros(whatsappToken) {
  const numeros = await query('SELECT id, phone_number_id, status, criado_em FROM numeros WHERE status != ?', ['pausado']);
  const diasAquecimento = await diasFimAquecimento();
  for (const n of numeros) {
    try {
      const info = await consultarQualityRating(n.phone_number_id, whatsappToken);
      await query('UPDATE numeros SET quality_rating = ? WHERE id = ?', [info.quality_rating, n.id]);
      await query('INSERT INTO numeros_historico (numero_id, quality_rating) VALUES (?, ?)', [n.id, info.quality_rating]);
      if (info.quality_rating === 'RED') {
        await query('UPDATE numeros SET status = ? WHERE id = ?', ['pausado', n.id]);
        await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
          'numero_pausado_qualidade_vermelha', JSON.stringify({ numero_id: n.id, phone_number_id: n.phone_number_id }),
        ]);
        continue;
      }
      if (n.status === 'aquecendo') {
        const diasConectado = Math.floor((Date.now() - new Date(n.criado_em).getTime()) / 86400000);
        if (diasConectado >= diasAquecimento) {
          await query('UPDATE numeros SET status = ? WHERE id = ?', ['ativo', n.id]);
          await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
            'numero_promovido_fim_aquecimento', JSON.stringify({ numero_id: n.id, phone_number_id: n.phone_number_id }),
          ]);
        }
      }
    } catch (erro) {
      await query('INSERT INTO eventos_log (evento, detalhes) VALUES (?, ?)', [
        'erro_consulta_quality_rating', JSON.stringify({ numero_id: n.id, erro: String(erro) }),
      ]);
    }
  }
}

module.exports = {
  estaNaListaNaoPerturbe,
  adicionarNaoPerturbe,
  horarioPermitidoAgora,
  filtrarListaParaDisparo,
  consultarQualityRating,
  atualizarQualityRatingTodosNumeros,
  percentualAquecimento,
  limiteDiarioEfetivo,
  enviosHojeDoNumero,
  quotaRestante,
  diasFimAquecimento,
};
