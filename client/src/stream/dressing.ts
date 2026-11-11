// Habillage procédural du donjon 3D : ce que le pack de modèles n'a pas
// (os, tapis, toiles d'araignée, flaques, emblèmes au sol, rayon de l'escalier, tombes),
// et l'ambiance de chaque thème d'étage.
import * as THREE from 'three';
import type { FloorView, RoomView } from '../../../src/shared/types';

const CELL = 16;
const HALF = 6;

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
    web: canvasTex(128, 128, (g) => {
      g.strokeStyle = 'rgba(235,230,220,0.75)';
      g.lineWidth = 1.2;
      for (let a = 0; a < 7; a++) {
        const ang = (a / 6) * (Math.PI / 2);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(ang) * 128, Math.sin(ang) * 128);
        g.stroke();
      }
      for (let r = 16; r < 128; r += 16) {
        g.beginPath();
        for (let a = 0; a <= 6; a++) {
          const ang = (a / 6) * (Math.PI / 2);
          const rr = r * (1 + (a % 2) * 0.08);
          if (a === 0) g.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
          else g.quadraticCurveTo(Math.cos(ang - 0.13) * rr * 0.9, Math.sin(ang - 0.13) * rr * 0.9, Math.cos(ang) * rr, Math.sin(ang) * rr);
        }
        g.stroke();
      }
    }),
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
    web: new THREE.MeshBasicMaterial({ map: t.web, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
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
  const webs: THREE.Matrix4[] = [];
  const wet = f.theme === 'inondé';
  const fire = f.theme === 'en feu';
  for (const r of f.rooms) {
    const cx = r.x * CELL;
    const cz = r.y * CELL;
    const h = hash(r.id * 13 + 7);
    const rnd = (k: number) => (hash(r.id * 97 + k * 31) % 1000) / 1000;
    const spot = (k: number, lim = HALF - 1.4) => [cx + (rnd(k) - 0.5) * 2 * lim, cz + (rnd(k + 50) - 0.5) * 2 * lim] as const;
    // Tapis : safe rooms (bleu), et quelques salles ordinaires (rouge)
    if (r.type === 'safe' && !r.forge) rugsBlue.push(mat4(cx - 1.6, 0.04, cz + 1.5, -Math.PI / 2, 0, 0, 3, 4.6, 1));
    else if (r.type === 'normale' && h % 5 === 0) rugsRed.push(mat4(cx + (h % 2 ? 1.5 : -1.5), 0.04, cz + 0.5, -Math.PI / 2, 0, (h % 3) * 0.08 - 0.08, 2.8, 4.2, 1));
    // Os éparpillés : salles ordinaires, pièges et salle du boss
    if (r.type === 'normale' || r.type === 'piege' || r.type === 'boss' || r.type === 'arene') {
      const n = r.type === 'boss' ? 10 : r.type === 'arene' ? 6 : h % 4 === 0 ? 7 : h % 3 === 0 ? 3 : 0;
      for (let i = 0; i < n; i++) {
        const [x, z] = spot(i);
        bones.push(mat4(x, 0.08, z, Math.PI / 2, rnd(i + 200) * Math.PI, 0, 1, 0.6 + rnd(i + 300) * 0.8, 1));
        if (i % 3 === 0) skulls.push(mat4(x + 0.3, 0.17, z + 0.2, 0, rnd(i + 400) * 6, 0, 1, 0.9, 1.1));
      }
    }
    // Flaques (pas quand l'étage est inondé : l'eau couvre tout) ; traces de brûlé si l'étage est en feu
    if (!wet && h % 3 === 1) {
      for (let i = 0; i < 2; i++) {
        const [x, z] = spot(i + 600, HALF - 2);
        puddles.push(mat4(x, 0.045, z, -Math.PI / 2, 0, 0, 0.7 + rnd(i + 700) * 0.9, 0.5 + rnd(i + 800) * 0.6, 1));
      }
    }
    if (fire && h % 2 === 0) {
      for (let i = 0; i < 3; i++) {
        const [x, z] = spot(i + 900, HALF - 1.5);
        scorch.push(mat4(x, 0.05, z, -Math.PI / 2, 0, rnd(i + 950) * 6, 1 + rnd(i) * 1.2, 0.8 + rnd(i + 1) * 0.8, 1));
      }
    }
    // Toiles d'araignée dans les coins du fond
    if (r.type !== 'safe' && h % 3 !== 2) webs.push(mat4(cx - HALF + 1.3, 3.2, cz - HALF + 1.3, 0, Math.PI / 4, Math.PI, 2.4, 2.4, 1));
    if (r.type !== 'safe' && h % 4 === 1) webs.push(mat4(cx + HALF - 1.3, 3.2, cz - HALF + 1.3, 0, -Math.PI / 4, Math.PI / 2, 2.2, 2.2, 1));
  }
  const m = mats();
  if (bones.length) group.add(instanced(BONE_GEO, BONE, bones, true));
  if (skulls.length) group.add(instanced(SKULL_GEO, BONE, skulls, true));
  if (puddles.length) group.add(instanced(DISC_GEO, PUDDLE, puddles));
  if (scorch.length) group.add(instanced(DISC_GEO, SCORCH, scorch));
  if (rugsRed.length) group.add(instanced(PLANE_GEO, m.rugRed, rugsRed));
  if (rugsBlue.length) group.add(instanced(PLANE_GEO, m.rugBlue, rugsBlue));
  if (webs.length) {
    const w = instanced(PLANE_GEO, m.web, webs);
    w.userData.piece = 'web'; // arasée comme les murs dans la vue en coupe
    group.add(w);
  }
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

const STONE = new THREE.MeshStandardMaterial({ color: 0xb5afa4, roughness: 0.9 });
const DIRT = new THREE.MeshStandardMaterial({ color: 0x3a2d22, roughness: 1 });
const SLAB_GEO = new THREE.BoxGeometry(0.9, 1.0, 0.22);
const TOP_GEO = new THREE.CylinderGeometry(0.45, 0.45, 0.22, 16, 1, false, 0, Math.PI);
const MOUND_GEO = new THREE.SphereGeometry(0.75, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
/** Petite tombe là où un crawler est tombé. */
export function makeTomb(seed: number): THREE.Group {
  const g = new THREE.Group();
  const slab = new THREE.Mesh(SLAB_GEO, STONE);
  slab.position.y = 0.5;
  const top = new THREE.Mesh(TOP_GEO, STONE);
  top.rotation.x = Math.PI / 2;
  top.rotation.z = Math.PI / 2;
  top.position.y = 1.0;
  const mound = new THREE.Mesh(MOUND_GEO, DIRT);
  mound.scale.set(0.7, 0.2, 1.0);
  mound.position.z = 0.75;
  for (const m of [slab, top, mound]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  g.rotation.set(0, ((seed % 7) - 3) * 0.06, ((seed % 5) - 2) * 0.05);
  g.scale.setScalar(1.45);
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
