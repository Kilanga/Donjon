// Décor des salles, tiré une seule fois et partagé : la carte 2D (page joueur) et le donjon 3D (stream)
// placent les mêmes objets aux mêmes endroits. Coordonnées relatives à l'intérieur de la salle :
// u de -1 (mur ouest) à 1 (mur est), v de -1 (mur nord) à 1 (mur sud).

export type PropKind = 'barrel' | 'barrel_stack' | 'crates' | 'box' | 'rug_red' | 'rug_blue' | 'bones' | 'rubble' | 'puddle' | 'scorch' | 'coins';

export interface Prop {
  kind: PropKind;
  u: number;
  v: number;
  rot: number; // radians
  s: number; // échelle
  w?: number; // tapis : largeur et longueur (en fraction de la salle)
  h?: number;
  tipped?: boolean; // tonneau renversé
  skull?: boolean; // tas d'os : avec un crâne
  n?: number; // nombre d'éléments (os, pierres, pièces)
  seed: number; // pour les détails propres à chaque vue (os épars, cailloux)
}

export interface DecorRoom {
  id: number;
  type: string;
  forge?: boolean;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
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
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
};

/** Le décor d'une salle (toujours le même pour une salle d'un étage donné). Les salles spéciales (safe room,
 *  forge, boss, arène) ont en plus leur mobilier propre, posé par chaque vue. */
export function roomDecor(floorN: number, r: DecorRoom, theme: string): Prop[] {
  const out: Prop[] = [];
  const rand = rng(hash(r.id * 7919 + floorN * 104729));
  const between = (a: number, b: number) => a + rand() * (b - a);
  const chance = (p: number) => rand() < p;
  const seed = () => Math.floor(rand() * 1e9);
  const inRoom = (margin = 0.2) => [between(-1 + margin, 1 - margin), between(-1 + margin, 1 - margin)] as const;
  // Un point le long d'un mur (là où les choses s'entassent)
  const alongWall = (): readonly [number, number] => {
    const side = Math.floor(rand() * 4);
    const t = between(-0.78, 0.78);
    const d = 1 - between(0.15, 0.27);
    return side === 0 ? [t, -d] : side === 1 ? [-d, t] : side === 2 ? [d, t] : [t, d];
  };
  if (r.type === 'safe') return out;
  const wet = theme === 'inondé';
  // Tapis : jamais centré ni droit, parfois deux qui se chevauchent
  // (une salle piégée tire exactement le même décor qu'une salle ordinaire : rien ne la trahit sur la carte)
  const plain = r.type === 'normale' || r.type === 'piege';
  if (plain && chance(0.22)) {
    const [u, v] = inRoom(0.37);
    out.push({ kind: chance(0.5) ? 'rug_red' : 'rug_blue', u, v, rot: between(-0.9, 0.9), s: 1, w: between(0.37, 0.53), h: between(0.53, 0.77), seed: seed() });
    if (chance(0.3)) out.push({ kind: 'rug_red', u: u + between(-0.23, 0.23), v: v + between(-0.2, 0.2), rot: between(-1.5, 1.5), s: 1, w: between(0.27, 0.4), h: between(0.37, 0.53), seed: seed() });
  }
  // Os : en tas (là où quelque chose s'est mal fini)
  if (plain || r.type === 'boss' || r.type === 'arene') {
    const piles = r.type === 'boss' ? 3 : chance(0.55) ? 1 + Math.floor(rand() * 2) : 0;
    for (let i = 0; i < piles; i++) {
      const [u, v] = chance(0.6) ? alongWall() : inRoom(0.3);
      out.push({ kind: 'bones', u, v, rot: 0, s: 1, n: 3 + Math.floor(rand() * 7), skull: chance(0.7), seed: seed() });
    }
  }
  // Éboulis contre les murs
  if (chance(0.6)) {
    const heaps = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < heaps; i++) {
      const [u, v] = alongWall();
      out.push({ kind: 'rubble', u, v, rot: 0, s: 1, n: 4 + Math.floor(rand() * 8), seed: seed() });
    }
  }
  // Flaques (pas sur un étage inondé : l'eau couvre déjà tout)
  if (!wet && chance(0.4)) {
    const [u, v] = inRoom(0.33);
    out.push({ kind: 'puddle', u, v, rot: 0, s: 1, n: 2 + Math.floor(rand() * 4), seed: seed() });
  }
  if (theme === 'en feu' && chance(0.6)) {
    const n = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const [u, v] = inRoom(0.25);
      out.push({ kind: 'scorch', u, v, rot: rand() * 6, s: between(0.6, 2), seed: seed() });
    }
  }
  if (r.type === 'tresor') {
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) out.push({ kind: 'coins', u: between(-0.72, 0.72), v: -0.25 + between(-0.53, 0.53), rot: rand() * 6, s: 0.35 + rand() * 0.45, seed: seed() });
  }
  // Bric-à-brac le long des murs : nombre, place, angle au hasard ; parfois un tonneau renversé
  if (plain) {
    const kinds: PropKind[] = ['barrel', 'barrel_stack', 'crates', 'box', 'barrel', 'box'];
    const n = Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const kind = kinds[Math.floor(rand() * kinds.length)];
      const [u, v] = alongWall();
      const s = 0.65 + rand() * 0.3;
      out.push({ kind, u, v, rot: rand() * 6, s, tipped: kind === 'barrel' && rand() < 0.35, seed: seed() });
    }
  }
  return out;
}

/** Places des tombes de la crypte (six au plus), en (u, v) : contre les murs, hors des portes et du milieu
 *  (là où se tiennent crawlers et monstres). Les mêmes pour la carte 2D et la 3D. */
export const CRYPT_SLOTS: readonly (readonly [number, number])[] = [
  [-0.75, -0.72], [0.75, -0.72], [-0.75, 0.48], [0.75, 0.48], [-0.42, -0.72], [0.42, -0.72],
];
