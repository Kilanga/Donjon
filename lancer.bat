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
rem Installe (ou complete) les dependances si besoin : premiere fois, ou apres un git pull qui en ajoute
call npm ls --depth=0 >nul 2>nul
if errorlevel 1 (
  echo Installation des dependances...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( pause & exit /b 1 )
)
echo Construction de la page...
call npm run build
if errorlevel 1 ( pause & exit /b 1 )
rem La voix de Victoria (si elle est installee : voix\installer-voix.bat) tourne dans sa propre fenetre, reduite
if exist "voix\demarrer-voix.bat" start "Victoria" /min cmd /c "voix\demarrer-voix.bat"
start "" http://localhost:3000
call npm start
pause
