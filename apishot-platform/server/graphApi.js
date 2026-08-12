/**
 * Toda a comunicação com a Graph API (WhatsApp Cloud API) num lugar só.
 * Usa sempre o token do usuário de sistema próprio (.env WHATSAPP_TOKEN) —
 * nunca mais um token colado no navegador.
 */
const GRAPH_VERSION = 'v21.0';
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const PHFIELDS = 'id,display_phone_number,verified_name,name_status,quality_rating,messaging_limit_tier';

const tokenPadrao = () => process.env.WHATSAPP_TOKEN;

function comToken(path, token) {
  return BASE + path + (path.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token);
}

async function gapi(path, token = tokenPadrao()) {
  const resp = await fetch(comToken(path, token));
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error?.message || `HTTP ${resp.status}`);
  return data;
}

// segue paginação até acabar
async function gapiAll(path, token = tokenPadrao()) {
  let out = [];
  let url = comToken(path, token);
  for (let i = 0; i < 20 && url; i++) {
    const resp = await fetch(url);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error?.message || `HTTP ${resp.status}`);
    out = out.concat(data.data || []);
    url = (data.paging && data.paging.next) || null;
  }
  return out;
}

async function gpost(path, body, token = tokenPadrao()) {
  const resp = await fetch(comToken(path, token), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error?.message || `HTTP ${resp.status}`);
  return data;
}

// ---------- Descoberta de WABAs / números / templates ----------

async function listarWabas(token = tokenPadrao()) {
  const wmap = {};
  try {
    const asg = await gapiAll('/me/assigned_whatsapp_business_accounts?fields=id,name&limit=200', token);
    asg.forEach(x => { wmap[x.id] = { id: x.id, name: x.name }; });
  } catch (erro) { /* segue tentando pelo caminho de portfólio */ }
  try {
    const bizs = await gapiAll('/me/businesses?fields=id,name&limit=50', token);
    for (const b of bizs) {
      for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
        try {
          (await gapiAll(`/${b.id}/${edge}?fields=id,name&limit=200`, token)).forEach(x => { wmap[x.id] = { id: x.id, name: x.name }; });
        } catch (erro) { /* conta sem essa edge, ignora */ }
      }
    }
  } catch (erro) { /* sem permissão business_management — segue só com as assigned */ }
  return Object.values(wmap);
}

async function listarNumerosDaWaba(wabaId, token = tokenPadrao()) {
  const ph = await gapiAll(`/${wabaId}/phone_numbers?fields=${PHFIELDS}&limit=100`, token);
  return ph.map(p => ({
    phoneNumberId: p.id,
    label: `${p.verified_name || ''} · ${p.display_phone_number || ''}`.trim(),
    wabaId,
    qualityRating: p.quality_rating || null,
    nameStatus: p.name_status || null,
    tier: p.messaging_limit_tier || null,
  }));
}

async function listarTemplatesDaWaba(wabaId, wabaName, token = tokenPadrao()) {
  const data = await gapiAll(`/${wabaId}/message_templates?fields=name,status,category,language,components&limit=100`, token);
  data.forEach(t => { t.__waba = wabaId; t.__wabaName = wabaName; });
  return data;
}

// ---------- Criação / clonagem de template ----------

async function criarTemplate(wabaId, template, token = tokenPadrao()) {
  return gpost(`/${wabaId}/message_templates`, template, token);
}

function extrairComponentesClone(template) {
  return (template.components || []).map(c => {
    const o = { type: c.type };
    if (c.format) o.format = c.format;
    if (c.text !== undefined) o.text = c.text;
    if (c.example) o.example = c.example;
    if (c.buttons) {
      o.buttons = c.buttons.map(b => {
        const x = { type: b.type, text: b.text };
        if (b.url) x.url = b.url;
        if (b.phone_number) x.phone_number = b.phone_number;
        if (b.example) x.example = b.example;
        return x;
      });
    }
    return o;
  });
}

async function clonarTemplateEmWabas(template, wabaIds, token = tokenPadrao()) {
  const componentes = extrairComponentesClone(template);
  const resultados = [];
  for (const wabaId of wabaIds) {
    try {
      const r = await criarTemplate(wabaId, {
        name: template.name, language: template.language, category: template.category, components: componentes,
      }, token);
      resultados.push({ wabaId, ok: true, status: r.status || 'PENDING', id: r.id });
    } catch (erro) {
      resultados.push({ wabaId, ok: false, erro: String(erro) });
    }
  }
  return resultados;
}

// ---------- Forma do template (variáveis, mídia no header) ----------

function tplVars(template) {
  if (!template) return 0;
  const body = (template.components || []).find(c => c.type === 'BODY');
  const m = (body?.text || '').match(/\{\{\d+\}\}/g);
  return m ? new Set(m).size : 0;
}
function tplHeader(template) {
  return (template?.components || []).find(c => c.type === 'HEADER') || null;
}
function headerFormato(template) {
  const h = tplHeader(template);
  return h ? (h.format || 'TEXT').toUpperCase() : null;
}
function precisaMidia(template) {
  return ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormato(template));
}

// ---------- Upload de mídia ----------

async function uploadMedia(phoneNumberId, fileBuffer, filename, mimetype, token = tokenPadrao()) {
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('file', new Blob([fileBuffer], { type: mimetype }), filename);
  const url = `${BASE}/${phoneNumberId}/media?access_token=${encodeURIComponent(token)}`;
  const resp = await fetch(url, { method: 'POST', body: fd });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error?.message || `HTTP ${resp.status}`);
  return data.id;
}

// ---------- Envio de mensagem ----------

async function enviarTexto(phoneNumberId, to, texto, token = tokenPadrao()) {
  return gpost(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp', to, type: 'text', text: { body: texto },
  }, token);
}

function montarPayloadTemplate(to, nome, template, opts = {}) {
  const comps = [];
  const fmt = headerFormato(template), h = tplHeader(template);
  if (fmt === 'TEXT') {
    if (h && /\{\{1\}\}/.test(h.text || '')) comps.push({ type: 'header', parameters: [{ type: 'text', text: nome || 'parceiro(a)' }] });
  } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(fmt)) {
    const key = fmt.toLowerCase();
    let media;
    if (opts.mediaId) media = { id: opts.mediaId };
    else if (opts.mediaUrl) media = { link: opts.mediaUrl };
    else throw new Error('Template exige mídia no header e nenhum mediaId/mediaUrl foi informado');
    if (fmt === 'DOCUMENT' && media.link) media.filename = 'arquivo.pdf';
    const param = { type: key };
    param[key] = media;
    comps.push({ type: 'header', parameters: [param] });
  }
  const n = tplVars(template);
  if (n > 0) {
    const extras = opts.extras || [];
    const params = [];
    for (let i = 0; i < n; i++) params.push({ type: 'text', text: i === 0 ? (nome || 'parceiro(a)') : (extras[i - 1] || ' ') });
    comps.push({ type: 'body', parameters: params });
  }
  const p = { messaging_product: 'whatsapp', to, type: 'template', template: { name: template.name, language: { code: template.language } } };
  if (comps.length) p.template.components = comps;
  return p;
}

async function enviarTemplate(phoneNumberId, to, nome, template, opts = {}, token = tokenPadrao()) {
  return gpost(`/${phoneNumberId}/messages`, montarPayloadTemplate(to, nome, template, opts), token);
}

module.exports = {
  gapi,
  gapiAll,
  gpost,
  listarWabas,
  listarNumerosDaWaba,
  listarTemplatesDaWaba,
  criarTemplate,
  clonarTemplateEmWabas,
  tplVars,
  tplHeader,
  headerFormato,
  precisaMidia,
  uploadMedia,
  enviarTexto,
  montarPayloadTemplate,
  enviarTemplate,
};
