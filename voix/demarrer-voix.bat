@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Victoria (voix du Donjon)
rem Lance le service de voix de Victoria (appelé par lancer.bat). Rien à faire si la voix n'est pas installée.
set "BASE=D:\DonjonVoix"
if not exist "%BASE%\venv\Scripts\python.exe" set "BASE=%LOCALAPPDATA%\DonjonVoix"
if not exist "%BASE%\venv\Scripts\python.exe" (
  echo La voix de Victoria n'est pas installee : lance voix\installer-voix.bat une fois.
  exit /b 0
)
set "HF_HOME=%BASE%\hf"
set "VOIX_MODELE=%BASE%\models\Qwen3-TTS-12Hz-1.7B-Base"
"%BASE%\venv\Scripts\python.exe" victoria_server.py
