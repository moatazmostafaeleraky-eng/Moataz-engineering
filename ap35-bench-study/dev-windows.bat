@echo off
REM Development mode with hot reload (needs Node.js 18+). Opens http://localhost:5173/
cd /d "%~dp0"
if not exist "node_modules" call npm install
call npx vite --open
