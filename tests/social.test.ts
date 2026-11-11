import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';

const T0 = 1_000_000;
const cfg = { ...DEFAULT_CONFIG, seed: 41, staggered: false, lobbySeconds: 0, firstFloorFactor: 1, floorMinutes: 1, stairsOpenMinutes: 0.5 };

function collapseFloor1(g: Game) {
  let t = T0;
  while (!g.floor(1)!.collapsed) g.tick((t += 20_000));
  return t;
}

describe('cimetière, résurrection, paris et sponsors', () => {
  it('à l\'effondrement, chaque éliminé reçoit un numéro, puis le chat vote ; le gagnant revient avec tous ses PV', () => {
    const g = new Game(cfg);
    g.submit('ana', '!join barbare', T0);
    g.submit('bob', '!join mage', T0);
    g.player('ana')!.level = 4;
    const ev: string[] = [];
    let t = T0;
    while (!g.floor(1)!.collapsed) ev.push(...g.tick((t += 20_000)).map((e) => e.text));
    expect(ev.some((e) => /GAME OVER pour ana \(n°1\), bob \(n°2\)/.test(e))).toBe(true);
    expect(ev.some((e) => /VOTE DE RÉSURRECTION/.test(e))).toBe(true);
    expect(g.player('ana')).toBeUndefined();
    expect(g.voteView(null)?.title).toMatch(/SECONDE CHANCE/);
    // le chat vote (même sans perso) : une voix par pseudo, définitive
    expect(g.submit('viewer1', '!vote 2', t).ok).toBe(true);
    expect(g.submit('viewer2', '!vote 2', t).ok).toBe(true);
    expect(g.submit('viewer1', '!vote 1', t).ok).toBe(false); // déjà voté
    expect(g.submit('bob', '!vote 1 300', t).ok).toBe(true); // les points n'achètent rien
    expect(g.voteView(null)!.options.find((o) => o.n === 1)!.votes).toBe(1);
    for (let i = 0; i < 4; i++) ev.push(...g.tick((t += 20_000)).map((e) => e.text));
    const res = ev.find((e) => /RÉSURRECTION !/.test(e))!;
    expect(res).toMatch(/bob \(n°2\)/);
    const bob = g.player('bob')!;
    expect(bob.alive).toBe(true);
    expect(bob.hp).toBe(bob.maxHp);
    expect(bob.floor).toBe(2);
    expect(g.state.graveyard.map((x) => x.name)).toEqual(['ana']); // ana reste candidate pour la prochaine fois
  });

  it('égalité : jet de d20 entre les ex æquo', () => {
    const g = new Game(cfg);
    g.submit('ana', '!join', T0);
    g.submit('bob', '!join', T0);
    let t = collapseFloor1(g);
    g.submit('v1', '!vote 1', t);
    g.submit('v2', '!vote 2', t);
    const ev: string[] = [];
    for (let i = 0; i < 4; i++) ev.push(...g.tick((t += 20_000)).map((e) => e.text));
    expect(ev.find((e) => /RÉSURRECTION !/.test(e))).toMatch(/Égalité à 1 voix ! Jet de d20/);
  });

  it('personne ne vote : personne ne revient', () => {
    const g = new Game(cfg);
    g.submit('ana', '!join', T0);
    let t = collapseFloor1(g);
    const ev: string[] = [];
    for (let i = 0; i < 4; i++) ev.push(...g.tick((t += 20_000)).map((e) => e.text));
    expect(ev.some((e) => /les morts restent morts/.test(e))).toBe(true);
    expect(g.player('ana')).toBeUndefined();
  });

  it('sponsors : potion offerte, monstre livré (pas en safe room), délai de 2 min, points débités', () => {
    const g = new Game(cfg);
    g.submit('ana', '!join', T0);
    const ana = g.player('ana')!;
    const n0 = ana.items.length;
    expect(g.submit('fan', '!sponsor ana potion', T0).ok).toBe(true);
    expect(ana.items.length).toBe(n0 + 1);
    expect(g.submit('fan', '!sponsor ana or', T0 + 1000).ok).toBe(false); // délai
    expect(g.submit('troll', '!sponsor ana monstre', T0).ok).toBe(false); // safe room + immunité
    ana.roomId = g.floor(1)!.rooms.find((r) => r.type === 'normale')!.id;
    ana.immuneUntil = 0;
    const before = g.floor(1)!.monsters.length;
    expect(g.submit('troll', '!sponsor ana monstre', T0 + 2000).ok).toBe(true);
    expect(g.floor(1)!.monsters.length).toBe(before + 1);
    expect(g.submit('troll', '!faveur', T0).text).toMatch(/20 points/);
    expect(g.submit('ana', '!sponsor ana potion', T0 + 999_999).ok).toBe(false); // pas pour soi
  });

  it('pari éclair sur un boss : les gagnants se partagent la cagnotte + 50 %', () => {
    const g = new Game({ ...cfg, floorMinutes: 10, stairsOpenMinutes: 5 });
    g.submit('ana', '!join barbare', T0);
    const f = g.floor(1)!;
    const boss = f.monsters.find((m) => m.boss)!;
    const ana = g.player('ana')!;
    ana.roomId = boss.roomId;
    ana.immuneUntil = 0;
    boss.hp -= 1; // le combat a commencé
    g.tick(T0 + 20_000);
    expect(g.state.flashBet?.kind).toBe('boss');
    expect(g.submit('v1', '!parie oui 50', T0 + 21_000).ok).toBe(true);
    expect(g.submit('v2', '!parie non 50', T0 + 21_000).ok).toBe(true);
    expect(g.submit('v1', '!parie non 10', T0 + 21_000).ok).toBe(false); // pas de retournement de veste
    boss.hp = 0;
    f.monsters = f.monsters.filter((m) => m !== boss);
    const ev = g.tick(T0 + 40_000).map((e) => e.text);
    expect(ev.some((e) => /PARI ÉCLAIR : c'est « oui »/.test(e))).toBe(true);
    expect(g.state.wallets['v1'].pts).toBe(100 - 50 + 150); // cagnotte 100 + 50 % = 150
    expect(g.state.wallets['v2'].pts).toBe(50);
  });

  it('grand pari : le premier à sortir rapporte la cagnotte + 100 points', () => {
    const g = new Game({ ...cfg, finalFloor: 1, floorMinutes: 10, stairsOpenMinutes: 10 });
    g.submit('ana', '!join', T0);
    g.submit('bob', '!join', T0);
    expect(g.submit('v1', '!parie ana 40', T0).ok).toBe(true);
    expect(g.submit('v2', '!parie bob 60', T0).ok).toBe(true);
    const f = g.floor(1)!;
    f.monsters = f.monsters.filter((m) => !m.boss);
    const ana = g.player('ana')!;
    ana.roomId = f.bossRoom;
    g.submit('ana', '!descendre', T0 + 1000);
    const ev = g.tick(T0 + 20_000).map((e) => e.text);
    expect(ev.some((e) => /GRAND PARI GAGNÉ/.test(e))).toBe(true);
    expect(g.state.wallets['v1'].pts).toBe(60 + 200); // 100 de cagnotte + 100 de la production
  });
});
