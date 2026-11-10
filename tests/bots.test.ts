import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';
import { BotManager } from '../src/server/bots.js';

function setup(target: number, humans: Set<string>) {
  const g = new Game({ ...DEFAULT_CONFIG, seed: 3 });
  const said: string[] = [];
  const bots = new BotManager(g, {
    submit: (name, text) => void g.submit(name, text),
    say: (_n, text) => void said.push(text),
    pos: () => {},
    humanActive: (p) => humans.has(p.key),
  }, target);
  return { g, bots, said };
}

describe('PNJ figurants', () => {
  it('arrivent un par tour jusqu\'au nombre voulu, puis cèdent la place aux vrais joueurs', () => {
    const humans = new Set<string>();
    const { g, bots } = setup(10, humans);
    let t = 1_000_000;
    for (let i = 0; i < 12; i++) {
      bots.afterTurn();
      g.tick((t += 20_000));
    }
    expect(bots.bots()).toHaveLength(10);
    expect(bots.bots().every((b) => b.bot)).toBe(true);
    // Trois vrais joueurs arrivent : trois PNJ partent (un par tour)
    for (const n of ['ana', 'bob', 'cid']) {
      g.submit(n, '!join', t);
      humans.add(n);
    }
    for (let i = 0; i < 4; i++) {
      bots.afterTurn();
      g.tick((t += 20_000));
    }
    expect(bots.bots()).toHaveLength(7);
    expect(g.leaderboard().filter((r) => r.bot)).toHaveLength(7);
  });

  it('jouent 300 tours sans erreur, progressent et n\'attaquent jamais de joueur', () => {
    const humans = new Set<string>(['ana']);
    const { g, bots } = setup(10, humans);
    let t = 1_000_000;
    g.submit('ana', '!join chevalier', t);
    let pvp = 0;
    for (let i = 0; i < 300; i++) {
      bots.afterTurn();
      const ev = g.tick((t += 20_000));
      pvp += ev.filter((e) => e.fx?.src?.startsWith('p:') && e.fx?.dst?.startsWith('p:') && e.fx.src !== e.fx.dst).length;
    }
    const all = bots.bots();
    expect(all.length).toBeGreaterThan(0);
    expect(all.reduce((s, b) => s + b.kills, 0)).toBeGreaterThan(10);
    expect(Math.max(...all.map((b) => b.deepest))).toBeGreaterThanOrEqual(2);
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
});
