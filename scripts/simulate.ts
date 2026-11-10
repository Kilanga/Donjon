// Simulation : des bots jouent une longue session pour vérifier la stabilité et l'équilibrage.
// Usage : npm run simulate -- [bots=10] [tours=180] [graine=7]
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';
import { Rng } from '../src/server/game/rng.js';
import type { Dir } from '../src/shared/types.js';

const [nBots = 10, nTurns = 180, seed = 7] = process.argv.slice(2).map(Number);
const cfg = { ...DEFAULT_CONFIG, seed };
const game = new Game(cfg);
const rng = new Rng(seed * 31);
const names = Array.from({ length: nBots }, (_, i) => `Bot${i + 1}`);
const classes = ['barbare', 'chevalier', 'voleur', 'mage'];
let t = 1_000_000;

for (const n of names) game.submit(n, `!join ${rng.pick(classes)}`, t);

const counts: Record<string, number> = {};
const highlights: string[] = [];

for (let turn = 1; turn <= nTurns; turn++) {
  // Un bot rejoint en cours de route de temps en temps
  if (turn % 40 === 0) {
    const late = `Retard${turn}`;
    names.push(late);
    game.submit(late, `!join ${rng.pick(classes)}`, t);
  }
  for (const n of names) {
    const v = game.viewFor(n, t);
    const me = v.me;
    if (!me || !me.alive || !v.floor) continue;
    const room = v.floor.rooms.find((r) => r.current)!;
    const others = (room.players ?? []).filter((p) => !p.me && p.alive);
    if (me.statPoints > 0) game.submit(n, `!monte ${rng.pick(['for', 'agi', 'int', 'cha'])}`, t);
    if (rng.chance(0.03) && others.length) game.submit(n, `!alliance ${rng.pick(others).name}`, t);

    let cmd: string;
    const potion = me.items.find((i) => i.tpl === 'potion' || i.tpl === 'grande_potion');
    const better = me.items.find((i) => i.kind === 'arme' && (i.dmg ?? 0) > (me.weapon?.dmg ?? 0));
    const betterArmor = me.items.find((i) => i.kind === 'armure' && (i.def ?? 0) > (me.armor?.def ?? 0));
    const ally = others.find((o) => o.ally);
    const enemy = others.find((o) => !o.ally && !o.immune);
    if (me.hp < me.maxHp * 0.4 && potion) cmd = `!utilise ${potion.name}`;
    else if (better) cmd = `!equipe ${better.name}`;
    else if (betterArmor) cmd = `!equipe ${betterArmor.name}`;
    else if ((room.monsters ?? []).length) cmd = '!attaque';
    else if (ally && rng.chance(0.05) && room.type !== 'safe') cmd = `!attaque ${ally.name}`;
    else if (enemy && rng.chance(0.25) && room.type !== 'safe') cmd = `!attaque ${enemy.name}`;
    else if ((room.ground ?? []).length || room.groundGold) cmd = '!ramasse';
    else if (room.type === 'safe' && me.hp < me.maxHp) cmd = '!repos';
    else if (room.type === 'safe' && v.merchant?.some((o) => o.price <= me.gold) && rng.chance(0.5)) cmd = `!achete ${v.merchant.find((o) => o.price <= me.gold)!.index}`;
    else if (room.stairs && !room.bossAlive) cmd = '!descendre';
    else if ((!room.searched && room.type === 'normale' && rng.chance(0.4)) || room.chest === 'ferme') cmd = '!fouille';
    else {
      const known = new Set(v.floor.rooms.map((r) => r.id));
      const doors = Object.entries(room.doors) as [Dir, number][];
      const fresh = doors.filter(([, id]) => !known.has(id));
      const [d] = fresh.length && rng.chance(0.8) ? rng.pick(fresh) : rng.pick(doors);
      cmd = `!${{ n: 'nord', s: 'sud', e: 'est', o: 'ouest' }[d]}`;
    }
    game.submit(n, cmd, t);
  }
  t += cfg.turnSeconds * 1000;
  const evs = game.tick(t);
  for (const e of evs) {
    counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    if (e.drama >= 80 && highlights.length < 25) highlights.push(`T${e.turn} ${e.text}`);
  }
}

const players = Object.values(game.state.players);
console.log(`\n=== Simulation : ${players.length} bots, ${nTurns} tours (${Math.round((nTurns * cfg.turnSeconds) / 60)} min de jeu) ===`);
console.log('Évènements :', counts);
console.log('Étages créés :', Object.keys(game.state.floors).join(', '));
console.table(players.map((p) => ({ nom: p.name, classe: p.cls, niveau: p.level, etage: p.floor, kills: p.kills, morts: p.deaths, or: p.gold, objets: p.items.length })));
console.log('\nMoments forts :');
for (const h of highlights) console.log(' -', h);
const json = JSON.stringify(game.state);
console.log(`\nTaille de la sauvegarde : ${Math.round(json.length / 1024)} Ko`);
