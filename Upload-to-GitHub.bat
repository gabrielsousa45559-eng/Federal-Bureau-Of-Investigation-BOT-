@echo off
setlocal
cd /d "%~dp0"
where git >nul 2>nul
if errorlevel 1 (
  echo Git nao encontrado. Instale o Git for Windows e tente novamente.
  pause
  exit /b 1
)
if not exist ".git" (
  echo Este diretório ainda nao esta inicializado como repositório Git.
  pause
  exit /b 1
)
git check-ignore -q .env
if errorlevel 1 (
  echo ERRO: .env nao esta protegido pelo .gitignore. Envio cancelado.
  pause
  exit /b 1
)
for /f "delims=" %%A in ('git config user.name') do set "GIT_NAME=%%A"
for /f "delims=" %%A in ('git config user.email') do set "GIT_EMAIL=%%A"
if not defined GIT_NAME set /p "GIT_NAME=Nome para o commit GitHub: "
if not defined GIT_EMAIL set /p "GIT_EMAIL=Email GitHub (ou seu endereço noreply): "
git config user.name "%GIT_NAME%"
git config user.email "%GIT_EMAIL%"
git add -A
git status --short
set /p "CONFIRM=Enviar os arquivos listados acima ao GitHub? (s/N): "
if /I not "%CONFIRM%"=="S" (
  echo Envio cancelado.
  pause
  exit /b 0
)
git diff --cached --quiet
if not errorlevel 1 (
  echo Nenhuma alteracao nova para enviar.
  pause
  exit /b 0
)
set /p "MESSAGE=Mensagem do commit (Enter para usar 'Atualiza bot FBI'): "
if not defined MESSAGE set "MESSAGE=Atualiza bot FBI"
git commit -m "%MESSAGE%"
if errorlevel 1 (
  echo Falha ao criar commit.
  pause
  exit /b 1
)
git push -u origin main
if errorlevel 1 (
  echo Falha no push. Verifique acesso ao repositório e o branch remoto.
  pause
  exit /b 1
)
echo Envio concluido.
pause
