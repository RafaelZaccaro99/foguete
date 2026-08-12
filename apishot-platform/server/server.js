require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

const webhookRoutes = require('./routes/webhook');
const numerosRoutes = require('./routes/numeros');
const conversasRoutes = require('./routes/conversas');
const { atualizarQualityRatingTodosNumeros } = require('./compliance');

app.use('/webhook', webhookRoutes);
app.use('/numeros', numerosRoutes);
app.use('/conversas', conversasRoutes);

app.get('/', (req, res) => {
  res.send('Apishot Platform no ar. Rotas: /webhook · /numeros · /conversas');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Apishot Platform rodando na porta ${PORT}`));

// monitora quality rating de todos os números a cada 1h
const UMA_HORA = 60 * 60 * 1000;
setInterval(() => {
  atualizarQualityRatingTodosNumeros(process.env.WHATSAPP_TOKEN).catch(console.error);
}, UMA_HORA);
