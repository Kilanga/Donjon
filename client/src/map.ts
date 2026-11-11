// Rendu de la carte d'un étage en pixel art, avec brouillard de guerre.
import { normalize } from '../../src/shared/commands';
import type { Dir, FloorView, GameEvent, MonsterView, PlayerPublic, RoomView } from '../../src/shared/types';
import { FxLayer } from './fx';
import { rng, roomDecor, type Prop } from '../../src/shared/decor';
import { CLASS_SPRITE, Tiles } from './tiles';

const IW = 7; // largeur intérieure d'une salle (tuiles)
const IH = 5; // hauteur intérieure
const GAP = 2; // longueur des couloirs
const CW = IW + 2 + GAP; // pas horizontal d'une cellule
const CH = IH + 3 + GAP; // pas vertical
const PX = 16;

const THEME_TINT: Record<string, string> = {
  'inondé': 'rgba(40,110,220,0.16)',
  'en feu': 'rgba(255,90,20,0.14)',
  'plongé dans le noir': 'rgba(0,0,0,0.35)',
  'moisi': 'rgba(90,160,40,0.14)',
  'hanté': 'rgba(120,255,200,0.08)',
};

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  t0: number;
}

function hash(n: number) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 13;
  return x;
}

export class MapRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tiles: Tiles;
  floor: FloorView | null = null;
  zoom = typeof window !== 'undefined' && window.innerWidth < 700 ? 2 : 3; // téléphone : on voit les salles voisines
  cam = { x: 0, y: 0 }; // centre de la caméra en pixels monde
  target = { x: 0, y: 0 };
  follow = true;
  shake = 0;
  private floaters: Floater[] = [];
  private bubblePos: { text: string; x: number; y: number; t0: number; dur: number; npc: boolean }[] = [];
  private labels: { text: string; x: number; y: number; color: string; hp: number; maxHp: number }[] = [];
  spectator = false;
  readonly fx = new FxLayer();
  zoomTarget: number | null = null;
  onManual?: () => void; // glisser/molette : la caméra auto se désactive
  private visibleKeys = new Set<string>();
  private bubbles = new Map<string, { text: string; t0: number; dur: number }>();
  private floorAt = 0; // réception de l'étage (pour décompter le scellé de l'escalier)
  private stairsMark: { x: number; y: number; bossAlive: boolean } | null = null;
  // Repères des salles déjà visitées (liseré + écusson), et ce qu'on y a vu en dernier
  private marks: { x: number; y: number; color: string; icon: string | null; dim: boolean; count: number; loot: boolean }[] = [];
  private memo = new Map<string, { monsters: number; boss: boolean; loot: boolean }>();

  /** Bulle de dialogue au-dessus d'un crawler (6,5 s). */
  bubble(name: string, text: string) {
    this.bubbles.set(name, { text, t0: performance.now(), dur: 6500 });
  }

  /** Réplique du marchand d'une safe room : bulle plus large, qui reste plus longtemps. */
  npcBubble(roomId: number, text: string) {
    this.bubbles.set(`marchand:${roomId}`, { text, t0: performance.now(), dur: 4000 + Math.min(8000, text.length * 55) });
  }
  private lastHp = new Map<string, number>();
  private drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;

  // ------------------------------------------------ déplacement libre dans la salle (page joueur)
  walkEnabled = false;
  onDoor?: (dir: Dir) => void; // le crawler entre dans une porte : changement de salle à la fin du tour
  onAttackMonster?: (index: number, name: string) => void; // clic sur un monstre
  onWalk?: (nx: number, ny: number) => void; // position (0..1 dans la salle) à relayer aux autres
  private keys = new Set<Dir>();
  private me: { roomKey: string; x: number; y: number; tx: number | null; ty: number | null; door: Dir | null; flip: boolean } | null = null;
  private remote = new Map<string, { roomKey: string; x: number; y: number; dx: number; dy: number; t: number }>();
  private lastWalkSent = { t: 0, x: -1, y: -1 };
  private lastFrame = 0;

  /** Touche de déplacement enfoncée ou relâchée (ZQSD / flèches). */
  setKey(dir: Dir, down: boolean) {
    if (down) {
      this.keys.add(dir);
      if (this.me) this.me.tx = this.me.ty = null;
    } else this.keys.delete(dir);
  }
  clearKeys() {
    this.keys.clear();
  }

  /** Position libre d'un autre crawler (reçue du serveur). */
  remotePos(name: string, floor: number, roomId: number, nx: number, ny: number) {
    const r = this.floor?.n === floor ? this.floor.rooms.find((x) => x.id === roomId) : undefined;
    if (!r) return;
    const b = interior(r);
    const dx = b.x0 + nx * (b.x1 - b.x0);
    const dy = b.y0 + ny * (b.y1 - b.y0);
    const key = `${floor}:${roomId}`;
    const cur = this.remote.get(name);
    if (cur && cur.roomKey === key) Object.assign(cur, { dx, dy, t: performance.now() });
    else this.remote.set(name, { roomKey: key, x: dx, y: dy, dx, dy, t: performance.now() });
  }

  constructor(canvas: HTMLCanvasElement, tiles: Tiles) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.tiles = tiles;
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(0.5, Math.min(6, this.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
      this.zoomTarget = null;
      this.onManual?.();
    }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) {
        this.drag.moved = true;
        if (this.follow || this.zoomTarget !== null) this.onManual?.();
        this.follow = false;
        this.zoomTarget = null;
      }
      const s = this.zoom * devicePixelRatio;
      this.cam.x = this.target.x = this.drag.cx - (dx * devicePixelRatio) / s;
      this.cam.y = this.target.y = this.drag.cy - (dy * devicePixelRatio) / s;
    });
    canvas.addEventListener('pointerup', (e) => {
      const click = this.drag && !this.drag.moved;
      this.drag = null;
      if (click && this.walkEnabled) this.click(e);
    });
    canvas.addEventListener('dblclick', () => (this.follow = true));
  }

  setFloor(f: FloorView | null) {
    const prevN = this.floor?.n;
    this.floor = f;
    this.floorAt = performance.now();
    if (!f) return;
    // Nombres flottants : différences de PV depuis le dernier état
    const now = performance.now();
    for (const r of f.rooms) {
      const ents: [string, number, number][] = [];
      (r.players ?? []).forEach((p, i) => ents.push([`p:${p.name}`, p.hp, i]));
      (r.monsters ?? []).forEach((m, i) => ents.push([`m:${m.id}`, m.hp, i]));
      for (const [key, hp] of ents) {
        const prev = this.lastHp.get(key);
        if (prev !== undefined && prev !== hp && prevN === f.n) {
          const pos = this.entityPos(r, key);
          const t0 = (this.fx.plannedAt(key) ?? now) + 90;
          if (pos) this.floaters.push({ x: pos.x, y: pos.y - 30, text: hp < prev ? `-${prev - hp}` : `+${hp - prev}`, color: hp < prev ? '#ff5a5a' : '#6dff8a', t0 });
          if (hp < prev && r.current) this.shake = Math.max(this.shake, Math.min(6, (prev - hp) / 2));
        }
        this.lastHp.set(key, hp);
      }
    }
    if (this.spectator) {
      if (prevN !== f.n) this.centerOnCurrent(true);
    } else if (this.follow || prevN !== f.n) this.centerOnCurrent(prevN !== f.n);
  }

  /** Évènement reçu : programme l'effet visuel correspondant. */
  onEvent(e: GameEvent) {
    if (!this.floor || e.floor !== this.floor.n) return;
    let fx = e.fx;
    if (!fx && e.kind === 'loot' && e.actors?.length) {
      const name = this.nameFromKey(e.actors[0]);
      if (name) fx = { kind: 'loot', dst: `p:${name}` };
    }
    if (fx) this.fx.add(fx);
  }

  private nameFromKey(key: string): string | null {
    for (const r of this.floor?.rooms ?? []) {
      for (const p of r.players ?? []) {
        if (normalize(p.name).replace(/^@/, '').replace(/[^a-z0-9_]/g, '_').slice(0, 25) === key) return p.name;
      }
    }
    return null;
  }

  /** Caméra : cadre une salle (vue spectateur, réalisateur). */
  focusRoom(r: RoomView, zoom = 3) {
    this.target = { x: (r.x * CW + (IW + 2) / 2) * PX, y: (r.y * CH + (IH + 3) / 2) * PX };
    this.zoomTarget = zoom;
  }

  /** Caméra : plan large de tout l'étage. */
  showWholeFloor() {
    const f = this.floor;
    if (!f || !f.rooms.length) return;
    const xs = f.rooms.map((r) => r.x);
    const ys = f.rooms.map((r) => r.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    this.target = { x: ((x0 + x1) / 2) * CW * PX, y: ((y0 + y1) / 2) * CH * PX };
    const fit = Math.min(this.canvas.clientWidth / ((x1 - x0) * CW * PX), this.canvas.clientHeight / ((y1 - y0) * CH * PX));
    this.zoomTarget = Math.max(0.5, Math.min(3, Math.floor(fit * 10) / 10));
  }

  centerOnCurrent(snap = false) {
    const f = this.floor;
    if (!f) return;
    const cur = f.rooms.find((x) => x.current);
    if (!cur) {
      // Vue spectateur : cadre tout l'étage
      const xs = f.rooms.map((r) => r.x);
      const ys = f.rooms.map((r) => r.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
      this.target = { x: ((x0 + x1) / 2) * CW * PX, y: ((y0 + y1) / 2) * CH * PX };
      if (snap) {
        const fit = Math.min(this.canvas.clientWidth / ((x1 - x0) * CW * PX), this.canvas.clientHeight / ((y1 - y0) * CH * PX));
        this.zoom = Math.max(0.5, Math.min(3, Math.floor(fit * 10) / 10));
        this.cam = { ...this.target };
      }
      return;
    }
    const r = cur;
    this.target = { x: (r.x * CW + (IW + 2) / 2) * PX, y: (r.y * CH + (IH + 3) / 2) * PX };
    if (snap) this.cam = { ...this.target };
  }

  /** Position monde (pixels) d'une entité dans sa salle. */
  private entityPos(r: RoomView, key: string): { x: number; y: number } | null {
    const ox = (r.x * CW + 1) * PX;
    const oy = (r.y * CH + 2) * PX;
    if (key.startsWith('m:')) {
      const list = r.monsters ?? [];
      const i = list.findIndex((m) => `m:${m.id}` === key);
      if (i < 0) return null;
      return this.monsterSpot(r, list[i], i, list.length).p;
    }
    const list = r.players ?? [];
    const i = list.findIndex((p) => `p:${p.name}` === key);
    if (i < 0) return null;
    return this.playerSpot(r, list[i], i, list.length);
  }

  /** Un monstre flâne autour de sa place (dérive lente et propre à chacun) ; renvoie aussi son sens de marche. */
  private monsterSpot(r: RoomView, m: MonsterView, i: number, n: number): { p: { x: number; y: number }; flip: boolean } {
    const base = slot((r.x * CW + 1) * PX, (r.y * CH + 2) * PX, i, n, m.boss ? 2.6 : 1.9);
    if (m.hp <= 0) return { p: base, flip: false };
    const seed = hash(m.id.split('').reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7)) % 1000;
    const t = performance.now() / 1000;
    const amp = m.boss ? 4 : 11;
    const w = 0.25 + (seed % 7) * 0.03;
    const x = base.x + Math.sin(t * w + seed) * amp + Math.sin(t * w * 2.3 + seed * 0.7) * amp * 0.3;
    const y = base.y + Math.sin(t * w * 0.8 + seed * 1.3) * (m.boss ? 2 : 5);
    const vx = Math.cos(t * w + seed) * w * amp + Math.cos(t * w * 2.3 + seed * 0.7) * w * 2.3 * amp * 0.3;
    return { p: { x, y }, flip: vx < 0 };
  }

  /** Où dessiner un crawler : sa position libre (moi, ou relayée) sinon sa place par défaut. */
  private playerSpot(r: RoomView, pl: PlayerPublic, i: number, n: number): { x: number; y: number } {
    const key = `${this.floor?.n}:${r.id}`;
    if (pl.alive && pl.me && this.me && this.me.roomKey === key) return { x: this.me.x, y: this.me.y };
    const rp = this.remote.get(pl.name);
    if (pl.alive && rp && rp.roomKey === key && performance.now() - rp.t < 120_000) return { x: rp.x, y: rp.y };
    return slot((r.x * CW + 1) * PX, (r.y * CH + 2) * PX, i, n, 4.6);
  }

  /** Avance mon crawler (touches ou clic), gère les portes et relaie la position. */
  private stepWalk(dt: number) {
    const f = this.floor;
    if (!f || !this.walkEnabled) return;
    let mine: { r: RoomView; pl: PlayerPublic; i: number; n: number } | null = null;
    for (const r of f.rooms) {
      const ps = r.players ?? [];
      const i = ps.findIndex((p) => p.me);
      if (i >= 0) mine = { r, pl: ps[i], i, n: ps.length };
    }
    if (!mine || !mine.pl.alive) {
      this.me = null;
      return;
    }
    const { r } = mine;
    const key = `${f.n}:${r.id}`;
    const b = interior(r);
    if (!this.me || this.me.roomKey !== key) {
      // Nouvelle salle : on entre par la porte d'où l'on vient (si on la connaît)
      const prev = this.me ? f.rooms.find((x) => `${f.n}:${x.id}` === this.me!.roomKey) : undefined;
      let start = slot(b.x0, b.y0, mine.i, mine.n, 4.6);
      if (prev && Math.abs(prev.x - r.x) + Math.abs(prev.y - r.y) === 1) {
        const d = doorPoints(r);
        start = prev.y < r.y ? d.n : prev.y > r.y ? d.s : prev.x < r.x ? d.o : d.e;
        start = { x: Math.min(b.x1 - 8, Math.max(b.x0 + 8, start.x)), y: Math.min(b.y1 - 2, Math.max(b.y0 + 12, start.y)) };
      }
      this.me = { roomKey: key, x: start.x, y: start.y, tx: null, ty: null, door: null, flip: false };
    }
    const me = this.me;
    const speed = 80; // pixels monde par seconde
    let vx = 0;
    let vy = 0;
    if (this.keys.size) {
      if (this.keys.has('n')) vy -= 1;
      if (this.keys.has('s')) vy += 1;
      if (this.keys.has('o')) vx -= 1;
      if (this.keys.has('e')) vx += 1;
    } else if (me.tx !== null && me.ty !== null) {
      vx = me.tx - me.x;
      vy = me.ty - me.y;
      if (Math.hypot(vx, vy) < 1.5) {
        me.tx = me.ty = null;
        vx = vy = 0;
      }
    }
    const len = Math.hypot(vx, vy);
    if (len > 0) {
      const step = Math.min(len, speed * dt);
      const nx = me.x + (vx / len) * step;
      const ny = me.y + (vy / len) * step;
      if (vx < -0.1) me.flip = true;
      else if (vx > 0.1) me.flip = false;
      const c = clampWalk(r, nx, ny);
      if (me.tx !== null && Math.hypot(c.x - me.x, c.y - me.y) < 0.05) me.tx = me.ty = null; // bloqué contre un mur
      me.x = c.x;
      me.y = c.y;
    }
    // Porte franchie : on programme le changement de salle (une fois par passage)
    const dir = doorReached(r, me.x, me.y);
    if (dir && me.door !== dir) {
      me.door = dir;
      this.onDoor?.(dir);
    } else if (!dir) me.door = null;
    // Relais de la position (au plus ~8 fois par seconde)
    const now = performance.now();
    if (now - this.lastWalkSent.t > 120 && (Math.abs(me.x - this.lastWalkSent.x) > 0.5 || Math.abs(me.y - this.lastWalkSent.y) > 0.5)) {
      this.lastWalkSent = { t: now, x: me.x, y: me.y };
      this.onWalk?.((me.x - b.x0) / (b.x1 - b.x0), (me.y - b.y0) / (b.y1 - b.y0));
    }
  }

  /** Clic sur la carte : sur un monstre = l'attaquer, au sol = y aller. */
  private click(e: PointerEvent) {
    const f = this.floor;
    if (!f || !this.me) return;
    const rect = this.canvas.getBoundingClientRect();
    const s = this.zoom * devicePixelRatio;
    const wx = ((e.clientX - rect.left) * devicePixelRatio - this.canvas.width / 2) / s + this.cam.x;
    const wy = ((e.clientY - rect.top) * devicePixelRatio - this.canvas.height / 2) / s + this.cam.y;
    const r = f.rooms.find((x) => `${f.n}:${x.id}` === this.me!.roomKey);
    if (!r) return;
    const ox = (r.x * CW + 1) * PX;
    const oy = (r.y * CH + 2) * PX;
    const ms = r.monsters ?? [];
    for (let i = 0; i < ms.length; i++) {
      const p = this.monsterSpot(r, ms[i], i, ms.length).p;
      const h = ms[i].boss ? 40 : 26;
      if (Math.abs(wx - p.x) < (ms[i].boss ? 18 : 11) && wy > p.y - h && wy < p.y + 5) {
        this.onAttackMonster?.(i + 1, ms[i].name);
        this.me.tx = p.x;
        this.me.ty = p.y + 14;
        return;
      }
    }
    const b = interior(r);
    if (wx < b.x0 - 24 || wx > b.x1 + 24 || wy < b.y0 - 36 || wy > b.y1 + 30) return; // clic hors de ma salle
    this.me.tx = wx;
    this.me.ty = wy;
  }

  draw(t: number) {
    const { ctx, canvas } = this;
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#15110e';
    ctx.fillRect(0, 0, w, h);
    const f = this.floor;
    if (!f || !this.tiles.img) return;

    const nowF = performance.now();
    const dtF = this.lastFrame ? Math.min(0.1, (nowF - this.lastFrame) / 1000) : 0;
    this.lastFrame = nowF;
    this.stepWalk(dtF);
    for (const rp of this.remote.values()) {
      const k2 = Math.min(1, dtF * 10);
      rp.x += (rp.dx - rp.x) * k2;
      rp.y += (rp.dy - rp.y) * k2;
    }

    // Caméra
    if (this.zoomTarget !== null) {
      this.zoom += (this.zoomTarget - this.zoom) * 0.12;
      if (Math.abs(this.zoomTarget - this.zoom) < 0.01) this.zoom = this.zoomTarget;
    }
    this.shake = Math.max(this.shake, this.fx.shake);
    this.fx.shake = 0;
    // Caméra plus vive ; au-delà d'environ 2 salles, on coupe direct (comme en régie télé)
    const far = Math.hypot(this.target.x - this.cam.x, this.target.y - this.cam.y) > 2.2 * CW * PX;
    const k = far ? 1 : 0.18;
    this.cam.x += (this.target.x - this.cam.x) * k;
    this.cam.y += (this.target.y - this.cam.y) * k;
    const s = this.zoom * devicePixelRatio;
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    this.shake *= 0.9;
    ctx.setTransform(s, 0, 0, s, Math.round(w / 2 - this.cam.x * s + sx * s), Math.round(h / 2 - this.cam.y * s + sy * s));

    const ox = Math.round(w / 2 - this.cam.x * s + sx * s);
    const oy = Math.round(h / 2 - this.cam.y * s + sy * s);
    const known = new Map(f.rooms.map((r) => [r.id, r]));
    // Couloirs vers l'inconnu d'abord, puis salles
    for (const r of f.rooms) this.drawCorridors(r, known);
    this.stairsMark = null;
    for (const r of f.rooms) this.drawRoom(r, t, f.theme);
    const stairs = this.stairsMark as { x: number; y: number; bossAlive: boolean } | null;
    const seal = Math.max(0, (f.stairsInSec ?? 0) - (performance.now() - this.floorAt) / 1000);
    const sealed = f.stairsInSec === null || seal > 0;
    if (stairs) {
      // Halo qui pulse : doré quand on peut descendre, violet tant que c'est scellé ou gardé
      const open = !sealed && !stairs.bossAlive;
      const pulse = 0.55 + 0.45 * Math.sin(t * (open ? 5 : 2.5));
      const rad = PX * (open ? 3.4 : 2.8);
      const g = ctx.createRadialGradient(stairs.x, stairs.y, 2, stairs.x, stairs.y, rad);
      g.addColorStop(0, open ? `rgba(255,214,90,${0.75 * pulse})` : `rgba(170,110,255,${0.55 * pulse})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.fillRect(stairs.x - rad, stairs.y - rad, rad * 2, rad * 2);
      ctx.restore();
    }
    const nowFx = performance.now();
    const vis = this.visibleKeys;
    this.fx.update(nowFx, (key) => vis.has(key));
    this.visibleKeys = new Set();
    for (const r of f.rooms) if (r.players || r.monsters) this.drawEntities(r, t);
    this.fx.drawWorld(ctx, nowFx, (name, x, y, tt) => this.tiles.drawAnchored(ctx, name, x, y, tt));

    // Nombres flottants
    const now = performance.now();
    this.floaters = this.floaters.filter((fl) => now - fl.t0 < 1400);
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    for (const fl of this.floaters) {
      if (now < fl.t0) continue;
      const a = (now - fl.t0) / 1400;
      ctx.globalAlpha = 1 - a;
      ctx.fillStyle = '#000';
      ctx.fillText(fl.text, fl.x + 1, fl.y - a * 14 + 1);
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.text, fl.x, fl.y - a * 14);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawLabels((x, y) => [ox + x * s, oy + y * s]);
    this.drawMarks((x, y) => [ox + x * s, oy + y * s]);
    const sign = stairs ? [ox + stairs.x * s, oy + (stairs.y - PX * 1.6) * s, w, h, t, sealed ? (f.stairsInSec === null ? -1 : seal) : 0, stairs.bossAlive] as const : null;
    this.fx.drawScreen(ctx, nowFx, (x, y) => [ox + x * s, oy + y * s]);

    // Teinte du thème + vignette
    const tint = THEME_TINT[f.theme];
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, w, h);
    }
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (this.fx.screenFlash > 0.02) {
      ctx.fillStyle = `rgba(255,244,214,${this.fx.screenFlash})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (sign) this.drawStairsSign(...sign); // par-dessus la vignette : toujours bien lisible
  }

  private drawCorridors(r: RoomView, known: Map<number, RoomView>) {
    const { ctx } = this;
    const ox = r.x * CW;
    const oy = r.y * CH;
    for (const [d, id] of Object.entries(r.doors) as [Dir, number][]) {
      const unknown = !known.has(id);
      if (!unknown && (d === 'o' || d === 'n')) continue; // déjà dessiné par l'autre salle
      ctx.globalAlpha = unknown ? 0.45 : 1;
      if (d === 'e' || d === 'o') {
        const ty = oy + 2 + Math.floor(IH / 2);
        const x0 = d === 'e' ? ox + IW + 2 : ox - GAP;
        const len = unknown ? 1 : GAP;
        const start = d === 'e' ? x0 : ox - len;
        for (let i = 0; i < len; i++) this.floorTile(start + i, ty, 3);
        ctx.fillStyle = '#1a1420';
        ctx.fillRect(start * PX, ty * PX - 3, len * PX, 3);
        ctx.fillRect(start * PX, (ty + 1) * PX, len * PX, 3);
      } else {
        const tx = ox + 1 + Math.floor(IW / 2);
        const len = unknown ? 1 : GAP;
        const start = d === 's' ? oy + IH + 3 : oy - len;
        for (let i = 0; i < len; i++) this.floorTile(tx, start + i, 3);
        ctx.fillStyle = '#1a1420';
        ctx.fillRect(tx * PX - 3, start * PX, 3, len * PX);
        ctx.fillRect((tx + 1) * PX, start * PX, 3, len * PX);
      }
    }
    ctx.globalAlpha = 1;
  }

  private floorTile(tx: number, ty: number, seed: number) {
    const v = hash(tx * 73 + ty * 131 + seed) % 100;
    const name = v < 70 ? 'floor_1' : `floor_${2 + (v % 7)}`;
    this.tiles.tile(this.ctx, name, tx, ty);
  }

  /** Le décor partagé avec le stream 3D : mêmes objets, mêmes places (tapis, os, éboulis, flaques, tonneaux…). */
  private drawDecor(r: RoomView, ox: number, oy: number, theme: string) {
    const { ctx, tiles } = this;
    const X = (u: number) => (ox + 1 + ((u + 1) / 2) * IW) * PX;
    const Y = (v: number) => (oy + 2 + ((v + 1) / 2) * IH) * PX;
    const props = roomDecor(this.floor?.n ?? 1, r, theme);
    // Au sol d'abord (tapis, flaques, brûlures), puis ce qui dépasse
    const flat = (p: Prop) => p.kind === 'rug_red' || p.kind === 'rug_blue' || p.kind === 'puddle' || p.kind === 'scorch';
    for (const p of [...props.filter(flat), ...props.filter((x) => !flat(x))]) {
      const x = X(p.u);
      const y = Y(p.v);
      const rand = rng(p.seed);
      ctx.save();
      switch (p.kind) {
        case 'rug_red':
        case 'rug_blue': {
          const w = p.w! * IW * PX;
          const h = p.h! * IH * PX;
          ctx.translate(x, y);
          ctx.rotate(p.rot * 0.4); // vu de dessus, à plat : on garde un peu de l'angle
          ctx.fillStyle = p.kind === 'rug_red' ? '#6e1c1f' : '#1d3766';
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.strokeStyle = p.kind === 'rug_red' ? '#c8933a' : '#d8c27a';
          ctx.lineWidth = 2;
          ctx.strokeRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
          break;
        }
        case 'puddle':
          ctx.fillStyle = 'rgba(10,12,20,0.55)';
          for (let i = 0; i < (p.n ?? 3); i++) {
            ctx.beginPath();
            ctx.ellipse(x + (rand() - 0.5) * PX * 0.9, y + (rand() - 0.5) * PX * 0.5, PX * (0.2 + rand() * 0.3), PX * (0.12 + rand() * 0.18), 0, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        case 'scorch':
          ctx.fillStyle = 'rgba(0,0,0,0.38)';
          ctx.beginPath();
          ctx.ellipse(x, y, PX * 0.35 * p.s, PX * 0.22 * p.s, p.rot, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'bones':
          ctx.strokeStyle = '#d9cfb6';
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          for (let i = 0; i < Math.min(6, p.n ?? 4); i++) {
            const a = rand() * Math.PI;
            const bx = x + (rand() - 0.5) * PX * 0.9;
            const by = y + (rand() - 0.5) * PX * 0.6;
            ctx.beginPath();
            ctx.moveTo(bx - Math.cos(a) * 5, by - Math.sin(a) * 3);
            ctx.lineTo(bx + Math.cos(a) * 5, by + Math.sin(a) * 3);
            ctx.stroke();
          }
          if (p.skull) tiles.drawAnchored(ctx, 'skull', x, y + PX * 0.3);
          break;
        case 'rubble':
          for (let i = 0; i < Math.min(7, p.n ?? 5); i++) {
            const rx = x + (rand() - 0.5) * PX * 1.1;
            const ry = y + (rand() - 0.5) * PX * 0.7;
            const rr = 2 + rand() * 4;
            ctx.fillStyle = rand() < 0.5 ? '#6f645c' : '#857a70';
            ctx.beginPath();
            ctx.ellipse(rx, ry, rr, rr * 0.75, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        case 'barrel':
        case 'barrel_stack': {
          const k = p.kind === 'barrel_stack' ? 2 : 1;
          for (let i = 0; i < k; i++) {
            const bx = x + i * PX * 0.45;
            const rad = PX * 0.32 * p.s;
            ctx.fillStyle = '#6e4526';
            if (p.tipped) {
              ctx.fillRect(bx - rad * 1.3, y - rad * 0.8, rad * 2.6, rad * 1.6);
              ctx.fillStyle = '#3d2614';
              ctx.fillRect(bx - rad * 0.7, y - rad * 0.8, 3, rad * 1.6);
              ctx.fillRect(bx + rad * 0.6, y - rad * 0.8, 3, rad * 1.6);
            } else {
              ctx.beginPath();
              ctx.ellipse(bx, y, rad, rad * 0.9, 0, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = '#3d2614';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.ellipse(bx, y, rad * 0.7, rad * 0.62, 0, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
          break;
        }
        case 'crates':
          tiles.drawAnchored(ctx, 'crate', x - PX * 0.3, y + PX * 0.5);
          tiles.drawAnchored(ctx, 'crate', x + PX * 0.35, y + PX * 0.5);
          tiles.drawAnchored(ctx, 'crate', x, y);
          break;
        case 'box':
          tiles.drawAnchored(ctx, 'crate', x, y + PX * 0.5);
          break;
        case 'coins':
          tiles.drawAnchored(ctx, 'coin_anim_f0', x, y + PX * 0.3);
          break;
      }
      ctx.restore();
    }
  }

  private drawRoom(r: RoomView, t: number, theme: string) {
    const { ctx, tiles } = this;
    const ox = r.x * CW;
    const oy = r.y * CH;
    const openE = r.doors.e !== undefined;
    const openO = r.doors.o !== undefined;
    const openN = r.doors.n !== undefined;
    const openS = r.doors.s !== undefined;
    const midRow = oy + 2 + Math.floor(IH / 2);
    const midCol = ox + 1 + Math.floor(IW / 2);

    // Sol
    for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) this.floorTile(ox + 1 + x, oy + 2 + y, r.id);
    // Mur du haut : chapeau + façade
    for (let x = 0; x < IW + 2; x++) {
      const tx = ox + x;
      if (openN && tx === midCol) {
        this.floorTile(tx, oy, r.id);
        this.floorTile(tx, oy + 1, r.id);
        continue;
      }
      tiles.tile(ctx, x === 0 ? 'wall_top_left' : x === IW + 1 ? 'wall_top_right' : 'wall_top_mid', tx, oy);
      tiles.tile(ctx, x === 0 ? 'wall_left' : x === IW + 1 ? 'wall_right' : 'wall_mid', tx, oy + 1);
    }
    // Décor du mur du haut
    if (r.type === 'safe') {
      tiles.tile(ctx, 'wall_banner_blue', ox + 2, oy + 1);
      tiles.tile(ctx, 'wall_fountain_mid_blue_anim', ox + IW - 1, oy + 1, t);
      tiles.tile(ctx, 'wall_fountain_top_1', ox + IW - 1, oy);
      tiles.tile(ctx, 'wall_fountain_basin_blue_anim', ox + IW - 1, oy + 2, t);
    } else if (r.type === 'arene') {
      tiles.tile(ctx, 'wall_banner_red', ox + 2, oy + 1);
      tiles.tile(ctx, 'wall_banner_red', ox + IW - 1, oy + 1);
    } else if (r.type === 'boss') {
      tiles.tile(ctx, 'wall_banner_yellow', ox + 2, oy + 1);
      tiles.tile(ctx, 'wall_fountain_mid_red_anim', ox + IW - 1, oy + 1, t);
      tiles.tile(ctx, 'wall_fountain_top_1', ox + IW - 1, oy);
      tiles.tile(ctx, 'wall_fountain_basin_red_anim', ox + IW - 1, oy + 2, t);
    } else if (hash(r.id) % 4 === 0) tiles.tile(ctx, hash(r.id) % 8 === 0 ? 'wall_hole_1' : 'wall_goo', ox + 1 + (hash(r.id) % IW), oy + 1);
    // Murs latéraux et du bas
    for (let y = 2; y < IH + 2; y++) {
      const ty = oy + y;
      if (!(openO && ty === midRow)) tiles.tile(ctx, 'wall_mid', ox, ty);
      else this.floorTile(ox, ty, r.id);
      if (!(openE && ty === midRow)) tiles.tile(ctx, 'wall_mid', ox + IW + 1, ty);
      else this.floorTile(ox + IW + 1, ty, r.id);
    }
    for (let x = 0; x < IW + 2; x++) {
      const tx = ox + x;
      if (openS && tx === midCol) this.floorTile(tx, oy + IH + 2, r.id);
      else tiles.tile(ctx, 'wall_mid', tx, oy + IH + 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect((ox + 1) * PX, (oy + 2) * PX, IW * PX, 4); // ombre sous la façade
    this.drawDecor(r, ox, oy, theme);

    // Objets de la salle
    if (r.stairs) {
      // La sortie de l'étage : des marches qui descendent, encadrées de deux colonnes, fermées par une grille
      // tant que l'escalier est scellé ou gardé par le boss
      for (let dy = 0; dy < 2; dy++) for (let dx = -1; dx <= 1; dx++) tiles.tile(ctx, 'floor_stairs', midCol + dx, oy + 2 + dy);
      const seal = Math.max(0, (this.floor?.stairsInSec ?? 0) - (performance.now() - this.floorAt) / 1000);
      const closed = !!r.bossAlive || this.floor?.stairsInSec === null || seal > 0;
      if (closed) this.drawStretched('doors_leaf_closed', (midCol - 1) * PX, (oy + 2) * PX, 3 * PX, 2 * PX);
      else {
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; // l'ombre de la descente
        ctx.fillRect((midCol - 1) * PX + 3, (oy + 3) * PX + 4, 3 * PX - 6, PX - 4);
      }
      tiles.drawAnchored(ctx, 'column', (midCol - 1.5) * PX, (oy + 4) * PX);
      tiles.drawAnchored(ctx, 'column', (midCol + 2.5) * PX, (oy + 4) * PX);
      this.stairsMark = { x: (midCol + 0.5) * PX, y: (oy + 3) * PX, bossAlive: !!r.bossAlive };
    }
    if (r.trapArmed) tiles.tile(ctx, 'floor_spikes_anim', midCol, midRow, t);
    if (r.chest !== 'aucun') tiles.drawAnchored(ctx, r.chest === 'ferme' ? 'chest_full_open_anim_f0' : 'chest_empty_open_anim_f2', (midCol + 0.5) * PX, (oy + 3) * PX);
    if (r.feature) {
      // Salles spéciales : l'objet au milieu du mur du haut
      const fx = (midCol + 0.5) * PX;
      const fy = (oy + 2.6) * PX;
      if (r.feature === 'autel') {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(fx - PX * 0.9 + 3, fy + PX * 0.35, PX * 1.8, 6);
        ctx.fillStyle = '#8d8a96';
        ctx.fillRect(fx - PX * 0.9, fy - PX * 0.35, PX * 1.8, PX * 0.75);
        ctx.fillStyle = '#b0adb8';
        ctx.fillRect(fx - PX, fy - PX * 0.5, PX * 2, PX * 0.2);
        ctx.fillStyle = '#a3161b';
        ctx.fillRect(fx - PX * 0.2, fy - PX * 0.3, PX * 0.4, PX * 0.6);
        for (const dx of [-0.75, 0.75]) {
          ctx.fillStyle = '#efe6cf';
          ctx.fillRect(fx + dx * PX - 2, fy - PX * 0.85, 4, PX * 0.35);
          ctx.fillStyle = `rgba(255,200,80,${0.75 + 0.25 * Math.sin(t * 9 + dx)})`;
          ctx.beginPath();
          ctx.ellipse(fx + dx * PX, fy - PX * 0.95, 3, 5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (r.feature === 'fontaine') {
        tiles.tile(ctx, 'wall_fountain_top_1', midCol, oy);
        tiles.tile(ctx, 'wall_fountain_mid_blue_anim', midCol, oy + 1, t);
        tiles.tile(ctx, 'wall_fountain_basin_blue_anim', midCol, oy + 2, t);
        ctx.fillStyle = `rgba(120,220,255,${0.12 + 0.06 * Math.sin(t * 3)})`;
        ctx.beginPath();
        ctx.ellipse(fx, fy + PX * 0.2, PX * 1.4, PX * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (r.feature === 'puits') {
        const wy = (midRow + 0.5) * PX;
        ctx.fillStyle = '#6f645c';
        ctx.beginPath();
        ctx.ellipse(fx, wy, PX * 0.85, PX * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#132a3a';
        ctx.beginPath();
        ctx.ellipse(fx, wy - 2, PX * 0.55, PX * 0.36, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,214,90,${0.5 + 0.4 * Math.sin(t * 5)})`;
        ctx.fillRect(fx - 2, wy - 4, 3, 3);
      } else if (r.feature === 'prisonnier') {
        ctx.strokeStyle = '#9a9aa8';
        ctx.lineWidth = 2;
        for (const dx of [-0.45, 0.45]) {
          ctx.beginPath();
          ctx.moveTo(fx + dx * PX, (oy + 1.8) * PX);
          ctx.lineTo(fx + dx * PX * (r.featureDone ? 0.6 : 0.4), fy + (r.featureDone ? PX * 0.6 : 0));
          ctx.stroke();
        }
        if (!r.featureDone) tiles.drawAnchored(ctx, 'elf_f_idle_anim', fx, fy + PX * 0.6, t);
      } else if (r.feature === 'ogre') {
        for (let i = 0; i < 5; i++) tiles.drawAnchored(ctx, 'coin_anim_f0', fx + (i - 2) * 7, fy + PX * 0.4 + (i % 2) * 4);
      }
    }
    if (r.crypt) {
      // La crypte : une pierre tombale par éliminé qui attend qu'on le ressuscite, et quelques crânes
      tiles.drawAnchored(ctx, 'skull', (ox + 1.5) * PX, (oy + IH + 0.5) * PX);
      tiles.drawAnchored(ctx, 'skull', (ox + IW - 1.2) * PX, (oy + 2.6) * PX);
      r.crypt.slice(0, 6).forEach((g, i) => {
        const x = (ox + 1.6 + (i % 3) * 1.9) * PX;
        const y = (oy + 2.2 + Math.floor(i / 3) * 1.6) * PX;
        const w = PX * 0.8;
        const h = PX * 1.05;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x - w / 2 + 3, y + 2, w, 5);
        ctx.fillStyle = '#8d8a96';
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - h, w, h, [w / 2, w / 2, 2, 2]);
        ctx.fill();
        ctx.fillStyle = '#5d5a66';
        ctx.fillRect(x - 1.5, y - h * 0.78, 3, h * 0.5);
        ctx.fillRect(x - w * 0.22, y - h * 0.62, w * 0.44, 3);
        this.labels.push({ text: g.name, x, y: y - h - 4, color: '#c9c2d8', hp: 0, maxHp: 0 });
      });
    }
    if (r.forge) {
      // La forge : un feu de forge dans le mur, le forgeron (nain) et ses caisses
      tiles.tile(ctx, 'wall_fountain_mid_red_anim', ox + 2, oy + 1, t);
      tiles.tile(ctx, 'wall_fountain_top_1', ox + 2, oy);
      tiles.tile(ctx, 'wall_fountain_basin_red_anim', ox + 2, oy + 2, t);
      tiles.drawAnchored(ctx, 'crate', (ox + IW - 0.5) * PX, (oy + 3.4) * PX);
      tiles.drawAnchored(ctx, 'dwarf_m_idle_anim', (ox + 3.6) * PX, (oy + 3.6) * PX, t);
      ctx.fillStyle = `rgba(255,120,40,${0.18 + 0.08 * Math.sin(t * 6)})`; // lueur du feu
      ctx.fillRect((ox + 1) * PX, (oy + 2) * PX, 3 * PX, 2 * PX);
      const b = this.bubbles.get(`marchand:${r.id}`);
      if (b) this.bubblePos.push({ text: b.text, x: (ox + 3.6) * PX, y: (oy + 3.6) * PX - 30, t0: b.t0, dur: b.dur, npc: true });
    }
    if (r.merchant) {
      tiles.drawAnchored(ctx, 'doc_idle_anim', (ox + 2.5) * PX, (oy + 3.2) * PX, t);
      const b = this.bubbles.get(`marchand:${r.id}`);
      if (b) this.bubblePos.push({ text: b.text, x: (ox + 2.5) * PX, y: (oy + 3.2) * PX - 26, t0: b.t0, dur: b.dur, npc: true });
    }
    if ((r.ground?.length ?? 0) > 0) tiles.drawAnchored(ctx, 'skull', (ox + IW - 0.2) * PX, (oy + IH + 1.6) * PX);
    if ((r.groundGold ?? 0) > 0) tiles.drawAnchored(ctx, 'coin_anim', (ox + IW - 0.9) * PX, (oy + IH + 1.6) * PX, t);

    // Brouillard : salles connues mais pas surveillées
    if (!r.current && !r.players && !r.monsters) {
      ctx.fillStyle = 'rgba(8,6,14,0.62)';
      ctx.fillRect(ox * PX, oy * PX, (IW + 2) * PX, (IH + 3) * PX);
    }
    this.markRoom(r, ox, oy);
    if (r.current) {
      ctx.strokeStyle = 'rgba(255,214,90,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ox * PX + 0.5, oy * PX + 0.5, (IW + 2) * PX - 1, (IH + 3) * PX - 1);
    }
    void theme;
  }

  private drawEntities(r: RoomView, t: number) {
    const { ctx, tiles } = this;
    const ox = (r.x * CW + 1) * PX;
    const oy = (r.y * CH + 2) * PX;
    const ms = r.monsters ?? [];
    const ps = r.players ?? [];
    const now = performance.now();
    ms.forEach((m, i) => {
      const key = `m:${m.id}`;
      const { p, flip } = this.monsterSpot(r, m, i, ms.length);
      this.fx.lastPos.set(key, p);
      this.visibleKeys.add(key);
      const o = this.fx.offset(key, now);
      this.drawFlashing(key, m.sprite, p.x + o.x, p.y + o.y, t + (m.asleep ? 0 : i * 0.37), flip, now);
      if (m.asleep) {
        // Il ronfle : des « z » qui montent
        ctx.font = `700 ${Math.round(11 + 3 * ((t * 0.7) % 1))}px 'Alegreya Sans', system-ui, sans-serif`;
        ctx.fillStyle = `rgba(200,220,255,${1 - ((t * 0.7) % 1)})`;
        ctx.fillText('z', p.x + 14 + 8 * ((t * 0.7) % 1), p.y - 30 - 16 * ((t * 0.7) % 1));
      }
      this.label(m.name, p.x, p.y - (m.boss ? 38 : 20), m.boss ? '#ffcf4a' : '#ff9a9a', m.hp, m.maxHp);
    });
    ps.forEach((pl, i) => {
      const key = `p:${pl.name}`;
      const p = this.playerSpot(r, pl, i, ps.length);
      this.fx.lastPos.set(key, p);
      this.visibleKeys.add(key);
      if (!pl.alive) {
        tiles.drawAnchored(ctx, 'skull', p.x, p.y);
        this.label(pl.name, p.x, p.y - 14, '#888', 0, pl.maxHp);
        return;
      }
      if (pl.immune) {
        ctx.fillStyle = `rgba(120,200,255,${0.25 + 0.1 * Math.sin(t * 4)})`;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - 2, 9, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const o = this.fx.offset(key, now);
      const flip = pl.me && this.me ? this.me.flip : i % 2 === 1;
      this.drawFlashing(key, CLASS_SPRITE[pl.cls], p.x + o.x, p.y + o.y, t + i * 0.29, flip, now);
      const color = pl.me ? '#ffd65a' : pl.traitor ? '#ff4d8d' : pl.ally ? '#6dff8a' : pl.bot ? '#a9b8cc' : '#ffffff';
      this.label(pl.name + (pl.traitor ? ' ☠' : ''), p.x, p.y - 31, color, pl.hp, pl.maxHp);
      const b = this.bubbles.get(pl.name);
      if (b) this.bubblePos.push({ text: b.text, x: p.x, y: p.y - 40, t0: b.t0, dur: b.dur, npc: false });
    });
  }

  /** Sprite avec flash blanc (coup reçu) ou rouge (piège, gag). */
  private drawFlashing(key: string, sprite: string, x: number, y: number, t: number, flip: boolean, now: number) {
    const { ctx, tiles } = this;
    tiles.drawAnchored(ctx, sprite, x, y, t, flip);
    const f = this.fx.flash(key, now);
    if (f.a <= 0) return;
    ctx.save();
    if (f.color === 'red') {
      ctx.globalAlpha = 0.5 * f.a;
      ctx.fillStyle = '#ff2a2a';
      ctx.beginPath();
      ctx.ellipse(x, y - 9, 9, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = f.a;
    tiles.drawAnchored(ctx, sprite, x, y, t, flip);
    tiles.drawAnchored(ctx, sprite, x, y, t, flip);
    ctx.restore();
  }

  private label(text: string, x: number, y: number, color: string, hp: number, maxHp: number) {
    this.labels.push({ text: text.length > 18 ? text.slice(0, 17) + '…' : text, x, y, color, hp, maxHp });
  }

  /** Sprite étiré à une taille donnée (la grille de l'escalier couvre les 3 marches). */
  private drawStretched(name: string, x: number, y: number, w: number, h: number) {
    const r = this.tiles.resolve(name);
    if (!r) return;
    this.ctx.drawImage(this.tiles.img, r.x, r.y, r.w, r.h, Math.round(x), Math.round(y), w, h);
  }

  /** Panneau « ESCALIER » bien visible au-dessus des marches, avec son état ; flèche au bord de l'écran s'il est hors champ. */
  private drawStairsSign(x: number, y: number, w: number, h: number, t: number, seal: number, bossAlive: boolean) {
    const { ctx } = this;
    const dpr = devicePixelRatio;
    const status = seal < 0 ? '🔒 sealed (timer not started)' : seal > 0 ? `🔒 opens in ${Math.floor(seal / 60)}:${String(Math.floor(seal % 60)).padStart(2, '0')}` : bossAlive ? '⚔ beat the boss to get through' : '🔓 OPEN: !descend';
    const open = seal === 0 && !bossAlive;
    const color = open ? '#ffd65a' : '#c9a8ff';
    const m = 40 * dpr;
    const off = x < m || x > w - m || y < m + 60 * dpr || y > h - m;
    if (off) {
      // Hors champ : flèche dans la direction de l'escalier, posée sur une ellipse à l'intérieur de la carte
      // (pas collée au bord, où les barres de l'interface la cacheraient)
      const cx = w / 2;
      const cy = h / 2;
      const a = Math.atan2(y - cy, x - cx);
      const rx = Math.max(60 * dpr, w / 2 - 110 * dpr);
      const ry = Math.max(50 * dpr, h / 2 - 90 * dpr);
      const ax = cx + Math.cos(a) * rx;
      const ay = cy + Math.sin(a) * ry;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(a);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#120c1c';
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      ctx.moveTo(16 * dpr, 0);
      ctx.lineTo(-8 * dpr, -11 * dpr);
      ctx.lineTo(-8 * dpr, 11 * dpr);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
      ctx.font = `700 ${Math.round(12 * dpr)}px 'Alegreya Sans', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const lx = Math.min(w - 50 * dpr, Math.max(50 * dpr, ax - Math.cos(a) * 30 * dpr));
      const ly = Math.min(h - 12 * dpr, Math.max(20 * dpr, ay - Math.sin(a) * 24 * dpr));
      ctx.fillStyle = 'rgba(8,6,14,0.8)';
      const tw = ctx.measureText('STAIRS').width + 10 * dpr;
      ctx.fillRect(lx - tw / 2, ly - 13 * dpr, tw, 17 * dpr);
      ctx.fillStyle = color;
      ctx.fillText('STAIRS', lx, ly);
      return;
    }
    const bob = Math.sin(t * 4) * 3 * dpr;
    const big = Math.round(15 * dpr);
    const small = Math.round(11 * dpr);
    ctx.textAlign = 'center';
    ctx.font = `800 ${big}px 'Alegreya Sans', system-ui, sans-serif`;
    const title = '▼ STAIRS ▼';
    const tw = Math.max(ctx.measureText(title).width, (ctx.font = `600 ${small}px 'Alegreya Sans', system-ui, sans-serif`, ctx.measureText(status).width)) + 16 * dpr;
    const top = y - 40 * dpr + bob;
    ctx.fillStyle = 'rgba(12,8,20,0.88)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.roundRect(x - tw / 2, top, tw, 38 * dpr, 7 * dpr);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `800 ${big}px 'Alegreya Sans', system-ui, sans-serif`;
    ctx.fillText(title, x, top + 17 * dpr);
    ctx.font = `600 ${small}px 'Alegreya Sans', system-ui, sans-serif`;
    ctx.fillStyle = '#f2ecff';
    ctx.fillText(status, x, top + 32 * dpr);
  }

  /**
   * Repères des salles connues : un liseré de couleur selon ce qu'est la salle
   * (bleu safe room, or forge ou trésor, rouge boss ou piège, pourpre arène),
   * un écusson avec son icône, et le nombre de monstres vus la dernière fois qu'on y était.
   */
  private markRoom(r: RoomView, ox: number, oy: number) {
    const key = `${this.floor?.uid ?? this.floor?.n}:${r.id}`;
    if (r.monsters) {
      this.memo.set(key, {
        monsters: r.monsters.filter((m) => !m.boss && m.hp > 0).length,
        boss: r.monsters.some((m) => m.boss && m.hp > 0),
        loot: (r.ground?.length ?? 0) > 0 || (r.groundGold ?? 0) > 0,
      });
    }
    if (r.current) return;
    const seen = this.memo.get(key);
    let color: string | null = null;
    let icon: string | null = null;
    let dash = false;
    let dim = false;
    if (r.forge) { color = '#e0a826'; icon = 'weapon_hammer'; }
    else if (r.type === 'safe') { color = '#5b8fe6'; icon = 'ui_heart_full'; }
    else if (r.type === 'boss') { color = r.bossAlive ? '#e5484d' : '#8f8676'; icon = 'skull'; dim = !r.bossAlive; }
    else if (r.type === 'piege') { color = r.trapArmed ? '#e5484d' : '#b8544f'; icon = 'floor_spikes_anim_f3'; dash = !r.trapArmed; }
    else if (r.type === 'tresor') { color = '#e0a826'; icon = r.chest === 'ferme' ? 'chest_full_open_anim_f0' : 'coin'; dash = true; dim = r.chest !== 'ferme'; }
    else if (r.type === 'arene') { color = '#b07cff'; icon = 'weapon_duel_sword'; }
    else if (r.chest === 'ferme') icon = 'chest_full_open_anim_f0';
    if (r.feature) {
      // Salles spéciales : pastille turquoise (estompée une fois utilisée)
      color = '#3fa7a0';
      icon = { autel: 'flask_big_red', fontaine: 'flask_big_blue', puits: 'coin_anim_f0', prisonnier: 'ui_heart_empty', ogre: 'ogre_idle_anim_f0' }[r.feature];
      dim = !!r.featureDone;
    }
    if (r.stairs) icon = null; // l'escalier a déjà son panneau
    if (color) {
      const { ctx } = this;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = dim ? 0.55 : 0.95;
      ctx.lineWidth = 2;
      if (dash) ctx.setLineDash([6, 4]);
      ctx.strokeRect(ox * PX + 2, oy * PX + 2, (IW + 2) * PX - 4, (IH + 3) * PX - 4);
      ctx.restore();
    }
    const count = seen && !r.monsters ? seen.monsters + (seen.boss ? 1 : 0) : 0;
    const loot = !!seen && !r.ground && seen.loot;
    if (icon || count || loot) this.marks.push({ x: (ox + 0.5) * PX, y: (oy + 0.5) * PX, color: color ?? '#e0a826', icon, dim, count, loot });
  }

  private drawMarks(toScreen: (x: number, y: number) => [number, number]) {
    const { ctx } = this;
    const dpr = devicePixelRatio;
    const S = 22 * dpr;
    for (const m of this.marks) {
      let [x, y] = toScreen(m.x, m.y);
      ctx.globalAlpha = m.dim ? 0.6 : 1;
      if (m.icon) {
        // Écusson : haut droit, pointe en bas, comme un petit blason
        ctx.fillStyle = '#f4f2ec';
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + S, y);
        ctx.lineTo(x + S, y + S * 0.62);
        ctx.quadraticCurveTo(x + S, y + S * 1.05, x + S / 2, y + S * 1.22);
        ctx.quadraticCurveTo(x, y + S * 1.05, x, y + S * 0.62);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        const r = this.tiles.resolve(m.icon);
        if (r) {
          const k = Math.min((S - 6 * dpr) / r.w, (S - 6 * dpr) / r.h);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(this.tiles.img, r.x, r.y, r.w, r.h, Math.round(x + S / 2 - (r.w * k) / 2), Math.round(y + 3 * dpr + (S - 4 * dpr - r.h * k) / 2), Math.round(r.w * k), Math.round(r.h * k));
        }
        x += S + 4 * dpr;
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (m.count) {
        // Monstres vus la dernière fois (l'info peut être périmée : pastille, pas de certitude)
        const rr = 9 * dpr;
        ctx.fillStyle = '#a3161b';
        ctx.beginPath();
        ctx.arc(x + rr, y + rr + 1 * dpr, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `800 ${Math.round(12 * dpr)}px 'Alegreya Sans', system-ui, sans-serif`;
        ctx.fillText(String(m.count), x + rr, y + rr + 1.5 * dpr);
        x += rr * 2 + 4 * dpr;
      }
      if (m.loot) {
        const r = this.tiles.resolve('coin');
        if (r) ctx.drawImage(this.tiles.img, r.x, r.y, r.w, r.h, Math.round(x), Math.round(y + 2 * dpr), Math.round(r.w * 2 * dpr), Math.round(r.h * 2 * dpr));
      }
      ctx.textBaseline = 'alphabetic';
    }
    this.marks = [];
  }

  /** Noms et barres de vie dessinés en résolution écran, pour rester nets. */
  private drawLabels(toScreen: (x: number, y: number) => [number, number]) {
    const { ctx } = this;
    const dpr = devicePixelRatio;
    const fs = Math.round((this.zoom >= 3 ? 12 : this.zoom === 2 ? 11 : 10) * dpr);
    ctx.font = `600 ${fs}px 'Alegreya Sans', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const l of this.labels) {
      if (this.zoom < 2 && l.maxHp === 0) continue;
      const [x, y] = toScreen(l.x, l.y);
      const w = ctx.measureText(l.text).width + 8 * dpr;
      ctx.fillStyle = 'rgba(8,6,14,0.72)';
      ctx.fillRect(x - w / 2, y - fs, w, fs + 4 * dpr);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, x, y);
      if (l.maxHp > 0) {
        const bw = 26 * dpr;
        ctx.fillStyle = '#3a0d12';
        ctx.fillRect(x - bw / 2, y + 5 * dpr, bw, 3 * dpr);
        ctx.fillStyle = l.hp / l.maxHp > 0.5 ? '#5ce65c' : l.hp / l.maxHp > 0.25 ? '#ffc23d' : '#ff4040';
        ctx.fillRect(x - bw / 2, y + 5 * dpr, Math.max(0, (bw * l.hp) / l.maxHp), 3 * dpr);
      }
    }
    this.labels = [];
    // Bulles de dialogue
    const now = performance.now();
    for (const [k, b] of this.bubbles) if (now - b.t0 > b.dur) this.bubbles.delete(k);
    ctx.font = `500 ${Math.round(12 * dpr)}px 'Alegreya Sans', system-ui, sans-serif`;
    for (const b of this.bubblePos) {
      const [x, y] = toScreen(b.x, b.y);
      const lines = b.npc ? wrap(b.text, 38).slice(0, 6) : wrap(b.text, 28).slice(0, 3);
      const lh = 15 * dpr;
      const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14 * dpr;
      const bh = lines.length * lh + 8 * dpr;
      const top = y - bh - 10 * dpr;
      const fade = Math.min(1, (b.dur - (now - b.t0)) / 500);
      ctx.globalAlpha = Math.max(0, fade);
      ctx.fillStyle = b.npc ? '#fff4d6' : '#f6f1ff'; // le marchand parle sur parchemin
      ctx.strokeStyle = b.npc ? '#7a5520' : '#2b2140';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.roundRect(x - bw / 2, top, bw, bh, 6 * dpr);
      ctx.moveTo(x - 5 * dpr, top + bh);
      ctx.lineTo(x, top + bh + 7 * dpr);
      ctx.lineTo(x + 5 * dpr, top + bh);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1b1426';
      lines.forEach((l, i) => ctx.fillText(l, x, top + 4 * dpr + (i + 1) * lh - 3 * dpr));
      ctx.globalAlpha = 1;
    }
    this.bubblePos = [];
  }
}

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  const words = text.split(' ').flatMap((w) => (w.length > max ? w.match(new RegExp(`.{1,${max}}`, 'g')) ?? [w] : [w]));
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max && line) {
      out.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out;
}

/** Intérieur d'une salle en pixels monde (position des pieds). */
function interior(r: RoomView) {
  const x0 = (r.x * CW + 1) * PX;
  const y0 = (r.y * CH + 2) * PX;
  return { x0, y0, x1: x0 + IW * PX, y1: y0 + IH * PX };
}

/** Centre de chaque porte (pieds d'un crawler qui s'y tient). */
function doorPoints(r: RoomView) {
  const b = interior(r);
  const cx = (r.x * CW + 1 + Math.floor(IW / 2) + 0.5) * PX;
  const cy = (r.y * CH + 2 + Math.floor(IH / 2) + 0.9) * PX;
  return { n: { x: cx, y: b.y0 - 6 }, s: { x: cx, y: b.y1 + 14 }, o: { x: b.x0 - 10, y: cy }, e: { x: b.x1 + 10, y: cy } };
}

/** Garde les pieds dans la salle, sauf dans l'embrasure d'une porte ouverte. */
function clampWalk(r: RoomView, x: number, y: number) {
  const b = interior(r);
  const d = doorPoints(r);
  let x0 = b.x0 + 7, x1 = b.x1 - 7, y0 = b.y0 + 12, y1 = b.y1 - 2;
  if (r.doors.n !== undefined && Math.abs(x - d.n.x) < 7) y0 = d.n.y;
  if (r.doors.s !== undefined && Math.abs(x - d.s.x) < 7) y1 = d.s.y;
  if (r.doors.o !== undefined && Math.abs(y - d.o.y) < 7) x0 = d.o.x;
  if (r.doors.e !== undefined && Math.abs(y - d.e.y) < 7) x1 = d.e.x;
  return { x: Math.max(x0, Math.min(x1, x)), y: Math.max(y0, Math.min(y1, y)) };
}

/** La porte dans laquelle se tient le crawler, s'il en franchit une. */
function doorReached(r: RoomView, x: number, y: number): Dir | null {
  const b = interior(r);
  if (r.doors.n !== undefined && y < b.y0 + 2) return 'n';
  if (r.doors.s !== undefined && y > b.y1 + 6) return 's';
  if (r.doors.o !== undefined && x < b.x0 - 2) return 'o';
  if (r.doors.e !== undefined && x > b.x1 + 2) return 'e';
  return null;
}

/** Répartit n entités sur une rangée de la salle. */
function slot(ox: number, oy: number, i: number, n: number, row: number) {
  const perRow = 5;
  const line = Math.floor(i / perRow);
  const inLine = Math.min(perRow, n - line * perRow);
  const idx = i % perRow;
  const span = IW * PX - 16;
  const x = ox + 8 + (inLine === 1 ? span / 2 : (span * idx) / (inLine - 1));
  const y = oy + row * PX + line * 10 - (line ? 0 : 0);
  return { x, y };
}

export type { MonsterView, PlayerPublic };
