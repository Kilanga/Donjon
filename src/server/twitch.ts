// Connexion au chat Twitch en lecture seule (anonyme, aucun jeton nécessaire).
// Les messages en « ! » sont des commandes ; les autres s'affichent en bulle au-dessus du crawler.
import tmi from 'tmi.js';

export function connectTwitch(channel: string, onCommand: (user: string, text: string) => void, onModerated?: (user: string, why: string, seconds: number) => void): () => void {
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
      console.error('[twitch] message non traité :', e);
    }
  });
  // Modération de la chaîne : un viewer banni ou mis en timeout n'apparaît plus dans le jeu (bulles, commandes)
  client.on('ban', (_chan, username) => onModerated?.(username, 'banni du chat', Infinity));
  client.on('timeout', (_chan, username, _reason, duration) => onModerated?.(username, `timeout ${duration} s`, Number(duration) || 600));
  client.on('connected', () => console.log(`[twitch] connecté au chat de #${channel}`));
  client.on('disconnected', (reason) => console.log(`[twitch] déconnecté : ${reason}`));
  client.connect().catch((e) => console.error('[twitch] connexion impossible :', e));
  return () => void client.disconnect().catch(() => undefined);
}
