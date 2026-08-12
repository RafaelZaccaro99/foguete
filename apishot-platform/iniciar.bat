@echo off
rem Liga o Apishot Platform local e abre o painel no navegador.
rem (Se o banco não estiver de pé, inicie o serviço MariaDB/MySQL primeiro.)
cd /d "%~dp0"
start "" http://localhost:3000/
node server\server.js
pause
