// Page « stream 3D » : la partie en cours rendue avec les modèles KayKit, pour OBS ou un partage d'écran.
// Adresse : /stream.html?cle=<clé de la régie>
import type { ClientMsg, GameEvent, PlayerViewMsg, ServerMsg } from '../../../src/shared/types';
import { Assets } from './assets';
import { World } from './world';
import { initTelemetry, telemetryReady } from '../telemetry';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const params = new URLSearchParams(location.search);
const key = params.get('cle') ?? params.get('spectateur') ?? '';
const follow = params.get('suivre');

const assets = new Assets();
let world: World;
let ws: WebSocket | null = null;
let state: PlayerViewMsg | null = null;
let clockOffset = 0;
let wantedFloor: number | null = null;
const seen = new Set<number>();

function send(m: ClientMsg): boolean {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(m));
  return true;
}
initTelemetry(send, 'stream 3D');

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    send({ type: 'hello', name: '', spectatorKey: key });
    telemetryReady();
  };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data) as ServerMsg);
  ws.onclose = () => setTimeout(connect, 2000);
}

function onMessage(m: ServerMsg) {
  if (m.type === 'state') {
    state = m;
    clockOffset = m.serverNow - Date.now();
    if (m.floor) world.setFloor(m.floor);
    renderHud(m);
    pickFloor(m);
  } else if (m.type === 'events') {
    const fresh = m.events.filter((e) => !seen.has(e.id));
    fresh.forEach((e) => seen.add(e.id));
    world.onEvents(fresh);
    for (const e of fresh) onEvent(e);
  } else if (m.type === 'chat' && !m.cmd) {
    world.bubble(m.from, m.text);
  } else if (m.type === 'chat' && m.cmd && m.ok !== undefined) {
    showCommand(m.from, m.text, m.ok, m.reply ?? '', m.src === 'twitch');
  } else if (m.type === 'feedback' && !m.ok) {
    $('load-msg').textContent = m.text + ' Ajoute ?cle=<clé de la régie> à l\'adresse.';
  }
}

/** Bandeau des commandes du chat : le joueur Twitch voit si sa commande est passée (✓) ou pourquoi elle a échoué (✗). */
function showCommand(from: string, text: string, ok: boolean, reply: string, twitch: boolean) {
  $('cmds').classList.remove('hidden');
  const list = $('cmds-list');
  const row = document.createElement('div');
  row.className = `c ${ok ? 'ok' : 'ko'}${twitch ? ' tw' : ''}`;
  const why = !ok && reply ? `<span class="why">${esc(reply)}</span>` : '';
  row.innerHTML = `<span class="v">${ok ? '✓' : '✗'}</span><b>${esc(from)}</b> <code>${esc(text.slice(0, 40))}</code>${why}`;
  list.prepend(row);
  while (list.children.length > 6) list.lastElementChild!.remove();
}

/** Le stream montre l'étage où il y a le plus de crawlers vivants. */
function pickFloor(s: PlayerViewMsg) {
  const count = new Map<number, number>();
  for (const r of s.leaderboard) if (r.alive) count.set(r.floor, (count.get(r.floor) ?? 0) + 1);
  let best: number | null = null;
  let n = 0;
  for (const [f, c] of count) if (c > n) [best, n] = [f, c];
  if (best !== null && best !== s.floor?.n && best !== wantedFloor) {
    wantedFloor = best;
    send({ type: 'floor', n: best });
  }
}

// ------------------------------------------------------------------ habillage

function renderHud(s: PlayerViewMsg) {
  const f = s.floor;
  const alive = s.leaderboard.filter((r) => r.alive).length;
  $('meta').innerHTML = f ? `Étage <b>${f.n}</b> · ${esc(f.theme)} · <b>${alive}</b> crawlers en vie` : '—';
  $('pause').classList.toggle('hidden', !s.paused);
  // Classement
  $('lb').innerHTML = `<h3>Classement</h3>` + s.leaderboard.slice(0, 6).map((r, i) => `<div class="r ${r.alive ? '' : 'dead'}"><span class="k">${i + 1}</span><span class="nm">${esc(r.name)}${r.bot ? ' <small style="opacity:.6">PNJ</small>' : ''}${r.bounty ? ' 💰' : ''}${r.traitor ? ' ☠' : ''}</span><span class="s">niv ${r.level} · ét. ${r.deepest} · ${r.kills} kills</span></div>`).join('');
  // Vote
  const v = s.vote;
  $('vote').classList.toggle('hidden', !v);
  if (v) $('vote').innerHTML = `<div class="t">VOTEZ DANS LE CHAT — encore ${v.turnsLeft} tour(s)</div>` + v.options.map((o) => `<div class="o"><span class="n">${o.votes}</span><b>!vote ${o.n} · ${esc(o.label)}</b><small>${esc(o.desc)}</small></div>`).join('');
  // Appel à jouer
  const tips = [
    'Tape <b>!join</b> dans le chat pour entrer dans le donjon',
    'Classes : <b>!join barbare</b>, <b>chevalier</b>, <b>voleur</b> ou <b>mage</b>',
    'Suis ton crawler sur la page web avec le même pseudo',
    s.effects.bounty ? `Prime sur <b>${esc(s.effects.bounty.target)}</b> : ${s.effects.bounty.gold} po` : 'Attaquer un allié = trahison (et tout le monde le saura)',
  ];
  $('cta').innerHTML = tips[Math.floor(Date.now() / 8000) % tips.length];
}

let ltTimer = 0;
let iaTimer = 0;
function onEvent(e: GameEvent) {
  const isIa = !!(e as GameEvent & { narrator?: boolean }).narrator;
  if (isIa) {
    $('ia-text').textContent = e.text;
    $('ia').classList.remove('hidden');
    clearTimeout(iaTimer);
    iaTimer = window.setTimeout(() => $('ia').classList.add('hidden'), 8000);
  }
  const important = isIa || e.drama >= 15 || ['mort', 'trahison', 'niveau', 'systeme', 'alliance'].includes(e.kind);
  if (important && e.scope !== 'prive') {
    const feed = $('feed');
    const div = document.createElement('div');
    div.className = `fi ${isIa ? 'ia' : e.kind}`;
    div.textContent = e.text;
    feed.prepend(div);
    while (feed.children.length > 6) feed.lastChild!.remove();
  }
  if (e.drama >= 60 && !isIa && e.scope !== 'prive') {
    $('lt-text').textContent = e.text.length > 120 ? e.text.slice(0, 117) + '…' : e.text;
    $('lt').classList.add('on');
    clearTimeout(ltTimer);
    ltTimer = window.setTimeout(() => $('lt').classList.remove('on'), 5500);
  }
}

function tickHud() {
  if (state) {
    const now = Date.now() + clockOffset;
    const left = Math.max(0, (state.turnEndsAt - now) / 1000);
    $('turn').textContent = `Tour ${state.turn} · ${Math.ceil(left)} s`;
    $('turn-bar').style.width = `${100 - (100 * left) / state.turnSeconds}%`;
    const c = state.floor?.collapseInSec;
    if (c !== null && c !== undefined) {
      const rest = Math.max(0, c - (now - state.serverNow) / 1000);
      $('collapse').textContent = `Effondrement dans ${fmt(rest)}`;
      $('collapse').classList.toggle('urgent', rest < 60);
    } else $('collapse').textContent = state.floor ? 'Chrono en attente d\'un aventurier' : '';
  }
}

// ------------------------------------------------------------------ démarrage
(async () => {
  if (!key) {
    $('load-msg').textContent = 'Il manque la clé de la régie : ouvre /stream.html?cle=<clé> (elle s\'affiche au démarrage du serveur).';
    return;
  }
  await assets.load((d, t) => {
    $('load-bar').style.width = `${(100 * d) / t}%`;
  });
  world = new World($('c') as HTMLCanvasElement, $('labels'), assets);
  if (follow) world.followName = follow;
  world.onShot = (label) => ($('shot').textContent = label);
  if (params.has('debug')) (window as unknown as { world: World }).world = world;
  // Le HUD est dessiné pour du 1920×1080 : on le réduit dans une fenêtre plus petite
  const ui = document.querySelector('.ui') as HTMLElement;
  const resize = () => {
    world.resize(innerWidth, innerHeight);
    const s = Math.min(1, innerWidth / 1600, innerHeight / 900);
    ui.style.transform = s < 1 ? `scale(${s})` : '';
    ui.style.transformOrigin = '0 0';
    ui.style.width = s < 1 ? `${100 / s}%` : '';
    ui.style.height = s < 1 ? `${100 / s}%` : '';
  };
  addEventListener('resize', resize);
  resize();
  connect();
  $('load').style.opacity = '0';
  setTimeout(() => $('load').remove(), 700);
  let last = performance.now();
  const loop = (t: number) => {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    world.render(dt, t);
    tickHud();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
