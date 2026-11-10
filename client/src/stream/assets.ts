// Chargement des modèles KayKit (CC0) : pièces de donjon instanciées, personnages clonables, animations partagées.
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
export type CharName = (typeof CHARACTERS)[number];

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
  private loader = new GLTFLoader();

  async load(onProgress?: (done: number, total: number) => void) {
    const total = PIECES.length + CHARACTERS.length + 1;
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

  /** Copie animable d'un personnage, avec les bons accessoires et une teinte éventuelle. */
  character(name: CharName, tint?: number, emissive?: number): THREE.Object3D {
    const src = this.chars.get(name)!;
    const root = cloneSkinned(src.scene);
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

/**
 * Regroupe toutes les copies d'une même pièce de décor en InstancedMesh : un étage de 60 salles
 * reste à quelques dizaines d'appels de dessin.
 */
const SKIP_MESHES = new Set(['wall_doorway_door']); // porte retirée : passage ouvert

export class InstancedBuilder {
  private items = new Map<PieceName, THREE.Matrix4[]>();
  constructor(private assets: Assets) {}

  add(name: PieceName, x: number, y: number, z: number, rotY = 0, scale: [number, number, number] = [1, 1, 1]) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), new THREE.Vector3(...scale));
    const list = this.items.get(name) ?? [];
    list.push(m);
    this.items.set(name, list);
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    for (const [name, mats] of this.items) {
      const src = this.assets.pieces.get(name);
      if (!src) {
        console.warn('Pièce de décor manquante :', name);
        reportError(`pièce de décor 3D manquante : ${name}`, undefined, 'assets');
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
        group.add(inst);
      });
    }
    return group;
  }
}
