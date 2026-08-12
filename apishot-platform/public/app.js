/* Apishot — shell compartilhado: injeta a barra lateral e o status do token. */
(function () {
  const NAV = [
    ['/', '🏠', 'Início'],
    ['/disparo.html', '🚀', 'Disparo'],
    ['/conversas.html', '💬', 'Conversas'],
    ['/numeros.html', '📱', 'Números'],
    ['/templates.html', '📋', 'Templates'],
    ['/agentes.html', '🤖', 'Agentes'],
  ];

  function pathAtual() {
    let p = location.pathname;
    if (p === '' || p === '/index.html') return '/';
    return p;
  }

  function montarSidebar() {
    document.body.classList.add('has-sidebar');
    const aside = document.createElement('aside');
    aside.className = 'sidebar';
    const atual = pathAtual();
    aside.innerHTML =
      '<div class="side-brand">🚀 <span>APISHOT</span></div>' +
      NAV.map(([href, ic, label]) =>
        '<a class="side-link' + (atual === href ? ' on' : '') + '" href="' + href + '">' +
        '<span class="ic">' + ic + '</span><span>' + label + '</span></a>'
      ).join('') +
      '<div class="side-spacer"></div>' +
      '<a class="side-token" id="sideToken" href="/">token…</a>';
    document.body.prepend(aside);
    atualizarStatusToken();
  }

  async function atualizarStatusToken() {
    const el = document.getElementById('sideToken');
    if (!el) return;
    try {
      const s = await fetch('/config/token-status').then(r => r.json());
      if (s.configurado) {
        el.className = 'side-token ok';
        el.textContent = '🔑 Token ' + s.preview + (s.origem === 'env' ? ' (.env)' : '');
      } else {
        el.className = 'side-token warn';
        el.textContent = '⚠️ Sem token — configurar';
      }
    } catch (e) {
      el.className = 'side-token warn';
      el.textContent = '⚠️ Sem conexão com o servidor';
    }
  }

  // helper de API compartilhado (usado pelas páginas)
  window.api = async function (path, opts) {
    const r = await fetch(path, opts);
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json().catch(() => ({})) : null;
    if (!r.ok) throw new Error((data && data.erro) || ('HTTP ' + r.status));
    return data;
  };
  window.atualizarStatusToken = atualizarStatusToken;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarSidebar);
  else montarSidebar();
})();
