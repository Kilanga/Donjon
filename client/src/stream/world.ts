// L'étage en 3D : décor, personnages animés, effets et caméra réalisateur.
import * as THREE from 'three';
import type { Dir, FloorView, ForecastRoom, GameEvent, MonsterView, PlayerPublic, RoomView } from '../../../src/shared/types';
import { Assets, InstancedBuilder, type CharName, type PieceName } from './assets';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildDressing, buildForgeShop, buildSafeRoom, smokeSprite, rng, type ForgeSpots, CLASS_COLOR, makeBeam, makeHalo, makeMotes, makeTomb, moodFor, roomColor, type Mood } from './dressing';

/** Pièces de décor coupées quand elles sont entre la caméra et la salle filmée (vue en coupe). */
const CUT_PIECES = new Set<string>(['wall', 'wall_doorway', 'wall_cracked', 'wall_arched', 'pillar', 'pillar_decorated', 'torch_mounted', 'banner_patternA_red', 'banner_shield_blue']);
const CUT = { uCutZ: { value: 1e9 }, uCutY: { value: 0.75 } };
function patchCut(m: THREE.Material) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCutZ = CUT.uCutZ;
    sh.uniforms.uCutY = CUT.uCutY;
    sh.vertexShader = 'varying vec3 vCutW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 cutW = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        cutW = instanceMatrix * cutW;
      #endif
      vCutW = (modelMatrix * cutW).xyz;`);
    sh.fragmentShader = 'uniform float uCutZ;\nuniform float uCutY;\nvarying vec3 vCutW;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (vCutW.z > uCutZ && vCutW.y > uCutY) discard;');
  };
  m.customProgramCacheKey = () => 'cut';
  return m;
}
const cutMats = new Map<THREE.Material, THREE.Material>();
const cutMaterial = (m: THREE.Material) => {
  let c = cutMats.get(m);
  if (!c) cutMats.set(m, (c = patchCut(m.clone())));
  return c;
};
const CUT_DEPTH = patchCut(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));

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
// Le trou de l'escalier : partagé (reconstruit à chaque état, il ne faut pas recréer de géométrie GPU à chaque fois)
const HOLE_GEO = new THREE.BoxGeometry(3.6, 0.3, 3.6);
const HOLE_DARK = new THREE.MeshStandardMaterial({ color: 0x050308 });
const HOLE_LIT = new THREE.MeshStandardMaterial({ color: 0x050308, emissive: 0xffb030, emissiveIntensity: 0.6 });

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
  yeti: { model: 'q_yeti', scale: 1.15, repli: { model: 'sk_warrior', scale: 1.2, tint: 0xd0e8ff } },
  chaman: { model: 'q_chaman', scale: 0.95, repli: { model: 'sk_mage', scale: 1, tint: 0xb0e080 } },
  marais: { model: 'q_crapaud', scale: 1.0, tint: 0x9ac070, repli: { model: 'sk_minion', scale: 1.1, tint: 0x80b060 } },
  golem: { model: 'q_golem', scale: 0.95, tint: 0xd8b088, repli: { model: 'sk_warrior', scale: 1.3, tint: 0x9a7a50 } },
  lezard: { model: 'q_lezard', scale: 1.05, repli: { model: 'sk_rogue', scale: 1.05, tint: 0x80d090 } },
  yeti_ancien: { model: 'q_yeti', scale: 1.6, tint: 0xd8ecff, repli: { model: 'sk_warrior', scale: 1.8, tint: 0xd0e8ff } },
  dragon: { model: 'q_dragon', scale: 1.5, emissive: 0x301000, repli: { model: 'sk_rogue', scale: 1.8, tint: 0xff8040, emissive: 0x401000 } },
  crapaud_roi: { model: 'q_crapaud', scale: 1.6, tint: 0xc0e090, repli: { model: 'sk_minion', scale: 1.8, tint: 0x90c070 } },
  gargouille: { model: 'q_golem', scale: 1.0, tint: 0x9098a8, repli: { model: 'sk_warrior', scale: 1.3, tint: 0x8890a0 } },
  chevalier_noir: { model: 'sk_warrior', scale: 1.2, tint: 0x505068, emissive: 0x100020 },
  wyrm: { model: 'q_dragon', scale: 0.95, tint: 0xb090ff, repli: { model: 'sk_rogue', scale: 1.1, tint: 0xa080ff } },
  liche: { model: 'sk_mage', scale: 1.8, tint: 0xc0b0ff, emissive: 0x200040 },
  dragon_ancien: { model: 'q_dragon', scale: 1.9, tint: 0x8a3030, emissive: 0x400000, repli: { model: 'sk_rogue', scale: 2, tint: 0xff4040, emissive: 0x400000 } },
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
  slow: boolean; // marche tranquille (flânerie, déplacement libre) plutôt que trajet de salle en salle
  wanderAt: number; // prochaine flânerie d'un monstre (ms)
  freePos: THREE.Vector3 | null; // position libre d'un joueur dans sa salle (ZQSD / clic sur sa page)
  freeUntil: number;
  hp: number;
  maxHp: number;
  boss: boolean;
  player: boolean;
  label: HTMLDivElement;
  bubble: { text: string; until: number } | null;
  dyingUntil: number; // garde l'entité affichée le temps de l'animation de mort
  gone?: boolean; // n'existe plus côté serveur : à retirer dès la fin de l'animation
  lastHtml?: string; // dernière étiquette écrite (évite de réécrire le DOM à chaque image)
  busyUntil: number; // animation ponctuelle en cours
  color: string;
  bot: boolean;
  ring: THREE.Mesh | null; // anneau de classe au sol
  ringKey?: string;
  badge: { text: string; until: number } | null; // « Arme +2 » au-dessus de la tête, le temps d'un tour
}

interface Flame {
  sprite: THREE.Sprite;
  pos: THREE.Vector3;
  seed: number;
  weight: number; // part de lumière (les flammes du foyer, serrées, n'éclairent pas chacune comme une torche)
}

interface Keeper {
  obj: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  model: CharName;
  current: THREE.AnimationAction | null;
  busyUntil: number;
}

interface ForgeFx {
  roomId: number;
  spots: ForgeSpots;
  smith: Keeper | null;
  nextEmber: number;
  nextStrike: number; // le forgeron travaille aussi quand personne ne lui demande rien
  nextSteam: number;
  smoke: { s: THREE.Sprite; t: number; life: number }[];
}

export class World {
  /** ?leger dans l'adresse du stream : pas de halo lumineux (bloom), si le PC peine. */
  static light = false;
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
  /** Son d'un effet : `vol` baisse avec la distance au centre de l'image (0 = hors champ). */
  onSound?: (kind: string, vol: number) => void;
  private hemi: THREE.HemisphereLight;
  private mood: Mood = moodFor('classique');
  private moodLights: THREE.PointLight[] = []; // lumière colorée des salles spéciales proches
  private wide = true; // plan large : pas de coupe des murs
  private beam: THREE.Mesh | null = null; // rayon au-dessus de l'escalier ouvert
  private collapseAt: number | null = null;
  private tombs: { obj: THREE.Object3D; label: HTMLDivElement | null }[] = [];
  private motes: THREE.Points;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private nextDebris = 0;
  private keepers: Keeper[] = []; // le marchand derrière son comptoir, le forgeron à son enclume
  private forges: ForgeFx[] = [];
  private turnEnd = 0; // fin du tour en cours de l'étage affiché
  private turnLen = 20_000; // durée d'un tour de cet étage (mesurée)

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

    this.scene.background = new THREE.Color(0x15110e);
    this.scene.fog = new THREE.Fog(0x15110e, 70, 220);
    this.hemi = new THREE.HemisphereLight(this.mood.sky, this.mood.ground, this.mood.ambient);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xaab8d8, 0.7);
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
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 20, 1.4);
      this.moodLights.push(l);
      this.scene.add(l);
    }
    this.flash = new THREE.PointLight(0xffd070, 0, 20, 1.5);
    this.scene.add(this.flash, this.dynamic);
    this.motes = makeMotes();
    this.scene.add(this.motes);
    // Halo lumineux sur les flammes, l'or, les emblèmes : seul ce qui est très lumineux « bave »
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(800, 450), 0.55, 0.45, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.flameTex = glow([[0, 'rgba(255,248,210,1)'], [0.25, 'rgba(255,170,60,.95)'], [0.6, 'rgba(255,80,10,.35)'], [1, 'rgba(255,40,0,0)']]);
    this.sparkTex = glow([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']]);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(Math.round(w / 2), Math.round(h / 2));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- décor

  setFloor(f: FloorView) {
    const changed = !this.floor || this.floor.n !== f.n || this.floor.uid !== f.uid || this.floor.rooms.length !== f.rooms.length;
    this.floor = f;
    this.collapseAt = f.collapseInSec === null ? null : performance.now() + f.collapseInSec * 1000;
    if (changed) {
      this.applyMood(f.theme);
      for (const t of this.tombs) {
        this.scene.remove(t.obj);
        t.label?.remove();
      }
      this.tombs = [];
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
      this.static.traverse((o) => {
        (o as THREE.InstancedMesh).dispose?.();
        if (o.userData.disposeMaterial) ((o as THREE.Mesh).material as THREE.Material).dispose();
      });
    }
    for (const fl of this.flames) this.scene.remove(fl.sprite);
    this.flames = [];
    for (const fx of this.forges) for (const sm of fx.smoke) this.scene.remove(sm.s);
    const forges: ForgeFx[] = [];
    const keepers: { pos: THREE.Vector3; model: CharName; tint?: number; forge?: ForgeFx }[] = [];
    const extra = new THREE.Group(); // pièces faites à la main (étagères, fioles, plantes…)
    const b = new InstancedBuilder(this.assets);
    const byPos = new Map(f.rooms.map((r) => [`${r.x},${r.y}`, r]));
    for (const r of f.rooms) {
      const c = center(r);
      const h = hash(r.id + 1);
      const rand = rng(hash(r.id * 31337 + f.n * 7));
      const jit = (a: number) => (rand() - 0.5) * 2 * a;
      // Sol
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        if (r.type === 'piege' && i === 0 && j === 0) continue;
        if (r.type === 'boss' && i === 0 && j === -1) continue;
        b.add(r.type !== 'safe' && hash(r.id * 9 + i * 3 + j) % 5 === 0 ? 'floor_tile_large_rocks' : 'floor_tile_large', c.x + i * 4, 0, c.z + j * 4); // dalles propres chez le marchand
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
        if (r.type === 'safe' && !r.forge && tx === 4) continue; // le comptoir est là
        b.add('torch_mounted', c.x + tx, 2.4, c.z - HALF + 0.5);
        this.addFlame(new THREE.Vector3(c.x + tx, 3.2, c.z - HALF + 0.9));
      }
      // Décor selon le type
      const corner = (dx: number, dz: number) => [c.x + dx, c.z + dz] as const;
      switch (r.type) {
        case 'safe': {
          if (r.forge) {
            // La forge : foyer, soufflet, charbon, enclume, bac de trempe, râtelier ; tonneau d'eau et caisses de minerai
            if (r.doors.n === undefined) b.add('banner_patternA_red', c.x + 1.4, 0, c.z - HALF);
            b.add('barrel_large', c.x + 4.6, 0, c.z + 2.8, 0.4, [0.75, 0.75, 0.75]);
            b.add('crates_stacked', c.x - 4.4, 0, c.z + 4.2, 0.6, [0.8, 0.8, 0.8]);
            const spots = buildForgeShop(extra, c.x, c.z, r.doors);
            for (const dx of [-0.75, 0, 0.75]) this.addFlame(spots.hearth.clone().add(new THREE.Vector3(dx, 0.25, 0.1)), 0.34, 0.75);
            forges.push({ roomId: r.id, spots, smith: null, nextEmber: 0, nextStrike: performance.now() + 4000 + Math.random() * 4000, nextSteam: 0, smoke: [] });
            keepers.push({ pos: spots.smith, model: 'barbare', forge: forges[forges.length - 1] });
            break;
          }
          // La boutique du marchand : tout est rangé. Deux bannières qui encadrent la porte du fond,
          // le comptoir le long du mur nord, deux tabourets alignés devant, des bougies aux bouts.
          b.add('banner_shield_blue', c.x - 2, 0, c.z - HALF);
          b.add('banner_shield_blue', c.x + 2, 0, c.z - HALF);
          b.add('table_long_decorated_A', c.x + 2.8, 0, c.z - 3.6, Math.PI / 2);
          b.add('stool', c.x + 1.9, 0, c.z - 1.9);
          b.add('stool', c.x + 3.7, 0, c.z - 1.9);
          b.add('candle_triple', c.x + 0.4, 0, c.z - 4.6);
          b.add('candle_triple', c.x + 5.1, 0, c.z - 2.3);
          if (r.doors.o === undefined) b.add('keg_decorated', c.x - HALF + 1.3, 0, c.z + 1.6, Math.PI / 2, [0.7, 0.7, 0.7]);
          else b.add('keg_decorated', c.x - 3.6, 0, c.z + HALF - 1.3, 0, [0.7, 0.7, 0.7]);
          keepers.push({ pos: buildSafeRoom(extra, c.x, c.z, r.doors), model: 'mage', tint: 0xe8c070 });
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
        case 'tresor': {
          const n = 2 + Math.floor(rand() * 3);
          for (let i = 0; i < n; i++) {
            const s = 0.35 + rand() * 0.45;
            b.add('coin_stack_large', c.x + jit(4.3), 0, c.z - 1.5 + jit(3.2), rand() * 6, [s, s, s]);
          }
          break;
        }
        default: {
          // Bric-à-brac le long des murs : nombre, place, angle au hasard ; parfois un tonneau renversé
          const props: PieceName[] = ['barrel_large', 'barrel_small_stack', 'crates_stacked', 'box_small_decorated', 'barrel_large', 'box_small_decorated'];
          const n = Math.floor(rand() * 4);
          for (let i = 0; i < n; i++) {
            const name = props[Math.floor(rand() * props.length)];
            const side = Math.floor(rand() * 4);
            const t = jit(HALF - 1.6);
            const d = HALF - 1.1 - rand() * 0.8;
            const [x, z] = side === 0 ? [c.x + t, c.z - d] : side === 1 ? [c.x - d, c.z + t] : side === 2 ? [c.x + d, c.z + t] : [c.x + t, c.z + d];
            const s = 0.65 + rand() * 0.3;
            const tipped = name === 'barrel_large' && rand() < 0.35;
            b.add(name, x, tipped ? 0.55 * s : 0, z, rand() * 6, [s, s, s], tipped ? Math.PI / 2 : 0);
          }
        }
      }
    }
    this.static = b.build();
    buildDressing(f, this.static);
    extra.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = cutMaterial(m.material as THREE.Material); // arasées aussi dans la vue en coupe
      m.customDepthMaterial = CUT_DEPTH;
    });
    this.static.add(extra);
    this.placeKeepers(keepers);
    this.forges = forges;
    for (const fx of forges) {
      for (let i = 0; i < 6; i++) {
        const sp = smokeSprite();
        sp.position.copy(fx.spots.chimney);
        this.scene.add(sp);
        fx.smoke.push({ s: sp, t: (i / 6) * 4, life: 4 });
      }
    }
    // Vue en coupe : murs, piliers, torches et bannières entre la caméra et la salle filmée sont arasés
    this.static.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if (!m.isMesh || !CUT_PIECES.has(m.userData.piece)) return;
      m.material = Array.isArray(m.material) ? m.material.map(cutMaterial) : cutMaterial(m.material);
      m.customDepthMaterial = CUT_DEPTH;
    });
    this.scene.add(this.static);
    // Socle sombre sous l'étage
    const xs = f.rooms.map((r) => r.x);
    const ys = f.rooms.map((r) => r.y);
    const w = (Math.max(...xs) - Math.min(...xs) + 1) * CELL + 8;
    const d = (Math.max(...ys) - Math.min(...ys) + 1) * CELL + 8;
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), new THREE.MeshStandardMaterial({ color: 0x1d1713, roughness: 1 }));
    base.userData.disposeMaterial = true;
    base.position.set(((Math.min(...xs) + Math.max(...xs)) / 2) * CELL, -1.6, ((Math.min(...ys) + Math.max(...ys)) / 2) * CELL);
    base.receiveShadow = true;
    this.static.add(base);
  }

  /** Les PNJ du décor : le marchand derrière son comptoir (mage en robe dorée), le forgeron à son enclume. */
  private placeKeepers(spots: { pos: THREE.Vector3; model: CharName; tint?: number; forge?: ForgeFx }[]) {
    for (const k of this.keepers) {
      this.scene.remove(k.obj);
      k.mixer.stopAllAction();
      k.obj.traverse((o) => (o as THREE.SkinnedMesh).skeleton?.dispose());
    }
    this.keepers = [];
    for (const sp of spots) {
      const obj = this.assets.character(sp.model, sp.tint);
      obj.position.copy(sp.pos);
      this.scene.add(obj);
      const k: Keeper = { obj, mixer: new THREE.AnimationMixer(obj), model: sp.model, current: null, busyUntil: 0 };
      this.keeperPlay(k, 'Idle');
      k.mixer.update(Math.random() * 2);
      this.keepers.push(k);
      if (sp.forge) sp.forge.smith = k;
    }
  }

  private keeperPlay(k: Keeper, name: string, once = false) {
    const clip = this.assets.clip(k.model, name);
    if (!clip) return;
    const a = k.mixer.clipAction(clip);
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    if (k.current && k.current !== a) k.current.fadeOut(0.15);
    a.fadeIn(0.15).play();
    k.current = a;
    if (once) k.busyUntil = performance.now() + clip.duration * 1000 - 120;
  }

  /** Un coup de marteau : le forgeron frappe, l'enclume crache des étincelles. `big` : une vraie commande !forge. */
  private strike(fx: ForgeFx, big: boolean, delay = 0) {
    setTimeout(() => {
      if (fx.smith) this.keeperPlay(fx.smith, '2H_Melee_Attack_Chop', true);
      setTimeout(() => {
        this.burst(fx.spots.anvil.clone(), 0xffc860, big ? 45 : 14, big ? 4.5 : 2.6, 10);
        if (big) this.flashAt(fx.spots.anvil.clone().sub(new THREE.Vector3(0, 2, 0)), 0xff9a40);
      }, 380);
    }, delay);
  }

  /** Vie de la forge : escarbilles, fumée sous le manteau, vapeur du bac, coups de marteau de temps en temps. */
  private forgeLife(dt: number, now: number) {
    for (const fx of this.forges) {
      const near = fx.spots.anvil.distanceToSquared(this.camLook) < 34 * 34;
      if (near && now > fx.nextEmber) {
        fx.nextEmber = now + 180 + Math.random() * 260;
        this.burst(fx.spots.hearth.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.8, 0.2, (Math.random() - 0.5) * 0.6)), 0xff7a20, 2, 1.1, -2.2);
      }
      if (near && now > fx.nextStrike) {
        fx.nextStrike = now + 6000 + Math.random() * 7000;
        this.strike(fx, false);
      }
      if (near && now > fx.nextSteam && Math.random() < 0.01) {
        fx.nextSteam = now + 5000;
        this.burst(fx.spots.tub.clone(), 0xd8e0e8, 12, 0.7, -1.4);
      }
      for (const sm of fx.smoke) {
        sm.t += dt;
        if (sm.t > sm.life) sm.t -= sm.life;
        const k = sm.t / sm.life;
        sm.s.position.set(fx.spots.chimney.x + Math.sin(sm.t * 1.3 + k * 4) * 0.4 * k, fx.spots.chimney.y + k * 3.2, fx.spots.chimney.z + k * 0.3);
        const sc = 0.8 + k * 2.2;
        sm.s.scale.set(sc, sc, 1);
        (sm.s.material as THREE.SpriteMaterial).opacity = Math.sin(k * Math.PI) * 0.45;
        sm.s.visible = sm.s.position.z <= CUT.uCutZ.value;
      }
    }
    for (const k of this.keepers) {
      k.mixer.update(dt);
      if (k.busyUntil && now > k.busyUntil) {
        k.busyUntil = 0;
        this.keeperPlay(k, 'Idle');
      }
    }
  }

  /** Fin du tour de l'étage affiché, telle que l'annonce le serveur : sert à mesurer la durée d'un tour. */
  noteTurnEnd(at: number) {
    if (!at || at === this.turnEnd) return;
    if (this.turnEnd && at - this.turnEnd > 3000) this.turnLen = at - this.turnEnd;
    this.turnEnd = at;
  }

  private addFlame(pos: THREE.Vector3, weight = 1, size = 1) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flameTex, color: 0xffb070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sprite.position.copy(pos);
    sprite.scale.set(0.9 * size, 1.25 * size, 1);
    sprite.userData.size = size;
    this.scene.add(sprite);
    this.flames.push({ sprite, pos, seed: Math.random() * 100, weight });
  }

  /** Objets qui changent : coffres, piques, loot au sol, escalier. */
  private buildDynamic(f: FloorView) {
    this.dynamic.clear();
    this.beam = null;
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
        // ouvert seulement si le boss est mort ET que le scellé est levé
        const open = !r.bossAlive && f.stairsInSec === 0;
        const hole = new THREE.Mesh(HOLE_GEO, open ? HOLE_LIT : HOLE_DARK);
        hole.position.set(c.x, -0.1, c.z - 4);
        this.dynamic.add(hole);
        if (open) {
          this.beam = makeBeam();
          this.beam.position.x = c.x;
          this.beam.position.z = c.z - 4;
          this.dynamic.add(this.beam);
        }
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
      if (seen.has(key)) {
        e.gone = false;
        continue;
      }
      if (e.dyingUntil > now) {
        e.gone = true; // retiré à la fin de son animation de mort (voir render)
        continue;
      }
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
        slow: false, wanderAt: performance.now() + 1500 + Math.random() * 4000, freePos: null, freeUntil: 0,
        hp: 0, maxHp: 1, boss: !!m?.boss, player: !!p, label, bubble: null, dyingUntil: 0, busyUntil: 0, color: '#fff',
        bot: !!p?.bot, ring: null, badge: null,
      };
      this.ents.set(key, e);
      this.play(e, 'Idle');
      if (!snap && m) this.play(e, 'Spawn_Ground_Skeletons', true);
    } else if (e.roomId !== r.id) {
      const from = this.floor?.rooms.find((x) => x.id === e!.roomId);
      e.path = from ? this.route(from, r, target) : [target];
      e.slow = false;
      e.freePos = null;
      if (!from) e.obj.position.copy(target);
      e.roomId = r.id;
    } else if (!e.path.length) {
      // Même salle : un joueur garde sa position libre ; un monstre peut flâner autour de sa place
      const anchor = e.freePos && e.freeUntil > performance.now() ? e.freePos : target;
      const leash = e.player ? 0.3 : 2.8;
      if (e.obj.position.distanceTo(anchor) > leash) {
        e.path = [anchor.clone()];
        e.slow = !e.player;
      }
    }
    e.hp = p ? p.hp : m!.hp;
    e.maxHp = p ? p.maxHp : m!.maxHp;
    e.color = p ? (p.traitor ? '#ff4d8d' : p.immune ? '#8cd0ff' : p.bot ? '#a9b8cc' : '#ffffff') : m!.boss ? '#ffcf4a' : '#ffb0b0';
    e.name = name + (p?.traitor ? ' ☠' : '');
    // Anneau au sol : couleur de la classe (rose pour un traître), net pour un vrai joueur ; rouge sous un boss
    const ringKey = p ? `${p.cls}:${!!p.bot}:${p.traitor}` : m?.boss ? 'boss' : '';
    if (ringKey !== e.ringKey) {
      if (e.ring) e.obj.remove(e.ring);
      e.ring = null;
      e.ringKey = ringKey;
      if (p) e.ring = makeHalo(p.traitor ? 0xf25c9a : CLASS_COLOR[p.cls] ?? 0xffffff, !p.bot);
      else if (m?.boss) e.ring = makeHalo(0xe5484d, true, 1.6 / Math.max(0.5, e.obj.scale.x));
      if (e.ring) e.obj.add(e.ring);
    }
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

  /** Un monstre au repos fait quelques pas dans sa salle, pour que la scène vive entre deux tours. */
  private wander(e: Ent, now: number) {
    e.wanderAt = now + 2500 + Math.random() * 5000;
    const room = this.floor?.rooms.find((r) => r.id === e.roomId);
    if (!room || Math.random() < 0.3) return; // parfois, il reste planté là
    const c = center(room);
    const busy = (room.players ?? []).length > 0; // devant des joueurs, il bouge moins
    const radius = e.boss ? 0.9 : busy ? 1.2 : 2.2;
    const a = Math.random() * Math.PI * 2;
    const lim = HALF - 1.3;
    const x = Math.max(c.x - lim, Math.min(c.x + lim, e.obj.position.x + Math.cos(a) * radius));
    const z = Math.max(c.z - lim, Math.min(c.z + lim, e.obj.position.z + Math.sin(a) * radius));
    e.path = [new THREE.Vector3(x, 0, z)];
    e.slow = true;
  }

  /** Position libre d'un joueur (ZQSD / clic sur sa page, ou PNJ qui s'agite), 0..1 dans sa salle. */
  setPos(name: string, floor: number, roomId: number, nx: number, ny: number) {
    if (!this.floor || this.floor.n !== floor) return;
    const e = this.ents.get(`p:${name}`);
    const room = this.floor.rooms.find((r) => r.id === roomId);
    if (!e || !room || e.roomId !== roomId || e.dyingUntil > performance.now()) return;
    const c = center(room);
    const lim = HALF - 1.2;
    const cl = (v: number) => Math.max(0, Math.min(1, v));
    const pt = new THREE.Vector3(c.x + (cl(nx) - 0.5) * 2 * lim, 0, c.z + (cl(ny) - 0.5) * 2 * lim);
    e.freePos = pt;
    e.freeUntil = performance.now() + 120_000;
    e.path = [pt.clone()];
    e.slow = true;
  }

  private removeEnt(e: Ent) {
    this.scene.remove(e.obj);
    e.mixer.stopAllAction();
    e.mixer.uncacheRoot(e.obj);
    e.obj.traverse((o) => {
      const sk = (o as THREE.SkinnedMesh).skeleton;
      if (sk) sk.dispose(); // texture des os, propre à chaque clone
    });
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
      if ((e.fx.kind === 'death' || e.fx.kind === 'kill') && e.fx.dst) {
        const t = this.ents.get(e.fx.dst);
        if (t) {
          t.dyingUntil = performance.now() + d + 2600;
          t.path = [];
        }
      }
      setTimeout(() => this.playFx(e), d);
      delay += e.fx.kind === 'death' || e.fx.kind === 'crit' ? 700 : 320;
    }
  }

  private playFx(ev: GameEvent) {
    const fx = ev.fx!;
    const src = fx.src ? this.ents.get(fx.src) : undefined;
    const dst = fx.dst ? this.ents.get(fx.dst) : undefined;
    const now = performance.now();
    const at = (dst ?? src)?.obj.position;
    if (at && this.onSound) {
      // on n'entend que ce qui se passe à l'image (ou juste à côté), plus fort au centre
      const d = Math.hypot(at.x - this.camLook.x, at.z - this.camLook.z);
      const reach = this.wide ? 60 : 22;
      if (d < reach) this.onSound(fx.kind, Math.max(0.25, 1 - d / reach));
    }
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
        if (dst && dst.player) {
          const at = dst.obj.position.clone();
          const who = dst.name.replace(' ☠', '');
          const human = !dst.bot;
          setTimeout(() => this.addTomb(at, who, human), 2300);
        }
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
      case 'forge': {
        // Le forgeron frappe trois fois ; au-dessus du joueur, ce qu'il vient d'améliorer, pendant un tour
        const room = src ? src.roomId : null;
        const fx2 = this.forges.find((x) => x.roomId === room) ?? this.forges[0];
        if (fx2) for (let i = 0; i < 3; i++) this.strike(fx2, true, i * 650);
        if (src) {
          setTimeout(() => this.play(src, 'Cheer', true), 1900);
          src.badge = { text: fx.label ?? 'Gear upgraded', until: now + Math.max(4000, this.turnLen - 400) };
        }
        break;
      }
      case 'trap':
        if (dst) {
          this.play(dst, 'Hit_A', true);
          this.burst(dst.obj.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 0xffffff, 30, 4);
          this.shake = 0.35;
        }
        break;
    }
  }

  /** Une tombe là où un crawler est tombé ; elle reste jusqu'à la fin de l'étage. */
  private addTomb(at: THREE.Vector3, name: string, human: boolean) {
    const t = makeTomb(at.x * 7 + at.z * 13);
    t.position.set(at.x, 0, at.z - 0.4);
    this.scene.add(t);
    let label: HTMLDivElement | null = null;
    if (human) {
      label = document.createElement('div');
      label.className = 'tomb3d';
      label.textContent = name;
      this.labels.appendChild(label);
    }
    this.tombs.push({ obj: t, label });
    while (this.tombs.length > 30) {
      const old = this.tombs.shift()!;
      this.scene.remove(old.obj);
      old.label?.remove();
    }
  }

  private applyMood(theme: string) {
    const m = (this.mood = moodFor(theme));
    this.hemi.color.setHex(m.sky);
    this.hemi.groundColor.setHex(m.ground);
    this.hemi.intensity = m.ambient;
    (this.scene.background as THREE.Color).setHex(m.fog);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(m.fog);
    fog.near = m.fogNear;
    fog.far = m.fogFar;
    (this.motes.material as THREE.PointsMaterial).color.setHex(m.mote);
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

  /** Prévision du serveur (quelques secondes avant la fin du tour) : la caméra part vers la salle qui va s'animer,
   *  et y est quand le tour se résout. Les évènements réels prennent ensuite le relais. */
  onForecast(rooms: ForecastRoom[]) {
    if (!this.floor || this.followName) return;
    const mine = rooms.filter((r) => r.floor === this.floor!.n);
    if (!mine.length) return;
    for (const r of mine) this.addHeat(r.roomId, r.score * 1.5);
    // On autorise le changement de plan tout de suite, même si le plan actuel est récent
    const best = mine[0];
    if (best.roomId !== this.shot.roomId && best.score >= 12) this.shot.since = 0;
  }

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
        this.wide = false;
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
      this.onShot?.('Wide shot');
    }
    const room = this.shot.roomId !== null ? f.rooms.find((x) => x.id === this.shot.roomId) : undefined;
    this.wide = !room;
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
    for (const [key, e] of this.ents) {
      if (e.gone && e.dyingUntil < now) {
        this.removeEnt(e);
        this.ents.delete(key);
      }
    }
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
    CUT.uCutZ.value = this.wide ? 1e9 : this.camLook.z + 6.6;
    this.atmosphere(dt, now);
    this.sun.position.set(this.camLook.x - 14, 34, this.camLook.z + 18);
    this.sun.target.position.copy(this.camLook);
    this.flash.intensity *= Math.exp(-dt * 5);

    this.forgeLife(dt, now);
    // Personnages
    for (const e of this.ents.values()) {
      e.mixer.update(dt);
      if (e.path.length && e.dyingUntil < now) {
        const t = e.path[0];
        const d = t.clone().sub(e.obj.position);
        d.y = 0;
        const step = (e.slow ? 1.7 : 5) * dt;
        if (d.length() <= step) {
          e.obj.position.copy(t);
          e.path.shift();
          if (!e.path.length) {
            e.yaw = 0;
            e.slow = false;
          }
        } else {
          e.obj.position.addScaledVector(d.normalize(), step);
          e.yaw = Math.atan2(d.x, d.z);
        }
        if (now > e.busyUntil) this.play(e, 'Walking_A');
      } else if (now > e.busyUntil && e.dyingUntil < now) {
        this.play(e, 'Idle');
        if (!e.player && now > e.wanderAt) this.wander(e, now);
      }
      let df = e.yaw - e.obj.rotation.y;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      e.obj.rotation.y += df * Math.min(1, dt * 8);
    }

    // Torches : les lumières suivent la caméra (sauf les torches arasées par la vue en coupe)
    for (const fl of this.flames) fl.sprite.visible = fl.pos.z <= CUT.uCutZ.value;
    const ranked = this.flames
      .filter((f) => f.sprite.visible)
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
      l.intensity = 38 * fl.weight * (0.85 + 0.15 * n);
    });
    for (const fl of this.flames) {
      const n = Math.sin(now / 110 + fl.seed);
      const k = fl.sprite.userData.size ?? 1;
      fl.sprite.scale.set((0.85 + 0.08 * n) * k, (1.2 + 0.15 * n) * k, 1);
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

    if (World.light) this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);
    this.drawLabels(now);
  }

  /** Lumières des salles spéciales, poussière, rayon de l'escalier, et la dernière minute avant l'effondrement. */
  private atmosphere(dt: number, now: number) {
    const f = this.floor;
    if (!f) return;
    // Les 3 salles spéciales les plus proches du centre de l'image prennent leur couleur
    const near = f.rooms
      .map((r) => ({ r, col: roomColor(r), d: center(r).distanceToSquared(this.camLook) }))
      .filter((x) => x.col !== null && x.d < 40 * 40)
      .sort((a, b) => a.d - b.d);
    this.moodLights.forEach((l, i) => {
      const x = near[i];
      if (!x) {
        l.intensity = 0;
        return;
      }
      const c = center(x.r);
      l.color.setHex(x.col!);
      l.position.set(c.x, 4.5, c.z + 1);
      const pulse = x.r.type === 'boss' && x.r.bossAlive ? 0.85 + 0.15 * Math.sin(now / 300) : 1;
      l.intensity = (x.r.forge ? 22 : x.r.type === 'piege' ? 26 : 45) * pulse;
    });
    // Poussière : un nuage qui suit la caméra, chaque grain dérive doucement
    const arr = this.motes.geometry.attributes.position.array as Float32Array;
    const rise = this.mood.rise;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += Math.sin(now / 2300 + i) * 0.12 * dt;
      arr[i + 1] += (rise + Math.sin(now / 1700 + i * 0.7) * 0.08) * dt;
      if (arr[i + 1] > 7) arr[i + 1] = 0.2;
      if (arr[i + 1] < 0.1) arr[i + 1] = 6.8;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
    this.motes.position.set(this.camLook.x, 0, this.camLook.z);
    // Rayon de l'escalier ouvert
    if (this.beam) (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.42 + 0.14 * Math.sin(now / 420);
    // Dernière minute : la lumière rougit, le sol gronde, des gravats tombent
    const rem = this.collapseAt === null ? Infinity : (this.collapseAt - now) / 1000;
    if (rem > 0 && rem < 60) {
      const k = 1 - rem / 60;
      const red = new THREE.Color(this.mood.sky).lerp(new THREE.Color(0xff2a1a), 0.4 + 0.5 * k);
      this.hemi.color.copy(red);
      this.sun.color.setHex(0xaab8d8).lerp(new THREE.Color(0xff4a30), 0.5 + 0.4 * k);
      this.hemi.intensity = this.mood.ambient * (0.9 + 0.25 * Math.max(0, Math.sin(now / 180)) * k);
      if (Math.sin(now / 900) > 0.92) {
        if (this.shake < 0.1) this.onSound?.('rumble', 0.4 + 0.6 * k); // une fois par secousse
        this.shake = Math.max(this.shake, 0.12 + 0.35 * k);
      }
      if (now > this.nextDebris) {
        this.nextDebris = now + 600 - 450 * k;
        const at = this.camLook.clone().add(new THREE.Vector3((Math.random() - 0.5) * 14, 9 + Math.random() * 3, (Math.random() - 0.5) * 12));
        this.burst(at, 0x9a8f80, 14, 0.6, 9);
      }
    } else if (this.hemi.color.getHex() !== this.mood.sky) {
      this.hemi.color.setHex(this.mood.sky);
      this.hemi.intensity = this.mood.ambient;
      this.sun.color.setHex(0xaab8d8);
    }
    void dt;
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
      const badge = e.badge && e.badge.until > now ? `<div class="badge3d">${escapeHtml(e.badge.text)}</div>` : '';
      const html = `${bub}${badge}<div class="n" style="color:${e.color}">${escapeHtml(e.name)}</div><div class="hp"><i style="width:${pct}%;background:${hpColor}"></i></div>`;
      if (e.lastHtml !== html) {
        e.lastHtml = html;
        e.label.innerHTML = html;
      }
    }
    // Noms gravés sur les tombes des vrais joueurs (en plan rapproché seulement)
    for (const t of this.tombs) {
      if (!t.label) continue;
      v.copy(t.obj.position).add(new THREE.Vector3(0, 2.25, 0)).project(this.camera);
      const vis = close && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      t.label.style.display = vis ? 'block' : 'none';
      if (vis) t.label.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }
}

export function roomLabel(r: RoomView): string {
  if (r.forge) return 'Forge';
  return { normale: 'Room', safe: 'Safe room', piege: 'Trapped room', tresor: 'Treasure room', arene: 'Arena', boss: 'Boss room' }[r.type] + ` ${r.id}`;
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
