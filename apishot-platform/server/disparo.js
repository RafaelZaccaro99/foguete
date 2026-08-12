/**
 * Planejamento do disparo — funções puras (sem rede, sem banco), portadas do
 * index_13.html (revezamento de canhões). Isoladas de propósito pra dar pra
 * testar sozinhas (ver test/disparo.test.js).
 */

// Pool de canhões que conseguem disparar um template: cada número marcado cuja WABA
// tem o template (mesmo nome+idioma), ou que tem um template alternativo mapeado na mão.
// numerosMarcados: [{id, label, wabaId}]
// grupoTemplate: {nome, idioma, categoria, variantes: [{waba, wabaNome, components}]}
// mapeamentoManual: { [numeroId]: {name, language, components} }
function resolverCanhoes(numerosMarcados, grupoTemplate, mapeamentoManual = {}) {
  if (!grupoTemplate) return { pool: [], skipped: [] };
  const pool = [];
  const skipped = [];
  for (const numero of numerosMarcados) {
    const variante = grupoTemplate.variantes.find(v => v.waba === numero.wabaId);
    if (variante) {
      pool.push({
        numeroId: numero.id,
        label: numero.label,
        template: { name: grupoTemplate.nome, language: grupoTemplate.idioma, components: variante.components },
        modo: 'auto',
      });
      continue;
    }
    const alt = mapeamentoManual[numero.id];
    if (alt) {
      pool.push({ numeroId: numero.id, label: numero.label, template: alt, modo: 'manual' });
      continue;
    }
    skipped.push({ numeroId: numero.id, label: numero.label });
  }
  return { pool, skipped };
}

// Divide `total` leads entre os canhões do pool. Quem tem cota manual fixa
// (cotasManuais[numeroId]) fica fixo; o resto é dividido igual entre os demais —
// baixar a cota de um número repassa a diferença pros outros, sem deixar lead de fora.
function montarPlano(pool, total, cotasManuais = {}) {
  const fixos = pool.map(c => (cotasManuais[c.numeroId] !== undefined ? Math.max(0, parseInt(cotasManuais[c.numeroId]) || 0) : null));
  const somaFixos = fixos.reduce((a, v) => a + (v || 0), 0);
  const livres = pool.map((c, k) => k).filter(k => fixos[k] === null);
  const counts = fixos.map(v => (v === null ? 0 : v));
  const restante = Math.max(0, total - somaFixos);
  if (livres.length) {
    const base = Math.floor(restante / livres.length);
    const resto = restante % livres.length;
    livres.forEach((k, i) => { counts[k] = base + (i < resto ? 1 : 0); });
  }
  let soma = counts.reduce((a, b) => a + b, 0);
  for (let k = counts.length - 1; k >= 0 && soma > total; k--) {
    const cut = Math.min(counts[k], soma - total);
    counts[k] -= cut;
    soma -= cut;
  }
  return { counts, soma, fora: Math.max(0, total - soma) };
}

// Transforma as quantidades por canhão numa sequência intercalada — revezamento de
// verdade (não "todo mundo do canhão A, depois todo mundo do canhão B").
function sequenciaCanhoes(counts) {
  const seq = [];
  const rest = counts.slice();
  let algum = true;
  while (algum) {
    algum = false;
    for (let k = 0; k < rest.length; k++) {
      if (rest[k] > 0) { seq.push(k); rest[k]--; algum = true; }
    }
  }
  return seq;
}

// Remove de `contatos` (lista de {telefone,...}) quem estiver em `setBloqueados` (Set de
// telefones). Puro — usado no enfileiramento pra tirar já-enviados e a lista de não-perturbe.
function scrubTelefones(contatos, setBloqueados) {
  const filtrados = contatos.filter(c => !setBloqueados.has(c.telefone));
  return { filtrados, removidos: contatos.length - filtrados.length };
}

// Classifica um erro da Graph API: transitório (vale re-tentar) vs permanente (desiste).
// Puro — recebe a mensagem de erro (string) e devolve 'transitorio' ou 'permanente'.
// Transitório: instabilidade (HTTP 5xx) e rate limit (códigos 130429/131056/80007/613).
// Permanente: número inválido, template inexistente, etc. — re-tentar não adianta.
function classificarErro(mensagem) {
  const m = String(mensagem || '');
  if (/HTTP 5\d\d/.test(m)) return 'transitorio';
  if (/\b(130429|131056|80007|613|368)\b/.test(m)) return 'transitorio';
  if (/rate limit|too many|temporarily|try again/i.test(m)) return 'transitorio';
  return 'permanente';
}

module.exports = { resolverCanhoes, montarPlano, sequenciaCanhoes, scrubTelefones, classificarErro };
