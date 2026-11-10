import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type GameConfig } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';

const T0 = 1_000_000;
const make = (over: Partial<GameConfig> = {}) => new Game({ ...DEFAULT_CONFIG, seed: 3, voteEveryMinutes: 1, voteTurns: 2, turnSeconds: 20, ...over });

describe('votes de la production', () => {
  it('lance un vote, compte les voix et applique le gagnant', () => {
    const g = make();
    g.submit('a', '!join', T0);
    g.submit('b', '!join', T0);
    let t = T0;
    for (let i = 0; i < 8 && !g.state.vote; i++) g.tick((t += 20_000));
    expect(g.state.vote).not.toBeNull();
    const v = g.voteView('a')!;
    expect(v.options.length).toBeGreaterThan(0);
    expect(g.submit('a', '!vote 1', t).ok).toBe(true);
    expect(g.submit('b', '!vote 1', t).ok).toBe(true);
    expect(g.voteView('a')!.options[0].votes).toBe(2);
    expect(g.voteView('a')!.myVote).toBe(v.options[0].key);
    const label = v.options[0].label.toUpperCase();
    let applied = false;
    for (let i = 0; i < 3 && !applied; i++) applied = g.tick((t += 20_000)).some((e) => e.text.includes('A TRANCHÉ') && e.text.includes(label));
    expect(applied).toBe(true);
    expect(g.state.vote).toBeNull();
  });

  it('!vote sans vote en cours est refusé proprement', () => {
    const g = make({ voteEveryMinutes: 0 });
    g.submit('a', '!join', T0);
    expect(g.submit('a', '!vote 1', T0).ok).toBe(false);
  });

  it('chaque événement s\'applique sans erreur', () => {
    const g = make({ voteEveryMinutes: 0 });
    g.submit('a', '!join', T0);
    g.submit('b', '!join', T0);
    g.player('a')!.kills = 3;
    for (const key of ['pluie_or', 'lacher_monstres', 'happy_hour', 'resurrection', 'prime', 'inondation', 'festin', 'pieges_promo', 'prolongation', 'acceleration']) {
      expect(() => g.applyProduction(key, 'test')).not.toThrow();
    }
    expect(g.state.bounty?.target).toBe('a');
    expect(g.effectsView().happyHourTurns).toBe(10);
  });

  it('happy hour : prix divisé par deux', () => {
    const g = make({ voteEveryMinutes: 0 });
    g.submit('a', '!join', T0);
    const before = g.viewFor('a', T0).merchant![0].price;
    g.applyProduction('happy_hour', 'test');
    expect(g.viewFor('a', T0).merchant![0].price).toBe(Math.max(1, Math.ceil(before / 2)));
  });

  it('la prime est encaissée par le tueur', () => {
    const g = make({ voteEveryMinutes: 0, immunitySeconds: 0 });
    g.submit('a', '!join barbare', T0);
    g.submit('b', '!join mage', T0);
    const a = g.player('a')!;
    const b = g.player('b')!;
    b.kills = 5;
    g.applyProduction('prime', 'test');
    expect(g.state.bounty?.target).toBe('b');
    const f = g.floor(1)!;
    const room = f.rooms.find((r) => r.type === 'normale')!;
    f.monsters = f.monsters.filter((m) => m.roomId !== room.id);
    a.roomId = b.roomId = room.id;
    b.hp = 1;
    b.stats.agi = -20;
    const gold = a.gold;
    let t = T0;
    for (let i = 0; i < 10 && b.alive; i++) {
      g.submit('a', '!attaque b', t);
      g.tick((t += 20_000));
    }
    expect(b.alive).toBe(false);
    expect(a.gold).toBeGreaterThan(gold);
    expect(g.state.bounty).toBeNull();
  });
});

describe('classement et régie', () => {
  it('classement trié par profondeur puis niveau', () => {
    const g = make({ voteEveryMinutes: 0 });
    g.submit('a', '!join', T0);
    g.submit('b', '!join', T0);
    g.player('b')!.deepest = 3;
    expect(g.leaderboard()[0].name).toBe('b');
  });

  it('effondrement forcé par la régie et nouvelle partie', () => {
    const g = make({ voteEveryMinutes: 0, respawnTurns: 1 });
    g.submit('a', '!join', T0);
    expect(g.adminCollapse(1, T0)).toBe(true);
    g.tick(T0 + 20_000);
    expect(g.player('a')!.floor).toBe(2); // tombé à l'étage suivant
    const lastId = g.state.nextId;
    g.reset();
    expect(Object.keys(g.state.players)).toHaveLength(0);
    expect(g.state.nextId).toBeGreaterThanOrEqual(lastId);
    expect(g.floor(1)).toBeDefined();
  });

  it('une vieille sauvegarde sans les nouveaux champs se recharge', () => {
    const g = make();
    g.submit('a', '!join', T0);
    const old = JSON.parse(JSON.stringify(g.state));
    delete old.vote;
    delete old.bounty;
    delete old.players.a.betrayals;
    const g2 = new Game({ ...DEFAULT_CONFIG }, old);
    expect(g2.state.vote).toBeNull();
    expect(g2.player('a')!.betrayals).toBe(0);
    expect(() => g2.tick(T0 + 20_000)).not.toThrow();
  });
});
