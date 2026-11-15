// Saison simulée de bout en bout, avec les vrais PNJ du stream (même cerveau que sur le live) et les vrais chronos.
// Un « héros » joue comme un PNJ fort, pour lancer la saison. On mesure le rythme et la difficulté étage par étage.
// Usage : npm run saison -- [saisons=4] [pnj=10] [retardataires=4]
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';
import { BotManager } from '../src/server/bots.js';
import type { GameEvent } from '../src/shared/types.js';

const [seasons = 4, nBots = 10, nClosers = 4] = process.argv.slice(2).map(Number);
const realNow = Date.now;

interface FloorStat {
  firstAt: number | null; // minutes depuis le coup d'envoi
  levels: number[]; // niveau des arrivants
  deaths: number;
  killers: Record<string, number>;
  bossAt: number | null;
}

function run(seed: number) {
  let T = 1_000_000_000;
  Date.now = () => T; // les PNJ lisent l'horloge : on leur donne celle de la simulation
  const cfg = { ...DEFAULT_CONFIG, seed, lobbySeconds: 0, bots: nBots, closers: nClosers };
  const game = new Game(cfg);
  const bots = new BotManager(game, { submit: (n, t) => void game.submit(n, t, T), say: () => {}, pos: () => {}, humanActive: () => true }, nBots, nClosers);
  for (let i = 0; i < nBots; i++) bots.balance();
  game.submit('Hero', '!join barbare', T);
  const start = T;
  const stats: Record<number, FloorStat> = {};
  const st = (n: number) => (stats[n] ??= { firstAt: null, levels: [], deaths: 0, bossAt: null, killers: {} });
  const seen = new Set<string>();
  const phase = (cfg.turnSeconds * 1000) / game.phases;
  let end = '';
  const hero = () => game.player('Hero');
  for (let i = 0; i < 20_000 && !game.state.seasonOver; i++) {
    T += phase;
    const ev: GameEvent[] = game.tick(T);
    for (const e of ev) {
      if (e.kind === 'mort' && e.floor) {
        st(e.floor).deaths++;
        const by = /Cause: (.+?)\. Their loot/.exec(e.text)?.[1]?.replace(/^(an?|the) /, '') ?? '?';
        st(e.floor).killers[by] = (st(e.floor).killers[by] ?? 0) + 1;
      }
      if (e.kind === 'systeme' && e.drama === 80 && / is defeated by /.test(e.text) && e.floor && st(e.floor).bossAt === null) st(e.floor).bossAt = (T - start) / 60_000;
      if (e.seasonEnd) end = e.text.replace(/^END OF THE SEASON! /, '').slice(0, 110);
    }
    for (const p of Object.values(game.state.players)) {
      if (!p.alive) continue;
      const k = `${p.key}:${p.floor}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const s = st(p.floor);
      if (s.firstAt === null) s.firstAt = (T - start) / 60_000;
      if (!p.closer) s.levels.push(p.level); // les retardataires (faibles exprès) ne comptent pas
    }
    bots.afterTurn();
    const h = hero();
    if (h?.alive) {
      const cmd = (bots as unknown as { decide: (p: unknown) => string | null }).decide(h);
      if (cmd) game.submit('Hero', cmd, T);
    }
  }
  Date.now = realNow;
  return { stats, end, minutes: (T - start) / 60_000, legends: game.state.champions.map((c) => `${c.name} (lvl ${c.level})`) };
}

const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
for (let s = 1; s <= seasons; s++) {
  const r = run(100 + s);
  console.log(`\nSeason ${s}: ${r.minutes.toFixed(0)} min. ${r.end}`);
  console.log(`  Legends: ${r.legends.join(', ') || 'none'}`);
  for (const [n, f] of Object.entries(r.stats).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  floor ${n}: reached at ${f.firstAt?.toFixed(1)} min, ${f.levels.length} arrivals (median level ${med(f.levels)}), ${f.deaths} deaths${f.bossAt !== null ? `, boss down at ${f.bossAt.toFixed(1)} min` : ''}; top level ${Math.max(...f.levels)}; killers: ${Object.entries(f.killers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
}
