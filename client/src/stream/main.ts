// Page « stream 3D » : la partie en cours rendue avec les modèles KayKit, pour OBS ou un partage d'écran.
// Adresse : /stream.html?cle=<clé de la régie>
import type { ClientMsg, GameEvent, PlayerViewMsg, ServerMsg } from '../../../src/shared/types';
import { Assets } from './assets';
import { World } from './world';
import { HELP_TEXT } from '../../../src/shared/commands';
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
  const sock = ws;
  ws.onopen = () => {
    wantedFloor = null;
    floorSince = 0;
    replay = true; // le premier lot d'évènements est un rappel : pas de cartons
    lastMsg = Date.now();
    send({ type: 'hello', name: '', spectatorKey: key });
    telemetryReady();
  };
  ws.onmessage = (e) => {
    lastMsg = Date.now();
    try {
      onMessage(JSON.parse(e.data) as ServerMsg);
    } catch (err) {
      console.error('[stream] message non traité', err);
    }
  };
  ws.onclose = () => {
    if (ws === sock) setTimeout(connect, 2000);
  };
}
let lastMsg = Date.now();
let replay = false;
// Le serveur envoie l'état toutes les 5 s : 15 s de silence = connexion morte (tunnel, veille…), on la relance
setInterval(() => {
  if (!ws || Date.now() - lastMsg < 15_000) return;
  const old = ws;
  old.onclose = null;
  old.onmessage = null;
  try {
    old.close();
  } catch {
    /* déjà fermée */
  }
  lastMsg = Date.now();
  connect();
}, 5000);

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
    for (const e of fresh) heatFloor(e);
    const win = fresh.find((e) => e.victory);
    const first = replay;
    replay = false;
    if (first) return;
    if (win?.victory) showCard('VICTOIRE !', `${win.victory.name}${win.victory.bot ? ' (PNJ)' : ''} sort du Donjon et entre dans la Légende`);
  } else if (m.type === 'chat' && !m.cmd) {
    world.bubble(m.from, m.text);
  } else if (m.type === 'pos') {
    world.setPos(m.name, m.floor, m.roomId, m.x, m.y);
  } else if (m.type === 'forecast') {
    // Anticipation : la caméra part vers l'action avant la fin du tour, et l'étage le plus chaud peut être choisi d'avance
    world.onForecast(m.rooms);
    const now = performance.now();
    for (const r of m.rooms) floorHeat.set(r.floor, { s: heatOf(r.floor, now) + r.score * 0.5, t: now });
    if (state) pickFloor(state);
  } else if (m.type === 'chat' && m.cmd && m.ok !== undefined) {
    showCommand(m.from, m.text, m.ok, m.reply ?? '', m.src === 'twitch');
    if (/^!(aide|help|commandes|commands|regles|règles)\b/i.test(m.text.trim())) showHelp();
  } else if (m.type === 'feedback' && !m.ok) {
    const lm = document.getElementById('load-msg');
    if (lm) lm.textContent = m.text + ' Ajoute ?cle=<clé de la régie> à l\'adresse.';
  }
}

/** !commandes ou !aide dans le chat : le panneau des commandes s'affiche 20 s sur le stream. */
let helpTimer = 0;
function showHelp() {
  $('helpp-list').innerHTML = HELP_TEXT.map((l) => {
    const [cmd, what] = l.split(' — ');
    return `<div class="l"><code>${esc(cmd)}</code> — ${esc(what ?? '')}</div>`;
  }).join('');
  $('helpp').classList.remove('hidden');
  clearTimeout(helpTimer);
  helpTimer = window.setTimeout(() => $('helpp').classList.add('hidden'), 20000);
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

// ------------------------------------------------------------ réalisation multi-étages
// Le stream va là où ça se passe : vrais joueurs d'abord, puis l'action récente (drame), avec un carton « ÉTAGE N ».
const floorHeat = new Map<number, { s: number; t: number }>();
let floorSince = 0;
const heatOf = (n: number, now: number) => {
  const h = floorHeat.get(n);
  return h ? h.s * Math.pow(0.5, (now - h.t) / 20000) : 0;
};
function heatFloor(e: GameEvent) {
  if (e.scope === 'prive' || e.npc || !e.floor) return;
  const now = performance.now();
  floorHeat.set(e.floor, { s: heatOf(e.floor, now) + e.drama + 4, t: now });
}

let cardTimer = 0;
function showCard(n: number | string, sub: string) {
  const card = $('card');
  card.querySelector('.c1')!.textContent = typeof n === 'number' ? `ÉTAGE ${n}` : n;
  card.querySelector('.c2')!.textContent = sub;
  card.classList.remove('hidden');
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';
  clearTimeout(cardTimer);
  cardTimer = window.setTimeout(() => card.classList.add('hidden'), 2700);
}

/** Choisit l'étage montré : il faut que ça vaille le déplacement (et au moins 25 s sur un étage). */
function pickFloor(s: PlayerViewMsg) {
  const floors = s.floors;
  if (floors?.length) {
    const now = performance.now();
    const score = (f: { n: number; humans: number; bots: number }) => f.humans * 12 + f.bots * 2 + heatOf(f.n, now);
    const occupied = floors.filter((f) => f.humans + f.bots > 0);
    if (!occupied.length) return;
    const best = occupied.reduce((a, b) => (score(b) > score(a) ? b : a));
    const cur = floors.find((f) => f.n === s.floor?.n);
    const curEmpty = !cur || cur.humans + cur.bots === 0;
    const worth = curEmpty || (now - floorSince > 25000 && score(best) > score(cur!) * 1.3 + 10);
    if (best.n !== s.floor?.n && best.n !== wantedFloor && worth) {
      wantedFloor = best.n;
      floorSince = now;
      send({ type: 'floor', n: best.n });
      const who = [best.humans ? `${best.humans} aventurier${best.humans > 1 ? 's' : ''}` : '', best.bots ? `${best.bots} PNJ` : ''].filter(Boolean).join(' · ');
      showCard(best.n, `${who} · ${best.theme}`);
    }
    return;
  }
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
  $('pause').classList.toggle('hidden', !s.paused || !!s.seasonOver);
  // Fin de saison : écran final avec les Légendes de la saison
  if (s.seasonOver) {
    const champs = s.champions ?? [];
    $('season').classList.remove('hidden');
    $('season-sub').textContent = champs.length ? `${champs.length} légende${champs.length > 1 ? 's' : ''} cette saison` : 'Personne n\'est sorti : le Donjon a gagné.';
    $('season-list').innerHTML = champs.slice(0, 10).map((c) => `<div class="lg"><b>${esc(c.name)}${c.bot ? ' <small>(PNJ)</small>' : ''}</b><span>niv ${c.level} · ${c.kills} monstres · ${c.deaths} morts</span></div>`).join('');
  } else $('season').classList.add('hidden');
  // Les étages : qui est où, et combien de temps avant l'effondrement
  if (s.floors && s.floors.length > 1) {
    $('floors').classList.remove('hidden');
    $('floors').innerHTML = '<h3>Les étages</h3>' + s.floors.map((x) => {
      const who = [x.humans ? `${x.humans} ⚔` : '', x.bots ? `${x.bots} PNJ` : ''].filter(Boolean).join(' · ') || 'vide';
      const t = x.collapseInSec === null ? '—' : `${x.stairsInSec ? '🔒' : '🔓'} ${fmt(x.collapseInSec)}`;
      return `<div class="f ${x.n === f?.n ? 'on' : ''}"><span class="n">Étage ${x.n}</span><span class="w">${who}</span><span class="t ${x.collapseInSec !== null && x.collapseInSec < 60 ? 'urgent' : ''}">${t}</span></div>`;
    }).join('');
  } else $('floors').classList.add('hidden');
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
    s.publicUrl ? 'Sur la carte, ton pseudo Twitch + <b>!lien</b> dans le chat : tu contrôles ton perso' : 'Une commande par tour : c\'est la dernière tapée qui compte',
    s.effects.bounty ? `Prime sur <b>${esc(s.effects.bounty.target)}</b> : ${s.effects.bounty.gold} po` : 'Attaquer un allié = trahison (et tout le monde le saura)',
  ];
  const tip = tips[Math.floor(Date.now() / 8000) % tips.length];
  $('cta').innerHTML = s.publicUrl
    ? `<div class="url">🗺️ Ta carte perso : <b>${esc(s.publicUrl.replace(/^https:\/\//, ''))}</b> <small>(ton pseudo Twitch)</small></div><div>${tip}</div>`
    : tip;
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
      const elapsed = (now - state.serverNow) / 1000;
      const rest = Math.max(0, c - elapsed);
      const st = state.floor?.stairsInSec;
      const seal = st !== null && st !== undefined ? Math.max(0, st - elapsed) : 0;
      $('collapse').textContent = seal > 0 ? `🔒 Escalier scellé ${fmt(seal)} · effondrement ${fmt(rest)}` : `🔓 Escalier ouvert · effondrement dans ${fmt(rest)}`;
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
  let loopErrors = 0;
  const loop = (t: number) => {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    try {
      world.render(dt, t);
      tickHud();
    } catch (e) {
      if (++loopErrors <= 5) console.error('[stream] image non rendue', e); // la télémétrie remonte l'erreur au journal
    } finally {
      requestAnimationFrame(loop);
    }
  };
  requestAnimationFrame(loop);
})();
