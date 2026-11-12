import { describe, expect, it } from 'vitest';
import { pickMood } from '../client/src/stream/mood.js';
import type { FloorView, RoomView } from '../src/shared/types.js';

const room = (r: Partial<RoomView>) => ({ id: 1, type: 'normale', bossAlive: false, merchant: false, ...r }) as RoomView;
const floor = (f: Partial<FloorView>) => ({ n: 1, theme: 'classique', collapseInSec: 600, stairsInSec: 300, rooms: [], ...f }) as FloorView;

describe('musique adaptative : quelle ambiance ?', () => {
  it('inscriptions, fin de saison', () => {
    expect(pickMood({ floor: null })).toBe('lobby');
    expect(pickMood({ floor: floor({ collapseInSec: null }) })).toBe('lobby');
    expect(pickMood({ seasonOver: true, floor: floor({}) })).toBe('finale');
  });
  it('exploration, boutique, crypte', () => {
    expect(pickMood({ floor: floor({}) })).toBe('explore');
    expect(pickMood({ floor: floor({}), room: room({ merchant: true }) })).toBe('safe');
    expect(pickMood({ floor: floor({}), room: room({ forge: true }) })).toBe('safe');
    expect(pickMood({ floor: floor({}), room: room({ crypt: [] }) })).toBe('crypt');
  });
  it('boss seulement quand on le combat, tension en fin d\'étage', () => {
    expect(pickMood({ floor: floor({}), room: room({ type: 'boss', bossAlive: true }) })).toBe('explore');
    expect(pickMood({ floor: floor({}), room: room({ type: 'boss', bossAlive: true, players: [{} as never] }) })).toBe('boss');
    expect(pickMood({ floor: floor({ collapseInSec: 80 }), room: room({ merchant: true }) })).toBe('tension');
    expect(pickMood({ floor: floor({ collapseInSec: 200, stairsInSec: 0 }) })).toBe('tension');
  });
});

describe('playlist sans répétition', async () => {
  const { shuffled } = await import('../client/src/stream/music.js');
  it('tous les morceaux une fois, sans recommencer par le dernier joué', () => {
    const files = ['a', 'b', 'c', 'd'];
    for (let seed = 0; seed < 20; seed++) {
      let x = seed;
      const rand = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
      const order = shuffled(files, 'a', rand);
      expect([...order].sort()).toEqual(files);
      expect(order[0]).not.toBe('a');
    }
  });
});
