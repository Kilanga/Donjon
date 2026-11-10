import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';

describe('prévision de la caméra', () => {
  it('désigne la salle où un vrai joueur va attaquer, et la salle d\'arrivée d\'un joueur qui entre chez le boss', () => {
    const g = new Game({ ...DEFAULT_CONFIG, seed: 5 });
    const T = 1_000_000;
    g.submit('ana', '!join barbare', T);
    g.submit('bob', '!join mage', T);
    const f = g.floor(1)!;
    const ana = g.player('ana')!;
    const bob = g.player('bob')!;
    // ana dans une salle avec un monstre, bob devant la porte du boss
    const withMonster = f.monsters.find((m) => !m.boss && m.hp > 0)!;
    ana.roomId = withMonster.roomId;
    ana.immuneUntil = 0;
    const [dir] = Object.entries(f.rooms[f.bossRoom].doors)[0] as [string, number];
    const opposite: Record<string, string> = { n: 's', s: 'n', e: 'o', o: 'e' };
    bob.roomId = f.rooms[f.bossRoom].doors[dir as 'n']!;
    g.submit('ana', '!attaque', T + 1000);
    g.submit('bob', `!${({ n: 'nord', s: 'sud', e: 'est', o: 'ouest' } as Record<string, string>)[opposite[dir]]}`, T + 1000);
    const fc = g.forecast();
    expect(fc.map((r) => r.roomId)).toContain(withMonster.roomId);
    expect(fc.map((r) => r.roomId)).toContain(f.bossRoom);
    expect(fc[0].score).toBeGreaterThanOrEqual(24); // un vrai joueur qui attaque compte triple
  });

  it('ne prévoit rien quand personne ne fait rien d\'intéressant', () => {
    const g = new Game({ ...DEFAULT_CONFIG, seed: 5 });
    g.submit('ana', '!join', 1_000_000);
    const ana = g.player('ana')!;
    ana.roomId = g.floor(1)!.spawnRoom;
    expect(g.forecast()).toEqual([]);
  });
});
