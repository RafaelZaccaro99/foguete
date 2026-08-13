/**
 * Validação das variáveis de ambiente no boot — falha rápido e com mensagem clara.
 *
 * O erro que se quer evitar: o app sobe "funcionando", mas com SESSION_SECRET padrão
 * (qualquer um forja cookie de sessão) ou sem META_APP_SECRET (webhook sem assinatura).
 * Melhor não subir do que subir inseguro.
 *
 * Em desenvolvimento (NODE_ENV != production) as exigências de segurança viram avisos,
 * pra não atrapalhar quem está só rodando local.
 */

const SEGREDO_PADRAO = 'troque-esse-segredo-no-env';

function ehProducao() {
  return process.env.NODE_ENV === 'production';
}

// Em produção o cookie de sessão sai com Secure (só trafega em HTTPS). Dá pra desligar
// com COOKIE_SECURE=false em quem realmente serve por HTTP (não recomendado).
function cookieSeguro() {
  if (process.env.COOKIE_SECURE === 'false') return false;
  if (process.env.COOKIE_SECURE === 'true') return true;
  return ehProducao();
}

/**
 * @returns {{ erros: string[], avisos: string[] }}
 */
function conferir() {
  const erros = [];
  const avisos = [];
  const prod = ehProducao();
  const exigir = (msg) => (prod ? erros : avisos).push(msg);

  // --- banco: obrigatório sempre, o app não faz nada sem ele ---
  if (!process.env.DB_NAME) erros.push('DB_NAME não definido (nome do banco MySQL).');
  if (!process.env.DB_USER) erros.push('DB_USER não definido (usuário do MySQL).');
  if (!process.env.DB_HOST) avisos.push('DB_HOST não definido — assumindo localhost.');
  if (!process.env.DB_PASS) avisos.push('DB_PASS vazio — banco sem senha só se justifica em local.');

  // --- sessão ---
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) {
    exigir('SESSION_SECRET não definido — sem ele o cookie de login usa um segredo público e qualquer um consegue forjar sessão.');
  } else if (segredo === SEGREDO_PADRAO) {
    exigir('SESSION_SECRET ainda está com o valor de exemplo — troque por uma string aleatória longa.');
  } else if (segredo.length < 32) {
    avisos.push('SESSION_SECRET tem menos de 32 caracteres — gere um mais longo (openssl rand -hex 32).');
  }

  // --- webhook da Meta ---
  if (!process.env.VERIFY_TOKEN) {
    exigir('VERIFY_TOKEN não definido — a Meta não consegue verificar a URL do webhook.');
  }
  if (!process.env.META_APP_SECRET) {
    exigir('META_APP_SECRET não definido — sem ele a assinatura do webhook não é validada e qualquer um pode postar mensagens falsas em /webhook.');
  }

  if (prod && !cookieSeguro()) {
    avisos.push('COOKIE_SECURE=false em produção — o cookie de login vai trafegar em HTTP puro.');
  }

  return { erros, avisos };
}

/** Imprime avisos e, se houver erro, encerra o processo com a lista toda. */
function conferirOuMorrer() {
  const { erros, avisos } = conferir();
  for (const a of avisos) console.warn('aviso de configuração:', a);
  if (erros.length) {
    console.error('\nConfiguração incompleta — o app não vai subir:\n');
    for (const e of erros) console.error('  • ' + e);
    console.error('\nVer .env.example para o formato de cada variável.\n');
    process.exit(1);
  }
}

module.exports = { conferir, conferirOuMorrer, ehProducao, cookieSeguro, SEGREDO_PADRAO };
