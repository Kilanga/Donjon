@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Le Donjon - installation de la voix de Victoria
rem Installe la voix de Victoria (Qwen3-TTS, Apache 2.0) une fois pour toutes :
rem   - un Python isolé (venv) avec PyTorch pour carte NVIDIA, environ 3 Go ;
rem   - le modèle de voix Qwen3-TTS 1.7B Base, environ 4,5 Go.
rem Tout va sur le disque D: (dossier D:\DonjonVoix) s'il existe, sinon dans AppData. Relançable sans risque.

set "BASE=D:\DonjonVoix"
if not exist D:\ set "BASE=%LOCALAPPDATA%\DonjonVoix"
set "HF_HOME=%BASE%\hf"
echo Dossier d'installation : %BASE%
echo.

where py >nul 2>nul
if errorlevel 1 (
  echo Python est introuvable. Installe Python 3.12 depuis https://www.python.org puis relance.
  pause & exit /b 1
)
py -3.12 -c "import sys" >nul 2>nul
if errorlevel 1 (
  echo Il faut Python 3.12 ^(py -3.12^). Installe-le depuis https://www.python.org puis relance.
  pause & exit /b 1
)

if not exist "%BASE%" mkdir "%BASE%"
if not exist "%BASE%\venv\Scripts\python.exe" (
  echo [1/4] Creation de l'environnement Python...
  py -3.12 -m venv "%BASE%\venv" || ( pause & exit /b 1 )
)
set "PY=%BASE%\venv\Scripts\python.exe"
"%PY%" -m pip install --upgrade pip --quiet

echo [2/4] PyTorch pour carte NVIDIA ^(gros telechargement, plusieurs minutes^)...
"%PY%" -m pip install "torch==2.11.0" "torchaudio==2.11.0" --index-url https://download.pytorch.org/whl/cu126 || ( pause & exit /b 1 )

echo [3/4] Qwen3-TTS...
"%PY%" -m pip install "qwen-tts==0.1.1" soundfile scipy huggingface_hub || ( pause & exit /b 1 )

echo [4/4] Modele de voix ^(environ 4,5 Go^)...
"%PY%" -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-TTS-12Hz-1.7B-Base', local_dir=r'%BASE%\models\Qwen3-TTS-12Hz-1.7B-Base')" || ( pause & exit /b 1 )

echo.
"%PY%" -c "import torch; print('Carte graphique :', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'AUCUNE (la voix sera tres lente)')"
echo.
echo Installation terminee. Victoria se lancera toute seule avec Le Donjon.
pause
