import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';

const T0 = 1_000_000;
const cfg = { ...DEFAULT_CONFIG, seed: 31, staggered: false, lobbySeconds: 300, firstFloorMinutes: 20, lastFloorMinutes: 10, firstLockMinutes: 10, lastLockMinutes: 5 };

describe('salon d\'attente et coup d\'envoi', () => {
  it('le premier !join ouvre 5 min d\'inscriptions ; ensuite tout repart à zéro pour tout le monde', () => {
    const g = new Game(cfg);
    g.joinBot('Brunhilde', 'chevalier');
    expect(g.state.lobbyUntil).toBeNull(); // un PNJ n'ouvre rien
    g.submit('ana', '!join mage', T0);
    expect(g.state.lobbyUntil).toBe(T0 + 300_000);
    expect(g.state.seasonStart).toBeNull();
    expect(g.floor(1)!.collapseAt).toBeNull(); // pas de chrono pendant l'échauffement
    // échauffement : ana gagne de l'or, se promène
    const ana = g.player('ana')!;
    ana.gold = 999;
    ana.level = 3;
    const oldUid = g.floor(1)!.uid;
    g.submit('bob', '!join voleur', T0 + 100_000);
    let t = T0;
    let ev: { text: string }[] = [];
    while (t < T0 + 300_000) ev = ev.concat(g.tick((t += 20_000)));
    expect(ev.some((e) => /ONE MINUTE/.test(e.text))).toBe(true);
    expect(ev.some((e) => /THE GAME BEGINS! 2 adventurers and 1 NPC enter/.test(e.text))).toBe(true);
    expect(g.state.seasonStart).not.toBeNull();
    const a2 = g.player('ana')!;
    expect(a2.level).toBe(1);
    expect(a2.gold).toBe(10);
    expect(a2.cls).toBe('mage'); // la classe est gardée
    expect(g.player('bob')!.cls).toBe('voleur');
    expect(g.player('brunhilde')!.bot).toBe(true);
    expect(g.floor(1)!.uid).not.toBe(oldUid); // donjon neuf
    // l'étage 1 dure 20 min, escalier scellé les 10 premières
    const f1 = g.floor(1)!;
    expect(f1.collapseAt! - g.state.seasonStart!).toBe(20 * 60_000);
    expect(Math.round(g.stairsInMs(f1)! / 60_000)).toBe(10);
  });

  it('durées et verrous dégressifs jusqu\'à l\'avant-dernier étage ; le dernier n\'a pas d\'escalier', () => {
    const g = new Game({ ...cfg, lobbySeconds: 0 });
    const min = (ms: number) => ms / 60_000;
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => min(g.floorSpan(n)))).toEqual([20, 18.5, 16.5, 15, 13.5, 11.5, 10]);
    expect([1, 4, 7].map((n) => min(g.lockMs(n)))).toEqual([10, 7.5, 5]);
    expect(min(g.floorSpan(8))).toBe(DEFAULT_CONFIG.finalFloorMaxMinutes); // filet de sécurité
    expect(g.lockMs(8)).toBe(0);
  });

  it('réglages par défaut : 25 min (scellé 10) au premier étage, 15 min (scellé 5) au septième', () => {
    const g = new Game({ ...DEFAULT_CONFIG, lobbySeconds: 0 });
    const min = (ms: number) => ms / 60_000;
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => min(g.floorSpan(n)))).toEqual([25, 23.5, 21.5, 20, 18.5, 16.5, 15]);
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => min(g.lockMs(n)))).toEqual([10, 9, 8.5, 7.5, 6.5, 6, 5]);
  });
});
