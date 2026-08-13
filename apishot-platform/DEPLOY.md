# Deploy — como colocar a Apishot Platform no ar

O app prepara o próprio banco no boot (schema, migrações e os 17 agentes-padrão) e se
recusa a subir com configuração insegura. Na prática: configurar as variáveis e ligar.

Três caminhos, escolha um. Se você já usa a Hostinger, o caminho A é o de sempre —
[`PASSO_A_PASSO_HOSTINGER.md`](./PASSO_A_PASSO_HOSTINGER.md) continua valendo, com menos
passos manuais.

---

## Variáveis de ambiente (vale para todos os caminhos)

Copie de [`.env.example`](./.env.example). As obrigatórias em produção:

| Variável | O que é | Como gerar |
|---|---|---|
| `NODE_ENV` | `production` | — |
| `PAINEL_SENHA` | senha do primeiro login (troque depois pela tela) | você escolhe |
| `SESSION_SECRET` | assina o cookie de login | `openssl rand -hex 32` |
| `VERIFY_TOKEN` | o que a Meta usa pra verificar a URL do webhook | você inventa |
| `META_APP_SECRET` | valida a assinatura do webhook | Meta → App → Configurações → Básico |
| `DB_HOST` `DB_USER` `DB_PASS` `DB_NAME` | banco MySQL | do painel/serviço de banco |

Opcionais: `WHATSAPP_TOKEN` (dá pra configurar pela tela), `PORT` (padrão 3000),
`TRUST_PROXY` (padrão 1), `COOKIE_SECURE`, `BOOTSTRAP_DB`.

Se faltar alguma obrigatória, o app **não sobe** e diz no log exatamente qual — é de
propósito: subir sem `META_APP_SECRET` significa aceitar webhook forjado, e sem
`SESSION_SECRET` qualquer um forja o cookie de login.

---

## Caminho A — Hostinger (Node.js App do hPanel)

1. **Banco**: hPanel → Bancos de dados → MySQL Databases → criar. Anote nome/usuário/senha.
   *Não precisa mais abrir o phpMyAdmin nem importar o `schema.sql` na mão.*
2. **Subdomínio**: Domínios → Subdomínios → `app.apishot.com.br`.
3. **App Node**: Avançado → Node.js → criar aplicação. Node 20.x, arquivo de
   inicialização `server/server.js`, raiz = pasta do subdomínio.
4. **Arquivos**: suba a pasta `apishot-platform` inteira (sem `node_modules`).
5. **Variáveis**: no painel do Node.js App, cadastre as da tabela acima.
6. **Instalar**: botão "Executar NPM Install" (ou SSH: `npm install`).
7. **Ligar**: reinicie a aplicação. No primeiro boot ela cria as tabelas, aplica
   migrações e carrega os agentes — acompanhe pelo log.
8. **Webhook na Meta**: Callback URL `https://app.apishot.com.br/webhook`, Verify Token =
   o `VERIFY_TOKEN`, campo `messages` marcado. O `META_APP_SECRET` tem que ser do MESMO app.
9. **Keep-alive**: monitor grátis no [UptimeRobot](https://uptimerobot.com) apontando pra
   `https://app.apishot.com.br/health` a cada 5 min — na hospedagem compartilhada o
   processo dorme sem tráfego, e com ele dormem o worker de disparo e o monitor de qualidade.
10. **Números**: abra `/numeros.html` → "🔭 Buscar de novo".

**Atualizar depois**: backup do banco (`mysqldump -u USER -p BANCO > backup.sql`), suba os
arquivos novos, `npm install`, reinicie. As migrações rodam sozinhas no boot e preservam
os dados.

---

## Caminho B — Docker (VPS própria)

```bash
cp .env.example .env      # preencha, incluindo DB_ROOT_PASS
docker compose up -d      # sobe app + MySQL
docker compose logs -f app
```

O `docker-compose.yml` sobe o MySQL com volume persistente (`dados-mysql`) e só inicia o
app quando o banco passa no healthcheck. O app fica em `http://IP:3000` — coloque um
nginx/Caddy/Cloudflare na frente pra ter HTTPS (o cookie de login sai com `Secure`, então
**precisa** de HTTPS; `TRUST_PROXY=1` já vem configurado pro proxy).

Backup do banco:

```bash
docker compose exec banco mysqldump -u root -p"$DB_ROOT_PASS" apishot > backup-$(date +%F).sql
```

Atualizar: `git pull && docker compose up -d --build`.

---

## Caminho C — PaaS (Railway, Render, Fly, Heroku…)

1. Aponte a plataforma pra este repositório (raiz do serviço: `apishot-platform`).
2. Crie um MySQL gerenciado na própria plataforma e ligue as variáveis `DB_*`.
3. Cadastre as demais variáveis da tabela acima.
4. Comando de start: `npm start` (o `Procfile` já declara isso; o `Dockerfile` também
   serve se a plataforma preferir build por imagem).
5. Health check da plataforma: `/health`.

Nada de volume ou disco persistente: todo o estado mora no MySQL. Escale para **1
instância** — o worker de disparo e o monitor de qualidade rodam dentro do processo, e
duas instâncias processariam a mesma fila em duplicidade.

---

## Conferir se subiu certo

| Checagem | Esperado |
|---|---|
| `curl https://SEU_DOMINIO/health` | `{"ok":true,...}` |
| `curl https://SEU_DOMINIO/health/db` | `{"ok":true,"banco":"ok"}` |
| abrir `/numeros.html` deslogado | redireciona pro login |
| `curl https://SEU_DOMINIO/numeros` | `401` |
| POST `/webhook` sem assinatura | `401` |
| login com a senha errada 9x | `429` (freio de tentativas) |
| log do boot | `banco pronto — ... agentes ...` |

Esses mesmos testes rodam a cada push no GitHub Actions
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)), contra um MySQL de verdade.

---

## Comandos úteis

| Comando | Pra quê |
|---|---|
| `npm start` | sobe o app (prepara o banco antes) |
| `npm run bootstrap` | só prepara o banco (schema + migração + agentes) |
| `npm run migrate` | só as migrações de coluna |
| `npm run seed` | só os agentes-padrão |
| `npm test` | testes (não precisa de banco nem token) |

Pra aplicar schema/migração na mão (mudança controlada em produção), suba com
`BOOTSTRAP_DB=false` e rode `npm run bootstrap` quando quiser.
