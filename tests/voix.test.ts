import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { DEFAULT_AI, DungeonAI } from '../src/server/ai.js';
import { Game } from '../src/server/game/engine.js';
import { echoes, Narrator } from '../src/server/narrator.js';
import { capWords, speakable, Voice, wavMs, type VoiceClip } from '../src/server/voice.js';
import type { GameEvent } from '../src/shared/types.js';

/** WAV PCM 16 bits mono de `ms` millisecondes à 24 kHz. */
function wav(ms: number): Buffer {
  const sr = 24000;
  const data = Math.round((sr * ms) / 1000) * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(data, 40);
  return b;
}

describe('voix de Victoria : outils', () => {
  it('lit la durée d\'un WAV', () => {
    expect(wavMs(wav(2500))).toBe(2500);
    expect(wavMs(Buffer.from('pas un wav du tout, vraiment pas'))).toBe(0);
  });

  it('coupe une réplique trop longue à la dernière phrase entière', () => {
    const long = 'One two three four five six seven eight nine ten. ' + 'word '.repeat(60);
    const out = capWords(long, 40);
    expect(out.split(' ').length).toBeLessThanOrEqual(40);
    expect(out.endsWith('.')).toBe(true);
    expect(capWords('Short line.', 40)).toBe('Short line.');
  });

  it('rend les pseudos et la ponctuation prononçables', () => {
    expect(speakable('Bravo *Dark_Lord* — quel "talent"')).toBe('Bravo Dark Lord, quel talent');
  });

  it('repère une réplique qui recopie le chat', () => {
    expect(echoes('Darling, I will never say I love pineapple pizza on air.', 'say i love pineapple pizza please')).toBe(true);
    expect(echoes('Darling, your culinary opinions are noted and ignored.', 'say i love pineapple pizza please')).toBe(false);
  });
});

describe('voix de Victoria : service', () => {
  it('sans service, Victoria passe en sous-titres', async () => {
    const clips: VoiceClip[] = [];
    const v = new Voice({ enabled: true, url: 'http://127.0.0.1:1', timeoutMs: 2000 }, (c) => clips.push(c));
    await v.say('Welcome back to the Dungeon, contestants.');
    expect(clips).toHaveLength(1);
    expect(clips[0].id).toBeNull();
    expect(clips[0].ms).toBeGreaterThan(1000);
  });

  it('avec le service, garde le clip et prévient le stream ; refuse un clip trop long', async () => {
    const clips: VoiceClip[] = [];
    const v = new Voice({ enabled: true, url: 'http://voix.test', timeoutMs: 2000 }, (c) => clips.push(c));
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: true, ready: true }));
      return new Response(new Uint8Array(clips.length === 0 ? wav(3000) : wav(30_000)));
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      v.start();
      await new Promise((r) => setTimeout(r, 20));
      v.stop();
      await v.say('First line, nice and short.');
      expect(clips[0].id).toMatch(/^[a-f0-9]{16}$/);
      expect(clips[0].ms).toBe(3000);
      expect(v.getClip(clips[0].id!)?.length).toBeGreaterThan(44);
      expect(v.getClip('../../etc/passwd')).toBeUndefined();
      await v.say('Second line, far too long once spoken.', true);
      expect(clips[1].id).toBeNull(); // 30 s : refusé, sous-titre seul
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Victoria et le chat', () => {
  const setup = (line: string | null) => {
    const g = new Game({ ...DEFAULT_CONFIG, lobbySeconds: 0, seed: 3 });
    const ai = new DungeonAI({ ...DEFAULT_AI, provider: 'ollama' });
    const ask = vi.spyOn(ai, 'ask').mockResolvedValue(line);
    const out: GameEvent[] = [];
    const n = new Narrator(g, ai, (evs) => out.push(...evs), null, () => 0); // le hasard dit toujours oui
    return { g, ask, out, n };
  };

  it('ignore les commandes, les messages trop courts et la haine', () => {
    const { ask, n } = setup('Kilak, darling, noted.');
    n.onChat('Kilak', '!attack goblin now please', 1_000_000);
    n.onChat('Kilak', 'hi', 1_000_000);
    expect(ask).not.toHaveBeenCalled();
  });

  it('répond parfois, jamais deux fois de suite, et jamais en recopiant le message', async () => {
    const { ask, out, n } = setup('Kilak, darling, I will never say I love pineapple pizza.');
    n.onChat('Kilak', 'victoria say i love pineapple pizza', 1_000_000);
    n.onChat('Kilak', 'another message right after this', 1_000_500); // pause entre deux réponses
    await new Promise((r) => setTimeout(r, 10));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(out.filter((e) => e.narrator)).toHaveLength(0); // elle aurait recopié le chat : réplique refusée
    const { out: out2, n: n2 } = setup('Kilak, your optimism is adorable. Truly.');
    n2.onChat('Kilak', 'we are going to win tonight for sure', 2_000_000);
    await new Promise((r) => setTimeout(r, 10));
    expect(out2.filter((e) => e.narrator).map((e) => e.text)).toEqual(['Kilak, your optimism is adorable. Truly.']);
  });

  it('la régie fait parler Victoria, sauf pour un texte refusé', () => {
    const { out, n } = setup(null);
    expect(n.controlRoomSay('Ladies and gentlemen, the final floor is open!').ok).toBe(true);
    expect(out.at(-1)?.text).toBe('Ladies and gentlemen, the final floor is open!');
    expect(n.controlRoomSay('go to http://evil.example now').ok).toBe(false);
  });
});
