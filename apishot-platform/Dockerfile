# Imagem de produção da Apishot Platform.
# Node 20 (mesma versão do passo a passo da Hostinger) em Alpine pra imagem pequena.
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependências primeiro, em camada separada: mudar código não refaz o npm ci.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Não rodar como root. A imagem node já traz o usuário `node`.
USER node

EXPOSE 3000

# Prova de vida do processo (o /health não toca no banco de propósito).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/server.js"]
