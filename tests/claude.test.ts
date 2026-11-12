import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI, DungeonAI } from '../src/server/ai.js';

afterEach(() => vi.unstubAllGlobals());
const ok = (text: string) => new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }), { status: 200 });

describe('Claude : réplique sans réflexion préalable', () => {
  it('demande une réponse directe (pas de réflexion qui mange le budget)', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => (bodies.push(JSON.parse(String(init.body))), ok('Darling, the show must go on.'))));
    const ai = new DungeonAI({ ...DEFAULT_AI, provider: 'anthropic' }, 'test-key');
    expect(await ai.ask('sys', 'hello')).toBe('Darling, the show must go on.');
    expect(bodies[0]).toMatchObject({ thinking: { type: 'between_tools' }, output_config: { effort: 'low' } });
  });

  it('un modèle qui refuse ces réglages : on réessaie sans, et on ne les renvoie plus', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      bodies.push(b);
      if (b.thinking) return new Response(JSON.stringify({ error: { message: 'thinking: unknown type between_tools' } }), { status: 400 });
      return ok('Fine, darling.');
    }));
    const ai = new DungeonAI({ ...DEFAULT_AI, provider: 'anthropic' }, 'test-key');
    expect(await ai.ask('sys', 'a')).toBe('Fine, darling.');
    expect(await ai.ask('sys', 'b')).toBe('Fine, darling.');
    expect(bodies.map((b) => !!b.thinking)).toEqual([true, false, false]);
  });
});
