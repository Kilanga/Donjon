import { describe, expect, it } from 'vitest';
import { Hall } from '../src/server/hall.js';
import type { Game } from '../src/server/game/engine.js';
import type { GameEvent } from '../src/shared/types.js';

const game = (players: { name: string; deepest: number; level?: number; bot?: boolean }[]) =>
  ({ state: { players: Object.fromEntries(players.map((p) => [p.name.toLowerCase(), { key: p.name.toLowerCase(), name: p.name, deepest: p.deepest, floor: p.deepest, level: p.level ?? 3, bot: !!p.bot }])) } }) as unknown as Game;
const end = { seasonEnd: true, kind: 'systeme', text: 'END OF THE SEASON!' } as GameEvent;

describe('palmarès des saisons', () => {
  it('sans Légende, pas de gagnant (GAME OVER pour tous) ; l\'étage record est retenu ; les PNJ ne comptent pas', () => {
    const h = new Hall(null);
    h.onEvents([], game([{ name: 'Kilak', deepest: 8 }, { name: 'Mia', deepest: 2 }, { name: 'Tobias', deepest: 8, bot: true }]));
    h.onEvents([end], game([]));
    expect(h.justClosed).toMatchObject({ n: 1, winner: null, players: 2 });
    expect(h.describe('kilak')).toContain('deepest floor 8');
    expect(h.describe('kilak')).toContain('never won');
    expect(h.describe('tobias')).toBeNull();
  });

  it('la première Légende gagne la saison, et les victoires s\'additionnent', () => {
    const h = new Hall(null);
    for (let i = 0; i < 2; i++) {
      h.onEvents([], game([{ name: 'Kilak', deepest: 8 }]));
      h.onEvents([{ victory: { name: 'Kilak', floor: 8, level: 9, bot: false } } as GameEvent, end], game([]));
    }
    h.onEvents([], game([{ name: 'Kilak', deepest: 8 }]));
    h.onEvents([{ victory: { name: 'Mia', floor: 8, level: 9, bot: false } } as GameEvent, end], game([]));
    expect(h.justClosed).toMatchObject({ n: 3, winner: 'Mia', how: 'legend' });
    expect(h.describe('kilak')).toContain('2 season wins');
    expect(h.summary()).toContain('Kilak (2 wins');
    expect(h.summary()).toContain('Reigning champion: Mia');
  });

  it('personne au-delà du premier étage : pas de gagnant non plus', () => {
    const h = new Hall(null);
    h.onEvents([], game([{ name: 'Kilak', deepest: 1 }]));
    h.onEvents([end], game([]));
    expect(h.justClosed).toMatchObject({ winner: null });
    expect(h.describe('kilak')).toContain('never won');
  });
});
