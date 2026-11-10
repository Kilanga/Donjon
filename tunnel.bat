@echo off
chcp 65001 >nul
title Le Donjon - tunnel
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared n'est pas installe. Installation via winget...
  winget install --id Cloudflare.cloudflared -e
  echo Ferme cette fenetre et relance tunnel.bat.
  pause
  exit /b 1
)
echo Cherche la ligne https://....trycloudflare.com ci-dessous et envoie-la a tes amis.
cloudflared tunnel --url http://127.0.0.1:3000
pause
