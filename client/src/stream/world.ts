// L'étage en 3D : décor, personnages animés, effets et caméra réalisateur.
import * as THREE from 'three';
import type { Dir, FloorView, GameEvent, MonsterView, PlayerPublic, RoomView } from '../../../src/shared/types';
import { Assets, InstancedBuilder, type CharName, type PieceName } from './assets';

export const CELL = 16; // pas de la grille (salle 12 + couloir 4)
const HALF = 6; // demi-côté d'une salle
const LOW: [number, number, number] = [1, 0.32, 1]; // murs bas côté caméra (sud/est) pour voir dedans

const hash = (n: number) => {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 13;
  return x >>> 0; // toujours positif (sinon les modulos donnent des index négatifs)
};
const center = (r: { x: number; y: number }) => new THREE.Vector3(r.x * CELL, 0, r.y * CELL);

// Apparence des monstres : Quaternius pour les créatures, squelettes KayKit pour les morts-vivants.
// « repli » : modèle KayKit utilisé si le fichier Quaternius n'a pas pu être chargé.
type Look = { model: CharName; scale: number; tint?: number; emissive?: number; repli?: Look };
const MONSTER_LOOK: Record<string, Look> = {
  gobelin: { model: 'q_gobelin', scale: 0.62, repli: { model: 'sk_minion', scale: 0.85, tint: 0xa8e080 } },
  squelette: { model: 'sk_warrior', scale: 1 },
  zombie: { model: 'sk_minion', scale: 0.8, tint: 0x9fc29a },
  diablotin: { model: 'q_diablotin', scale: 0.6, repli: { model: 'sk_rogue', scale: 0.7, tint: 0xff9a8a } },
  limace: { model: 'q_slime', scale: 0.55, repli: { model: 'sk_minion', scale: 0.75, tint: 0xd8f070 } },
  demon: { model: 'q_demon', scale: 0.95, repli: { model: 'sk_rogue', scale: 0.95, tint: 0xff7070 } },
  orque: { model: 'q_orque', scale: 1.0, repli: { model: 'sk_warrior', scale: 1.15, tint: 0x9fd070 } },
  necromancien: { model: 'sk_mage', scale: 1 },
  guerrier: { model: 'q_orque_chef', scale: 1.15, repli: { model: 'sk_warrior', scale: 1.25, tint: 0xb8d890 } },
  mimique: { model: 'sk_rogue', scale: 0.9, tint: 0xffd060 },
  ogre: { model: 'q_ogre', scale: 1.45, repli: { model: 'sk_warrior', scale: 1.8, tint: 0xff9a60, emissive: 0x401000 } },
  gros_zombie: { model: 'q_champignon', scale: 1.3, tint: 0xc8e0b0, repli: { model: 'sk_minion', scale: 1.8, tint: 0xa0ffb0, emissive: 0x003010 } },
  gros_demon: { model: 'q_diablotin', scale: 1.3, emissive: 0x501000, repli: { model: 'sk_rogue', scale: 1.8, tint: 0xff5050, emissive: 0x400000 } },
};

const ATTACK_ANIM: Record<string, string> = {
  chevalier: '1H_Melee_Attack_Chop', barbare: '2H_Melee_Attack_Chop', mage: 'Spellcast_Shoot', voleur: '1H_Melee_Attack_Stab',
  sk_minion: 'Unarmed_Melee_Attack_Punch_A', sk_warrior: '1H_Melee_Attack_Chop', sk_mage: 'Spellcast_Shoot', sk_rogue: '1H_Melee_Attack_Stab',
};

interface Ent {
  key: string;
  name: string;
  model: CharName;
  obj: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  current: THREE.AnimationAction | null;
  base: string; // animation de repos
  roomId: number;
  path: THREE.Vector3[];
  yaw: number;
  hp: number;
  maxHp: number;
  boss: boolean;
  player: boolean;
  label: HTMLDivElement;
  bubble: { text: string; until: number } | null;
  dyingUntil: number; // garde l'entité affichée le temps de l'animation de mort
  busyUntil: number; // animation ponctuelle en cours
  color: string;
}

interface Flame {
  sprite: THREE.Sprite;
  pos: THREE.Vector3;
  seed: number;
}

export class World {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  floor: FloorView | null = null;
  private assets: Assets;
  private static: THREE.Group | null = null;
  private dynamic = new THREE.Group();
  private ents = new Map<string, Ent>();
  private flames: Flame[] = [];
  private lights: THREE.PointLight[] = [];
  private sun: THREE.DirectionalLight;
  private labels: HTMLElement;
  private flameTex: THREE.Texture;
  private sparkTex: THREE.Texture;
  private particles: { pts: THREE.Points; vel: THREE.Vector3[]; t: number; life: number; grav: number }[] = [];
  private shake = 0;
  private flash: THREE.PointLight;
  // Caméra réalisateur
  private heat = new Map<number, { score: number; t: number }>();
  private shot: { roomId: number | null; since: number } = { roomId: null, since: 0 };
  private camPos = new THREE.Vector3(0, 40, 40);
  private camLook = new THREE.Vector3();
  private cut = false; // le prochain plan est une coupe franche (si la salle est loin)
  private wantPos = new THREE.Vector3(0, 40, 40);
  private wantLook = new THREE.Vector3();
  followName: string | null = null;
  onShot?: (label: string) => void;

  constructor(canvas: HTMLCanvasElement, labels: HTMLElement, assets: Assets) {
    this.assets = assets;
    this.labels = labels;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 600);

    this.scene.background = new THREE.Color(0x0b0812);
    this.scene.fog = new THREE.Fog(0x0b0812, 70, 220);
    this.scene.add(new THREE.HemisphereLight(0x7a68b8, 0x1c1226, 0.85));
    this.sun = new THREE.DirectionalLight(0x9db2ff, 0.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 120 });
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    for (let i = 0; i < 10; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 15, 1.7);
      this.lights.push(l);
      this.scene.add(l);
    }
    this.flash = new THREE.PointLight(0xffd070, 0, 20, 1.5);
    this.scene.add(this.flash, this.dynamic);
    this.flameTex = glow([[0, 'rgba(255,248,210,1)'], [0.25, 'rgba(255,170,60,.95)'], [0.6, 'rgba(255,80,10,.35)'], [1, 'rgba(255,40,0,0)']]);
    this.sparkTex = glow([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']]);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- décor

  setFloor(f: FloorView) {
    const changed = !this.floor || this.floor.n !== f.n || this.floor.rooms.length !== f.rooms.length;
    this.floor = f;
    if (changed) {
      this.buildStatic(f);
      for (const e of this.ents.values()) this.removeEnt(e);
      this.ents.clear();
      this.heat.clear();
      this.shot = { roomId: null, since: 0 };
    }
    this.buildDynamic(f);
    this.syncEntities(f, changed);
  }

  private buildStatic(f: FloorView) {
    if (this.static) {
      this.scene.remove(this.static);
      this.static.traverse((o) => (o as THREE.InstancedMesh).dispose?.());
    }
    for (const fl of this.flames) this.scene.remove(fl.sprite);
    this.flames = [];
    const b = new InstancedBuilder(this.assets);
    const byPos = new Map(f.rooms.map((r) => [`${r.x},${r.y}`, r]));
    for (const r of f.rooms) {
      const c = center(r);
      const h = hash(r.id + 1);
      // Sol
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        if (r.type === 'piege' && i === 0 && j === 0) continue;
        if (r.type === 'boss' && i === 0 && j === -1) continue;
        b.add(hash(r.id * 9 + i * 3 + j) % 5 === 0 ? 'floor_tile_large_rocks' : 'floor_tile_large', c.x + i * 4, 0, c.z + j * 4);
      }
      // Murs hauts (nord, ouest) et bas (sud, est)
      const wallFor = (i: number) => (hash(r.id * 31 + i) % 7 === 0 ? 'wall_cracked' : hash(r.id * 17 + i) % 9 === 0 ? 'wall_arched' : 'wall');
      for (let i = -1; i <= 1; i++) {
        b.add(i === 0 && r.doors.n !== undefined ? 'wall_doorway' : wallFor(i), c.x + i * 4, 0, c.z - HALF);
        b.add(i === 0 && r.doors.o !== undefined ? 'wall_doorway' : wallFor(i + 5), c.x - HALF, 0, c.z + i * 4, Math.PI / 2);
        if (!(i === 0 && r.doors.s !== undefined)) b.add('wall', c.x + i * 4, 0, c.z + HALF, 0, LOW);
        if (!(i === 0 && r.doors.e !== undefined)) b.add('wall', c.x + HALF, 0, c.z + i * 4, Math.PI / 2, LOW);
      }
      b.add('pillar', c.x - HALF, 0, c.z - HALF);
      // Couloirs (dessinés depuis la salle ouest / nord)
      if (r.doors.e !== undefined && byPos.has(`${r.x + 1},${r.y}`)) {
        b.add('floor_tile_large', c.x + CELL / 2, 0, c.z);
        b.add('wall', c.x + CELL / 2, 0, c.z - 2, 0, LOW);
        b.add('wall', c.x + CELL / 2, 0, c.z + 2, 0, LOW);
      }
      if (r.doors.s !== undefined && byPos.has(`${r.x},${r.y + 1}`)) {
        b.add('floor_tile_large', c.x, 0, c.z + CELL / 2);
        b.add('wall', c.x - 2, 0, c.z + CELL / 2, Math.PI / 2, LOW);
        b.add('wall', c.x + 2, 0, c.z + CELL / 2, Math.PI / 2, LOW);
      }
      // Torches sur le mur nord
      for (const tx of [-4, 4]) {
        if (hash(r.id * 5 + tx) % 3 === 0 && r.type === 'normale') continue;
        b.add('torch_mounted', c.x + tx, 2.4, c.z - HALF + 0.5);
        this.addFlame(new THREE.Vector3(c.x + tx, 3.2, c.z - HALF + 0.9));
      }
      // Décor selon le type
      const corner = (dx: number, dz: number) => [c.x + dx, c.z + dz] as const;
      switch (r.type) {
        case 'safe': {
          b.add('banner_shield_blue', c.x - 1.5, 0, c.z - HALF);
          b.add('table_long_decorated_A', c.x + 2.5, 0, c.z - 3, 0);
          b.add('stool', c.x + 1, 0, c.z - 1.5, 0.4);
          b.add('stool', c.x + 4, 0, c.z - 1.5, 2.1);
          b.add('keg_decorated', c.x - 4.6, 0, c.z - 4.4, 0, [0.8, 0.8, 0.8]);
          b.add('candle_triple', c.x - 4.6, 0, c.z + 4.4);
          break;
        }
        case 'arene':
          b.add('banner_patternA_red', c.x - 1.5, 0, c.z - HALF);
          b.add('banner_patternA_red', c.x + 1.5, 0, c.z - HALF);
          for (const [x, z] of [corner(-4.6, -4.4), corner(4.6, -4.4)]) b.add('pillar_decorated', x, 0, z, 0, [0.55, 0.55, 0.55]);
          break;
        case 'boss':
          b.add('banner_patternA_red', c.x - 3.5, 0, c.z - HALF);
          b.add('banner_shield_blue', c.x + 3.5, 0, c.z - HALF);
          for (const [x, z] of [corner(-4.6, -4.4), corner(4.6, -4.4), corner(-4.6, 4.4), corner(4.6, 4.4)]) b.add('pillar_decorated', x, 0, z, 0, [0.6, 0.6, 0.6]);
          break;
        case 'tresor':
          b.add('coin_stack_large', c.x + 2.4, 0, c.z - 4, 0.7, [0.7, 0.7, 0.7]);
          b.add('coin_stack_large', c.x - 2.6, 0, c.z - 4.2, 2, [0.5, 0.5, 0.5]);
          break;
        default: {
          const props: PieceName[] = ['barrel_large', 'barrel_small_stack', 'crates_stacked', 'box_small_decorated'];
          if (h % 2 === 0) b.add(props[h % 4], c.x - 4.4, 0, c.z - 4.2, (h % 6) * 0.5, [0.8, 0.8, 0.8]);
          if (h % 3 === 0) b.add(props[(h >>> 3) % 4], c.x + 4.4, 0, c.z + 4.2, (h % 5) * 0.6, [0.8, 0.8, 0.8]);
        }
      }
    }
    this.static = b.build();
    this.scene.add(this.static);
    // Socle sombre sous l'étage
    const xs = f.rooms.map((r) => r.x);
    const ys = f.rooms.map((r) => r.y);
    const w = (Math.max(...xs) - Math.min(...xs) + 1) * CELL + 8;
    const d = (Math.max(...ys) - Math.min(...ys) + 1) * CELL + 8;
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), new THREE.MeshStandardMaterial({ color: 0x241c2e, roughness: 1 }));
    base.position.set(((Math.min(...xs) + Math.max(...xs)) / 2) * CELL, -1.6, ((Math.min(...ys) + Math.max(...ys)) / 2) * CELL);
    base.receiveShadow = true;
    this.static.add(base);
  }

  private addFlame(pos: THREE.Vector3) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flameTex, color: 0xffb070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sprite.position.copy(pos);
    sprite.scale.set(0.9, 1.25, 1);
    this.scene.add(sprite);
    this.flames.push({ sprite, pos, seed: Math.random() * 100 });
  }

  /** Objets qui changent : coffres, piques, loot au sol, escalier. */
  private buildDynamic(f: FloorView) {
    this.dynamic.clear();
    for (const r of f.rooms) {
      const c = center(r);
      if (r.type === 'piege') {
        const t = this.assets.piece('floor_tile_big_spikes');
        t.position.set(c.x, 0, c.z);
        const spikes = t.getObjectByName('spikes');
        if (spikes) spikes.position.y = r.trapArmed ? 0 : -2.05;
        this.dynamic.add(t);
      }
      if (r.chest !== 'aucun') {
        const ch = this.assets.piece('chest_gold');
        ch.position.set(c.x, 0, c.z - 3.6);
        const lid = ch.getObjectByName('chest_gold_lid');
        if (lid && r.chest === 'ouvert') lid.rotation.x = -1.9;
        this.dynamic.add(ch);
      }
      if (r.type === 'boss') {
        // L'escalier vers l'étage suivant : un trou qui s'illumine quand le boss est vaincu
        const hole = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.3, 3.6), new THREE.MeshStandardMaterial({ color: 0x050308, emissive: r.bossAlive ? 0x000000 : 0xffb030, emissiveIntensity: r.bossAlive ? 0 : 0.6 }));
        hole.position.set(c.x, -0.1, c.z - 4);
        this.dynamic.add(hole);
      }
      if ((r.groundGold ?? 0) > 0) {
        const coins = this.assets.piece('coin_stack_large');
        coins.position.set(c.x + 3.5, 0, c.z + 3.2);
        coins.scale.setScalar(0.6);
        this.dynamic.add(coins);
      }
      if ((r.ground?.length ?? 0) > 0) {
        const box = this.assets.piece('box_small_decorated');
        box.position.set(c.x - 3.5, 0, c.z + 3.2);
        box.scale.setScalar(0.7);
        this.dynamic.add(box);
      }
    }
  }

  // ---------------------------------------------------------- personnages

  private slot(r: RoomView, i: number, n: number, monster: boolean): THREE.Vector3 {
    const c = center(r);
    const perRow = 5;
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, n - row * perRow);
    const k = i % perRow;
    const x = inRow === 1 ? 0 : -4 + (8 * k) / (inRow - 1);
    const z = monster ? -1 - row * 1.6 : 2 + row * 1.8;
    return new THREE.Vector3(c.x + x, 0, c.z + z);
  }

  private syncEntities(f: FloorView, snap: boolean) {
    const seen = new Set<string>();
    const now = performance.now();
    for (const r of f.rooms) {
      const ps = r.players ?? [];
      const ms = r.monsters ?? [];
      ps.forEach((p, i) => {
        const key = `p:${p.name}`;
        seen.add(key);
        this.upsert(key, p.name, r, this.slot(r, i, ps.length, false), snap, p, null);
      });
      ms.forEach((m, i) => {
        const key = `m:${m.id}`;
        seen.add(key);
        this.upsert(key, m.name, r, this.slot(r, i, ms.length, true), snap, null, m);
      });
    }
    for (const [key, e] of this.ents) {
      if (seen.has(key)) continue;
      if (e.dyingUntil > now) continue;
      this.removeEnt(e);
      this.ents.delete(key);
    }
  }

  private upsert(key: string, name: string, r: RoomView, target: THREE.Vector3, snap: boolean, p: PlayerPublic | null, m: MonsterView | null) {
    let e = this.ents.get(key);
    if (!e) {
      let model: CharName;
      let scale = 1;
      let tint: number | undefined;
      let emissive: number | undefined;
      if (p) model = p.cls as CharName;
      else {
        let look: Look = MONSTER_LOOK[m!.kind] ?? { model: 'sk_minion', scale: 1 };
        if (!this.assets.has(look.model) && look.repli) look = look.repli;
        model = look.model;
        scale = look.scale;
        tint = look.tint;
        emissive = look.emissive;
      }
      const obj = this.assets.character(model, tint, emissive);
      obj.scale.setScalar(scale);
      obj.position.copy(target);
      this.scene.add(obj);
      const label = document.createElement('div');
      label.className = 'tag3d';
      this.labels.appendChild(label);
      e = {
        key, name, model, obj, mixer: new THREE.AnimationMixer(obj), current: null, base: m ? 'Idle' : 'Idle', roomId: r.id, path: [], yaw: 0,
        hp: 0, maxHp: 1, boss: !!m?.boss, player: !!p, label, bubble: null, dyingUntil: 0, busyUntil: 0, color: '#fff',
      };
      this.ents.set(key, e);
      this.play(e, 'Idle');
      if (!snap && m) this.play(e, 'Spawn_Ground_Skeletons', true);
    } else if (e.roomId !== r.id) {
      const from = this.floor?.rooms.find((x) => x.id === e!.roomId);
      e.path = from ? this.route(from, r, target) : [target];
      if (!from) e.obj.position.copy(target);
      e.roomId = r.id;
    } else if (!e.path.length && e.obj.position.distanceTo(target) > 0.3) e.path = [target];
    e.hp = p ? p.hp : m!.hp;
    e.maxHp = p ? p.maxHp : m!.maxHp;
    e.color = p ? (p.traitor ? '#ff4d8d' : p.immune ? '#8cd0ff' : p.bot ? '#a9b8cc' : '#ffffff') : m!.boss ? '#ffcf4a' : '#ffb0b0';
    e.name = name + (p?.traitor ? ' ☠' : '');
  }

  /** Trajet de salle en salle en passant par les portes. */
  private route(a: RoomView, b: RoomView, end: THREE.Vector3): THREE.Vector3[] {
    const ca = center(a);
    const cb = center(b);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return [end];
    const dir: Dir = dx === 1 ? 'e' : dx === -1 ? 'o' : dy === 1 ? 's' : 'n';
    const v = { e: [1, 0], o: [-1, 0], s: [0, 1], n: [0, -1] }[dir];
    return [
      new THREE.Vector3(ca.x + v[0] * (HALF - 1), 0, ca.z + v[1] * (HALF - 1)),
      new THREE.Vector3(cb.x - v[0] * (HALF - 1), 0, cb.z - v[1] * (HALF - 1)),
      end,
    ];
  }

  private removeEnt(e: Ent) {
    this.scene.remove(e.obj);
    e.mixer.stopAllAction();
    e.label.remove();
  }

  private play(e: Ent, name: string, once = false, clamp = false) {
    const clip = this.assets.clip(e.model, name);
    if (!clip) return;
    const a = e.mixer.clipAction(clip);
    if (e.current === a && !once) return;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    a.clampWhenFinished = clamp;
    if (e.current && e.current !== a) e.current.fadeOut(0.18);
    a.fadeIn(0.18).play();
    e.current = a;
    if (once) e.busyUntil = performance.now() + clip.duration * 1000 - 150;
  }

  // ------------------------------------------------------------ évènements

  /** Effets d'un tour, joués l'un après l'autre pour rester lisibles. */
  onEvents(events: GameEvent[]) {
    let delay = 0;
    for (const e of events) {
      if (!this.floor || e.floor !== this.floor.n) continue;
      if (e.roomId !== undefined && e.scope !== 'prive' && !e.npc) this.addHeat(e.roomId, e.drama + 8); // toute action compte un peu (pas le marchand)
      if (!e.fx) continue;
      const d = delay;
      setTimeout(() => this.playFx(e), d);
      delay += e.fx.kind === 'death' || e.fx.kind === 'crit' ? 700 : 320;
    }
  }

  private playFx(ev: GameEvent) {
    const fx = ev.fx!;
    const src = fx.src ? this.ents.get(fx.src) : undefined;
    const dst = fx.dst ? this.ents.get(fx.dst) : undefined;
    const now = performance.now();
    const face = (a: Ent, b: Ent) => {
      a.yaw = Math.atan2(b.obj.position.x - a.obj.position.x, b.obj.position.z - a.obj.position.z);
    };
    switch (fx.kind) {
      case 'hit':
      case 'crit':
      case 'miss':
        if (src && dst) face(src, dst);
        if (src) this.play(src, ATTACK_ANIM[src.model] ?? '1H_Melee_Attack_Chop', true);
        if (dst) setTimeout(() => this.play(dst, fx.kind === 'miss' ? 'Dodge_Backward' : 'Hit_A', true), 280);
        if (fx.kind === 'crit' && dst) {
          this.shake = 0.6;
          this.burst(dst.obj.position.clone().add(new THREE.Vector3(0, 1.6, 0)), 0xffe070, 50, 5);
          this.flashAt(dst.obj.position, 0xffd070);
        }
        break;
      case 'gag':
        if (src) this.play(src, 'Hit_A', true);
        if (src) this.burst(src.obj.position.clone().add(new THREE.Vector3(0, 2, 0)), 0xffffff, 20, 2);
        break;
      case 'death':
      case 'kill':
        if (dst) {
          dst.dyingUntil = now + 2600;
          dst.path = [];
          this.play(dst, dst.model.startsWith('sk_') && fx.kind === 'kill' ? 'Death_C_Skeletons' : 'Death_A', true, true);
          this.burst(dst.obj.position.clone().add(new THREE.Vector3(0, 1, 0)), fx.kind === 'death' ? 0xff3355 : 0xbfa0ff, 60, 4);
          if (dst.boss) {
            this.shake = 1;
            this.flashAt(dst.obj.position, 0xffb030);
          }
        }
        if (src && src.player) setTimeout(() => this.play(src, 'Cheer', true), 500);
        break;
      case 'levelup':
        if (src) {
          this.play(src, 'Cheer', true);
          this.burst(src.obj.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xffd65a, 70, 2, -3);
        }
        break;
      case 'heal':
        if (src) {
          this.play(src, 'Use_Item', true);
          this.burst(src.obj.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0x6dff8a, 40, 1.5, -2);
        }
        break;
      case 'loot':
        if (src) {
          this.play(src, 'PickUp', true);
          this.burst(src.obj.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 0xffcc33, 40, 2.5);
        }
        break;
      case 'trap':
        if (dst) {
          this.play(dst, 'Hit_A', true);
          this.burst(dst.obj.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 0xffffff, 30, 4);
          this.shake = 0.35;
        }
        break;
    }
  }

  bubble(name: string, text: string) {
    const e = this.ents.get(`p:${name}`);
    if (e) e.bubble = { text, until: performance.now() + 6500 };
  }

  private burst(at: THREE.Vector3, color: number, n: number, speed: number, grav = 12) {
    const pos = new Float32Array(n * 3);
    const vel: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      pos.set([at.x, at.y, at.z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const s = (0.3 + Math.random() * 0.7) * speed;
      vel.push(new THREE.Vector3(Math.cos(a) * s, (0.4 + Math.random() * 0.6) * speed * 1.2, Math.sin(a) * s));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.28, map: this.sparkTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(pts);
    this.particles.push({ pts, vel, t: 0, life: 1.4, grav });
  }

  private flashAt(p: THREE.Vector3, color: number) {
    this.flash.color.setHex(color);
    this.flash.position.copy(p).add(new THREE.Vector3(0, 2.5, 0));
    this.flash.intensity = 160;
  }

  // ------------------------------------------------------------- réalisateur

  private addHeat(roomId: number, v: number) {
    if (v <= 0) return;
    const now = performance.now();
    const h = this.heat.get(roomId);
    const cur = h ? h.score * Math.pow(0.5, (now - h.t) / 9000) : 0;
    this.heat.set(roomId, { score: cur + v, t: now });
  }

  private heatOf(roomId: number, now: number) {
    const h = this.heat.get(roomId);
    return h ? h.score * Math.pow(0.5, (now - h.t) / 9000) : 0;
  }

  private direct(now: number) {
    const f = this.floor;
    if (!f) return;
    if (this.followName) {
      const e = this.ents.get(`p:${this.followName}`);
      if (e) {
        this.roomShot(e.obj.position, 0.9);
        return;
      }
    }
    // Une salle sans plus personne de vivant (le mort a disparu) ne retient la caméra que 3 s après son dernier évènement
    const alive = (id: number) => (f.rooms.find((x) => x.id === id)?.players ?? []).some((p) => p.hp > 0);
    const score = (id: number) => {
      const h = this.heat.get(id);
      if (!h) return 0;
      if (!alive(id) && now - h.t > 3000) return 0;
      return this.heatOf(id, now);
    };
    let best: number | null = null;
    let bestScore = 0;
    let lastActive: { id: number; t: number } | null = null; // salle occupée où il s'est passé quelque chose en dernier
    for (const [id, h] of this.heat) {
      const s = score(id);
      if (s > bestScore) {
        bestScore = s;
        best = id;
      }
      if (alive(id) && now - h.t < 15000 && (!lastActive || h.t > lastActive.t)) lastActive = { id, t: h.t };
    }
    // Rien de spectaculaire : on suit la dernière salle où un joueur agit, plutôt qu'un plan large
    if ((best === null || bestScore < 14) && lastActive) {
      best = lastActive.id;
      bestScore = 14;
    }
    const curScore = this.shot.roomId !== null ? score(this.shot.roomId) : 0;
    const curDead = this.shot.roomId !== null && !alive(this.shot.roomId) && curScore === 0;
    const elapsed = now - this.shot.since;
    if (best !== null && bestScore >= 14 && best !== this.shot.roomId && (elapsed > 3500 || curDead || bestScore > curScore * 1.8 + 20)) {
      this.shot = { roomId: best, since: now };
      this.cut = true;
      const r = f.rooms.find((x) => x.id === best);
      this.onShot?.(r ? roomLabel(r) : '');
    } else if (this.shot.roomId !== null && curScore < 8 && (elapsed > 6000 || curDead)) {
      this.shot = { roomId: null, since: now };
      this.onShot?.('Plan large');
    }
    const room = this.shot.roomId !== null ? f.rooms.find((x) => x.id === this.shot.roomId) : undefined;
    if (room) this.roomShot(center(room), 1);
    else this.wideShot(now);
  }

  private roomShot(c: THREE.Vector3, k: number) {
    this.wantLook.set(c.x, 0.8, c.z + 0.5);
    this.wantPos.set(c.x + 3 * k, 15 * k, c.z + 17 * k);
  }

  private wideShot(now: number) {
    const f = this.floor!;
    const occupied = f.rooms.filter((r) => (r.players ?? []).length);
    const rooms = occupied.length ? occupied : f.rooms;
    const xs = rooms.map((r) => r.x * CELL);
    const zs = rooms.map((r) => r.y * CELL);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + CELL;
    const d = Math.max(30, ext * 0.95);
    const sway = Math.sin(now / 9000) * d * 0.08;
    this.wantLook.set(cx, 0, cz);
    this.wantPos.set(cx + sway, d * 0.85, cz + d * 0.8);
  }

  // ------------------------------------------------------------------ rendu

  render(dt: number, now: number) {
    this.direct(now);
    // Nouveau plan sur une salle lointaine : on coupe au lieu de traverser toute la carte
    if (this.cut) {
      this.cut = false;
      if (this.camLook.distanceTo(this.wantLook) > CELL * 1.6) {
        this.camLook.copy(this.wantLook);
        this.camPos.copy(this.wantPos);
      }
    }
    const k = 1 - Math.exp(-dt * 3.2);
    this.camPos.lerp(this.wantPos, k);
    this.camLook.lerp(this.wantLook, k * 1.2);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0.01) {
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake));
      this.shake *= Math.exp(-dt * 6);
    }
    this.camera.lookAt(this.camLook);
    this.sun.position.set(this.camLook.x - 14, 34, this.camLook.z + 18);
    this.sun.target.position.copy(this.camLook);
    this.flash.intensity *= Math.exp(-dt * 5);

    // Personnages
    for (const e of this.ents.values()) {
      e.mixer.update(dt);
      if (e.path.length && e.dyingUntil < now) {
        const t = e.path[0];
        const d = t.clone().sub(e.obj.position);
        d.y = 0;
        const step = 5 * dt;
        if (d.length() <= step) {
          e.obj.position.copy(t);
          e.path.shift();
          if (!e.path.length) e.yaw = 0;
        } else {
          e.obj.position.addScaledVector(d.normalize(), step);
          e.yaw = Math.atan2(d.x, d.z);
        }
        if (now > e.busyUntil) this.play(e, 'Walking_A');
      } else if (now > e.busyUntil && e.dyingUntil < now) this.play(e, 'Idle');
      let df = e.yaw - e.obj.rotation.y;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      e.obj.rotation.y += df * Math.min(1, dt * 8);
    }

    // Torches : les lumières suivent la caméra
    const ranked = this.flames
      .map((f) => ({ f, d: f.pos.distanceToSquared(this.camLook) }))
      .sort((a, b) => a.d - b.d);
    this.lights.forEach((l, i) => {
      const fl = ranked[i]?.f;
      if (!fl) {
        l.intensity = 0;
        return;
      }
      const n = Math.sin(now / 110 + fl.seed) * 0.5 + Math.sin(now / 43 + fl.seed * 2) * 0.3;
      l.position.copy(fl.pos).add(new THREE.Vector3(0, 0, 0.6));
      l.intensity = 38 * (0.85 + 0.15 * n);
    });
    for (const fl of this.flames) {
      const n = Math.sin(now / 110 + fl.seed);
      fl.sprite.scale.set(0.85 + 0.08 * n, 1.2 + 0.15 * n, 1);
    }

    // Particules
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      const arr = p.pts.geometry.attributes.position.array as Float32Array;
      p.vel.forEach((v, j) => {
        v.y -= p.grav * dt;
        arr[j * 3] += v.x * dt;
        arr[j * 3 + 1] = Math.max(0.05, arr[j * 3 + 1] + v.y * dt);
        arr[j * 3 + 2] += v.z * dt;
      });
      p.pts.geometry.attributes.position.needsUpdate = true;
      (p.pts.material as THREE.PointsMaterial).opacity = 1 - p.t / p.life;
      if (p.t >= p.life) {
        this.scene.remove(p.pts);
        p.pts.geometry.dispose();
        this.particles.splice(i, 1);
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.drawLabels(now);
  }

  private drawLabels(now: number) {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    const close = this.camPos.distanceTo(this.camLook) < 40;
    // Étiquettes visibles, puis on décale vers le haut celles qui se chevauchent (plan large, groupe serré)
    const shown: { e: Ent; x: number; y: number; half: number }[] = [];
    for (const e of this.ents.values()) {
      v.copy(e.obj.position).add(new THREE.Vector3(0, 2.7 * e.obj.scale.y, 0)).project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && e.dyingUntil < now && (close || e.player || e.boss);
      e.label.style.display = visible ? 'block' : 'none';
      if (visible) shown.push({ e, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, half: Math.max(26, e.name.length * 4.2 + 6) });
    }
    shown.sort((a, b) => b.y - a.y || a.x - b.x);
    const placed: typeof shown = [];
    for (const s of shown) {
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.find((o) => Math.abs(o.x - s.x) < o.half + s.half && Math.abs(o.y - s.y) < 22);
        if (!hit) break;
        s.y = hit.y - 22;
      }
      placed.push(s);
    }
    for (const { e, x, y } of placed) {
      e.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      const pct = Math.max(0, Math.min(100, (100 * e.hp) / e.maxHp));
      const hpColor = pct > 50 ? '#5ce65c' : pct > 25 ? '#ffc23d' : '#ff4040';
      const bub = e.bubble && e.bubble.until > now ? `<div class="bub3d">${escapeHtml(e.bubble.text)}</div>` : '';
      const html = `${bub}<div class="n" style="color:${e.color}">${escapeHtml(e.name)}</div><div class="hp"><i style="width:${pct}%;background:${hpColor}"></i></div>`;
      if (e.label.innerHTML !== html) e.label.innerHTML = html;
    }
  }
}

export function roomLabel(r: RoomView): string {
  return { normale: 'Salle', safe: 'Safe room', piege: 'Salle piégée', tresor: 'Salle du trésor', arene: 'Arène', boss: 'Salle du boss' }[r.type] + ` ${r.id}`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function glow(stops: [number, string][]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
