import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';

const T0 = 1_000_000;
const setup = () => {
  const g = new Game({ ...DEFAULT_CONFIG, seed: 9, staggered: false, lobbySeconds: 0, bots: 0 });
  g.submit('hero', '!join knight', T0);
  g.tick(T0 + 20_000);
  return g;
};

describe('possession : le chat pilote un monstre', () => {
  it('un viewer qui ne joue pas prend un monstre, le déplace et frappe ; pas un crawler vivant', () => {
    const g = setup();
    expect(g.submit('hero', '!possess', T0 + 21_000).ok).toBe(false); // encore en vie
    const res = g.submit('mia', '!possess', T0 + 21_000);
    expect(res.ok).toBe(true);
    const m = g.possessedBy('mia')!;
    expect(m.name).toMatch(/\(mia\)$/);
    // On l'amène dans la salle du héros, puis il frappe sur commande
    const hero = g.player('hero')!;
    hero.immuneUntil = 0;
    const f = g.floor(1)!;
    const room = f.rooms.find((r) => r.type === 'normale' && !f.monsters.some((x) => x.roomId === r.id && x !== m))!;
    hero.roomId = room.id;
    m.roomId = room.id;
    expect(g.submit('mia', '!attack hero', T0 + 22_000).ok).toBe(true);
    const ev = g.tick(T0 + 40_000);
    expect(ev.some((e) => e.text.includes(m.name))).toBe(true);
  });

  it('6 tours, puis le monstre est libéré ; il faut attendre avant de reposséder', () => {
    const g = setup();
    g.submit('mia', '!possess', T0 + 21_000);
    const m = g.possessedBy('mia')!;
    let t = T0 + 20_000;
    for (let i = 0; i < 7; i++) g.tick((t += 20_000));
    expect(g.possessedBy('mia')).toBeUndefined();
    expect(m.name).not.toMatch(/mia/);
    expect(g.submit('mia', '!possess', t + 1000).text).toMatch(/rest/);
  });

  it('déplacement commandé : par une porte, jamais dans une safe room', () => {
    const g = setup();
    g.submit('mia', '!possess', T0 + 21_000);
    const m = g.possessedBy('mia')!;
    const f = g.floor(1)!;
    const dir = (Object.entries(f.rooms[m.roomId].doors) as [string, number | undefined][]).find(([, id]) => id !== undefined && f.rooms[id].type !== 'safe' && f.rooms[id].type !== 'boss');
    if (!dir) return;
    for (const p of Object.values(g.state.players)) p.roomId = f.spawnRoom === m.roomId ? (dir[1] as number) : f.spawnRoom; // personne dans sa salle
    g.submit('mia', `!${{ n: 'north', s: 'south', e: 'east', o: 'west' }[dir[0]]}`, T0 + 22_000);
    g.tick(T0 + 40_000);
    expect(m.roomId).toBe(dir[1]);
  });
});
