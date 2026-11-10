// Serveur du Donjon : sert la page joueur, gère les WebSockets et fait tourner les tours.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMsg, GameEvent, ServerMsg } from '../shared/types.js';
import { loadConfig } from './config.js';
import { Game, playerKey } from './game/engine.js';
import type { GameState } from './game/state.js';
import { connectTwitch } from './twitch.js';

const cfg = loadConfig();
const root = process.cwd();
const staticDir = path.join(root, 'dist', 'client');
const savePath = path.join(root, cfg.savePath);

// --------------------------------------------------------------- sauvegarde
function loadSave(): GameState | undefined {
  try {
    if (fs.existsSync(savePath)) {
      const s = JSON.parse(fs.readFileSync(savePath, 'utf8')) as GameState;
      console.log(`[sauvegarde] partie rechargée (tour ${s.turn}, ${Object.keys(s.players).length} joueurs)`);
      return s;
    }
  } catch (e) {
    console.error('[sauvegarde] fichier illisible, nouvelle partie :', e);
  }
  return undefined;
}
function save() {
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  const tmp = savePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(game.state));
  fs.renameSync(tmp, savePath);
}

const game = new Game(cfg, process.argv.includes('--nouvelle-partie') ? undefined : loadSave());
game.ensureFloor(1);

// ------------------------------------------------------------------- HTTP
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file = path.normalize(path.join(staticDir, decodeURIComponent(url.pathname)));
  if (!file.startsWith(staticDir)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('La page n\'est pas construite : lance « npm run build » avant « npm start ».');
      return;
    }
    file = path.join(staticDir, 'index.html');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// -------------------------------------------------------------- WebSocket
interface Client {
  ws: WebSocket;
  name: string | null; // pseudo du joueur
  spectator: boolean;
  floor: number | null; // étage regardé (spectateur)
}
const clients = new Set<Client>();
const wss = new WebSocketServer({ server, path: '/ws' });

let turnEndsAt = Date.now() + cfg.turnSeconds * 1000;

function send(c: Client, msg: ServerMsg) {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
}

function sendState(c: Client) {
  const now = Date.now();
  const base = { type: 'state' as const, turn: game.state.turn, turnEndsAt, turnSeconds: cfg.turnSeconds, serverNow: now, online: clients.size };
  if (c.spectator) {
    send(c, { ...base, me: null, floor: game.spectatorView(c.floor, now), merchant: null, spectator: true });
  } else if (c.name) {
    const v = game.viewFor(c.name, now);
    send(c, { ...base, ...v, spectator: false });
  }
}

function deliver(events: GameEvent[]) {
  for (const c of clients) {
    const key = c.spectator ? null : c.name ? playerKey(c.name) : null;
    if (!c.spectator && !c.name) continue;
    const mine = events.filter((e) => game.isRelevant(e, key));
    if (mine.length) send(c, { type: 'events', events: mine });
  }
}

/** Traite une commande, qu'elle vienne de la page ou du chat Twitch. */
function command(name: string, text: string, from?: Client) {
  const before = game.state.events.length ? game.state.events[game.state.events.length - 1].id : 0;
  const res = game.submit(name, text);
  const fresh = game.state.events.filter((e) => e.id > before);
  if (fresh.length) deliver(fresh);
  if (from) send(from, { type: 'feedback', ok: res.ok, text: res.text });
  // Les commandes affichées dans le faux chat, comme sur Twitch
  for (const c of clients) send(c, { type: 'chat', from: name, text });
  for (const c of clients) if (c.spectator || (c.name && playerKey(c.name) === playerKey(name))) sendState(c);
  return res;
}

wss.on('connection', (ws) => {
  const c: Client = { ws, name: null, spectator: false, floor: null };
  clients.add(c);
  ws.on('message', (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      if (msg.spectatorKey !== undefined) {
        if (msg.spectatorKey !== cfg.spectatorKey) return send(c, { type: 'feedback', ok: false, text: 'Clé spectateur incorrecte.' });
        c.spectator = true;
      } else {
        const name = String(msg.name ?? '').trim().slice(0, 24);
        if (!playerKey(name)) return send(c, { type: 'feedback', ok: false, text: 'Choisis un pseudo valide.' });
        c.name = name;
      }
      const key = c.spectator ? null : playerKey(c.name!);
      send(c, { type: 'events', events: game.state.events.filter((e) => game.isRelevant(e, key)).slice(-40) });
      sendState(c);
    } else if (msg.type === 'cmd' && c.name) {
      command(c.name, String(msg.text ?? '').slice(0, 200), c);
    } else if (msg.type === 'floor' && c.spectator) {
      c.floor = Number(msg.n);
      sendState(c);
    }
  });
  ws.on('close', () => clients.delete(c));
});

// ------------------------------------------------------------------ tours
function runTurn() {
  const events = game.tick(Date.now());
  turnEndsAt = Date.now() + cfg.turnSeconds * 1000;
  deliver(events);
  for (const c of clients) sendState(c);
  try {
    save();
  } catch (e) {
    console.error('[sauvegarde] échec :', e);
  }
}
setInterval(() => {
  if (Date.now() >= turnEndsAt) runTurn();
}, 250);

// Rafraîchit les chronos des pages toutes les 5 s (immunité, effondrement)
setInterval(() => {
  for (const c of clients) sendState(c);
}, 5000);

// ----------------------------------------------------------------- Twitch
if (cfg.twitchChannel) connectTwitch(cfg.twitchChannel, (user, text) => command(user, text));

server.listen(cfg.port, () => {
  console.log(`\n  Le Donjon tourne sur http://localhost:${cfg.port}`);
  console.log(`  Vue spectateur : http://localhost:${cfg.port}/?spectateur=${cfg.spectatorKey}`);
  console.log(`  Tour : ${cfg.turnSeconds} s · étage : ${cfg.floorMinutes} min · Twitch : ${cfg.twitchChannel || 'désactivé'}\n`);
});

process.on('SIGINT', () => {
  try {
    save();
    console.log('\n[sauvegarde] partie enregistrée. À bientôt !');
  } finally {
    process.exit(0);
  }
});
