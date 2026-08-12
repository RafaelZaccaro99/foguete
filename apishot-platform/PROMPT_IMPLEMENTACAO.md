# PROMPT DE IMPLEMENTAÇÃO — Disparador Independente Apishot (com bot e compliance)
Para: Rafael Sargento | De: Ti Ferrara | Data: 12/08/2026

## 0. POR QUE ISSO EXISTE (contexto obrigatório de ler antes de codar)
Hoje, 11/08, todos os chips de disparo pararam ao mesmo tempo. Investigando o Business
Manager da Meta, achamos a causa raiz: **a DUCKE está cadastrada como PARCEIRA (Partner)
das contas de WhatsApp (WABA)** em Configurações → Contas do WhatsApp → Parceiros. Ou seja,
o Foguete (nossa ferramenta) SEMPRE dependeu da Ducke por baixo — mesmo disparando pela
nossa tela, o acesso técnico passava pela parceria dela. Quando a Ducke teve problema,
tudo caiu junto, mesmo sem termos feito nada de errado.

**Objetivo desta implementação: zerar essa dependência.** Construir uma ferramenta 100%
nossa — disparo, resposta automática (bot) e proteção contra bloqueio — sem depender de
nenhum parceiro terceiro pra funcionar.

## 1. PASSO ZERO — não é código, é configuração na Meta (fazer ANTES de tudo)
Sem isso, o resto não adianta — a ferramenta nova herdaria a mesma dependência.

1. No Business Manager (Meta), ir em **Configurações do negócio → Contas do WhatsApp**.
2. Pra cada WABA/número: abrir a aba **Parceiros** e **remover o acesso da Ducke** (ou, se
   por algum motivo não puder remover ainda, pelo menos confirmar que o NOSSO usuário de
   sistema tem papel de **Admin completo**, não só visualização).
3. Confirmar que existe um **usuário de sistema (System User) próprio**, dentro do NOSSO
   Business Manager (não do BM da Ducke), com token permanente e as 3 permissões:
   `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`.
   (Isso já existe — é o usuário "Foguete Disparos Pingola" citado no doc 12. Só precisa
   confirmar que ele continua tendo acesso DEPOIS de tirar a Ducke do meio.)
4. Testar 1 envio manual pela Graph API direto (Postman ou curl) usando só esse token, SEM
   a Ducke logada em lugar nenhum, pra provar que a dependência foi quebrada antes de seguir
   pra produção.

**Esse passo é do Ti, não do Rafael** — mas o Rafael não deve começar a apontar a
ferramenta nova pros números até esse passo estar confirmado, senão constrói em cima da
mesma fragilidade.

## 2. ARQUITETURA GERAL
Um servidor Node.js (Express) na Hostinger (já confirmado: plano suporta Node 18-24,
Express, MySQL disponível no hPanel), com 4 peças:

```
DISPARO (mantém a lógica que já existe no Foguete/api_shot_atual.html)
   ↓
BANCO DE DADOS (MySQL — números, contatos, campanhas, mensagens, lista de não perturbe, log)
   ↓
COMPLIANCE (roda ANTES de cada envio — corta quem não pode receber)
   ↓
BOT/AUTOMAÇÕES (roda quando o cliente responde — reconhece a dúvida, manda resposta pronta)
   ↓
PAINEL (3 telas: Disparo/Campanhas, Conversas, Números)
```

Regra igual à do documento do Alessandro (vale reforçar pro Rafael): **nada de IA
generativa livre**. O bot reconhece intenção (palavra-chave, ou IA só de classificação
depois) e responde com texto JÁ CADASTRADO. Nunca inventa.

## 3. MÓDULO 1 — DISPARO
Reaproveitar a lógica que já existe e funciona no `api_shot_atual.html` (revezamento de
canhões, templates por conta, upload de CSV, etc — está tudo funcionando, só precisa
migrar pra rodar server-side em vez de só client-side, e gravar cada envio no banco em vez
de só no relatório CSV local).

Adição obrigatória nesta migração: **antes de cada envio, passar pelo módulo de
compliance (seção 5)** — se o contato estiver na lista de não perturbe ou fora do
horário permitido, PULA o envio e registra o motivo, não força.

## 4. MÓDULO 2 — BOT / AUTOMAÇÕES (respostas automáticas)
Já especificado e testado — ver arquivo `automations.js` neste pacote. São 16 automações
(dúvidas de farmácia/petshop) + 1 nova que este pacote adiciona:

**Automação 17 — Opt-out / "para de mandar"**
Gatilhos: para de mandar, nao quero mais, descadastrar, sair da lista, remover meu numero,
pare, nao mandem mais, tira meu numero
Resposta: "Combinado, você não vai mais receber mensagens nossas. Se mudar de ideia, é só
chamar."
Ação: além de responder, marca o contato na tabela `nao_perturbe` automaticamente. Esse é
o ponto mais importante de compliance do bot inteiro — trata como prioridade 1 (roda antes
de qualquer outra automação, mesmo que a mensagem também bata em outro gatilho).

## 5. MÓDULO 3 — COMPLIANCE (proteção contra bloqueio)
Este é o módulo que faltava e que o Ti pediu explicitamente. Roda em dois momentos:

### 5.1 Antes de disparar (bloqueia envio)
- **Lista de não perturbe**: tabela `nao_perturbe` (telefone, data, origem). Antes de
  disparar pra qualquer lista, filtra fora quem está nela. Um contato entra nessa lista:
  (a) automaticamente pela automação 17 (pediu pra parar), (b) manualmente por upload de
  uma lista de exclusão, (c) automaticamente se a Meta reportar o contato como tendo
  bloqueado ou denunciado o número (ver 5.2).
- **Janela de horário**: só dispara entre 08h e 20h (horário de Brasília). Fora disso, a
  fila não dispara — fica pendente até abrir a janela do dia seguinte (não cancela, só
  adia). Isso é regra de negócio configurável (guardar em tabela `config`, não hardcoded,
  pra poder ajustar sem redeploy).
- **Limite diário por número**: cada número tem um teto (hoje o Foguete já mostra isso na
  tela — reaproveitar). Não deixar passar do limite mesmo que a lista seja maior.
- **Aquecimento de número novo**: número recém-conectado começa com cota bem menor
  (sugestão: 20% do limite normal na primeira semana, subindo aos poucos) — evita que
  número novo tome susto de bloqueio por sair mandando volume alto de cara.

### 5.2 Monitoramento contínuo (roda em background, ex: a cada 1h)
- **Consulta o quality rating de cada número** direto na Graph API
  (`GET /{phone_number_id}?fields=quality_rating,messaging_limit`). Se um número cair pra
  amarelo, alerta. Se cair pra vermelho, **pausa esse número automaticamente** do
  revezamento até alguém revisar manualmente — não deixa ele continuar tomando disparo.
- Guarda o histórico de quality rating por número na tabela `numeros_historico` — assim dá
  pra ver se a queda foi gradual (aviso, dava pra ter agido antes) ou repentina.
- Sempre que a Meta manda webhook de mensagem com sinal de bloqueio/denúncia do contato
  (quando disponível no payload), registra e joga esse contato pra lista de não perturbe
  automaticamente.

## 6. MÓDULO 4 — TELA DE CONVERSAS
Não é inbox de atendimento completo (o Ti foi claro nisso desde o início — ver doc 18).
É uma tela de consulta: lista de contatos que responderam, o que escreveram, qual
automação (se alguma) foi disparada de volta, e um botão simples de "responder manual"
só pra quando a automação 1 (quero atendente) foi acionada — aí sim alguém humano
assume aquele contato específico, sem virar central de atendimento genérica.

## 7. MÓDULO 5 — TELA DE GESTÃO DE NÚMEROS
Lista de todos os números conectados com: nome/label, WABA de origem, quality rating
atual (verde/amarelo/vermelho), limite diário, quanto já disparou hoje, status
(ativo/pausado/aquecendo), e botão manual de pausar/reativar. É a tela que fecha o
requisito do Ti de "gerir os números que estão conectados ali".

## 8. BANCO DE DADOS
Ver `schema.sql` neste pacote — tabelas: `numeros`, `contatos`, `nao_perturbe`,
`campanhas`, `mensagens`, `eventos_log`, `config`.

## 9. INFRAESTRUTURA — HOSTINGER
Reaproveitar o que já foi levantado (ver `PASSO_A_PASSO_HOSTINGER.md` neste pacote):
Node.js App no hPanel, rodando num subdomínio separado do site principal (ex:
`app.apishot.com.br`), com banco MySQL criado também pelo hPanel (Bancos de dados →
MySQL Databases). Protocolo de segurança de sempre: ambiente separado, testar antes de
migrar, ponto de restauração salvo antes de qualquer alteração em cima do que já roda.

## 10. CRITÉRIOS DE ACEITE
1. Disparar uma lista de teste (100 contatos) SEM a Ducke logada em lugar nenhum — sucesso
   confirma que a dependência foi quebrada de verdade.
2. Colocar um número de teste na lista de não perturbe e confirmar que ele NÃO recebe no
   próximo disparo.
3. Disparar fora da janela 08h-20h e confirmar que fica pendente, não sai na hora.
4. Mandar "para de mandar" de um número de teste e confirmar: (a) recebe a resposta de
   confirmação, (b) esse número aparece automaticamente na lista de não perturbe.
5. Simular quality rating vermelho num número de teste (ou aguardar um caso real) e
   confirmar que ele sai do revezamento sozinho.
6. As 16 automações de dúvida respondendo certo (já testado no pacote anterior).

## 11. O QUE NÃO MUDA (reforçando pro Rafael)
Mesmas regras do documento original: não reconstruir o disparo do zero (a lógica de
revezamento de canhões, templates por conta, upload de CSV já funciona, só migra pra
server-side), não virar chatbot generativo livre, não virar central de atendimento cheia.
