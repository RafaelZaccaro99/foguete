# =====================================================================
# Apishot Platform — instalador E atualizador pra Windows (mesmo comando)
#
# Roda TUDO sozinho: instala Git, Node.js e MariaDB (se faltarem),
# baixa/atualiza o código, cria/migra o banco local, escreve o .env,
# roda os testes e (re)sobe o servidor em http://localhost:3000.
#
# Como usar (PowerShell como ADMINISTRADOR) — o MESMO comando instala e atualiza:
#   Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/RafaelZaccaro99/foguete/claude/new-session-6qd15e/setup-windows.ps1 | iex
#
# Idempotente: pula o que já está instalado, migra o banco só no que falta,
# para o servidor antigo antes de subir o novo. Rode de novo a cada atualização.
# =====================================================================

# 'Continue' de propósito: mysql/git/npm escrevem avisos no stderr e, com 'Stop',
# o PowerShell 5.1 abortaria o script por causa de um simples aviso. Os erros de
# verdade são checados um a um pelo código de saída ($LASTEXITCODE).
$ErrorActionPreference = 'Continue'
$PastaDestino = 'C:\dev\foguete'
$Branch       = 'claude/new-session-6qd15e'
$DbNome       = 'apishot_local'
$DbUsuario    = 'apishot'
$DbSenha      = 'apishot123'

function Etapa($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)     { Write-Host "    OK: $msg" -ForegroundColor Green }
function Falha($msg)  { Write-Host "`nERRO: $msg" -ForegroundColor Red; Read-Host 'Pressione ENTER pra sair'; exit 1 }

function AtualizarPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}

# O winget instala os arquivos do MariaDB mas, na instalação silenciosa, muitas vezes
# NÃO cria nem liga o serviço do Windows — aí dá "Can't connect ... (10061)". Esta função
# garante o serviço no ar: liga se existir parado, ou cria do zero (inicializa a pasta de
# dados e registra o serviço) se não existir.
function GarantirServicoBanco($mysqlExe) {
  $svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'MariaDB|MySQL|ApishotDB' } | Select-Object -First 1
  if ($svc -and $svc.Status -eq 'Running') { Ok "serviço do banco já rodando ($($svc.Name))"; return }
  if ($svc) {
    try { Start-Service $svc.Name; Start-Sleep 3; Ok "serviço $($svc.Name) iniciado"; return } catch { }
  }

  Etapa 'Criando o serviço do banco pela primeira vez'
  $binDir    = Split-Path $mysqlExe
  $mysqld    = Join-Path $binDir 'mysqld.exe'
  $installDb = Join-Path $binDir 'mysql_install_db.exe'
  $dataDir   = Join-Path (Split-Path $binDir) 'data'
  $jaInit    = Test-Path (Join-Path $dataDir 'mysql')

  if (Test-Path $installDb) {
    # MariaDB
    if ($jaInit) { & $mysqld '--install' 'ApishotDB' "--datadir=$dataDir" | Out-Null }
    else         { & $installDb "--datadir=$dataDir" '--service=ApishotDB' | Out-Null }
  } else {
    # MySQL Oracle
    if (-not $jaInit) { & $mysqld '--initialize-insecure' "--datadir=$dataDir" | Out-Null }
    & $mysqld '--install' 'ApishotDB' "--datadir=$dataDir" | Out-Null
  }

  Start-Sleep 2
  try { Start-Service ApishotDB -ErrorAction Stop } catch { cmd /c 'net start ApishotDB' | Out-Null }
  Start-Sleep 3
  $ok = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'MariaDB|MySQL|ApishotDB' -and $_.Status -eq 'Running' }
  if (-not $ok) { Falha 'O serviço do banco foi criado mas não subiu. Reinicie o computador e rode o script de novo — se continuar, me mande o que apareceu.' }
  Ok 'serviço do banco criado e iniciado'
}

# --- 0. Checagens básicas -------------------------------------------------
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Falha 'Rode o PowerShell como ADMINISTRADOR (menu Iniciar -> PowerShell -> botão direito -> Executar como administrador).'
}
try { winget --version | Out-Null } catch { Falha 'winget não encontrado. Atualize o "Instalador de Aplicativo" pela Microsoft Store e tente de novo.' }

# --- 1. Git ----------------------------------------------------------------
Etapa 'Verificando o Git'
try { git --version | Out-Null; Ok 'Git já instalado' }
catch {
  winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
  AtualizarPath
  try { git --version | Out-Null; Ok 'Git instalado' } catch { Falha 'Git instalado mas não apareceu no PATH. Feche e reabra o PowerShell e rode o script de novo.' }
}

# --- 2. Node.js ------------------------------------------------------------
Etapa 'Verificando o Node.js'
try {
  $v = (node -v) -replace 'v',''
  if ([int]($v.Split('.')[0]) -lt 18) { throw 'versão antiga' }
  Ok "Node.js $v já instalado"
}
catch {
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  AtualizarPath
  try { node -v | Out-Null; Ok 'Node.js instalado' } catch { Falha 'Node instalado mas não apareceu no PATH. Feche e reabra o PowerShell e rode o script de novo.' }
}

# --- 3. MariaDB (compatível com MySQL) --------------------------------------
Etapa 'Verificando o banco de dados (MariaDB/MySQL)'
function AcharMysqlExe {
  $candidatos = @(
    (Get-ChildItem 'C:\Program Files\MariaDB*\bin\mysql.exe' -ErrorAction SilentlyContinue),
    (Get-ChildItem 'C:\Program Files\MySQL\*\bin\mysql.exe'  -ErrorAction SilentlyContinue)
  ) | Where-Object { $_ } | Select-Object -First 1
  if ($candidatos) { return $candidatos.FullName }
  try { return (Get-Command mysql -ErrorAction Stop).Source } catch { return $null }
}
$MysqlExe = AcharMysqlExe
if (-not $MysqlExe) {
  winget install --id MariaDB.Server -e --accept-source-agreements --accept-package-agreements
  AtualizarPath
  $MysqlExe = AcharMysqlExe
  if (-not $MysqlExe) { Falha 'MariaDB instalado mas o mysql.exe não foi encontrado. Reinicie o computador e rode o script de novo.' }
  Ok 'MariaDB instalado'
} else { Ok "banco encontrado: $MysqlExe" }

# garante que o serviço está de pé (cria do zero se o winget não tiver criado)
GarantirServicoBanco $MysqlExe

# --- 4. Parar o servidor antigo (se estiver rodando) ------------------------
Etapa 'Parando o servidor antigo, se estiver rodando'
try {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*server*server.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Ok 'servidor antigo parado (ou não havia nenhum)'
} catch { Ok 'nenhum servidor antigo pra parar' }

# --- 5. Baixar (ou atualizar) o repositório ---------------------------------
Etapa "Baixando/atualizando o projeto em $PastaDestino"
if (Test-Path (Join-Path $PastaDestino '.git')) {
  Push-Location $PastaDestino
  git fetch origin $Branch
  git checkout $Branch 2>$null
  # reset --hard: pega exatamente a versão do servidor, sem conflito de merge.
  # O .env não é rastreado pelo git, então NÃO é apagado (suas credenciais ficam).
  git reset --hard "origin/$Branch"
  $ok = ($LASTEXITCODE -eq 0)
  Pop-Location
  if (-not $ok) { Falha 'Não consegui atualizar o código. Confira sua internet e rode de novo.' }
  Ok 'código atualizado pra última versão'
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $PastaDestino) | Out-Null
  git clone --branch $Branch https://github.com/RafaelZaccaro99/foguete.git $PastaDestino
  if ($LASTEXITCODE -ne 0) { Falha 'git clone falhou. Confira sua internet e rode de novo.' }
  Ok 'repositório clonado'
}
$App = Join-Path $PastaDestino 'apishot-platform'

# --- 6. Banco de dados: criar banco, usuário e rodar o schema ---------------
Etapa 'Configurando o banco de dados local'
$sqlSetup = @"
CREATE DATABASE IF NOT EXISTS $DbNome;
CREATE USER IF NOT EXISTS '$DbUsuario'@'localhost' IDENTIFIED BY '$DbSenha';
GRANT ALL PRIVILEGES ON $DbNome.* TO '$DbUsuario'@'localhost';
FLUSH PRIVILEGES;
"@
# tenta root sem senha (padrão do MariaDB recém-instalado); se falhar, pergunta a senha
& $MysqlExe -u root -e $sqlSetup 2>$null
if ($LASTEXITCODE -ne 0) {
  $senhaRoot = Read-Host 'Digite a senha do usuário root do MySQL/MariaDB (a que você definiu na instalação)'
  & $MysqlExe -u root "-p$senhaRoot" -e $sqlSetup
  if ($LASTEXITCODE -ne 0) { Falha 'Não consegui acessar o banco como root. Confira a senha e rode o script de novo.' }
}
Get-Content (Join-Path $App 'schema.sql') -Raw | & $MysqlExe -u $DbUsuario "-p$DbSenha" $DbNome
if ($LASTEXITCODE -ne 0) { Falha 'Falhou ao rodar o schema.sql.' }
Ok "banco $DbNome pronto (10 tabelas)"

# --- 7. .env -----------------------------------------------------------------
Etapa 'Escrevendo o .env'
$envPath = Join-Path $App '.env'
if (-not (Test-Path $envPath)) {
@"
VERIFY_TOKEN=invente_uma_senha_aqui
WHATSAPP_TOKEN=fake_por_enquanto
DB_HOST=localhost
DB_USER=$DbUsuario
DB_PASS=$DbSenha
DB_NAME=$DbNome
PORT=3000
"@ | Set-Content -Path $envPath -Encoding ASCII
  Ok '.env criado (com WHATSAPP_TOKEN falso — troque pelo token real da Meta quando tiver)'
} else { Ok '.env já existia — mantido como está' }

# --- 8. Dependências + testes + migração --------------------------------------
Etapa 'Instalando dependências (npm install)'
Push-Location $App
npm install
if ($LASTEXITCODE -ne 0) { Pop-Location; Falha 'npm install falhou.' }
Ok 'dependências instaladas'

Etapa 'Rodando os testes (npm test)'
npm test
if ($LASTEXITCODE -ne 0) { Pop-Location; Falha 'Algum teste falhou — me mande a saída acima.' }
Ok 'todos os testes passaram'

Etapa 'Migrando o banco (adiciona colunas novas em bancos antigos)'
node server/migrate.js
if ($LASTEXITCODE -ne 0) { Pop-Location; Falha 'Falhou ao migrar o banco.' }
Ok 'banco migrado'

Etapa 'Carregando os agentes-padrão (as 17 automações)'
node server/seedAgentes.js
if ($LASTEXITCODE -ne 0) { Pop-Location; Falha 'Falhou ao carregar os agentes-padrão.' }
Ok 'agentes-padrão prontos'
Pop-Location

# --- 9. Subir o servidor e abrir o navegador ----------------------------------
Etapa 'Subindo o servidor em http://localhost:3000'
Start-Process -FilePath 'node' -ArgumentList 'server/server.js' -WorkingDirectory $App -WindowStyle Minimized
Start-Sleep -Seconds 3
Start-Process 'http://localhost:3000/'

Write-Host ''
Write-Host '=====================================================' -ForegroundColor Green
Write-Host '  Pronto! O painel abriu no seu navegador.'            -ForegroundColor Green
Write-Host '  Tela inicial (token + resumo): http://localhost:3000/'
Write-Host '  O menu fica na barra lateral esquerda.'
Write-Host ''
Write-Host '  Pra ATUALIZAR no futuro: rode este mesmo comando de novo.'
Write-Host '  Pra ligar sem atualizar: dois cliques em'
Write-Host "  $App\iniciar.bat"
Write-Host '=====================================================' -ForegroundColor Green
