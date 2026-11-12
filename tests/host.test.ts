import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';
import { Host } from '../src/server/host.js';
import type { Narrator } from '../src/server/narrator.js';
import { Hall } from '../src/server/hall.js';
import type { GameEvent } from '../src/shared/types.js';

/** Une fausse Victoria : note ce qu'on lui fait annoncer. */
function fakeNarrator() {
  const said: { facts: string; urgent: boolean }[] = [];
  const n = {
    chatty: 'normal' as const,
    lastSpokeAt: 0,
    talking: false,
    busy: () => n.talking,
    tickChat: () => {},
    chatSummary: () => '',
    announce: async (facts: string, _fallback: string, opts: { urgent?: boolean } = {}) => {
      if (!opts.urgent && n.talking) return false;
      said.push({ facts, urgent: !!opts.urgent });
      n.lastSpokeAt = Date.now();
      return true;
    },
  };
  return { n, said, asNarrator: n as unknown as Narrator };
}

function started() {
  const g = new Game({ ...DEFAULT_CONFIG, lobbySeconds: 0, seed: 5, firstFloorMinutes: 15, lastFloorMinutes: 15, firstLockMinutes: 7.5, lastLockMinutes: 7.5 });
  g.submit('Kilak', '!join knight', Date.now());
  g.tick(Date.now());
  return g;
}

describe('Victoria anime l\'émission', () => {
  it('annonce les règles une fois la partie lancée, une seule fois', () => {
    const g = started();
    const { n, said, asNarrator } = fakeNarrator();
    const h = new Host(g, asNarrator, () => 0);
    n.lastSpokeAt = Date.now(); // pas de rubrique pendant ce test
    g.state.seasonStart = Date.now() - 30_000;
    h.tick();
    h.tick();
    expect(said.filter((s) => /rules in a nutshell/.test(s.facts))).toHaveLength(1);
  });

  it('compte à rebours et escalier : une annonce chacun, urgente', () => {
    const g = started();
    const { n, said, asNarrator } = fakeNarrator();
    const h = new Host(g, asNarrator, () => 0);
    const f = g.floor(1)!;
    g.state.seasonStart = Date.now() - 30_000;
    f.collapseAt = Date.now() + 4 * 60_000;
    f.warned5 = true;
    f.stairsOpened = true;
    n.lastSpokeAt = Date.now();
    h.tick();
    h.tick();
    expect(said.filter((s) => /collapses in five minutes/.test(s.facts))).toHaveLength(1);
    expect(said.filter((s) => /stairs of floor 1 are unsealed/.test(s.facts))).toHaveLength(1);
    expect(said.every((s) => s.urgent)).toBe(true);
  });

  it('accueille les nouveaux par petits groupes, et réessaie si elle parlait', async () => {
    const g = started();
    const { n, said, asNarrator } = fakeNarrator();
    const h = new Host(g, asNarrator, () => 0);
    g.state.seasonStart = Date.now() - 60_000;
    n.lastSpokeAt = Date.now();
    h.tick(); // les présents au démarrage ne sont pas « nouveaux »
    said.length = 0;
    g.submit('Zelda', '!join mage', Date.now());
    g.submit('Morwen', '!join rogue', Date.now());
    n.talking = true;
    h.tick();
    expect(said.filter((s) => /Welcome/.test(s.facts))).toHaveLength(0);
    n.talking = false;
    h.tick(Date.now() + 50_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(said.find((s) => /Welcome/.test(s.facts))?.facts).toMatch(/Zelda and Morwen/);
  });

  it('meuble les blancs avec une rubrique différente à chaque fois', () => {
    const g = started();
    const { n, said, asNarrator } = fakeNarrator();
    const h = new Host(g, asNarrator, () => 0);
    g.state.seasonStart = Date.now() - 60_000;
    h.tick(Date.now()); // règles (urgentes)
    said.length = 0;
    const t0 = Date.now();
    n.lastSpokeAt = t0;
    h.tick(t0 + 130_000);
    n.lastSpokeAt = t0 + 130_000;
    h.tick(t0 + 260_000);
    expect(said).toHaveLength(2);
    expect(said[0].facts).not.toBe(said[1].facts);
  });

  it('Twitch : remercie sans lire de message, et regroupe une vague de cadeaux', () => {
    const g = started();
    const { said, asNarrator } = fakeNarrator();
    const h = new Host(g, asNarrator, () => 0);
    const t = Date.now();
    h.onTwitch({ kind: 'gift', user: 'Bob', count: 5 }, t);
    h.onTwitch({ kind: 'gift', user: 'Bob', count: 1 }, t + 1000);
    h.onTwitch({ kind: 'raid', user: 'BigStreamer', viewers: 42 }, t + 2000);
    expect(said.map((s) => s.facts)).toEqual([expect.stringMatching(/Bob gifted 5 subscriptions/), expect.stringMatching(/BigStreamer is raiding the channel with 42 viewers/)]);
    expect(said[1].urgent).toBe(true);
  });

  it('en partie, elle commente l\'action en direct (même celle des PNJ) quand ça se calme', () => {
    const g = started();
    const { n, said, asNarrator } = fakeNarrator();
    const h = new Host(g, asNarrator, () => 0);
    g.state.seasonStart = Date.now() - 10 * 60_000;
    h.tick(); // les règles d'abord
    h.onEvents([{ kind: 'combat', scope: 'etage', floor: 2, drama: 30, text: 'Brunhilde cleaves a goblin in two.' } as unknown as GameEvent]);
    n.lastSpokeAt = Date.now() - 60_000;
    h.tick();
    expect(said.some((s) => /play-by-play.*Brunhilde cleaves/.test(s.facts))).toBe(true);
  });

  it('elle reconnaît les habitués et leur palmarès', () => {
    const g = started();
    const hall = new Hall(null);
    hall.onEvents([], { state: { players: { mia: { key: 'mia', name: 'Mia', deepest: 5, floor: 5, level: 6, bot: false } } } } as never);
    hall.onEvents([{ victory: { name: 'Mia', floor: 8, level: 9, bot: false } } as unknown as GameEvent, { seasonEnd: true } as GameEvent], { state: { players: {} } } as never);
    const { n, said, asNarrator } = fakeNarrator();
    const h = new Host(g, asNarrator, () => 0, hall);
    h.tick();
    g.state.lobbyUntil = Date.now() + 120_000;
    g.submit('Mia', '!join mage', Date.now());
    g.tick(Date.now());
    n.lastSpokeAt = Date.now();
    h.tick();
    h.tick(Date.now() + 60_000);
    expect(said.some((s) => /Mia \(1 season win/.test(s.facts))).toBe(true);
  });
});
