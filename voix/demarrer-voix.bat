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
rem Mise a jour automatique vers le moteur rapide (une seule fois, quelques Mo)
"%BASE%\venv\Scripts\python.exe" -c "import faster_qwen3_tts" >nul 2>nul
if errorlevel 1 (
  echo Mise a jour de la voix vers le moteur rapide...
  "%BASE%\venv\Scripts\python.exe" -m pip uninstall -y qwen-tts >nul 2>nul
  "%BASE%\venv\Scripts\python.exe" -m pip install --quiet "faster-qwen3-tts==0.5.4" "transformers==5.15.1" "torch==2.11.0"
)
set "VOIX_MODELE=%BASE%\models\Qwen3-TTS-12Hz-1.7B-Base"
"%BASE%\venv\Scripts\python.exe" victoria_server.py
