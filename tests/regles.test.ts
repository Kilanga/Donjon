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

describe('crypte et !resurrect', () => {
  /** ana reste sur l'étage 1 qui s'effondre ; bob est déjà à l'étage 2, dans la crypte. */
  function crypt() {
    const g = new Game(cfg({ floorMinutes: 1 }));
    g.submit('ana', '!join mage', T0);
    g.submit('bob', '!join knight', T0);
    const bob = g.player('bob')!;
    const f2 = g.freshFloor(2);
    bob.floor = 2;
    bob.roomId = f2.cryptRoom!;
    f2.startedAt = T0;
    f2.collapseAt = T0 + 600_000;
    const ev = g.tick(T0 + 61_000);
    return { g, bob, f2, ev };
  }

  it('les éliminés reposent dans la crypte de l\'étage suivant', () => {
    const { g, f2, ev } = crypt();
    expect(g.player('ana')).toBeUndefined();
    expect(ev.some((e) => /crypt of floor 2/.test(e.text))).toBe(true);
    const view = g.floorView(f2, null).rooms.find((r) => r.id === f2.cryptRoom)!;
    expect(view.crypt?.map((x) => x.name)).toEqual(['ana']);
  });

  it('ressusciter coûte 50 × l\'étage en or, ou la moitié des PV actuels', () => {
    const { g, bob, f2 } = crypt();
    g.state.resurrection = null; // pas de vote du chat ici
    bob.gold = 30;
    bob.hp = 10;
    g.submit('bob', '!resurrect ana gold', T0 + 62_000);
    g.tick(T0 + 81_000);
    expect(g.player('ana')).toBeUndefined(); // pas assez d'or (100 à l'étage 2)
    expect(bob.gold).toBe(30);
    g.submit('bob', '!resurrect ana hp', T0 + 82_000);
    const ev = g.tick(T0 + 101_000);
    const ana = g.player('ana')!;
    expect(ana.alive).toBe(true);
    expect(ana.floor).toBe(2);
    expect(ana.roomId).toBe(f2.cryptRoom);
    expect(bob.hp).toBe(5);
    expect(ev.some((e) => /NECROMANCY/.test(e.text))).toBe(true);
    expect(g.floorView(f2, null).rooms.find((r) => r.id === f2.cryptRoom)!.crypt).toEqual([]);
  });
});

describe('attaque et fouille', () => {
  it('!attack sans monstre vise un joueur de la salle au hasard (hors alliés et protégés)', () => {
    const { g, a, b } = duel();
    a.immuneUntil = b.immuneUntil = 0;
    g.submit('a', '!attack', T0 + 1000);
    const ev = g.tick(T0 + 20_000);
    expect(ev.some((e) => (e.fx?.src === 'p:a' && e.fx?.dst === 'p:b') || /strikes back at a/.test(e.text))).toBe(true);
  });

  it('!search et !pickup : à deux sur le même butin, d20 contre d20, un seul se sert', () => {
    const { g, a, b, normal } = duel();
    normal.groundGold = 50;
    g.submit('a', '!pickup', T0 + 1000);
    g.submit('b', '!search', T0 + 1000);
    const ev = g.tick(T0 + 20_000);
    expect(ev.some((e) => /Scramble for the loot/.test(e.text))).toBe(true);
    expect(a.gold + b.gold).toBe(10 + 10 + 50);
    expect(Math.max(a.gold, b.gold)).toBe(60);
  });

  it('une salle fouillée se remplit de nouveau au bout de 5 tours', () => {
    const { g, a, normal } = duel();
    normal.trapArmed = false;
    g.submit('a', '!search', T0 + 1000);
    let t = T0 + 20_000;
    g.tick(t);
    expect(normal.searchedBy).toBe('a');
    for (let i = 0; i < 5; i++) g.tick((t += 20_000));
    expect(normal.searchedBy).toBeNull();
    void a;
  });
});
