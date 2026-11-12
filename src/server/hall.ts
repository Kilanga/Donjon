// Palmarès : les saisons et leurs gagnants, gardés d'une partie à l'autre (data/palmares.json).
// Victoria s'en sert : « Kilak revient avec trois couronnes… ». Seuls les vrais joueurs comptent (jamais les PNJ).
// Gagnant d'une saison : le premier sorti par le dernier escalier (une Légende) ; sinon le vrai joueur allé le plus
// profond (à partir de l'étage 2), puis le plus haut niveau.
import type { GameEvent } from '../shared/types.js';
import { playerKey, type Game } from './game/engine.js';
import { readJsonSafe, writeAtomic } from './fsutil.js';

export interface HallPlayer {
  name: string;
  seasons: number; // saisons jouées
  wins: number; // saisons gagnées
  legends: number; // sorties par le dernier escalier
  bestFloor: number;
  lastSeason: number;
}
export interface HallSeason {
  n: number;
  date: string;
  winner: string | null;
  how: 'legend' | 'deepest' | null;
  floor: number; // étage du gagnant
  players: number; // vrais joueurs de la saison
}
interface HallData {
  seasons: HallSeason[];
  players: Record<string, HallPlayer>;
}
interface Entry {
  name: string;
  deepest: number;
  level: number;
  legend: boolean;
}

const MIN_WIN_FLOOR = 2;

export class Hall {
  private data: HallData = { seasons: [], players: {} };
  private current = new Map<string, Entry>(); // vrais joueurs de la saison en cours
  /** La saison qui vient de se terminer (pour l'annonce de Victoria), effacée une fois lue. */
  justClosed: HallSeason | null = null;

  constructor(private file: string | null) {
    if (!file) return;
    const d = readJsonSafe<HallData>(file, 'hall of fame');
    if (d && Array.isArray(d.seasons) && d.players && typeof d.players === 'object') this.data = d;
  }

  get seasonCount(): number {
    return this.data.seasons.length;
  }

  player(key: string): HallPlayer | undefined {
    return this.data.players[key];
  }

  onEvents(events: GameEvent[], game: Game) {
    for (const e of events) {
      if (e.victory && !e.victory.bot) {
        const key = playerKey(e.victory.name);
        const c = this.current.get(key) ?? { name: e.victory.name, deepest: e.victory.floor, level: e.victory.level, legend: false };
        c.legend = true;
        c.deepest = Math.max(c.deepest, e.victory.floor);
        this.current.set(key, c);
      }
    }
    // Les vrais joueurs présents : leur étage le plus profond (ils peuvent disparaître à un GAME OVER, on garde la trace)
    for (const p of Object.values(game.state.players)) {
      if (p.bot) continue;
      const c = this.current.get(p.key) ?? { name: p.name, deepest: 1, level: 1, legend: false };
      c.deepest = Math.max(c.deepest, p.deepest ?? p.floor);
      c.level = Math.max(c.level, p.level);
      this.current.set(p.key, c);
    }
    if (events.some((e) => e.seasonEnd)) this.closeSeason();
  }

  private closeSeason() {
    const entries = [...this.current.entries()];
    this.current.clear();
    if (!entries.length) return; // saison sans vrai joueur : rien à retenir
    const n = this.data.seasons.length + 1;
    const legend = entries.find(([, c]) => c.legend);
    const best = [...entries].sort(([, a], [, b]) => b.deepest - a.deepest || b.level - a.level)[0];
    const win = legend ?? (best[1].deepest >= MIN_WIN_FLOOR ? best : undefined);
    for (const [key, c] of entries) {
      const h = (this.data.players[key] ??= { name: c.name, seasons: 0, wins: 0, legends: 0, bestFloor: 0, lastSeason: 0 });
      h.name = c.name;
      h.seasons++;
      h.bestFloor = Math.max(h.bestFloor, c.deepest);
      h.lastSeason = n;
      if (c.legend) h.legends++;
      if (win && win[0] === key) h.wins++;
    }
    const season: HallSeason = {
      n,
      date: new Date().toISOString(),
      winner: win ? win[1].name : null,
      how: win ? (win[1].legend ? 'legend' : 'deepest') : null,
      floor: win ? win[1].deepest : 0,
      players: entries.length,
    };
    this.data.seasons.push(season);
    this.justClosed = season;
    this.save();
  }

  private save() {
    if (!this.file) return;
    try {
      writeAtomic(this.file, JSON.stringify(this.data, null, 1));
    } catch (err) {
      console.error('[hall] not saved:', err);
    }
  }

  /** Ce que Victoria sait d'un joueur (null : premier passage). En anglais, pour ses consignes. */
  describe(key: string): string | null {
    const h = this.data.players[key];
    if (!h) return null;
    const parts = [
      h.wins ? `${h.wins} season win${h.wins > 1 ? 's' : ''}` : 'never won a season',
      h.legends ? `escaped the Dungeon ${h.legends} time${h.legends > 1 ? 's' : ''}` : '',
      `${h.seasons} season${h.seasons > 1 ? 's' : ''} played`,
      `deepest floor ${h.bestFloor}`,
    ].filter(Boolean);
    const reigning = this.reigning();
    return `${parts.join(', ')}${reigning && reigning.winner === h.name ? ', reigning champion' : ''}`;
  }

  /** Le dernier gagnant connu. */
  reigning(): HallSeason | undefined {
    return [...this.data.seasons].reverse().find((s) => s.winner);
  }

  /** Le palmarès en une ligne (null s'il est vide). */
  summary(): string | null {
    const ranked = Object.values(this.data.players).filter((h) => h.wins > 0).sort((a, b) => b.wins - a.wins || b.bestFloor - a.bestFloor);
    const reigning = this.reigning();
    if (!ranked.length && !reigning) return null;
    const top = ranked.slice(0, 3).map((h) => `${h.name} (${h.wins} win${h.wins > 1 ? 's' : ''}, deepest floor ${h.bestFloor})`);
    return `Hall of fame after ${this.data.seasons.length} season${this.data.seasons.length > 1 ? 's' : ''}: ${top.join(', ')}.${reigning ? ` Reigning champion: ${reigning.winner}, winner of season ${reigning.n}.` : ''}`;
  }
}
