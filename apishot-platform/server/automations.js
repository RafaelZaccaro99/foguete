/**
 * As 17 automações (16 dúvidas + opt-out).
 * Ordem = prioridade. Opt-out é SEMPRE checado primeiro, mesmo antes das outras 16,
 * porque é a peça de compliance mais importante do bot.
 */

function normalizar(txt) {
  return (txt || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const AUTOMACOES = [
  {
    id: 'opt_out',
    nome: 'Opt-out / para de mandar',
    prioridade_maxima: true, // roda antes de qualquer outra, mesmo se bater em mais de uma
    gatilhos: ['para de mandar', 'nao quero mais', 'descadastrar', 'sair da lista', 'remover meu numero', 'pare', 'nao mandem mais', 'tira meu numero'],
    resposta: 'Combinado, você não vai mais receber mensagens nossas. Se mudar de ideia, é só chamar.',
    acao_extra: 'adicionar_nao_perturbe',
  },
  {
    id: 'atendente_humano',
    nome: 'Quero falar com atendente',
    gatilhos: ['quero falar com alguem', 'quero atendente', 'quero falar com humano', 'pode me ligar', 'falar com uma pessoa'],
    resposta: 'Claro, já vou te passar pra equipe. Só confirma seu nome e cidade que eu encaminho agora.',
  },
  {
    id: 'preco_mensalidade',
    nome: 'Quanto custa / tem mensalidade',
    gatilhos: ['quanto custa', 'qual o valor', 'tem mensalidade', 'e pago', 'quanto e', 'qual o preco'],
    resposta: 'Não tem mensalidade. A condição da campanha é: sem mensalidade na NAPP, sem mensalidade no Vendi+ e taxa de 12% (em vez dos 18% padrão). Isso vale até 31/08 ou até fechar 10.000 farmácias, o que vier primeiro. Quer que eu confirme sua vaga agora?',
  },
  {
    id: 'como_funciona',
    nome: 'Como funciona / o que é isso',
    gatilhos: ['como funciona', 'o que e isso', 'nao entendi', 'explica melhor', 'do que se trata'],
    resposta: 'Simples: você passa a vender pelo iFood sem precisar aprender nada disso sozinho — a gente monta o catálogo, cadastra os produtos e você recebe o pedido pra separar. O sistema (Vendi+) cuida da parte chata, você só entrega.',
  },
  {
    id: 'cidade_sem_ifood',
    nome: 'Minha cidade não tem iFood ainda',
    gatilhos: ['nao tem ifood na minha cidade', 'ifood nao chegou aqui', 'aqui nao tem ifood'],
    resposta: 'Sem problema — deixa seu interesse registrado mesmo assim, porque o iFood vai expandindo e quem já tá na fila entra primeiro quando abrir na sua região.',
  },
  {
    id: 'cadastro_manual',
    nome: 'Preciso cadastrar produto na mão?',
    gatilhos: ['preciso cadastrar', 'tenho que subir os produtos', 'quem monta o catalogo', 'da trabalho pra mim'],
    resposta: 'Não. Vocês não cadastram nada na mão — a equipe monta seu catálogo pra você. Sua parte é só confirmar os produtos e preços.',
  },
  {
    id: 'ja_vende_ifood',
    nome: 'Já vendo no iFood, isso serve pra mim?',
    gatilhos: ['ja vendo no ifood', 'ja tenho loja no ifood', 'ja uso o ifood'],
    resposta: 'Neste momento, não — a proposta aqui é para novos clientes no iFood.',
  },
  {
    id: 'como_aderir',
    nome: 'Como faço pra aderir / dar meu aceite',
    gatilhos: ['como aderir', 'como entro', 'como faco pra participar', 'quero entrar', 'quero aderir'],
    resposta: 'É rápido: clica no link que te mandei e preencha todo formulário e automaticamente você estará na fila para integração.',
  },
  {
    id: 'confiabilidade',
    nome: 'É golpe? / Isso é confiável?',
    gatilhos: ['isso e golpe', 'e confiavel', 'e serio isso', 'e verdade'],
    resposta: 'É real — trabalhamos direto com o ecossistema oficial de farmácias no iFood (NAPP/Vendi+/iFood), já são mais de 4.350 farmácias conectadas, o seu sistema de farmácia sem dúvida faz parte dessa parceria (pode perguntar a eles).',
  },
  {
    id: 'prazo_promocao',
    nome: 'Até quando vale a condição / prazo',
    gatilhos: ['ate quando vale', 'qual o prazo', 'ate quando e essa condicao', 'vence quando'],
    resposta: 'Vale até 31/08 ou até fecharem 10.000 farmácias — o que acontecer primeiro. Depois disso volta pro padrão. Se você tem interesse, o momento de garantir é agora. Se você preencher o formulário dentro da promoção, terá esses benefícios durante todo o tempo que estiver vendendo no iFood.',
  },
  {
    id: 'ja_tem_pdv',
    nome: 'Já tenho sistema/PDV, dá pra integrar?',
    gatilhos: ['ja tenho sistema', 'uso outro pdv', 'tenho programa de farmacia', 'da pra integrar'],
    resposta: 'Dá sim, a equipe olha seu caso e vê a melhor forma de conectar sem bagunçar o que você já usa. Me conta qual sistema você usa hoje que eu já te falo se é imediato ou se precisa de um ajuste.',
  },
  {
    id: 'entrega',
    nome: 'Como funciona a entrega',
    gatilhos: ['quem entrega', 'e o ifood que entrega', 'preciso de motoboy', 'como e a entrega'],
    resposta: 'Depende da sua configuração no iFood — pode ser entrega própria ou pela frota do iFood. A equipe te ajuda a decidir o melhor formato pro seu bairro na hora de montar.',
  },
  {
    id: 'ja_tentou_antes',
    nome: 'Testei antes e não deu certo / desisti',
    gatilhos: ['ja tentei antes', 'nao deu certo', 'desisti', 'nao funcionou pra mim'],
    resposta: 'Entendo — muita coisa mudou desde então, principalmente a taxa (caiu pra 12%), você não terá mensalidade da NAPP nem da Vendi+, que fará toda sua gestão de vendas. Vale a pena olhar de novo com essas condições.',
  },
  {
    id: 'porte_pequeno',
    nome: 'Vale a pena pro meu porte',
    gatilhos: ['sou pequeno', 'minha farmacia e pequena', 'vale a pena pra mim', 'sou de bairro'],
    resposta: 'Vale — a estrutura foi pensada justamente pra quem não tem equipe de marketing nem TI. Você não precisa contratar ninguém novo, o sistema já entrega isso pronto.',
  },
  {
    id: 'tempo_ativacao',
    nome: 'Quanto tempo demora pra ativar',
    gatilhos: ['quanto tempo demora', 'quando comeco a vender', 'quanto tempo pra ativar'],
    resposta: 'Depois do seu aceite, a montagem do catálogo costuma ser rápida — geralmente você já está vendendo em poucos dias. A equipe te avisa o passo a passo assim que confirmar.',
  },
  {
    id: 'pedir_catalogo',
    nome: 'Pedir catálogo/material',
    gatilhos: ['manda o catalogo', 'tem material', 'quero ver mais detalhes', 'manda mais informacao'],
    resposta: 'Claro! Segue o material explicando direitinho como funciona.',
  },
  {
    id: 'duracao_beneficio',
    nome: 'Até quando dura o benefício depois de conectar',
    gatilhos: ['ate quando dura o beneficio', 'tenho isso pra sempre', 'essa condicao e pra sempre', 'dura quanto tempo depois que eu conectar', 'e so no comeco ou continua'],
    resposta: 'Enquanto você estiver no iFood, terá os benefícios.',
  },
];

function encontrarAutomacao(mensagemTexto) {
  const texto = normalizar(mensagemTexto);

  // opt-out sempre primeiro, não importa a ordem de prioridade das outras
  const optOut = AUTOMACOES.find(a => a.prioridade_maxima);
  if (optOut && optOut.gatilhos.some(g => texto.includes(g))) return optOut;

  for (const auto of AUTOMACOES) {
    if (auto.prioridade_maxima) continue; // já checado acima
    for (const gatilho of auto.gatilhos) {
      if (texto.includes(gatilho)) return auto;
    }
  }
  return null;
}

module.exports = { AUTOMACOES, encontrarAutomacao, normalizar };
