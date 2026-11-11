// Le moteur de jeu : reçoit les commandes, résout les tours, produit les évènements.
import { HELP_TEXT, normalize, parseCommand, suggestCommand, type ParsedCommand } from '../../shared/commands.js';
import type {
  ClassId, Dir, EffectsView, FloorSummary, ForecastRoom, ForgeOffer, Legend, FloorView, GameEvent, GameFx, Item, LeaderRow, MeView, MerchantOffer, MonsterView, PlayerPublic, RoomView, StatId, VoteView,
} from '../../shared/types.js';
import type { GameConfig } from '../config.js';
import {
  CLASSES, CRIT_TEXTS, DEATH_TEXTS, FIASCO_TEXTS, GAG_TEXTS, RARITY_LABEL, SEARCH_FAIL_TEXTS, STAT_LABELS, TRAP_TEXTS,
} from './data.js';
import { DIR_LABEL, generateFloor, spawnMimic, spawnMonster } from './dungeon.js';
import { BOSSES, FORGE_LINES, FORGE_MAX, MERCHANT_RESPAWN, MERCHANT_TIPS, MERCHANT_WELCOME, MONSTERS } from './data.js';
import { THEME_EFFECTS } from '../../shared/themes.js';
import { PRODUCTION_BY_KEY, PRODUCTION_EVENTS } from './production.js';
import { itemEffect, makeItem, randomLoot } from './items.js';
import { Rng } from './rng.js';
import { emptyState, migrate, type FlashBet, type FloorState, type GameState, type Grave, type MonsterState, type PlayerState, type RoomState, type Wallet } from './state.js';

export const INVENTORY_MAX = 8;
export const ALLIANCE_MAX = 4;
export const xpNext = (level: number) => 50 * level;
const half = (n: number) => Math.floor(n / 2);

type Fighter = { kind: 'player'; p: PlayerState } | { kind: 'monster'; m: MonsterState };

export interface SubmitResult {
  ok: boolean;
  text: string;
}

/** « 7 min 30 s », « 45 s » */
function fmtWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m} min${s % 60 ? ` ${s % 60} s` : ''}` : `${s} s`;
}

export class Game {
  state: GameState;
  cfg: GameConfig;
  rng: Rng;
  private out: GameEvent[] = [];
  private now = 0;

  constructor(cfg: GameConfig, state?: GameState) {
    this.cfg = cfg;
    this.state = state ? migrate(state) : emptyState(cfg.seed ?? Date.now());
    this.rng = new Rng(this.state.rng);
    if (this.state.seasonStart === null) {
      const timed = Object.values(this.state.floors).filter((f) => f.collapseAt !== null);
      if (timed.length) this.state.seasonStart = Math.min(...timed.map((f) => f.collapseAt! - (f.n + (cfg.firstFloorFactor ?? 1) - 1) * cfg.floorMinutes * 60_000));
    }
  }

  /** Nouvelle partie : efface tout et recrée l'étage 1. */
  reset() {
    const keepId = this.state.nextId; // les identifiants d'évènements restent uniques pour les pages ouvertes
    this.state = emptyState(Date.now());
    this.state.nextId = keepId;
    this.rng = new Rng(this.state.rng);
    this.ensureFloor(1);
    this.emit({ floor: 1, kind: 'systeme', text: 'NOUVELLE SAISON ! Le donjon a été entièrement recreusé. Tapez !join pour entrer.', scope: 'global', drama: 50 });
    this.sync();
  }

  // ---------------------------------------------------------------- outils

  private nextId = () => `x${this.state.nextId++}`;

  private emit(e: Omit<GameEvent, 'id' | 'turn'>) {
    const ev: GameEvent = { id: this.state.nextId++, turn: this.state.turn, ...e };
    this.out.push(ev);
    this.state.events.push(ev);
    if (this.state.events.length > 400) this.state.events.splice(0, this.state.events.length - 400);
  }

  private say(p: PlayerState, text: string, kind: GameEvent['kind'] = 'info') {
    this.emit({ floor: p.floor, roomId: p.roomId, kind, text, scope: 'prive', to: p.key, drama: 0 });
  }

  /** Réplique du marchand (IA ou écrite), pour toute la salle. */
  merchantReply(floor: number, roomId: number, line: string): GameEvent {
    this.out = [];
    this.emit({ floor, roomId, kind: 'info', text: line.startsWith('Le marchand') ? line : `Le marchand : « ${line} »`, scope: 'salle', drama: 0, npc: 'marchand' });
    this.sync();
    return this.out[0];
  }

  /** Réplique du marchand de la safe room : à un joueur (privé) ou à toute la salle. */
  private merchantSays(floor: number, roomId: number, line: string, to?: string) {
    this.emit({ floor, roomId, kind: 'info', text: `Le marchand : « ${line} »`, scope: to ? 'prive' : 'salle', ...(to ? { to } : {}), drama: 0, npc: 'marchand' });
  }

  private roomEvent(p: PlayerState | null, floor: number, roomId: number, kind: GameEvent['kind'], text: string, drama = 0, actors: string[] = [], fx?: GameFx) {
    this.emit({ floor, roomId, kind, text, scope: 'salle', actors: p ? [p.key, ...actors] : actors, drama, ...(fx ? { fx } : {}) });
  }

  private sync() {
    this.state.rng = this.rng.state;
  }

  floor(n: number): FloorState | undefined {
    return this.state.floors[n];
  }

  room(p: PlayerState): RoomState {
    return this.state.floors[p.floor].rooms[p.roomId];
  }

  player(name: string): PlayerState | undefined {
    return this.state.players[playerKey(name)];
  }

  private isImmune(p: PlayerState) {
    return this.now < p.immuneUntil;
  }

  private alliesOf(p: PlayerState): string[] {
    return p.allianceId ? (this.state.alliances[p.allianceId] ?? []).filter((k) => k !== p.key) : [];
  }

  private isAlly(a: PlayerState, b: PlayerState) {
    return !!a.allianceId && a.allianceId === b.allianceId;
  }

  private playersIn(floor: number, roomId: number, aliveOnly = true): PlayerState[] {
    return Object.values(this.state.players).filter((p) => p.floor === floor && p.roomId === roomId && (!aliveOnly || p.alive));
  }

  /** Pas d'embuscade à 4 monstres dans les premiers étages : 2 max aux étages 1-2, 3 ensuite. */
  private maxMonstersPerRoom(floor: number): number {
    return floor <= 2 ? 2 : 3;
  }

  private monstersIn(floor: number, roomId: number): MonsterState[] {
    return (this.state.floors[floor]?.monsters ?? []).filter((m) => m.roomId === roomId && m.hp > 0);
  }

  private discover(p: PlayerState) {
    const list = (p.discovered[p.floor] ??= []);
    if (!list.includes(p.roomId)) list.push(p.roomId);
  }

  /** Crée l'étage s'il n'existe pas encore. */
  ensureFloor(n: number): FloorState {
    let f = this.state.floors[n];
    if (!f) {
      const players = Object.keys(this.state.players).length;
      const rooms = Math.max(this.cfg.minRooms, this.cfg.roomsPerPlayer * players);
      f = generateFloor(n, rooms, this.rng, this.nextId);
      this.state.floors[n] = f;
      const effect = (n >= this.cfg.finalFloor ? 'DERNIER ÉTAGE : battez le boss et prenez la sortie pour entrer dans la Légende. Son effondrement termine la saison ! ' : '') + (THEME_EFFECTS[f.theme] ?? '');
      this.emit({ floor: n, kind: 'systeme', text: `L'étage ${n} vient d'être creusé (${f.rooms.length} salles, thème : ${f.theme}).${effect ? ` ${effect}` : ''}`, scope: 'global', drama: effect ? 15 : 5 });
    }
    return f;
  }

  /** Arme le chrono d'un étage. La saison démarre à l'arrivée du premier vrai joueur (les PNJ figurants ne la lancent pas) ;
   *  ensuite l'étage n tombe à heure fixe, seasonStart + n × floorMinutes, quel que soit le rythme des joueurs
   *  (un étage recreusé pour les retardataires garde au moins floorMinutes de vie). */
  private startTimer(f: FloorState, p?: PlayerState) {
    if (this.state.seasonStart === null) {
      if (p?.bot) return; // les PNJ ne lancent rien
      if (this.cfg.lobbySeconds > 0) {
        if (this.state.lobbyUntil === null) this.openLobby(); // premier vrai joueur : on ouvre les inscriptions
        return;
      }
      this.state.seasonStart = this.now;
    }
    if (f.startedAt === null) {
      f.startedAt = this.now;
      f.collapseAt = Math.max(this.waveEnd(f.n), this.now + this.floorSpan(f.n));
    }
  }

  /** Durée de vie d'un étage (l'étage 1 dure plus longtemps : le temps que tout le monde arrive). */
  floorSpan(n: number): number {
    return this.cfg.floorMinutes * 60_000 * (n === 1 ? this.cfg.firstFloorFactor : 1);
  }

  /** Effondrement de l'étage n pour la vague principale : heure fixe depuis le début de la saison. */
  waveEnd(n: number): number {
    return (this.state.seasonStart ?? this.now) + this.cfg.floorMinutes * 60_000 * (n + this.cfg.firstFloorFactor - 1);
  }

  // ----------------------------------------------------------- salon d'attente

  private openLobby() {
    this.state.lobbyUntil = this.now + this.cfg.lobbySeconds * 1000;
    this.state.lobbyWarned = false;
    this.emit({ floor: 1, kind: 'systeme', scope: 'global', drama: 70, text: `INSCRIPTIONS OUVERTES ! La partie commence dans ${fmtWait(this.cfg.lobbySeconds * 1000)} : tapez !join pour en être. En attendant, échauffement avec les PNJ (tout repart à zéro au coup d'envoi).` });
  }

  /** Fin des inscriptions : donjon neuf, tout le monde (PNJ compris) repart niveau 1 à l'entrée, et l'horloge démarre. */
  private launchSeason() {
    const roster = Object.values(this.state.players)
      .sort((a, b) => Number(!!a.bot) - Number(!!b.bot))
      .map((p) => ({ name: p.name, cls: p.cls, bot: !!p.bot, closer: !!p.closer }));
    const keep = { nextId: this.state.nextId, turn: this.state.turn, events: this.state.events, wallets: this.state.wallets, grandBet: this.state.grandBet };
    this.state = emptyState(this.rng.int(1, 2 ** 31));
    Object.assign(this.state, keep);
    this.rng = new Rng(this.state.rng);
    this.state.seasonStart = this.now;
    const before = this.out.length;
    for (const r of roster) {
      this.join(r.name, r.cls, r.bot);
      const p = this.state.players[playerKey(r.name)];
      if (p && r.closer) p.closer = true;
    }
    this.out.splice(before); // pas de « X entre dans le donjon » × 15
    const humans = roster.filter((r) => !r.bot).length;
    const f = this.floor(1)!;
    for (const r of roster) if (!r.bot) this.merchantSays(1, f.spawnRoom, MERCHANT_WELCOME, playerKey(r.name));
    this.emit({
      floor: 1, kind: 'systeme', scope: 'global', drama: 95,
      text: `LA PARTIE COMMENCE ! ${humans} aventurier${humans > 1 ? 's' : ''} et ${roster.length - humans} PNJ entrent dans un donjon tout neuf, niveau 1 pour tout le monde. L'étage 1 s'effondre dans ${Math.round(this.floorSpan(1) / 60_000)} min.`,
    });
  }

  /** Tours décalés : un « tour du monde » (state.turn) dure turnSeconds / 2 ; chaque étage joue un tour sur deux,
   *  les impairs et les pairs en alternance. Les durées exprimées en tours (prime, inondation, retour du boss…)
   *  sont multipliées par `phases` pour garder le même temps réel. */
  get phases(): number {
    return this.cfg.staggered ? 2 : 1;
  }

  /** Cet étage joue-t-il au tour du monde indiqué (par défaut, le tour en cours) ? */
  plays(floorN: number, turn = this.state.turn): boolean {
    return !this.cfg.staggered || (floorN + turn) % 2 === 0;
  }

  /** L'escalier n'est descellé que pendant les dernières minutes de l'étage (et jamais avant le début de la saison). */
  stairsOpen(f: FloorState): boolean {
    return this.stairsInMs(f) === 0;
  }

  /** Temps avant que l'escalier se descelle (0 = ouvert, null = la saison n'a pas commencé). */
  stairsInMs(f: FloorState): number | null {
    if (f.collapseAt === null) return null;
    if (f.stairsOpened) return 0; // annoncé ouvert : il le reste (même si un vote rallonge l'étage)
    const open = this.cfg.stairsOpenMinutes * 60_000 * (f.n === 1 ? this.cfg.firstFloorFactor : 1); // l'étage 1, plus long, s'ouvre aussi plus longtemps
    return Math.max(0, f.collapseAt - open - this.now);
  }

  /** L'étage le moins profond encore debout : là où arrivent les nouveaux. */
  /** Les nouveaux entrent toujours à l'étage 1 (recreusé s'il s'est effondré) : le donjon est une tour sans fond. */
  private entryFloor(): FloorState {
    return this.freshFloor(1);
  }

  /** L'étage n, debout : recreusé à neuf (nouveau plan, nouveaux monstres) s'il s'était effondré. */
  freshFloor(n: number): FloorState {
    const old = this.state.floors[n];
    if (old && !old.collapsed) return old;
    if (old) {
      delete this.state.floors[n];
      for (const p of Object.values(this.state.players)) delete p.discovered[n];
    }
    const f = this.ensureFloor(n);
    if (old) this.emit({ floor: n, kind: 'systeme', text: `L'étage ${n} a été recreusé : nouveau plan, nouveaux monstres, de quoi accueillir les nouveaux aventuriers.`, scope: 'global', drama: 10 });
    return f;
  }

  // ------------------------------------------------------------- commandes

  submit(name: string, raw: string, now = Date.now()): SubmitResult {
    this.now = now;
    const cmd = parseCommand(raw);
    if (this.state.seasonOver && cmd?.name !== 'help') return { ok: false, text: 'La saison est terminée : merci d\'avoir joué ! Rendez-vous à la prochaine.' };
    if (!cmd) {
      const guess = suggestCommand(raw);
      return { ok: false, text: guess ? `Commande inconnue. Tu voulais dire ${guess} ?` : 'Commande inconnue. Tape !aide pour la liste.' };
    }
    const res = this.handle(name, cmd);
    this.sync();
    return res;
  }

  private handle(name: string, cmd: ParsedCommand): SubmitResult {
    if (cmd.name === 'help') return { ok: true, text: HELP_TEXT.join('\n') };
    // Ouvert à tout le chat, perso ou pas (les éliminés parient, sponsorisent et votent pour revenir)
    if (cmd.name === 'vote' && this.state.resurrection) return this.voteResurrection(name, cmd.arg);
    if (cmd.name === 'bet') return this.placeBet(name, cmd.arg);
    if (cmd.name === 'sponsor') return this.sponsor(name, cmd.arg);
    if (cmd.name === 'favor') return this.favorText(name);
    const p = this.player(name);
    if (cmd.name === 'join') return this.join(name, cmd.arg);
    if (!p) return { ok: false, text: 'Tu n\'es pas encore dans le donjon. Tape !join [barbare|chevalier|voleur|mage].' };

    switch (cmd.name) {
      case 'status':
        return { ok: true, text: this.statusText(p) };
      case 'shop':
        return this.shopText(p);
      case 'forge':
        if (!cmd.arg) return this.forgeText(p); // sans précision : les prix, tout de suite
        break;
      case 'levelup':
        return this.levelUp(p, cmd.arg);
      case 'ally':
        return this.ally(p, cmd.arg);
      case 'leave':
        return this.leaveAlliance(p, true);
      case 'vote':
        return this.castVote(p, cmd.arg);
      default:
        break;
    }
    if (!p.alive) return { ok: false, text: `Tu es mort. Réapparition dans ${p.respawnIn} tour(s). Patience, fantôme.` };
    p.pending = cmd;
    return { ok: true, text: `Action prévue pour la fin du tour : ${cmd.raw}` };
  }

  private join(name: string, arg: string, bot = false): SubmitResult {
    const key = playerKey(name);
    if (!key) return { ok: false, text: 'Pseudo invalide.' };
    if (this.state.seasonOver) return { ok: false, text: 'La saison est terminée : le Donjon est fermé. Rendez-vous à la prochaine !' };
    if (this.state.players[key]) return { ok: false, text: 'Tu es déjà dans le donjon !' };
    const cls = parseClass(arg) ?? this.rng.pick(Object.keys(CLASSES) as ClassId[]);
    const def = CLASSES[cls];
    const f = this.entryFloor();
    const p: PlayerState = {
      key, name: name.trim().slice(0, 24), cls, level: 1, xp: 0, hp: def.hp, maxHp: def.hp, stats: { ...def.stats }, statPoints: 0, gold: 10,
      weapon: makeItem(def.startWeapon, this.nextId), armor: def.startArmor ? makeItem(def.startArmor, this.nextId) : null,
      items: [makeItem('potion', this.nextId), makeItem('potion', this.nextId)], floor: f.n, roomId: f.spawnRoom, alive: true, respawnIn: 0,
      immuneUntil: this.now + this.cfg.immunitySeconds * 1000, allianceId: null, allyProposals: [], traitorUntilTurn: 0,
      pending: null, lastAction: null, stunned: false, buffs: { cloakTurns: 0, mirror: false, smoke: false, coupon: false },
      discovered: {}, kills: 0, deaths: 0, betrayals: 0, deepest: f.n, joinedTurn: this.state.turn, ...(bot ? { bot: true } : {}),
    };
    this.state.players[key] = p;
    this.startTimer(f, p); // (un PNJ figurant ne lance pas la saison, mais arme un étage recreusé une fois qu'elle a commencé)
    this.discover(p);
    this.emit({ floor: f.n, roomId: p.roomId, kind: 'systeme', text: `${p.name} le ${def.label} entre dans le donjon (étage ${f.n}) !`, scope: 'global', actors: [key], drama: 5 });
    this.merchantSays(f.n, p.roomId, MERCHANT_WELCOME, key);
    return { ok: true, text: `Bienvenue, ${def.label} ! Tu es dans la safe room de l'étage ${f.n}. Tu es immunisé contre les autres joueurs pendant ${Math.round(this.cfg.immunitySeconds / 60)} min.` };
  }

  private statusText(p: PlayerState): string {
    const c = CLASSES[p.cls];
    const st = (Object.keys(STAT_LABELS) as StatId[]).map((s) => `${s.toUpperCase()} ${fmt(p.stats[s])}`).join(' ');
    return `${p.name}, ${c.label} niv. ${p.level} — ${p.hp}/${p.maxHp} PV — ${st} — ${p.gold} po — XP ${p.xp}/${xpNext(p.level)}${p.statPoints ? ` — ${p.statPoints} point(s) à dépenser (!monte)` : ''}`;
  }

  private shopText(p: PlayerState): SubmitResult {
    if (this.room(p).forge) return this.forgeText(p);
    const r = this.room(p);
    if (r.type !== 'safe') return { ok: false, text: 'Il n\'y a pas de marchand ici. Cherche une safe room.' };
    if (!r.merchant.length) return { ok: true, text: 'Le marchand n\'a plus rien. Il te vend son regard, gratuitement.' };
    return { ok: true, text: 'Marchand : ' + r.merchant.map((it, i) => `${i + 1}. ${it.name} (${RARITY_LABEL[it.rarity]}) ${this.price(it)} po`).join(' | ') };
  }

  private levelUp(p: PlayerState, arg: string): SubmitResult {
    if (p.statPoints <= 0) return { ok: false, text: 'Aucun point de stat à dépenser. Monte de niveau d\'abord.' };
    const stat = parseStat(arg);
    if (!stat) return { ok: false, text: 'Précise la stat : !monte for, agi, int ou cha.' };
    p.stats[stat] += 1;
    p.statPoints -= 1;
    return { ok: true, text: `${STAT_LABELS[stat]} passe à ${fmt(p.stats[stat])}.` };
  }

  private ally(p: PlayerState, arg: string): SubmitResult {
    const t = this.findPlayerByName(arg);
    if (!t) return { ok: false, text: 'Joueur introuvable. Tape !alliance <pseudo>.' };
    if (t.key === p.key) return { ok: false, text: 'S\'allier avec soi-même : touchant, mais refusé.' };
    if (this.isAlly(p, t)) return { ok: false, text: `Tu es déjà allié avec ${t.name}.` };
    if (p.allyProposals.includes(t.key)) {
      const target = t.allianceId ? this.state.alliances[t.allianceId] : p.allianceId ? this.state.alliances[p.allianceId] : null;
      if (target && target.length >= ALLIANCE_MAX) {
        p.allyProposals = p.allyProposals.filter((k) => k !== t.key);
        return { ok: false, text: `Alliance complète (${ALLIANCE_MAX} maximum).` };
      }
      if (t.allianceId) {
        this.leaveAlliance(p, false);
        this.state.alliances[t.allianceId].push(p.key);
        p.allianceId = t.allianceId;
      } else if (p.allianceId) {
        this.state.alliances[p.allianceId].push(t.key);
        t.allianceId = p.allianceId;
      } else {
        const id = this.nextId();
        this.state.alliances[id] = [p.key, t.key];
        p.allianceId = t.allianceId = id;
      }
      p.allyProposals = p.allyProposals.filter((k) => k !== t.key);
      t.allyProposals = t.allyProposals.filter((k) => k !== p.key);
      const names = this.state.alliances[p.allianceId!].map((k) => this.state.players[k]?.name).join(', ');
      this.emit({ floor: p.floor, kind: 'alliance', text: `Alliance scellée : ${names}. Combien de temps avant la trahison ?`, scope: 'global', actors: [p.key, t.key], drama: 15 });
      this.sync();
      return { ok: true, text: `Tu es maintenant allié avec ${t.name}.` };
    }
    if (!t.allyProposals.includes(p.key)) t.allyProposals.push(p.key);
    this.say(t, `${p.name} te propose une alliance. Réponds !alliance ${p.name} pour accepter.`, 'alliance');
    return { ok: true, text: `Proposition envoyée à ${t.name}. Il doit répondre !alliance ${p.name}.` };
  }

  private leaveAlliance(p: PlayerState, announce: boolean): SubmitResult {
    if (!p.allianceId) return { ok: false, text: 'Tu n\'es dans aucune alliance.' };
    const id = p.allianceId;
    const members = (this.state.alliances[id] ?? []).filter((k) => k !== p.key);
    p.allianceId = null;
    if (members.length <= 1) {
      for (const k of members) if (this.state.players[k]) this.state.players[k].allianceId = null;
      delete this.state.alliances[id];
    } else this.state.alliances[id] = members;
    if (announce) this.emit({ floor: p.floor, kind: 'alliance', text: `${p.name} quitte son alliance.`, scope: 'global', actors: [p.key], drama: 5 });
    return { ok: true, text: 'Tu as quitté ton alliance.' };
  }

  private findPlayerByName(arg: string): PlayerState | undefined {
    const a = normalize(arg).replace(/^@/, '');
    if (!a) return undefined;
    const all = Object.values(this.state.players);
    return all.find((p) => p.key === playerKey(a)) ?? all.find((p) => normalize(p.name).startsWith(a));
  }

  // ------------------------------------------------------------------ tour

  tick(now = Date.now()): GameEvent[] {
    this.now = now;
    this.out = [];
    if (this.state.seasonOver) return []; // saison terminée : plus rien ne bouge
    // Salon d'attente : rappel à 1 min, puis coup d'envoi (avant de résoudre quoi que ce soit)
    if (this.state.lobbyUntil !== null && this.state.seasonStart === null) {
      const left = this.state.lobbyUntil - now;
      if (left <= 0) {
        this.launchSeason();
        this.state.turn++;
        this.sync();
        return this.out;
      }
      if (left <= 60_000 && this.cfg.lobbySeconds > 90 && !this.state.lobbyWarned) {
        this.state.lobbyWarned = true;
        this.emit({ floor: 1, kind: 'systeme', scope: 'global', drama: 50, text: 'Plus qu\'UNE MINUTE pour rejoindre la partie : !join ! Ensuite, tout repart à zéro et le donjon commence à s\'effondrer.' });
      }
    }
    this.state.turn++;
    // Tours décalés : seuls les crawlers des étages qui jouent ce tour-ci agissent (les autres gardent leur commande)
    const players = Object.values(this.state.players).filter((p) => this.plays(p.floor));

    // Actions de chaque joueur vivant (ou action par défaut s'il est inactif)
    const actions = new Map<string, ParsedCommand | null>();
    const idle = new Set<string>();
    for (const p of players) {
      if (!p.alive) continue;
      if (this.state.floors[p.floor]?.collapsed) continue;
      let a = p.pending;
      p.pending = null;
      if (p.stunned) {
        p.stunned = false;
        this.say(p, 'Tu es encore étourdi : tu perds ce tour.');
        actions.set(p.key, null);
        continue;
      }
      if (!a) {
        if (p.lastAction?.name === 'attack' && this.resolveTarget(p, p.lastAction.arg, true).target) a = p.lastAction;
        else {
          idle.add(p.key);
          if (p.lastAction?.name === 'attack') p.lastAction = null;
        }
      } else p.lastAction = a;
      actions.set(p.key, a);
    }

    // Ordre du tour : 0. potions et objets utilisés/équipés, 1. attaques, 2. ripostes,
    // 3. commerce/repos/ramassage, 4. fouilles, 5. déplacements. On boit avant les coups, mais on ne fuit pas avant.

    // 0. Objets utilisés ou équipés (potions, fumigène, cape…) : avant les coups
    for (const p of players) {
      const a = actions.get(p.key);
      if (!a || !p.alive) continue;
      if (a.name === 'use' || a.name === 'equip') this.doUse(p, a.arg, a.name === 'equip');
    }

    // 1. Combats : joueurs et monstres, par ordre d'initiative
    // Initiative = d20 + Agilité (joueur) ou d20 + attaque (monstre) ; égalité : la meilleure base, puis au hasard.
    const attackedBy = new Map<string, Fighter[]>();
    type Intent = { init: number; base: number; tie: number; attacker: Fighter; arg?: string };
    const intents: Intent[] = [];
    for (const p of players) {
      const a = actions.get(p.key);
      if (a?.name === 'attack' && p.alive) intents.push({ init: this.rng.die(20) + p.stats.agi, base: p.stats.agi, tie: this.rng.next(), attacker: { kind: 'player', p }, arg: a.arg });
    }
    for (const f of Object.values(this.state.floors)) {
      if (f.collapsed || !this.plays(f.n)) continue;
      for (const m of f.monsters) {
        if (m.hp <= 0) continue;
        const r = f.rooms[m.roomId];
        if (r.type === 'safe') continue;
        if (this.playersIn(f.n, m.roomId).length === 0) continue;
        intents.push({ init: this.rng.die(20) + m.atk, base: m.atk, tie: this.rng.next(), attacker: { kind: 'monster', m } });
      }
    }
    intents.sort((a, b) => b.init - a.init || b.base - a.base || a.tie - b.tie);
    for (const it of intents) {
      if (it.attacker.kind === 'player') {
        const p = it.attacker.p;
        if (!p.alive) continue;
        const { target, error } = this.resolveTarget(p, it.arg ?? '', false);
        if (!target) {
          if (error) this.say(p, error);
          continue;
        }
        this.attack(it.attacker, target, attackedBy);
      } else {
        const m = it.attacker.m;
        if (m.hp <= 0) continue;
        if (m.distracted > 0) continue;
        const floorN = this.floorOfMonster(m);
        const here = this.playersIn(floorN, m.roomId);
        if (!here.length) continue;
        const target = here.find((p) => p.key === m.aggro) ?? this.rng.pick(here);
        this.attack(it.attacker, { kind: 'player', p: target }, attackedBy);
      }
    }

    // 2. Ripostes des joueurs inactifs attaqués
    for (const p of players) {
      if (!idle.has(p.key) || !p.alive) continue;
      const attackers = attackedBy.get(p.key) ?? [];
      for (const att of attackers) {
        if (att.kind === 'monster' && att.m.hp > 0 && att.m.roomId === p.roomId) {
          this.roomEvent(p, p.floor, p.roomId, 'combat', `${p.name}, surpris, riposte !`);
          this.attack({ kind: 'player', p }, att, attackedBy);
          break;
        }
        if (att.kind === 'player' && att.p.alive && att.p.roomId === p.roomId && att.p.floor === p.floor && this.pvpAllowed(p, att.p) === null) {
          this.roomEvent(p, p.floor, p.roomId, 'combat', `${p.name} riposte contre ${att.p.name} !`, 5, [att.p.key]);
          this.attack({ kind: 'player', p }, att, attackedBy);
          break;
        }
      }
    }

    // 3. Commerce, repos, ramassage : après les coups (une victime ne ramasse rien en mourant)
    for (const p of players) {
      const a = actions.get(p.key);
      if (!a || !p.alive) continue;
      if (a.name === 'forge') this.doForge(p, a.arg);
      else if (a.name === 'buy') this.doBuy(p, a.arg);
      else if (a.name === 'sell') this.doSell(p, a.arg);
      else if (a.name === 'rest') this.doRest(p);
      else if (a.name === 'pickup') this.doPickup(p, a.arg);
    }

    // 4. Fouilles
    for (const p of players) {
      const a = actions.get(p.key);
      if (a?.name === 'search' && p.alive) this.doSearch(p);
    }

    // 5. Déplacements et descentes
    for (const p of players) {
      const a = actions.get(p.key);
      if (!a || !p.alive) continue;
      if (a.name === 'move') this.doMove(p, a.arg as Dir);
      else if (a.name === 'descend') this.doDescend(p);
    }

    // 6. Monstres errants
    for (const f of Object.values(this.state.floors)) {
      if (f.collapsed || !this.plays(f.n)) continue;
      for (const m of f.monsters) {
        if (m.distracted > 0) m.distracted--;
        if (!m.wanderer || m.hp <= 0 || this.playersIn(f.n, m.roomId).length) continue;
        if (!this.rng.chance(0.35)) continue;
        const cap = this.maxMonstersPerRoom(f.n);
        const exits = Object.values(f.rooms[m.roomId].doors).filter(
          (id) => id !== undefined && f.rooms[id!].type !== 'safe' && f.rooms[id!].type !== 'boss' && this.monstersIn(f.n, id!).length < cap,
        ) as number[];
        if (exits.length) m.roomId = this.rng.pick(exits);
      }
    }

    // 7. Fin de tour : effets, réapparitions, effondrements, votes
    this.endOfTurn(players);
    this.updateProduction();
    this.sync();
    return this.out;
  }

  private floorOfMonster(m: MonsterState): number {
    for (const f of Object.values(this.state.floors)) if (f.monsters.includes(m)) return f.n;
    return -1;
  }

  /** Trouve la cible d'une attaque dans la salle du joueur. */
  private resolveTarget(p: PlayerState, arg: string, silent: boolean): { target?: Fighter; error?: string } {
    const monsters = this.monstersIn(p.floor, p.roomId);
    const others = this.playersIn(p.floor, p.roomId).filter((o) => o.key !== p.key);
    const a = normalize(arg).replace(/^@/, '');
    if (!a) {
      if (monsters.length) {
        const aggro = monsters.find((m) => m.aggro === p.key);
        return { target: { kind: 'monster', m: aggro ?? monsters[0] } };
      }
      return { error: silent ? undefined : 'Attaquer qui ? Il n\'y a aucun monstre ici. Pour un joueur : !attaque <pseudo>.' };
    }
    if (/^\d+$/.test(a)) {
      const m = monsters[Number(a) - 1];
      return m ? { target: { kind: 'monster', m } } : { error: 'Pas de monstre à ce numéro.' };
    }
    const op = others.find((o) => o.key === playerKey(a)) ?? others.find((o) => normalize(o.name).startsWith(a));
    if (op) return { target: { kind: 'player', p: op } };
    const m = monsters.find((mm) => normalize(mm.name).includes(a) || normalize(mm.kind).includes(a));
    if (m) return { target: { kind: 'monster', m } };
    return { error: silent ? undefined : `Personne ne répond au nom de « ${arg} » dans cette salle.` };
  }

  /** Le combat joueur contre joueur est-il permis ? Renvoie un message d'erreur sinon. */
  private pvpAllowed(a: PlayerState, b: PlayerState): string | null {
    const r = this.room(a);
    if (r.type === 'safe') return 'Pas de combat dans une safe room. Le marchand y tient.';
    const left = (q: PlayerState) => Math.max(1, Math.ceil((q.immuneUntil - this.now) / 1000));
    if (this.isImmune(a)) return `Tu es encore immunisé ${left(a)} s : tu ne peux pas attaquer d'autres joueurs.`;
    if (this.isImmune(b)) return `${b.name} est immunisé encore ${left(b)} s (il vient d'arriver ou de réapparaître).`;
    return null;
  }

  private attack(att: Fighter, def: Fighter, attackedBy: Map<string, Fighter[]>) {
    const name = (f: Fighter) => (f.kind === 'player' ? f.p.name : f.m.name);
    const ek = (f: Fighter) => (f.kind === 'player' ? `p:${f.p.name}` : `m:${f.m.id}`);
    const ap = att.kind === 'player' ? att.p : null;
    const dp = def.kind === 'player' ? def.p : null;
    const floorN = ap ? ap.floor : dp!.floor;
    const roomId = ap ? ap.roomId : dp!.roomId;
    if (def.kind === 'player' && !def.p.alive) return;
    if (def.kind === 'monster' && def.m.hp <= 0) return;

    let treachery = false;
    if (ap && dp) {
      const err = this.pvpAllowed(ap, dp);
      if (err) {
        this.say(ap, err);
        return;
      }
      treachery = this.isAlly(ap, dp);
    }

    // Cape d'invisibilité
    if (dp && dp.buffs.cloakTurns > 0 && this.rng.chance(0.5)) {
      this.roomEvent(dp, floorN, roomId, 'drole', `${name(att)} attaque ${dp.name}… qui n'est plus là. La cape trouée a fonctionné, pour une fois.`, 10, [], { kind: 'miss', src: ek(att), dst: ek(def) });
      return;
    }

    // Jet d'attaque
    let bonus: number;
    let stat: StatId = 'for';
    if (ap) {
      stat = CLASSES[ap.cls].attackStat;
      bonus = ap.stats[stat] + half(ap.level) + (ap.weapon?.hit ?? 0);
      if (ap.buffs.mirror) {
        bonus += 3;
        ap.buffs.mirror = false;
      }
      if (treachery) bonus += 5;
    } else bonus = (att as { m: MonsterState }).m.atk;
    if (this.state.floors[floorN]?.theme === 'plongé dans le noir') bonus -= 2; // on y voit mal
    const nat = this.rng.die(20);
    const total = nat + bonus;
    const defRoll = dp ? this.rng.die(20) + dp.stats.agi + half(dp.level) + (dp.armor?.def ?? 0) : this.rng.die(20) + (def as { m: MonsterState }).m.def;
    const margin = total - defRoll;
    const dice = `(${total} contre ${defRoll})`;
    const actors = [ap?.key, dp?.key].filter(Boolean) as string[];

    if (treachery && ap && dp) this.betray(ap, dp);

    // Ennemis frappés : mémorise qui a attaqué qui
    if (dp) {
      const list = attackedBy.get(dp.key) ?? [];
      list.push(att);
      attackedBy.set(dp.key, list);
    }
    if (def.kind === 'monster' && ap) def.m.aggro = ap.key;

    if (nat === 1) {
      const self = this.rng.die(4);
      const text = this.rng.pick(GAG_TEXTS).replace('{a}', name(att)) + ` (−${self} PV)`;
      this.roomEvent(ap, floorN, roomId, 'drole', text, 60, actors, { kind: 'gag', src: ek(att) });
      if (ap) this.damagePlayer(ap, self, 'sa propre maladresse', null);
      else (att as { m: MonsterState }).m.hp = Math.max(1, (att as { m: MonsterState }).m.hp - self);
      return;
    }
    const crit = nat === 20;
    if (!crit && margin < 0) {
      if (margin <= -10) {
        this.roomEvent(ap, floorN, roomId, 'drole', this.rng.pick(FIASCO_TEXTS).replace('{a}', name(att)).replace('{t}', name(def)) + ` ${dice}`, 40, actors, { kind: 'miss', src: ek(att), dst: ek(def) });
        if (ap) ap.stunned = true;
        else (att as { m: MonsterState }).m.distracted = 2;
      } else this.roomEvent(ap, floorN, roomId, 'combat', `${name(att)} rate ${name(def)} ${dice}.`, 0, actors, { kind: 'miss', src: ek(att), dst: ek(def) });
      return;
    }

    // Dégâts
    let dmg = ap ? this.rng.die(ap.weapon?.dmg ?? 3) + Math.max(0, ap.stats[stat]) : this.rng.die((att as { m: MonsterState }).m.dmg) + half(Math.max(0, floorN - 1));
    let text: string;
    let drama = 0;
    if (crit) {
      dmg *= 2;
      text = this.rng.pick(CRIT_TEXTS).replace('{a}', name(att)).replace('{t}', name(def)) + ` (−${dmg} PV)`;
      drama = 60;
    } else if (margin >= 10) {
      dmg = Math.ceil(dmg * 1.5);
      text = `${name(att)} touche ${name(def)} de plein fouet ${dice} : −${dmg} PV.`;
      drama = 20;
    } else text = `${name(att)} touche ${name(def)} ${dice} : −${dmg} PV.`;
    if (treachery) drama += 30;
    this.roomEvent(ap, floorN, roomId, crit ? 'drole' : 'combat', text, drama, actors, { kind: crit ? 'crit' : 'hit', src: ek(att), dst: ek(def) });

    if (treachery && ap && dp && dp.gold > 0) {
      const stolen = Math.ceil(dp.gold * 0.25);
      dp.gold -= stolen;
      ap.gold += stolen;
      this.roomEvent(ap, floorN, roomId, 'trahison', `${ap.name} en profite pour piquer ${stolen} po dans la bourse de ${dp.name}.`, 20, actors);
    }

    if (def.kind === 'player') this.damagePlayer(def.p, dmg, ap ? ap.name : name(att), att);
    else {
      def.m.hp -= dmg;
      if (def.m.hp <= 0) this.killMonster(def.m, floorN, ap);
    }
  }

  private betray(a: PlayerState, v: PlayerState) {
    a.betrayals++;
    this.leaveAlliance(a, false);
    a.traitorUntilTurn = this.state.turn + 10 * this.phases;
    this.emit({ floor: a.floor, roomId: a.roomId, kind: 'trahison', text: `TRAHISON ! ${a.name} plante une dague dans le dos de son allié ${v.name}. Il est marqué TRAÎTRE pour 10 tours.`, scope: 'global', actors: [a.key, v.key], drama: 100 });
  }

  private damagePlayer(p: PlayerState, dmg: number, cause: string, killer: Fighter | null) {
    p.hp -= dmg;
    if (p.hp <= 0) this.killPlayer(p, cause, killer);
  }

  private killPlayer(p: PlayerState, cause: string, killer: Fighter | null) {
    const f = this.state.floors[p.floor];
    const r = f.rooms[p.roomId];
    p.alive = false;
    p.hp = 0;
    p.deaths++;
    p.deathTurn = this.state.turn;
    p.pending = null;
    p.lastAction = null;
    p.respawnIn = Math.max(1, this.cfg.respawnTurns - (p.buffs.coupon ? 2 : 0));
    p.buffs = { cloakTurns: 0, mirror: false, smoke: false, coupon: false };
    // Le loot reste au sol, ramassable par les autres
    const dropped = [p.weapon, p.armor, ...p.items].filter(Boolean) as Item[];
    r.ground.push(...dropped);
    r.groundGold += p.gold;
    const goldLost = p.gold;
    p.weapon = null;
    p.armor = null;
    p.items = [];
    p.gold = 0;
    const xpLost = Math.floor(p.xp * this.cfg.deathXpLoss);
    p.xp -= xpLost;
    const absurd = cause === 'sa propre maladresse' || cause.startsWith('un piège');
    const base = this.rng.pick(DEATH_TEXTS).replace('{p}', p.name);
    this.emit({
      floor: p.floor, roomId: p.roomId, kind: 'mort', scope: 'global', actors: [p.key], fx: { kind: 'death', dst: `p:${p.name}` },
      text: `${base} Cause : ${cause}. Son loot (${dropped.length} objet(s), ${goldLost} po) traîne au sol (!ramasse). −${xpLost} XP.`,
      drama: absurd ? 120 : 80,
    });
    if (killer?.kind === 'player') {
      const k = killer.p;
      k.kills++;
      if (dropped.length || goldLost) this.say(k, `Le loot de ${p.name} est à tes pieds : !ramasse pour tout prendre.`);
      const arena = r.type === 'arene' ? 2 : 1;
      this.gainXp(k, 5 * p.level * arena); // tuer un crawler rapporte moins qu'un monstre : son loot est la vraie tentation
    }
    if (killer?.kind === 'monster') killer.m.aggro = null;
    this.onPlayerKilled(p, killer);
  }

  private killMonster(m: MonsterState, floorN: number, killer: PlayerState | null) {
    const f = this.state.floors[floorN];
    m.hp = 0;
    f.monsters = f.monsters.filter((x) => x !== m);
    // Les monstres ordinaires reviennent 3 tours plus tard, ailleurs sur l'étage (le donjon ne se vide jamais)
    if (!m.boss && m.kind !== 'mimique') (f.respawns ??= []).push({ turn: this.state.turn + 3 * this.phases, kind: m.kind });
    if (!killer) return;
    killer.kills++;
    killer.gold += m.gold;
    // XP partagée entre les alliés présents dans la salle
    const sharers = [killer, ...this.alliesOf(killer).map((k) => this.state.players[k]).filter((a) => a && a.alive && a.floor === floorN && a.roomId === killer.roomId)];
    const share = Math.ceil(m.xp / sharers.length);
    for (const s of sharers) this.gainXp(s, share);
    const shareTxt = sharers.length > 1 ? ` (XP partagée : ${share} chacun)` : ` (+${m.xp} XP)`;
    this.roomEvent(killer, floorN, m.roomId, 'combat', `${killer.name} terrasse ${m.name} et récupère ${m.gold} po${shareTxt}.`, m.boss ? 80 : 5, [], { kind: 'kill', src: `p:${killer.name}`, dst: `m:${m.id}` });
    const wait = m.boss ? this.stairsInMs(f) : 0;
    const sealed = wait !== 0 ? ` Mais l'escalier est encore scellé${wait ? ` (ouverture dans ${fmtWait(wait)})` : ''}.` : '';
    if (m.boss && floorN >= this.cfg.finalFloor) {
      // Dernier étage : le gardien se relève au bout de 6 tours (la sortie n'est ouverte qu'à ceux qui viennent de le battre)
      f.bossBackTurn = this.state.turn + 6 * this.phases;
      this.emit({
        floor: floorN, kind: 'systeme', scope: 'global', actors: [killer.key], drama: 100,
        text: sealed
          ? `${m.name} est vaincu par ${killer.name} !${sealed} Il se relèvera dans 6 tours : il faudra le rebattre une fois la sortie ouverte.`
          : `${m.name} est vaincu par ${killer.name} ! LA SORTIE EST OUVERTE pendant 6 tours : !descendre dans la salle du boss pour entrer dans la Légende.`,
      });
    } else if (m.boss) {
      this.emit({ floor: floorN, kind: 'systeme', scope: 'global', actors: [killer.key], drama: 80, text: `${m.name} est vaincu par ${killer.name} !${sealed || ` L'escalier de l'étage ${floorN} est libre : !descendre dans la salle du boss.`}` });
    }
  }

  gainXp(p: PlayerState, amount: number) {
    p.xp += amount;
    while (p.xp >= xpNext(p.level)) {
      p.xp -= xpNext(p.level);
      p.level++;
      p.statPoints++;
      const gain = CLASSES[p.cls].hpPerLevel;
      p.maxHp += gain;
      p.hp = Math.min(p.maxHp, p.hp + gain);
      this.emit({ floor: p.floor, kind: 'niveau', text: `${p.name} passe niveau ${p.level} ! (+${gain} PV max, 1 point de stat à dépenser avec !monte)`, scope: 'etage', actors: [p.key], drama: 15, fx: { kind: 'levelup', dst: `p:${p.name}` } });
    }
  }

  // ------------------------------------------------------------- actions

  private findItem(list: Item[], arg: string): Item | undefined {
    const a = normalize(arg);
    if (!a) return undefined;
    if (/^\d+$/.test(a)) return list[Number(a) - 1];
    return list.find((i) => normalize(i.name).startsWith(a)) ?? list.find((i) => normalize(i.name).includes(a));
  }

  private giveItem(p: PlayerState, item: Item) {
    if (p.items.length >= INVENTORY_MAX) {
      this.room(p).ground.push(item);
      this.say(p, `Inventaire plein : ${item.name} reste au sol.`);
    } else p.items.push(item);
  }

  private doUse(p: PlayerState, arg: string, equipOnly: boolean) {
    const item = this.findItem(p.items, arg);
    if (!item) return this.say(p, `Tu n'as pas d'objet « ${arg} ».`);
    if (item.kind === 'arme' || item.kind === 'armure') {
      p.items = p.items.filter((i) => i !== item);
      const slot = item.kind === 'arme' ? 'weapon' : 'armor';
      const old = p[slot];
      p[slot] = item;
      if (old) p.items.push(old);
      return this.say(p, `Tu équipes ${item.name}.`);
    }
    if (equipOnly) return this.say(p, `${item.name} ne s'équipe pas. Essaie !utilise.`);
    const fx = itemEffect(item);
    const r = this.room(p);
    p.items = p.items.filter((i) => i !== item);
    switch (fx) {
      case 'heal_small':
      case 'heal_big': {
        const heal = fx === 'heal_small' ? this.rng.die(6) + this.rng.die(6) + 2 : this.rng.die(6) * 4 + 4;
        p.hp = Math.min(p.maxHp, p.hp + heal);
        return this.roomEvent(p, p.floor, p.roomId, 'info', `${p.name} boit ${item.name} et récupère ${heal} PV.`, 0, [], { kind: 'heal', dst: `p:${p.name}` });
      }
      case 'smoke':
        p.buffs.smoke = true;
        return this.roomEvent(p, p.floor, p.roomId, 'info', `${p.name} allume une bombe fumigène. Sa prochaine fuite est garantie.`);
      case 'teleport': {
        const f = this.state.floors[p.floor];
        p.roomId = f.spawnRoom;
        this.discover(p);
        return this.roomEvent(p, p.floor, r.id, 'info', `${p.name} lit un parchemin et disparaît dans un « pouf » sonore.`, 10);
      }
      case 'chicken':
        for (const m of this.monstersIn(p.floor, p.roomId)) m.distracted = 1;
        return this.roomEvent(p, p.floor, p.roomId, 'drole', `${p.name} lance un poulet. Tous les monstres de la salle le regardent, fascinés.`, 40);
      case 'coupon':
        p.buffs.coupon = true;
        return this.say(p, 'Coupon activé : ta prochaine mort sera moins longue. Quel luxe.');
      case 'cheese': {
        const f = this.state.floors[p.floor];
        let n = 0;
        for (const m of this.monstersIn(p.floor, p.roomId)) {
          if (!m.wanderer) continue;
          const exits = Object.values(r.doors).filter((id) => id !== undefined && f.rooms[id!].type !== 'safe') as number[];
          if (exits.length) {
            m.roomId = this.rng.pick(exits);
            n++;
          }
        }
        return this.roomEvent(p, p.floor, p.roomId, 'drole', `${p.name} sort un fromage qui pue. ${n ? `${n} monstre(s) errant(s) s'enfuient en pleurant.` : 'Seuls les humains souffrent.'}`, 20);
      }
      case 'cloak':
        p.buffs.cloakTurns = 3;
        return this.roomEvent(p, p.floor, p.roomId, 'info', `${p.name} enfile une cape d'invisibilité trouée. On voit surtout les trous.`);
      case 'mirror':
        p.buffs.mirror = true;
        return this.roomEvent(p, p.floor, p.roomId, 'drole', `${p.name} se regarde dans un miroir de poche. Confiance au maximum (+3 au prochain jet).`, 10);
      case 'duck':
        if (r.trapArmed) r.trapRevealed = true;
        return this.roomEvent(p, p.floor, p.roomId, 'drole', `${p.name} pose un crapaud siffleur par terre. ${r.trapArmed ? 'Il siffle à s\'en décrocher la mâchoire : un piège se dévoile !' : 'Il bâille. Aucun piège ici.'}`, 10);
      case 'crown':
        this.gainXp(p, xpNext(p.level) - p.xp);
        return this.roomEvent(p, p.floor, p.roomId, 'drole', `${p.name} coiffe la couronne du Roi Gobelin. Le donjon reconnaît son autorité.`, 30);
      default:
        return this.roomEvent(p, p.floor, p.roomId, 'drole', `${p.name} utilise ${item.name}. Il ne se passe absolument rien.`, 15);
    }
  }

  // --------------------------------------------------------------- forgeron

  /** Prix d'une amélioration : plus cher à chaque niveau, et plus bas dans le donjon. */
  forgeCost(item: Item, floorN: number): number {
    return Math.round((30 + 25 * (item.plus ?? 0)) * (1 + 0.5 * (floorN - 1)));
  }

  forgeOffer(p: PlayerState): ForgeOffer {
    const offer = (it: Item | null) => (it && (it.plus ?? 0) < FORGE_MAX ? { name: it.name, plus: it.plus ?? 0, cost: this.forgeCost(it, p.floor) } : null);
    return { weapon: offer(p.weapon), armor: offer(p.armor) };
  }

  private forgeText(p: PlayerState): SubmitResult {
    if (!this.room(p).forge) return { ok: false, text: 'Il n\'y a pas de forge ici. Elle est quelque part à mi-chemin du boss : cherche l\'enclume.' };
    const o = this.forgeOffer(p);
    const line = (label: string, x: ForgeOffer['weapon']) => (x ? `${label} ${x.name} → +${x.plus + 1} pour ${x.cost} po` : `${label} : rien à améliorer`);
    return { ok: true, text: `Forgeron : ${line('!forge arme :', o.weapon)} | ${line('!forge armure :', o.armor)} (max +${FORGE_MAX})` };
  }

  private forgeSays(floor: number, roomId: number, line: string) {
    this.emit({ floor, roomId, kind: 'info', text: `Le forgeron : « ${line} »`, scope: 'salle', drama: 0, npc: 'marchand' });
  }

  private doForge(p: PlayerState, arg: string) {
    const r = this.room(p);
    if (!r.forge) return this.say(p, 'Il n\'y a pas de forge ici. Elle est à mi-chemin du boss : cherche l\'enclume.');
    const armor = /^armu|^armor|^def/i.test(arg.trim());
    const it = armor ? p.armor : p.weapon;
    if (!it) return this.say(p, armor ? 'Tu n\'as pas d\'armure équipée.' : 'Tu n\'as pas d\'arme équipée.');
    const plus = it.plus ?? 0;
    if (plus >= FORGE_MAX) return this.forgeSays(p.floor, r.id, `${it.name} ? On ne peut pas faire mieux. Même moi.`);
    const cost = this.forgeCost(it, p.floor);
    if (p.gold < cost) return this.say(p, `Il te manque ${cost - p.gold} po. Le forgeron ne bat pas le fer à crédit.`);
    p.gold -= cost;
    it.plus = plus + 1;
    if (armor) it.def = (it.def ?? 0) + 1;
    else {
      it.hit = (it.hit ?? 0) + 1;
      it.dmg = (it.dmg ?? 4) + 2; // dé de dégâts : d6 → d8 → d10…
    }
    it.name = `${it.name.replace(/ \+\d+$/, '')} +${it.plus}`;
    it.value += Math.round(cost / 2);
    const bonus = armor ? '+1 défense' : '+1 au jet, dégâts d' + it.dmg;
    this.roomEvent(p, p.floor, r.id, 'loot', `${p.name} fait reforger son équipement : ${it.name} (${bonus}) pour ${cost} po.`, 25, [], { kind: 'levelup', dst: `p:${p.name}` });
    this.forgeSays(p.floor, r.id, this.rng.pick(FORGE_LINES));
  }

  private doBuy(p: PlayerState, arg: string) {
    const r = this.room(p);
    if (r.forge) return this.say(p, 'Ici, c\'est la forge : !forge arme ou !forge armure. Le marchand est dans l\'autre safe room.');
    if (r.type !== 'safe') return this.say(p, 'Pas de marchand ici.');
    const item = this.findItem(r.merchant, arg);
    if (!item) return this.say(p, 'Le marchand n\'a pas ça. Tape !marchand pour voir son stock.');
    const price = this.price(item);
    if (p.gold < price) return this.say(p, `Il te manque ${price - p.gold} po. Le marchand ne fait pas crédit.`);
    if (p.items.length >= INVENTORY_MAX) return this.say(p, 'Inventaire plein.');
    p.gold -= price;
    r.merchant = r.merchant.filter((i) => i !== item);
    p.items.push(item);
    this.roomEvent(p, p.floor, p.roomId, 'loot', `${p.name} achète ${item.name} pour ${price} po.`);
  }

  private doSell(p: PlayerState, arg: string) {
    const r = this.room(p);
    if (r.type !== 'safe') return this.say(p, 'Pas de marchand ici.');
    const item = this.findItem(p.items, arg);
    if (!item) return this.say(p, `Tu n'as pas d'objet « ${arg} ».`);
    const price = Math.max(1, Math.ceil(item.value / 2));
    p.items = p.items.filter((i) => i !== item);
    p.gold += price;
    r.merchant.push(item);
    this.roomEvent(p, p.floor, p.roomId, 'loot', `${p.name} vend ${item.name} pour ${price} po.`);
  }

  private doRest(p: PlayerState) {
    if (this.room(p).type !== 'safe') return this.say(p, 'Te reposer ici ? Les monstres adoreraient. Va dans une safe room.');
    const heal = Math.max(3, Math.round(p.maxHp * 0.25));
    p.hp = Math.min(p.maxHp, p.hp + heal);
    this.say(p, `Tu te reposes et récupères ${heal} PV.`);
  }

  private doPickup(p: PlayerState, arg: string) {
    const r = this.room(p);
    if (!r.ground.length && !r.groundGold) return this.say(p, 'Il n\'y a rien à ramasser ici.');
    const got: string[] = [];
    if (r.groundGold) {
      got.push(`${r.groundGold} po`);
      p.gold += r.groundGold;
      r.groundGold = 0;
    }
    const wanted = arg ? this.findItem(r.ground, arg) : undefined;
    const toTake = wanted ? [wanted] : [...r.ground];
    for (const it of toTake) {
      if (p.items.length >= INVENTORY_MAX) break;
      r.ground = r.ground.filter((i) => i !== it);
      p.items.push(it);
      got.push(it.name);
    }
    this.roomEvent(p, p.floor, p.roomId, 'loot', got.length ? `${p.name} ramasse : ${got.join(', ')}.` : `${p.name} a les poches pleines.`, got.length > 2 ? 10 : 0);
  }

  private check(p: PlayerState, stat: StatId, dc: number): { ok: boolean; total: number } {
    let total = this.rng.die(20) + p.stats[stat] + half(p.level);
    if (p.buffs.mirror) {
      total += 3;
      p.buffs.mirror = false;
    }
    return { ok: total >= dc, total };
  }

  private doSearch(p: PlayerState) {
    const r = this.room(p);
    const f = this.state.floors[p.floor];
    // Ce qui traîne au sol (loot d'un mort, pluie d'or) passe avant tout : fouiller le ramasse
    if (r.ground.length || r.groundGold) return this.doPickup(p, '');
    if (r.type === 'tresor' && r.chest === 'ferme') {
      r.chest = 'ouvert';
      if (r.mimic) {
        const m = spawnMimic(f.n, r.id, this.rng, this.nextId);
        m.aggro = p.key;
        f.monsters.push(m);
        return this.roomEvent(p, p.floor, r.id, 'drole', `${p.name} ouvre le coffre… qui ouvre la bouche. C'ÉTAIT UNE MIMIQUE !`, 70);
      }
      const gold = this.rng.int(10, 30) * f.n;
      p.gold += gold;
      const loot = [randomLoot(this.rng, this.nextId, f.n, false, 'rare')];
      if (this.rng.chance(0.4)) loot.push(randomLoot(this.rng, this.nextId, f.n));
      for (const it of loot) this.giveItem(p, it);
      const best = loot.some((i) => i.rarity === 'epique' || i.rarity === 'legendaire');
      return this.roomEvent(p, p.floor, r.id, 'loot', `${p.name} ouvre le coffre : ${gold} po, ${loot.map((i) => `${i.name} (${RARITY_LABEL[i.rarity]})`).join(', ')} !`, best ? 50 : 15);
    }
    if (r.type === 'piege' && r.trapArmed) {
      const c = this.check(p, 'int', 12 + f.n);
      if (c.ok) {
        r.trapArmed = false;
        this.gainXp(p, 15);
        return this.roomEvent(p, p.floor, r.id, 'piege', `${p.name} désarme le piège de la salle (${c.total}). +15 XP.`, 5);
      }
      this.roomEvent(p, p.floor, r.id, 'piege', `${p.name} tente de désarmer le piège (${c.total})… et le déclenche.`, 20);
      return this.springTrap(p, f);
    }
    if (r.searchedBy) return this.say(p, `Cette salle a déjà été fouillée par ${this.state.players[r.searchedBy]?.name ?? 'quelqu\'un'}.`);
    r.searchedBy = p.key;
    const c = this.check(p, 'int', 10);
    if (!c.ok) return this.roomEvent(p, p.floor, r.id, 'drole', this.rng.pick(SEARCH_FAIL_TEXTS).replace('{p}', p.name));
    if (this.rng.chance(0.6)) {
      const gold = this.rng.die(6) * f.n + 3;
      p.gold += gold;
      return this.roomEvent(p, p.floor, r.id, 'loot', `${p.name} trouve ${gold} po sous une dalle.`);
    }
    const it = randomLoot(this.rng, this.nextId, f.n);
    this.giveItem(p, it);
    this.roomEvent(p, p.floor, r.id, 'loot', `${p.name} trouve ${it.name} (${RARITY_LABEL[it.rarity]}).`, it.rarity === 'legendaire' ? 60 : it.rarity === 'epique' ? 30 : 0);
  }

  private springTrap(p: PlayerState, f: FloorState) {
    // Étage 1 : 1-3 PV (on apprend), étage 2 : 1-5, ensuite d6 + moitié de l'étage
    const dmg = f.n === 1 ? this.rng.die(3) : f.n === 2 ? this.rng.die(5) : this.rng.die(6) + half(f.n);
    const r = this.room(p);
    if (this.rng.chance(0.5)) r.trapArmed = false; // un piège sur deux ne se réarme pas
    const text = this.rng.pick(TRAP_TEXTS).replace('{p}', p.name) + ` (−${dmg} PV)`;
    this.roomEvent(p, p.floor, p.roomId, 'piege', text, 30, [], { kind: 'trap', dst: `p:${p.name}` });
    this.damagePlayer(p, dmg, 'un piège', null);
  }

  private doMove(p: PlayerState, dir: Dir) {
    const f = this.state.floors[p.floor];
    const r = f.rooms[p.roomId];
    const target = r.doors[dir];
    if (target === undefined) return this.say(p, `Il n'y a pas de porte au ${DIR_LABEL[dir]}. Juste un mur, très convaincant.`);
    if ((this.state.turn < this.state.floodUntil || f.theme === 'inondé') && r.type !== 'safe' && this.rng.chance(1 / 3)) {
      return this.roomEvent(p, p.floor, r.id, 'drole', `${p.name} glisse dans l'eau en voulant aller au ${DIR_LABEL[dir]} et fait un plat magnifique.`, 15);
    }
    const hostiles = this.monstersIn(p.floor, p.roomId).filter((m) => m.distracted <= 0);
    if (hostiles.length && r.type !== 'safe') {
      if (p.buffs.smoke) p.buffs.smoke = false;
      else {
        const dc = 10 + Math.max(...hostiles.map((m) => m.atk)) - (f.theme === 'plongé dans le noir' ? 3 : 0);
        const c = this.check(p, 'agi', dc);
        if (!c.ok) {
          const m = this.rng.pick(hostiles);
          return this.roomEvent(p, p.floor, r.id, 'combat', `${p.name} tente de fuir vers le ${DIR_LABEL[dir]} mais ${m.name} le retient par la cape (${c.total} contre ${dc}).`, 10);
        }
      }
    }
    p.roomId = target;
    this.discover(p);
    const nr = f.rooms[target];
    if (nr.type === 'boss' && f.monsters.some((m) => m.boss && m.roomId === nr.id)) {
      this.emit({ floor: f.n, roomId: nr.id, kind: 'combat', text: `${p.name} entre dans la salle du boss. Courage. Ou inconscience.`, scope: 'etage', actors: [p.key], drama: 30 });
    }
    if (nr.type === 'piege' && nr.trapArmed && !nr.trapRevealed) {
      const c = this.check(p, 'agi', 11 + f.n);
      if (c.ok) this.roomEvent(p, f.n, nr.id, 'piege', `${p.name} évite de justesse un piège en entrant (${c.total}).`, 10);
      else this.springTrap(p, f);
    }
  }

  private doDescend(p: PlayerState) {
    const f = this.state.floors[p.floor];
    const r = f.rooms[p.roomId];
    if (!r.stairs) return this.say(p, 'Il n\'y a pas d\'escalier ici. Il est dans la salle du boss.');
    if (f.monsters.some((m) => m.boss && m.hp > 0)) return this.say(p, 'Le boss bloque l\'escalier. Il faut d\'abord le vaincre.');
    const wait = this.stairsInMs(f);
    if (wait !== 0) {
      return this.say(p, wait === null
        ? 'L\'escalier est scellé : il s\'ouvrira quand la saison commencera.'
        : `L'escalier est encore scellé : il s'ouvre dans ${fmtWait(wait)}. En attendant, explore, pille et prends des niveaux : plus bas, ça ne pardonne pas.`);
    }
    if (f.n >= this.cfg.finalFloor) return this.finish(p);
    const next = this.freshFloor(f.n + 1);
    this.startTimer(next, p);
    p.floor = next.n;
    p.roomId = next.spawnRoom;
    p.deepest = Math.max(p.deepest, next.n);
    this.discover(p);
    this.gainXp(p, 30);
    this.emit({ floor: next.n, kind: 'systeme', text: `${p.name} descend à l'étage ${next.n} (+30 XP de survie).`, scope: 'global', actors: [p.key], drama: 25 });
  }

  // ------------------------------------------------------------ fin de tour

  private endOfTurn(players: PlayerState[]) {
    for (const p of players) {
      if (p.alive && p.buffs.cloakTurns > 0) p.buffs.cloakTurns--;
      if (p.traitorUntilTurn && this.state.turn >= p.traitorUntilTurn) p.traitorUntilTurn = 0;
    }
    // Effondrements
    for (const f of Object.values(this.state.floors)) {
      if (f.collapsed || f.collapseAt === null) continue;
      const left = f.collapseAt - this.now;
      const flags = f;
      if (left <= 5 * 60_000 && left > 60_000 && !flags.warned5) {
        flags.warned5 = true;
        this.emit({ floor: f.n, kind: 'systeme', text: `L'étage ${f.n} tremble : effondrement dans 5 minutes. Trouvez l'escalier !`, scope: 'etage', drama: 20 });
      }
      if (left <= 60_000 && left > 0 && !flags.warned1) {
        flags.warned1 = true;
        this.emit({ floor: f.n, kind: 'systeme', text: `Plus qu'une minute avant l'effondrement de l'étage ${f.n} !`, scope: 'etage', drama: 40 });
      }
      if (!f.stairsOpened && left > 0 && this.stairsOpen(f)) {
        f.stairsOpened = true;
        if (!Object.values(this.state.players).some((p) => p.alive && p.floor === f.n)) continue;
        const boss = f.monsters.some((m) => m.boss && m.hp > 0);
        const last = f.n >= this.cfg.finalFloor;
        this.emit({
          floor: f.n, kind: 'systeme', scope: 'global', drama: 45,
          text: `${last ? 'LA SORTIE DU DONJON' : `L'escalier de l'étage ${f.n}`} SE DESCELLE ! ${boss ? 'Il ne reste qu\'à battre le boss qui le garde.' : 'Le boss est déjà tombé : foncez !'} ${Math.round(left / 60_000)} min avant l'effondrement.`,
        });
      }
      if (left <= 0) this.collapse(f);
    }
    // Fin de saison à heure fixe (n × floorMinutes), même si personne n'a atteint le dernier étage
    if (!this.state.seasonOver && this.state.seasonStart !== null && this.now >= this.waveEnd(this.cfg.finalFloor)) {
      const last = this.state.floors[this.cfg.finalFloor];
      if (last && !last.collapsed) this.collapse(last);
      else this.endSeason(last ?? { n: this.cfg.finalFloor } as FloorState);
    }
    if (this.state.seasonOver) return; // la saison vient de se terminer : plus rien ne bouge
    // Réapparitions
    for (const p of players) {
      if (p.alive || p.deathTurn === this.state.turn || !this.state.players[p.key]) continue; // sorti (Légende) ou expulsé : pas de retour
      p.respawnIn--;
      if (p.respawnIn > 0) continue;
      // Réapparition à son étage, ou au suivant s'il s'est effondré entre-temps
      const f = this.state.floors[p.floor]?.collapsed ? this.freshFloor(p.floor + 1) : this.freshFloor(p.floor);
      this.startTimer(f, p);
      p.floor = f.n;
      p.deepest = Math.max(p.deepest, f.n);
      p.roomId = f.spawnRoom;
      p.alive = true;
      p.hp = p.maxHp;
      p.stunned = false;
      p.immuneUntil = this.now + this.cfg.immunitySeconds * 1000;
      if (!p.weapon) p.weapon = makeItem(CLASSES[p.cls].startWeapon, this.nextId);
      this.discover(p);
      this.emit({ floor: f.n, roomId: p.roomId, kind: 'systeme', text: `${p.name} réapparaît dans la safe room de l'étage ${f.n}, l'air vexé. Immunisé ${Math.round(this.cfg.immunitySeconds / 60)} min.`, scope: 'etage', actors: [p.key], drama: 5 });
      this.merchantSays(f.n, p.roomId, this.rng.pick(MERCHANT_RESPAWN), p.key);
    }
    this.themeEffects(players.filter((p) => this.state.players[p.key]));
    this.respawnMonsters();
    // Le gardien du dernier étage se relève : la sortie se referme
    for (const f of Object.values(this.state.floors)) {
      if (f.bossBackTurn === undefined || this.state.turn < f.bossBackTurn) continue;
      f.bossBackTurn = undefined;
      if (f.monsters.some((m) => m.boss && m.hp > 0)) continue;
      const pool = BOSSES.filter((b) => b.minFloor <= f.n && b.minFloor >= Math.max(1, f.n - 2));
      const boss = spawnMonster(this.rng.pick(pool.length ? pool : BOSSES), f.n, f.bossRoom, this.rng, this.nextId);
      f.monsters.push(boss);
      this.emit({ floor: f.n, roomId: f.bossRoom, kind: 'systeme', text: `${boss.name} se relève et garde à nouveau la sortie. Il faudra le mériter.`, scope: 'global', drama: 60 });
    }
    // Le marchand rappelle une règle toutes les 4 tours, s'il a du public
    if (this.state.turn % (4 * this.phases) === 0) {
      const tip = MERCHANT_TIPS[Math.floor(this.state.turn / (4 * this.phases)) % MERCHANT_TIPS.length];
      for (const f of Object.values(this.state.floors)) {
        if (f.collapsed) continue;
        for (const r of f.rooms) if (r.type === 'safe' && !r.forge && this.playersIn(f.n, r.id).length) this.merchantSays(f.n, r.id, tip);
      }
    }
  }

  /** Effets des thèmes d'étage, à chaque fin de tour. */
  private themeEffects(players: PlayerState[]) {
    for (const f of Object.values(this.state.floors)) {
      if (f.collapsed) continue;
      const here = players.filter((p) => p.alive && p.floor === f.n);
      if (!here.length) continue;
      if (f.theme === 'en feu') {
        for (const p of here) {
          if (f.rooms[p.roomId].type === 'safe' || !this.rng.chance(0.12)) continue;
          this.roomEvent(p, f.n, p.roomId, 'piege', `Une braise jaillit du sol et ${p.name} se brûle les orteils. (−2 PV)`, 15, [], { kind: 'trap', dst: `p:${p.name}` });
          this.damagePlayer(p, 2, 'les flammes de l\'étage', null);
        }
      } else if (f.theme === 'moisi') {
        for (const m of f.monsters) if (m.hp > 0 && m.hp < m.maxHp) m.hp++;
      } else if (f.theme === 'hanté' && this.rng.chance(0.15)) {
        const rich = here.filter((p) => p.gold > 0 && f.rooms[p.roomId].type !== 'safe');
        if (rich.length) {
          const p = this.rng.pick(rich);
          const n = Math.min(p.gold, this.rng.int(2, 6));
          p.gold -= n;
          const hide = this.rng.pick(f.rooms.filter((r) => r.type !== 'safe'));
          hide.groundGold += n;
          this.roomEvent(p, f.n, p.roomId, 'drole', `Un fantôme chapardeur subtilise ${n} po à ${p.name} et file les cacher dans une autre salle. Bouh.`, 25);
        }
      }
    }
  }

  /** Le dernier étage s'effondre : la saison est terminée, la partie se fige (la régie peut relancer une nouvelle partie). */
  // ------------------------------------------------- cimetière et résurrection

  /** Un vrai joueur éliminé entre au cimetière avec son perso intact ; il reçoit un numéro pour faire campagne. */
  private bury(p: PlayerState, floorN: number): number {
    this.state.graveyard = this.state.graveyard.filter((g) => g.key !== p.key); // un seul numéro par personne (le plus récent)
    const no = ++this.state.graveNo;
    this.state.graveyard.push({ no, key: p.key, name: p.name, snap: JSON.parse(JSON.stringify(p)) as PlayerState, floor: floorN, turn: this.state.turn });
    return no;
  }

  /** Après un effondrement : points aux viewers présents, pari « sortie » tranché, vote de résurrection lancé. */
  private afterCollapse(f: FloorState, humansLost: boolean) {
    const st = this.state;
    for (const w of Object.values(st.wallets)) if (this.now - w.seen < 10 * 60_000) w.pts += 10; // fidélité
    if (st.flashBet?.kind === 'sortie' && st.flashBet.floor === f.n) this.settleFlash(humansLost ? 'non' : 'oui');
    if (f.n === 2 && st.grandBet.open) {
      st.grandBet.open = false;
      if (Object.keys(st.grandBet.stakes).length) this.emit({ floor: 0, kind: 'systeme', scope: 'global', drama: 30, text: `Le GRAND PARI est fermé : ${this.grandPot()} points en jeu sur le premier à sortir du Donjon.` });
    }
    if (!st.graveyard.length) return;
    if (st.vote) {
      st.vote = null; // la résurrection passe avant
      st.nextVoteTurn = st.turn + this.voteEvery();
    }
    const floorTo = f.n + 1;
    if (st.resurrection) st.resurrection.floorTo = Math.max(st.resurrection.floorTo, floorTo);
    else st.resurrection = { endTurn: st.turn + 3 * this.phases, floorTo, votes: {} };
    const list = [...st.graveyard].sort((a, b) => b.snap.level - a.snap.level).slice(0, 8).map((g) => `n°${g.no} ${g.name} (niv ${g.snap.level})`);
    this.emit({
      floor: 0, kind: 'systeme', scope: 'global', drama: 85,
      text: `⚰️ VOTE DE RÉSURRECTION (1 min) : qui mérite une seconde chance ? ${list.join(' · ')}${st.graveyard.length > 8 ? ' …' : ''}. Tapez !vote <n°> (et !vote <n°> <points> pour peser plus lourd : 10 points = 1 voix).`,
    });
  }

  private voteResurrection(name: string, arg: string): SubmitResult {
    const r = this.state.resurrection!;
    const key = playerKey(name);
    if (this.state.players[key]?.bot) return { ok: false, text: 'Les PNJ ne votent pas pour les morts.' };
    const [noS, ptsS] = arg.trim().split(/\s+/);
    const no = Number(noS);
    const g = this.state.graveyard.find((x) => x.no === no);
    if (!g) return { ok: false, text: `Vote de résurrection : !vote <n°> parmi ${this.state.graveyard.map((x) => `n°${x.no} ${x.name}`).join(', ')}.` };
    const w = this.wallet(name);
    const pts = Math.max(0, Math.min(w.pts, Math.floor(Number(ptsS) || 0)));
    w.pts -= pts;
    const prev = r.votes[key];
    const voices = (prev && prev.no === no ? prev.voices : 1) + Math.floor(pts / 10);
    r.votes[key] = { no, voices };
    return { ok: true, text: `Voix pour n°${no} ${g.name} : ${voices}${pts ? ` (−${pts} points de faveur)` : ''}.` };
  }

  /** Fin du vote : le plus de voix revient (égalité : jet de d20 entre les ex æquo, relancé tant qu'il y a égalité). */
  private resolveResurrection() {
    const st = this.state;
    const r = st.resurrection!;
    st.resurrection = null;
    const tally = new Map<number, number>();
    for (const v of Object.values(r.votes)) if (st.graveyard.some((g) => g.no === v.no)) tally.set(v.no, (tally.get(v.no) ?? 0) + v.voices);
    if (!tally.size) {
      this.emit({ floor: 0, kind: 'systeme', scope: 'global', drama: 40, text: 'Personne n\'a voté : les morts restent morts. Le chat a le cœur sec.' });
      return;
    }
    const best = Math.max(...tally.values());
    let tied = [...tally.entries()].filter(([, v]) => v === best).map(([no]) => no);
    let rolls = '';
    while (tied.length > 1) {
      const r20 = tied.map((no) => [no, this.rng.int(1, 20)] as const);
      rolls += ` Égalité à ${best} voix ! Jet de d20 : ${r20.map(([no, d]) => `${st.graveyard.find((g) => g.no === no)!.name} ${d}`).join(', ')}.`;
      const top = Math.max(...r20.map(([, d]) => d));
      tied = r20.filter(([, d]) => d === top).map(([no]) => no);
    }
    const g = st.graveyard.find((x) => x.no === tied[0])!;
    const f = this.reviveFloor(r.floorTo);
    this.revive(g, f);
    const others = [...tally.entries()].filter(([no]) => no !== g.no).sort((a, b) => b[1] - a[1])[0];
    this.emit({
      floor: f.n, roomId: f.spawnRoom, kind: 'niveau', scope: 'global', drama: 110, actors: [g.key], fx: { kind: 'levelup', dst: `p:${g.name}` },
      text: `RÉSURRECTION !${rolls} Le chat a parlé : ${g.name} (n°${g.no}) revient d'entre les morts à l'étage ${f.n}, tous ses PV, niveau ${g.snap.level} (${best} voix${others ? ` contre ${others[1]}` : ''}).`,
    });
  }

  /** Étage où ressuscite le gagnant : celui sous l'étage effondré, ou le plus profond encore debout. */
  private reviveFloor(n: number): FloorState {
    const f = this.state.floors[n];
    if (f && !f.collapsed) return f;
    const live = Object.values(this.state.floors).filter((x) => !x.collapsed).sort((a, b) => b.n - a.n);
    return live[0] ?? this.freshFloor(Math.min(n, this.cfg.finalFloor));
  }

  private revive(g: Grave, f: FloorState) {
    this.state.graveyard = this.state.graveyard.filter((x) => x.no !== g.no);
    const cur = this.state.players[g.key];
    if (cur) this.gameOver(cur); // il avait recommencé avec un nouveau perso : l'ancien, ressuscité, le remplace
    const p = g.snap;
    Object.assign(p, {
      floor: f.n, roomId: f.spawnRoom, alive: true, hp: p.maxHp, respawnIn: 0, pending: null, lastAction: null, stunned: false,
      allianceId: null, allyProposals: [], traitorUntilTurn: 0, immuneUntil: this.now + 60_000, deepest: Math.max(p.deepest, f.n),
    });
    this.state.players[g.key] = p;
    this.discover(p);
    this.startTimer(f, p);
  }

  // ------------------------------------------------------ points de faveur

  private wallet(name: string): Wallet {
    const key = playerKey(name);
    return (this.state.wallets[key] ??= { name: name.trim().slice(0, 24), pts: 100, seen: this.now, lastSponsor: 0, won: 0, bets: 0, gain: 0 });
  }

  /** Un viewer vient d'écrire dans le chat (il gagne des points de présence à chaque effondrement). */
  seen(name: string, now = Date.now()) {
    if (!playerKey(name)) return;
    this.now = now;
    this.wallet(name).seen = now;
  }

  private favorText(name: string): SubmitResult {
    const w = this.wallet(name);
    const g = this.state.graveyard.find((x) => x.key === playerKey(name));
    return { ok: true, text: `${w.name} : ${w.pts} points de faveur · paris gagnés ${w.won}/${w.bets}${g ? ` · tu es le n°${g.no} au vote de résurrection` : ''}.` };
  }

  // ------------------------------------------------------------- sponsors

  private sponsor(name: string, arg: string): SubmitResult {
    const COST = { potion: 40, or: 40, monstre: 80 } as const;
    const parts = arg.trim().split(/\s+/);
    const what = normalize(parts.pop() ?? '') as keyof typeof COST;
    const t = this.player(parts.join(' '));
    if (!(what in COST) || !t) return { ok: false, text: `!sponsor <pseudo> potion (${COST.potion}) | or (${COST.or}) | monstre (${COST.monstre}) — avec tes points de faveur (!faveur).` };
    if (playerKey(name) === t.key) return { ok: false, text: 'Se sponsoriser soi-même ? La production a vu, la production refuse.' };
    if (!t.alive) return { ok: false, text: `${t.name} est mort pour l'instant.` };
    const w = this.wallet(name);
    if (this.now - w.lastSponsor < 120_000) return { ok: false, text: `Un sponsor toutes les 2 minutes : encore ${Math.ceil((120_000 - (this.now - w.lastSponsor)) / 1000)} s.` };
    if (w.pts < COST[what]) return { ok: false, text: `Il te faut ${COST[what]} points de faveur (tu en as ${w.pts}). Gagne des paris !` };
    const f = this.state.floors[t.floor];
    const r = f?.rooms[t.roomId];
    if (what === 'monstre') {
      if (!f || !r || r.type === 'safe' || t.immuneUntil > this.now) return { ok: false, text: `${t.name} est à l'abri (safe room ou protection d'arrivée). Le monstre attendra.` };
      const pool = MONSTERS.filter((m) => m.minFloor <= f.n && m.minFloor >= f.n - 3);
      const m = spawnMonster(this.rng.pick(pool.length ? pool : MONSTERS), f.n, r.id, this.rng, this.nextId);
      f.monsters.push(m);
      this.emit({ floor: f.n, roomId: r.id, kind: 'systeme', scope: 'global', drama: 60, actors: [t.key], text: `😈 CADEAU EMPOISONNÉ : ${w.name} sponsorise ${t.name}… avec ${m.name}, livré directement dans sa salle !` });
    } else if (what === 'potion' && t.items.length < INVENTORY_MAX) {
      t.items.push(makeItem('potion', this.nextId));
      this.emit({ floor: t.floor, roomId: t.roomId, kind: 'loot', scope: 'global', drama: 35, actors: [t.key], text: `🎁 SPONSOR : ${w.name} envoie une potion à ${t.name}. Elle tombe du plafond, intacte. Presque.` });
    } else {
      t.gold += 30;
      this.emit({ floor: t.floor, roomId: t.roomId, kind: 'loot', scope: 'global', drama: 35, actors: [t.key], text: `🎁 SPONSOR : ${w.name} offre 30 po à ${t.name}. Pluie de pièces sur une seule tête.` });
    }
    w.pts -= COST[what];
    w.lastSponsor = this.now;
    return { ok: true, text: `Sponsor envoyé (−${COST[what]} points, il t'en reste ${w.pts}).` };
  }

  // --------------------------------------------------------------- paris

  private grandPot(): number {
    return Object.values(this.state.grandBet.stakes).reduce((s, x) => s + x.amount, 0);
  }

  private placeBet(name: string, arg: string): SubmitResult {
    const key = playerKey(name);
    if (this.state.players[key]?.bot) return { ok: false, text: 'Les PNJ ne parient pas.' };
    const parts = arg.trim().split(/\s+/).filter(Boolean);
    const amount = Math.floor(Number(parts[parts.length - 1]));
    const w = this.wallet(name);
    const fb = this.state.flashBet;
    const first = normalize(parts[0] ?? '');
    if (first === 'oui' || first === 'non') {
      if (!fb) return { ok: false, text: 'Aucun pari éclair en cours. Le grand pari : !parie <pseudo> <mise>.' };
      if (this.now > fb.closeAt) return { ok: false, text: 'Les mises sont fermées pour ce pari. Résultat bientôt !' };
      if (!(amount >= 5)) return { ok: false, text: `!parie ${first} <mise> (5 points minimum, tu en as ${w.pts}).` };
      if (amount > w.pts) return { ok: false, text: `Tu n'as que ${w.pts} points de faveur.` };
      const prev = fb.stakes[key];
      if (prev && prev.opt !== first) return { ok: false, text: `Tu as déjà parié « ${prev.opt} ». On ne retourne pas sa veste en plein pari.` };
      w.pts -= amount;
      if (!prev) w.bets++;
      fb.stakes[key] = { opt: first, amount: (prev?.amount ?? 0) + amount, name: w.name };
      return { ok: true, text: `Pari « ${first} » : ${fb.stakes[key].amount} points sur « ${fb.title} ».` };
    }
    // Grand pari : qui sortira en premier ?
    const gb = this.state.grandBet;
    if (!gb.open) return { ok: false, text: 'Le grand pari est fermé (il ferme à l\'effondrement de l\'étage 2).' + (fb ? ' Pari éclair en cours : !parie oui|non <mise>.' : '') };
    const t = this.player(parts.slice(0, -1).join(' '));
    if (!t || !(amount >= 5)) return { ok: false, text: `Grand pari, qui sortira en premier ? !parie <pseudo> <mise> (5 points minimum, tu en as ${w.pts}).` };
    if (amount > w.pts) return { ok: false, text: `Tu n'as que ${w.pts} points de faveur.` };
    const prev = gb.stakes[key];
    if (prev && prev.target !== t.key) return { ok: false, text: `Tu as déjà misé sur ${prev.targetName}. On ne change pas de cheval.` };
    w.pts -= amount;
    if (!prev) w.bets++;
    gb.stakes[key] = { target: t.key, targetName: t.name, amount: (prev?.amount ?? 0) + amount };
    return { ok: true, text: `Grand pari : ${gb.stakes[key].amount} points sur ${t.name}. Cagnotte : ${this.grandPot()} points.` };
  }

  /** Paris éclair : la production en lance un aux moments chauds (combat de boss, escalier qui s'ouvre). */
  private updateFlashBet() {
    const st = this.state;
    const fb = st.flashBet;
    if (fb?.kind === 'boss') {
      const f = st.floors[fb.floor];
      const boss = f?.monsters.find((m) => m.id === fb.monsterId && m.hp > 0);
      if (!boss) return this.settleFlash('oui');
      if (this.now >= fb.deadline) return this.settleFlash('non');
    }
    if (fb || st.resurrection || st.seasonStart === null || this.now < st.nextFlashAt) return;
    for (const f of Object.values(st.floors)) {
      if (f.collapsed) continue;
      const humans = Object.values(st.players).filter((p) => p.alive && !p.bot && p.floor === f.n);
      if (!humans.length) continue;
      const boss = f.monsters.find((m) => m.boss && m.hp > 0 && m.hp < m.maxHp && humans.some((p) => p.roomId === m.roomId));
      if (boss) return this.openFlash({ kind: 'boss', floor: f.n, monsterId: boss.id, title: `${boss.name} tombe-t-il dans les 2 minutes ?`, closeAt: this.now + 45_000, deadline: this.now + 120_000 });
      if (f.stairsOpened && f.collapseAt !== null && f.collapseAt - this.now > 90_000) {
        return this.openFlash({ kind: 'sortie', floor: f.n, title: `Tous les vrais joueurs de l'étage ${f.n} s'en sortent avant l'effondrement ?`, closeAt: this.now + 60_000, deadline: f.collapseAt });
      }
    }
  }

  private openFlash(b: Omit<FlashBet, 'id' | 'stakes'>) {
    this.state.flashBet = { ...b, id: this.state.nextId, stakes: {} };
    this.emit({ floor: 0, kind: 'systeme', scope: 'global', drama: 55, text: `💰 PARI ÉCLAIR : ${b.title} !parie oui <mise> ou !parie non <mise> (${Math.round((b.closeAt - this.now) / 1000)} s pour miser, la production ajoute 50 % à la cagnotte).` });
  }

  /** Tranche le pari éclair : les gagnants se partagent la cagnotte + 50 % de la production, au prorata de leur mise. */
  private settleFlash(result: 'oui' | 'non') {
    const st = this.state;
    const fb = st.flashBet!;
    st.flashBet = null;
    st.nextFlashAt = this.now + 3 * 60_000;
    const stakes = Object.entries(fb.stakes);
    if (!stakes.length) return;
    const pot = stakes.reduce((s, [, x]) => s + x.amount, 0);
    const winners = stakes.filter(([, x]) => x.opt === result);
    const total = pot + Math.max(30, Math.round(pot / 2));
    if (!winners.length) {
      this.emit({ floor: 0, kind: 'systeme', scope: 'global', drama: 40, text: `PARI ÉCLAIR : c'est « ${result} » ! Personne n'avait vu juste : la production empoche ${pot} points.` });
      return;
    }
    const winPot = winners.reduce((s, [, x]) => s + x.amount, 0);
    let best = { name: '', gain: 0 };
    for (const [key, x] of winners) {
      const gain = Math.floor((total * x.amount) / winPot);
      const w = (st.wallets[key] ??= { name: x.name, pts: 100, seen: this.now, lastSponsor: 0, won: 0, bets: 1, gain: 0 });
      w.pts += gain;
      w.won++;
      w.gain += gain - x.amount;
      if (gain > best.gain) best = { name: x.name, gain };
    }
    this.emit({ floor: 0, kind: 'systeme', scope: 'global', drama: 50, text: `PARI ÉCLAIR : c'est « ${result} » ! ${winners.length} parieur${winners.length > 1 ? 's' : ''} se partagent ${total} points (meilleur gain : ${best.name}, +${best.gain}).` });
  }

  /** Premier à sortir du Donjon : le grand pari est tranché (cagnotte + 100 points de la production). */
  private settleGrandBet(winner: PlayerState) {
    const gb = this.state.grandBet;
    const stakes = Object.entries(gb.stakes);
    gb.open = false;
    gb.stakes = {};
    if (!stakes.length) return;
    const pot = stakes.reduce((s, [, x]) => s + x.amount, 0);
    const winners = stakes.filter(([, x]) => x.target === winner.key);
    if (!winners.length) {
      this.emit({ floor: 0, kind: 'systeme', scope: 'global', drama: 60, text: `GRAND PARI : personne n'avait misé sur ${winner.name}. La production rafle ${pot} points et ricane.` });
      return;
    }
    const total = pot + 100;
    const winPot = winners.reduce((s, [, x]) => s + x.amount, 0);
    for (const [key, x] of winners) {
      const w = this.state.wallets[key];
      if (!w) continue;
      const gain = Math.floor((total * x.amount) / winPot);
      w.pts += gain;
      w.won++;
      w.gain += gain - x.amount;
    }
    this.emit({ floor: 0, kind: 'systeme', scope: 'global', drama: 90, text: `GRAND PARI GAGNÉ : ${winners.map(([key]) => this.state.wallets[key]?.name ?? key).slice(0, 5).join(', ')} avai${winners.length > 1 ? 'ent' : 't'} misé sur ${winner.name} et se partage${winners.length > 1 ? 'nt' : ''} ${total} points !` });
  }

  /** Éliminé : le crawler quitte la partie (il peut refaire !join pour recommencer avec un nouveau perso). */
  private gameOver(p: PlayerState) {
    this.leaveAlliance(p, false);
    delete this.state.players[p.key];
    for (const q of Object.values(this.state.players)) q.allyProposals = q.allyProposals.filter((k) => k !== p.key);
    p.alive = false; // la suite du tour l'ignore
  }

  private endSeason(f: FloorState) {
    this.state.seasonOver = true;
    for (const [key, x] of Object.entries(this.state.grandBet.stakes)) if (this.state.wallets[key]) this.state.wallets[key].pts += x.amount; // personne n'est sorti : remboursé
    this.state.grandBet.stakes = {};
    const stuck = Object.values(this.state.players).filter((p) => p.floor === f.n && p.alive).map((p) => p.name);
    const champs = this.state.champions.map((c) => c.name);
    this.emit({
      floor: f.n, kind: 'systeme', scope: 'global', drama: 200, seasonEnd: true,
      text: `FIN DE LA SAISON ! L'étage ${f.n} s'effondre et le Donjon se referme.${stuck.length ? ` ${stuck.join(', ')} y restent enfermés pour toujours (ou jusqu'à la prochaine saison).` : ''} ${champs.length ? `Légendes de la saison : ${champs.join(', ')}.` : 'Personne n\'est sorti : le Donjon a gagné.'}`,
    });
  }

  /** Sortie du donjon par l'escalier du dernier étage : le crawler entre dans la Légende et quitte la partie. */
  private finish(p: PlayerState) {
    const legend: Legend = {
      name: p.name, cls: p.cls, level: p.level, kills: p.kills, deaths: p.deaths, betrayals: p.betrayals, gold: p.gold,
      bot: !!p.bot, date: new Date(this.now).toISOString(), turn: this.state.turn, floor: p.floor,
    };
    this.state.champions.push(legend);
    if (this.state.champions.length === 1) this.settleGrandBet(p);
    this.emit({
      floor: p.floor, roomId: p.roomId, kind: 'niveau', scope: 'global', actors: [p.key], drama: 150, victory: legend, fx: { kind: 'levelup', src: `p:${p.name}` },
      text: `VICTOIRE ! ${p.name}${p.bot ? ' (PNJ)' : ''} sort du Donjon par la grande porte, niveau ${p.level}, ${p.kills} monstres terrassés. Son nom entre dans la Légende.`,
    });
    this.leaveAlliance(p, false);
    p.alive = false; // la suite du tour (thèmes, réapparitions) l'ignore
    p.pending = null;
    delete this.state.players[p.key];
    for (const q of Object.values(this.state.players)) q.allyProposals = q.allyProposals.filter((k) => k !== p.key);
  }

  /** Effondrement : ceux qui sont restés tombent à l'étage suivant (PV et or perdus, équipement gardé). */
  private collapse(f: FloorState) {
    f.collapsed = true;
    if (f.n >= this.cfg.finalFloor) return this.endSeason(f);
    // GAME OVER pour ceux qui n'ont pas pris l'escalier à temps (vivants ou fantômes) ; seuls les retardataires,
    // l'équipe de fermeture du donjon, tombent à l'étage suivant
    const here = Object.values(this.state.players).filter((p) => p.floor === f.n);
    const lost = here.filter((p) => !p.closer);
    const victims = here.filter((p) => p.closer && p.alive);
    const graves = new Map<string, number>();
    for (const p of lost) {
      if (!p.bot) graves.set(p.key, this.bury(p, f.n)); // numéro au vote de résurrection
      this.gameOver(p);
    }
    const humans = lost.filter((p) => !p.bot).map((p) => `${p.name} (n°${graves.get(p.key)})`);
    const npcs = lost.filter((p) => p.bot).length;
    this.emit({
      floor: f.n, kind: 'systeme', scope: 'global', drama: lost.length ? 90 : 60,
      text: `L'ÉTAGE ${f.n} S'EFFONDRE ! ${lost.length ? `GAME OVER pour ${[...humans, ...(npcs ? [`${npcs} PNJ`] : [])].join(', ')} : resté${lost.length > 1 ? 's' : ''} à l'intérieur. Tapez !join pour recommencer à l'étage 1.` : 'Personne n\'est resté coincé, bravo.'}`,
    });
    this.afterCollapse(f, humans.length > 0);
    if (!victims.length) return;
    const next = this.freshFloor(f.n + 1);
    const landing = next.rooms.filter((r) => r.type !== 'safe' && r.type !== 'boss' && !next.monsters.some((m) => m.hp > 0 && m.roomId === r.id));
    for (const p of victims) {
      const hpLoss = Math.max(1, Math.ceil(p.maxHp * 0.3));
      const goldLoss = Math.floor(p.gold * 0.4);
      p.hp = Math.max(1, p.hp - hpLoss);
      p.gold -= goldLoss;
      p.floor = next.n;
      p.roomId = landing.length ? this.rng.pick(landing).id : next.spawnRoom;
      p.deepest = Math.max(p.deepest, next.n);
      p.pending = null;
      p.lastAction = null;
      p.stunned = true; // sonné par la chute : il perd son prochain tour
      this.discover(p);
      this.startTimer(next, p);
      this.emit({
        floor: next.n, roomId: p.roomId, kind: 'drole', scope: 'global', actors: [p.key], drama: 60, fx: { kind: 'trap', dst: `p:${p.name}` },
        text: `${p.name} traverse le plancher dans un nuage de gravats et s'écrase à l'étage ${next.n}. Sonné, mais entier. (−${hpLoss} PV${goldLoss ? `, −${goldLoss} po perdues dans la chute` : ''})`,
      });
    }
  }

  // ------------------------------------------------- production, classement, régie

  /** Prix d'achat chez le marchand (moitié prix pendant l'happy hour). */
  price(item: Item): number {
    return this.state.turn < this.state.happyHourUntil ? Math.max(1, Math.ceil(item.value / 2)) : item.value;
  }

  private voteEvery(): number {
    return Math.max(3, Math.round((this.cfg.voteEveryMinutes * 60 * this.phases) / this.cfg.turnSeconds));
  }

  private castVote(p: PlayerState, arg: string): SubmitResult {
    const v = this.state.vote;
    if (!v) return { ok: false, text: 'Aucun vote en cours. La production prépare le prochain.' };
    const a = normalize(arg);
    let key: string | undefined;
    if (/^\d+$/.test(a)) key = v.options[Number(a) - 1];
    else key = v.options.find((k) => normalize(PRODUCTION_BY_KEY[k].label).includes(a) || k.includes(a));
    if (!a || !key) return { ok: false, text: `Vote : ${v.options.map((k, i) => `!vote ${i + 1} = ${PRODUCTION_BY_KEY[k].label}`).join(' · ')}` };
    v.votes[p.key] = key;
    return { ok: true, text: `Vote enregistré : ${PRODUCTION_BY_KEY[key].label}.` };
  }

  startVote() {
    const alive = Object.values(this.state.players).filter((p) => p.alive);
    const dead = Object.values(this.state.players).some((p) => !p.alive);
    const timed = Object.values(this.state.floors).some((f) => !f.collapsed && f.collapseAt !== null);
    const pool = PRODUCTION_EVENTS.filter((e) => {
      if (e.key === 'resurrection') return dead;
      if (e.key === 'prime') return alive.some((p) => p.kills > 0) && !this.state.bounty;
      if (e.key === 'prolongation' || e.key === 'acceleration') return timed;
      return true;
    }).map((e) => e.key);
    const options = this.rng.shuffle(pool).slice(0, 3);
    this.state.vote = { options, votes: {}, endTurn: this.state.turn + this.cfg.voteTurns * this.phases };
    this.emit({
      floor: 0, kind: 'systeme', scope: 'global', drama: 30,
      text: `LA PRODUCTION PROPOSE UN VOTE (${this.cfg.voteTurns} tours) : ${options.map((k, i) => `!vote ${i + 1} ${PRODUCTION_BY_KEY[k].label}`).join(' · ')}`,
    });
  }

  private updateProduction() {
    const st = this.state;
    if (st.resurrection && st.turn >= st.resurrection.endTurn) this.resolveResurrection();
    this.updateFlashBet();
    if (st.resurrection) return; // pas de vote de la production pendant la résurrection
    if (st.bounty && (st.turn > st.bounty.untilTurn || !st.players[st.bounty.target])) {
      const t = st.players[st.bounty.target];
      if (t) this.emit({ floor: t.floor, kind: 'systeme', scope: 'global', drama: 20, text: `La prime sur ${t.name} expire. Il a survécu, le chat est déçu.` });
      st.bounty = null;
    }
    if (st.vote && st.turn >= st.vote.endTurn) {
      const tally = new Map<string, number>();
      for (const k of Object.values(st.vote.votes)) tally.set(k, (tally.get(k) ?? 0) + 1);
      const best = Math.max(0, ...tally.values());
      const winners = st.vote.options.filter((k) => (tally.get(k) ?? 0) === best);
      const key = this.rng.pick(winners);
      const why = best === 0 ? 'personne n\'a voté, la production décide seule' : `${best} vote(s)`;
      st.vote = null;
      st.nextVoteTurn = st.turn + this.voteEvery();
      this.applyProduction(key, why);
      return;
    }
    if (this.cfg.voteEveryMinutes <= 0 || st.vote) return;
    if (!st.nextVoteTurn) st.nextVoteTurn = st.turn + this.voteEvery();
    if (st.turn >= st.nextVoteTurn && Object.values(st.players).some((p) => p.alive)) this.startVote();
  }

  applyProduction(key: string, why: string) {
    const ev = PRODUCTION_BY_KEY[key];
    if (!ev) return;
    const st = this.state;
    const live = Object.values(st.floors).filter((f) => !f.collapsed);
    const occupied = live.filter((f) => Object.values(st.players).some((p) => p.alive && p.floor === f.n));
    let detail = '';
    switch (key) {
      case 'pluie_or':
        for (const f of occupied) {
          const n = 4 + Object.values(st.players).filter((p) => p.floor === f.n).length;
          const rooms = f.rooms.filter((r) => r.type !== 'safe');
          for (let i = 0; i < n; i++) this.rng.pick(rooms).groundGold += this.rng.int(5, 20) * f.n;
        }
        detail = 'Des tas d\'or attendent dans des salles au hasard. Courez !';
        break;
      case 'lacher_monstres':
        for (const f of occupied) {
          const n = Math.max(2, Math.ceil(Object.values(st.players).filter((p) => p.floor === f.n).length / 2));
          const pool = MONSTERS.filter((m) => m.minFloor <= f.n);
          const free = () => f.rooms.filter((r) => (r.type === 'normale' || r.type === 'piege' || r.type === 'tresor') && this.monstersIn(f.n, r.id).length < this.maxMonstersPerRoom(f.n));
          for (let i = 0; i < n; i++) {
            const rooms = free();
            if (!rooms.length) break;
            const m = spawnMonster(this.rng.pick(pool), f.n, this.rng.pick(rooms).id, this.rng, this.nextId);
            m.wanderer = true;
            f.monsters.push(m);
          }
        }
        detail = 'Une fournée de monstres errants est lâchée dans les couloirs.';
        break;
      case 'happy_hour':
        st.happyHourUntil = st.turn + 10 * this.phases;
        for (const f of live) for (const r of f.rooms) if (r.type === 'safe' && !r.forge) for (let i = 0; i < 2; i++) r.merchant.push(randomLoot(this.rng, this.nextId, f.n, true));
        detail = 'Les marchands bradent tout à −50 % pendant 10 tours (et ont reçu du stock).';
        break;
      case 'resurrection': {
        let n = 0;
        for (const p of Object.values(st.players)) if (!p.alive) {
          p.respawnIn = 1;
          p.deathTurn = undefined;
          n++;
        }
        detail = `${n} crawler(s) reviennent d'entre les morts au prochain tour.`;
        break;
      }
      case 'prime': {
        const target = Object.values(st.players).filter((p) => p.alive).sort((a, b) => b.kills - a.kills)[0];
        if (target && target.kills > 0) {
          const gold = 50 * target.floor + 20 * target.kills;
          st.bounty = { target: target.key, gold, untilTurn: st.turn + 15 * this.phases };
          detail = `${gold} po pour qui tuera ${target.name} (${target.kills} kills) dans les 15 prochains tours.`;
        } else detail = 'Personne ne mérite de prime. Quelle bande de pacifistes.';
        break;
      }
      case 'inondation':
        st.floodUntil = st.turn + 5 * this.phases;
        detail = 'Le donjon est inondé pendant 5 tours : un déplacement sur trois finit en glissade.';
        break;
      case 'festin':
        for (const p of Object.values(st.players)) if (p.alive) p.hp = p.maxHp;
        detail = 'Buffet à volonté : tous les crawlers vivants sont soignés.';
        break;
      case 'pieges_promo':
        for (const f of live) {
          for (const r of f.rooms) if (r.type === 'piege') {
            r.trapArmed = true;
            r.trapRevealed = false;
          }
          for (const r of this.rng.shuffle(f.rooms.filter((x) => x.type === 'normale')).slice(0, 3)) {
            r.type = 'piege';
            r.trapArmed = true;
          }
        }
        detail = 'Tous les pièges sont réarmés, et trois salles de plus sont piégées.';
        break;
      case 'prolongation':
        for (const f of live) if (f.collapseAt !== null) {
          f.collapseAt += 3 * 60_000;
          f.warned5 = f.warned1 = false;
        }
        detail = 'Les étages tiendront 3 minutes de plus.';
        break;
      case 'acceleration':
        for (const f of live) if (f.collapseAt !== null) f.collapseAt = Math.max(this.now + 30_000, f.collapseAt - 2 * 60_000);
        detail = 'Les étages s\'effondreront 2 minutes plus tôt. Bon courage.';
        break;
    }
    this.emit({ floor: 0, kind: 'systeme', scope: 'global', drama: 60, text: `LA PRODUCTION A TRANCHÉ (${why}) : ${ev.label.toUpperCase()} ! ${detail}` });
  }

  private onPlayerKilled(p: PlayerState, killer: Fighter | null) {
    const b = this.state.bounty;
    if (!b || b.target !== p.key) return;
    this.state.bounty = null;
    if (killer?.kind === 'player' && killer.p.key !== p.key) {
      killer.p.gold += b.gold;
      this.gainXp(killer.p, 50);
      this.emit({ floor: p.floor, kind: 'systeme', scope: 'global', drama: 90, actors: [killer.p.key, p.key], text: `${killer.p.name} encaisse la prime sur ${p.name} : ${b.gold} po !` });
    } else this.emit({ floor: p.floor, kind: 'systeme', scope: 'global', drama: 60, actors: [p.key], text: `${p.name} est mort, mais personne n'encaisse la prime. La production garde l'argent.` });
  }

  leaderboard(): LeaderRow[] {
    const b = this.state.bounty;
    return Object.values(this.state.players)
      .map((p) => ({
        name: p.name, cls: p.cls, level: p.level, floor: p.floor, deepest: p.deepest, kills: p.kills, deaths: p.deaths,
        betrayals: p.betrayals, gold: p.gold, alive: p.alive, traitor: !!p.traitorUntilTurn, bounty: b?.target === p.key, ...(p.bot ? { bot: true } : {}),
      }))
      .sort((a, b2) => b2.deepest - a.deepest || b2.level - a.level || b2.kills - a.kills || a.deaths - b2.deaths)
      .slice(0, 50);
  }

  voteView(key: string | null): VoteView | null {
    const rz = this.state.resurrection;
    if (rz) {
      // Vote de résurrection : les candidats sont au cimetière, numérotés depuis leur élimination
      const voices = (no: number) => Object.values(rz.votes).filter((x) => x.no === no).reduce((s, x) => s + x.voices, 0);
      const mine = key ? rz.votes[key]?.no : undefined;
      return {
        title: 'QUI MÉRITE UNE SECONDE CHANCE ?',
        options: [...this.state.graveyard]
          .sort((a, b) => voices(b.no) - voices(a.no) || b.snap.level - a.snap.level)
          .slice(0, 6)
          .map((g) => ({ n: g.no, key: String(g.no), label: g.name, desc: `niv ${g.snap.level} · éliminé à l'étage ${g.floor}`, votes: voices(g.no) })),
        turnsLeft: Math.max(0, Math.ceil((rz.endTurn - this.state.turn) / this.phases)),
        myVote: mine !== undefined ? String(mine) : null,
      };
    }
    const v = this.state.vote;
    if (!v) return null;
    const count = (k: string) => Object.values(v.votes).filter((x) => x === k).length;
    return {
      options: v.options.map((k, i) => ({ n: i + 1, key: k, label: PRODUCTION_BY_KEY[k].label, desc: PRODUCTION_BY_KEY[k].desc, votes: count(k) })),
      turnsLeft: Math.max(0, Math.ceil((v.endTurn - this.state.turn) / this.phases)),
      myVote: key ? v.votes[key] ?? null : null,
    };
  }

  /** Paris, points de faveur et cimetière, pour les pages (key : le viewer, s'il en est un). */
  socialView(key: string | null, now = Date.now()) {
    const st = this.state;
    const fb = st.flashBet;
    const sum = (o: 'oui' | 'non') => (fb ? Object.values(fb.stakes).filter((x) => x.opt === o).reduce((s, x) => s + x.amount, 0) : 0);
    const byTarget = new Map<string, number>();
    for (const x of Object.values(st.grandBet.stakes)) byTarget.set(x.targetName, (byTarget.get(x.targetName) ?? 0) + x.amount);
    const w = key ? st.wallets[key] : undefined;
    const mine = key && fb ? fb.stakes[key] : undefined;
    return {
      bet: fb ? { title: fb.title, closesInSec: Math.max(0, Math.ceil((fb.closeAt - now) / 1000)), oui: sum('oui'), non: sum('non'), bettors: Object.keys(fb.stakes).length, mine: mine ? { opt: mine.opt, amount: mine.amount } : null } : null,
      grandBet: st.grandBet.open || byTarget.size ? { open: st.grandBet.open, pot: this.grandPot(), top: [...byTarget.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, pot]) => ({ name, pot })) } : null,
      bettors: Object.values(st.wallets).filter((x) => x.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3).map((x) => ({ name: x.name, gain: x.gain, pts: x.pts })),
      ...(key ? { myFavor: w?.pts ?? 100, myGrave: st.graveyard.find((g) => g.key === key)?.no ?? null } : {}),
    };
  }

  effectsView(): EffectsView {
    const st = this.state;
    const b = st.bounty;
    return {
      happyHourTurns: Math.max(0, st.happyHourUntil - st.turn),
      floodTurns: Math.max(0, st.floodUntil - st.turn),
      bounty: b && st.players[b.target] ? { target: st.players[b.target].name, gold: b.gold, turns: Math.max(0, b.untilTurn - st.turn) } : null,
      nextVoteInTurns: st.vote || this.cfg.voteEveryMinutes <= 0 ? null : Math.max(0, st.nextVoteTurn - st.turn),
    };
  }

  obituary(): { turn: number; text: string }[] {
    return this.state.events.filter((e) => e.kind === 'mort').slice(-8).reverse().map((e) => ({ turn: e.turn, text: e.text }));
  }

  /** Régie : déclenche l'effondrement d'un étage au prochain tour. */
  adminCollapse(n: number, now = Date.now()) {
    const f = this.state.floors[n];
    if (!f || f.collapsed) return false;
    f.startedAt ??= now;
    f.collapseAt = now;
    return true;
  }

  adminHealAll() {
    for (const p of Object.values(this.state.players)) if (p.alive) p.hp = p.maxHp;
    this.emit({ floor: 0, kind: 'systeme', scope: 'global', drama: 10, text: 'La régie soigne tout le monde. Profitez-en, ça n\'arrivera pas deux fois.' });
  }

  adminKick(name: string) {
    const p = this.player(name);
    if (!p) return false;
    this.leaveAlliance(p, false);
    delete this.state.players[p.key];
    for (const q of Object.values(this.state.players)) q.allyProposals = q.allyProposals.filter((k) => k !== p.key);
    this.emit({ floor: p.floor, kind: 'systeme', scope: 'global', drama: 10, text: `${p.name} a été expulsé du donjon par la régie.` });
    return true;
  }

  /** Un PNJ figurant entre dans le donjon (mêmes règles qu'un joueur, marqué PNJ). */
  joinBot(name: string, cls: string, closer = false): boolean {
    if (this.player(name)) return false;
    const r = this.join(name, cls, true);
    const p = this.player(name);
    if (!r.ok || !p) return false;
    if (closer) {
      p.closer = true;
      this.startTimer(this.floor(p.floor)!, p);
    }
    // Pas de discours d'accueil du marchand pour un figurant
    this.state.events = this.state.events.filter((e) => !(e.npc && e.to === p.key));
    this.out = this.out.filter((e) => !(e.npc && e.to === p.key));
    this.sync();
    return true;
  }

  /** Un PNJ cède sa place à un vrai joueur. */
  removeBot(name: string): boolean {
    const p = this.player(name);
    if (!p?.bot) return false;
    this.leaveAlliance(p, false);
    delete this.state.players[p.key];
    for (const q of Object.values(this.state.players)) q.allyProposals = q.allyProposals.filter((k) => k !== p.key);
    this.emit({ floor: p.floor, kind: 'systeme', scope: 'etage', drama: 5, text: `${p.name} (PNJ) range son arme et quitte le donjon : place aux vrais aventuriers !` });
    this.sync();
    return true;
  }

  /** Vide les évènements produits hors tour (régie) pour les distribuer. */
  flush(): GameEvent[] {
    const out = this.out;
    this.out = [];
    this.sync();
    return out;
  }

  // ----------------------------------------------------------------- vues

  meView(p: PlayerState): MeView {
    return {
      name: p.name, cls: p.cls, level: p.level, xp: p.xp, xpNext: xpNext(p.level), hp: p.hp, maxHp: p.maxHp, stats: { ...p.stats },
      statPoints: p.statPoints, gold: p.gold, weapon: p.weapon, armor: p.armor, items: p.items, alive: p.alive,
      respawnInTurns: p.alive ? 0 : p.respawnIn, immuneSeconds: Math.max(0, Math.ceil((p.immuneUntil - this.now) / 1000)),
      traitorTurns: p.traitorUntilTurn ? Math.max(0, Math.ceil((p.traitorUntilTurn - this.state.turn) / this.phases)) : 0,
      alliance: this.alliesOf(p).map((k) => this.state.players[k]?.name ?? k), pendingAllianceFrom: p.allyProposals.map((k) => this.state.players[k]?.name ?? k),
      floor: p.floor, roomId: p.roomId, pending: p.pending?.raw ?? null, kills: p.kills, deaths: p.deaths,
    };
  }

  private publicPlayer(o: PlayerState, viewer: PlayerState | null): PlayerPublic {
    return {
      name: o.name, cls: o.cls, level: o.level, hp: o.hp, maxHp: o.maxHp, alive: o.alive, immune: this.isImmune(o),
      traitor: !!o.traitorUntilTurn, ally: viewer ? this.isAlly(viewer, o) : false, me: viewer?.key === o.key,
      ...(o.bot ? { bot: true } : {}),
    };
  }

  private roomView(f: FloorState, r: RoomState, current: boolean, withOccupants: boolean, viewer: PlayerState | null): RoomView {
    const v: RoomView = {
      id: r.id, x: r.x, y: r.y, type: r.type, doors: r.doors, current, stairs: r.stairs,
      bossAlive: f.monsters.some((m) => m.boss && m.roomId === r.id && m.hp > 0), chest: r.chest, searched: !!r.searchedBy,
      trapArmed: r.trapArmed && (r.trapRevealed || !viewer), merchant: r.type === 'safe' && !r.forge, ...(r.forge ? { forge: true } : {}),
    };
    if (current || !viewer) v.desc = r.desc;
    if (withOccupants) {
      v.players = Object.values(this.state.players).filter((o) => o.floor === f.n && o.roomId === r.id && (o.alive || o.key === viewer?.key)).map((o) => this.publicPlayer(o, viewer));
      v.monsters = this.monstersIn(f.n, r.id).map((m): MonsterView => ({ id: m.id, name: m.name, kind: m.kind, sprite: m.sprite, hp: m.hp, maxHp: m.maxHp, boss: m.boss }));
      v.ground = r.ground;
      v.groundGold = r.groundGold;
    }
    return v;
  }

  floorView(f: FloorState, viewer: PlayerState | null): FloorView {
    const collapseInSec = f.collapseAt === null ? null : Math.max(0, Math.ceil((f.collapseAt - this.now) / 1000));
    let rooms: RoomView[];
    if (!viewer) rooms = f.rooms.map((r) => this.roomView(f, r, false, true, null));
    else {
      const team = [viewer, ...this.alliesOf(viewer).map((k) => this.state.players[k]).filter(Boolean)];
      const known = new Set<number>();
      for (const t of team) for (const id of t.discovered[f.n] ?? []) known.add(id);
      const watched = new Set(team.filter((t) => t.floor === f.n && t.alive).map((t) => t.roomId));
      watched.add(viewer.roomId);
      rooms = [...known].map((id) => this.roomView(f, f.rooms[id], id === viewer.roomId, watched.has(id), viewer));
    }
    const st = this.stairsInMs(f);
    return { n: f.n, uid: f.uid, theme: f.theme, collapseInSec, stairsInSec: st === null ? null : Math.ceil(st / 1000), rooms };
  }

  viewFor(name: string, now = Date.now()): { me: MeView | null; floor: FloorView | null; merchant: MerchantOffer[] | null; forge?: ForgeOffer | null } {
    this.now = now;
    const p = this.player(name);
    if (!p) return { me: null, floor: null, merchant: null };
    const f = this.state.floors[p.floor];
    const r = f?.rooms[p.roomId];
    const merchant = r && r.type === 'safe' && !r.forge && p.alive ? r.merchant.map((item, i) => ({ index: i + 1, item, price: this.price(item) })) : null;
    const forge = r?.forge && p.alive ? this.forgeOffer(p) : null;
    return { me: this.meView(p), floor: f ? this.floorView(f, p) : null, merchant, forge };
  }

  /** Vue d'un étage précis, s'il est debout (sinon null). */
  liveFloorView(n: number, now = Date.now()): FloorView | null {
    this.now = now;
    const f = this.state.floors[n];
    return f && !f.collapsed ? this.floorView(f, null) : null;
  }

  spectatorView(n: number | null, now = Date.now()): FloorView | null {
    this.now = now;
    const floors = Object.values(this.state.floors).filter((f) => !f.collapsed);
    const f = (n !== null && this.state.floors[n]) || floors.sort((a, b) => b.n - a.n)[0];
    return f ? this.floorView(f, null) : null;
  }

  /** Cet évènement concerne-t-il ce joueur ? */
  isRelevant(e: GameEvent, key: string | null): boolean {
    if (key === null) return e.scope !== 'prive';
    const p = this.state.players[key];
    if (!p) return e.scope === 'global';
    if (e.scope === 'global') return true;
    if (e.scope === 'prive') return e.to === key;
    if (e.scope === 'etage') return p.floor === e.floor;
    if (e.actors?.includes(key)) return true;
    if (p.floor === e.floor && p.roomId === e.roomId) return true;
    return this.alliesOf(p).some((k) => e.actors?.includes(k));
  }

  /** Monstres tués il y a 3 tours : ils réapparaissent dans une salle ordinaire vide (jamais sous le nez d'un joueur). */
  private respawnMonsters() {
    for (const f of Object.values(this.state.floors)) {
      if (f.collapsed || !f.respawns?.length) continue;
      const due = f.respawns.filter((x) => x.turn <= this.state.turn);
      if (!due.length) continue;
      f.respawns = f.respawns.filter((x) => x.turn > this.state.turn);
      const occupied = new Set(Object.values(this.state.players).filter((p) => p.alive && p.floor === f.n).map((p) => p.roomId));
      const rooms = f.rooms.filter((r) => r.type === 'normale' && r.id !== f.spawnRoom && !occupied.has(r.id));
      if (!rooms.length) {
        f.respawns.push(...due.map((x) => ({ ...x, turn: this.state.turn + 1 }))); // tout est occupé : au tour suivant
        continue;
      }
      for (const x of due) {
        const tpl = MONSTERS.find((t) => t.kind === x.kind) ?? this.rng.pick(MONSTERS.filter((t) => t.minFloor <= f.n));
        f.monsters.push(spawnMonster(tpl, f.n, this.rng.pick(rooms).id, this.rng, this.nextId));
      }
    }
  }

  /** Prévision du tour, pour la caméra du stream : d'après les commandes déjà tapées (et celles des PNJ, qui jouent
   *  dès le début du tour), où l'action va-t-elle avoir lieu ? Les vrais joueurs comptent triple. Une commande tapée
   *  après la prévision est simplement rattrapée par les évènements du tour. */
  forecast(): ForecastRoom[] {
    const acc = new Map<string, ForecastRoom>();
    const add = (floor: number, roomId: number, v: number) => {
      const k = `${floor}:${roomId}`;
      const cur = acc.get(k) ?? { floor, roomId, score: 0 };
      cur.score += v;
      acc.set(k, cur);
    };
    for (const p of Object.values(this.state.players)) {
      if (!p.alive || p.stunned) continue;
      const f = this.state.floors[p.floor];
      if (!f || f.collapsed) continue;
      const r = f.rooms[p.roomId];
      const w = p.bot ? 1 : 3;
      const here = f.monsters.filter((m) => m.hp > 0 && m.roomId === r.id);
      const boss = here.some((m) => m.boss);
      const a = p.pending ?? (p.lastAction?.name === 'attack' ? p.lastAction : null);
      if (!a) {
        if (here.length && r.type !== 'safe') add(f.n, r.id, 4 * w); // les monstres frappent quand même
        continue;
      }
      switch (a.name) {
        case 'attack':
          add(f.n, r.id, (boss ? 14 : here.length ? 8 : 10) * w); // sans monstre : un duel entre joueurs
          break;
        case 'move': {
          const to = r.doors[a.arg as Dir];
          if (to === undefined) break;
          const danger = f.monsters.some((m) => m.hp > 0 && m.roomId === to);
          add(f.n, to, (f.rooms[to].type === 'boss' && danger ? 12 : danger ? 6 : 2) * w);
          break;
        }
        case 'descend':
          add(f.n, r.id, 10 * w);
          break;
        case 'use':
        case 'equip':
          add(f.n, r.id, (here.length ? 5 : 1) * w);
          break;
        case 'search':
        case 'pickup':
          add(f.n, r.id, (r.chest === 'ferme' ? 5 : 2) * w);
          break;
        default:
          add(f.n, r.id, w);
      }
    }
    return [...acc.values()].filter((x) => x.score >= 4).sort((a, b) => b.score - a.score).slice(0, 8);
  }

  /** Étages debout, avec leurs occupants (pour le panneau « Les étages » du stream). */
  floorsSummary(now = Date.now()): FloorSummary[] {
    const alive = Object.values(this.state.players).filter((p) => p.alive);
    return Object.values(this.state.floors)
      .filter((f) => !f.collapsed)
      .map((f) => ({
        n: f.n, theme: f.theme,
        humans: alive.filter((p) => p.floor === f.n && !p.bot).length,
        bots: alive.filter((p) => p.floor === f.n && p.bot).length,
        collapseInSec: f.collapseAt === null ? null : Math.max(0, Math.ceil((f.collapseAt - now) / 1000)),
        stairsInSec: (() => {
          const ms = this.stairsInMs(f);
          return ms === null ? null : Math.ceil(ms / 1000);
        })(),
      }))
      .filter((s) => s.n === 1 || s.humans + s.bots > 0)
      .sort((a, b) => a.n - b.n);
  }

  /** Ajoute un commentaire de l'IA du donjon (ou du marchand) au journal et le renvoie. */
  narrate(text: string, floor: number, roomId?: number, scope: GameEvent['scope'] = 'global', actors?: string[]): GameEvent {
    this.out = [];
    this.emit({ floor, roomId, kind: 'drole', text, scope, actors, drama: 0, narrator: true });
    this.sync();
    return this.out[0];
  }
}

// ------------------------------------------------------------------- utilitaires

export function playerKey(name: string): string {
  return normalize(name).replace(/^@/, '').replace(/[^a-z0-9_]/g, '_').slice(0, 25);
}

function fmt(n: number) {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function parseClass(arg: string): ClassId | null {
  const a = normalize(arg);
  if (!a) return null;
  if (/^(barb|barbarian)/.test(a)) return 'barbare';
  if (/^(chev|knight)/.test(a)) return 'chevalier';
  if (/^(vol|rogue|thief)/.test(a)) return 'voleur';
  if (/^(mag|wiz)/.test(a)) return 'mage';
  return null;
}

export function parseStat(arg: string): StatId | null {
  const a = normalize(arg);
  if (/^(for|str)/.test(a)) return 'for';
  if (/^(agi|dex)/.test(a)) return 'agi';
  if (/^int/.test(a)) return 'int';
  if (/^(cha)/.test(a)) return 'cha';
  return null;
}
