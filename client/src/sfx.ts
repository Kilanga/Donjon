// Sons synthétisés en WebAudio (aucun fichier). Activés après la première interaction.

type SoundName = 'hit' | 'crit' | 'miss' | 'death' | 'kill' | 'levelup' | 'coin' | 'trap' | 'step' | 'tick' | 'alliance' | 'betrayal' | 'heal' | 'gag' | 'forge'
  | 'bell' | 'rumble' | 'fanfare' | 'horn' | 'whoosh';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private duck: GainNode | null = null; // effets + musique passent par ici : baissés pendant que Victoria parle
  private music: GainNode | null = null;
  muted = (() => {
    try {
      return localStorage.getItem('donjon-son') === 'off';
    } catch {
      return false;
    }
  })();
  private amb: { nodes: AudioScheduledSourceNode[]; gain: GainNode; drip: number } | null = null;
  volume = 0.35;

  /** À appeler sur une interaction utilisateur (contrainte des navigateurs). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.duck = this.ctx.createGain();
      this.duck.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.duck);
      this.music = this.ctx.createGain();
      this.music.connect(this.duck);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem('donjon-son', m ? 'off' : 'on');
    } catch {
      /* stockage indisponible : réglage gardé pour la session */
    }
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
      case 'forge':
        // trois coups de marteau sur l'enclume : un « clang » métallique et son écho
        [0, 0.28, 0.56].forEach((t, i) => {
          this.tone(1760 - i * 90, 0.16, 'triangle', 0.16 * v, t);
          this.tone(2637, 0.08, 'square', 0.05 * v, t);
          this.noise(0.03, 0.4 * v, t, 6000);
        });
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
      case 'bell':
        // cloche grave : l'étage va tomber
        [0, 1.1].forEach((t) => {
          this.tone(196, 2.2, 'sine', 0.3 * v, t);
          this.tone(392.5, 1.6, 'sine', 0.12 * v, t);
          this.tone(587, 1.0, 'triangle', 0.05 * v, t);
        });
        break;
      case 'rumble':
        this.noise(1.3, 1.1 * v, 0, 90);
        this.tone(48, 1.2, 'sawtooth', 0.12 * v, 0, 36);
        break;
      case 'fanfare':
        [[523, 0], [659, 0.14], [784, 0.28], [1047, 0.42], [784, 0.62], [1047, 0.76]].forEach(([f, t]) => this.tone(f, 0.22, 'square', 0.12 * v, t));
        this.tone(131, 1.1, 'triangle', 0.2 * v, 0.42);
        break;
      case 'horn':
        // appel de cor : un vote ou un pari s'ouvre
        this.tone(294, 0.35, 'sawtooth', 0.1 * v, 0);
        this.tone(440, 0.6, 'sawtooth', 0.1 * v, 0.3);
        break;
      case 'whoosh':
        this.noise(0.5, 0.5 * v, 0, 700);
        this.tone(110, 0.5, 'sine', 0.15 * v, 0, 55);
        break;
      case 'betrayal':
        this.tone(196, 0.5, 'sawtooth', 0.22 * v, 0, 185);
        this.tone(277, 0.5, 'sawtooth', 0.18 * v, 0);
        this.tone(147, 0.9, 'sawtooth', 0.22 * v, 0.45, 110);
        this.noise(0.3, 0.4 * v, 0.45, 300);
        break;
    }
  }

  /**
   * Ambiance de donjon, très discrète : un bourdon grave, un souffle d'air qui va et vient,
   * et de temps en temps une goutte qui tombe. `level` 0..1.
   */
  ambience(on: boolean, level = 1) {
    if (!this.ctx || !this.master) return;
    if (!on || this.muted) {
      if (this.amb) {
        const a = this.amb;
        a.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
        clearInterval(a.drip);
        setTimeout(() => a.nodes.forEach((n) => n.stop()), 3000);
        this.amb = null;
      }
      return;
    }
    if (this.amb) {
      this.amb.gain.gain.setTargetAtTime(0.5 * level, this.ctx.currentTime, 1);
      return;
    }
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.5 * level, ctx.currentTime, 2);
    gain.connect(this.master);
    const nodes: AudioScheduledSourceNode[] = [];
    // bourdon : deux notes très graves légèrement désaccordées, filtrées
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 180;
    low.connect(gain);
    for (const [f, vol] of [[55, 0.07], [55.6, 0.06], [82.4, 0.03]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      g.gain.value = vol;
      o.connect(g).connect(low);
      o.start();
      nodes.push(o);
    }
    // souffle : bruit filtré dont le volume ondule lentement
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.7;
    const wg = ctx.createGain();
    wg.gain.value = 0.035;
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 0.07;
    lg.gain.value = 0.025;
    lfo.connect(lg).connect(wg.gain);
    wind.connect(bp).connect(wg).connect(gain);
    wind.start();
    lfo.start();
    nodes.push(wind, lfo);
    // gouttes d'eau
    const drip = window.setInterval(() => {
      if (Math.random() < 0.45 || !this.ctx || this.ctx.state !== 'running') return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(1400 + Math.random() * 900, t);
      o.frequency.exponentialRampToValueAtTime(500, t + 0.09);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(gain);
      o.start(t);
      o.stop(t + 0.15);
    }, 2600);
    this.amb = { nodes, gain, drip };
  }

  private voiceSrc: AudioBufferSourceNode | null = null;

  /**
   * Victoria : joue un clip WAV par-dessus le reste, avec une chaîne « antenne » (coupe des graves, présence,
   * compresseur doux). Les effets et l'ambiance baissent pendant qu'elle parle. Résout quand elle a fini.
   */
  async voice(data: ArrayBuffer, volume = 1): Promise<void> {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const master = this.master;
    const buf = await ctx.decodeAudioData(data);
    this.stopVoice();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3200;
    presence.Q.value = 0.9;
    presence.gain.value = 2.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, volume));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(hp).connect(presence).connect(comp).connect(g).connect(ctx.destination);
    const duck = this.duck ?? master;
    duck.gain.cancelScheduledValues(ctx.currentTime);
    duck.gain.setTargetAtTime(0.3, ctx.currentTime, 0.08); // effets et musique baissent
    this.voiceSrc = src;
    return new Promise((resolve) => {
      src.onended = () => {
        if (this.voiceSrc === src) {
          this.voiceSrc = null;
          duck.gain.setTargetAtTime(1, ctx.currentTime, 0.5);
        }
        resolve();
      };
      src.start();
    });
  }

  /** Coupe Victoria (régie : « Skip »). */
  stopVoice() {
    try {
      this.voiceSrc?.stop();
    } catch {
      /* déjà arrêtée */
    }
  }

  /** Le contexte audio et la sortie musique (baissée avec le reste quand Victoria parle). */
  get audio(): { ctx: AudioContext; out: GainNode } | null {
    return this.ctx && this.music ? { ctx: this.ctx, out: this.music } : null;
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
}

export const sfx = new Sfx();
export type { SoundName };
