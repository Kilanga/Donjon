import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type GameConfig } from '../src/server/config.js';
import { Game, TRAP_SHARE_MAX } from '../src/server/game/engine.js';
import { makeItem } from '../src/server/game/items.js';

const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({ ...DEFAULT_CONFIG, staggered: false, lobbySeconds: 0, firstFloorFactor: 1, voteEveryMinutes: 0, seed: 7, ...over });
const T0 = 1_000_000;

/** Deux joueurs dans une salle normale vide de l'étage 1. */
function duel(over: Partial<GameConfig> = {}) {
  const g = new Game(cfg(over));
  g.submit('a', '!join barbarian', T0);
  g.submit('b', '!join knight', T0);
  const a = g.player('a')!;
  const b = g.player('b')!;
  const f = g.floor(1)!;
  const normal = f.rooms.find((r) => r.type === 'normale')!;
  f.monsters = f.monsters.filter((m) => m.roomId !== normal.id);
  a.roomId = b.roomId = normal.id;
  return { g, a, b, f, normal };
}

describe('immunité d\'arrivée', () => {
  it('dure 1 minute par défaut', () => {
    expect(DEFAULT_CONFIG.immunitySeconds).toBe(60);
  });

  it('attaquer un joueur fait perdre sa propre protection', () => {
    const { g, a, b } = duel();
    b.immuneUntil = 0; // b n'est plus protégé, a l'est encore
    expect(a.immuneUntil).toBeGreaterThan(T0);
    g.submit('a', '!attack b', T0 + 1000);
    const ev = g.tick(T0 + 20_000);
    expect(a.immuneUntil).toBe(0);
    expect(ev.some((e) => e.to === 'a' && /protection is gone/.test(e.text))).toBe(true);
  });

  it('on ne peut toujours pas frapper un joueur protégé', () => {
    const { g, a } = duel();
    a.immuneUntil = 0;
    g.submit('a', '!attack b', T0 + 1000);
    const ev = g.tick(T0 + 20_000);
    expect(ev.some((e) => e.to === 'a' && /protected/.test(e.text))).toBe(true);
  });
});

describe('étage inondé', () => {
  it('plus de glissades : on change toujours de salle (hors monstres)', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const g = new Game(cfg({ seed }));
      g.submit('a', '!join rogue', T0);
      const p = g.player('a')!;
      const f = g.floor(1)!;
      f.theme = 'inondé';
      f.monsters = [];
      let t = T0;
      for (let i = 0; i < 6; i++) {
        const from = p.roomId;
        const dir = Object.keys(f.rooms[from].doors)[0];
        g.submit('a', `!${{ n: 'north', s: 'south', e: 'east', o: 'west' }[dir as 'n']}`, t + 1000);
        const ev = g.tick((t += 20_000));
        expect(ev.some((e) => /slips|belly flop/.test(e.text))).toBe(false);
        if (f.rooms[from].type !== 'piege') expect(p.roomId).not.toBe(from);
        p.alive = true;
        p.hp = p.maxHp;
      }
    }
  });

  it('le butin au sol dérive vers une salle voisine', () => {
    const g = new Game(cfg());
    g.submit('a', '!join', T0);
    const f = g.floor(1)!;
    f.theme = 'inondé';
    const room = f.rooms.find((r) => r.type === 'normale' && Object.values(r.doors).some((id) => id !== undefined && f.rooms[id].type !== 'safe'))!;
    for (let i = 0; i < 5; i++) room.ground.push(makeItem('potion', () => `drift${i}`));
    let t = T0;
    let drifted = 0;
    for (let i = 0; i < 20; i++) drifted += g.tick((t += 20_000)).filter((e) => /current carries/.test(e.text)).length;
    expect(drifted).toBeGreaterThan(0);
    expect(room.ground.length).toBeLessThan(5);
  });
});

describe('pièges et votes de la production', () => {
  it('« Pièges à foison » ne dépasse jamais un quart des salles piégées', () => {
    const g = new Game(cfg());
    g.submit('a', '!join', T0);
    const f = g.floor(1)!;
    for (let i = 0; i < 10; i++) g.applyProduction('pieges_promo', 'test');
    const traps = f.rooms.filter((r) => r.type === 'piege').length;
    expect(traps).toBeLessThanOrEqual(Math.floor(f.rooms.length * TRAP_SHARE_MAX));
    expect(f.rooms.filter((r) => r.type === 'piege').every((r) => r.trapArmed)).toBe(true);
  });

  it('les PNJ ne votent pas ; le chat vote même sans perso', () => {
    const g = new Game(cfg());
    g.submit('a', '!join', T0);
    g.joinBot('Krag', 'barbare');
    g.startVote();
    expect(g.submit('Krag', '!vote 1', T0).ok).toBe(false);
    expect(g.submit('viewer', '!vote 1', T0).ok).toBe(true);
  });
});
