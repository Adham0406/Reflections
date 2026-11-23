@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js topilmadi. https://nodejs.org dan o'rnating. & pause & exit /b 1)
node server.js
pause
