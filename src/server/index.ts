// Serveur du Donjon : sert la page joueur, gère les WebSockets et fait tourner les tours.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import util from 'node:util';
import { WebSocket, WebSocketServer } from 'ws';
import { spawn, type ChildProcess } from 'node:child_process';
import type { ClientMsg, GameEvent, Legend, ServerMsg } from '../shared/types.js';
import { loadConfig } from './config.js';
import { Game, playerKey } from './game/engine.js';
import type { GameState } from './game/state.js';
import { connectTwitch } from './twitch.js';
import { recapHtml } from './recap.js';
import { DungeonAI } from './ai.js';
import { Narrator } from './narrator.js';
import { BotManager } from './bots.js';
import { maskPlayerText, nameAllowed } from './moderation.js';
import { readJsonSafe, writeAtomic } from './fsutil.js';
import { Links } from './links.js';
import { NpcSociety } from './pnj.js';
import { Journal, errInfo } from './journal.js';
import { buildReport } from './report.js';

const cfg = loadConfig();
const root = process.cwd();
const staticDir = path.join(root, 'dist', 'client');
const savePath = path.join(root, cfg.savePath);

// --------------------------------------------------------------- sauvegarde
function loadSave(): GameState | undefined {
  // La sauvegarde principale, sinon la plus récente des sauvegardes de secours
  const backups = [0, 1, 2].map((i) => savePath.replace(/\.json$/, `-secours-${i}.json`)).filter((f) => fs.existsSync(f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const f of [savePath, ...backups]) {
    const s = readJsonSafe<GameState>(f, 'sauvegarde');
    if (s && s.players && s.floors) {
      console.log(`[save] game reloaded from ${path.basename(f)} (turn ${s.turn}, ${Object.keys(s.players).length} players)`);
      return s;
    }
  }
  return undefined;
}
function save() {
  writeAtomic(savePath, JSON.stringify(game.state));
  // Sauvegarde de secours tous les 10 tours (3 fichiers en rotation)
  if (game.state.turn % 10 === 0) fs.copyFileSync(savePath, savePath.replace(/\.json$/, `-secours-${(game.state.turn / 10) % 3}.json`));
}

// Clé de la régie : si elle n'est pas personnalisée, on en génère une aléatoire (gardée dans data/)
if (cfg.spectatorKey === 'regie' && !process.env.SPECTATOR_KEY) {
  const keyFile = path.join(root, 'data', 'cle-regie.txt');
  try {
    const stored = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : '';
    if (stored.length >= 6) cfg.spectatorKey = stored;
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

// ---------------------------------------------------------------- journal
// Tout ce qui se passe est noté dans logs/ (LOGS=0 pour désactiver) ; rapport via la régie ou « npm run rapport ».
const logsDir = path.join(root, 'logs');
const journal = new Journal(logsDir, process.env.LOGS !== '0');
journal.turn = () => game.state.turn;
journal.secrets = [cfg.spectatorKey, process.env.ANTHROPIC_API_KEY ?? ''];
// Les messages de la console partent aussi dans le journal
const origLog = console.log.bind(console);
const origError = console.error.bind(console);
console.log = (...a: unknown[]) => {
  origLog(...a);
  journal.write('log', { text: util.format(...a).slice(0, 2000) });
};
console.error = (...a: unknown[]) => {
  origError(...a);
  const err = a.find((x) => x instanceof Error);
  journal.write('error', {
    source: 'serveur',
    message: util.format(...a.filter((x) => !(x instanceof Error))).slice(0, 500) + (err ? ' ' + (err as Error).message : ''),
    stack: err ? errInfo(err).stack : undefined,
  });
};
function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}
let pkgVersion = '';
try {
  pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
} catch {
  /* sans importance */
}
journal.write('start', {
  version: pkgVersion, commit: gitCommit(), node: process.version, platform: `${process.platform} ${process.arch}`,
  config: { ...cfg, spectatorKey: undefined }, players: Object.keys(game.state.players).length,
});

// ------------------------------------------------------------------- HTTP
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};
/** Adresse du visiteur : derrière le tunnel (connexion locale de cloudflared), la vraie IP est dans CF-Connecting-IP. */
const isLoopback = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
function ipOf(req: http.IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? '';
  const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const cf = req.headers['cf-connecting-ip'];
  return local && typeof cf === 'string' && cf ? cf.slice(0, 64) : remote;
}
/** Essais de clé de régie ratés par adresse : 5 échecs = 15 min de blocage (la clé ne se devine pas par essais). */
const keyFails = new Map<string, { n: number; until: number }>();
function keyBlocked(ip: string): boolean {
  const f = keyFails.get(ip);
  return !!f && f.n >= 5 && f.until > Date.now();
}
function keyCheck(ip: string, key: string | null | undefined): boolean {
  if (keyBlocked(ip)) return false;
  if (key === cfg.spectatorKey) return true;
  const f = keyFails.get(ip) ?? { n: 0, until: 0 };
  if (f.until < Date.now()) f.n = 0;
  f.n++;
  f.until = Date.now() + 15 * 60_000;
  keyFails.set(ip, f);
  if (f.n === 5) console.log(`[security] ${ip}: 5 wrong control-room keys, blocked for 15 min.`);
  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // En-têtes de sécurité : pas d'affichage dans un cadre d'un autre site, pas de clé dans le Referer, pas de devinette de type
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (url.pathname.startsWith('/journaux')) return journaux(url, res, ipOf(req));
  if (url.pathname === '/bilan') {
    if (!keyCheck(ipOf(req), url.searchParams.get('cle'))) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('Control-room key required.');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(recapHtml(game, cfg.turnSeconds, readLegends()));
    return;
  }
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = path.normalize(path.join(staticDir, rel));
  if (file !== staticDir && !file.startsWith(staticDir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('The page is not built: run "npm run build" before "npm start".');
      return;
    }
    file = path.join(staticDir, 'index.html');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  const rs = fs.createReadStream(file);
  rs.on('error', () => res.destroy());
  rs.pipe(res);
});

// Journaux de session (régie) : page de téléchargement, rapport Markdown, journal brut
function journaux(url: URL, res: http.ServerResponse, ip: string) {
  const key = url.searchParams.get('cle');
  if (!keyCheck(ip, key) || key === null) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('Control-room key required.');
    return;
  }
  if (url.pathname === '/journaux/rapport.md') journal.write('snapshot', { leaderboard: game.leaderboard() });
  journal.flush();
  const q = `cle=${encodeURIComponent(key)}`;
  const day = new Date().toISOString().slice(0, 10);
  const pick = () => {
    const nom = url.searchParams.get('nom');
    if (nom && Journal.list(logsDir).includes(nom)) return [path.join(logsDir, nom)];
    return Journal.lastEvening(logsDir);
  };
  if (url.pathname === '/journaux/rapport.md') {
    const files = pick();
    res.writeHead(200, {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `${url.searchParams.has('voir') ? 'inline' : 'attachment'}; filename="donjon-rapport-${day}.md"`,
    });
    res.end(buildReport(Journal.read(files), files));
    return;
  }
  if (url.pathname === '/journaux/journal.jsonl') {
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'content-disposition': `attachment; filename="donjon-journal-${day}.jsonl"` });
    const files = pick();
    const next = () => {
      const f = files.shift();
      if (!f) return res.end();
      const rs = fs.createReadStream(f);
      rs.on('error', next);
      rs.on('end', next);
      rs.pipe(res, { end: false });
    };
    next();
    return;
  }
  const esc = (x: string) => x.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  const files = Journal.list(logsDir).reverse();
  const evening = new Set(Journal.lastEvening(logsDir).map((f) => path.basename(f)));
  const rows = files
    .map((f) => {
      const size = fs.statSync(path.join(logsDir, f)).size;
      const n = encodeURIComponent(f);
      return `<tr><td>${evening.has(f) ? '★ ' : ''}${esc(f)}</td><td>${(size / 1024).toFixed(0)} KB</td><td><a href="/journaux/rapport.md?${q}&nom=${n}&voir">report</a> · <a href="/journaux/journal.jsonl?${q}&nom=${n}">raw</a></td></tr>`;
    })
    .join('');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Logs — The Dungeon</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#e2ded3;color:#231d19;max-width:760px;margin:30px auto;padding:0 16px}a{color:#a3161b}
h1{font-family:Georgia,serif}
.big{display:inline-block;margin:8px 8px 8px 0;padding:10px 16px;background:#f4f2ec;color:#231d19;border:1px solid #231d19;border-radius:3px;text-decoration:none;font-weight:600}
table{border-collapse:collapse;width:100%;margin-top:20px;background:#f4f2ec}td{padding:6px 8px;border-bottom:1px solid #d6d0c3;font-size:14px}p{color:#4d453c}</style>
<h1>Session logs</h1>
<p>At the end of the evening, download these two files and drop them into the conversation with Claude.
They cover the last evening (★: ${evening.size} file(s), one per server start).</p>
<a class="big" href="/journaux/rapport.md?${q}">Download the report (Markdown)</a>
<a class="big" href="/journaux/journal.jsonl?${q}">Download the full log (.jsonl)</a>
<a class="big" href="/journaux/rapport.md?${q}&voir">Read the report</a>
<table>${rows || '<tr><td>No logs yet.</td></tr>'}</table>
<p>The files are also in the game's <code>logs/</code> folder. They contain chat names and messages, but never the control-room key.</p>`);
}

// -------------------------------------------------------------- WebSocket
interface Client {
  ip: string; // adresse du visiteur (vraie IP derrière le tunnel)
  lastPos?: number; // dernier déplacement libre relayé (limite de débit)
  ws: WebSocket;
  name: string | null; // pseudo du joueur
  spectator: boolean;
  floor: number | null; // étage regardé (spectateur)
  standby?: number | null; // second étage gardé chargé (stream)
  recent: number[]; // horodatages des derniers messages (anti-spam)
  id: number; // numéro de connexion (journal)
  ua: string;
  mobile: boolean;
  since: number;
  errors: number; // erreurs navigateur déjà notées (plafonnées)
}
let nextClientId = 1;
/** Dernières commandes de chaque joueur (contexte des !bug). */
const lastCmds = new Map<string, string[]>();
const clients = new Set<Client>();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

let turnEndsAt = Date.now() + cfg.turnSeconds * 1000;
let pausedAt: number | null = null; // pause de la régie

function send(c: Client, msg: ServerMsg) {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
}

/** Durée d'un « tour du monde » : un tour d'étage, ou la moitié avec les tours décalés. */
const phaseMs = () => (cfg.turnSeconds * 1000) / game.phases;
/** Fin du prochain tour de cet étage (avec les tours décalés, un étage sur deux joue au tour du monde suivant). */
function floorTurnEnds(floorN: number | undefined, now: number): number {
  const base = pausedAt ? turnEndsAt + (now - pausedAt) : turnEndsAt;
  if (floorN === undefined || game.plays(floorN, game.state.turn + 1)) return base;
  return base + phaseMs();
}

function sendState(c: Client) {
  const now = Date.now();
  const key = c.name ? playerKey(c.name) : null;
  const shownFloor = c.spectator ? (c.floor ?? game.spectatorView(c.floor, now)?.n) : c.name ? game.player(c.name)?.floor : undefined;
  const base = {
    type: 'state' as const, turn: Math.ceil(game.state.turn / game.phases), turnEndsAt: floorTurnEnds(shownFloor ?? undefined, now),
    turnSeconds: cfg.turnSeconds, serverNow: now, online: clients.size, paused: pausedAt !== null, admin: c.spectator,
    leaderboard: game.leaderboard(), vote: game.voteView(c.spectator ? null : key), effects: game.effectsView(), obituary: game.obituary(),
    ...game.socialView(c.spectator ? null : key, now),
    seasonOver: game.state.seasonOver,
    lobbyInSec: game.state.lobbyUntil !== null && game.state.seasonStart === null ? Math.max(0, Math.ceil((game.state.lobbyUntil - now) / 1000)) : null,
    ...(publicUrl ? { publicUrl } : {}),
    ...(c.spectator ? { floors: game.floorsSummary(now), champions: game.state.champions } : {}),
  };
  if (c.spectator) {
    const shown = game.spectatorView(c.floor, now);
    const standby = c.standby != null && c.standby !== shown?.n ? game.liveFloorView(c.standby, now) : null;
    send(c, { ...base, me: null, floor: shown, ...(standby ? { standby, standbyTurnEndsAt: floorTurnEnds(standby.n, now) } : {}), merchant: null, spectator: true });
  } else if (c.name) {
    const v = game.viewFor(c.name, now);
    send(c, { ...base, ...v, spectator: false });
  }
}

// Légendes : tous ceux qui sont sortis par le dernier escalier, gardés d'une partie à l'autre (data/legendes.json)
const legendsFile = path.join(root, 'data', 'legendes.json');
function readLegends(): Legend[] {
  const l = readJsonSafe<Legend[]>(legendsFile, 'legends');
  return Array.isArray(l) ? l : [];
}
const legendsSeen = new Set<number>();
function recordLegends(events: GameEvent[]) {
  const fresh = events.filter((e) => e.victory && !legendsSeen.has(e.id));
  if (!fresh.length) return;
  const all = readLegends();
  for (const e of fresh) {
    legendsSeen.add(e.id);
    all.push(e.victory!);
    journal.write('admin', { action: 'victoire', arg: e.victory!.name, msg: e.text });
  }
  try {
    writeAtomic(legendsFile, JSON.stringify(all, null, 1));
  } catch (err) {
    console.error('[legends] not saved:', err);
  }
}

function deliver(events: GameEvent[]) {
  recordLegends(events);
  try {
    npcs.observe(events); // la mémoire des PNJ
  } catch (e) {
    console.error('[npc] memory:', e);
  }
  for (const e of events)
    journal.write('event', { id: e.id, kind: e.kind, scope: e.scope, floor: e.floor, roomId: e.roomId, to: e.to, drama: e.drama, fx: e.fx, narrator: e.narrator, text: e.text });
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

/** Bots de chat connus : on ignore leurs messages (le rappel de Cloudbot s'affichait en bulle). */
const CHAT_BOTS = new Set(['streamlabs', 'nightbot', 'streamelements', 'moobot', 'fossabot', 'wizebot', 'sery_bot', 'soundalerts', 'commanderroot', 'kilakbot']);

/** Pseudos vus dans le chat Twitch (la page web ne les prend qu'avec « !lien <code> ») et viewers rendus muets par la modération Twitch. */
const links = new Links<Client>(path.join(root, 'data', 'liens.json'), cfg.twitchChannel ? [playerKey(cfg.twitchChannel)] : []);
setInterval(() => links.save(), 10_000).unref();
const muted = new Map<string, number>(); // pseudo -> fin du silence (ms)
const namesByIp = new Map<string, Set<string>>(); // pseudos pris sur la page web, par adresse
const isMuted = (name: string) => (muted.get(playerKey(name)) ?? 0) > Date.now();

/** Message libre : apparaît dans le chat et en bulle au-dessus du crawler. */
function say(name: string, text: string) {
  if (isMuted(name)) return;
  const clean = maskPlayerText(text.replace(/\s+/g, ' ').trim().slice(0, 140));
  if (!clean) return;
  journal.write('say', { name, text: clean });
  const p = game.player(name);
  for (const c of clients) send(c, { type: 'chat', from: name, text: clean, floor: p?.floor, roomId: p?.alive ? p.roomId : undefined });
  // Un joueur interpelle un PNJ de sa salle par son nom : le PNJ répond
  if (p && !p.bot && npcs) {
    const pnj = npcs.addressedBy(p, clean);
    if (pnj) npcs.speak(pnj, p, clean);
  }
}

/** Traite une commande, qu'elle vienne de la page ou du chat Twitch. */
function command(name: string, text: string, from?: Client) {
  const src = from ? 'web' : 'twitch';
  if (isMuted(name)) return { ok: false, text: '' };
  game.seen(name); // présent dans le chat : points de faveur à chaque effondrement
  if (/^!(donjon|dungeon|jouer|play|lien|link)\b/i.test(text.trim())) return { ok: true, text: '' }; // commandes de Cloudbot (ou !lien hors Twitch) : pas pour le jeu
  if (game.player(name)?.bot) {
    // Un vrai joueur prend le pseudo d'un PNJ : le PNJ s'en va
    game.removeBot(name);
    deliver(game.flush());
  }
  bots.noteHuman(name);
  const fb = text.match(/^!(bug|avis|feedback)\b\s*(.*)$/i);
  if (fb) return feedback(name, fb[1].toLowerCase() === 'bug' ? 'bug' : 'avis', fb[2], src, from);
  const k = playerKey(name);
  if (text.startsWith('!')) lastCmds.set(k, [...(lastCmds.get(k) ?? []), text.slice(0, 80)].slice(-5));
  const dis = text.match(/^!(dis|say|parler)\s+(.+)/i);
  if (dis) return say(name, dis[2]);
  if (!text.startsWith('!')) return say(name, text);
  const talk = text.match(/^!(parle|talk)(?:\s+(.*))?$/i);
  if (talk) {
    let r;
    const me = game.player(name);
    const here = me && me.alive ? Object.values(game.state.players).filter((o) => o.bot && o.alive && o.floor === me.floor && o.roomId === me.roomId) : [];
    const pnj = me ? (npcs.addressedBy(me, talk[2] ?? '') ?? (game.room(me).type !== 'safe' && here.length === 1 ? here[0] : null)) : null;
    if (me && pnj) {
      npcs.speak(pnj, me, talk[2] ?? 'Hi!');
      if (from) send(from, { type: 'feedback', ok: true, text: `You speak to ${pnj.name}.` });
      for (const c of clients) send(c, { type: 'chat', from: name, text: maskPlayerText(text), cmd: true, ok: true, reply: `talks to ${pnj.name}`, src });
      return { ok: true, text: '' };
    }
    try {
      r = narrator.talk(name, talk[2] ?? '');
    } catch (e) {
      console.error('[ai] !talk:', e);
      r = { ok: false, text: 'The merchant pretends not to hear you.' };
    }
    journal.write('cmd', { name, text, src, ok: r.ok, reply: r.text, ms: 0 });
    if (from) send(from, { type: 'feedback', ok: r.ok, text: r.text });
    for (const c of clients) send(c, { type: 'chat', from: name, text: maskPlayerText(text), cmd: true, ok: r.ok, reply: r.text.slice(0, 90), src });
    return r;
  }
  const before = game.state.nextId;
  let res;
  const t0 = performance.now();
  try {
    res = game.submit(name, text);
  } catch (e) {
    console.error('[command] error on', name, text, e);
    res = { ok: false, text: 'Oops, the dungeon hiccupped on that command. Try again.' };
  }
  journal.write('cmd', { name, text, src, ok: res.ok, reply: res.text, ms: Math.round(performance.now() - t0) });
  const fresh = game.state.events.filter((e) => e.id >= before);
  if (fresh.length) deliver(fresh);
  if (from) send(from, { type: 'feedback', ok: res.ok, text: res.text });
  // Les commandes affichées dans le faux chat, comme sur Twitch (avec le verdict pour le bandeau du stream)
  for (const c of clients) send(c, { type: 'chat', from: name, text: maskPlayerText(text), cmd: true, ok: res.ok, reply: maskPlayerText(res.text.split('\n')[0].slice(0, 90)), src });
  for (const c of clients) if (c.spectator || (c.name && playerKey(c.name) === playerKey(name))) sendState(c);
  return res;
}

/** !bug / !avis : noté dans le journal avec le contexte du joueur, et signalé à la régie. */
function feedback(name: string, kind: 'bug' | 'avis', text: string, src: string, from?: Client) {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!clean) {
    if (from) send(from, { type: 'feedback', ok: false, text: kind === 'bug' ? 'Describe the problem after the command, e.g. !bug I can\'t pick up the sword' : 'Write your feedback after the command, e.g. !feedback turns are too long' });
    return { ok: false, text: '' };
  }
  const p = game.player(name);
  const k = playerKey(name);
  const ctx = {
    ...(p ? { cls: p.cls, level: p.level, floor: p.floor, roomId: p.roomId, hp: p.hp, maxHp: p.maxHp, alive: p.alive, gold: p.gold, items: p.items.map((i) => i.name) } : {}),
    device: from ? (from.mobile ? 'phone' : 'computer') : 'twitch',
    commands: lastCmds.get(k) ?? [],
    recent: game.state.events.filter((e) => game.isRelevant(e, k)).slice(-5).map((e) => e.text),
  };
  journal.write(kind, { name, text: clean, src, ua: from?.ua, ctx });
  const reply = kind === 'bug' ? 'Thanks! Bug logged with your current situation, we\'ll look at it after the session.' : 'Thanks for the feedback, noted!';
  if (from) send(from, { type: 'feedback', ok: true, text: reply });
  for (const c of clients) if (c.spectator) send(c, { type: 'feedback', ok: true, text: `${kind === 'bug' ? '🐞 Bug' : '💬 Feedback'} from ${name}: ${clean}` });
  return { ok: true, text: reply };
}

wss.on('connection', (ws, req) => {
  const ip = ipOf(req);
  const fromIp = [...clients].filter((o) => o.ip === ip).length;
  if (clients.size >= 400 || (fromIp >= 12 && !isLoopback(ip))) {
    ws.close(1013, 'too many connections');
    return;
  }
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 200);
  const c: Client = { ip, ws, name: null, spectator: false, floor: null, recent: [], id: nextClientId++, ua, mobile: /Mobi|Android|iPhone|iPad/i.test(ua), since: Date.now(), errors: 0 };
  clients.add(c);
  let budget = 40; // messages permis (tous types) : +20 par seconde, au-delà on ignore
  let lastRefill = Date.now();
  let bad = 0;
  let alive = true;
  ws.on('pong', () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) return ws.terminate(); // connexion morte (téléphone en veille…) : on la libère
    alive = false;
    ws.ping();
  }, 30_000);
  ws.on('message', (data) => {
    const now = Date.now();
    budget = Math.min(40, budget + ((now - lastRefill) / 1000) * 20);
    lastRefill = now;
    if (budget < 1) return;
    budget--;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data)) as ClientMsg;
      if (!msg || typeof msg !== 'object') throw new Error('not an object');
    } catch (e) {
      if (++bad <= 3) console.error('[ws] unreadable message ignored:', (e as Error).message);
      if (bad >= 20) ws.close(1008, 'messages invalides');
      return;
    }
    try {
      onClientMessage(c, msg);
    } catch (e) {
      console.error('[ws] message ignored:', e);
    }
  });
  ws.on('close', () => {
    clearInterval(ping);
    links.forget(c);
  });
  ws.on('error', (e) => { if (++bad <= 3) console.error('[ws] connection closed:', e.message); }); // message trop gros, etc.
  ws.on('close', () => {
    clients.delete(c);
    if (c.name || c.spectator) journal.write('disconnect', { cid: c.id, name: c.name, spectator: c.spectator, secs: Math.round((Date.now() - c.since) / 1000) });
  });
});

/** Une page vient de s'identifier (ou d'être reliée à son compte Twitch) : on lui envoie le récent et son état. */
function welcome(c: Client) {
  c.since = Date.now();
  journal.write('connect', { cid: c.id, name: c.name, spectator: c.spectator, mobile: c.mobile, ua: c.ua, known: c.name ? !!game.player(c.name) : undefined });
  const key = c.spectator ? null : playerKey(c.name!);
  send(c, { type: 'events', events: game.state.events.filter((e) => game.isRelevant(e, key)).slice(-40) });
  sendState(c);
}

function onClientMessage(c: Client, msg: ClientMsg) {
  {
    if (msg.type === 'hello') {
      if (msg.spectatorKey !== undefined) {
        if (!keyCheck(c.ip, String(msg.spectatorKey))) return send(c, { type: 'feedback', ok: false, text: keyBlocked(c.ip) ? 'Too many attempts. Try again later.' : 'Wrong spectator key.' });
        c.spectator = true;
      } else {
        const name = String(msg.name ?? '').replace(/[<>&"'`\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24); // pas de HTML ni de caractères de contrôle dans un pseudo
        if (!playerKey(name)) return send(c, { type: 'feedback', ok: false, text: 'Pick a valid name.' });
        if (!nameAllowed(name)) return send(c, { type: 'feedback', ok: false, text: 'That name won\'t make it on air. Pick another one.' });
        const key = playerKey(name);
        if (links.needsLink(key) && !links.tokenOpens(typeof msg.token === 'string' ? msg.token : undefined, key)) {
          // Pseudo d'un compte Twitch : on demande la preuve (le message « !lien <code> » doit venir de ce compte)
          const code = links.request(key, name, c);
          journal.write('admin', { action: 'link requested', arg: name });
          return send(c, { type: 'link', name, code });
        }
        const mine = namesByIp.get(c.ip) ?? new Set<string>();
        if (!mine.has(key) && mine.size >= 6 && !isLoopback(c.ip)) return send(c, { type: 'feedback', ok: false, text: 'Too many different names from this connection.' });
        mine.add(key);
        namesByIp.set(c.ip, mine);
        c.name = name;
        if (game.player(name)?.bot) {
          game.removeBot(name);
          deliver(game.flush());
        }
      }
      welcome(c);
    } else if ((msg.type === 'cmd' || msg.type === 'say') && c.name) {
      const now = Date.now();
      c.recent = c.recent.filter((t) => now - t < 3000);
      if (c.recent.length >= 8) {
        journal.write('spam', { name: c.name });
        return send(c, { type: 'feedback', ok: false, text: 'Easy! Too many messages at once.' }); // anti-spam
      }
      c.recent.push(now);
      const text = String(msg.text ?? '').slice(0, 200);
      if (msg.type === 'say') say(c.name, text);
      else command(c.name, text, c);
    } else if (msg.type === 'floor' && c.spectator) {
      c.floor = Number(msg.n);
      c.standby = msg.standby !== undefined && Number.isFinite(Number(msg.standby)) ? Number(msg.standby) : null;
      sendState(c);
    } else if (msg.type === 'admin' && c.spectator) {
      admin(c, msg.action, msg.arg);
    } else if (msg.type === 'clientError') {
      if (++c.errors > 30) return; // une page qui boucle sur une erreur ne remplit pas le disque
      journal.write('clientError', {
        cid: c.id, name: c.name, spectator: c.spectator, ua: c.ua, page: String(msg.page ?? '').slice(0, 100),
        message: String(msg.message ?? '').slice(0, 500), stack: String(msg.stack ?? '').slice(0, 1500), where: String(msg.where ?? '').slice(0, 200),
      });
    } else if (msg.type === 'pos' && c.name) {
      const now = Date.now();
      if (now - (c.lastPos ?? 0) < 100) return; // 10 positions/s maximum
      c.lastPos = now;
      // Déplacement libre dans la salle : purement visuel, relayé aux autres pages de l'étage
      const p = game.player(c.name);
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (!p || !p.alive || !Number.isFinite(x) || !Number.isFinite(y)) return;
      broadcastPos(p.name, x, y, c);
    } else if (msg.type === 'clientPerf') {
      journal.write('clientPerf', { cid: c.id, name: c.name, spectator: c.spectator, page: String(msg.page ?? '').slice(0, 100), fps: Number(msg.fps) || 0, w: Number(msg.w) || 0, h: Number(msg.h) || 0, mobile: c.mobile });
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
      msg = 'Game paused.';
            break;
    case 'resume':
      if (pausedAt !== null) {
        const delta = now - pausedAt;
        turnEndsAt += delta;
        for (const f of Object.values(game.state.floors)) if (f.collapseAt !== null) f.collapseAt += delta;
        if (game.state.seasonStart !== null) game.state.seasonStart += delta; // l'horloge de saison suit la pause
        for (const p of Object.values(game.state.players)) if (p.immuneUntil > pausedAt) p.immuneUntil += delta;
        pausedAt = null;
      }
      msg = 'The game resumes.';
      break;
    case 'next':
      turnEndsAt = now;
      msg = 'Next turn triggered.';
      break;
    case 'vote':
      if (!game.state.vote) game.startVote();
      msg = 'Vote started.';
      break;
    case 'event':
      game.applyProduction(String(arg), 'control-room decision');
      msg = 'Event triggered.';
      break;
    case 'collapse':
      msg = game.adminCollapse(Number(arg), now) ? `Floor ${arg} will collapse next turn.` : 'Floor not found.';
      break;
    case 'turnSeconds': {
      const v = Math.max(3, Math.min(120, Number(arg) || cfg.turnSeconds));
      cfg.turnSeconds = v;
      turnEndsAt = Math.min(turnEndsAt, now + phaseMs());
      msg = `Turn length: ${v} s.`;
      break;
    }
    case 'healAll':
      game.adminHealAll();
      msg = 'Everyone is healed.';
      break;
    case 'ai': {
      const on = ai.provider === 'off';
      ai.setProvider(on ? (cfg.ai.provider !== 'off' ? cfg.ai.provider : 'ollama') : 'off');
      if (on && cfg.ai.provider === 'off') cfg.ai.provider = 'ollama';
      msg = on ? `Dungeon AI on: ${ai.describe()}.` : 'Dungeon AI off (written lines).';
      if (on) void ai.check().then((m) => send(c, { type: 'feedback', ok: !m.includes('not answering') && !m.includes('not installed'), text: `AI: ${m}` }));
      break;
    }
    case 'bots': {
      bots.target = Math.max(0, Math.min(30, Math.round(Number(arg)) || 0));
      cfg.bots = bots.target;
      msg = `Extra NPCs: ${bots.target} (they arrive or leave one per turn, and stay even when real players arrive). Latecomers: ${bots.closers}.`;
      break;
    }
    case 'kick':
      msg = game.adminKick(String(arg)) ? `${arg} kicked.` : 'Player not found.';
      break;
    case 'reset':
      game.reset();
      pausedAt = null;
      turnEndsAt = now + phaseMs();
      for (const cl of clients) send(cl, { type: 'events', events: game.state.events.slice(-1) });
      msg = 'New game!';
      break;
    default:
      return;
  }
  journal.write('admin', { action, arg, msg });
  console.log(`[control] ${msg}`);
  deliver(game.flush());
  send(c, { type: 'feedback', ok: true, text: `Control room: ${msg}` });
  for (const cl of clients) sendState(cl);
  try {
    save();
  } catch {
    /* sauvegarde au prochain tour */
  }
}

// ------------------------------------------------------------------ tours
function runTurn() {
  const late = Date.now() - turnEndsAt;
  turnEndsAt = Date.now() + phaseMs();
  let events: GameEvent[] = [];
  const t0 = performance.now();
  try {
    events = game.tick(Date.now());
  } catch (e) {
    console.error(`[turn ${game.state.turn}] error, the game goes on:`, e);
  }
  const ms = Math.round(performance.now() - t0);
  const all = Object.values(game.state.players);
  const floors: Record<number, number> = {};
  for (const p of all) if (p.alive) floors[p.floor] = (floors[p.floor] ?? 0) + 1;
  journal.write('turn', { ms, late, events: events.length, players: all.length, alive: all.filter((p) => p.alive).length, bots: all.filter((p) => p.bot).length, online: clients.size, floors });
  if (game.state.turn % 10 === 0) journal.write('snapshot', { leaderboard: game.leaderboard() });
  deliver(events);
  narrator.onTurn(events);
  // Les PNJ figurants s'ajustent, se souviennent, saluent, et choisissent leur action du prochain tour
  try {
    npcs.greetings();
    const before = game.state.nextId;
    bots.afterTurn();
    deliver(game.state.events.filter((e) => e.id >= before));
    game.flush(); // déjà distribués
  } catch (e) {
    console.error('[npc] error, the game goes on:', e);
  }
  try {
    save();
  } catch (e) {
    console.error('[save] failed:', e);
  }
  broadcastState();
}
function broadcastState() {
  for (const c of clients) {
    try {
      sendState(c);
    } catch (e) {
      console.error('[state] page not updated:', (e as Error).message);
    }
  }
}
// Prévision pour la caméra du stream : quelques secondes avant la fin du tour (5 s, ou 40 % d'un tour court),
// on dit à la vue 3D où l'action va se passer, pour qu'elle ait le temps d'y aller.
let forecastTurn = -1;
setInterval(() => {
  if (pausedAt !== null || game.state.seasonOver || forecastTurn === game.state.turn) return;
  const lead = Math.min(5000, phaseMs() * 0.5);
  if (turnEndsAt - Date.now() > lead) return;
  forecastTurn = game.state.turn;
  let rooms;
  try {
    rooms = game.forecast().filter((r) => game.plays(r.floor, game.state.turn + 1)); // seulement les étages qui vont jouer
  } catch (e) {
    console.error('[camera] forecast failed:', e);
    return;
  }
  if (!rooms.length) return;
  for (const c of clients) if (c.spectator) send(c, { type: 'forecast', turn: game.state.turn, rooms });
}, 250);
setInterval(() => {
  if (pausedAt === null && Date.now() >= turnEndsAt) runTurn();
}, 250);

// Rafraîchit les chronos des pages toutes les 5 s (immunité, effondrement)
setInterval(broadcastState, 5000);

// ------------------------------------------------------------ PNJ figurants
/** Position libre d'un crawler dans sa salle (0..1), relayée aux pages de son étage et à la régie. */
function broadcastPos(name: string, x: number, y: number, except?: Client) {
  const p = game.player(name);
  if (!p || !p.alive) return;
  const out: ServerMsg = { type: 'pos', name: p.name, floor: p.floor, roomId: p.roomId, x: Math.max(-0.3, Math.min(1.3, x)), y: Math.max(-0.3, Math.min(1.3, y)) };
  for (const o of clients) {
    if (o === except) continue;
    if (o.spectator) send(o, out);
    else if (o.name && game.player(o.name)?.floor === p.floor) send(o, out);
  }
}
const npcs = new NpcSociety(game, ai, path.join(root, 'data', 'pnj-memoire.json'), (name, text) => say(name, text));
const bots: BotManager = new BotManager(
  game,
  {
    submit: (name, text) => {
      const before = game.state.nextId;
      let res;
      try {
        res = game.submit(name, text);
      } catch (e) {
        console.error('[npc] command failed:', name, text, e);
        return;
      }
      journal.write('cmd', { name, text, src: 'bot', ok: res.ok, reply: res.text, ms: 0 });
      deliver(game.state.events.filter((e) => e.id >= before));
    },
    say: (name, text) => say(name, text),
    pos: (name, x, y) => broadcastPos(name, x, y),
    mood: (pnj, key) => npcs.mood(pnj, key),
    humanActive: (p): boolean => [...clients].some((c) => c.name && playerKey(c.name) === p.key) || bots.recentlyActive(p),
  },
  cfg.bots,
  cfg.closers,
);
setInterval(() => {
  if (pausedAt === null) bots.fidget();
}, 2500);

// ----------------------------------------------------------------- Twitch
if (cfg.twitchChannel) {
  connectTwitch(
    cfg.twitchChannel,
    (user, text) => {
      if (CHAT_BOTS.has(user.toLowerCase())) return; // Streamlabs, Nightbot… : leurs messages ne sont pas des joueurs
      const k = playerKey(user);
      links.sawOnTwitch(k);
      if (isMuted(user)) return; // banni ou en timeout sur Twitch : plus rien à l'antenne
      const lien = text.match(/^!(?:link|lien)\s+(\d{4})\b/i);
      if (lien) {
        const ok = links.confirm(lien[1], k);
        if (ok && clients.has(ok.who)) {
          ok.who.name = ok.name;
          send(ok.who, { type: 'linked', name: ok.name, token: ok.token });
          journal.write('admin', { action: 'link confirmed', arg: ok.name });
          links.save();
          welcome(ok.who);
        }
        return; // jamais affiché à l'antenne (le code est personnel)
      }
      try {
        command(user, text);
      } catch (e) {
        console.error('[twitch] unhandled message:', user, e);
      }
    },
    (user, why, seconds) => {
      muted.set(playerKey(user), Date.now() + seconds * 1000);
      journal.write('admin', { action: 'muted', arg: user, msg: why });
      console.log(`[twitch] ${user}: ${why} → ignored by the game ${Number.isFinite(seconds) ? `for ${seconds} s` : 'until restart'}`);
    },
  );
}


const onListenError = (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${cfg.port} is already in use: The Dungeon is probably already running in another window.`);
    console.error('  Close it (or change "port" in config.json), then relaunch.\n');
  } else console.error('[server] cannot start:', e);
  process.exit(1);
};
server.on('error', onListenError);
wss.on('error', onListenError); // ws relaie les erreurs du serveur HTTP

if (cfg.tunnel) {
  // « localhost » peut désigner ::1 sous Windows : on écoute aussi là (toujours uniquement sur la machine)
  const handler = server.listeners('request')[0] as http.RequestListener;
  const local6 = http.createServer(handler);
  local6.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  local6.on('error', () => undefined); // pas d'IPv6 sur la machine : sans importance
  local6.listen(cfg.port, '::1');
}
server.listen(cfg.port, cfg.tunnel ? '127.0.0.1' : undefined, () => {
  console.log(`\n  The Dungeon is running on http://localhost:${cfg.port}`);
  console.log(`  Control room (spectator view + game master, DO NOT SHARE): http://localhost:${cfg.port}/?spectateur=${cfg.spectatorKey}`);
  console.log(`  Turn: ${cfg.turnSeconds} s · floor: ${cfg.floorMinutes} min · Twitch: ${cfg.twitchChannel || 'disabled'}`);
  console.log(`  Dungeon AI: ${ai.describe()}`);
  if (ai.provider === 'ollama') void ai.check().then((m) => console.log(`  [ai] ${m}`));
  console.log(`  Tonight's logs (send them to Claude): http://localhost:${cfg.port}/journaux?cle=${cfg.spectatorKey}\n`);
});

process.on('uncaughtException', (e) => console.error('[server] unexpected error (the game goes on):', e));
process.on('unhandledRejection', (e) => console.error('[server] rejected promise:', e));

process.on('exit', () => journal.flush());

// ---------------------------------------------------------------- tunnel public
// Avec "tunnel": true, le jeu lance cloudflared lui-même et récupère l'adresse https://….trycloudflare.com,
// affichée en permanence sur le stream : les viewers ouvrent leur page 2D sans que tu aies rien à recopier.
let publicUrl = '';
let tunnelProc: ChildProcess | null = null;
function startTunnel() {
  try {
    tunnelProc = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${cfg.port}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error('[tunnel] cannot start cloudflared:', (e as Error).message);
    return;
  }
  const scan = (buf: Buffer) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== publicUrl) {
      publicUrl = m[0];
      console.log(`\n  ★ Public address for viewers (shown on stream): ${publicUrl}\n`);
      journal.write('admin', { action: 'tunnel', arg: publicUrl });
      broadcastState();
    }
  };
  tunnelProc.stdout?.on('data', scan);
  tunnelProc.stderr?.on('data', scan);
  tunnelProc.on('error', (e: NodeJS.ErrnoException) => {
    console.error(e.code === 'ENOENT' ? '[tunnel] cloudflared is not installed: double-click tunnel.bat once to install it, then relaunch the game.' : `[tunnel] error: ${e.message}`);
    tunnelProc = null;
  });
  tunnelProc.on('exit', (code) => {
    if (tunnelProc === null) return;
    console.error(`[tunnel] cloudflared stopped (code ${code}): retrying in 10 s.`);
    publicUrl = '';
    tunnelProc = null;
    setTimeout(startTunnel, 10_000);
  });
}
if (cfg.tunnel) startTunnel();
process.on('exit', () => {
  const p = tunnelProc;
  tunnelProc = null;
  p?.kill();
});

const stop = () => {
  try {
    journal.write('snapshot', { leaderboard: game.leaderboard() });
    journal.write('stop', { players: Object.keys(game.state.players).length });
    npcs.save();
    links.save();
    save();
    console.log('\n[save] game saved. See you soon!');
  } finally {
    process.exit(0);
  }
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(sig, stop);
