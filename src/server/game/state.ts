// État complet du jeu : des objets simples, sérialisables tels quels en JSON.
import type { ClassId, Dir, GameEvent, Item, RoomType, Stats } from '../../shared/types.js';
import type { ParsedCommand } from '../../shared/commands.js';

export interface Buffs {
  cloakTurns: number; // cape d'invisibilité : tours restants
  mirror: boolean; // +3 au prochain jet
  smoke: boolean; // fuite garantie au prochain déplacement
  coupon: boolean; // réapparition plus rapide
}

export interface PlayerState {
  key: string; // pseudo normalisé
  name: string; // pseudo affiché
  cls: ClassId;
  level: number;
  xp: number; // XP accumulée dans le niveau en cours
  hp: number;
  maxHp: number;
  stats: Stats;
  statPoints: number;
  gold: number;
  weapon: Item | null;
  armor: Item | null;
  items: Item[];
  floor: number;
  roomId: number;
  alive: boolean;
  respawnIn: number; // tours avant réapparition (si mort)
  deathTurn?: number; // tour de la mort (ce tour-là ne compte pas)
  immuneUntil: number; // horodatage ms : immunité JvJ
  allianceId: string | null;
  allyProposals: string[]; // clés des joueurs qui m'ont proposé une alliance
  traitorUntilTurn: number;
  pending: ParsedCommand | null;
  lastAction: ParsedCommand | null;
  stunned: boolean;
  buffs: Buffs;
  discovered: Record<number, number[]>; // étage -> salles explorées
  kills: number;
  deaths: number;
  betrayals: number;
  deepest: number; // étage le plus profond atteint
  joinedTurn: number;
  bot?: boolean; // PNJ figurant piloté par le serveur (remplacé par les vrais joueurs)
}

export interface MonsterState {
  id: string;
  kind: string;
  name: string;
  sprite: string;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  dmg: number;
  xp: number;
  gold: number;
  roomId: number;
  wanderer: boolean;
  boss: boolean;
  distracted: number; // tours de distraction (poulet)
  aggro: string | null; // dernier joueur qui l'a frappé
}

export interface RoomState {
  id: number;
  x: number;
  y: number;
  type: RoomType;
  doors: Partial<Record<Dir, number>>;
  desc: string;
  searchedBy: string | null;
  chest: 'aucun' | 'ferme' | 'ouvert';
  mimic: boolean;
  trapArmed: boolean;
  trapRevealed: boolean;
  merchant: Item[];
  stairs: boolean;
  ground: Item[];
  groundGold: number;
}

export interface FloorState {
  n: number;
  theme: string;
  rooms: RoomState[];
  monsters: MonsterState[];
  spawnRoom: number;
  bossRoom: number;
  startedAt: number | null; // arrivée du premier joueur (démarre le chrono)
  collapseAt: number | null;
  collapsed: boolean;
  warned5?: boolean;
  warned1?: boolean;
}

export interface VoteState {
  options: string[]; // clés d'événements de la production
  votes: Record<string, string>; // joueur -> clé votée
  endTurn: number;
}

export interface GameState {
  version: 1;
  turn: number;
  nextId: number;
  rng: number;
  floors: Record<number, FloorState>;
  players: Record<string, PlayerState>;
  alliances: Record<string, string[]>;
  events: GameEvent[];
  vote: VoteState | null;
  nextVoteTurn: number;
  happyHourUntil: number; // tour de fin de l'happy hour des marchands
  floodUntil: number; // tour de fin de l'inondation
  bounty: { target: string; gold: number; untilTurn: number } | null;
}

export function emptyState(seed: number): GameState {
  return {
    version: 1, turn: 0, nextId: 1, rng: seed >>> 0, floors: {}, players: {}, alliances: {}, events: [],
    vote: null, nextVoteTurn: 0, happyHourUntil: 0, floodUntil: 0, bounty: null,
  };
}

/** Complète une sauvegarde d'une version précédente avec les champs manquants. */
export function migrate(s: GameState): GameState {
  const base = emptyState(s.rng);
  for (const k of Object.keys(base) as (keyof GameState)[]) if (s[k] === undefined) (s as unknown as Record<string, unknown>)[k] = base[k];
  for (const p of Object.values(s.players)) {
    p.betrayals ??= 0;
    p.deepest ??= p.floor;
  }
  return s;
}
