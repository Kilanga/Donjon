// Le moteur de jeu : reçoit les commandes, résout les tours, produit les évènements.
import { HELP_TEXT, normalize, parseCommand, type ParsedCommand } from '../../shared/commands.js';
import type {
  ClassId, Dir, EffectsView, FloorView, GameEvent, GameFx, Item, LeaderRow, MeView, MerchantOffer, MonsterView, PlayerPublic, RoomView, StatId, VoteView,
} from '../../shared/types.js';
import type { GameConfig } from '../config.js';
import {
  CLASSES, CRIT_TEXTS, DEATH_TEXTS, FIASCO_TEXTS, GAG_TEXTS, RARITY_LABEL, SEARCH_FAIL_TEXTS, STAT_LABELS, TRAP_TEXTS,
} from './data.js';
import { DIR_LABEL, generateFloor, spawnMimic, spawnMonster } from './dungeon.js';
import { MONSTERS } from './data.js';
import { PRODUCTION_BY_KEY, PRODUCTION_EVENTS } from './production.js';
import { itemEffect, makeItem, randomLoot } from './items.js';
import { Rng } from './rng.js';
import { emptyState, migrate, type FloorState, type GameState, type MonsterState, type PlayerState, type RoomState } from './state.js';

export const INVENTORY_MAX = 8;
export const ALLIANCE_MAX = 4;
export const xpNext = (level: number) => 50 * level;
const half = (n: number) => Math.floor(n / 2);

type Fighter = { kind: 'player'; p: PlayerState } | { kind: 'monster'; m: MonsterState };

export interface SubmitResult {
  ok: boolean;
  text: string;
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
      this.emit({ floor: n, kind: 'systeme', text: `L'étage ${n} vient d'être creusé (${f.rooms.length} salles, thème : ${f.theme}).`, scope: 'global', drama: 5 });
    }
    return f;
  }

  private startTimer(f: FloorState) {
    if (f.startedAt === null) {
      f.startedAt = this.now;
      f.collapseAt = this.now + this.cfg.floorMinutes * 60_000;
    }
  }

  /** L'étage le moins profond encore debout : là où arrivent les nouveaux. */
  private entryFloor(): FloorState {
    const live = Object.values(this.state.floors).filter((f) => !f.collapsed).sort((a, b) => a.n - b.n);
    if (live.length) return live[0];
    const deepest = Math.max(0, ...Object.keys(this.state.floors).map(Number));
    return this.ensureFloor(deepest + 1);
  }

  /** Premier étage encore debout à partir de n. */
  private liveFloorFrom(n: number): FloorState {
    let k = n;
    while (this.state.floors[k]?.collapsed) k++;
    return this.ensureFloor(k);
  }

  // ------------------------------------------------------------- commandes

  submit(name: string, raw: string, now = Date.now()): SubmitResult {
    this.now = now;
    const cmd = parseCommand(raw);
    if (!cmd) return { ok: false, text: 'Commande inconnue. Tape !aide pour la liste.' };
    const res = this.handle(name, cmd);
    this.sync();
    return res;
  }

  private handle(name: string, cmd: ParsedCommand): SubmitResult {
    if (cmd.name === 'help') return { ok: true, text: HELP_TEXT.join('\n') };
    const p = this.player(name);
    if (cmd.name === 'join') return this.join(name, cmd.arg);
    if (!p) return { ok: false, text: 'Tu n\'es pas encore dans le donjon. Tape !join [barbare|chevalier|voleur|mage].' };

    switch (cmd.name) {
      case 'status':
        return { ok: true, text: this.statusText(p) };
      case 'shop':
        return this.shopText(p);
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

  private join(name: string, arg: string): SubmitResult {
    const key = playerKey(name);
    if (!key) return { ok: false, text: 'Pseudo invalide.' };
    if (this.state.players[key]) return { ok: false, text: 'Tu es déjà dans le donjon !' };
    const cls = parseClass(arg) ?? this.rng.pick(Object.keys(CLASSES) as ClassId[]);
    const def = CLASSES[cls];
    const f = this.entryFloor();
    this.startTimer(f);
    const p: PlayerState = {
      key, name: name.trim().slice(0, 24), cls, level: 1, xp: 0, hp: def.hp, maxHp: def.hp, stats: { ...def.stats }, statPoints: 0, gold: 10,
      weapon: makeItem(def.startWeapon, this.nextId), armor: def.startArmor ? makeItem(def.startArmor, this.nextId) : null,
      items: [makeItem('potion', this.nextId), makeItem('potion', this.nextId)], floor: f.n, roomId: f.spawnRoom, alive: true, respawnIn: 0,
      immuneUntil: this.now + this.cfg.immunitySeconds * 1000, allianceId: null, allyProposals: [], traitorUntilTurn: 0,
      pending: null, lastAction: null, stunned: false, buffs: { cloakTurns: 0, mirror: false, smoke: false, coupon: false },
      discovered: {}, kills: 0, deaths: 0, betrayals: 0, deepest: f.n, joinedTurn: this.state.turn,
    };
    this.state.players[key] = p;
    this.discover(p);
    this.emit({ floor: f.n, roomId: p.roomId, kind: 'systeme', text: `${p.name} le ${def.label} entre dans le donjon (étage ${f.n}) !`, scope: 'global', actors: [key], drama: 5 });
    return { ok: true, text: `Bienvenue, ${def.label} ! Tu es dans la safe room de l'étage ${f.n}. Tu es immunisé contre les autres joueurs pendant ${Math.round(this.cfg.immunitySeconds / 60)} min.` };
  }

  private statusText(p: PlayerState): string {
    const c = CLASSES[p.cls];
    const st = (Object.keys(STAT_LABELS) as StatId[]).map((s) => `${s.toUpperCase()} ${fmt(p.stats[s])}`).join(' ');
    return `${p.name}, ${c.label} niv. ${p.level} — ${p.hp}/${p.maxHp} PV — ${st} — ${p.gold} po — XP ${p.xp}/${xpNext(p.level)}${p.statPoints ? ` — ${p.statPoints} point(s) à dépenser (!monte)` : ''}`;
  }

  private shopText(p: PlayerState): SubmitResult {
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
      if (target && target.length >= ALLIANCE_MAX) return { ok: false, text: `Alliance complète (${ALLIANCE_MAX} maximum).` };
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
    this.state.turn++;
    const players = Object.values(this.state.players);

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

    // 1. Actions utilitaires (objets, commerce, repos)
    for (const p of players) {
      const a = actions.get(p.key);
      if (!a || !p.alive) continue;
      if (a.name === 'use' || a.name === 'equip') this.doUse(p, a.arg, a.name === 'equip');
      else if (a.name === 'buy') this.doBuy(p, a.arg);
      else if (a.name === 'sell') this.doSell(p, a.arg);
      else if (a.name === 'rest') this.doRest(p);
      else if (a.name === 'pickup') this.doPickup(p, a.arg);
    }

    // 2. Combats : joueurs et monstres, par ordre d'initiative
    const attackedBy = new Map<string, Fighter[]>();
    type Intent = { init: number; attacker: Fighter; arg?: string };
    const intents: Intent[] = [];
    for (const p of players) {
      const a = actions.get(p.key);
      if (a?.name === 'attack' && p.alive) intents.push({ init: this.rng.die(20) + p.stats.agi, attacker: { kind: 'player', p }, arg: a.arg });
    }
    for (const f of Object.values(this.state.floors)) {
      if (f.collapsed) continue;
      for (const m of f.monsters) {
        if (m.hp <= 0) continue;
        const r = f.rooms[m.roomId];
        if (r.type === 'safe') continue;
        if (this.playersIn(f.n, m.roomId).length === 0) continue;
        intents.push({ init: this.rng.die(20) + m.atk, attacker: { kind: 'monster', m } });
      }
    }
    intents.sort((a, b) => b.init - a.init);
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

    // 3. Ripostes des joueurs inactifs attaqués
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
      if (f.collapsed) continue;
      for (const m of f.monsters) {
        if (m.distracted > 0) m.distracted--;
        if (!m.wanderer || m.hp <= 0 || this.playersIn(f.n, m.roomId).length) continue;
        if (!this.rng.chance(0.35)) continue;
        const exits = Object.values(f.rooms[m.roomId].doors).filter((id) => id !== undefined && f.rooms[id!].type !== 'safe' && f.rooms[id!].type !== 'boss') as number[];
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
    if (this.isImmune(a)) return 'Tu es encore immunisé : tu ne peux pas attaquer d\'autres joueurs.';
    if (this.isImmune(b)) return `${b.name} est immunisé pour le moment.`;
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
    a.traitorUntilTurn = this.state.turn + 10;
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
      text: `${base} Cause : ${cause}. Son loot (${dropped.length} objet(s), ${goldLost} po) traîne au sol. −${xpLost} XP.`,
      drama: absurd ? 120 : 80,
    });
    if (killer?.kind === 'player') {
      const k = killer.p;
      k.kills++;
      const arena = r.type === 'arene' ? 2 : 1;
      this.gainXp(k, 20 * p.level * arena);
    }
    if (killer?.kind === 'monster') killer.m.aggro = null;
    this.onPlayerKilled(p, killer);
  }

  private killMonster(m: MonsterState, floorN: number, killer: PlayerState | null) {
    const f = this.state.floors[floorN];
    m.hp = 0;
    f.monsters = f.monsters.filter((x) => x !== m);
    if (!killer) return;
    killer.kills++;
    killer.gold += m.gold;
    // XP partagée entre les alliés présents dans la salle
    const sharers = [killer, ...this.alliesOf(killer).map((k) => this.state.players[k]).filter((a) => a && a.alive && a.floor === floorN && a.roomId === killer.roomId)];
    const share = Math.ceil(m.xp / sharers.length);
    for (const s of sharers) this.gainXp(s, share);
    const shareTxt = sharers.length > 1 ? ` (XP partagée : ${share} chacun)` : ` (+${m.xp} XP)`;
    this.roomEvent(killer, floorN, m.roomId, 'combat', `${killer.name} terrasse ${m.name} et récupère ${m.gold} po${shareTxt}.`, m.boss ? 80 : 5, [], { kind: 'kill', src: `p:${killer.name}`, dst: `m:${m.id}` });
    if (m.boss) this.emit({ floor: floorN, kind: 'systeme', text: `${m.name} est vaincu par ${killer.name} ! L'escalier de l'étage ${floorN} est libre : !descendre dans la salle du boss.`, scope: 'global', actors: [killer.key], drama: 80 });
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
        return this.roomEvent(p, p.floor, p.roomId, 'drole', `${p.name} fait couiner un canard. ${r.trapArmed ? 'Un piège se trahit en couinant en retour !' : 'Rien ne se passe, mais tout le monde sourit.'}`, 10);
      case 'crown':
        this.gainXp(p, xpNext(p.level) - p.xp);
        return this.roomEvent(p, p.floor, p.roomId, 'drole', `${p.name} pose une couronne en carton sur sa tête. Le donjon reconnaît son autorité.`, 30);
      default:
        return this.roomEvent(p, p.floor, p.roomId, 'drole', `${p.name} utilise ${item.name}. Il ne se passe absolument rien.`, 15);
    }
  }

  private doBuy(p: PlayerState, arg: string) {
    const r = this.room(p);
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
    const dmg = this.rng.die(6) + half(f.n);
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
    if (this.state.turn < this.state.floodUntil && r.type !== 'safe' && this.rng.chance(1 / 3)) {
      return this.roomEvent(p, p.floor, r.id, 'drole', `${p.name} glisse dans l'eau en voulant aller au ${DIR_LABEL[dir]} et fait un plat magnifique.`, 15);
    }
    const hostiles = this.monstersIn(p.floor, p.roomId).filter((m) => m.distracted <= 0);
    if (hostiles.length && r.type !== 'safe') {
      if (p.buffs.smoke) p.buffs.smoke = false;
      else {
        const dc = 10 + Math.max(...hostiles.map((m) => m.atk));
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
    const next = this.liveFloorFrom(f.n + 1);
    this.startTimer(next);
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
      if (left <= 0) this.collapse(f);
    }
    // Réapparitions
    for (const p of players) {
      if (p.alive || p.deathTurn === this.state.turn) continue;
      p.respawnIn--;
      if (p.respawnIn > 0) continue;
      const f = this.liveFloorFrom(p.floor);
      this.startTimer(f);
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
    }
  }

  private collapse(f: FloorState) {
    f.collapsed = true;
    const next = this.liveFloorFrom(f.n + 1);
    const victims = Object.values(this.state.players).filter((p) => p.floor === f.n && p.alive);
    this.emit({ floor: f.n, kind: 'systeme', text: `L'ÉTAGE ${f.n} S'EFFONDRE ! ${victims.length ? `${victims.map((v) => v.name).join(', ')} n'ont pas trouvé la sortie.` : 'Personne n\'est resté coincé, bravo.'}`, scope: 'global', drama: 70 });
    for (const p of victims) this.killPlayer(p, `l'effondrement de l'étage ${f.n}`, null);
    // Les morts de cet étage réapparaîtront à l'étage ${next.n} (voir liveFloorFrom)
  }

  // ------------------------------------------------- production, classement, régie

  /** Prix d'achat chez le marchand (moitié prix pendant l'happy hour). */
  price(item: Item): number {
    return this.state.turn < this.state.happyHourUntil ? Math.max(1, Math.ceil(item.value / 2)) : item.value;
  }

  private voteEvery(): number {
    return Math.max(3, Math.round((this.cfg.voteEveryMinutes * 60) / this.cfg.turnSeconds));
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
    this.state.vote = { options, votes: {}, endTurn: this.state.turn + this.cfg.voteTurns };
    this.emit({
      floor: 0, kind: 'systeme', scope: 'global', drama: 30,
      text: `LA PRODUCTION PROPOSE UN VOTE (${this.cfg.voteTurns} tours) : ${options.map((k, i) => `!vote ${i + 1} ${PRODUCTION_BY_KEY[k].label}`).join(' · ')}`,
    });
  }

  private updateProduction() {
    const st = this.state;
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
          const rooms = f.rooms.filter((r) => r.type === 'normale' || r.type === 'piege' || r.type === 'tresor');
          for (let i = 0; i < n && rooms.length; i++) {
            const m = spawnMonster(this.rng.pick(pool), f.n, this.rng.pick(rooms).id, this.rng, this.nextId);
            m.wanderer = true;
            f.monsters.push(m);
          }
        }
        detail = 'Une fournée de monstres errants est lâchée dans les couloirs.';
        break;
      case 'happy_hour':
        st.happyHourUntil = st.turn + 10;
        for (const f of live) for (const r of f.rooms) if (r.type === 'safe') for (let i = 0; i < 2; i++) r.merchant.push(randomLoot(this.rng, this.nextId, f.n, true));
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
          st.bounty = { target: target.key, gold, untilTurn: st.turn + 15 };
          detail = `${gold} po pour qui tuera ${target.name} (${target.kills} kills) dans les 15 prochains tours.`;
        } else detail = 'Personne ne mérite de prime. Quelle bande de pacifistes.';
        break;
      }
      case 'inondation':
        st.floodUntil = st.turn + 5;
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
        betrayals: p.betrayals, gold: p.gold, alive: p.alive, traitor: !!p.traitorUntilTurn, bounty: b?.target === p.key,
      }))
      .sort((a, b2) => b2.deepest - a.deepest || b2.level - a.level || b2.kills - a.kills || a.deaths - b2.deaths)
      .slice(0, 50);
  }

  voteView(key: string | null): VoteView | null {
    const v = this.state.vote;
    if (!v) return null;
    const count = (k: string) => Object.values(v.votes).filter((x) => x === k).length;
    return {
      options: v.options.map((k, i) => ({ n: i + 1, key: k, label: PRODUCTION_BY_KEY[k].label, desc: PRODUCTION_BY_KEY[k].desc, votes: count(k) })),
      turnsLeft: Math.max(0, v.endTurn - this.state.turn),
      myVote: key ? v.votes[key] ?? null : null,
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
      traitorTurns: p.traitorUntilTurn ? Math.max(0, p.traitorUntilTurn - this.state.turn) : 0,
      alliance: this.alliesOf(p).map((k) => this.state.players[k]?.name ?? k), pendingAllianceFrom: p.allyProposals.map((k) => this.state.players[k]?.name ?? k),
      floor: p.floor, roomId: p.roomId, pending: p.pending?.raw ?? null, kills: p.kills, deaths: p.deaths,
    };
  }

  private publicPlayer(o: PlayerState, viewer: PlayerState | null): PlayerPublic {
    return {
      name: o.name, cls: o.cls, level: o.level, hp: o.hp, maxHp: o.maxHp, alive: o.alive, immune: this.isImmune(o),
      traitor: !!o.traitorUntilTurn, ally: viewer ? this.isAlly(viewer, o) : false, me: viewer?.key === o.key,
    };
  }

  private roomView(f: FloorState, r: RoomState, current: boolean, withOccupants: boolean, viewer: PlayerState | null): RoomView {
    const v: RoomView = {
      id: r.id, x: r.x, y: r.y, type: r.type, doors: r.doors, current, stairs: r.stairs,
      bossAlive: f.monsters.some((m) => m.boss && m.roomId === r.id && m.hp > 0), chest: r.chest, searched: !!r.searchedBy,
      trapArmed: r.trapArmed && (r.trapRevealed || !viewer), merchant: r.type === 'safe',
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
    return { n: f.n, theme: f.theme, collapseInSec, rooms };
  }

  viewFor(name: string, now = Date.now()): { me: MeView | null; floor: FloorView | null; merchant: MerchantOffer[] | null } {
    this.now = now;
    const p = this.player(name);
    if (!p) return { me: null, floor: null, merchant: null };
    const f = this.state.floors[p.floor];
    const r = f?.rooms[p.roomId];
    const merchant = r && r.type === 'safe' && p.alive ? r.merchant.map((item, i) => ({ index: i + 1, item, price: this.price(item) })) : null;
    return { me: this.meView(p), floor: f ? this.floorView(f, p) : null, merchant };
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
