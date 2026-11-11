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
  plus?: number; // améliorations du forgeron (0 à 3)
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
  forge?: boolean; // la forge de l'étage (!forge arme / armure)
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
  stairsInSec?: number | null; // escalier scellé : secondes avant qu'il s'ouvre (0 = ouvert, null = saison pas commencée)
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
  title?: string; // vote spécial (résurrection)
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
  standby?: FloorView | null;
  lobbyInSec?: number | null;
  bet?: BetView | null; // pari éclair en cours
  grandBet?: { open: boolean; pot: number; top: { name: string; pot: number }[] } | null;
  bettors?: { name: string; gain: number; pts: number }[]; // meilleurs parieurs
  myFavor?: number; // mes points de faveur
  myGrave?: number | null; // éliminé : mon numéro au vote de résurrection // salon d'attente : secondes avant le coup d'envoi (null = pas de salon en cours) // stream : second étage gardé chargé (bascule instantanée)
  standbyTurnEndsAt?: number;
  merchant: MerchantOffer[] | null;
  forge?: ForgeOffer | null; // dans la forge : ce que le forgeron peut améliorer, et à quel prix
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
  publicUrl?: string; // adresse publique de la page joueur (tunnel), affichée sur le stream
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

export interface BetView {
  title: string;
  closesInSec: number; // 0 : mises fermées, résultat en attente
  oui: number; // total misé sur oui
  non: number;
  bettors: number;
  mine?: { opt: 'oui' | 'non'; amount: number } | null;
}

/** Offre du forgeron pour l'équipement du joueur (null : pas d'objet, ou déjà au maximum). */
export interface ForgeOffer {
  weapon: { name: string; plus: number; cost: number } | null;
  armor: { name: string; plus: number; cost: number } | null;
}

/** Prévision de la caméra : salle où l'action du tour va probablement se passer. */
export interface ForecastRoom {
  floor: number;
  roomId: number;
  score: number;
}

export interface FloorSummary {
  n: number;
  theme: string;
  humans: number; // vrais joueurs vivants
  bots: number; // PNJ figurants vivants
  collapseInSec: number | null;
  stairsInSec?: number | null;
}

export type ServerMsg =
  | PlayerViewMsg
  | { type: 'events'; events: GameEvent[] }
  | { type: 'feedback'; ok: boolean; text: string }
  | { type: 'link'; name: string; code: string } // pseudo d'un compte Twitch : écrire « !lien <code> » dans le chat pour le prendre
  | { type: 'linked'; name: string; token: string } // liaison réussie : jeton à garder
  | { type: 'forecast'; turn: number; rooms: ForecastRoom[] } // quelques secondes avant la fin du tour : où placer la caméra
  | { type: 'chat'; from: string; text: string; cmd?: boolean; floor?: number; roomId?: number; ok?: boolean; reply?: string; src?: 'web' | 'twitch' }
  | { type: 'pos'; name: string; floor: number; roomId: number; x: number; y: number }; // position libre d'un crawler dans sa salle

export type ClientMsg =
  | { type: 'hello'; name: string; spectatorKey?: string; token?: string } // token : jeton de liaison Twitch gardé par la page
  | { type: 'cmd'; text: string }
  | { type: 'say'; text: string } // message libre (bulle au-dessus du crawler)
  | { type: 'floor'; n: number; standby?: number } // spectateur : étage affiché (+ second étage gardé chargé, pour le stream)
  | { type: 'admin'; action: AdminAction; arg?: string | number }
  | { type: 'clientError'; message: string; stack?: string; where?: string; page?: string } // erreur JS de la page (journal)
  | { type: 'clientPerf'; fps: number; w: number; h: number; page?: string } // images/seconde (journal)
  | { type: 'pos'; x: number; y: number }; // déplacement libre dans la salle (0..1, purement visuel)

export type AdminAction = 'pause' | 'resume' | 'next' | 'vote' | 'event' | 'collapse' | 'turnSeconds' | 'reset' | 'healAll' | 'kick' | 'bots' | 'ai';
