@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Le Donjon
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Telecharge la version LTS sur https://nodejs.org puis relance.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installation des dependances, une seule fois...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)
echo Construction de la page...
call npm run build
if errorlevel 1 ( pause & exit /b 1 )
start "" http://localhost:3000
call npm start
pause
