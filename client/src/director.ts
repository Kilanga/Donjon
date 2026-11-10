// Caméra « réalisateur » de la vue spectateur : suit le drame, comme une régie télé.
import type { FloorView, GameEvent } from '../../src/shared/types';
import type { MapRenderer } from './map';

const MIN_SHOT = 7000; // durée minimale d'un plan (ms)
const HALF_LIFE = 9000; // demi-vie du score de drame d'une salle (ms)
const THRESHOLD = 12; // en dessous : plan large
const LOWER_THIRD_MIN = 60; // drame minimal pour le bandeau

export class Director {
  auto = true;
  followName: string | null = null; // crawler suivi après un clic dans la liste
  private heat = new Map<number, { score: number; t: number }>(); // salle -> score
  private shot: { roomId: number | null; since: number } = { roomId: null, since: 0 };
  private map: MapRenderer;
  private floor: FloorView | null = null;
  private bar: HTMLElement;
  private barTimer = 0;
  onChange?: () => void;

  constructor(map: MapRenderer, host: HTMLElement) {
    this.map = map;
    this.bar = document.createElement('div');
    this.bar.id = 'lower-third';
    this.bar.innerHTML = '<span class="lt-tag">EN DIRECT</span><span class="lt-text"></span>';
    host.appendChild(this.bar);
    map.onManual = () => {
      if (!this.auto && !this.followName) return;
      this.auto = false;
      this.followName = null;
      this.onChange?.();
    };
  }

  setFloor(f: FloorView | null) {
    if (f && this.floor && f.n !== this.floor.n) {
      this.heat.clear();
      this.shot = { roomId: null, since: 0 };
    }
    this.floor = f;
  }

  setAuto(on: boolean) {
    this.auto = on;
    this.followName = null;
    this.shot = { roomId: null, since: 0 };
    if (on) this.map.showWholeFloor();
    this.onChange?.();
  }

  /** Clic sur un crawler de la liste : la caméra le suit. */
  follow(name: string) {
    this.followName = name;
    this.auto = false;
    this.onChange?.();
    this.update(performance.now());
  }

  onEvent(e: GameEvent) {
    if (!this.floor || e.floor !== this.floor.n) return;
    if (e.roomId !== undefined && e.drama > 0) {
      const now = performance.now();
      const h = this.heat.get(e.roomId);
      const score = (h ? decay(h.score, now - h.t) : 0) + e.drama + 5;
      this.heat.set(e.roomId, { score, t: now });
    }
    if (e.drama >= LOWER_THIRD_MIN && e.scope !== 'prive') this.lowerThird(e.text);
  }

  private lowerThird(text: string) {
    const el = this.bar.querySelector('.lt-text') as HTMLElement;
    el.textContent = text.length > 140 ? text.slice(0, 137) + '…' : text;
    this.bar.classList.remove('show');
    void this.bar.offsetWidth;
    this.bar.classList.add('show');
    clearTimeout(this.barTimer);
    this.barTimer = window.setTimeout(() => this.bar.classList.remove('show'), 5000);
  }

  /** À appeler à chaque image. */
  update(now: number) {
    const f = this.floor;
    if (!f) return;
    if (this.followName) {
      const r = f.rooms.find((x) => x.players?.some((p) => p.name === this.followName));
      if (r) this.map.focusRoom(r, 3);
      return;
    }
    if (!this.auto) return;
    let best: { id: number; score: number } | null = null;
    for (const [id, h] of this.heat) {
      const sc = decay(h.score, now - h.t);
      if (sc < 1) this.heat.delete(id);
      else if (!best || sc > best.score) best = { id, score: sc };
    }
    const held = now - this.shot.since < MIN_SHOT;
    if (held) return;
    if (best && best.score >= THRESHOLD) {
      if (best.id !== this.shot.roomId) {
        const r = f.rooms.find((x) => x.id === best!.id);
        if (r) {
          this.map.focusRoom(r, 3);
          this.shot = { roomId: r.id, since: now };
        }
      }
    } else if (this.shot.roomId !== null || this.shot.since === 0) {
      this.map.showWholeFloor();
      this.shot = { roomId: null, since: now };
    }
  }
}

function decay(score: number, dt: number) {
  return score * Math.pow(0.5, dt / HALF_LIFE);
}
