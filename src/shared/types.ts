// Types partagés entre le serveur et la page joueur.

export type ClassId = 'barbare' | 'chevalier' | 'voleur' | 'mage';
export type StatId = 'for' | 'agi' | 'int' | 'cha';
export type Stats = Record<StatId, number>;
export type Dir = 'n' | 's' | 'e' | 'o';
export type Rarity = 'commun' | 'rare' | 'epique' | 'legendaire';
export type ItemKind = 'arme' | 'armure' | 'conso' | 'bizarre';
export type RoomType = 'normale' | 'safe' | 'piege' | 'tresor' | 'arene' | 'boss';

export interface Item {
  id: string;
  tpl: string; // identifiant du modèle d'objet
  name: string;
  kind: ItemKind;
  rarity: Rarity;
  value: number; // prix d'achat en or
  dmg?: number; // arme : dé de dégâts (d4 = 4)
  hit?: number; // arme : bonus au jet
  def?: number; // armure : bonus de défense
  desc: string;
  sprite: string; // nom de sprite dans la planche 0x72
}

export interface MonsterView {
  id: string;
  name: string;
  kind: string;
  sprite: string;
  hp: number;
  maxHp: number;
  boss: boolean;
}

export interface PlayerPublic {
  name: string;
  cls: ClassId;
  level: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  immune: boolean;
  traitor: boolean;
  ally: boolean;
  me: boolean;
  bot?: boolean; // PNJ figurant
}

export interface RoomView {
  id: number;
  x: number;
  y: number;
  type: RoomType;
  doors: Partial<Record<Dir, number>>;
  current: boolean;
  stairs: boolean;
  bossAlive: boolean;
  chest: 'aucun' | 'ferme' | 'ouvert';
  searched: boolean;
  trapArmed: boolean;
  merchant: boolean;
  desc?: string; // description (salle courante)
  // Occupants : seulement pour la salle courante et celles des alliés
  players?: PlayerPublic[];
  monsters?: MonsterView[];
  ground?: Item[];
  groundGold?: number;
}

export interface MerchantOffer {
  index: number;
  item: Item;
  price: number;
}

export interface MeView {
  name: string;
  cls: ClassId;
  level: number;
  xp: number;
  xpNext: number;
  hp: number;
  maxHp: number;
  stats: Stats;
  statPoints: number;
  gold: number;
  weapon: Item | null;
  armor: Item | null;
  items: Item[];
  alive: boolean;
  respawnInTurns: number;
  immuneSeconds: number;
  traitorTurns: number;
  alliance: string[];
  pendingAllianceFrom: string[];
  floor: number;
  roomId: number;
  pending: string | null;
  kills: number;
  deaths: number;
}

export interface FloorView {
  n: number;
  uid?: string; // change quand l'étage est recreusé
  theme: string;
  collapseInSec: number | null;
  rooms: RoomView[];
}

export interface GameEvent {
  id: number;
  turn: number;
  floor: number;
  roomId?: number;
  kind: 'info' | 'combat' | 'mort' | 'loot' | 'trahison' | 'alliance' | 'niveau' | 'systeme' | 'piege' | 'drole';
  text: string;
  scope: 'salle' | 'etage' | 'global' | 'prive';
  to?: string; // joueur destinataire pour 'prive'
  actors?: string[]; // joueurs concernés (alliés de ces joueurs voient aussi l'évènement)
  drama: number; // score de drame (pour le futur réalisateur)
  narrator?: boolean; // commentaire généré par l'IA du donjon
  npc?: 'marchand'; // réplique d'un PNJ (bulle au-dessus de lui)
  victory?: Legend; // un crawler sort du donjon par le dernier escalier
  seasonEnd?: boolean; // le dernier étage s'effondre : fin de la saison
  // Effet visuel/sonore : entités 'p:<nom affiché>' ou 'm:<id monstre>'
  fx?: GameFx;
}

export interface GameFx {
  kind: 'hit' | 'miss' | 'crit' | 'gag' | 'death' | 'kill' | 'loot' | 'levelup' | 'trap' | 'heal';
  src?: string;
  dst?: string;
}

export interface LeaderRow {
  name: string;
  cls: ClassId;
  level: number;
  floor: number;
  deepest: number;
  kills: number;
  deaths: number;
  betrayals: number;
  gold: number;
  alive: boolean;
  traitor: boolean;
  bounty: boolean;
  bot?: boolean;
}

export interface VoteOption {
  n: number;
  key: string;
  label: string;
  desc: string;
  votes: number;
}

export interface VoteView {
  options: VoteOption[];
  turnsLeft: number;
  myVote: string | null;
}

export interface EffectsView {
  happyHourTurns: number;
  floodTurns: number;
  bounty: { target: string; gold: number; turns: number } | null;
  nextVoteInTurns: number | null;
}

export interface PlayerViewMsg {
  type: 'state';
  turn: number;
  turnEndsAt: number;
  turnSeconds: number;
  serverNow: number;
  me: MeView | null;
  floor: FloorView | null;
  merchant: MerchantOffer[] | null;
  spectator: boolean;
  online: number;
  paused: boolean;
  admin: boolean;
  leaderboard: LeaderRow[];
  vote: VoteView | null;
  effects: EffectsView;
  obituary: { turn: number; text: string }[];
  floors?: FloorSummary[]; // étages debout et qui y est (vue stream, régie)
  seasonOver?: boolean; // saison terminée (effondrement du dernier étage)
  champions?: Legend[]; // vainqueurs de cette saison (vue stream)
}

/** Un crawler sorti vivant par l'escalier du dernier étage. */
export interface Legend {
  name: string;
  cls: ClassId;
  level: number;
  kills: number;
  deaths: number;
  betrayals: number;
  gold: number;
  bot: boolean;
  date: string; // ISO
  turn: number;
  floor: number; // dernier étage
}

export interface FloorSummary {
  n: number;
  theme: string;
  humans: number; // vrais joueurs vivants
  bots: number; // PNJ figurants vivants
  collapseInSec: number | null;
}

export type ServerMsg =
  | PlayerViewMsg
  | { type: 'events'; events: GameEvent[] }
  | { type: 'feedback'; ok: boolean; text: string }
  | { type: 'chat'; from: string; text: string; cmd?: boolean; floor?: number; roomId?: number; ok?: boolean; reply?: string; src?: 'web' | 'twitch' }
  | { type: 'pos'; name: string; floor: number; roomId: number; x: number; y: number }; // position libre d'un crawler dans sa salle

export type ClientMsg =
  | { type: 'hello'; name: string; spectatorKey?: string }
  | { type: 'cmd'; text: string }
  | { type: 'say'; text: string } // message libre (bulle au-dessus du crawler)
  | { type: 'floor'; n: number } // spectateur : changer d'étage affiché
  | { type: 'admin'; action: AdminAction; arg?: string | number }
  | { type: 'clientError'; message: string; stack?: string; where?: string; page?: string } // erreur JS de la page (journal)
  | { type: 'clientPerf'; fps: number; w: number; h: number; page?: string } // images/seconde (journal)
  | { type: 'pos'; x: number; y: number }; // déplacement libre dans la salle (0..1, purement visuel)

export type AdminAction = 'pause' | 'resume' | 'next' | 'vote' | 'event' | 'collapse' | 'turnSeconds' | 'reset' | 'healAll' | 'kick' | 'bots' | 'ai';
