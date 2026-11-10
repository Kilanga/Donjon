// Sons synthétisés en WebAudio (aucun fichier). Activés après la première interaction.

type SoundName = 'hit' | 'crit' | 'miss' | 'death' | 'kill' | 'levelup' | 'coin' | 'trap' | 'step' | 'tick' | 'alliance' | 'betrayal' | 'heal' | 'gag';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = localStorage.getItem('donjon-son') === 'off';
  volume = 0.35;

  /** À appeler sur une interaction utilisateur (contrainte des navigateurs). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    localStorage.setItem('donjon-son', m ? 'off' : 'on');
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, at = 0, freq = 1200) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
  }

  /** Joue un son ; `vol` multiplie le volume (0.3 pour les sons « au loin »). */
  play(name: SoundName, vol = 1) {
    if (this.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    const v = Math.max(0.02, Math.min(1, vol));
    switch (name) {
      case 'hit':
        this.noise(0.09, 0.9 * v, 0, 900);
        this.tone(160, 0.1, 'square', 0.25 * v, 0, 70);
        break;
      case 'crit':
        this.noise(0.15, 1 * v, 0, 1400);
        this.tone(220, 0.25, 'sawtooth', 0.3 * v, 0, 55);
        this.tone(880, 0.12, 'square', 0.15 * v, 0.05);
        break;
      case 'miss':
        this.noise(0.12, 0.35 * v, 0, 2500);
        break;
      case 'gag':
        this.tone(500, 0.12, 'square', 0.18 * v, 0, 250);
        this.tone(250, 0.18, 'square', 0.18 * v, 0.12, 120);
        break;
      case 'death':
        this.tone(330, 0.22, 'triangle', 0.3 * v, 0, 220);
        this.tone(220, 0.22, 'triangle', 0.3 * v, 0.2, 147);
        this.tone(147, 0.5, 'triangle', 0.3 * v, 0.4, 70);
        break;
      case 'kill':
        this.noise(0.08, 0.6 * v, 0, 700);
        this.tone(988, 0.08, 'square', 0.12 * v, 0.08);
        this.tone(1319, 0.12, 'square', 0.12 * v, 0.15);
        break;
      case 'coin':
        this.tone(988, 0.07, 'square', 0.12 * v);
        this.tone(1319, 0.16, 'square', 0.12 * v, 0.07);
        break;
      case 'levelup':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, 'square', 0.13 * v, i * 0.09));
        break;
      case 'trap':
        this.noise(0.05, 0.8 * v, 0, 3000);
        this.tone(120, 0.18, 'sawtooth', 0.25 * v, 0.02, 60);
        break;
      case 'step':
        this.noise(0.05, 0.25 * v, 0, 400);
        this.noise(0.05, 0.2 * v, 0.14, 350);
        break;
      case 'tick':
        this.tone(1200, 0.04, 'sine', 0.08 * v);
        break;
      case 'heal':
        this.tone(660, 0.15, 'sine', 0.15 * v, 0, 990);
        break;
      case 'alliance':
        this.tone(523, 0.15, 'triangle', 0.18 * v);
        this.tone(784, 0.25, 'triangle', 0.18 * v, 0.12);
        break;
      case 'betrayal':
        this.tone(196, 0.5, 'sawtooth', 0.22 * v, 0, 185);
        this.tone(277, 0.5, 'sawtooth', 0.18 * v, 0);
        this.tone(147, 0.9, 'sawtooth', 0.22 * v, 0.45, 110);
        this.noise(0.3, 0.4 * v, 0.45, 300);
        break;
    }
  }
}

export const sfx = new Sfx();
export type { SoundName };
