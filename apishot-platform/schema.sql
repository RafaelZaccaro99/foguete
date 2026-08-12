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
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
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
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
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
  ('timezone', 'America/Sao_Paulo')
ON DUPLICATE KEY UPDATE valor = VALUES(valor);
