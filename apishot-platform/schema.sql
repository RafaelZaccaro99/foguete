-- Apishot Platform — schema MySQL
-- Criar o banco no hPanel (Bancos de dados → MySQL Databases) e rodar este arquivo nele.

CREATE TABLE IF NOT EXISTS numeros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone_number_id VARCHAR(64) NOT NULL UNIQUE,   -- id do número na Meta
  waba_id VARCHAR(64) NOT NULL,                  -- id da conta (WABA) dona do número
  label VARCHAR(120) NOT NULL,                   -- nome amigável (ex: "Equipe Ti Ferrara")
  limite_diario INT NOT NULL DEFAULT 1000,
  em_aquecimento BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('ativo','pausado','aquecendo') NOT NULL DEFAULT 'ativo',
  quality_rating VARCHAR(20) DEFAULT NULL,       -- GREEN / YELLOW / RED (vindo da Meta)
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS numeros_historico (
  id INT AUTO_INCREMENT PRIMARY KEY,
  numero_id INT NOT NULL,
  quality_rating VARCHAR(20),
  verificado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (numero_id) REFERENCES numeros(id)
);

CREATE TABLE IF NOT EXISTS contatos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  telefone VARCHAR(20) NOT NULL UNIQUE,
  nome VARCHAR(120),
  qualificacao VARCHAR(30) NOT NULL DEFAULT 'novo',  -- estágio do lead (novo/quente/morno/frio/qualificado/descartado…)
  numero_id INT DEFAULT NULL,                         -- último número por onde falou
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Etiquetas (tags) que os agentes aplicam nos contatos.
CREATE TABLE IF NOT EXISTS etiquetas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(60) NOT NULL UNIQUE,
  cor VARCHAR(20) DEFAULT '#16c95f',
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contato_etiquetas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  telefone VARCHAR(20) NOT NULL,
  etiqueta_id INT NOT NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_contato_etiqueta (telefone, etiqueta_id),
  FOREIGN KEY (etiqueta_id) REFERENCES etiquetas(id) ON DELETE CASCADE
);

-- Agentes = automações configuráveis pela tela. Cada agente reconhece intenção por
-- gatilhos (palavra-chave), responde com texto JÁ cadastrado (nunca gera), e pode
-- etiquetar e/ou qualificar o lead. Substitui as 17 automações fixas do código.
CREATE TABLE IF NOT EXISTS agentes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  chave VARCHAR(60) DEFAULT NULL,                    -- id estável (ex: 'atendente_humano') pros seeds; NULL nos criados na tela
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  prioridade INT NOT NULL DEFAULT 100,               -- menor = checado antes
  prioridade_maxima BOOLEAN NOT NULL DEFAULT FALSE,  -- roda antes de todos (ex: opt-out)
  resposta TEXT,                                     -- texto cadastrado enviado ao lead
  etiqueta_id INT DEFAULT NULL,                      -- etiqueta aplicada quando casa
  qualificacao VARCHAR(30) DEFAULT NULL,             -- estágio setado no lead quando casa
  acao_extra VARCHAR(60) DEFAULT NULL,               -- ex: adicionar_nao_perturbe
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (etiqueta_id) REFERENCES etiquetas(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS agente_gatilhos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agente_id INT NOT NULL,
  gatilho VARCHAR(120) NOT NULL,
  FOREIGN KEY (agente_id) REFERENCES agentes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nao_perturbe (
  id INT AUTO_INCREMENT PRIMARY KEY,
  telefone VARCHAR(20) NOT NULL UNIQUE,
  origem ENUM('opt_out_automatico','upload_manual','bloqueio_denuncia') NOT NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campanhas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(160) NOT NULL,
  template_nome VARCHAR(160),
  template_idioma VARCHAR(20),
  categoria VARCHAR(20),
  mensagem_corpo TEXT,                 -- snapshot do corpo do template no momento da criação (auditoria)
  media_url VARCHAR(500) DEFAULT NULL, -- link https direto do arquivo (alternativa a subir o arquivo por canhão)
  status ENUM('rascunho','em_andamento','pausada','concluida') NOT NULL DEFAULT 'rascunho',
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- pool de números resolvido na criação da campanha: quais números disparam,
-- com qual template (o principal ou um mapeado na mão) e quanto cada um manda.
CREATE TABLE IF NOT EXISTS campanha_numeros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campanha_id INT NOT NULL,
  numero_id INT NOT NULL,
  template_nome VARCHAR(160) NOT NULL,
  template_idioma VARCHAR(20) NOT NULL,
  modo ENUM('auto','manual') NOT NULL DEFAULT 'auto',
  media_id VARCHAR(120) DEFAULT NULL,
  cota_manual INT DEFAULT NULL,
  ordem INT NOT NULL DEFAULT 0,
  FOREIGN KEY (campanha_id) REFERENCES campanhas(id),
  FOREIGN KEY (numero_id) REFERENCES numeros(id)
);

-- fila de contatos de cada campanha — o worker de disparo consome isto respeitando
-- compliance (horário, não-perturbe) e a quota diária de cada número do pool.
CREATE TABLE IF NOT EXISTS fila_disparo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campanha_id INT NOT NULL,
  telefone VARCHAR(20) NOT NULL,
  nome VARCHAR(120),
  status ENUM('pendente','enviada','bloqueada','falhou') NOT NULL DEFAULT 'pendente',
  motivo VARCHAR(60) DEFAULT NULL,
  numero_id INT DEFAULT NULL,
  wamid VARCHAR(120) DEFAULT NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (campanha_id) REFERENCES campanhas(id),
  FOREIGN KEY (numero_id) REFERENCES numeros(id)
);

CREATE TABLE IF NOT EXISTS mensagens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  wamid VARCHAR(120) UNIQUE,          -- id da mensagem na Meta
  campanha_id INT,
  numero_id INT,
  contato_telefone VARCHAR(20) NOT NULL,
  direcao ENUM('saida','entrada') NOT NULL,
  texto TEXT,
  status VARCHAR(20),                 -- enviada/entregue/lida/falhou (só pra 'saida')
  automacao_id VARCHAR(60),           -- qual automação respondeu (só pra 'entrada' respondida)
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campanha_id) REFERENCES campanhas(id),
  FOREIGN KEY (numero_id) REFERENCES numeros(id)
);

CREATE TABLE IF NOT EXISTS eventos_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  evento VARCHAR(60) NOT NULL,
  detalhes JSON,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS config (
  chave VARCHAR(60) PRIMARY KEY,
  valor VARCHAR(255) NOT NULL
);

INSERT INTO config (chave, valor) VALUES
  ('horario_inicio', '08:00'),
  ('horario_fim', '20:00'),
  ('timezone', 'America/Sao_Paulo'),
  ('aquecimento_curva_pct', '20,40,70,100'),
  ('disparo_concorrencia', '8'),
  ('disparo_intervalo_segundos', '30')
ON DUPLICATE KEY UPDATE valor = VALUES(valor);
