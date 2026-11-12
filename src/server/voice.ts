// La voix de Victoria Steele : le serveur du jeu demande l'audio au service local (voix/victoria_server.py, Qwen3-TTS
// sur la carte graphique), garde les derniers clips en mémoire et prévient le stream, qui les télécharge avec sa clé.
// Sans le service (pas installé, pas encore chargé), Victoria reste en sous-titres : rien ne casse.
import crypto from 'node:crypto';

export interface VoiceConfig {
  enabled: boolean;
  url: string; // service local, jamais exposé
  timeoutMs: number; // au-delà, la réplique passe en sous-titre seul (sur la carte graphique : 2 à 5 s)
}

export const DEFAULT_VOICE: VoiceConfig = { enabled: true, url: 'http://127.0.0.1:3791', timeoutMs: 25_000 };

export interface VoiceClip {
  id: string | null; // null : sous-titre seul (pas de service de voix)
  text: string;
  ms: number;
}

const MAX_WORDS = 40; // ~15 s à l'antenne
const MAX_MS = 17_000;
const KEEP = 8; // clips gardés pour le téléchargement par le stream

/** Rend une réplique prononçable : pseudos à tirets bas lisibles, pas de symboles que la voix lirait mal. */
export function speakable(text: string): string {
  return text
    .replace(/[*_~#`"«»“”]/g, ' ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Coupe une réplique trop longue à la dernière phrase entière (ou au mot) sous la limite. */
export function capWords(text: string, max = MAX_WORDS): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= max) return text.trim();
  const cut = words.slice(0, max).join(' ');
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 20 ? cut.slice(0, end + 1) : cut.replace(/[,;:]$/, '') + '.';
}

/** Durée d'un WAV PCM (en-tête standard) en millisecondes, 0 si illisible. */
export function wavMs(buf: Buffer): number {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return 0;
  let p = 12;
  let byteRate = 0;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(p + 16);
    if (id === 'data') return byteRate ? Math.round((Math.min(size, buf.length - p - 8) / byteRate) * 1000) : 0;
    p += 8 + size + (size & 1);
  }
  return 0;
}

export class Voice {
  muted = false;
  volume = 1;
  private ready = false;
  private misses = 0;
  private device = ''; // contrôles de santé ratés d'affilée (le service peut être occupé à générer)
  private clips = new Map<string, Buffer>();
  private busyUntil = 0; // fin estimée de la réplique en cours à l'antenne
  private pending = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private cfg: VoiceConfig,
    private broadcast: (clip: VoiceClip) => void,
  ) {}

  /** Surveille le service (il met une à deux minutes à charger le modèle au démarrage). */
  start() {
    if (!this.cfg.enabled || this.timer) return;
    const check = async () => {
      const was = this.ready;
      try {
        const res = await fetch(`${this.cfg.url}/health`, { signal: AbortSignal.timeout(5000) });
        const h = (await res.json()) as { ready?: boolean; device?: string };
        this.ready = res.ok && h.ready === true;
        this.device = h.device ?? '';
        this.misses = 0;
      } catch {
        if (++this.misses >= 2) this.ready = false;
      }
      if (this.ready && !was) console.log(`  Victoria (voice): ready${this.device ? ` on ${this.device}` : ''}.`);
      if (!this.ready && was) console.log('  Victoria (voice): service lost, subtitles only.');
    };
    void check();
    this.timer = setInterval(check, 15_000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  describe(): string {
    if (!this.cfg.enabled) return 'off (config)';
    if (this.muted) return 'muted';
    return this.ready ? 'on air' : 'not running (subtitles only)';
  }

  /** Victoria est-elle en train de parler (ou sur le point de) ? */
  busy(now = Date.now()): boolean {
    return this.pending > 0 || now < this.busyUntil;
  }

  getClip(id: string): Buffer | undefined {
    return /^[a-f0-9]{16}$/.test(id) ? this.clips.get(id) : undefined;
  }

  /** Fait dire une réplique à Victoria. `urgent` : passe même si elle vient de parler (régie, grands moments). */
  async say(text: string, urgent = false): Promise<void> {
    const line = capWords(text.replace(/\s+/g, ' ').trim());
    if (!line) return;
    const now = Date.now();
    const estimate = Math.min(MAX_MS, 1500 + line.split(' ').length * 380);
    if (!urgent && this.busy(now)) {
      this.broadcast({ id: null, text: line, ms: estimate }); // jamais deux répliques l'une sur l'autre : celle-ci en sous-titre, après
      return;
    }
    if (this.muted || !this.cfg.enabled || !this.ready) {
      this.busyUntil = now + estimate;
      this.broadcast({ id: null, text: line, ms: estimate });
      return;
    }
    this.pending++;
    const t0 = Date.now();
    try {
      const res = await fetch(`${this.cfg.url}/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: speakable(line) }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ms = wavMs(buf);
      if (!ms || ms > MAX_MS) throw new Error(`clip of ${ms} ms refused`);
      console.log(`[voice] ${(ms / 1000).toFixed(1)} s of voice generated in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      const id = crypto.randomBytes(8).toString('hex');
      this.clips.set(id, buf);
      while (this.clips.size > KEEP) this.clips.delete(this.clips.keys().next().value!);
      this.busyUntil = Math.max(Date.now(), this.busyUntil) + ms + 600;
      this.broadcast({ id, text: line, ms });
    } catch (e) {
      console.warn(`[voice] no audio after ${((Date.now() - t0) / 1000).toFixed(1)} s:`, (e as Error).message);
      this.busyUntil = Date.now() + estimate;
      this.broadcast({ id: null, text: line, ms: estimate });
    } finally {
      this.pending--;
    }
  }
}
