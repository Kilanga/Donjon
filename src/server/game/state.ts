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
  bot?: boolean; // PNJ figurant piloté par le serveur
  closer?: boolean; // PNJ « retardataire » : ne descend jamais, ferme chaque étage en tombant avec lui
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
  asleep?: boolean; // l'ogre endormi : n'attaque pas tant qu'on ne le réveille pas
  aggro: string | null; // dernier joueur qui l'a frappé
}

export type RoomFeature = 'autel' | 'fontaine' | 'puits' | 'prisonnier' | 'ogre';

export interface RoomState {
  id: number;
  feature?: RoomFeature; // salle spéciale (!search pour s'en servir)
  featureUsedBy?: string[]; // qui s'en est déjà servi (autel, fontaine) ; prisonnier : libéré dès la première entrée
  x: number;
  y: number;
  type: RoomType;
  doors: Partial<Record<Dir, number>>;
  desc: string;
  searchedBy: string | null;
  searchedTurn?: number; // tour de la fouille : la salle se remplit de nouveau 5 tours plus tard
  chest: 'aucun' | 'ferme' | 'ouvert';
  mimic: boolean;
  trapArmed: boolean;
  trapRevealed: boolean;
  trapSeen?: boolean; // quelqu'un a déjà vu (ou subi) le piège : la carte 2D peut l'afficher
  merchant: Item[];
  forge?: boolean; // la forge de l'étage (safe room du forgeron)
  stairs: boolean;
  ground: Item[];
  groundGold: number;
}

export interface FloorState {
  n: number;
  uid?: string; // identifiant de génération (change quand l'étage est recreusé)
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
  stairsOpened?: boolean;
  bossDownAt?: number; // boss vaincu : l'escalier se descelle peu après (au lieu d'attendre la fin de l'étage)
  respawns?: { turn: number; kind: string; roomId?: number }[]; // monstres tués, qui reviennent au tour indiqué // l'annonce « l'escalier se descelle » a été faite
  bossBackTurn?: number; // dernier étage : tour où le gardien de la sortie se relève
  cryptRoom?: number; // la crypte : les tombes des éliminés y attendent qu'un crawler les ressuscite
}

export interface VoteState {
  options: string[]; // clés d'événements de la production
  votes: Record<string, string>; // joueur -> clé votée
  endTurn: number;
}

/** Un vrai joueur éliminé : son perso est gardé tel quel, au cas où le chat le ressuscite. */
export interface Grave {
  no: number;
  key: string;
  name: string;
  snap: PlayerState;
  floor: number; // étage où il a été éliminé
  turn: number;
  cryptFloor?: number; // étage dont la crypte abrite sa tombe (!resurrect)
}

/** Points de faveur d'un viewer (avec ou sans perso). */
export interface Wallet {
  name: string;
  pts: number;
  seen: number; // dernier message dans le chat (ms) : les présents gagnent des points à chaque effondrement
  lastSponsor: number;
  won: number; // paris gagnés
  bets: number; // paris joués
  gain: number; // points gagnés aux paris (classement)
}

/** Pari éclair : oui / non, ouvert un court moment, tranché dans les minutes qui suivent. */
export interface FlashBet {
  id: number;
  kind: 'boss' | 'sortie';
  title: string;
  floor: number;
  monsterId?: string;
  closeAt: number; // fin des mises (ms)
  deadline: number; // pour « boss » : il doit tomber avant (ms)
  stakes: Record<string, { opt: 'oui' | 'non'; amount: number; name: string }>;
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
  champions: import('../../shared/types.js').Legend[]; // sortis vainqueurs pendant cette partie
  seasonOver: boolean; // le dernier étage s'est effondré : la saison est finie, la partie est figée
  joinsClosed?: boolean; // l'étage 1 s'est effondré : plus de nouveaux persos (PNJ compris), seulement des résurrections
  graveyard: Grave[]; // vrais joueurs éliminés (game over) : candidats au vote de résurrection
  graveNo: number; // dernier numéro attribué
  wallets: Record<string, Wallet>; // points de faveur des viewers (paris et sponsors)
  resurrection: { endTurn: number; floorTo: number; votes: Record<string, { no: number; voices: number }> } | null;
  flashBet: FlashBet | null; // pari éclair en cours (lancé par la production)
  nextFlashAt: number; // pas de nouveau pari éclair avant (ms)
  grandBet: { open: boolean; stakes: Record<string, { target: string; targetName: string; amount: number }> };
  lobbyUntil: number | null; // salon d'attente : fin des inscriptions (la partie repart alors à zéro pour tous)
  lobbyWarned?: boolean;
  seasonStart: number | null; // arrivée du premier vrai joueur : l'horloge de la saison (étage n tombe à seasonStart + n × floorMinutes)
  bounty: { target: string; gold: number; untilTurn: number } | null;
}

export function emptyState(seed: number): GameState {
  return {
    version: 1, turn: 0, nextId: 1, rng: seed >>> 0, floors: {}, players: {}, alliances: {}, events: [],
    vote: null, nextVoteTurn: 0, happyHourUntil: 0, floodUntil: 0, bounty: null, champions: [], seasonOver: false, seasonStart: null, lobbyUntil: null,
    graveyard: [], graveNo: 0, wallets: {}, resurrection: null, flashBet: null, nextFlashAt: 0, grandBet: { open: true, stakes: {} },
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
  for (const f of Object.values(s.floors)) f.uid ??= `f${f.n}-ancien`;
  return s;
}
