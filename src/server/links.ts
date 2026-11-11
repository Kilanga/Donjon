// Liaison page web ↔ compte Twitch, sans mot de passe ni connexion Twitch :
// un pseudo déjà vu dans le chat Twitch ne peut être pris sur la page qu'après avoir écrit « !lien <code> » dans le chat
// depuis ce compte-là. La page reçoit alors un jeton (gardé dans le navigateur) qui évite de recommencer.
// Tout est gardé dans data/liens.json (pseudos Twitch vus, jetons), pour survivre à un redémarrage du jeu.
import crypto from 'node:crypto';
import { readJsonSafe, writeAtomic } from './fsutil.js';

interface Stored {
  twitch: string[]; // clés des pseudos vus dans le chat Twitch
  tokens: Record<string, string>; // empreinte SHA-256 du jeton -> clé du pseudo (le jeton lui-même n'est jamais écrit sur disque)
}

interface Pending<T> {
  key: string;
  name: string;
  who: T; // la page en attente
  until: number;
}

export class Links<T> {
  private data: Stored = { twitch: [], tokens: {} };
  private seen = new Set<string>();
  private pending = new Map<string, Pending<T>>(); // code -> attente
  private dirty = false;

  constructor(private file: string | null, private reserved: string[] = []) {
    const d = file ? readJsonSafe<Stored>(file, 'liens') : undefined;
    if (d && Array.isArray(d.twitch) && d.tokens && typeof d.tokens === 'object') this.data = d;
    this.seen = new Set(this.data.twitch);
  }

  /** Un pseudo vient de parler dans le chat Twitch. */
  sawOnTwitch(key: string) {
    if (!key || this.seen.has(key)) return;
    this.seen.add(key);
    this.data.twitch.push(key);
    this.dirty = true;
  }

  /** Ce pseudo appartient-il à un compte Twitch (il faut alors prouver que c'est bien soi) ? */
  needsLink(key: string): boolean {
    return this.seen.has(key) || this.reserved.includes(key);
  }

  /** Le jeton présenté par la page ouvre-t-il ce pseudo ? */
  tokenOpens(token: string | undefined, key: string): boolean {
    return !!token && token.length <= 64 && this.data.tokens[hash(token)] === key;
  }

  /** Demande de liaison : renvoie le code à écrire dans le chat (valable 10 min). */
  request(key: string, name: string, who: T, now = Date.now()): string {
    for (const [c, p] of this.pending) if (p.until < now || p.who === who) this.pending.delete(c);
    if (this.pending.size >= 500) this.pending.delete(this.pending.keys().next().value!); // plafond : la plus ancienne demande saute
    let code = '';
    do code = String(crypto.randomInt(1000, 10000));
    while (this.pending.has(code));
    this.pending.set(code, { key, name, who, until: now + 10 * 60_000 });
    return code;
  }

  /** « !lien <code> » écrit dans le chat par twitchKey : si ça correspond, renvoie la page à relier et son nouveau jeton. */
  confirm(code: string, twitchKey: string, now = Date.now()): { who: T; name: string; token: string } | null {
    const p = this.pending.get(code);
    if (!p || p.until < now || p.key !== twitchKey) return null; // mauvais compte : un autre viewer ne peut pas valider à ta place
    this.pending.delete(code);
    const token = crypto.randomBytes(24).toString('base64url');
    // Une seule page reliée par compte : la nouvelle liaison révoque les anciennes
    // (si quelqu'un t'a fait taper son code, refaire !lien depuis ta page te rend ton perso)
    for (const [h, k] of Object.entries(this.data.tokens)) if (k === p.key) delete this.data.tokens[h];
    this.data.tokens[hash(token)] = p.key;
    this.dirty = true;
    return { who: p.who, name: p.name, token };
  }

  /** La page est partie : ses demandes en cours sont annulées. */
  forget(who: T) {
    for (const [c, p] of this.pending) if (p.who === who) this.pending.delete(c);
  }

  save() {
    if (!this.dirty || !this.file) return;
    try {
      writeAtomic(this.file, JSON.stringify(this.data));
      this.dirty = false;
    } catch (e) {
      console.error('[links] not saved:', (e as Error).message);
    }
  }
}

function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
