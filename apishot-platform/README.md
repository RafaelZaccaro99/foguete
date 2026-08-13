# Apishot Platform

Disparador de WhatsApp independente (sem depender da Ducke ou de nenhum parceiro
terceiro), com bot de respostas automáticas e módulo de compliance. Contexto completo em
[`PROMPT_IMPLEMENTACAO.md`](./PROMPT_IMPLEMENTACAO.md).

**Colocar no ar:** [`DEPLOY.md`](./DEPLOY.md) — Hostinger, Docker (VPS) ou PaaS.
O passo a passo detalhado da Hostinger está em
[`PASSO_A_PASSO_HOSTINGER.md`](./PASSO_A_PASSO_HOSTINGER.md).

## Rodar local

```bash
npm install
cp .env.example .env       # preenche SESSION_SECRET, PAINEL_SENHA, VERIFY_TOKEN, DB_*
                           # (em local, tire o NODE_ENV=production)
# cria um banco MySQL vazio e aponta DB_* pra ele — o schema é aplicado sozinho
npm test                   # revezamento, automações, curva de aquecimento, scrub
npm start                  # prepara o banco e sobe em http://localhost:3000
```

Ou, com Docker (sobe app + MySQL juntos):

```bash
cp .env.example .env       # preenche também DB_ROOT_PASS
docker compose up -d
```

No boot o app aplica `schema.sql`, roda as migrações de coluna e carrega os 17
agentes-padrão — tudo idempotente. Pra fazer só isso, sem subir o servidor:
`npm run bootstrap`.

O painel abre em `/` (tela inicial com o campo de token e um resumo) e tem barra
lateral com: Início, Disparo, Conversas, Números, Templates e Agentes. O token do
WhatsApp pode ser configurado direto na tela inicial (salvo no servidor, nunca no
navegador) — ou pelo `WHATSAPP_TOKEN` do `.env` como fallback.

## Estrutura

- `server/env.js` — confere as variáveis de ambiente no boot (em produção, configuração
  insegura impede o app de subir em vez de virar problema silencioso).
- `server/bootstrap.js` — prepara o banco no boot: espera o MySQL, aplica o schema, roda
  as migrações e carrega os agentes-padrão. Desligável com `BOOTSTRAP_DB=false`.
- `server/rateLimit.js` — freio de tentativas por IP (usado no login).
- `server/automations.js` — motor de agentes (as antigas 17 automações agora vêm do banco
  e são editáveis na tela; `matchAgente` é puro/testável, `encontrarAutomacao` usa cache).
- `server/seedAgentes.js` — dados-semente das 17 + carga inicial idempotente.
- `server/compliance.js` — não-perturbe, janela de horário, limite diário + aquecimento
  de número novo, monitor de quality rating (promove/pausa números automaticamente).
- `server/graphApi.js` — toda chamada à Graph API num lugar só (token nunca sai do
  servidor).
- `server/disparo.js` — funções puras do revezamento de canhões (resolverCanhoes,
  montarPlano, sequenciaCanhoes), portadas do Foguete antigo (`api_shot_atual.html`).
- `server/filaWorker.js` — worker que processa a fila de disparo respeitando compliance.
- `server/routes/` — `webhook.js`, `numeros.js`, `conversas.js`, `templates.js`,
  `campanhas.js`, `agentes.js`, `naoPerturbe.js`.
- `public/` — painel (5 telas, HTML/JS puro, sem build).

## Rotas principais

| Rota | O que faz |
|---|---|
| `GET /health` · `GET /health/db` | Prova de vida do processo (keep-alive/monitor) e checagem do banco — as duas públicas |
| `GET/POST /webhook` | Verificação + recebimento de mensagens da Meta |
| `GET /numeros` · `POST /numeros/sync` | Lista e sincroniza números com o Business Manager |
| `POST /numeros/:id/pausar` · `/ativar` | Pausa/ativa um número manualmente |
| `GET /numeros/templates` | Templates aprovados, agrupados por nome+idioma |
| `GET /templates` | Biblioteca: todos os templates (todos os status) |
| `POST /templates` · `POST /templates/clonar` | Cria/clona template numa WABA |
| `GET/POST /agentes` · `PUT/DELETE /agentes/:id` | CRUD dos agentes configuráveis |
| `GET/POST/DELETE /agentes/etiquetas` | Etiquetas dos leads |
| `GET /agentes/leads` | Leads com etiquetas + qualificação |
| `GET/POST /nao-perturbe` · `/checar` · `/importar` | Lista de exclusão e scrub |
| `POST /campanhas` | Cria campanha e resolve o pool de canhões |
| `POST /campanhas/:id/contatos` | Enfileira a lista (já normalizada no navegador) |
| `POST /campanhas/:id/media` | Sobe mídia do header do template pros canhões |
| `POST /campanhas/:id/iniciar` · `/pausar` | Liga/desliga o processamento da fila |
| `GET /campanhas/:id` | Contadores (pendente/enviada/bloqueada/falhou) |
| `GET /campanhas/:id/relatorio.csv` | Relatório da campanha |
| `POST /campanhas/teste-envio` | 1 envio avulso de teste |
| `GET /conversas` · `GET /conversas/:telefone` | Lista de contatos e thread |
| `POST /conversas/:telefone/responder` | Resposta manual (só após automação "atendente_humano") |

## O que ficou de fora de propósito

O `exportDucke()` do Foguete antigo foi removido — era o hand-off pro sistema da Ducke,
exatamente a dependência que esta plataforma existe pra eliminar.
