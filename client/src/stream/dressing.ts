// Habillage procédural du donjon 3D : ce que le pack de modèles n'a pas
// (os, tapis, toiles d'araignée, flaques, emblèmes au sol, rayon de l'escalier, tombes),
// et l'ambiance de chaque thème d'étage.
import * as THREE from 'three';
import type { FloorView, RoomView } from '../../../src/shared/types';
import { roomDecor, type Prop } from '../../../src/shared/decor';

const CELL = 16;
const HALF = 6;

/** Petit générateur pseudo-aléatoire à graine (mulberry32) : même salle, même désordre à chaque affichage. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hash = (n: number) => {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
};

// ------------------------------------------------------------------ textures

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let _tex: Record<string, THREE.Texture> | null = null;
function tex() {
  if (_tex) return _tex;
  _tex = {
    // Tapis : aplat héraldique, bordure or, losange au centre
    rugRed: canvasTex(128, 192, (g) => rug(g, '#7d1c1c', '#c99a2e')),
    rugBlue: canvasTex(128, 192, (g) => rug(g, '#1f3f7a', '#d8c9a0')),
    // Rayon de lumière : opaque en bas, transparent en haut
    beam: canvasTex(4, 128, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.6, 'rgba(255,255,255,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 4, 128);
    }),
    // Anneau sous les personnages
    halo: canvasTex(128, 128, (g) => {
      const gr = g.createRadialGradient(64, 64, 30, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.55, 'rgba(255,255,255,0.0)');
      gr.addColorStop(0.72, 'rgba(255,255,255,1)');
      gr.addColorStop(0.86, 'rgba(255,255,255,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }),
    mote: canvasTex(32, 32, (g) => {
      const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 32, 32);
    }),
  };
  return _tex;
}

function rug(g: CanvasRenderingContext2D, field: string, border: string) {
  g.fillStyle = field;
  g.fillRect(0, 0, 128, 192);
  g.strokeStyle = border;
  g.lineWidth = 8;
  g.strokeRect(10, 10, 108, 172);
  g.lineWidth = 3;
  g.strokeRect(22, 22, 84, 148);
  g.fillStyle = border;
  g.beginPath();
  g.moveTo(64, 60);
  g.lineTo(90, 96);
  g.lineTo(64, 132);
  g.lineTo(38, 96);
  g.closePath();
  g.fill();
  // usure
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`;
    g.fillRect(Math.random() * 128, Math.random() * 192, 3, 3);
  }
  // franges
  g.fillStyle = border;
  for (let x = 6; x < 128; x += 8) {
    g.fillRect(x, 0, 2, 6);
    g.fillRect(x, 186, 2, 6);
  }
}

// --------------------------------------------------------------- matériaux

const BONE = new THREE.MeshStandardMaterial({ color: 0xd9cfb6, roughness: 0.8 });
const PUDDLE = new THREE.MeshStandardMaterial({ color: 0x0b0a0c, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.75 });
const SCORCH = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
const BONE_GEO = new THREE.CylinderGeometry(0.06, 0.06, 0.55, 6);
const ROCK_GEO = new THREE.DodecahedronGeometry(1, 0);
const ROCK = new THREE.MeshStandardMaterial({ color: 0x6f645c, roughness: 1, flatShading: true });
const SKULL_GEO = new THREE.SphereGeometry(0.2, 10, 8);
const DISC_GEO = new THREE.CircleGeometry(1, 24);
const PLANE_GEO = new THREE.PlaneGeometry(1, 1);
let _mats: Record<string, THREE.Material> | null = null;
function mats() {
  if (_mats) return _mats;
  const t = tex();
  _mats = {
    rugRed: new THREE.MeshStandardMaterial({ map: t.rugRed, roughness: 1 }),
    rugBlue: new THREE.MeshStandardMaterial({ map: t.rugBlue, roughness: 1 }),
  };
  return _mats;
}

/** Couleur de chaque type de salle : les mêmes que les liserés de la carte 2D. */
export function roomColor(r: RoomView): number | null {
  if (r.forge) return 0xff8a2a;
  return ({ safe: 0x4f86e0, boss: 0xe5484d, tresor: 0xe0a826, arene: 0xa070ff, piege: 0xc23a3a } as Record<string, number>)[r.type] ?? null;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], shadow = false) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((x, i) => m.setMatrixAt(i, x));
  m.instanceMatrix.needsUpdate = true;
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}
const mat4 = (x: number, y: number, z: number, rx: number, ry: number, rz: number, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/** Ajoute à `group` le décor procédural de l'étage. */
export function buildDressing(f: FloorView, group: THREE.Group) {
  const bones: THREE.Matrix4[] = [];
  const skulls: THREE.Matrix4[] = [];
  const puddles: THREE.Matrix4[] = [];
  const scorch: THREE.Matrix4[] = [];
  const rugsRed: THREE.Matrix4[] = [];
  const rugsBlue: THREE.Matrix4[] = [];
  const wet = f.theme === 'inondé';
  const fire = f.theme === 'en feu';
  const rubble: THREE.Matrix4[] = [];
  for (const r of f.rooms) {
    const cx = r.x * CELL;
    const cz = r.y * CELL;
    // Le décor est tiré une seule fois (module partagé) : la carte 2D montre les mêmes objets aux mêmes endroits
    const at = (p: Prop) => [cx + p.u * HALF, cz + p.v * HALF] as const;
    for (const p of roomDecor(f.n, r, f.theme)) {
      const rand = rng(p.seed);
      const between = (a: number, b: number) => a + rand() * (b - a);
      const [px, pz] = at(p);
      switch (p.kind) {
        case 'rug_red':
        case 'rug_blue':
          (p.kind === 'rug_red' ? rugsRed : rugsBlue).push(mat4(px, p.kind === 'rug_red' ? 0.085 : 0.075, pz, -Math.PI / 2, 0, p.rot, p.w! * HALF * 2, p.h! * HALF * 2, 1));
          break;
        case 'bones':
          for (let i = 0; i < (p.n ?? 4); i++) {
            const a = rand() * Math.PI * 2;
            const d = Math.pow(rand(), 1.6) * 1.1;
            bones.push(mat4(px + Math.cos(a) * d, 0.07 + rand() * 0.12, pz + Math.sin(a) * d, Math.PI / 2 + between(-0.3, 0.3), rand() * Math.PI, between(-0.3, 0.3), 1, between(0.5, 1.5), 1));
          }
          if (p.skull) skulls.push(mat4(px + between(-0.4, 0.4), 0.18, pz + between(-0.4, 0.4), between(-0.4, 0.2), rand() * 6, between(-0.5, 0.5), 1, 0.9, 1.1));
          break;
        case 'rubble':
          for (let i = 0; i < (p.n ?? 5); i++) {
            const a = rand() * Math.PI * 2;
            const d = Math.pow(rand(), 1.3) * 1.3;
            const sc = between(0.12, 0.42) * (1.2 - d * 0.4);
            rubble.push(mat4(px + Math.cos(a) * d, sc * 0.6, pz + Math.sin(a) * d, rand() * 6, rand() * 6, rand() * 6, sc * between(0.8, 1.3), sc, sc * between(0.8, 1.4)));
          }
          break;
        case 'puddle':
          for (let i = 0; i < (p.n ?? 3); i++) puddles.push(mat4(px + between(-0.9, 0.9), 0.07 + i * 0.001, pz + between(-0.7, 0.7), -Math.PI / 2, 0, 0, between(0.35, 0.9), between(0.25, 0.7), 1));
          break;
        case 'scorch':
          scorch.push(mat4(px, 0.072, pz, -Math.PI / 2, 0, p.rot, p.s, p.s * 0.8, 1));
          break;
        default:
          break; // tonneaux, caisses, pièces : posés par le monde (pièces 3D)
      }
    }
    // Quelques os égarés (détail propre à la 3D)
    if (r.type === 'normale' || r.type === 'piege' || r.type === 'boss' || r.type === 'arene') {
      const rand = rng(hash(r.id * 7919 + f.n * 104729) ^ 0x5bd1e995);
      const strays = Math.floor(rand() * 4);
      for (let i = 0; i < strays; i++) {
        const x = cx + (rand() * 2 - 1) * (HALF - 1.2);
        const z = cz + (rand() * 2 - 1) * (HALF - 1.2);
        bones.push(mat4(x, 0.07, z, Math.PI / 2, rand() * Math.PI, 0, 1, 0.5 + rand() * 0.7, 1));
      }
    }
  }
  const m = mats();
  if (bones.length) group.add(instanced(BONE_GEO, BONE, bones, true));
  if (rubble.length) group.add(instanced(ROCK_GEO, ROCK, rubble, true));
  if (skulls.length) group.add(instanced(SKULL_GEO, BONE, skulls, true));
  if (puddles.length) group.add(instanced(DISC_GEO, PUDDLE, puddles));
  if (scorch.length) group.add(instanced(DISC_GEO, SCORCH, scorch));
  if (rugsRed.length) group.add(instanced(PLANE_GEO, m.rugRed, rugsRed));
  if (rugsBlue.length) group.add(instanced(PLANE_GEO, m.rugBlue, rugsBlue));
  // Étage inondé : une nappe d'eau sur tout l'étage
  if (wet) {
    const xs = f.rooms.map((r) => r.x);
    const ys = f.rooms.map((r) => r.y);
    const w = (Math.max(...xs) - Math.min(...xs) + 1) * CELL;
    const d = (Math.max(...ys) - Math.min(...ys) + 1) * CELL;
    const water = new THREE.Mesh(PLANE_GEO, new THREE.MeshStandardMaterial({ color: 0x24506e, roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.5, depthWrite: false }));
    water.rotation.x = -Math.PI / 2;
    water.scale.set(w, d, 1);
    water.position.set(((Math.min(...xs) + Math.max(...xs)) / 2) * CELL, 0.22, ((Math.min(...ys) + Math.max(...ys)) / 2) * CELL);
    water.renderOrder = 2;
    water.userData.disposeMaterial = true;
    group.add(water);
  }
}

// ----------------------------------------------------- rayon et anneaux

const BEAM_GEO = new THREE.CylinderGeometry(1.5, 1.9, 16, 24, 1, true);
export function makeBeam(): THREE.Mesh {
  const m = new THREE.Mesh(BEAM_GEO, new THREE.MeshBasicMaterial({ map: tex().beam, color: 0xffc84a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  m.position.y = 8;
  return m;
}

export const CLASS_COLOR: Record<string, number> = { barbare: 0xe0533f, chevalier: 0x4f86e0, voleur: 0x3fb767, mage: 0xa978ff };
const HALO_GEO = new THREE.PlaneGeometry(2.2, 2.2);
const haloMats = new Map<string, THREE.MeshBasicMaterial>();
/** Anneau au sol sous un personnage : couleur de sa classe, franc pour un vrai joueur, discret pour un PNJ. */
export function makeHalo(color: number, strong: boolean, size = 1): THREE.Mesh {
  const k = `${color}:${strong}`;
  let m = haloMats.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: tex().halo, color, transparent: true, opacity: strong ? 1 : 0.4, depthWrite: false, toneMapped: false, blending: strong ? THREE.AdditiveBlending : THREE.NormalBlending });
    haloMats.set(k, m);
  }
  const mesh = new THREE.Mesh(HALO_GEO, m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.09;
  mesh.scale.setScalar(size * (strong ? 1 : 0.85));
  mesh.renderOrder = 3;
  return mesh;
}

// --------------------------------------------------------------- tombes

const STONE = new THREE.MeshStandardMaterial({ color: 0xa9a49b, roughness: 0.92 });
const ENGRAVE = new THREE.MeshStandardMaterial({ color: 0x3b3833, roughness: 1 });
const MOSS = new THREE.MeshStandardMaterial({ color: 0x4f6b38, roughness: 1, flatShading: true });
const DIRT = new THREE.MeshStandardMaterial({ color: 0x5e4632, roughness: 1, flatShading: true });
const WAX = new THREE.MeshStandardMaterial({ color: 0xefe6cf, roughness: 0.7 });
const FLAME = new THREE.MeshBasicMaterial({ color: 0xffc060, toneMapped: false });
const PETAL = new THREE.MeshStandardMaterial({ color: 0x9a3040, roughness: 0.8 });
// Stèle : un rectangle coiffé d'un arc, extrudée avec un léger chanfrein
const HEADSTONE_GEO = (() => {
  const w = 0.5;
  const h = 0.85;
  const sh = new THREE.Shape();
  sh.moveTo(-w, 0);
  sh.lineTo(w, 0);
  sh.lineTo(w, h);
  sh.absarc(0, h, w, 0, Math.PI, false);
  sh.lineTo(-w, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 14 });
  g.translate(0, 0, -0.09);
  return g;
})();
const PLINTH_GEO = new THREE.BoxGeometry(1.25, 0.18, 0.5);
const MOUND_GEO = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const CANDLE_GEO = new THREE.CylinderGeometry(0.07, 0.08, 0.32, 8);
const FLAME_GEO = new THREE.ConeGeometry(0.045, 0.14, 6);
const MOSS_GEO = new THREE.IcosahedronGeometry(1, 0);

/** Tombe d'un crawler : stèle arrondie gravée d'une croix, socle, butte de terre, une bougie et une fleur. */
export function makeTomb(seed: number): THREE.Group {
  const r = rng(Math.floor(Math.abs(seed)) + 1);
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(PLINTH_GEO, STONE, 0, 0.09, 0);
  const stone = add(HEADSTONE_GEO, STONE, 0, 0.18, 0);
  stone.rotation.z = (r() - 0.5) * 0.12; // un peu de travers, comme une vraie vieille tombe
  stone.rotation.x = -0.05 - r() * 0.06;
  // croix gravée sur la face avant
  const cross = new THREE.Group();
  const v = new THREE.Mesh(BOX, ENGRAVE);
  v.scale.set(0.09, 0.62, 0.02);
  v.position.set(0, 0.78, 0.125);
  const hz = new THREE.Mesh(BOX, ENGRAVE);
  hz.scale.set(0.4, 0.09, 0.02);
  hz.position.set(0, 0.92, 0.125);
  cross.add(v, hz);
  stone.add(cross);
  // mousse au pied et sur un coin
  for (let i = 0; i < 4; i++) add(MOSS_GEO, MOSS, (r() - 0.5) * 1.1, 0.12 + r() * 0.05, 0.18 + r() * 0.12, 0.12 + r() * 0.1, 0.06, 0.1 + r() * 0.08);
  // butte de terre devant
  add(MOUND_GEO, DIRT, 0, 0, 0.95, 0.48, 0.2, 0.72);
  // une bougie allumée et une fleur posée sur la butte
  const cx = 0.38 + r() * 0.12;
  add(CANDLE_GEO, WAX, cx, 0.34, 0.32);
  const fl = new THREE.Mesh(FLAME_GEO, FLAME);
  fl.position.set(cx, 0.57, 0.32);
  g.add(fl);
  const st = add(BOX, LEAF, -0.25, 0.25, 0.9, 0.03, 0.03, 0.5);
  st.rotation.y = 0.4;
  add(MOSS_GEO, PETAL, -0.36, 0.27, 0.68, 0.09, 0.07, 0.09);
  g.rotation.y = (r() - 0.5) * 0.25;
  g.scale.setScalar(1.25);
  g.userData.flame = fl;
  return g;
}

// --------------------------------------------------------------- ambiance

export interface Mood {
  sky: number; // lumière d'ambiance (haut)
  ground: number; // lumière d'ambiance (bas)
  ambient: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  mote: number; // couleur des poussières
  rise: number; // vitesse verticale des poussières (braises qui montent, spores qui tombent)
}

export function moodFor(theme: string): Mood {
  const base: Mood = { sky: 0x9b8a78, ground: 0x1c1410, ambient: 0.75, fog: 0x15110e, fogNear: 70, fogFar: 220, mote: 0xffd9a0, rise: 0.05 };
  switch (theme) {
    case 'inondé': return { ...base, sky: 0x7d93a8, ground: 0x0f1820, mote: 0xcfe6ff };
    case 'en feu': return { ...base, sky: 0xc08050, ground: 0x2a1006, ambient: 0.8, fog: 0x1e0f08, mote: 0xff8a3a, rise: 0.9 };
    case 'plongé dans le noir': return { ...base, ambient: 0.32, fogNear: 40, fogFar: 140, mote: 0xbfb5a5 };
    case 'moisi': return { ...base, sky: 0x8a9a6a, ground: 0x141a0c, mote: 0xc8e090, rise: -0.15 };
    case 'hanté': return { ...base, sky: 0x8090b8, ground: 0x10121e, fog: 0x10131e, fogNear: 45, fogFar: 170, mote: 0xbcd0ff, rise: 0.25 };
    default: return base;
  }
}

/** Poussière qui flotte dans la lumière des torches, autour de la caméra. */
export function makeMotes(n = 260): THREE.Points {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 30, Math.random() * 7, (Math.random() - 0.5) * 30], i * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.11, map: tex().mote, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  p.frustumCulled = false;
  return p;
}

// ------------------------------------------------------- la safe room du marchand
// Une boutique tenue : tout est rangé, aligné, propre. Le contraire du reste du donjon.

const WOOD = new THREE.MeshStandardMaterial({ color: 0x7a4e2c, roughness: 0.85 });
const WOOD_DARK = new THREE.MeshStandardMaterial({ color: 0x4f321d, roughness: 0.9 });
const POT = new THREE.MeshStandardMaterial({ color: 0xa65c38, roughness: 0.8 });
const LEAF = new THREE.MeshStandardMaterial({ color: 0x3f7f45, roughness: 0.9, flatShading: true });
const GLASS: Record<string, THREE.MeshStandardMaterial> = {};
const glass = (c: number) =>
  (GLASS[c] ??= new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9 }));
const BOX = new THREE.BoxGeometry(1, 1, 1);
const BOTTLE_GEO = new THREE.CylinderGeometry(0.13, 0.15, 0.36, 10);
const NECK_GEO = new THREE.CylinderGeometry(0.05, 0.06, 0.14, 8);
const FLASK_GEO = new THREE.SphereGeometry(0.17, 12, 10);
const POT_GEO = new THREE.CylinderGeometry(0.42, 0.3, 0.7, 12);
const BUSH_GEO = new THREE.IcosahedronGeometry(0.62, 0);

function part(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Étagère murale du marchand, remplie de fioles bien alignées. `along` : 'x' (mur nord) ou 'z' (mur ouest). */
function shelf(g: THREE.Group, x: number, z: number, along: 'x' | 'z') {
  const L = 2.6;
  const D = 0.6;
  const sx = along === 'x' ? L : D;
  const sz = along === 'x' ? D : L;
  for (const k of [-1, 1]) {
    const px = along === 'x' ? x + (k * (L - 0.15)) / 2 : x;
    const pz = along === 'z' ? z + (k * (L - 0.15)) / 2 : z;
    g.add(part(BOX, WOOD_DARK, px, 1.25, pz, along === 'x' ? 0.15 : D, 2.5, along === 'z' ? 0.15 : D));
  }
  const colors = [0xd23a3a, 0x3a6fd2, 0x3fae5f, 0xe0b030, 0xa060e0];
  [0.35, 1.1, 1.85].forEach((y, row) => {
    g.add(part(BOX, WOOD, x, y, z, sx, 0.09, sz));
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = -L / 2 + 0.35 + (i * (L - 0.7)) / (n - 1);
      const bx = along === 'x' ? x + t : x;
      const bz = along === 'z' ? z + t : z;
      const col = colors[(i + row * 2) % colors.length];
      if ((i + row) % 3 === 2) {
        g.add(part(FLASK_GEO, glass(col), bx, y + 0.22, bz));
        g.add(part(NECK_GEO, glass(col), bx, y + 0.42, bz));
      } else {
        g.add(part(BOTTLE_GEO, glass(col), bx, y + 0.23, bz));
        g.add(part(NECK_GEO, glass(col), bx, y + 0.48, bz));
      }
    }
  });
}

function plant(g: THREE.Group, x: number, z: number) {
  g.add(part(POT_GEO, POT, x, 0.35, z));
  g.add(part(BUSH_GEO, LEAF, x, 1.1, z, 1, 1.15, 1));
  g.add(part(BUSH_GEO, LEAF, x + 0.2, 1.55, z - 0.1, 0.6, 0.7, 0.6));
}

/**
 * Aménagement de la safe room : tapis centré, comptoir et étagère à potions,
 * plantes dans les coins. Évite les portes (milieu de chaque mur).
 * Renvoie la place du marchand, derrière son comptoir.
 */
export function buildSafeRoom(g: THREE.Group, cx: number, cz: number, doors: { n?: number; s?: number; e?: number; o?: number }): THREE.Vector3 {
  // Grand tapis bleu bien centré, et un chemin de tapis vers chaque porte
  const blue = mats().rugBlue;
  const rug = new THREE.Mesh(PLANE_GEO, blue);
  rug.rotation.x = -Math.PI / 2;
  rug.scale.set(5, 6.4, 1);
  rug.position.set(cx, 0.075, cz + 0.6);
  rug.receiveShadow = true;
  g.add(rug);
  // Étagère : contre le mur ouest (côté nord) s'il n'y a pas de porte à l'ouest, sinon dans le coin nord-ouest
  if (doors.o === undefined) shelf(g, cx - HALF + 0.75, cz - 2.6, 'z');
  else shelf(g, cx - 3.6, cz - HALF + 0.75, 'x');
  // Plantes : coins sud, et à côté du comptoir
  plant(g, cx - HALF + 1.1, cz + HALF - 1.1);
  plant(g, cx + HALF - 1.1, cz + HALF - 1.1);
  plant(g, cx + HALF - 0.9, cz - 1.8);
  return new THREE.Vector3(cx + 2.8, 0, cz - 4.95);
}

// ----------------------------------------------------------------- la forge
// Un atelier qui sert : foyer et soufflet, tas de charbon, enclume sur billot, bac de trempe, râtelier d'armes.

const F_STONE = new THREE.MeshStandardMaterial({ color: 0x7d7068, roughness: 0.95 });
const F_SOOT = new THREE.MeshStandardMaterial({ color: 0x3c3330, roughness: 1 });
const F_METAL = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.4, metalness: 0.6 });
const F_STEEL = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.25, metalness: 0.8 });
const F_COAL = new THREE.MeshStandardMaterial({ color: 0x1b1716, roughness: 1, flatShading: true });
const F_EMBER = new THREE.MeshStandardMaterial({ color: 0x3a0c00, emissive: 0xff4a0a, emissiveIntensity: 0.9, roughness: 1 });
const F_HOT = new THREE.MeshStandardMaterial({ color: 0x601800, emissive: 0xff6a1a, emissiveIntensity: 1.1 });
const F_WATER = new THREE.MeshStandardMaterial({ color: 0x3a7a96, emissive: 0x0c2a3a, roughness: 0.05, metalness: 0.2 });
const F_LEATHER = new THREE.MeshStandardMaterial({ color: 0x5a3520, roughness: 0.9 });
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const CONE = new THREE.ConeGeometry(1, 1, 12);
const HOOD_GEO = new THREE.CylinderGeometry(0.6, 1.65, 2.4, 4);
const COAL_GEO = new THREE.DodecahedronGeometry(1, 0);

export interface ForgeSpots {
  hearth: THREE.Vector3; // centre du feu
  chimney: THREE.Vector3; // haut du manteau (fumée)
  anvil: THREE.Vector3; // dessus de l'enclume (étincelles)
  smith: THREE.Vector3; // place du forgeron
  tub: THREE.Vector3; // surface de l'eau (vapeur)
}

export function buildForgeShop(g: THREE.Group, cx: number, cz: number, doors: { n?: number; s?: number; e?: number; o?: number }): ForgeSpots {
  const back = cz - HALF + 1.3;
  const hx = cx - 2.6;
  // Foyer en pierre, braises, manteau de cheminée noirci
  g.add(part(BOX, F_STONE, hx, 0.65, back, 3.2, 1.3, 1.8));
  g.add(part(BOX, F_EMBER, hx, 1.33, back, 2.3, 0.12, 1.05));
  for (let i = 0; i < 7; i++) g.add(part(COAL_GEO, F_EMBER, hx - 0.9 + i * 0.3, 1.42, back + ((i * 37) % 5) * 0.08 - 0.15, 0.17, 0.12, 0.17));
  const hood = part(HOOD_GEO, F_SOOT, hx, 3.5, back - 0.1);
  hood.rotation.y = Math.PI / 4;
  g.add(hood);
  // Soufflet de cuir, à gauche du foyer
  const bel = part(BOX, F_LEATHER, hx - 2.05, 0.75, back + 0.2, 0.9, 0.35, 1.2);
  bel.rotation.z = 0.25;
  g.add(bel);
  g.add(part(CYL, F_METAL, hx - 1.5, 0.95, back + 0.2, 0.08, 0.6, 0.08));
  // Tas de charbon, à droite du foyer
  for (let i = 0; i < 14; i++) {
    const a = (i * 2.4) % (Math.PI * 2);
    const d = (i % 4) * 0.22;
    const s = 0.22 + ((i * 13) % 5) * 0.04;
    g.add(part(COAL_GEO, F_COAL, hx + 2.1 + Math.cos(a) * d, s * 0.7 + (i < 4 ? 0.25 : 0), back + 0.3 + Math.sin(a) * d * 0.8, s, s * 0.8, s));
  }
  // Enclume sur son billot, avec une pièce rougeoyante dessus
  const ax = cx + 0.4;
  const az = cz - 1.2;
  g.add(part(CYL, WOOD_DARK, ax, 0.4, az, 0.55, 0.8, 0.55));
  g.add(part(BOX, F_METAL, ax, 0.95, az, 0.55, 0.3, 0.45)); // taille
  g.add(part(BOX, F_METAL, ax, 1.22, az, 1.25, 0.26, 0.55)); // table
  const horn = part(CONE, F_METAL, ax + 0.95, 1.22, az, 0.2, 0.7, 0.2);
  horn.rotation.z = -Math.PI / 2;
  g.add(horn);
  g.add(part(BOX, F_HOT, ax - 0.1, 1.39, az, 0.6, 0.07, 0.14));
  // Bac de trempe : un demi-tonneau plein d'eau
  const tx = cx + 2.3;
  const tz = cz - 0.6;
  g.add(part(CYL, WOOD, tx, 0.39, tz, 0.75, 0.78, 0.75));
  g.add(part(CYL, F_SOOT, tx, 0.79, tz, 0.7, 0.01, 0.7));
  g.add(part(CYL, F_METAL, tx, 0.66, tz, 0.77, 0.08, 0.77));
  g.add(part(CYL, F_METAL, tx, 0.15, tz, 0.77, 0.08, 0.77));
  g.add(part(CYL, F_WATER, tx, 0.83, tz, 0.68, 0.02, 0.68));
  // Râtelier d'armes contre le mur nord (ou est, s'il y a une porte au nord du côté droit : on reste à droite de toute façon)
  const rx = cx + 4.1;
  const rz = cz - HALF + 0.7;
  g.add(part(BOX, WOOD_DARK, rx, 0.9, rz, 2.3, 0.12, 0.3));
  g.add(part(BOX, WOOD_DARK, rx, 0.25, rz + 0.15, 2.3, 0.12, 0.5));
  for (const k of [-1, 1]) g.add(part(BOX, WOOD_DARK, rx + k * 1.1, 0.75, rz, 0.12, 1.5, 0.3));
  for (let i = 0; i < 4; i++) {
    const x = rx - 0.8 + i * 0.53;
    g.add(part(BOX, F_STEEL, x, 1.2, rz + 0.18, 0.12, 1.6 - (i % 2) * 0.3, 0.04)); // lame
    g.add(part(BOX, F_LEATHER, x, 0.35, rz + 0.18, 0.09, 0.4, 0.09)); // poignée
    g.add(part(BOX, F_METAL, x, 0.58, rz + 0.18, 0.4, 0.06, 0.08)); // garde
  }
  // Marteau et tenailles posés au pied de l'enclume
  const hm = part(BOX, WOOD, ax - 0.6, 0.1, az + 0.75, 0.08, 0.08, 0.8);
  hm.rotation.y = 0.5;
  g.add(hm);
  g.add(part(BOX, F_METAL, ax - 0.78, 0.15, az + 1.1, 0.22, 0.18, 0.16));
  void doors;
  return {
    hearth: new THREE.Vector3(hx, 1.5, back),
    chimney: new THREE.Vector3(hx, 4.7, back - 0.1),
    anvil: new THREE.Vector3(ax - 0.1, 1.45, az),
    smith: new THREE.Vector3(ax - 0.1, 0, az - 1.25),
    tub: new THREE.Vector3(tx, 0.85, tz),
  };
}

/** Fumée : quelques volutes sombres qui montent du manteau (mélange normal, pas additif). */
let _smokeTex: THREE.Texture | null = null;
export function smokeSprite(): THREE.Sprite {
  _smokeTex ??= canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: _smokeTex, color: 0x6e6660, transparent: true, depthWrite: false, opacity: 0 }));
  return s;
}

// ----------------------------------------------------------- salles spéciales
// Autel, fontaine, puits à vœux, chaînes du prisonnier : posés au milieu du mur nord (le puits au centre).

const TORUS_GEO = new THREE.TorusGeometry(1.15, 0.32, 8, 20);
const CHAIN_GEO = new THREE.TorusGeometry(0.09, 0.025, 4, 8);
const CLOTH = new THREE.MeshStandardMaterial({ color: 0x8a1c22, roughness: 0.9 });
const GOLD = new THREE.MeshStandardMaterial({ color: 0xd8a830, roughness: 0.35, metalness: 0.7 });
const GLOW_WATER = new THREE.MeshStandardMaterial({ color: 0x3ab0d0, emissive: 0x1a6a8a, emissiveIntensity: 0.9, roughness: 0.05 });
const DARK_WATER = new THREE.MeshStandardMaterial({ color: 0x0c1c28, roughness: 0.05, metalness: 0.5 });

/** Renvoie l'endroit où se tient le prisonnier (pour le personnage), sinon null. */
export function buildFeature(g: THREE.Group, kind: string, cx: number, cz: number): THREE.Vector3 | null {
  const z = cz - HALF + 1.4;
  switch (kind) {
    case 'autel': {
      g.add(part(BOX, F_STONE, cx, 0.55, z, 2.6, 1.1, 1.2));
      g.add(part(BOX, STONE, cx, 1.15, z, 2.9, 0.14, 1.4));
      g.add(part(BOX, CLOTH, cx, 1.0, z + 0.62, 0.9, 0.9, 0.05));
      g.add(part(CYL, GOLD, cx, 1.35, z, 0.22, 0.3, 0.22));
      for (const dx of [-1.1, 1.1]) {
        g.add(part(CANDLE_GEO, WAX, cx + dx, 1.38, z));
        const fl = new THREE.Mesh(FLAME_GEO, FLAME);
        fl.position.set(cx + dx, 1.6, z);
        g.add(fl);
      }
      return null;
    }
    case 'fontaine': {
      g.add(part(CYL, F_STONE, cx, 0.35, z + 0.4, 1.7, 0.7, 1.7));
      g.add(part(CYL, GLOW_WATER, cx, 0.72, z + 0.4, 1.45, 0.05, 1.45));
      g.add(part(CYL, STONE, cx, 1.3, z + 0.4, 0.28, 1.3, 0.28));
      g.add(part(CYL, STONE, cx, 2.0, z + 0.4, 0.75, 0.16, 0.75));
      g.add(part(CYL, GLOW_WATER, cx, 2.1, z + 0.4, 0.6, 0.04, 0.6));
      return null;
    }
    case 'puits': {
      const ring = part(TORUS_GEO, F_STONE, cx, 0.45, cz);
      ring.rotation.x = Math.PI / 2;
      ring.scale.set(1, 1, 2.4);
      g.add(ring);
      g.add(part(CYL, DARK_WATER, cx, 0.4, cz, 1.0, 0.05, 1.0));
      for (const dx of [-1.4, 1.4]) g.add(part(BOX, WOOD_DARK, cx + dx, 1.3, cz, 0.18, 2.6, 0.18));
      g.add(part(BOX, WOOD, cx, 2.55, cz, 3.1, 0.2, 0.22));
      g.add(part(CYL, WOOD, cx + 0.3, 1.7, cz, 0.22, 0.32, 0.22));
      return null;
    }
    case 'prisonnier': {
      for (const dx of [-0.55, 0.55]) {
        for (let i = 0; i < 7; i++) {
          const link = part(CHAIN_GEO, F_METAL, cx + dx * (1 - i * 0.05), 2.4 - i * 0.17, cz - HALF + 0.55 + i * 0.03);
          link.rotation.y = i % 2 ? Math.PI / 2 : 0;
          g.add(link);
        }
      }
      return new THREE.Vector3(cx, 0, cz - HALF + 1.1);
    }
    default:
      return null;
  }
}
