// PNJ figurants : des crawlers pilotés par le serveur pour qu'il y ait toujours de la vie dans le donjon.
// Ils jouent avec les mêmes règles que les joueurs (une commande par tour), restent pacifiques envers les
// joueurs, et cèdent leur place un par un quand de vrais joueurs arrivent.
import type { Dir } from '../shared/types.js';
import { bfs } from './game/dungeon.js';
import type { Game } from './game/engine.js';
import type { PlayerState, RoomState } from './game/state.js';

const NAMES = [
  'Brunhilde', 'Gorim Barbe-Grise', 'Elwyn', 'Tobias le Pâle', 'Morgane', 'Krag', 'Sire Bertrand', 'Pippa',
  'Zoltan', 'Ysolde', 'Fennick', 'Agathe la Rouge', 'Hector', 'Lysandra', 'Bodo', 'Ragnhild', 'Corwin', 'Mélisande',
];
const CLASSES = ['barbare', 'chevalier', 'voleur', 'mage'];
const LINES = {
  idle: [
    'Quelqu\'un a vu l\'escalier ?', 'J\'ai entendu un bruit…', 'Ça sent le gobelin par ici.', 'Je suis sûr que c\'était par là.',
    'Mes bottes prennent l\'eau.', 'Qui a laissé traîner ce crâne ?', 'Encore une salle vide. Super.', 'On reste groupés, hein ?',
  ],
  fight: ['Pour la gloire !', 'Viens là, sac à PV !', 'Aïe. Bon. Ça va.', 'À moi, à moi !', 'Tu vas voir ce que tu vas voir !'],
  hurt: ['Je ne me sens pas très bien…', 'Quelqu\'un a une potion ?', 'Je saigne, c\'est normal ?'],
  loot: ['De l\'or ! Enfin !', 'Ça, c\'est à moi.', 'Joli butin.'],
  safe: ['Ah, un peu de repos.', 'Marchand, tes prix sont une honte.', 'On respire un peu.'],
  welcome: ['Bienvenue, l\'aventurier !', 'Enfin du renfort !', 'Fais attention aux pièges.'],
};
const DIR_CMD: Record<Dir, string> = { n: '!nord', s: '!sud', e: '!est', o: '!ouest' };

export interface BotHooks {
  /** Exécute une commande pour un PNJ (journal, distribution des évènements). */
  submit: (name: string, text: string) => void;
  /** Fait parler un PNJ (bulle). */
  say: (name: string, text: string) => void;
  /** Position libre d'un PNJ dans sa salle (0..1), pour animer la page. */
  pos: (name: string, x: number, y: number) => void;
  /** Le joueur réel est-il actif (page ouverte, ou commande récente) ? */
  humanActive: (p: PlayerState) => boolean;
}

export class BotManager {
  target: number;
  private lastHuman = new Map<string, number>(); // joueur réel -> dernière commande (ms)
  private visited = new Map<string, Set<string>>(); // PNJ -> salles vues (étage:salle)
  private lastSay = new Map<string, number>();

  constructor(private game: Game, private hooks: BotHooks, target: number) {
    this.target = Math.max(0, Math.min(30, target));
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

  /** Ajuste le nombre de PNJ : target moins les vrais joueurs actifs. Un arrivant ou un départ par tour, pour que ce soit naturel. */
  balance() {
    const want = Math.max(0, this.target - this.humans().length);
    const bots = this.bots();
    if (bots.length > want) {
      // On retire d'abord un PNJ mort, en safe room, ou sinon le plus faible
      const pick = bots.find((b) => !b.alive) ?? bots.find((b) => b.alive && this.game.room(b).type === 'safe') ?? [...bots].sort((a, b) => a.level - b.level)[0];
      this.game.removeBot(pick.name);
      this.visited.delete(pick.key);
    } else if (bots.length < want) {
      const used = new Set(Object.values(this.game.state.players).map((p) => p.name));
      const name = NAMES.find((n) => !used.has(n)) ?? `Mercenaire ${Math.floor(Math.random() * 900 + 100)}`;
      const cls = CLASSES[Math.floor(Math.random() * CLASSES.length)];
      if (this.game.joinBot(name, cls)) {
        const p = this.game.player(name)!;
        this.hooks.pos(name, 0.3 + Math.random() * 0.4, 0.5 + Math.random() * 0.4);
        if (this.humans().some((h) => h.alive && h.floor === p.floor && h.roomId === p.roomId)) this.talk(p, 'welcome', 1);
      }
    }
  }

  /** Après chaque tour : ajuster l'effectif, puis chaque PNJ choisit sa prochaine action. */
  afterTurn() {
    this.balance();
    for (const b of this.bots()) {
      if (!b.alive) continue;
      const cmd = this.decide(b);
      if (cmd) this.hooks.submit(b.name, cmd);
    }
  }

  /** Petits déplacements dans la salle entre deux tours, pour que la page ait l'air vivante. */
  fidget() {
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

    if (p.statPoints > 0) return `!monte ${p.cls === 'mage' ? 'int' : p.cls === 'voleur' ? 'agi' : 'for'}`;
    const potion = p.items.find((i) => i.tpl === 'potion' || i.tpl === 'grande_potion');
    if (p.hp <= p.maxHp * 0.35 && potion) {
      this.talk(p, 'hurt', 0.5);
      return `!utilise ${potion.name}`;
    }
    if (r.type === 'safe') {
      if (p.hp < p.maxHp) return '!repos';
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
      return '!attaque';
    }
    if (r.ground.length || r.groundGold) {
      this.talk(p, 'loot', 0.3);
      return '!ramasse';
    }
    if (r.type === 'tresor' && r.chest === 'ferme') return '!fouille';
    if (r.stairs && !f.monsters.some((m) => m.boss && m.hp > 0)) return '!descendre';
    if (r.type !== 'safe' && !r.searchedBy && !r.trapArmed && Math.random() < 0.5) return '!fouille';
    if (g.state.vote && !g.state.vote.votes[p.key] && Math.random() < 0.3) return `!vote ${1 + Math.floor(Math.random() * g.state.vote.options.length)}`;

    // Déplacement : vers l'escalier si l'étage presse, sinon vers une salle encore inconnue
    const pressing = f.collapseAt !== null && f.collapseAt - Date.now() < 6 * 60_000;
    let dest: number | null = pressing || p.level >= 3 ? f.bossRoom : null;
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
    if (dest === r.id) return Math.random() < 0.3 ? '!fouille' : null;
    this.talk(p, 'idle', 0.06);
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
