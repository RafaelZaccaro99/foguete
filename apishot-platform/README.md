# Apishot Platform

Disparador de WhatsApp independente (sem depender da Ducke ou de nenhum parceiro
terceiro), com bot de respostas automáticas e módulo de compliance. Contexto completo em
[`PROMPT_IMPLEMENTACAO.md`](./PROMPT_IMPLEMENTACAO.md); passo a passo de deploy na
Hostinger em [`PASSO_A_PASSO_HOSTINGER.md`](./PASSO_A_PASSO_HOSTINGER.md).

## Rodar local

```bash
npm install
cp .env.example .env       # preenche VERIFY_TOKEN, WHATSAPP_TOKEN, DB_*
# cria o banco e roda schema.sql nele (MySQL local ou remoto)
node server/seedAgentes.js # carrega as 17 automações-padrão como agentes (roda 1x)
npm test                   # revezamento, automações, curva de aquecimento, scrub
npm start                  # sobe em http://localhost:3000
```

O painel abre em `/` (tela inicial com o campo de token e um resumo) e tem barra
lateral com: Início, Disparo, Conversas, Números, Templates e Agentes. O token do
WhatsApp pode ser configurado direto na tela inicial (salvo no servidor, nunca no
navegador) — ou pelo `WHATSAPP_TOKEN` do `.env` como fallback.

## Estrutura

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

## Módulo Email

Disparo de campanhas por **email** com a mesma filosofia do WhatsApp: fila + worker +
compliance. Tela nova no painel (✉️ Email), SMTP próprio (Hostinger, Gmail com senha de
app, Brevo — qualquer um), sem custo por envio.

- `server/emailStore.js` — config SMTP/remetente (tela → banco, .env como fallback; a
  senha nunca vai pro navegador).
- `server/emailDisparo.js` — funções puras: validação/normalização da lista colada,
  variáveis `{{nome}}`/`{{email}}`, texto → HTML com auto-link, assinatura HMAC dos
  links públicos e rastreio (pixel de abertura, redirect de clique, rodapé de
  descadastro). Testado em `test/email.test.js`.
- `server/emailSender.js` — envio via nodemailer num lugar só.
- `server/emailFilaWorker.js` — worker em intervalo (`email_intervalo_segundos`):
  respeita a MESMA janela de horário do WhatsApp, a lista `email_descadastro`, o
  limite deslizante por hora (`email_limite_hora`, protege a reputação do domínio) e
  re-tenta só erro transitório (`email_max_tentativas`).
- `server/routes/email.js` — API do painel (atrás de login, em `/email`).
- `server/routes/emailPublico.js` — rotas públicas em `/e` (pixel, clique,
  descadastro), protegidas por assinatura HMAC em cada link — sem assinatura válida
  responde 404, e o redirect de clique só aceita a URL que foi assinada no envio
  (não vira open-redirect).

| Rota | O que faz |
|---|---|
| `GET/POST /email/config` · `POST /email/config/testar` | Config SMTP (mascarada) e teste de conexão |
| `POST /email/campanhas` | Cria campanha (nome, assunto, corpo) |
| `POST /email/campanhas/:id/contatos` | Enfileira a lista colada (dedupe + scrub descadastro) |
| `POST /email/campanhas/:id/iniciar` · `/pausar` | Liga/desliga a fila |
| `GET /email/campanhas` · `/:id` | Campanhas com contadores + abertos/cliques |
| `GET /email/campanhas/:id/relatorio.csv` | Relatório com abertura/clique por contato |
| `POST /email/teste-envio` | 1 envio avulso de teste (sem rastreio) |
| `GET /email/descadastro` · `POST /email/descadastro/importar` | Lista de exclusão |
| `GET /e/abrir/:id/:sig.gif` · `/e/clique/:id/:sig` · `/e/descadastro/:id/:sig` | Rastreio público (assinado) |

**Importante:** preencha a "URL pública do painel" na tela de config — sem ela o email
sai sem pixel e **sem link de descadastro** (ok pra teste, não pra campanha de verdade).
Quem já tinha o banco: rode o `schema.sql` de novo (só cria as tabelas novas) — não
precisa de migrate.

## O que ficou de fora de propósito

O `exportDucke()` do Foguete antigo foi removido — era o hand-off pro sistema da Ducke,
exatamente a dependência que esta plataforma existe pra eliminar.
