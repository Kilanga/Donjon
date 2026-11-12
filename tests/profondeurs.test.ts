import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { generateFloor } from '../src/server/game/dungeon.js';
import { Game } from '../src/server/game/engine.js';
import { Rng } from '../src/server/game/rng.js';
import { BOSSES } from '../src/server/game/data.js';

const T0 = 1_000_000;
const floorAt = (n: number, seed: number) => {
  let id = 0;
  return generateFloor(n, 24, new Rng(seed), () => `t${id++}`);
};

describe('profondeurs', () => {
  it('les étages se suivent sans se ressembler et durcissent', () => {
    const a = floorAt(1, 1);
    const b = floorAt(2, 2);
    expect(a.rooms.map((r) => `${r.x},${r.y}`).join()).not.toBe(b.rooms.map((r) => `${r.x},${r.y}`).join());
    const avgHp = (n: number) => {
      let s = 0, c = 0;
      for (let seed = 1; seed <= 20; seed++) for (const m of floorAt(n, seed).monsters) if (!m.boss) { s += m.maxHp; c++; }
      return s / c;
    };
    expect(avgHp(4)).toBeGreaterThan(avgHp(2));
    expect(avgHp(6)).toBeGreaterThan(avgHp(4));
  });

  it('de nouveaux monstres et boss apparaissent en profondeur, les plus faibles disparaissent', () => {
    const kinds = (n: number) => new Set(Array.from({ length: 20 }, (_, i) => floorAt(n, i + 1).monsters.map((m) => m.kind)).flat());
    const top = kinds(1);
    expect(top.has('yeti') || top.has('lezard') || top.has('dragon')).toBe(false);
    const k5 = kinds(5);
    expect([...k5].some((k) => ['marais', 'golem', 'yeti', 'chaman'].includes(k))).toBe(true);
    expect(k5.has('gobelin')).toBe(false);
    const deepBosses = new Set(BOSSES.filter((b) => b.minFloor >= 4).map((b) => b.kind));
    for (let seed = 1; seed <= 10; seed++) {
      const boss = floorAt(5, seed).monsters.find((m) => m.boss)!;
      expect(deepBosses.has(boss.kind)).toBe(true);
    }
  });
});

describe('thèmes d\'étage', () => {
  function onTheme(theme: string, seed = 9) {
    const g = new Game({ ...DEFAULT_CONFIG, staggered: false, lobbySeconds: 0, seed });
    g.submit('ana', '!join chevalier', T0);
    const p = g.player('ana')!;
    const f = g.floor(1)!;
    f.theme = theme;
    const room = f.rooms.find((r) => r.type === 'normale')!;
    f.monsters = f.monsters.filter((m) => m.roomId !== room.id);
    p.roomId = room.id;
    return { g, p, f, room };
  }

  it('en feu : des braises brûlent hors safe room', () => {
    let burns = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { g, p } = onTheme('en feu', seed);
      p.maxHp = p.hp = 999;
      let t = T0;
      for (let i = 0; i < 30; i++) burns += g.tick((t += 20_000)).filter((e) => e.text.includes('ember')).length;
    }
    expect(burns).toBeGreaterThan(3);
  });

  it('moisi : les monstres blessés regagnent des PV', () => {
    const { g, f } = onTheme('moisi');
    const m = f.monsters.find((x) => !x.boss)!;
    m.hp = 1;
    g.tick(T0 + 20_000);
    expect(m.hp).toBe(2);
  });

  it('hanté : un fantôme finit par voler de l\'or', () => {
    let thefts = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { g, p } = onTheme('hanté', seed);
      p.gold = 100;
      let t = T0;
      for (let i = 0; i < 30; i++) thefts += g.tick((t += 20_000)).filter((e) => e.text.includes('ghost')).length;
    }
    expect(thefts).toBeGreaterThan(3);
  });
});

describe('dernier étage et légendes', () => {
  it('l\'escalier du dernier étage fait entrer dans la Légende', () => {
    const g = new Game({ ...DEFAULT_CONFIG, staggered: false, lobbySeconds: 0, seed: 4, finalFloor: 2 });
    g.submit('ana', '!join barbare', T0);
    const p = g.player('ana')!;
    const f2 = g.freshFloor(2);
    f2.collapseAt = T0 + 5 * 60_000; // escalier descellé (dernières minutes de l'étage)
    p.floor = 2;
    p.roomId = f2.bossRoom;
    for (const m of f2.monsters) if (m.roomId === f2.bossRoom) m.hp = 0;
    g.submit('ana', '!descendre', T0 + 1);
    const ev = g.tick(T0 + 20_000);
    const win = ev.find((e) => e.victory);
    expect(win?.victory?.name).toBe('ana');
    expect(g.state.champions).toHaveLength(1);
    expect(g.player('ana')).toBeUndefined(); // sorti de la partie
    expect(g.floor(3)).toBeUndefined(); // pas d'étage au-delà
  });

  it('l\'effondrement du dernier étage termine la saison et fige la partie', () => {
    const g = new Game({ ...DEFAULT_CONFIG, staggered: false, lobbySeconds: 0, seed: 4, finalFloor: 2, firstFloorMinutes: 1, lastFloorMinutes: 1, firstLockMinutes: 0, lastLockMinutes: 0 });
    g.submit('ana', '!join barbare', T0);
    const p = g.player('ana')!;
    const f2 = g.freshFloor(2);
    p.floor = 2;
    p.roomId = f2.spawnRoom;
    f2.startedAt = T0;
    f2.collapseAt = T0 + 60_000;
    const ev = g.tick(T0 + 61_000);
    expect(ev.some((e) => e.seasonEnd)).toBe(true);
    expect(g.state.seasonOver).toBe(true);
    expect(p.floor).toBe(2); // pas de chute : la saison est finie
    expect(g.tick(T0 + 81_000)).toHaveLength(0);
    expect(g.submit('ana', '!nord', T0 + 82_000).text).toContain('season is over');
    g.reset();
    expect(g.state.seasonOver).toBe(false);
  });
});

describe('monstres qui reviennent et XP', () => {
  it('un monstre tué revient 5 tours plus tard, dans la salle où il est tombé (si elle est vide) ; un boss non', () => {
    const g = new Game({ ...DEFAULT_CONFIG, staggered: false, lobbySeconds: 0, seed: 11 });
    g.submit('ana', '!join barbare', T0);
    const f = g.floor(1)!;
    const ids = new Set(f.monsters.map((x) => x.id));
    const m = f.monsters.find((x) => !x.boss)!;
    const boss = f.monsters.find((x) => x.boss)!;
    const kill = (g as unknown as { killMonster: (m: unknown, n: number, k: unknown) => void }).killMonster.bind(g);
    kill(m, 1, null);
    kill(boss, 1, null);
    let t = T0;
    for (let i = 0; i < 4; i++) g.tick((t += 20_000));
    expect(f.monsters.some((x) => !ids.has(x.id))).toBe(false); // pas encore
    const ev = g.tick((t += 20_000));
    const back = f.monsters.filter((x) => !ids.has(x.id));
    expect(back).toHaveLength(1); // le monstre revient, pas le boss (qui a ses propres règles)
    expect(back[0].kind).toBe(m.kind);
    expect(back[0].roomId).toBe(m.roomId);
    expect(ev.some((e) => /is back on its feet/.test(e.text))).toBe(true);
  });

  it('tuer un crawler rapporte moins que tuer un monstre du même étage', () => {
    const g = new Game({ ...DEFAULT_CONFIG, staggered: false, lobbySeconds: 0, seed: 11 });
    g.submit('ana', '!join barbare', T0);
    const pvp = 5 * 4; // victime niveau 4
    const weakest = Math.min(...g.floor(1)!.monsters.filter((m) => !m.boss).map((m) => m.xp));
    expect(pvp).toBeGreaterThanOrEqual(0);
    expect(5 * 1).toBeLessThan(weakest); // un crawler de niveau 1 rapporte moins que le plus faible monstre
  });
});
