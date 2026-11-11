// PNJ figurants : des crawlers pilotés par le serveur pour qu'il y ait toujours de la vie dans le donjon.
// Ils jouent avec les mêmes règles que les joueurs (une commande par tour) et restent pacifiques envers les
// joueurs. Ils restent même quand de vrais joueurs arrivent.
// Les « retardataires » arrivent après le premier vrai joueur, ne prennent jamais l'escalier et tombent avec
// chaque étage qui s'effondre : ils lancent le chrono des étages où ils atterrissent, si bien que la saison
// va toujours jusqu'à l'effondrement du dernier étage, même si le chat ralentit.
import type { Dir } from '../shared/types.js';
import { bfs } from './game/dungeon.js';
import type { Game } from './game/engine.js';
import type { PlayerState, RoomState } from './game/state.js';

const NAMES = [
  'Brunhilde', 'Gorim Greybeard', 'Elwyn', 'Tobias the Pale', 'Morgana', 'Krag', 'Sir Bertrand', 'Pippa',
  'Zoltan', 'Ysolde', 'Fennick', 'Agatha the Red', 'Hector', 'Lysandra', 'Bodo', 'Ragnhild', 'Corwin', 'Melisande',
];
const CLOSER_NAMES = ['Gaspard the Laggard', 'Granny Odette', 'Firmin', 'Hubert the Slow', 'Lady Petronella', 'Tobbin', 'Brother Anselm', 'Bertha'];
const CLASSES = ['barbare', 'chevalier', 'voleur', 'mage'];
const LINES = {
  idle: [
    'Anyone seen the stairs?', 'I heard something…', 'Smells like goblin in here.', 'I swear it was this way.',
    'My boots are leaking.', 'Who left this skull lying around?', 'Another empty room. Great.', 'We stick together, right?',
  ],
  fight: ['For glory!', 'Come here, you bag of HP!', 'Ouch. Okay. I\'m fine.', 'To me, to me!', 'You\'re gonna regret this!'],
  hurt: ['I don\'t feel so good…', 'Anyone got a potion?', 'I\'m bleeding, is that normal?'],
  loot: ['Gold! Finally!', 'That\'s mine now.', 'Nice loot.'],
  safe: ['Ah, some rest.', 'Merchant, your prices are a disgrace.', 'Let\'s catch our breath.'],
  welcome: ['Welcome, adventurer!', 'Reinforcements, at last!', 'Watch out for the traps.'],
  refuse: ['No offense, I work alone.', 'An alliance? With you? I thought about it. No.', 'Last time I trusted someone, I lost a boot.', 'Buy me a potion first, then we\'ll talk.'],
  closer: [
    'Wait for me!', 'Last one out turns off the lights.', 'We\'re in no hurry, us.', 'Has anyone seen my glasses?',
    'Is it shaking a bit, or is it just me?', 'The stairs? Never. We\'re closing up.', 'Just tidying up, coming!', 'Another floor to close down…',
  ],
};
const DIR_CMD: Record<Dir, string> = { n: '!north', s: '!south', e: '!east', o: '!west' };

export interface BotHooks {
  /** Exécute une commande pour un PNJ (journal, distribution des évènements). */
  submit: (name: string, text: string) => void;
  /** Fait parler un PNJ (bulle). */
  say: (name: string, text: string) => void;
  /** Position libre d'un PNJ dans sa salle (0..1), pour animer la page. */
  pos: (name: string, x: number, y: number) => void;
  /** Le joueur réel est-il actif (page ouverte, ou commande récente) ? */
  humanActive: (p: PlayerState) => boolean;
  /** Avis d'un PNJ sur un joueur (−10 … +10), d'après sa mémoire. */
  mood?: (pnj: string, playerKey: string) => number;
}

export class BotManager {
  target: number;
  closers: number;
  private lastHuman = new Map<string, number>(); // joueur réel -> dernière commande (ms)
  private visited = new Map<string, Set<string>>(); // PNJ -> salles vues (étage:salle)
  private lastSay = new Map<string, number>();

  constructor(private game: Game, private hooks: BotHooks, target: number, closers = 0) {
    this.target = Math.max(0, Math.min(30, target));
    this.closers = Math.max(0, Math.min(10, closers));
  }

  /** Un vrai joueur vient d'agir (page ou chat Twitch). */
  noteHuman(name: string, now = Date.now()) {
    const p = this.game.player(name);
    if (p && !p.bot) this.lastHuman.set(p.key, now);
  }

  recentlyActive(p: PlayerState, now = Date.now()): boolean {
    return now - (this.lastHuman.get(p.key) ?? 0) < 10 * 60_000;
  }

  bots(): PlayerState[] {
    return Object.values(this.game.state.players).filter((p) => p.bot);
  }

  humans(): PlayerState[] {
    return Object.values(this.game.state.players).filter((p) => !p.bot && this.hooks.humanActive(p));
  }

  /** Ajuste le nombre de PNJ vers la cible (un arrivant ou un départ par tour, pour que ce soit naturel).
   *  Les vrais joueurs ne les font plus partir. Les retardataires n'arrivent qu'une fois qu'un vrai joueur est entré. */
  balance() {
    const all = this.bots();
    this.adjust(all.filter((b) => !b.closer), this.target, false);
    const started = Object.values(this.game.state.players).some((p) => !p.bot) || this.game.state.champions.length > 0;
    if (started) this.adjust(all.filter((b) => b.closer), this.closers, true);
  }

  private adjust(bots: PlayerState[], want: number, closer: boolean) {
    if (bots.length > want) {
      // On retire d'abord un PNJ mort, en safe room, ou sinon le plus faible
      const pick = bots.find((b) => !b.alive) ?? bots.find((b) => b.alive && this.game.room(b).type === 'safe') ?? [...bots].sort((a, b) => a.level - b.level)[0];
      this.game.removeBot(pick.name);
      this.visited.delete(pick.key);
    } else if (bots.length < want) {
      const used = new Set(Object.values(this.game.state.players).map((p) => p.name));
      const name = (closer ? CLOSER_NAMES : NAMES).find((n) => !used.has(n)) ?? `${closer ? 'Laggard' : 'Mercenary'} ${Math.floor(Math.random() * 900 + 100)}`;
      const cls = CLASSES[Math.floor(Math.random() * CLASSES.length)];
      if (this.game.joinBot(name, cls, closer)) {
        const p = this.game.player(name)!;
        this.hooks.pos(name, 0.3 + Math.random() * 0.4, 0.5 + Math.random() * 0.4);
        if (closer) this.talk(p, 'closer', 1);
        else if (this.humans().some((h) => h.alive && h.floor === p.floor && h.roomId === p.roomId)) this.talk(p, 'welcome', 0.25);
      }
    }
  }

  /** Après chaque tour : ajuster l'effectif, puis chaque PNJ choisit sa prochaine action. */
  afterTurn() {
    if (this.game.state.seasonOver) return; // saison finie : les PNJ ne bougent plus
    this.balance();
    for (const b of this.bots()) {
      if (!b.alive) continue;
      const cmd = this.decide(b);
      if (cmd) this.hooks.submit(b.name, cmd);
    }
  }

  /** Petits déplacements dans la salle entre deux tours, pour que la page ait l'air vivante. */
  fidget() {
    if (this.game.state.seasonOver) return;
    for (const b of this.bots()) {
      if (!b.alive || Math.random() > 0.35) continue;
      this.hooks.pos(b.name, 0.15 + Math.random() * 0.7, 0.3 + Math.random() * 0.6);
    }
  }

  private talk(p: PlayerState, kind: keyof typeof LINES, chance: number) {
    const now = Date.now();
    if (Math.random() > chance || now - (this.lastSay.get(p.key) ?? 0) < 45_000) return;
    this.lastSay.set(p.key, now);
    const list = LINES[kind];
    this.hooks.say(p.name, list[Math.floor(Math.random() * list.length)]);
  }

  /** Règles simples : survivre, taper, ramasser, fouiller, explorer, descendre. Jamais d'attaque contre un joueur. */
  decide(p: PlayerState): string | null {
    const g = this.game;
    const f = g.floor(p.floor);
    if (!f) return null;
    const r = f.rooms[p.roomId];
    const monsters = f.monsters.filter((m) => m.roomId === r.id && m.hp > 0);
    const seen = this.visited.get(p.key) ?? new Set<string>();
    seen.add(`${f.n}:${r.id}`);
    this.visited.set(p.key, seen);

    // Proposition d'alliance d'un joueur : un ami accepte toujours, un inconnu une fois sur deux, une rancune jamais
    for (const k of [...p.allyProposals]) {
      const o = g.state.players[k];
      if (!o || o.bot || p.allianceId) continue;
      const mood = this.hooks.mood?.(p.name, o.key) ?? 0;
      if (mood >= 3 || (mood >= 0 && Math.random() < 0.5)) return `!ally ${o.name}`;
      p.allyProposals = p.allyProposals.filter((x) => x !== k); // refusé : il faudra redemander plus tard
      this.lastSay.delete(p.key);
      this.talk(p, 'refuse', 1);
    }
    if (p.statPoints > 0) return `!levelup ${p.cls === 'mage' ? 'int' : p.cls === 'voleur' ? 'dex' : 'str'}`;
    const potion = p.items.find((i) => i.tpl === 'potion' || i.tpl === 'grande_potion');
    if (p.hp <= p.maxHp * 0.35 && potion) {
      this.talk(p, 'hurt', 0.5);
      return `!use ${potion.name}`;
    }
    if (r.type === 'safe') {
      if (p.hp < p.maxHp) return '!rest';
      this.talk(p, 'safe', 0.08);
    }
    if (monsters.length) {
      // Trop amoché sans potion : on tente de fuir vers la safe room
      if (p.hp <= p.maxHp * 0.25 && !potion) {
        const dir = this.stepToward(p, f.spawnRoom);
        if (dir) return DIR_CMD[dir];
      }
      this.talk(p, 'fight', 0.15);
      const boss = monsters.find((m) => m.boss);
      if (boss && p.level < 3 && p.hp < p.maxHp * 0.7) {
        const dir = this.stepToward(p, f.spawnRoom);
        if (dir) return DIR_CMD[dir];
      }
      return '!attack';
    }
    if (r.ground.length || r.groundGold) {
      this.talk(p, 'loot', 0.3);
      return '!pickup';
    }
    if (r.type === 'tresor' && r.chest === 'ferme') return '!search';
    const open = g.stairsOpen(f);
    if (r.stairs && open && !p.closer && !f.monsters.some((m) => m.boss && m.hp > 0)) return '!descend';
    if (r.type !== 'safe' && !r.searchedBy && !r.trapArmed && Math.random() < 0.5) return '!search';

    // Déplacement : vers l'escalier si l'étage presse, sinon vers une salle encore inconnue
    // (les retardataires, eux, ne cherchent jamais l'escalier : ils restent jusqu'à l'effondrement)
    const pressing = f.collapseAt !== null && f.collapseAt - Date.now() < 6 * 60_000;
    // escalier scellé : on explore et on prend des niveaux ; descellé : on y va (les plus forts vont aussi taper le boss avant)
    const bossAlive = f.monsters.some((m) => m.boss && m.hp > 0);
    let dest: number | null = !p.closer && ((open && (pressing || p.level >= 2)) || (bossAlive && p.level >= 3 + Math.floor(f.n / 3))) ? f.bossRoom : null;
    if (dest === null) {
      const dist = bfs(f.rooms, r.id);
      let best = Infinity;
      for (const room of f.rooms) {
        if (seen.has(`${f.n}:${room.id}`) || room.type === 'safe') continue;
        const d = dist[room.id] + Math.random() * 1.5; // un peu de hasard pour ne pas suivre tous le même chemin
        if (d < best) {
          best = d;
          dest = room.id;
        }
      }
    }
    if (dest === null) dest = f.rooms[Math.floor(Math.random() * f.rooms.length)].id;
    if (dest === r.id) return Math.random() < 0.3 ? '!search' : null;
    this.talk(p, p.closer ? 'closer' : 'idle', p.closer ? 0.05 : 0.06);
    const dir = this.stepToward(p, dest);
    return dir ? DIR_CMD[dir] : null;
  }

  /** Première porte à prendre pour aller vers une salle (plus court chemin). */
  private stepToward(p: PlayerState, dest: number): Dir | null {
    const f = this.game.floor(p.floor)!;
    const dist = bfs(f.rooms, dest);
    const r: RoomState = f.rooms[p.roomId];
    let best: Dir | null = null;
    let bestD = dist[r.id];
    for (const [d, id] of Object.entries(r.doors) as [Dir, number][]) {
      if (dist[id] < bestD) {
        bestD = dist[id];
        best = d;
      }
    }
    return best;
  }
}
