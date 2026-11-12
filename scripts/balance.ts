// Équilibrage : combat solo contre le boss de chaque étage, joueur de niveau étage+1, équipement « réaliste », 2 potions.
// Usage : npm run balance -- [essais=300]. Objectif : ~80 % de victoires pour chaque classe.
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';
import { CLASSES } from '../src/server/game/data.js';
import { makeItem } from '../src/server/game/items.js';

const N = Number(process.argv[2] ?? 300);
const classes = ['barbare', 'chevalier', 'voleur', 'mage'] as const;
const better: Record<string, string> = { barbare: 'hache_guerre', chevalier: 'epee_longue', voleur: 'epee_longue', mage: 'baton_rouge' };
let id = 0;
const nid = () => `s${++id}`;

function trial(cls: (typeof classes)[number], n: number, seed: number) {
  const g = new Game({ ...DEFAULT_CONFIG, staggered: false, lobbySeconds: 0, seed, bots: 0 });
  let t = 1_000_000;
  g.submit('hero', `!join ${cls}`, t);
  const p = g.player('hero')!;
  const def = CLASSES[cls];
  const L = n + 1;
  p.level = L;
  p.maxHp = def.hp + def.hpPerLevel * (L - 1);
  p.hp = p.maxHp;
  p.stats[def.attackStat] += L - 1;
  // Équipement : l'arme de départ forgée à l'étage 2, une arme rare dès l'étage 3, forgée ensuite
  if (n >= 3) p.weapon = makeItem(better[cls], nid);
  const plus = n === 1 ? 0 : n === 2 ? 1 : Math.min(3, n - 2);
  for (let i = 0; i < plus; i++) { p.weapon!.hit = (p.weapon!.hit ?? 0) + 1; p.weapon!.dmg = (p.weapon!.dmg ?? 4) + 2; }
  if (n >= 3) p.armor = makeItem(n >= 6 ? 'plastron' : 'cotte', nid);
  p.items = [makeItem('potion', nid), makeItem('potion', nid)];
  const f = g.freshFloor(n);
  f.startedAt = t;
  f.collapseAt = t + 99 * 3600_000;
  f.theme = 'classique';
  f.monsters = f.monsters.filter((m) => m.boss);
  p.floor = n;
  p.roomId = f.bossRoom;
  p.immuneUntil = 0;
  const boss = f.monsters[0];
  for (let turn = 0; turn < 40; turn++) {
    if (p.hp < p.maxHp * 0.35 && p.items.some((i) => i.tpl === 'potion')) g.submit('hero', '!use potion', t + 10);
    else g.submit('hero', '!attack', t + 10);
    g.tick((t += 20_000));
    if (boss.hp <= 0 || !f.monsters.includes(boss)) return true;
    if (!p.alive || !g.player('hero')) return false;
  }
  return false;
}

for (let n = 1; n <= 8; n++) {
  const row = classes.map((c) => {
    let w = 0;
    for (let i = 0; i < N; i++) w += trial(c, n, 1000 * n + i) ? 1 : 0;
    return `${CLASSES[c].label.slice(0, 5)} ${Math.round((100 * w) / N)}%`;
  });
  console.log(`floor ${n} (lvl ${n + 1}): ${row.join(' | ')}`);
}
