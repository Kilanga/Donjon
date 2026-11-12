// Musique adaptative du stream : une ambiance selon ce qui se passe à l'écran (exploration, tension, boss, boutique,
// crypte, inscriptions, fin de saison), des fondus enchaînés entre les morceaux, et la musique baisse quand Victoria
// parle (même bus que les effets). Les morceaux sont listés dans /music/manifest.json : en ajouter ne demande pas de code.
// Chaque ambiance joue tous ses morceaux dans un ordre mélangé avant d'en rejouer un (la playlist d'exploration fait
// une vingtaine de minutes sans répétition), et reprend là où elle en était après un passage par le boss.
// Lecture en flux (<audio>) : rien n'est décodé en entier en mémoire, même avec 20 min de musique.
import { sfx } from '../sfx';
import { FALLBACK, type Mood } from './mood';

export { pickMood, type Mood } from './mood';

const FADE_S = 3.5;
const MIN_HOLD_MS = 20_000; // une ambiance calme reste au moins 20 s (pas de valse à chaque plan de caméra)
const URGENT: Mood[] = ['tension', 'boss', 'finale'];

interface Playing {
  mood: Mood;
  el: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  gain: GainNode;
  chained: boolean;
}

/** Ordre de lecture : tous les morceaux, mélangés, sans recommencer par celui qui vient de passer. */
export function shuffled(files: string[], last: string | undefined, rand: () => number = Math.random): string[] {
  const out = [...files];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && out[0] === last) [out[0], out[out.length - 1]] = [out[out.length - 1], out[0]];
  return out;
}

export class Music {
  private manifest: Partial<Record<Mood, string[]>> | null = null;
  private playing: Playing | null = null;
  private wanted: Mood | null = null;
  private since = 0;
  private queues = new Map<Mood, string[]>();
  private lastTrack = new Map<Mood, string>();

  constructor(private volume = 0.5) {}

  async load(): Promise<void> {
    try {
      const res = await fetch('/music/manifest.json', { cache: 'no-store' });
      if (res.ok) this.manifest = (await res.json()) as Partial<Record<Mood, string[]>>;
    } catch {
      this.manifest = null; // pas de musique : le stream reste avec ses effets
    }
  }

  private tracksFor(mood: Mood): { mood: Mood; files: string[] } | null {
    for (let m: Mood | null = mood; m; m = FALLBACK[m]) {
      const files = this.manifest?.[m];
      if (files?.length) return { mood: m, files };
    }
    return null;
  }

  private nextFile(mood: Mood, files: string[]): string {
    let q = this.queues.get(mood);
    if (!q?.length) q = shuffled(files, this.lastTrack.get(mood));
    const file = q.shift()!;
    this.queues.set(mood, q);
    this.lastTrack.set(mood, file);
    return file;
  }

  /** À appeler régulièrement avec l'ambiance voulue ; change de morceau en fondu quand il le faut. */
  set(mood: Mood, now = performance.now()) {
    if (!this.manifest || !sfx.running) return;
    const target = this.tracksFor(mood)?.mood ?? null;
    if (!target || target === this.wanted) return;
    if (this.playing && now - this.since < MIN_HOLD_MS && !URGENT.includes(target) && !URGENT.includes(this.playing.mood)) return;
    this.wanted = target;
    this.since = now;
    void this.start(target);
  }

  private async start(mood: Mood) {
    const a = sfx.audio;
    const pick = this.tracksFor(mood);
    if (!a || !pick) return;
    const file = this.nextFile(mood, pick.files);
    const el = new Audio(`/music/${encodeURIComponent(file)}`);
    el.preload = 'auto';
    const ready = await new Promise<boolean>((res) => {
      const t = window.setTimeout(() => res(false), 15_000);
      el.addEventListener('canplay', () => (clearTimeout(t), res(true)), { once: true });
      el.addEventListener('error', () => (clearTimeout(t), res(false)), { once: true });
    });
    if (!ready || this.wanted !== mood) {
      el.removeAttribute('src');
      if (!ready && this.wanted === mood) window.setTimeout(() => this.wanted === mood && void this.start(mood), 5000); // fichier illisible : le suivant
      return;
    }
    const t = a.ctx.currentTime;
    const gain = a.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(this.volume, t + FADE_S);
    gain.connect(a.out);
    const node = a.ctx.createMediaElementSource(el);
    node.connect(gain);
    const p: Playing = { mood, el, node, gain, chained: false };
    // Un peu avant la fin : enchaîne sur le morceau suivant de la même ambiance (fondu)
    el.addEventListener('timeupdate', () => {
      if (p.chained || this.playing !== p || !isFinite(el.duration)) return;
      if (el.duration - el.currentTime <= FADE_S + 0.5) {
        p.chained = true;
        void this.start(mood);
      }
    });
    el.addEventListener('ended', () => this.playing === p && this.start(mood));
    void el.play().catch(() => {});
    this.fadeOut(this.playing, t);
    this.playing = p;
  }

  private fadeOut(p: Playing | null, t: number) {
    if (!p) return;
    p.chained = true;
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setValueAtTime(Math.max(0.0001, p.gain.gain.value), t);
    p.gain.gain.exponentialRampToValueAtTime(0.0001, t + FADE_S);
    window.setTimeout(() => {
      p.el.pause();
      p.el.removeAttribute('src');
      p.node.disconnect();
      p.gain.disconnect();
    }, (FADE_S + 0.3) * 1000);
  }

  stop() {
    const a = sfx.audio;
    if (a) this.fadeOut(this.playing, a.ctx.currentTime);
    this.playing = null;
    this.wanted = null;
  }
}
