import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/shared/commands.js';
import { DEFAULT_CONFIG, type GameConfig } from '../src/server/config.js';
import { bfs, generateFloor } from '../src/server/game/dungeon.js';
import { Game, xpNext } from '../src/server/game/engine.js';
import { Rng } from '../src/server/game/rng.js';

const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({ ...DEFAULT_CONFIG, staggered: false, lobbySeconds: 0, firstFloorFactor: 1, seed: 42, ...over });
const T0 = 1_000_000;

function setup(over: Partial<GameConfig> = {}) {
  const g = new Game(cfg(over));
  return g;
}

describe('commandes', () => {
  it('reconnaît le français et les alias anglais', () => {
    expect(parseCommand('!attaque gobelin')).toMatchObject({ name: 'attack', arg: 'gobelin' });
    expect(parseCommand('!attack Gobelin')).toMatchObject({ name: 'attack', arg: 'gobelin' });
    expect(parseCommand('!nord')).toMatchObject({ name: 'move', arg: 'n' });
    expect(parseCommand('!west')).toMatchObject({ name: 'move', arg: 'o' });
    expect(parseCommand('!Équipe épée')).toMatchObject({ name: 'equip', arg: 'epee' });
    expect(parseCommand('bonjour')).toBeNull();
    expect(parseCommand('!danse')).toBeNull();
  });
});

describe('génération', () => {
  it('produit un étage connexe avec safe room, boss et escalier', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = new Rng(seed);
      let id = 0;
      const f = generateFloor(1, 20 + seed, rng, () => `t${id++}`);
      expect(f.rooms.length).toBe(20 + seed);
      const d = bfs(f.rooms, f.spawnRoom);
      expect(d.every((x) => Number.isFinite(x))).toBe(true);
      expect(f.rooms[f.spawnRoom].type).toBe('safe');
      expect(f.rooms[f.bossRoom].stairs).toBe(true);
      expect(f.monsters.filter((m) => m.boss)).toHaveLength(1);
      expect(f.monsters.some((m) => f.rooms[m.roomId].type === 'safe')).toBe(false);
      // Les portes sont symétriques
      for (const r of f.rooms) for (const [dir, nb] of Object.entries(r.doors)) {
        const opp = { n: 's', s: 'n', e: 'o', o: 'e' }[dir as 'n'];
        expect(f.rooms[nb!].doors[opp as 'n']).toBe(r.id);
      }
    }
  });
});

describe('joueurs', () => {
  it('!join crée un crawler dans la safe room avec la classe demandée', () => {
    const g = setup();
    const r = g.submit('Arnaud', '!join mage', T0);
    expect(r.ok).toBe(true);
    const p = g.player('arnaud')!;
    expect(p.cls).toBe('mage');
    expect(g.room(p).type).toBe('safe');
    expect(p.immuneUntil).toBeGreaterThan(T0);
    expect(g.submit('Arnaud', '!join', T0).ok).toBe(false);
  });

  it('la dernière commande du tour est celle qui compte', () => {
    const g = setup();
    g.submit('a', '!join', T0);
    g.submit('a', '!fouille', T0);
    g.submit('a', '!repos', T0);
    expect(g.player('a')!.pending?.name).toBe('rest');
  });

  it('pas de combat entre joueurs en safe room', () => {
    const g = setup({ immunitySeconds: 0 });
    g.submit('a', '!join barbare', T0);
    g.submit('b', '!join mage', T0);
    g.submit('a', '!attaque b', T0);
    const ev = g.tick(T0 + 20_000);
    expect(ev.some((e) => e.to === 'a' && e.text.includes('safe room'))).toBe(true);
    expect(g.player('b')!.hp).toBe(g.player('b')!.maxHp);
  });

  it('immunité après arrivée : impossible d\'attaquer ou d\'être attaqué', () => {
    const g = setup({ immunitySeconds: 180 });
    g.submit('a', '!join barbare', T0);
    g.submit('b', '!join mage', T0);
    const a = g.player('a')!;
    const b = g.player('b')!;
    // On les déplace dans une salle normale
    const f = g.floor(a.floor)!;
    const normal = f.rooms.find((r) => r.type === 'normale')!;
    f.monsters = f.monsters.filter((m) => m.roomId !== normal.id);
    a.roomId = b.roomId = normal.id;
    g.submit('a', '!attaque b', T0);
    const ev = g.tick(T0 + 20_000);
    expect(ev.some((e) => e.to === 'a' && e.text.includes('immunisé'))).toBe(true);
  });
});

describe('mort et réapparition', () => {
  it('le loot tombe au sol, l\'XP baisse, réapparition après 5 tours avec immunité', () => {
    const g = setup({ respawnTurns: 5, immunitySeconds: 180 });
    g.submit('a', '!join chevalier', T0);
    const p = g.player('a')!;
    const f = g.floor(p.floor)!;
    const normal = f.rooms.find((r) => r.type === 'normale')!;
    f.monsters = f.monsters.filter((m) => m.roomId !== normal.id);
    p.roomId = normal.id;
    p.xp = 40;
    p.gold = 50;
    p.hp = 1;
    // Un gros monstre qui frappe à coup sûr
    f.monsters.push({ id: 'm1', kind: 'test', name: 'Bourreau', sprite: 'x', hp: 99, maxHp: 99, atk: 50, def: 0, dmg: 20, xp: 0, gold: 0, roomId: normal.id, wanderer: false, boss: false, distracted: 0, aggro: null });
    let t = T0;
    let turns = 0;
    while (p.alive && turns < 20) { g.tick((t += 20_000)); turns++; }
    expect(p.alive).toBe(false);
    expect(p.xp).toBe(30); // 25 % de 40 perdus
    expect(p.items).toHaveLength(0);
    expect(f.rooms[normal.id].groundGold).toBe(50);
    expect(f.rooms[normal.id].ground.length).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) g.tick((t += 20_000));
    expect(p.alive).toBe(false);
    g.tick((t += 20_000));
    expect(p.alive).toBe(true);
    expect(g.room(p).type).toBe('safe');
    expect(p.hp).toBe(p.maxHp);
    expect(p.immuneUntil).toBe(t + 180_000);
    expect(p.weapon).not.toBeNull(); // arme de départ rendue
  });
});

describe('alliances et trahisons', () => {
  it('alliance mutuelle, XP partagée, trahison avec vol d\'or', () => {
    const g = setup({ immunitySeconds: 0 });
    g.submit('a', '!join voleur', T0);
    g.submit('b', '!join barbare', T0);
    expect(g.submit('a', '!alliance b', T0).text).toContain('Proposition');
    g.submit('b', '!alliance a', T0);
    const a = g.player('a')!;
    const b = g.player('b')!;
    expect(a.allianceId).not.toBeNull();
    expect(a.allianceId).toBe(b.allianceId);

    const f = g.floor(a.floor)!;
    const normal = f.rooms.find((r) => r.type === 'normale')!;
    f.monsters = f.monsters.filter((m) => m.roomId !== normal.id);
    a.roomId = b.roomId = normal.id;
    b.gold = 100;
    b.hp = 500;
    b.maxHp = 500;
    let t = T0;
    let hit = false;
    for (let i = 0; i < 10 && !hit; i++) {
      g.submit('a', '!attaque b', t);
      const ev = g.tick((t += 20_000));
      if (ev.some((e) => e.kind === 'trahison' && e.text.includes('po'))) hit = true;
      if (i === 0) {
        expect(ev.some((e) => e.text.startsWith('TRAHISON'))).toBe(true);
        expect(a.allianceId).toBeNull();
        expect(a.traitorUntilTurn).toBeGreaterThan(0);
      }
    }
    expect(hit).toBe(true);
    expect(b.gold).toBeLessThan(100);
  });
});

describe('progression', () => {
  it('monter de niveau donne un point de stat et des PV', () => {
    const g = setup();
    g.submit('a', '!join barbare', T0);
    const p = g.player('a')!;
    const hp = p.maxHp;
    g.gainXp(p, xpNext(1));
    expect(p.level).toBe(2);
    expect(p.statPoints).toBe(1);
    expect(p.maxHp).toBe(hp + 6);
    expect(g.submit('a', '!monte for', T0).ok).toBe(true);
    expect(p.stats.for).toBe(4);
    expect(g.submit('a', '!monte for', T0).ok).toBe(false);
  });
});

describe('étages', () => {
  it('effondrement : GAME OVER pour les joueurs restés (ils peuvent refaire !join), les nouveaux entrent dans un étage 1 recreusé', () => {
    const g = setup({ floorMinutes: 1, respawnTurns: 1 });
    g.submit('a', '!join', T0);
    const oldUid = g.floor(1)!.uid;
    const ev = g.tick(T0 + 61_000);
    expect(ev.some((e) => /EFFONDRE/.test(e.text) && /GAME OVER pour a/.test(e.text))).toBe(true);
    expect(g.player('a')).toBeUndefined(); // éliminé
    // Il recommence (et un nouveau joueur aussi) à l'étage 1, recreusé à neuf
    expect(g.submit('a', '!join', T0 + 82_000).ok).toBe(true);
    g.submit('c', '!join', T0 + 82_000);
    expect(g.player('c')!.floor).toBe(1);
    expect(g.floor(1)!.collapsed).toBe(false);
    expect(g.floor(1)!.uid).not.toBe(oldUid);
  });

  it('effondrement : un retardataire, lui, tombe vivant à l\'étage suivant (PV et or perdus, équipement gardé)', () => {
    const g = setup({ floorMinutes: 1, respawnTurns: 1 });
    g.submit('a', '!join', T0);
    g.joinBot('Firmin', 'barbare', true);
    const p = g.player('Firmin')!;
    p.gold = 50;
    const weapon = p.weapon;
    const ev = g.tick(T0 + 61_000);
    expect(ev.some((e) => e.text.includes('traverse le plancher'))).toBe(true);
    expect(p.alive).toBe(true);
    expect(p.floor).toBe(2);
    expect(p.gold).toBe(30); // 40 % perdus
    expect(p.weapon).toBe(weapon);
    expect(p.stunned).toBe(true);
  });

  it('on ne descend pas tant que le boss est vivant', () => {
    const g = setup();
    g.submit('a', '!join', T0);
    const p = g.player('a')!;
    const f = g.floor(1)!;
    p.roomId = f.bossRoom;
    g.submit('a', '!descendre', T0);
    g.tick(T0 + 20_000);
    if (p.alive) expect(p.floor).toBe(1);
    f.monsters = f.monsters.filter((m) => !m.boss);
    p.alive = true;
    p.hp = p.maxHp;
    p.roomId = f.bossRoom;
    // Boss vaincu, mais l'escalier est encore scellé (première moitié de l'étage)
    g.submit('a', '!descendre', T0 + 20_000);
    g.tick(T0 + 40_000);
    expect(p.floor).toBe(1);
    expect(g.stairsInMs(f)).toBeGreaterThan(0);
    // Il se descelle à mi-parcours (floorMinutes − stairsOpenMinutes), avec une annonce
    const open = T0 + (DEFAULT_CONFIG.floorMinutes - DEFAULT_CONFIG.stairsOpenMinutes) * 60_000;
    const ev = g.tick(open + 1000);
    expect(ev.some((e) => /SE DESCELLE/.test(e.text))).toBe(true);
    p.alive = true;
    p.hp = p.maxHp;
    p.roomId = f.bossRoom;
    g.submit('a', '!descendre', open + 2000);
    g.tick(open + 21_000);
    expect(p.floor).toBe(2);
  });

  it('les étages tombent à heure fixe depuis le début de la saison, quel que soit le rythme', () => {
    const g = setup();
    const F = DEFAULT_CONFIG.floorMinutes * 60_000;
    g.submit('a', '!join', T0);
    expect(g.state.seasonStart).toBe(T0);
    expect(g.floor(1)!.collapseAt).toBe(T0 + F);
    // Quelqu'un arrive très tôt à l'étage 3 : il tombe quand même à T0 + 3F
    const p = g.player('a')!;
    const f3 = g.freshFloor(3);
    p.floor = 3;
    p.roomId = f3.spawnRoom;
    g.submit('a', '!fouille', T0 + 60_000);
    g.tick(T0 + 80_000);
    p.alive = true;
    // (le chrono s'arme à l'arrivée : on le déclenche par une réapparition sur place)
    p.alive = false;
    p.respawnIn = 1;
    p.deathTurn = -1;
    g.tick(T0 + 100_000);
    expect(g.floor(3)!.collapseAt).toBe(T0 + 3 * F);
  });
});

describe('inactivité', () => {
  it('un joueur inactif continue d\'attaquer son monstre', () => {
    const g = setup();
    g.submit('a', '!join barbare', T0);
    const p = g.player('a')!;
    const f = g.floor(1)!;
    const normal = f.rooms.find((r) => r.type === 'normale')!;
    f.monsters = f.monsters.filter((m) => m.roomId !== normal.id);
    p.roomId = normal.id;
    p.hp = p.maxHp = 999;
    f.monsters.push({ id: 'sac', kind: 'sac', name: 'Sac de frappe', sprite: 'x', hp: 999, maxHp: 999, atk: -20, def: -20, dmg: 1, xp: 0, gold: 0, roomId: normal.id, wanderer: false, boss: false, distracted: 0, aggro: null });
    g.submit('a', '!attaque sac', T0);
    g.tick(T0 + 20_000);
    const hp1 = f.monsters.find((m) => m.id === 'sac')!.hp;
    // aucune commande pendant 3 tours : il continue de frapper (un 1 naturel peut rater un tour, pas les trois)
    for (const k of [2, 3, 4]) g.tick(T0 + k * 20_000);
    const hp2 = f.monsters.find((m) => m.id === 'sac')!.hp;
    expect(hp2).toBeLessThan(hp1);
  });
});
