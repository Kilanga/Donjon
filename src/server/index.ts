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
import { recapHtml } from './recap.js';
import { DungeonAI } from './ai.js';
import { Narrator } from './narrator.js';

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
  // Sauvegarde de secours tous les 10 tours (3 fichiers en rotation)
  if (game.state.turn % 10 === 0) fs.copyFileSync(savePath, savePath.replace(/\.json$/, `-secours-${(game.state.turn / 10) % 3}.json`));
}

// Clé de la régie : si elle n'est pas personnalisée, on en génère une aléatoire (gardée dans data/)
if (cfg.spectatorKey === 'regie' && !process.env.SPECTATOR_KEY) {
  const keyFile = path.join(root, 'data', 'cle-regie.txt');
  try {
    if (fs.existsSync(keyFile)) cfg.spectatorKey = fs.readFileSync(keyFile, 'utf8').trim();
    else {
      cfg.spectatorKey = Math.random().toString(36).slice(2, 10);
      fs.mkdirSync(path.dirname(keyFile), { recursive: true });
      fs.writeFileSync(keyFile, cfg.spectatorKey);
    }
  } catch {
    /* on garde la clé par défaut */
  }
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
  if (url.pathname === '/bilan') {
    if (url.searchParams.get('cle') !== cfg.spectatorKey) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('Clé de régie requise.');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(recapHtml(game, cfg.turnSeconds));
    return;
  }
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
  recent: number[]; // horodatages des derniers messages (anti-spam)
}
const clients = new Set<Client>();
const wss = new WebSocketServer({ server, path: '/ws' });

let turnEndsAt = Date.now() + cfg.turnSeconds * 1000;
let pausedAt: number | null = null; // pause de la régie

function send(c: Client, msg: ServerMsg) {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
}

function sendState(c: Client) {
  const now = Date.now();
  const key = c.name ? playerKey(c.name) : null;
  const base = {
    type: 'state' as const, turn: game.state.turn, turnEndsAt: pausedAt ? turnEndsAt + (now - pausedAt) : turnEndsAt,
    turnSeconds: cfg.turnSeconds, serverNow: now, online: clients.size, paused: pausedAt !== null, admin: c.spectator,
    leaderboard: game.leaderboard(), vote: game.voteView(c.spectator ? null : key), effects: game.effectsView(), obituary: game.obituary(),
  };
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

// IA du donjon (optionnelle) : la clé API ne vient que de la variable d'environnement
const ai = new DungeonAI(cfg.ai, process.env.ANTHROPIC_API_KEY ?? '');
const narrator = new Narrator(game, ai, (evs) => deliver(evs));

/** Message libre : apparaît dans le chat et en bulle au-dessus du crawler. */
function say(name: string, text: string) {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!clean) return;
  const p = game.player(name);
  for (const c of clients) send(c, { type: 'chat', from: name, text: clean, floor: p?.floor, roomId: p?.alive ? p.roomId : undefined });
}

/** Traite une commande, qu'elle vienne de la page ou du chat Twitch. */
function command(name: string, text: string, from?: Client) {
  const dis = text.match(/^!(dis|say|parler)\s+(.+)/i);
  if (dis) return say(name, dis[2]);
  if (!text.startsWith('!')) return say(name, text);
  const talk = text.match(/^!(parle|talk)(?:\s+(.*))?$/i);
  if (talk) {
    let r;
    try {
      r = narrator.talk(name, talk[2] ?? '');
    } catch (e) {
      console.error('[ia] !parle :', e);
      r = { ok: false, text: 'Le marchand fait semblant de ne pas t\'entendre.' };
    }
    if (from) send(from, { type: 'feedback', ok: r.ok, text: r.text });
    for (const c of clients) send(c, { type: 'chat', from: name, text, cmd: true });
    return r;
  }
  const before = game.state.nextId;
  let res;
  try {
    res = game.submit(name, text);
  } catch (e) {
    console.error('[commande] erreur sur', name, text, e);
    res = { ok: false, text: 'Oups, le donjon a eu un hoquet sur cette commande. Réessaie.' };
  }
  const fresh = game.state.events.filter((e) => e.id >= before);
  if (fresh.length) deliver(fresh);
  if (from) send(from, { type: 'feedback', ok: res.ok, text: res.text });
  // Les commandes affichées dans le faux chat, comme sur Twitch
  for (const c of clients) send(c, { type: 'chat', from: name, text, cmd: true });
  for (const c of clients) if (c.spectator || (c.name && playerKey(c.name) === playerKey(name))) sendState(c);
  return res;
}

wss.on('connection', (ws) => {
  const c: Client = { ws, name: null, spectator: false, floor: null, recent: [] };
  clients.add(c);
  ws.on('message', (data) => {
    try {
      onClientMessage(c, JSON.parse(String(data)) as ClientMsg);
    } catch (e) {
      console.error('[ws] message ignoré :', e);
    }
  });
  ws.on('close', () => clients.delete(c));
});

function onClientMessage(c: Client, msg: ClientMsg) {
  {
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
    } else if ((msg.type === 'cmd' || msg.type === 'say') && c.name) {
      const now = Date.now();
      c.recent = c.recent.filter((t) => now - t < 3000);
      if (c.recent.length >= 8) return send(c, { type: 'feedback', ok: false, text: 'Doucement ! Trop de messages d\'un coup.' }); // anti-spam
      c.recent.push(now);
      const text = String(msg.text ?? '').slice(0, 200);
      if (msg.type === 'say') say(c.name, text);
      else command(c.name, text, c);
    } else if (msg.type === 'floor' && c.spectator) {
      c.floor = Number(msg.n);
      sendState(c);
    } else if (msg.type === 'admin' && c.spectator) {
      admin(c, msg.action, msg.arg);
    }
  }
}

// ------------------------------------------------------------------ régie
function admin(c: Client, action: string, arg?: string | number) {
  const now = Date.now();
  let msg = '';
  switch (action) {
    case 'pause':
      if (pausedAt === null) pausedAt = now;
      msg = 'Partie en pause.';
            break;
    case 'resume':
      if (pausedAt !== null) {
        const delta = now - pausedAt;
        turnEndsAt += delta;
        for (const f of Object.values(game.state.floors)) if (f.collapseAt !== null) f.collapseAt += delta;
        for (const p of Object.values(game.state.players)) if (p.immuneUntil > pausedAt) p.immuneUntil += delta;
        pausedAt = null;
      }
      msg = 'La partie reprend.';
      break;
    case 'next':
      turnEndsAt = now;
      msg = 'Tour suivant déclenché.';
      break;
    case 'vote':
      if (!game.state.vote) game.startVote();
      msg = 'Vote lancé.';
      break;
    case 'event':
      game.applyProduction(String(arg), 'décision de la régie');
      msg = 'Événement déclenché.';
      break;
    case 'collapse':
      msg = game.adminCollapse(Number(arg), now) ? `L'étage ${arg} s'effondrera au prochain tour.` : 'Étage introuvable.';
      break;
    case 'turnSeconds': {
      const v = Math.max(3, Math.min(120, Number(arg) || cfg.turnSeconds));
      cfg.turnSeconds = v;
      turnEndsAt = Math.min(turnEndsAt, now + v * 1000);
      msg = `Durée du tour : ${v} s.`;
      break;
    }
    case 'healAll':
      game.adminHealAll();
      msg = 'Tout le monde est soigné.';
      break;
    case 'kick':
      msg = game.adminKick(String(arg)) ? `${arg} expulsé.` : 'Joueur introuvable.';
      break;
    case 'reset':
      game.reset();
      pausedAt = null;
      turnEndsAt = now + cfg.turnSeconds * 1000;
      for (const cl of clients) send(cl, { type: 'events', events: game.state.events.slice(-1) });
      msg = 'Nouvelle partie !';
      break;
    default:
      return;
  }
  console.log(`[régie] ${msg}`);
  deliver(game.flush());
  send(c, { type: 'feedback', ok: true, text: `Régie : ${msg}` });
  for (const cl of clients) sendState(cl);
  try {
    save();
  } catch {
    /* sauvegarde au prochain tour */
  }
}

// ------------------------------------------------------------------ tours
function runTurn() {
  turnEndsAt = Date.now() + cfg.turnSeconds * 1000;
  let events: GameEvent[] = [];
  try {
    events = game.tick(Date.now());
  } catch (e) {
    console.error(`[tour ${game.state.turn}] erreur, la partie continue :`, e);
  }
  deliver(events);
  narrator.onTurn(events);
  for (const c of clients) sendState(c);
  try {
    save();
  } catch (e) {
    console.error('[sauvegarde] échec :', e);
  }
}
setInterval(() => {
  if (pausedAt === null && Date.now() >= turnEndsAt) runTurn();
}, 250);

// Rafraîchit les chronos des pages toutes les 5 s (immunité, effondrement)
setInterval(() => {
  for (const c of clients) sendState(c);
}, 5000);

// ----------------------------------------------------------------- Twitch
if (cfg.twitchChannel) connectTwitch(cfg.twitchChannel, (user, text) => command(user, text));


const onListenError = (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Le port ${cfg.port} est déjà utilisé : le Donjon tourne sans doute déjà dans une autre fenêtre.`);
    console.error('  Ferme-la (ou change "port" dans config.json), puis relance.\n');
  } else console.error('[serveur] impossible de démarrer :', e);
  process.exit(1);
};
server.on('error', onListenError);
wss.on('error', onListenError); // ws relaie les erreurs du serveur HTTP

server.listen(cfg.port, () => {
  console.log(`\n  Le Donjon tourne sur http://localhost:${cfg.port}`);
  console.log(`  Régie (vue spectateur + maître du jeu, NE PAS PARTAGER) : http://localhost:${cfg.port}/?spectateur=${cfg.spectatorKey}`);
  console.log(`  Tour : ${cfg.turnSeconds} s · étage : ${cfg.floorMinutes} min · Twitch : ${cfg.twitchChannel || 'désactivé'}`);
  console.log(`  IA du donjon : ${ai.describe()}\n`);
});

process.on('uncaughtException', (e) => console.error('[serveur] erreur inattendue (la partie continue) :', e));
process.on('unhandledRejection', (e) => console.error('[serveur] promesse rejetée :', e));

process.on('SIGINT', () => {
  try {
    save();
    console.log('\n[sauvegarde] partie enregistrée. À bientôt !');
  } finally {
    process.exit(0);
  }
});
