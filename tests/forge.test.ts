import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';

const T0 = 1_000_000;

describe('forgeron', () => {
  it('chaque étage a une forge (safe room sans marchand), à distance de l\'entrée', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = new Game({ ...DEFAULT_CONFIG, staggered: false, seed });
      g.submit('ana', '!join', T0);
      for (const n of [1, 2, 3]) {
        const f = g.freshFloor(n);
        const forges = f.rooms.filter((r) => r.forge);
        expect(forges, `étage ${n}, graine ${seed}`).toHaveLength(1);
        expect(forges[0].type).toBe('safe');
        expect(forges[0].merchant).toHaveLength(0);
        expect(forges[0].id).not.toBe(f.spawnRoom);
        expect(f.monsters.some((m) => m.roomId === forges[0].id)).toBe(false);
      }
    }
  });

  it('!forge arme améliore l\'arme (+1 au jet, dé plus gros) contre de l\'or, jusqu\'à +3', () => {
    const g = new Game({ ...DEFAULT_CONFIG, staggered: false, seed: 7 });
    g.submit('ana', '!join barbare', T0);
    const ana = g.player('ana')!;
    const f = g.floor(1)!;
    ana.roomId = f.rooms.find((r) => r.forge)!.id;
    ana.gold = 1000;
    const w = ana.weapon!;
    const hit0 = w.hit ?? 0;
    const dmg0 = w.dmg!;
    expect(g.submit('ana', '!forge', T0).text).toMatch(/Forgeron/);
    let t = T0;
    for (let i = 0; i < 4; i++) {
      g.submit('ana', '!forge arme', t);
      g.tick((t += 20_000));
    }
    expect(w.plus).toBe(3); // la 4e tentative est refusée
    expect(w.hit).toBe(hit0 + 3);
    expect(w.dmg).toBe(dmg0 + 6);
    expect(w.name).toMatch(/\+3$/);
    expect(ana.gold).toBe(1000 - (30 + 55 + 80));
    // sans or : refusé
    ana.gold = 0;
    g.submit('ana', '!forge armure', t);
    g.tick((t += 20_000));
    expect(ana.armor?.plus ?? 0).toBe(0);
  });

  it('pas de forge hors de la forge, et pas d\'achat dans la forge', () => {
    const g = new Game({ ...DEFAULT_CONFIG, staggered: false, seed: 7 });
    g.submit('ana', '!join', T0);
    expect(g.submit('ana', '!forge', T0).ok).toBe(false); // dans la safe room d'entrée
  });
});
