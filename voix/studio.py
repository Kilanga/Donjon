"""Passe « studio » : rend une voix de synthèse moins clinique, comme un vrai micro dans une vraie pièce.

- coupe les infra-graves (< 80 Hz) ;
- un peu de chaleur (bas-médium) et un adoucissement des aigus métalliques typiques des voix de synthèse ;
- une pièce très courte et discrète (premières réflexions d'un plateau, pas un écho) ;
- un fond de pièce à peine audible : un vrai enregistrement n'a jamais de silence numérique parfait.
Déterministe (même entrée, même sortie). Utilisé par victoria_server.py.
"""
import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt


def _peaking(f0: float, gain_db: float, q: float, sr: int):
    """Égaliseur en cloche (biquad RBJ), en sections du second ordre pour sosfilt."""
    a = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / sr
    alpha = np.sin(w) / (2 * q)
    b0, b1, b2 = 1 + alpha * a, -2 * np.cos(w), 1 - alpha * a
    a0, a1, a2 = 1 + alpha / a, -2 * np.cos(w), 1 - alpha / a
    return np.array([[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]])


def _room(sr: int, seconds: float = 0.22) -> np.ndarray:
    """Réponse d'une petite pièce : quelques réflexions précoces puis une queue très courte qui s'éteint vite."""
    rng = np.random.default_rng(7)
    n = int(sr * seconds)
    t = np.arange(n) / sr
    tail = rng.standard_normal(n) * np.exp(-t / 0.045)
    tail = sosfilt(butter(2, 4500, 'low', fs=sr, output='sos'), tail)  # une pièce absorbe les aigus
    ir = tail * 0.18 / (np.max(np.abs(tail)) + 1e-9)
    for ms, g in ((7, 0.32), (13, 0.22), (19, 0.16), (29, 0.1)):
        ir[int(sr * ms / 1000)] += g
    ir[0] = 1.0
    return ir


def studio(audio: np.ndarray, sr: int, wet: float = 0.12) -> np.ndarray:
    x = np.asarray(audio, dtype=np.float64)
    x = sosfilt(butter(2, 80, 'high', fs=sr, output='sos'), x)
    x = sosfilt(_peaking(220, 1.5, 0.8, sr), x)  # chaleur
    x = sosfilt(_peaking(7000, -2.5, 1.2, sr), x)  # aigus moins métalliques
    room = fftconvolve(x, _room(sr))[: len(x) + int(0.15 * sr)]
    dry = np.concatenate([x, np.zeros(len(room) - len(x))])
    y = dry * (1 - wet) + (room - dry) * wet * 0.6 + dry * wet
    rng = np.random.default_rng(len(x))
    floor = sosfilt(butter(2, [150, 3000], 'band', fs=sr, output='sos'), rng.standard_normal(len(y)))
    y = y + floor * (10 ** (-62 / 20)) / (np.std(floor) + 1e-9)  # fond de pièce à -62 dB
    peak = np.max(np.abs(y))
    return (y * (0.89 / peak) if peak > 0 else y).astype(np.float32)
