// Connexion au chat Twitch en lecture seule (anonyme, aucun jeton nécessaire).
// Les messages en « ! » sont des commandes ; les autres s'affichent en bulle au-dessus du crawler.
import tmi from 'tmi.js';
import type { TwitchEvent } from './host.js';

export function connectTwitch(
  channel: string,
  onCommand: (user: string, text: string) => void,
  onModerated?: (user: string, why: string, seconds: number) => void,
  onEvent?: (ev: TwitchEvent) => void,
): () => void {
  const client = new tmi.Client({
    connection: { reconnect: true, secure: true },
    channels: [channel],
  });
  client.on('message', (_chan, tags, message, self) => {
    if (self) return;
    const text = message.trim();
    if (!text) return;
    // Pseudo affiché s'il est en lettres simples ; sinon le login (les pseudos japonais, coréens… deviendraient « ___ » et se confondraient)
    const dn = tags['display-name'] ?? '';
    const user = /^\w+$/.test(dn) ? dn : tags.username || 'anonyme';
    try {
      onCommand(user, text);
    } catch (e) {
      console.error('[twitch] unhandled message:', e);
    }
  });
  // Modération de la chaîne : un viewer banni ou mis en timeout n'apparaît plus dans le jeu (bulles, commandes)
  client.on('ban', (_chan, username) => onModerated?.(username, 'banned from chat', Infinity));
  client.on('timeout', (_chan, username, _reason, duration) => onModerated?.(username, `timeout ${duration} s`, Number(duration) || 600));
  // Abonnements, cadeaux, bits, raids : Victoria remercie (le pseudo et le nombre, jamais le message de l'abonné)
  const nameOf = (u: { 'display-name'?: string; username?: string } | undefined, fallback: string) => {
    const dn = u?.['display-name'] ?? '';
    return /^\w+$/.test(dn) ? dn : u?.username || fallback;
  };
  const fire = (ev: TwitchEvent) => {
    try {
      onEvent?.(ev);
    } catch (e) {
      console.error('[twitch] unhandled event:', e);
    }
  };
  client.on('subscription', (_c, username, _m, _msg, tags) => fire({ kind: 'sub', user: nameOf(tags, username), months: 1 }));
  client.on('resub', (_c, username, months, _msg, tags) => fire({ kind: 'sub', user: nameOf(tags, username), months: Number(tags?.['msg-param-cumulative-months']) || Number(months) || 1 }));
  client.on('submysterygift', (_c, username, count, _m, tags) => fire({ kind: 'gift', user: nameOf(tags, username), count: Number(count) || 1 }));
  client.on('subgift', (_c, username, _s, _r, _m, tags) => fire({ kind: 'gift', user: nameOf(tags, username), count: 1 }));
  client.on('cheer', (_c, tags) => fire({ kind: 'bits', user: nameOf(tags, 'someone'), bits: Number(tags?.bits) || 0 }));
  client.on('raided', (_c, username, viewers) => fire({ kind: 'raid', user: username, viewers: Number(viewers) || 0 }));
  client.on('connected', () => console.log(`[twitch] connected to #${channel} chat`));
  client.on('disconnected', (reason) => console.log(`[twitch] disconnected: ${reason}`));
  client.connect().catch((e) => console.error('[twitch] connexion impossible :', e));
  return () => void client.disconnect().catch(() => undefined);
}
