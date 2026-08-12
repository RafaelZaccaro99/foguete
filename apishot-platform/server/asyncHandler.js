// Envolve um handler async do Express — sem isso, uma promise rejeitada (ex: MySQL
// fora do ar por um instante) vira unhandled rejection e derruba o processo inteiro,
// tirando webhook/disparo/tudo do ar por causa de UMA query que falhou.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;
