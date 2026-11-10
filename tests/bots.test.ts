import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';
import { BotManager } from '../src/server/bots.js';

function setup(target: number, humans: Set<string>, closers = 0, cfg: Partial<typeof DEFAULT_CONFIG> = {}) {
  const g = new Game({ ...DEFAULT_CONFIG, seed: 3, ...cfg });
  const said: string[] = [];
  const bots = new BotManager(g, {
    submit: (name, text) => void g.submit(name, text),
    say: (_n, text) => void said.push(text),
    pos: () => {},
    humanActive: (p) => humans.has(p.key),
  }, target, closers);
  return { g, bots, said };
}

describe('PNJ figurants', () => {
  it('arrivent un par tour jusqu\'au nombre voulu, et restent quand de vrais joueurs arrivent', () => {
    const humans = new Set<string>();
    const { g, bots } = setup(10, humans);
    let t = 1_000_000;
    for (let i = 0; i < 12; i++) {
      bots.afterTurn();
      g.tick((t += 20_000));
    }
    expect(bots.bots()).toHaveLength(10);
    expect(bots.bots().every((b) => b.bot)).toBe(true);
    // Trois vrais joueurs arrivent : les PNJ restent
    for (const n of ['ana', 'bob', 'cid']) {
      g.submit(n, '!join', t);
      humans.add(n);
    }
    for (let i = 0; i < 4; i++) {
      bots.afterTurn();
      g.tick((t += 20_000));
    }
    expect(bots.bots().filter((b) => b.alive || b.respawnIn > 0)).toHaveLength(10);
    expect(g.leaderboard().filter((r) => r.bot)).toHaveLength(10);
  });

  it('jouent 300 tours sans erreur, progressent et n\'attaquent jamais de joueur', () => {
    const humans = new Set<string>(['ana']);
    const { g, bots } = setup(10, humans);
    let t = 1_000_000;
    g.submit('ana', '!join chevalier', t);
    let pvp = 0;
    let kills = 0;
    let deepest = 1;
    for (let i = 0; i < 300; i++) {
      bots.afterTurn();
      const ev = g.tick((t += 20_000));
      pvp += ev.filter((e) => e.fx?.src?.startsWith('p:') && e.fx?.dst?.startsWith('p:') && e.fx.src !== e.fx.dst).length;
      kills += ev.filter((e) => e.fx?.kind === 'kill' && e.fx.src?.startsWith('p:') && e.fx.src !== 'p:ana').length;
      for (const b of bots.bots()) deepest = Math.max(deepest, b.deepest);
    }
    expect(bots.bots().length).toBeGreaterThan(0);
    expect(kills).toBeGreaterThan(10);
    expect(deepest).toBeGreaterThanOrEqual(2);
    expect(pvp).toBe(0);
  });

  it('ne démarrent pas le chrono des étages : seul un vrai joueur le fait', () => {
    const humans = new Set<string>();
    const { g, bots } = setup(10, humans);
    let t = 1_000_000;
    for (let i = 0; i < 40; i++) {
      bots.afterTurn();
      g.tick((t += 20_000));
    }
    expect(Object.values(g.state.floors).every((f) => f.collapseAt === null)).toBe(true);
    g.submit('ana', '!join', t);
    expect(g.floor(1)!.collapseAt).not.toBeNull();
  });

  it('les retardataires arrivent après le premier joueur, ne descendent jamais et ferment chaque étage jusqu\'à la fin de saison', () => {
    const humans = new Set<string>();
    const { g, bots } = setup(0, humans, 4, { floorMinutes: 3, finalFloor: 4 });
    let t = 1_000_000;
    for (let i = 0; i < 5; i++) {
      bots.afterTurn();
      g.tick((t += 20_000));
    }
    expect(bots.bots()).toHaveLength(0); // personne n'est entré : ils attendent
    g.submit('ana', '!join', t);
    humans.add('ana');
    for (let i = 0; i < 6; i++) {
      bots.afterTurn();
      g.tick((t += 20_000));
    }
    expect(bots.bots()).toHaveLength(4);
    // Le joueur part : ce sont les retardataires seuls qui doivent mener la saison jusqu'au bout
    g.adminKick('ana');
    const descents: string[] = [];
    for (let i = 0; i < 400 && !g.state.seasonOver; i++) {
      bots.afterTurn();
      for (const b of bots.bots()) if (b.pending?.name === 'descend') descents.push(b.name);
      g.tick((t += 20_000));
    }
    expect(bots.bots().every((b) => b.closer)).toBe(true);
    expect(descents).toHaveLength(0);
    expect(Math.max(...bots.bots().map((b) => b.deepest))).toBe(4); // jamais au-delà du dernier étage
    expect(g.state.seasonOver).toBe(true);
    expect(Object.values(g.state.floors).filter((f) => f.n > 1 && f.collapsed).length).toBeGreaterThanOrEqual(3);
  });
});
