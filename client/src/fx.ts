// Effets de combat : fentes, flashs, reculs, particules et textes flottants.
// Les positions des entités sont lues au moment du dessin (elles peuvent arriver
// avant ou après l'état), avec un délai par effet pour « rejouer » le tour lisiblement.
import type { GameFx } from '../../src/shared/types';

export interface Pos {
  x: number;
  y: number;
}

interface Pending {
  fx: GameFx;
  at: number; // moment où l'effet doit démarrer
  expires: number;
}

interface Motion {
  dx: number;
  dy: number;
  t0: number;
  dur: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  t0: number;
  life: number;
  color: string;
  size: number;
}

interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  t0: number;
  big: boolean;
}

interface Sprite {
  x: number;
  y: number;
  name: string;
  t0: number;
  life: number;
  rise: number;
}

const STAGGER = 260; // ms entre deux effets d'un même tour
const MAX_DELAY = 2600;

export class FxLayer {
  private pending: Pending[] = [];
  private lunges = new Map<string, Motion>();
  private knocks = new Map<string, Motion>();
  private flashes = new Map<string, { t0: number; color: 'white' | 'red' }>();
  private particles: Particle[] = [];
  private pops: Pop[] = [];
  private sprites: Sprite[] = [];
  private nextSlot = 0;
  /** Dernière position connue de chaque entité (survit à sa disparition). */
  readonly lastPos = new Map<string, Pos>();
  screenFlash = 0;
  shake = 0;
  onStart?: (fx: GameFx, visible: boolean) => void;

  /** Programme un effet ; il démarrera quand ses entités seront visibles. */
  add(fx: GameFx) {
    const now = performance.now();
    if (this.nextSlot < now) this.nextSlot = now;
    const at = Math.min(this.nextSlot, now + MAX_DELAY);
    this.nextSlot = at + STAGGER;
    this.pending.push({ fx, at, expires: at + 2500 });
  }

  /** Moment prévu du prochain effet qui touche cette entité (pour caler les chiffres de dégâts). */
  plannedAt(key: string): number | null {
    const p = this.pending.find((q) => q.fx.dst === key || (q.fx.kind === 'gag' && q.fx.src === key));
    return p ? p.at : null;
  }

  /** Décalage de dessin d'une entité (fente + recul). */
  offset(key: string, now: number): Pos {
    let dx = 0;
    let dy = 0;
    for (const m of [this.lunges.get(key), this.knocks.get(key)]) {
      if (!m) continue;
      const u = (now - m.t0) / m.dur;
      if (u < 0 || u > 1) continue;
      const k = Math.sin(u * Math.PI); // aller-retour
      dx += m.dx * k;
      dy += m.dy * k;
    }
    return { x: Math.round(dx), y: Math.round(dy) };
  }

  /** Intensité du flash (0..1) et sa couleur. */
  flash(key: string, now: number): { a: number; color: 'white' | 'red' } {
    const f = this.flashes.get(key);
    if (!f) return { a: 0, color: 'white' };
    const u = (now - f.t0) / 220;
    if (u < 0 || u > 1) return { a: 0, color: f.color };
    return { a: 1 - u, color: f.color };
  }

  /** À appeler à chaque image, après avoir mis à jour lastPos. */
  update(now: number, visible: (key: string) => boolean) {
    const ready: [Pending, boolean][] = [];
    this.pending = this.pending.filter((p) => {
      if (now > p.expires) return false;
      if (now < p.at) return true;
      const keys = [p.fx.src, p.fx.dst].filter(Boolean) as string[];
      const seen = keys.some((k) => visible(k));
      if (keys.every((k) => this.lastPos.has(k)) && (seen || p.fx.kind === 'kill' || p.fx.kind === 'death')) {
        ready.push([p, seen]);
        return false;
      }
      return true;
    });
    for (const [p, seen] of ready) this.start(p.fx, now, seen);
    this.particles = this.particles.filter((q) => now - q.t0 < q.life);
    this.pops = this.pops.filter((q) => now - q.t0 < (q.big ? 1600 : 1100));
    this.sprites = this.sprites.filter((q) => now - q.t0 < q.life);
    this.screenFlash *= 0.86;
  }

  private start(fx: GameFx, now: number, seen: boolean) {
    const src = fx.src ? this.lastPos.get(fx.src) : undefined;
    const dst = fx.dst ? this.lastPos.get(fx.dst) : undefined;
    const dir = (a?: Pos, b?: Pos) => {
      if (!a || !b) return { x: 0, y: 0 };
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      return { x: dx / l, y: dy / l };
    };
    const d = dir(src, dst);
    this.onStart?.(fx, seen);
    switch (fx.kind) {
      case 'hit':
      case 'crit': {
        const big = fx.kind === 'crit';
        if (fx.src) this.lunges.set(fx.src, { dx: d.x * (big ? 10 : 7), dy: d.y * (big ? 10 : 7), t0: now, dur: 200 });
        if (fx.dst && dst) {
          this.knocks.set(fx.dst, { dx: d.x * (big ? 6 : 3), dy: d.y * (big ? 6 : 3), t0: now + 90, dur: 220 });
          this.flashes.set(fx.dst, { t0: now + 90, color: 'white' });
          this.burst(dst.x, dst.y - 10, big ? 16 : 7, big ? ['#ffe27a', '#fff6c8', '#ff9a3d'] : ['#ff5a5a', '#ffb0b0'], big ? 70 : 45, now + 90);
        }
        if (big && dst) {
          this.pops.push({ x: dst.x, y: dst.y - 34, text: 'CRITIQUE !', color: '#ffd65a', t0: now, big: true });
          this.screenFlash = 0.35;
          this.shake = Math.max(this.shake, 5);
        }
        break;
      }
      case 'miss':
        if (fx.src) this.lunges.set(fx.src, { dx: d.x * 6, dy: d.y * 6, t0: now, dur: 200 });
        if (dst) this.pops.push({ x: dst.x + 6, y: dst.y - 26, text: 'RATÉ', color: '#c9c2d8', t0: now + 80, big: false });
        break;
      case 'gag':
        if (fx.src && src) {
          this.flashes.set(fx.src, { t0: now, color: 'red' });
          this.knocks.set(fx.src, { dx: 0, dy: 4, t0: now, dur: 260 });
          this.pops.push({ x: src.x, y: src.y - 34, text: 'AÏE !', color: '#ff8a5a', t0: now, big: true });
          this.burst(src.x, src.y - 22, 8, ['#ffe27a', '#ffffff'], 30, now, -10);
        }
        break;
      case 'death':
      case 'kill': {
        const at = dst;
        if (!at) break;
        this.burst(at.x, at.y - 8, 18, ['#9b93ad', '#d8d2e6', '#5e5672'], 40, now, 20);
        this.sprites.push({ x: at.x, y: at.y - 6, name: 'skull', t0: now, life: 1300, rise: 18 });
        if (fx.kind === 'kill') this.coins(at.x, at.y - 10, 8, now + 150);
        if (fx.kind === 'death') {
          this.pops.push({ x: at.x, y: at.y - 36, text: 'K.O.', color: '#ff5a6a', t0: now, big: true });
          this.shake = Math.max(this.shake, 3);
        }
        break;
      }
      case 'loot': {
        const at = dst ?? src;
        if (at) this.coins(at.x, at.y - 14, 10, now);
        break;
      }
      case 'levelup': {
        if (!dst) break;
        for (let i = 0; i < 16; i++) {
          this.particles.push({ x: dst.x + (Math.random() - 0.5) * 16, y: dst.y - Math.random() * 20, vx: (Math.random() - 0.5) * 8, vy: -25 - Math.random() * 30, g: 0, t0: now + i * 30, life: 1200, color: i % 2 ? '#ffd65a' : '#fff6c8', size: 1.5 });
        }
        this.pops.push({ x: dst.x, y: dst.y - 40, text: 'NIVEAU +1', color: '#ffd65a', t0: now, big: true });
        break;
      }
      case 'trap': {
        if (!dst) break;
        this.sprites.push({ x: dst.x, y: dst.y + 2, name: 'floor_spikes_anim', t0: now, life: 700, rise: 0 });
        this.flashes.set(fx.dst!, { t0: now, color: 'red' });
        this.knocks.set(fx.dst!, { dx: 0, dy: -6, t0: now, dur: 260 });
        this.burst(dst.x, dst.y - 6, 8, ['#ff5a5a', '#c9c2d8'], 40, now, -20);
        break;
      }
      case 'heal': {
        if (!dst) break;
        for (let i = 0; i < 10; i++) {
          this.particles.push({ x: dst.x + (Math.random() - 0.5) * 14, y: dst.y - Math.random() * 16, vx: 0, vy: -18 - Math.random() * 14, g: 0, t0: now + i * 50, life: 900, color: '#6dff8a', size: 2 });
        }
        break;
      }
    }
  }

  private burst(x: number, y: number, n: number, colors: string[], speed: number, t0: number, lift = 30) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - lift, g: 140, t0, life: 450 + Math.random() * 300, color: colors[i % colors.length], size: 1 + Math.round(Math.random()) });
    }
  }

  private coins(x: number, y: number, n: number, t0: number) {
    for (let i = 0; i < n; i++) {
      this.particles.push({ x, y, vx: (Math.random() - 0.5) * 60, vy: -60 - Math.random() * 40, g: 220, t0: t0 + i * 25, life: 700, color: i % 3 ? '#ffd65a' : '#fff1a8', size: 2 });
    }
  }

  /** Particules et sprites temporaires, dans le repère du monde. */
  drawWorld(ctx: CanvasRenderingContext2D, now: number, drawSprite: (name: string, x: number, y: number, t: number) => void) {
    for (const s of this.sprites) {
      const u = (now - s.t0) / s.life;
      if (u < 0) continue;
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, u - 0.6) / 0.4);
      drawSprite(s.name, s.x, s.y - s.rise * u, (now - s.t0) / 1000);
    }
    for (const q of this.particles) {
      const t = (now - q.t0) / 1000;
      if (t < 0) continue;
      const u = (now - q.t0) / q.life;
      ctx.globalAlpha = Math.max(0, 1 - u);
      ctx.fillStyle = q.color;
      const x = q.x + q.vx * t;
      const y = q.y + q.vy * t + 0.5 * q.g * t * t;
      ctx.fillRect(Math.round(x), Math.round(y), q.size, q.size);
    }
    ctx.globalAlpha = 1;
  }

  /** Textes (« RATÉ », « CRITIQUE ! »…) en résolution écran. */
  drawScreen(ctx: CanvasRenderingContext2D, now: number, toScreen: (x: number, y: number) => [number, number]) {
    const dpr = devicePixelRatio;
    ctx.textAlign = 'center';
    for (const p of this.pops) {
      const dur = p.big ? 1600 : 1100;
      const u = (now - p.t0) / dur;
      if (u < 0) continue;
      const [x, y] = toScreen(p.x, p.y);
      const scale = p.big ? (u < 0.12 ? 0.6 + (u / 0.12) * 0.6 : 1.2 - Math.min(0.2, (u - 0.12) * 0.5)) : 1;
      const fs = Math.round((p.big ? 20 : 13) * dpr * scale);
      ctx.font = `700 ${fs}px 'Pixelify Sans', monospace`;
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, u - 0.65) / 0.35);
      const yy = y - u * 24 * dpr;
      ctx.lineWidth = Math.max(2, 3 * dpr);
      ctx.strokeStyle = '#120c1c';
      ctx.strokeText(p.text, x, yy);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, x, yy);
    }
    ctx.globalAlpha = 1;
  }
}
