@echo off
REM AP35 Live Inverter Bench Study - Windows launcher
REM Needs Node.js 18 or newer (https://nodejs.org). Opens http://localhost:4173/ in the default browser.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo dist\ not found - installing dependencies and building once...
  call npm install || goto :fail
  call npm run build || goto :fail
)
node serve.mjs 4173 --open
goto :eof
:fail
echo Build failed. See the messages above.
pause
exit /b 1
