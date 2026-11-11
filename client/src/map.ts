// Rendu de la carte d'un étage en pixel art (planche DawnLike), avec brouillard de guerre.
import { normalize } from '../../src/shared/commands';
import type { Dir, FloorView, GameEvent, MonsterView, PlayerPublic, RoomView } from '../../src/shared/types';
import { FxLayer } from './fx';
import { CRYPT_SLOTS, roomDecor, type Prop } from '../../src/shared/decor';
import { CLASS_SPRITE, Tiles, monsterSprite } from './tiles';

const IW = 7; // largeur intérieure d'une salle (tuiles)
const IH = 5; // hauteur intérieure
const GAP = 2; // longueur des couloirs
const CW = IW + 2 + GAP; // pas horizontal d'une cellule
const CH = IH + 3 + GAP; // pas vertical
const PX = 16;

/** Jeu de sols et de murs de la planche DawnLike pour chaque thème d'étage. */
const THEME_KEY: Record<string, string> = { classique: 'classic', 'inondé': 'flooded', 'en feu': 'fire', 'plongé dans le noir': 'dark', 'moisi': 'moldy', 'hanté': 'haunted' };

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
  return x >>> 0; // toujours positif, comme en 3D (mêmes tirages)
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
    return slot((r.x * CW + 1) * PX, (r.y * CH + 2) * PX, i, n, 3.4);
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
      let start = slot(b.x0, b.y0, mine.i, mine.n, 3.4);
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
    const th = THEME_KEY[this.floor?.theme ?? ''] ?? 'classic';
    for (const [d, id] of Object.entries(r.doors) as [Dir, number][]) {
      const unknown = !known.has(id);
      if (!unknown && (d === 'o' || d === 'n')) continue; // déjà dessiné par l'autre salle
      ctx.globalAlpha = unknown ? 0.45 : 1;
      if (d === 'e' || d === 'o') {
        const ty = oy + 2 + Math.floor(IH / 2);
        const x0 = d === 'e' ? ox + IW + 2 : ox - GAP;
        const len = unknown ? 1 : GAP;
        const start = d === 'e' ? x0 : ox - len;
        for (let i = 0; i < len; i++) {
          this.floorTile(start + i, ty, 3);
          this.tiles.tile(ctx, `wl_${th}_h`, start + i, ty - 1);
          this.tiles.tile(ctx, `wl_${th}_h`, start + i, ty + 1);
        }
      } else {
        const tx = ox + 1 + Math.floor(IW / 2);
        const len = unknown ? 1 : GAP;
        const start = d === 's' ? oy + IH + 3 : oy - len;
        for (let i = 0; i < len; i++) {
          this.floorTile(tx, start + i, 3);
          this.tiles.tile(ctx, `wl_${th}_v`, tx - 1, start + i);
          this.tiles.tile(ctx, `wl_${th}_v`, tx + 1, start + i);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private floorTile(tx: number, ty: number, _seed: number) {
    this.tiles.tile(this.ctx, `fl_${THEME_KEY[this.floor?.theme ?? ''] ?? 'classic'}_c`, tx, ty);
  }

  /** Le décor partagé avec le stream 3D : mêmes objets, mêmes places (tapis, os, éboulis, flaques, tonneaux…). */
  private drawDecor(r: RoomView, ox: number, oy: number, theme: string) {
    const { ctx, tiles } = this;
    const X = (u: number) => (ox + 1 + ((u + 1) / 2) * IW) * PX;
    const Y = (v: number) => (oy + 2 + ((v + 1) / 2) * IH) * PX;
    const props = roomDecor(this.floor?.n ?? 1, r, theme);
    // Au sol d'abord (tapis, flaques, brûlures), puis ce qui dépasse
    const flat = (p: Prop) => p.kind === 'rug_red' || p.kind === 'rug_blue' || p.kind === 'puddle' || p.kind === 'scorch';
    const SPRITE: Record<string, string> = { rug_red: 'dec_rug_red', rug_blue: 'dec_rug_gray', scorch: 'gr_scorch', crates: 'dec_crates', box: 'dec_crate', coins: 'gold_pile', barrel: 'barrel', barrel_stack: 'barrel2' };
    for (const p of [...props.filter(flat), ...props.filter((x) => !flat(x))]) {
      const x = X(p.u);
      const y = Y(p.v);
      const name =
        p.kind === 'bones' ? (p.skull ? 'dec_skulls' : (p.seed & 1) ? 'dec_bones' : 'dec_bones2')
        : p.kind === 'rubble' ? ((p.seed & 1) ? 'dec_rubble' : 'dec_rubble2')
        : p.kind === 'puddle' ? ((p.n ?? 0) > 3 ? 'gr_puddle' : 'gr_puddle_small')
        : SPRITE[p.kind];
      if (!name) continue;
      const rug = p.kind === 'rug_red' || p.kind === 'rug_blue';
      tiles.drawAnchored(ctx, name, Math.round(x), Math.round(y + (rug ? 16 : 6)), 0);
    }
  }

  private drawRoom(r: RoomView, t: number, theme: string) {
    const { ctx, tiles } = this;
    const ox = r.x * CW;
    const oy = r.y * CH;
    const th = THEME_KEY[theme] ?? 'classic';
    const midRow = oy + 2 + Math.floor(IH / 2);
    const midCol = ox + 1 + Math.floor(IW / 2);
    const at = (name: string, x: number, y: number, tt = t) => tiles.drawAnchored(ctx, name, x * PX, y * PX, tt);

    // Sol (neuf cases : bords ombrés), de la ligne oy + 1 à oy + IH + 1, puis les murs, fins, autour
    const top = oy + 1;
    const bottom = oy + IH + 1;
    for (let y = top; y <= bottom; y++) {
      for (let x = ox + 1; x <= ox + IW; x++) {
        const pos = (y === top ? 't' : y === bottom ? 'b' : '') + (x === ox + 1 ? 'l' : x === ox + IW ? 'r' : '');
        tiles.tile(ctx, `fl_${th}_${pos || 'c'}`, x, y);
      }
    }
    const wall = (n: string, x: number, y: number) => tiles.tile(ctx, `wl_${th}_${n}`, x, y);
    const floor = (x: number, y: number) => tiles.tile(ctx, `fl_${th}_c`, x, y);
    for (let x = ox; x <= ox + IW + 1; x++) {
      if (r.doors.n !== undefined && x === midCol) floor(x, oy);
      else wall(x === ox ? 'tl' : x === ox + IW + 1 ? 'tr' : 'h', x, oy);
      if (r.doors.s !== undefined && x === midCol) floor(x, oy + IH + 2);
      else wall(x === ox ? 'bl' : x === ox + IW + 1 ? 'br' : 'h', x, oy + IH + 2);
    }
    for (let y = oy + 1; y <= oy + IH + 1; y++) {
      if (r.doors.o !== undefined && y === midRow) floor(ox, y);
      else wall('v', ox, y);
      if (r.doors.e !== undefined && y === midRow) floor(ox + IW + 1, y);
      else wall('v', ox + IW + 1, y);
    }
    // Tout ce qui suit est placé comme dans la vue 3D : (u, v) = position 3D / demi-côté de salle (−1..1),
    // u vers l'est, v vers le sud, avec la même correspondance que le décor partagé (drawDecor).
    const X = (u: number) => (ox + 1 + ((u + 1) / 2) * IW) * PX;
    const Y = (v: number) => (oy + 2 + ((v + 1) / 2) * IH) * PX;
    const put = (name: string, u: number, v: number, tt = t, scale = 1) => tiles.drawAnchored(ctx, name, Math.round(X(u)), Math.round(Y(v) + 6), tt, false, scale);
    const wallY = oy * PX; // haut du mur nord
    // Torches du mur nord (même tirage qu'en 3D : il en manque parfois une dans les salles ordinaires)
    for (const tx of [-4, 4]) {
      if (hash(r.id * 5 + tx) % 3 === 0 && r.type === 'normale') continue;
      if (r.type === 'safe' && !r.forge && tx === 4) continue;
      drawTorch(ctx, X(tx / 6), wallY, t + r.id);
    }
    // Bannières, piliers : arène, salle du boss, boutique, forge
    const C = 4.6 / 6;
    const pillar = (u: number, v: number) => drawPillar(ctx, X(u), Y(v) + 6);
    if (r.type === 'arene') {
      drawBanner(ctx, X(-0.25), wallY, 'red');
      drawBanner(ctx, X(0.25), wallY, 'red');
      pillar(-C, -0.733);
      pillar(C, -0.733);
    } else if (r.type === 'boss') {
      drawBanner(ctx, X(-3.5 / 6), wallY, 'red');
      drawBanner(ctx, X(3.5 / 6), wallY, 'blue');
      pillar(-C, -0.733);
      pillar(C, -0.733);
    }
    if (r.merchant) {
      // La boutique (comme en 3D) : grand tapis bleu, étagère à l'ouest, comptoir au nord-est avec le marchand derrière,
      // deux tabourets devant, des bougies, un tonneau, des pots dans les coins
      tiles.drawAnchored(ctx, 'dec_rug_gray', Math.round(X(0)), Math.round(Y(0.1) + 24), 0, false, 1.5);
      drawBanner(ctx, X(-1 / 3), wallY, 'blue');
      drawBanner(ctx, X(1 / 3), wallY, 'blue');
    }
    // Dalles éboulées : les mêmes que les dalles « rocks » de la 3D (une sur cinq, jamais chez le marchand ni à la forge)
    if (r.type !== 'safe') {
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        if (r.type === 'piege' && i === 0 && j === 0) continue;
        if (r.type === 'boss' && i === 0 && j === -1) continue;
        if (hash(r.id * 9 + i * 3 + j) % 5 === 0) put((i + j) & 1 ? 'dec_rubble' : 'dec_rubble2', i * 0.667, j * 0.667, 0);
      }
    }
    this.drawDecor(r, ox, oy, theme);
    if (r.type === 'boss') {
      pillar(-C, 0.733);
      pillar(C, 0.733);
    }

    // Objets de la salle
    if (r.stairs) {
      // La sortie de l'étage (le trou de l'escalier en 3D), fermée par une grille tant qu'elle est scellée ou gardée
      tiles.tile(ctx, 'stairs', midCol, oy + 2);
      const seal = Math.max(0, (this.floor?.stairsInSec ?? 0) - (performance.now() - this.floorAt) / 1000);
      const closed = !!r.bossAlive || this.floor?.stairsInSec === null || seal > 0;
      if (closed) tiles.tile(ctx, 'gate', midCol, oy + 2, t);
      this.stairsMark = { x: (midCol + 0.5) * PX, y: (oy + 2.5) * PX, bossAlive: !!r.bossAlive };
    }
    // Les piques au centre : dressées si le piège est armé, rentrées sinon (salle piégée connue)
    if (r.type === 'piege') tiles.tile(ctx, r.trapArmed ? 'spikes' : 'spikes_small', midCol, midRow, t);
    else if (r.trapArmed) tiles.tile(ctx, 'spikes', midCol, midRow, t);
    if (r.chest !== 'aucun') put(r.chest === 'ferme' ? 'chest_closed' : 'chest_open', 0, -0.6);
    if (r.feature) {
      // Salles spéciales : l'objet au milieu du mur nord (le puits un peu au nord du centre)
      if (r.feature === 'autel') {
        put('dec_altar', 0, -0.77);
        put('dec_candle', -0.183, -0.86);
        put('dec_candle', 0.183, -0.86);
      } else if (r.feature === 'fontaine') {
        tiles.tile(ctx, 'fountain', midCol, oy + 1, t);
        put('gr_puddle_small', 0, -0.62);
      } else if (r.feature === 'puits') {
        put('well', 0, -0.45);
      } else if (r.feature === 'prisonnier') {
        drawChains(ctx, X(0), wallY + PX, Y(-0.817));
        if (!r.featureDone) put('npc_prisoner', 0, -0.817);
      } else if (r.feature === 'ogre') {
        put('gold_pile', -0.2, -0.733);
        put('gold_pile', 0.05, -0.733);
        put('gold_pile', 0.233, -0.733);
      }
    }
    if (r.crypt) {
      // La crypte : une pierre tombale par éliminé (six au plus, aux mêmes places qu'en 3D)
      const stones = ['dec_tomb_rip', 'dec_tomb_lines', 'dec_tomb_skull', 'dec_tomb_plain'];
      r.crypt.slice(0, CRYPT_SLOTS.length).forEach((g, i) => {
        const [u, v] = CRYPT_SLOTS[i];
        put(stones[g.no % stones.length], u, v);
        this.labels.push({ text: g.name, x: X(u), y: Y(v) - 12, color: '#c9c2d8', hp: 0, maxHp: 0 });
      });
    }
    if (r.forge) {
      // La forge (comme en 3D) : foyer au nord-ouest, tas de charbon, enclume au centre avec le forgeron derrière,
      // bac de trempe, râtelier au nord-est, tonneau à l'est, caisses au sud-ouest
      if (r.doors.n === undefined) drawBanner(ctx, X(1.4 / 6), wallY, 'red');
      put('dec_furnace', -0.433, -0.783);
      put('dec_rubble2', -0.083, -0.73);
      put('dec_weapons', 0.683, -0.883);
      put('npc_smith', 0.05, -0.408);
      drawAnvil(ctx, X(0.067), Y(-0.2) + 6);
      put('barrel2', 0.383, -0.1);
      put('barrel', 0.767, 0.467);
      put('dec_crates', -0.733, 0.7);
      ctx.fillStyle = `rgba(255,120,40,${0.12 + 0.06 * Math.sin(t * 6)})`; // lueur du feu
      ctx.fillRect(X(-0.433) - PX, Y(-0.783) - PX, 2 * PX, 2 * PX);
      const b = this.bubbles.get(`marchand:${r.id}`);
      if (b) this.bubblePos.push({ text: b.text, x: X(0.05), y: Y(-0.408) - 16, t0: b.t0, dur: b.dur, npc: true });
    }
    if (r.merchant) {
      const westDoor = r.doors.o !== undefined;
      put('dec_bookshelf', westDoor ? -0.6 : -0.875, westDoor ? -0.875 : -0.433);
      put('npc_merchant', 0.467, -0.825);
      put('dec_table', 0.467, -0.6);
      put('dec_chair', 0.317, -0.317);
      put('dec_chair', 0.617, -0.317);
      put('dec_candles', 0.067, -0.767);
      put('dec_candles', 0.85, -0.383);
      put('barrel', westDoor ? -0.6 : -0.783, westDoor ? 0.783 : 0.267);
      put('dec_pot', -0.817, 0.817);
      put('dec_pot2', 0.817, 0.817);
      put('dec_pot', 0.85, -0.2);
      const b = this.bubbles.get(`marchand:${r.id}`);
      if (b) this.bubblePos.push({ text: b.text, x: X(0.467), y: Y(-0.825) - 14, t0: b.t0, dur: b.dur, npc: true });
    }
    // Butin au sol (comme en 3D) : les objets au sud-ouest (trois au plus), l'or au sud-est
    (r.ground ?? []).slice(0, 3).forEach((it, i) => put(`it_${it.tpl}`, -0.583 + (i - 1) * 0.2, 0.533 + (i % 2) * 0.12));
    if ((r.groundGold ?? 0) > 0) put('gold_pile', 0.583, 0.533);
    // Platino, le lézard caché que l'auteur de DawnLike demande à tous ses utilisateurs : une salle sur 400
    if (hash(r.id * 977 + (this.floor?.n ?? 0) * 31) % 400 === 7) at('platino', ox + 1.4, oy + IH + 1.9);

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
      this.drawFlashing(key, monsterSprite(m), p.x + o.x, p.y + o.y, t + (m.asleep ? 0 : i * 0.37), flip, now, m.boss ? 2 : 1);
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
      this.label(pl.name + (pl.traitor ? ' ☠' : ''), p.x, p.y - 22, color, pl.hp, pl.maxHp);
      const b = this.bubbles.get(pl.name);
      if (b) this.bubblePos.push({ text: b.text, x: p.x, y: p.y - 30, t0: b.t0, dur: b.dur, npc: false });
    });
  }

  /** Sprite avec flash blanc (coup reçu) ou rouge (piège, gag). */
  private drawFlashing(key: string, sprite: string, x: number, y: number, t: number, flip: boolean, now: number, scale = 1) {
    const { ctx, tiles } = this;
    tiles.drawAnchored(ctx, sprite, x, y, t, flip, scale);
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
    tiles.drawAnchored(ctx, sprite, x, y, t, flip, scale);
    tiles.drawAnchored(ctx, sprite, x, y, t, flip, scale);
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

// Petits éléments dessinés à la main (palette DawnBringer, comme DawnLike) pour les pièces 3D sans équivalent dans le pack

/** Torche murale : support en fer, flamme qui vacille, halo sur le sol. */
function drawTorch(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const cx = Math.round(x);
  const k = Math.floor(t * 6) % 3;
  const g = ctx.createRadialGradient(cx, y + 14, 1, cx, y + 14, 26);
  g.addColorStop(0, 'rgba(255,170,60,0.22)');
  g.addColorStop(1, 'rgba(255,170,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - 26, y - 12, 52, 52);
  ctx.fillStyle = '#140c1c';
  ctx.fillRect(cx - 2, y + 8, 4, 6);
  ctx.fillStyle = '#4e4a4e';
  ctx.fillRect(cx - 1, y + 8, 2, 6);
  ctx.fillStyle = '#854c30';
  ctx.fillRect(cx - 1, y + 5, 2, 4);
  ctx.fillStyle = '#d27d2c';
  ctx.fillRect(cx - 2, y + 1 + (k === 1 ? 1 : 0), 4, 4);
  ctx.fillStyle = '#dad45e';
  ctx.fillRect(cx - 1 + (k === 2 ? 1 : 0), y - 1 + k % 2, 2, 4);
  ctx.fillStyle = '#deeed6';
  ctx.fillRect(cx, y + 2, 1, 2);
}

/** Bannière accrochée au mur nord (rouge à motif ou bleue à écu, comme les deux bannières 3D). */
function drawBanner(ctx: CanvasRenderingContext2D, x: number, y: number, color: 'red' | 'blue') {
  const cx = Math.round(x);
  const [dark, mid, light] = color === 'red' ? ['#442434', '#d04648', '#d27d2c'] : ['#30346d', '#597dce', '#6dc2ca'];
  ctx.fillStyle = '#854c30';
  ctx.fillRect(cx - 5, y + 2, 10, 2);
  ctx.fillStyle = dark;
  ctx.fillRect(cx - 4, y + 4, 8, 13);
  ctx.fillRect(cx - 3, y + 17, 6, 1);
  ctx.fillStyle = mid;
  ctx.fillRect(cx - 3, y + 4, 6, 12);
  ctx.fillRect(cx - 2, y + 16, 4, 1);
  ctx.fillStyle = color === 'red' ? '#dad45e' : light;
  if (color === 'red') {
    ctx.fillRect(cx - 3, y + 7, 6, 1);
    ctx.fillRect(cx - 1, y + 9, 2, 3);
    ctx.fillRect(cx - 3, y + 13, 6, 1);
  } else {
    ctx.fillRect(cx - 2, y + 7, 4, 5);
    ctx.fillStyle = '#dad45e';
    ctx.fillRect(cx - 1, y + 8, 2, 3);
  }
}

/** Pilier de pierre (pieds en (x, y)). */
function drawPillar(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const cx = Math.round(x);
  const yb = Math.round(y);
  ctx.fillStyle = 'rgba(20,12,28,0.45)';
  ctx.fillRect(cx - 5, yb - 2, 12, 3);
  ctx.fillStyle = '#140c1c';
  ctx.fillRect(cx - 6, yb - 24, 12, 23);
  ctx.fillStyle = '#4e4a4e';
  ctx.fillRect(cx - 5, yb - 4, 10, 3);
  ctx.fillRect(cx - 5, yb - 23, 10, 3);
  ctx.fillStyle = '#757161';
  ctx.fillRect(cx - 4, yb - 20, 8, 16);
  ctx.fillStyle = '#8595a1';
  ctx.fillRect(cx - 4, yb - 20, 3, 16);
  ctx.fillRect(cx - 5, yb - 23, 10, 1);
  ctx.fillStyle = '#4e4a4e';
  ctx.fillRect(cx + 2, yb - 20, 2, 16);
}

/** Enclume sur son billot (pieds en (x, y)). */
function drawAnvil(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const cx = Math.round(x);
  const yb = Math.round(y);
  ctx.fillStyle = '#140c1c';
  ctx.fillRect(cx - 4, yb - 6, 8, 6);
  ctx.fillRect(cx - 7, yb - 11, 13, 5);
  ctx.fillStyle = '#854c30';
  ctx.fillRect(cx - 3, yb - 5, 6, 4);
  ctx.fillStyle = '#4e4a4e';
  ctx.fillRect(cx - 6, yb - 10, 11, 3);
  ctx.fillRect(cx + 5, yb - 10, 2, 1);
  ctx.fillStyle = '#8595a1';
  ctx.fillRect(cx - 6, yb - 10, 11, 1);
  ctx.fillStyle = '#d27d2c';
  ctx.fillRect(cx - 3, yb - 11, 4, 1);
}

/** Chaînes du prisonnier, du mur jusqu'à ses mains. */
function drawChains(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number) {
  ctx.fillStyle = '#8595a1';
  for (const dx of [-7, 6]) for (let y = y0; y < y1 - 10; y += 3) ctx.fillRect(Math.round(x) + dx + (((y - y0) / 3) % 2 ? 1 : 0), y, 1, 2);
}

export type { MonsterView, PlayerPublic };
