import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';

const T0 = 1_000_000;

describe('tours décalés par étage', () => {
  it('les étages impairs et pairs jouent en alternance ; une commande attend le tour de son étage', () => {
    const g = new Game({ ...DEFAULT_CONFIG, seed: 21, staggered: true });
    g.submit('ana', '!join barbare', T0);
    g.submit('bob', '!join mage', T0);
    const f2 = g.freshFloor(2);
    const bob = g.player('bob')!;
    bob.floor = 2;
    bob.roomId = f2.spawnRoom;
    const ana = g.player('ana')!;
    const anaRoom = ana.roomId;
    const bobRoom = bob.roomId;
    const dirOf = (fl: number, room: number) => Object.keys(g.floor(fl)!.rooms[room].doors)[0];
    const names: Record<string, string> = { n: '!nord', s: '!sud', e: '!est', o: '!ouest' };
    g.submit('ana', names[dirOf(1, anaRoom)], T0 + 1);
    g.submit('bob', names[dirOf(2, bobRoom)], T0 + 1);
    // Tour du monde 1 : l'étage 1 joue (1 + 1 pair), l'étage 2 attend
    g.tick(T0 + 10_000);
    expect(g.plays(1)).toBe(true);
    expect(ana.roomId).not.toBe(anaRoom);
    expect(bob.roomId).toBe(bobRoom);
    expect(bob.pending).not.toBeNull(); // sa commande attend son tour
    // Tour du monde 2 : l'étage 2 joue
    g.tick(T0 + 20_000);
    expect(g.plays(2)).toBe(true);
    expect(bob.roomId).not.toBe(bobRoom);
  });

  it('les durées en tours gardent le même temps réel (× 2 tours du monde)', () => {
    const g = new Game({ ...DEFAULT_CONFIG, seed: 21, staggered: true });
    expect(g.phases).toBe(2);
    const g1 = new Game({ ...DEFAULT_CONFIG, seed: 21, staggered: false });
    expect(g1.phases).toBe(1);
    expect(g1.plays(1)).toBe(true);
    expect(g1.plays(2)).toBe(true);
  });

  it('la saison se termine à heure fixe même si personne n\'atteint le dernier étage', () => {
    const g = new Game({ ...DEFAULT_CONFIG, seed: 21, staggered: true, firstFloorMinutes: 1, lastFloorMinutes: 1, firstLockMinutes: 0, lastLockMinutes: 0, finalFloor: 3, lobbySeconds: 0 });
    g.submit('ana', '!join', T0);
    let t = T0;
    let over = false;
    for (let i = 0; i < 40 && !over; i++) {
      g.tick((t += 10_000));
      over = g.state.seasonOver;
    }
    expect(over).toBe(true);
    expect(t - T0).toBeLessThanOrEqual(3 * 60_000 + 10_000);
  });
});
