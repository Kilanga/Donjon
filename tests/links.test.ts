import { describe, expect, it } from 'vitest';
import { Links } from '../src/server/links.js';

describe('liaison page web ↔ compte Twitch', () => {
  it('un pseudo vu sur Twitch ne se prend sur la page qu\'avec le bon code, écrit depuis le bon compte', () => {
    const l = new Links<string>(null, ['kilak']);
    l.sawOnTwitch('arnaud');
    expect(l.needsLink('arnaud')).toBe(true);
    expect(l.needsLink('kilak')).toBe(true); // la chaîne elle-même
    expect(l.needsLink('inconnu')).toBe(false);
    const code = l.request('arnaud', 'Arnaud', 'page1');
    expect(code).toMatch(/^\d{4}$/);
    expect(l.confirm(code, 'troll')).toBeNull(); // un autre viewer qui recopie le code : refusé
    const ok = l.confirm(code, 'arnaud');
    expect(ok?.who).toBe('page1');
    expect(l.tokenOpens(ok!.token, 'arnaud')).toBe(true);
    expect(l.tokenOpens(ok!.token, 'autre')).toBe(false);
    expect(l.confirm(code, 'arnaud')).toBeNull(); // code à usage unique
  });

  it('un code expire au bout de 10 minutes', () => {
    const l = new Links<string>(null);
    l.sawOnTwitch('bob');
    const code = l.request('bob', 'Bob', 'p', 0);
    expect(l.confirm(code, 'bob', 11 * 60_000)).toBeNull();
  });

  it('une nouvelle liaison révoque l\'ancienne page (on récupère son perso), et les jetons ne sont pas gardés en clair', () => {
    const l = new Links<string>(null);
    l.sawOnTwitch('cid');
    const a = l.confirm(l.request('cid', 'Cid', 'voleur'), 'cid')!;
    const b = l.confirm(l.request('cid', 'Cid', 'vraie-page'), 'cid')!;
    expect(l.tokenOpens(a.token, 'cid')).toBe(false);
    expect(l.tokenOpens(b.token, 'cid')).toBe(true);
    expect(JSON.stringify((l as unknown as { data: unknown }).data)).not.toContain(b.token);
  });
});
