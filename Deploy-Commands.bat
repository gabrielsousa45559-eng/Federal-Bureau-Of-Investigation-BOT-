@echo off
setlocal
cd /d "%~dp0"
if not exist ".env" (
  echo Arquivo .env nao encontrado. Copie .env.example para .env e preencha CLIENT_ID, DISCORD_TOKEN e GUILD_ID.
  pause
  exit /b 1
)
if not exist "node_modules" call npm install
call npm run deploy
pause
