# Passo a passo — subir a plataforma completa na Hostinger (apishot.com.br)

Isso é a versão expandida do primeiro passo a passo — agora com banco de dados MySQL,
porque a ferramenta ficou mais séria (números, contatos, lista de não perturbe, log).

> **Hospedar em outro lugar?** Ver [`DEPLOY.md`](./DEPLOY.md) — tem o caminho Docker
> (VPS própria) e o caminho PaaS (Railway/Render/Fly) além deste.
>
> **O que mudou desde a primeira versão deste guia:** o app agora prepara o banco
> sozinho no boot (cria as tabelas, aplica migrações e carrega os agentes-padrão) e
> confere as variáveis de ambiente antes de subir. Os passos manuais de phpMyAdmin e de
> `seedAgentes.js` via SSH saíram.

## Passo 0 — confirmar independência da Ducke (ver PROMPT_IMPLEMENTACAO.md seção 1)
NÃO conecta nada de produção antes disso estar confirmado.

## Passo 1 — Criar o banco de dados
No hPanel: **Bancos de dados → MySQL Databases → Criar novo banco de dados.**
Anota: nome do banco, usuário e senha (você vai usar nas variáveis de ambiente).

Só isso — **não precisa abrir o phpMyAdmin nem importar o `schema.sql`**. O app cria as
tabelas no primeiro boot e, se o banco for de uma versão anterior, adiciona as colunas
que faltam sem apagar nada.

## Passo 2 — Criar o subdomínio
**Domínios → Subdomínios → Criar novo subdomínio.** Sugestão: `app.apishot.com.br`
(separado do site principal e também separado do `bot.apishot.com.br` se esse já existir
de uma tentativa anterior).

## Passo 3 — Criar o app Node.js
**Avançado → Node.js → Criar aplicação.**
- Versão do Node: 20.x
- Raiz da aplicação: pasta do subdomínio criado
- Arquivo de inicialização: `server/server.js`

## Passo 4 — Subir os arquivos
Pelo Gerenciador de Arquivos ou FTP, sobe TODA a pasta `apishot-platform` (menos
`node_modules`, que não existe ainda) pra raiz configurada no Passo 3.

## Passo 5 — Configurar variáveis de ambiente
No painel do Node.js App → Variáveis de ambiente, adiciona TODAS as do `.env.example`:
`NODE_ENV=production`, `PAINEL_SENHA`, `SESSION_SECRET`, `VERIFY_TOKEN`, `META_APP_SECRET`,
`WHATSAPP_TOKEN` (opcional — dá pra configurar pela tela), `DB_HOST`, `DB_USER`, `DB_PASS`,
`DB_NAME`, `PORT`.
- **NODE_ENV**: `production` — liga o cookie de login seguro (HTTPS) e a conferência
  estrita das variáveis.
- **PAINEL_SENHA**: a senha de login do painel (você troca depois pela tela inicial).
- **SESSION_SECRET**: uma string longa e aleatória (assina o cookie de login).
  Gera com `openssl rand -hex 32`.
- **META_APP_SECRET**: o "Chave secreta do aplicativo" na Meta (App → Configurações →
  Básico). É o que valida a assinatura do webhook — **obrigatório em produção**.

Se faltar alguma dessas, o app não sobe e o log diz qual — é melhor do que subir inseguro.

## Passo 6 — Instalar dependências e testar
Botão "Executar NPM Install" no painel do Node.js App (ou terminal SSH → `npm install`
dentro da pasta). Depois, via SSH: `npm test` — cobre revezamento, automações, curva de
aquecimento e scrub, sem precisar de banco nem token real. Se algum teste falhar, não segue.

> Os 17 agentes-padrão são carregados sozinhos no primeiro boot (antes era
> `node server/seedAgentes.js` na mão). Pra rodar o preparo do banco separadamente —
> conferir antes de ligar o app, por exemplo — use `npm run bootstrap`.

## Passo 7 — Reiniciar e testar
Reinicia a aplicação. No log do primeiro boot deve aparecer `banco pronto — ... agentes
criados`. Abre `https://app.apishot.com.br/` — vai pedir a senha do painel
(a `PAINEL_SENHA`). Depois de logar, cai na tela inicial (token + resumo). O menu fica
na barra lateral. Abas: Início, Disparo, Conversas, Números, Templates, Agentes.

Confere também `https://app.apishot.com.br/health/db` — tem que responder
`{"ok":true,"banco":"ok"}`. Se der 503, é credencial de banco errada.

> **Atualizar no futuro** (nova versão): faça primeiro um **backup do banco**
> (phpMyAdmin → Exportar, ou SSH `mysqldump -u USER -p BANCO > backup.sql`), suba os
> arquivos novos, rode `npm install` e reinicie. As migrações de coluna rodam sozinhas
> no boot, são idempotentes e preservam os dados.

## Passo 8 — Sincronizar os números
Abre `https://app.apishot.com.br/numeros.html` e clica em "🔭 Buscar de novo" — isso varre
o Business Manager (pelo `WHATSAPP_TOKEN` do `.env`) e cadastra sozinho todos os números
das WABAs que o usuário de sistema tem acesso, cada um começando em `aquecendo`. Não
precisa mais cadastrar um por um na mão (dá pra fazer via `POST /numeros` também, se
precisar de um caso avulso).

## Passo 9 — Cadastrar o webhook na Meta
Igual ao passo a passo anterior: Callback URL = `https://app.apishot.com.br/webhook`,
Verify Token = o mesmo do `.env`, campo "messages" marcado. Confirma que o
`META_APP_SECRET` (Passo 5) é o do MESMO app — senão a validação de assinatura rejeita
os webhooks e o bot não responde.

## Passo 10 — Manter o processo acordado (keep-alive)
Na hospedagem Node compartilhada, o processo pode "dormir" quando ninguém acessa — e aí
o worker de disparo e o monitor de qualidade param. Crie um monitor grátis no
**UptimeRobot** (uptimerobot.com) do tipo HTTP(s) apontando pra
`https://app.apishot.com.br/health`, checando a cada 5 min. Isso mantém o processo vivo
e ainda te avisa se o site cair.

## Passo 11 — Testar os critérios de aceite
Ver seção 10 do `PROMPT_IMPLEMENTACAO.md` — são 6 testes, faz todos antes de considerar
pronto pra produção.
