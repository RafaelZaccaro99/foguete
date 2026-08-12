# Apishot Platform

Disparador de WhatsApp independente (sem depender da Ducke ou de nenhum parceiro
terceiro), com bot de respostas automáticas e módulo de compliance. Contexto completo em
[`PROMPT_IMPLEMENTACAO.md`](./PROMPT_IMPLEMENTACAO.md); passo a passo de deploy na
Hostinger em [`PASSO_A_PASSO_HOSTINGER.md`](./PASSO_A_PASSO_HOSTINGER.md).

## Rodar local

```bash
npm install
cp .env.example .env   # preenche VERIFY_TOKEN, WHATSAPP_TOKEN, DB_*
# cria o banco e roda schema.sql nele (MySQL local ou remoto)
npm test                # revezamento de canhões, automações e curva de aquecimento
npm start                # sobe em http://localhost:3000
```

O painel fica em `/disparo.html`, `/conversas.html` e `/numeros.html`.

## Estrutura

- `server/automations.js` — as 17 automações (16 dúvidas + opt-out, prioridade máxima).
- `server/compliance.js` — não-perturbe, janela de horário, limite diário + aquecimento
  de número novo, monitor de quality rating (promove/pausa números automaticamente).
- `server/graphApi.js` — toda chamada à Graph API num lugar só (token nunca sai do
  servidor).
- `server/disparo.js` — funções puras do revezamento de canhões (resolverCanhoes,
  montarPlano, sequenciaCanhoes), portadas do Foguete antigo (`api_shot_atual.html`).
- `server/filaWorker.js` — worker que processa a fila de disparo respeitando compliance.
- `server/routes/` — `webhook.js`, `numeros.js`, `conversas.js`, `templates.js`,
  `campanhas.js`.
- `public/` — painel (3 telas, HTML/JS puro, sem build).

## Rotas principais

| Rota | O que faz |
|---|---|
| `GET/POST /webhook` | Verificação + recebimento de mensagens da Meta |
| `GET /numeros` · `POST /numeros/sync` | Lista e sincroniza números com o Business Manager |
| `POST /numeros/:id/pausar` · `/ativar` | Pausa/ativa um número manualmente |
| `GET /numeros/templates` | Templates aprovados, agrupados por nome+idioma |
| `POST /templates` · `POST /templates/clonar` | Cria/clona template numa WABA |
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
