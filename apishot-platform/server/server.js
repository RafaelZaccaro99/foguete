require('dotenv').config();
const path = require('path');
const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const webhookRoutes = require('./routes/webhook');
const numerosRoutes = require('./routes/numeros');
const conversasRoutes = require('./routes/conversas');
const templatesRoutes = require('./routes/templates');
const campanhasRoutes = require('./routes/campanhas');
const agentesRoutes = require('./routes/agentes');
const naoPerturbeRoutes = require('./routes/naoPerturbe');
const configRoutes = require('./routes/config');
const { atualizarQualityRatingTodosNumeros } = require('./compliance');
const { processarFilaDisparo } = require('./filaWorker');
const { getToken, carregar: carregarToken } = require('./tokenStore');
const { query } = require('./db');

app.use('/webhook', webhookRoutes);
app.use('/numeros', numerosRoutes);
app.use('/conversas', conversasRoutes);
app.use('/templates', templatesRoutes);
app.use('/campanhas', campanhasRoutes);
app.use('/agentes', agentesRoutes);
app.use('/nao-perturbe', naoPerturbeRoutes);
app.use('/config', configRoutes);

// captura qualquer erro que escapou dos handlers (via asyncHandler ou next(err)) —
// sem isso, uma promise rejeitada (ex: MySQL fora do ar por um instante) derruba
// o processo inteiro e tira webhook/disparo/tudo do ar por causa de UMA query.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: String(err) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Apishot Platform rodando na porta ${PORT}`));

// carrega o token salvo (config da tela) por cima do .env, assim que o banco estiver pronto
carregarToken().catch(() => {});

// monitora quality rating de todos os números a cada 1h (e promove aquecendo → ativo)
const UMA_HORA = 60 * 60 * 1000;
setInterval(() => {
  atualizarQualityRatingTodosNumeros(getToken()).catch(console.error);
}, UMA_HORA);

// worker da fila de disparo — intervalo lido do config no start (ajustável no banco,
// só precisa reiniciar o processo pra pegar uma mudança de intervalo)
(async () => {
  let segundos = 30;
  try {
    const cfg = await query("SELECT valor FROM config WHERE chave = 'disparo_intervalo_segundos'");
    segundos = parseInt(cfg[0]?.valor) || 30;
  } catch (erro) {
    console.error('Não deu pra ler disparo_intervalo_segundos do config, usando 30s padrão.', erro);
  }
  setInterval(() => {
    processarFilaDisparo().catch(console.error);
  }, segundos * 1000);
})();
