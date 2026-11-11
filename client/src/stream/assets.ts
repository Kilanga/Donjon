// Chargement des modèles : KayKit (CC0) pour le donjon, les aventuriers et les squelettes (animations partagées),
// Quaternius « Ultimate Monsters » (CC0) pour les monstres (chacun avec ses propres animations).
import * as THREE from 'three';
import { reportError } from '../telemetry';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const BASE = 'assets/3d/';

export const PIECES = [
  'floor_tile_large', 'floor_tile_large_rocks', 'floor_tile_big_spikes', 'floor_dirt_large', 'wall', 'wall_doorway', 'wall_cracked',
  'wall_arched', 'pillar', 'pillar_decorated', 'torch_mounted', 'barrel_large', 'barrel_small_stack', 'table_long_decorated_A', 'stool',
  'chest_gold', 'coin_stack_large', 'banner_patternA_red', 'banner_shield_blue', 'crates_stacked', 'keg_decorated', 'box_small_decorated',
  'stairs', 'candle_triple',
] as const;
export type PieceName = (typeof PIECES)[number];

export const CHARACTERS = ['chevalier', 'barbare', 'mage', 'voleur', 'sk_minion', 'sk_warrior', 'sk_mage', 'sk_rogue'] as const;
/** Monstres Quaternius (fichiers assets/3d/monstres/<nom>.glb), désignés « q_<nom> ». */
export const MONSTER_MODELS = ['gobelin', 'diablotin', 'demon', 'orque', 'orque_chef', 'slime', 'ogre', 'champignon', 'yeti', 'chaman', 'crapaud', 'golem', 'lezard', 'dragon'] as const;
export type CharName = (typeof CHARACTERS)[number] | `q_${(typeof MONSTER_MODELS)[number]}`;

/** Animations KayKit demandées par la scène -> équivalents possibles chez Quaternius (le premier trouvé gagne). */
const Q_ANIMS: Record<string, string[]> = {
  Idle: ['Idle', 'Flying_Idle'],
  Walking_A: ['Walk', 'Run', 'Fast_Flying'],
  attack: ['Weapon', 'Punch', 'Bite_Front', 'Headbutt'],
  Hit_A: ['HitReact', 'HitRecieve'],
  Dodge_Backward: ['Duck', 'Jump', 'HitReact', 'HitRecieve'],
  Death_A: ['Death'],
  Death_C_Skeletons: ['Death'],
  Spawn_Ground_Skeletons: ['Jump_Land', 'Jump', 'Yes'],
  Cheer: ['Yes', 'Wave', 'Dance'],
  Use_Item: ['Yes'],
  PickUp: ['Yes'],
};
const Q_HEIGHT = 2.4; // hauteur de référence d'un monstre Quaternius à l'échelle 1 (un squelette KayKit fait ~2,65)

/** Armes affichées par classe (les autres accessoires sont masqués). */
const KEEP_ACCESSORIES: Record<string, string[]> = {
  chevalier: ['1H_Sword', 'Round_Shield', 'Knight_Helmet'],
  barbare: ['1H_Axe', 'Mug'],
  mage: ['2H_Staff'],
  voleur: ['Knife'],
};
const ALL_ACCESSORIES = ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword', '1H_Axe_Offhand',
  'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug', 'Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'];

export class Assets {
  pieces = new Map<PieceName, THREE.Group>();
  chars = new Map<CharName, GLTF>();
  clips = new Map<string, THREE.AnimationClip>();
  private ownClips = new Map<string, Map<string, THREE.AnimationClip>>(); // monstres Quaternius
  private norm = new Map<string, number>(); // échelle qui ramène chaque monstre Quaternius à Q_HEIGHT
  private loader = new GLTFLoader();

  async load(onProgress?: (done: number, total: number) => void) {
    const total = PIECES.length + CHARACTERS.length + MONSTER_MODELS.length + 1;
    let done = 0;
    const tick = () => onProgress?.(++done, total);
    await Promise.all([
      ...PIECES.map(async (p) => {
        const g = await this.loader.loadAsync(BASE + p + '.glb');
        g.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        this.pieces.set(p, g.scene);
        tick();
      }),
      ...CHARACTERS.map(async (c) => {
        this.chars.set(c, await this.loader.loadAsync(BASE + c + '.glb'));
        tick();
      }),
      ...MONSTER_MODELS.map(async (n) => {
        try {
          const g = await this.loader.loadAsync(`${BASE}monstres/${n}.glb`);
          const key = `q_${n}` as CharName;
          this.chars.set(key, g);
          this.ownClips.set(key, new Map(g.animations.map((c) => [c.name, c])));
          this.norm.set(key, Q_HEIGHT / measureAnimated(g));
        } catch (e) {
          reportError(`missing 3D monster: ${n}`, String(e), 'assets'); // on retombera sur un squelette
        }
        tick();
      }),
      (async () => {
        const g = await this.loader.loadAsync(BASE + 'animations.glb');
        for (const clip of g.animations) this.clips.set(clip.name, clip);
        tick();
      })(),
    ]);
  }

  /** Copie indépendante d'une pièce de décor (pour les objets animés : coffre, piques). */
  piece(name: PieceName): THREE.Object3D {
    return this.pieces.get(name)!.clone(true);
  }

  has(name: CharName): boolean {
    return this.chars.has(name);
  }

  /** Clip d'animation pour un modèle : partagé (KayKit) ou propre au monstre (Quaternius, par équivalence). */
  clip(model: CharName, name: string): THREE.AnimationClip | undefined {
    const own = this.ownClips.get(model);
    if (!own) return this.clips.get(name);
    const key = /Attack|Spellcast/.test(name) ? 'attack' : name;
    for (const n of Q_ANIMS[key] ?? [name]) {
      const c = own.get(n);
      if (c) return c;
    }
    return own.get('Idle');
  }

  /** Copie animable d'un personnage, avec les bons accessoires et une teinte éventuelle. */
  character(name: CharName, tint?: number, emissive?: number): THREE.Object3D {
    const src = this.chars.get(name)!;
    const inner = cloneSkinned(src.scene);
    // Monstre Quaternius : on l'enveloppe pour normaliser sa taille sans gêner l'échelle donnée par la scène
    let root: THREE.Object3D = inner;
    const n = this.norm.get(name);
    if (n !== undefined) {
      inner.scale.setScalar(n);
      root = new THREE.Group();
      root.add(inner);
    }
    const keep = KEEP_ACCESSORIES[name];
    root.traverse((o) => {
      if (keep && ALL_ACCESSORIES.includes(o.name)) o.visible = keep.includes(o.name);
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false; // les maillages animés sortent de leur boîte englobante
        if (tint !== undefined || emissive !== undefined) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          if (tint !== undefined) mat.color.multiply(new THREE.Color(tint));
          if (emissive !== undefined) {
            mat.emissive = new THREE.Color(emissive);
            mat.emissiveIntensity = 0.35;
          }
          m.material = mat;
        }
      }
    });
    return root;
  }
}

/** Hauteur réelle d'un modèle animé, mesurée dans sa pose de repos (os appliqués), pas dans la pose de liaison. */
function measureAnimated(g: GLTF): number {
  const probe = cloneSkinned(g.scene);
  const idle = g.animations.find((a) => /idle/i.test(a.name)) ?? g.animations[0];
  if (idle) {
    const mx = new THREE.AnimationMixer(probe);
    mx.clipAction(idle).play();
    mx.update(0.2);
  }
  probe.updateMatrixWorld(true);
  const box = new THREE.Box3();
  probe.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh) {
      sm.skeleton.update();
      sm.computeBoundingBox();
      box.union(sm.boundingBox!.clone().applyMatrix4(sm.matrixWorld));
    } else if ((o as THREE.Mesh).isMesh) box.expandByObject(o);
  });
  const h = box.getSize(new THREE.Vector3()).y;
  return h > 0.05 && Number.isFinite(h) ? h : Q_HEIGHT;
}

/**
 * Regroupe toutes les copies d'une même pièce de décor en InstancedMesh : un étage de 60 salles
 * reste à quelques dizaines d'appels de dessin.
 */
const SKIP_MESHES = new Set(['wall_doorway_door']); // porte retirée : passage ouvert

export class InstancedBuilder {
  private items = new Map<PieceName, THREE.Matrix4[]>();
  constructor(private assets: Assets) {}

  add(name: PieceName, x: number, y: number, z: number, rotY = 0, scale: [number, number, number] = [1, 1, 1], rotX = 0, rotZ = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')), new THREE.Vector3(...scale));
    const list = this.items.get(name) ?? [];
    list.push(m);
    this.items.set(name, list);
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    for (const [name, mats] of this.items) {
      const src = this.assets.pieces.get(name);
      if (!src) {
        console.warn('Missing set piece:', name);
        reportError(`missing 3D set piece: ${name}`, undefined, 'assets');
        continue;
      }
      src.updateMatrixWorld(true);
      src.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || SKIP_MESHES.has(mesh.name)) return;
        const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats.length);
        const local = mesh.matrixWorld;
        mats.forEach((m, i) => inst.setMatrixAt(i, m.clone().multiply(local)));
        inst.instanceMatrix.needsUpdate = true;
        inst.castShadow = true;
        inst.receiveShadow = true;
        inst.computeBoundingSphere();
        inst.userData.piece = name;
        group.add(inst);
      });
    }
    return group;
  }
}
