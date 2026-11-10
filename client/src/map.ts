// Rendu de la carte d'un étage en pixel art, avec brouillard de guerre.
import { normalize } from '../../src/shared/commands';
import type { Dir, FloorView, GameEvent, MonsterView, PlayerPublic, RoomView } from '../../src/shared/types';
import { FxLayer } from './fx';
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
      return slot(ox, oy, i, list.length, 1.9);
    }
    const list = r.players ?? [];
    const i = list.findIndex((p) => `p:${p.name}` === key);
    if (i < 0) return null;
    return this.playerSpot(r, list[i], i, list.length);
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
      const p = slot(ox, oy, i, ms.length, ms[i].boss ? 2.6 : 1.9);
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
    ctx.fillStyle = '#0c0a12';
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
    for (const r of f.rooms) this.drawRoom(r, t, f.theme);
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

    // Objets de la salle
    if (r.stairs) tiles.tile(ctx, 'floor_stairs', midCol, oy + 2);
    if (r.trapArmed) tiles.tile(ctx, 'floor_spikes_anim', midCol, midRow, t);
    if (r.chest !== 'aucun') tiles.drawAnchored(ctx, r.chest === 'ferme' ? 'chest_full_open_anim_f0' : 'chest_empty_open_anim_f2', (midCol + 0.5) * PX, (oy + 3) * PX);
    if (r.merchant) {
      tiles.drawAnchored(ctx, 'doc_idle_anim', (ox + 2.5) * PX, (oy + 3.2) * PX, t);
      const b = this.bubbles.get(`marchand:${r.id}`);
      if (b) this.bubblePos.push({ text: b.text, x: (ox + 2.5) * PX, y: (oy + 3.2) * PX - 26, t0: b.t0, dur: b.dur, npc: true });
    }
    if ((r.ground?.length ?? 0) > 0) tiles.drawAnchored(ctx, 'skull', (ox + IW - 0.2) * PX, (oy + IH + 1.6) * PX);
    if ((r.groundGold ?? 0) > 0) tiles.drawAnchored(ctx, 'coin_anim', (ox + IW - 0.9) * PX, (oy + IH + 1.6) * PX, t);
    if (r.type === 'normale' && hash(r.id * 7) % 5 === 0) tiles.drawAnchored(ctx, 'crate', (ox + 1.5) * PX, (oy + IH + 2) * PX);

    // Brouillard : salles connues mais pas surveillées
    if (!r.current && !r.players && !r.monsters) {
      ctx.fillStyle = 'rgba(8,6,14,0.62)';
      ctx.fillRect(ox * PX, oy * PX, (IW + 2) * PX, (IH + 3) * PX);
    }
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
      const p = slot(ox, oy, i, ms.length, m.boss ? 2.6 : 1.9);
      this.fx.lastPos.set(key, p);
      this.visibleKeys.add(key);
      const o = this.fx.offset(key, now);
      this.drawFlashing(key, m.sprite, p.x + o.x, p.y + o.y, t + i * 0.37, false, now);
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
      const color = pl.me ? '#ffd65a' : pl.traitor ? '#ff4d8d' : pl.ally ? '#6dff8a' : '#ffffff';
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

  /** Noms et barres de vie dessinés en résolution écran, pour rester nets. */
  private drawLabels(toScreen: (x: number, y: number) => [number, number]) {
    const { ctx } = this;
    const dpr = devicePixelRatio;
    const fs = Math.round((this.zoom >= 3 ? 12 : this.zoom === 2 ? 11 : 10) * dpr);
    ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
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
    ctx.font = `500 ${Math.round(12 * dpr)}px Inter, system-ui, sans-serif`;
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
  for (const w of text.split(' ')) {
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
