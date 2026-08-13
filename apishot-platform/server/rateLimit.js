/**
 * Freio de tentativas por IP — sem dependência externa, guardado em memória.
 *
 * Existe por causa do login: a senha do painel é uma só e compartilhada, então sem freio
 * dá pra tentar milhares por minuto até acertar. Aqui só as tentativas ERRADAS contam
 * (a função devolve um `registrarFalha` que a rota chama quando a senha não confere),
 * então quem digita certo nunca é bloqueado.
 *
 * Memória basta: o processo é único e um restart liberar o contador é aceitável — o
 * atacante perde a janela toda mesmo assim.
 */

function criarFreio({ maxTentativas = 8, janelaMs = 15 * 60 * 1000, mensagem = 'muitas tentativas, espere um pouco' } = {}) {
  const porIp = new Map(); // ip -> { falhas, ate }

  function limpar(agora) {
    for (const [ip, reg] of porIp) if (reg.ate <= agora) porIp.delete(ip);
  }

  function middleware(req, res, next) {
    const agora = Date.now();
    if (porIp.size > 5000) limpar(agora); // teto de memória: só varre quando cresce demais
    const ip = req.ip || req.socket.remoteAddress || 'desconhecido';
    const reg = porIp.get(ip);

    if (reg && reg.ate > agora && reg.falhas >= maxTentativas) {
      const segundos = Math.ceil((reg.ate - agora) / 1000);
      res.set('Retry-After', String(segundos));
      return res.status(429).json({ erro: mensagem, tente_em_segundos: segundos });
    }

    res.locals.registrarFalha = () => {
      const atual = porIp.get(ip);
      if (atual && atual.ate > Date.now()) atual.falhas++;
      else porIp.set(ip, { falhas: 1, ate: Date.now() + janelaMs });
    };
    res.locals.limparFalhas = () => porIp.delete(ip);
    next();
  }

  middleware.estado = porIp; // exposto pros testes
  return middleware;
}

module.exports = { criarFreio };
