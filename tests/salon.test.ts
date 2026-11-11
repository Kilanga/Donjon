import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';

const T0 = 1_000_000;
const cfg = { ...DEFAULT_CONFIG, seed: 31, staggered: false, lobbySeconds: 300, firstFloorFactor: 2, floorMinutes: 10, stairsOpenMinutes: 5 };

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
    expect(ev.some((e) => /UNE MINUTE/.test(e.text))).toBe(true);
    expect(ev.some((e) => /LA PARTIE COMMENCE ! 2 aventuriers et 1 PNJ/.test(e.text))).toBe(true);
    expect(g.state.seasonStart).not.toBeNull();
    const a2 = g.player('ana')!;
    expect(a2.level).toBe(1);
    expect(a2.gold).toBe(10);
    expect(a2.cls).toBe('mage'); // la classe est gardée
    expect(g.player('bob')!.cls).toBe('voleur');
    expect(g.player('brunhilde')!.bot).toBe(true);
    expect(g.floor(1)!.uid).not.toBe(oldUid); // donjon neuf
    // l'étage 1 dure deux fois plus longtemps (20 min), escalier ouvert les 10 dernières
    const f1 = g.floor(1)!;
    expect(f1.collapseAt! - g.state.seasonStart!).toBe(20 * 60_000);
    expect(Math.round(g.stairsInMs(f1)! / 60_000)).toBe(10);
  });

  it('les étages suivants gardent 10 min, et la saison dure 90 min', () => {
    const g = new Game({ ...cfg, lobbySeconds: 0 });
    g.submit('ana', '!join', T0);
    expect(g.waveEnd(1) - T0).toBe(20 * 60_000);
    expect(g.waveEnd(2) - T0).toBe(30 * 60_000);
    expect(g.waveEnd(8) - T0).toBe(90 * 60_000);
  });
});
