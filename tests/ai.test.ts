import { afterEach, describe, expect, it, vi } from 'vitest';
import { clean, DEFAULT_AI, DungeonAI, NARRATOR_SYSTEM, type AiConfig } from '../src/server/ai.js';
import { DEFAULT_CONFIG } from '../src/server/config.js';
import { Game } from '../src/server/game/engine.js';
import { Narrator } from '../src/server/narrator.js';
import type { GameEvent } from '../src/shared/types.js';

const cfg = (over: Partial<AiConfig> = {}): AiConfig => ({ ...DEFAULT_AI, ...over });
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('IA du donjon', () => {
  it('provider off : aucun appel réseau', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ai = new DungeonAI(cfg({ provider: 'off' }));
    expect(ai.enabled).toBe(false);
    expect(await ai.ask('s', 'p')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('anthropic sans clé : désactivé', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ai = new DungeonAI(cfg({ provider: 'anthropic' }), '');
    expect(ai.enabled).toBe(false);
    expect(await ai.ask('s', 'p')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('appelle Ollama sur /api/chat sans streaming', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ message: { content: '  « Bram a encore marché sur les piques. »  ' } }));
    vi.stubGlobal('fetch', fetchMock);
    const ai = new DungeonAI(cfg({ provider: 'ollama', ollamaUrl: 'http://localhost:11434/', ollamaModel: 'qwen2.5:14b' }));
    const out = await ai.ask(NARRATOR_SYSTEM, 'Évènement : Bram est mort.');
    expect(out).toBe('Bram a encore marché sur les piques.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(init.body);
    expect(body.stream).toBe(false);
    expect(body.model).toBe('qwen2.5:14b');
    expect(body.messages[0]).toEqual({ role: 'system', content: NARRATOR_SYSTEM });
    expect(body.messages[1].content).toContain('Bram');
  });

  it('appelle l\'API Claude avec les bons en-têtes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ content: [{ type: 'text', text: 'Quelle trahison, quelle audience.' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const ai = new DungeonAI(cfg({ provider: 'anthropic', anthropicModel: 'claude-haiku-5-5' }), 'cle-secrete');
    expect(await ai.ask('système', 'prompt')).toBe('Quelle trahison, quelle audience.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('cle-secrete');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['content-type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.system).toBe('système');
    expect(body.max_tokens).toBeLessThanOrEqual(150);
  });

  it('délai dépassé : renvoie null sans exception', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_res, rej) => {
        init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ai = new DungeonAI(cfg({ provider: 'ollama', timeoutMs: 30 }));
    await expect(ai.ask('s', 'p')).resolves.toBeNull();
  });

  it('erreur HTTP : renvoie null sans exception', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    const ai = new DungeonAI(cfg({ provider: 'ollama' }));
    await expect(ai.ask('s', 'p')).resolves.toBeNull();
  });

  it('respecte la limite de débit par minute', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ message: { content: 'ok' } }));
    vi.stubGlobal('fetch', fetchMock);
    const ai = new DungeonAI(cfg({ provider: 'ollama', maxPerMinute: 3 }));
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await ai.ask('s', 'p'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(results.filter((r) => r === null)).toHaveLength(2);
  });

  it('nettoie les réponses', () => {
    expect(clean('"Bonjour"')).toBe('Bonjour');
    expect(clean('<think>hmm</think>  Salut\n le monde ')).toBe('Salut le monde');
    expect(clean('   ')).toBeNull();
    expect(clean('a '.repeat(300))!.length).toBeLessThanOrEqual(280);
  });
});

describe('Narrateur', () => {
  it('commente les évènements dramatiques et ajoute un évènement narrator', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ message: { content: 'Le donjon applaudit.' } })));
    const game = new Game({ ...DEFAULT_CONFIG, staggered: false, seed: 3 });
    game.ensureFloor(1);
    const delivered: GameEvent[] = [];
    const n = new Narrator(game, new DungeonAI(cfg({ provider: 'ollama' })), (evs) => delivered.push(...evs));
    const ev: GameEvent = { id: 1, turn: game.state.turn, floor: 1, kind: 'mort', text: 'Bram est mort.', scope: 'global', drama: 90 };
    const calm: GameEvent = { ...ev, id: 2, drama: 10 };
    n.onTurn([ev, calm]);
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    expect(delivered[0].narrator).toBe(true);
    expect(delivered[0].text).toBe('Le donjon applaudit.');
    expect(delivered[0].scope).toBe('global');
  });

  it('!parle hors safe room : refus ; en safe room sans IA : réplique écrite', () => {
    const game = new Game({ ...DEFAULT_CONFIG, staggered: false, seed: 5 });
    game.submit('a', '!join', 1000);
    const delivered: GameEvent[] = [];
    const n = new Narrator(game, new DungeonAI(cfg({ provider: 'off' })), (evs) => delivered.push(...evs));
    const r = n.talk('a', 'salut');
    expect(r.ok).toBe(true);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].text).toContain('marchand');
    const p = game.player('a')!;
    p.roomId = game.floor(1)!.rooms.find((x) => x.type === 'normale')!.id;
    expect(n.talk('a', 'salut').ok).toBe(false);
  });
});
