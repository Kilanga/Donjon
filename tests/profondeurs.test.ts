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
    const g = new Game({ ...DEFAULT_CONFIG, seed });
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
      for (let i = 0; i < 30; i++) burns += g.tick((t += 20_000)).filter((e) => e.text.includes('braise')).length;
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
      for (let i = 0; i < 30; i++) thefts += g.tick((t += 20_000)).filter((e) => e.text.includes('fantôme')).length;
    }
    expect(thefts).toBeGreaterThan(3);
  });
});
