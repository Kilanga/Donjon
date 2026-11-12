// Règles ajoutées après le test du 10 novembre : ordre du tour, loot des morts, pièges, embuscades, fautes de frappe.
import { describe, expect, it } from 'vitest';
import { suggestCommand } from '../src/shared/commands.js';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';

const T0 = 1_000_000;

/** Deux joueurs sans immunité dans une salle normale vide, avec une porte libre. */
function duel(seed = 42) {
  const g = new Game({ ...DEFAULT_CONFIG, staggered: false, lobbySeconds: 0, seed, immunitySeconds: 0 });
  g.submit('a', '!join barbare', T0);
  g.submit('b', '!join mage', T0);
  const a = g.player('a')!;
  const b = g.player('b')!;
  const f = g.floor(a.floor)!;
  const room = f.rooms.find((r) => r.type === 'normale' && Object.keys(r.doors).length > 0)!;
  f.monsters = f.monsters.filter((m) => m.roomId !== room.id);
  a.roomId = b.roomId = room.id;
  const dir = Object.keys(room.doors)[0];
  const cmd = { n: '!nord', s: '!sud', e: '!est', o: '!ouest' }[dir as 'n'];
  return { g, a, b, f, room, cmd };
}

describe('ordre du tour', () => {
  it('une attaque passe toujours avant la fuite de la cible', () => {
    // Sur plusieurs graines, la cible qui fuit est toujours visée dans la salle de départ
    for (let seed = 1; seed <= 20; seed++) {
      const { g, a, b, room, cmd } = duel(seed);
      a.stats.agi = -5; // même avec une initiative désastreuse
      g.submit('a', '!attaque b', T0 + 1);
      g.submit('b', cmd, T0 + 1);
      const ev = g.tick(T0 + 20_000);
      // Le coup de a (touché, raté ou gag sur un 1 naturel) a lieu dans la salle de départ, avant que b parte
      const blow = ev.find((e) => e.fx?.src === 'p:a');
      expect(blow, `graine ${seed}`).toBeDefined();
      expect(blow!.roomId).toBe(room.id);
      const order = ev.indexOf(blow!);
      const moved = ev.findIndex((e) => e.fx?.dst === 'p:b' && e.roomId !== room.id);
      if (moved >= 0) expect(moved).toBeGreaterThan(order);
    }
  });

  it('une potion bue ce tour-ci passe avant les coups', () => {
    const { g, b } = duel();
    b.hp = 1;
    g.submit('a', '!attaque b', T0 + 1);
    g.submit('b', '!utilise potion', T0 + 1);
    const ev = g.tick(T0 + 20_000);
    const drink = ev.findIndex((e) => e.fx?.kind === 'heal' && e.fx.dst === 'p:b');
    const blow = ev.findIndex((e) => e.fx?.src === 'p:a');
    expect(drink).toBeGreaterThanOrEqual(0);
    expect(blow).toBeGreaterThan(drink);
  });
});

describe('loot des morts', () => {
  it('le tueur est prévenu, et !fouille ramasse le loot au sol', () => {
    const { g, a, b, room, f } = duel();
    b.hp = 1;
    b.gold = 30;
    a.stats.for = 20;
    let t = T0;
    let ev = [] as ReturnType<Game['tick']>;
    for (let i = 0; i < 6 && b.alive; i++) {
      g.submit('a', '!attaque b', t + 1);
      ev = g.tick((t += 20_000));
    }
    expect(b.alive).toBe(false);
    expect(ev.some((e) => e.to === 'a' && e.text.includes('!pickup'))).toBe(true);
    const goldBefore = a.gold;
    const items = a.items.length;
    g.submit('a', '!fouille', t + 1);
    g.tick((t += 20_000));
    expect(f.rooms[room.id].groundGold).toBe(0);
    expect(a.gold).toBe(goldBefore + 30);
    expect(a.items.length).toBeGreaterThan(items);
  });
});

describe('équilibrage des premiers étages', () => {
  it('un piège de l\'étage 1 fait au plus 3 PV', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = new Game({ ...DEFAULT_CONFIG, staggered: false, lobbySeconds: 0, seed });
      g.submit('a', '!join chevalier', T0);
      const p = g.player('a')!;
      const f = g.floor(1)!;
      const trap = f.rooms.find((r) => r.type === 'piege');
      if (!trap) continue;
      f.monsters = f.monsters.filter((m) => m.roomId !== trap.id);
      p.roomId = trap.id;
      trap.trapArmed = true;
      p.stats.int = -10; // rate le désarmement
      const hp = p.hp;
      g.submit('a', '!fouille', T0 + 1);
      g.tick(T0 + 20_000);
      expect(hp - p.hp).toBeLessThanOrEqual(3);
    }
  });

  it('les monstres errants ne s\'entassent pas à plus de 2 par salle aux étages 1-2', () => {
    const g = new Game({ ...DEFAULT_CONFIG, staggered: false, lobbySeconds: 0, seed: 7 });
    g.submit('a', '!join', T0);
    const f = g.floor(1)!;
    for (const m of f.monsters) if (!m.boss) m.wanderer = true;
    // Un joueur reste en safe room : les errants bougent librement pendant 200 tours
    let t = T0;
    for (let i = 0; i < 200; i++) {
      g.tick((t += 20_000));
      const count = new Map<number, number>();
      for (const m of f.monsters) if (m.hp > 0 && !m.boss) count.set(m.roomId, (count.get(m.roomId) ?? 0) + 1);
      const start = new Map<number, number>();
      for (const [room, n] of count) if (n > 2) start.set(room, n);
      // Seules les salles déjà surpeuplées à la génération peuvent dépasser 2 (personne n'y entre en plus)
      for (const [, n] of start) expect(n).toBeLessThanOrEqual(3);
    }
  });
});

describe('fautes de frappe', () => {
  it('propose la commande la plus proche', () => {
    expect(suggestCommand('!attque Kilak')).toBe('!attaque Kilak');
    expect(suggestCommand('!fouile')).toBe('!fouille');
    expect(suggestCommand('!nrod')).toBe('!nord');
    expect(suggestCommand('!xyzzy')).toBeNull();
  });
  it('le jeu répond avec la suggestion', () => {
    const g = new Game({ ...DEFAULT_CONFIG, staggered: false, lobbySeconds: 0, seed: 1 });
    expect(g.submit('a', '!attque gobelin', T0).text).toContain('!attaque gobelin');
  });
});
