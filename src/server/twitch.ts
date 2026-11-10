// Connexion au chat Twitch en lecture seule (anonyme, aucun jeton nécessaire).
import tmi from 'tmi.js';

export function connectTwitch(channel: string, onCommand: (user: string, text: string) => void): () => void {
  const client = new tmi.Client({
    connection: { reconnect: true, secure: true },
    channels: [channel],
  });
  client.on('message', (_chan, tags, message, self) => {
    if (self) return;
    const text = message.trim();
    if (!text.startsWith('!')) return;
    const user = tags['display-name'] || tags.username || 'anonyme';
    onCommand(user, text);
  });
  client.on('connected', () => console.log(`[twitch] connecté au chat de #${channel}`));
  client.on('disconnected', (reason) => console.log(`[twitch] déconnecté : ${reason}`));
  client.connect().catch((e) => console.error('[twitch] connexion impossible :', e));
  return () => void client.disconnect().catch(() => undefined);
}
