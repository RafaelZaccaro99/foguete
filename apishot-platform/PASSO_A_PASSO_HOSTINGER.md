# Passo a passo — subir a plataforma completa na Hostinger (apishot.com.br)

Isso é a versão expandida do primeiro passo a passo — agora com banco de dados MySQL,
porque a ferramenta ficou mais séria (números, contatos, lista de não perturbe, log).

## Passo 0 — confirmar independência da Ducke (ver PROMPT_IMPLEMENTACAO.md seção 1)
NÃO conecta nada de produção antes disso estar confirmado.

## Passo 1 — Criar o banco de dados
No hPanel: **Bancos de dados → MySQL Databases → Criar novo banco de dados.**
Anota: nome do banco, usuário e senha (você vai usar no `.env`).

Depois, no **phpMyAdmin** (também no hPanel), abre o banco criado e roda o conteúdo do
arquivo `schema.sql` (Importar → escolhe o arquivo → Executar). Isso cria todas as tabelas.

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
`VERIFY_TOKEN`, `WHATSAPP_TOKEN`, `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`, `PORT`.

## Passo 6 — Instalar dependências
Botão "Executar NPM Install" no painel do Node.js App (ou terminal SSH → `npm install`
dentro da pasta).

## Passo 7 — Reiniciar e testar
Reinicia a aplicação. Abre `https://app.apishot.com.br/` — deve responder
"Apishot Platform no ar. Rotas: /webhook · /numeros · /conversas".

## Passo 8 — Cadastrar os números na tabela `numeros`
Antes de disparar de verdade, cadastra cada número que vai usar via
`POST https://app.apishot.com.br/numeros` (Postman ou o próprio painel, quando o Rafael
montar a tela) com `phone_number_id`, `waba_id`, `label` e `limite_diario`. Sem isso, o
monitoramento de qualidade não vai saber quais números checar.

## Passo 9 — Cadastrar o webhook na Meta
Igual ao passo a passo anterior: Callback URL = `https://app.apishot.com.br/webhook`,
Verify Token = o mesmo do `.env`, campo "messages" marcado.

## Passo 10 — Testar os critérios de aceite
Ver seção 10 do `PROMPT_IMPLEMENTACAO.md` — são 6 testes, faz todos antes de considerar
pronto pra produção.
