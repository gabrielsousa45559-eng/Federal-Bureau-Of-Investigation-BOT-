@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado. Instale Node.js 20 ou mais recente.
  pause
  exit /b 1
)
if not exist ".env" (
  echo Arquivo .env nao encontrado. Copie .env.example para .env e preencha as configuracoes.
  pause
  exit /b 1
)
findstr /B /C:"DISCORD_TOKEN=SUBSTITUA_PELO_NOVO_TOKEN_REGENERADO" .env >nul
if not errorlevel 1 (
  echo Troque DISCORD_TOKEN no .env pelo token atual do bot.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Instalando dependencias do bot...
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)
title FBI Discord Bot - Online
echo Iniciando FBI Discord Bot. Mantenha esta janela aberta.
call npm start
if errorlevel 1 echo O bot encerrou com erro. Leia a mensagem acima.
pause
