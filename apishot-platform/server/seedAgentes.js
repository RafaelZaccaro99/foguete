/**
 * As 17 automações originais viraram "agentes" no banco. Este arquivo guarda os
 * dados-semente e faz a carga inicial (idempotente: só popula se a tabela estiver
 * vazia). Rodar uma vez depois do schema:  node server/seedAgentes.js
 */
if (require.main === module) require('dotenv').config(); // CLI: carrega .env antes de abrir o pool
const { query } = require('./db');

// chave = id estável (o mesmo id string de antes) pra código que precisa reconhecer
// um agente específico (ex: atendente_humano habilita a resposta manual na tela).
const AGENTES_PADRAO = [
  {
    chave: 'opt_out', nome: 'Opt-out / para de mandar', prioridade_maxima: true,
    gatilhos: ['para de mandar', 'nao quero mais', 'descadastrar', 'sair da lista', 'remover meu numero', 'pare', 'nao mandem mais', 'tira meu numero'],
    resposta: 'Combinado, você não vai mais receber mensagens nossas. Se mudar de ideia, é só chamar.',
    acao_extra: 'adicionar_nao_perturbe',
  },
  {
    chave: 'atendente_humano', nome: 'Quero falar com atendente',
    gatilhos: ['quero falar com alguem', 'quero atendente', 'quero falar com humano', 'pode me ligar', 'falar com uma pessoa'],
    resposta: 'Claro, já vou te passar pra equipe. Só confirma seu nome e cidade que eu encaminho agora.',
  },
  {
    chave: 'preco_mensalidade', nome: 'Quanto custa / tem mensalidade',
    gatilhos: ['quanto custa', 'qual o valor', 'tem mensalidade', 'e pago', 'quanto e', 'qual o preco'],
    resposta: 'Não tem mensalidade. A condição da campanha é: sem mensalidade na NAPP, sem mensalidade no Vendi+ e taxa de 12% (em vez dos 18% padrão). Isso vale até 31/08 ou até fechar 10.000 farmácias, o que vier primeiro. Quer que eu confirme sua vaga agora?',
  },
  {
    chave: 'como_funciona', nome: 'Como funciona / o que é isso',
    gatilhos: ['como funciona', 'o que e isso', 'nao entendi', 'explica melhor', 'do que se trata'],
    resposta: 'Simples: você passa a vender pelo iFood sem precisar aprender nada disso sozinho — a gente monta o catálogo, cadastra os produtos e você recebe o pedido pra separar. O sistema (Vendi+) cuida da parte chata, você só entrega.',
  },
  {
    chave: 'cidade_sem_ifood', nome: 'Minha cidade não tem iFood ainda',
    gatilhos: ['nao tem ifood na minha cidade', 'ifood nao chegou aqui', 'aqui nao tem ifood'],
    resposta: 'Sem problema — deixa seu interesse registrado mesmo assim, porque o iFood vai expandindo e quem já tá na fila entra primeiro quando abrir na sua região.',
  },
  {
    chave: 'cadastro_manual', nome: 'Preciso cadastrar produto na mão?',
    gatilhos: ['preciso cadastrar', 'tenho que subir os produtos', 'quem monta o catalogo', 'da trabalho pra mim'],
    resposta: 'Não. Vocês não cadastram nada na mão — a equipe monta seu catálogo pra você. Sua parte é só confirmar os produtos e preços.',
  },
  {
    chave: 'ja_vende_ifood', nome: 'Já vendo no iFood, isso serve pra mim?',
    gatilhos: ['ja vendo no ifood', 'ja tenho loja no ifood', 'ja uso o ifood'],
    resposta: 'Neste momento, não — a proposta aqui é para novos clientes no iFood.',
  },
  {
    chave: 'como_aderir', nome: 'Como faço pra aderir / dar meu aceite',
    gatilhos: ['como aderir', 'como entro', 'como faco pra participar', 'quero entrar', 'quero aderir'],
    resposta: 'É rápido: clica no link que te mandei e preencha todo formulário e automaticamente você estará na fila para integração.',
  },
  {
    chave: 'confiabilidade', nome: 'É golpe? / Isso é confiável?',
    gatilhos: ['isso e golpe', 'e confiavel', 'e serio isso', 'e verdade'],
    resposta: 'É real — trabalhamos direto com o ecossistema oficial de farmácias no iFood (NAPP/Vendi+/iFood), já são mais de 4.350 farmácias conectadas, o seu sistema de farmácia sem dúvida faz parte dessa parceria (pode perguntar a eles).',
  },
  {
    chave: 'prazo_promocao', nome: 'Até quando vale a condição / prazo',
    gatilhos: ['ate quando vale', 'qual o prazo', 'ate quando e essa condicao', 'vence quando'],
    resposta: 'Vale até 31/08 ou até fecharem 10.000 farmácias — o que acontecer primeiro. Depois disso volta pro padrão. Se você tem interesse, o momento de garantir é agora. Se você preencher o formulário dentro da promoção, terá esses benefícios durante todo o tempo que estiver vendendo no iFood.',
  },
  {
    chave: 'ja_tem_pdv', nome: 'Já tenho sistema/PDV, dá pra integrar?',
    gatilhos: ['ja tenho sistema', 'uso outro pdv', 'tenho programa de farmacia', 'da pra integrar'],
    resposta: 'Dá sim, a equipe olha seu caso e vê a melhor forma de conectar sem bagunçar o que você já usa. Me conta qual sistema você usa hoje que eu já te falo se é imediato ou se precisa de um ajuste.',
  },
  {
    chave: 'entrega', nome: 'Como funciona a entrega',
    gatilhos: ['quem entrega', 'e o ifood que entrega', 'preciso de motoboy', 'como e a entrega'],
    resposta: 'Depende da sua configuração no iFood — pode ser entrega própria ou pela frota do iFood. A equipe te ajuda a decidir o melhor formato pro seu bairro na hora de montar.',
  },
  {
    chave: 'ja_tentou_antes', nome: 'Testei antes e não deu certo / desisti',
    gatilhos: ['ja tentei antes', 'nao deu certo', 'desisti', 'nao funcionou pra mim'],
    resposta: 'Entendo — muita coisa mudou desde então, principalmente a taxa (caiu pra 12%), você não terá mensalidade da NAPP nem da Vendi+, que fará toda sua gestão de vendas. Vale a pena olhar de novo com essas condições.',
  },
  {
    chave: 'porte_pequeno', nome: 'Vale a pena pro meu porte',
    gatilhos: ['sou pequeno', 'minha farmacia e pequena', 'vale a pena pra mim', 'sou de bairro'],
    resposta: 'Vale — a estrutura foi pensada justamente pra quem não tem equipe de marketing nem TI. Você não precisa contratar ninguém novo, o sistema já entrega isso pronto.',
  },
  {
    chave: 'tempo_ativacao', nome: 'Quanto tempo demora pra ativar',
    gatilhos: ['quanto tempo demora', 'quando comeco a vender', 'quanto tempo pra ativar'],
    resposta: 'Depois do seu aceite, a montagem do catálogo costuma ser rápida — geralmente você já está vendendo em poucos dias. A equipe te avisa o passo a passo assim que confirmar.',
  },
  {
    chave: 'pedir_catalogo', nome: 'Pedir catálogo/material',
    gatilhos: ['manda o catalogo', 'tem material', 'quero ver mais detalhes', 'manda mais informacao'],
    resposta: 'Claro! Segue o material explicando direitinho como funciona.',
  },
  {
    chave: 'duracao_beneficio', nome: 'Até quando dura o benefício depois de conectar',
    gatilhos: ['ate quando dura o beneficio', 'tenho isso pra sempre', 'essa condicao e pra sempre', 'dura quanto tempo depois que eu conectar', 'e so no comeco ou continua'],
    resposta: 'Enquanto você estiver no iFood, terá os benefícios.',
  },
];

async function seed() {
  const rows = await query('SELECT COUNT(*) AS total FROM agentes');
  if ((rows[0]?.total || 0) > 0) return { pulado: true, total: rows[0].total };

  let prioridade = 10;
  for (const a of AGENTES_PADRAO) {
    const r = await query(
      'INSERT INTO agentes (nome, chave, ativo, prioridade, prioridade_maxima, resposta, acao_extra) VALUES (?, ?, TRUE, ?, ?, ?, ?)',
      [a.nome, a.chave, a.prioridade_maxima ? 0 : prioridade, !!a.prioridade_maxima, a.resposta, a.acao_extra || null]
    );
    const agenteId = r.insertId;
    for (const g of a.gatilhos) {
      await query('INSERT INTO agente_gatilhos (agente_id, gatilho) VALUES (?, ?)', [agenteId, g]);
    }
    if (!a.prioridade_maxima) prioridade += 10;
  }
  return { criados: AGENTES_PADRAO.length };
}

if (require.main === module) {
  seed()
    .then(r => { console.log('seed agentes:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { AGENTES_PADRAO, seed };
