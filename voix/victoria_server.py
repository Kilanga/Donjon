"""Victoria Steele : le service de voix du Donjon (Qwen3-TTS, sur la carte graphique, en local).

Lancé par « Le Donjon.bat » (ou demarrer-voix.bat). N'écoute que sur 127.0.0.1 : le serveur du jeu lui envoie
une réplique, il renvoie un fichier WAV avec la voix de Victoria (clonée une fois pour toutes depuis victoria_ref.wav).

  GET  /health  -> {"ok": true, "ready": bool}
  POST /tts     {"text": "..."}  -> audio/wav (mono)

Variables d'environnement : VOIX_PORT (3791), VOIX_MODELE (dossier du modèle Base 1.7B), VOIX_DEVICE (cuda:0),
VOIX_STUDIO=0 pour couper la passe « studio » (studio.py : micro et pièce réels plutôt qu'un son de synthèse).
"""
import io
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

from studio import studio

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('VOIX_PORT', '3791'))
MODEL = os.environ.get('VOIX_MODELE', 'Qwen/Qwen3-TTS-12Hz-1.7B-Base')
DEVICE = os.environ.get('VOIX_DEVICE', 'cuda:0' if torch.cuda.is_available() else 'cpu')
REF_WAV = os.path.join(HERE, 'victoria_ref.wav')
with open(os.path.join(HERE, 'victoria_ref.txt'), encoding='utf-8') as fh:
    REF_TEXT = fh.read().strip()

USE_STUDIO = os.environ.get('VOIX_STUDIO', '1') != '0'
MAX_CHARS = 400  # une réplique fait au plus ~35 mots ; au-delà, c'est une erreur ou un abus
MAX_TOKENS = 260  # 12 trames par seconde : ~20 s d'audio au maximum, jamais de génération qui s'emballe

LOG = os.path.join(HERE, '..', 'logs', 'voix.log')  # lu par Claude avec les journaux du Donjon


def log(msg: str):
    line = f'[voix] {msg}'
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        if os.path.exists(LOG) and os.path.getsize(LOG) > 2_000_000:
            os.replace(LOG, LOG + '.old')
        with open(LOG, 'a', encoding='utf-8') as fh:
            fh.write(time.strftime('%Y-%m-%d %H:%M:%S ') + line + '\n')
    except OSError:
        pass


def gpu_info() -> str:
    if not torch.cuda.is_available():
        return f'CUDA unavailable (torch {torch.__version__}): running on the CPU, lines will be slow'
    free, total = torch.cuda.mem_get_info()
    return f'{torch.cuda.get_device_name(0)}, VRAM free {free / 2**30:.1f} / {total / 2**30:.1f} GB (torch {torch.__version__})'


state = {'ready': False, 'model': None, 'prompt': None}
lock = threading.Lock()  # une seule génération à la fois sur la carte graphique


def load():
    t0 = time.time()
    log(f'device {DEVICE}; {gpu_info()}')
    dtype = torch.bfloat16 if DEVICE.startswith('cuda') or os.environ.get('VOIX_BF16') == '1' else torch.float32
    model = Qwen3TTSModel.from_pretrained(MODEL, device_map=DEVICE, dtype=dtype)
    prompt = model.create_voice_clone_prompt(ref_audio=REF_WAV, ref_text=REF_TEXT)
    state['model'], state['prompt'] = model, prompt
    synth('Testing, testing. Victoria Steele, live.')  # premier passage : chauffe la carte
    state['ready'] = True
    log(f'Victoria est prete ({DEVICE}, {time.time() - t0:.0f} s) ; {gpu_info()}')


def synth(text: str) -> bytes:
    with lock:
        wavs, sr = state['model'].generate_voice_clone(
            text=text, language='English', voice_clone_prompt=state['prompt'], max_new_tokens=MAX_TOKENS)
    audio = np.asarray(wavs[0], dtype=np.float32)
    if audio.size and USE_STUDIO:
        audio = studio(audio, sr)  # micro et pièce réels ; normalisé à -1 dBFS
    elif audio.size:
        peak = float(np.max(np.abs(audio)))
        if peak > 0:
            audio = audio * (0.89 / peak)  # même niveau d'une réplique à l'autre (-1 dBFS)
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format='WAV', subtype='PCM_16')
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = 'Victoria'

    def log_message(self, fmt, *args):  # pas de journal à chaque requête
        pass

    def reply(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            return self.reply(200, json.dumps({'ok': True, 'ready': state['ready'], 'device': DEVICE}).encode(), 'application/json')
        self.reply(404, b'{}', 'application/json')

    def do_POST(self):
        if self.path != '/tts':
            return self.reply(404, b'{}', 'application/json')
        if not state['ready']:
            return self.reply(503, b'{"error":"loading"}', 'application/json')
        try:
            n = int(self.headers.get('Content-Length', '0'))
            if n <= 0 or n > 4096:
                raise ValueError('size')
            data = json.loads(self.rfile.read(n).decode('utf-8'))
            text = ' '.join(str(data.get('text', '')).split())[:MAX_CHARS]
            if not text:
                raise ValueError('empty')
        except Exception:
            return self.reply(400, b'{"error":"bad request"}', 'application/json')
        try:
            t0 = time.time()
            wav = synth(text)
            secs = (len(wav) - 44) / 2 / 24000
            log(f'{len(text)} caracteres -> {secs:.1f} s de voix en {time.time() - t0:.1f} s')
            self.reply(200, wav, 'audio/wav')
        except Exception as e:  # une réplique ratée ne doit pas arrêter le service
            log(f'erreur : {e}')
            self.reply(500, b'{"error":"synthesis failed"}', 'application/json')


if __name__ == '__main__':
    httpd = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)  # jamais accessible depuis le réseau
    threading.Thread(target=load, daemon=True).start()
    log(f'chargement de Victoria sur {DEVICE}... (http://127.0.0.1:{PORT})')
    httpd.serve_forever()
