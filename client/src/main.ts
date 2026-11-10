// Page joueur : connexion, affichage de l'état, envoi des commandes.
import type { ClientMsg, GameEvent, Item, PlayerViewMsg, RoomView, ServerMsg } from '../../src/shared/types';
import { MapRenderer } from './map';
import { CLASS_SPRITE, Tiles } from './tiles';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CLASS_INFO: Record<string, { label: string; desc: string }> = {
  barbare: { label: 'Barbare', desc: 'Force +3, 14 PV. Frappe d\'abord, réfléchit jamais.' },
  chevalier: { label: 'Chevalier', desc: 'Force +2, Charisme +1, 12 PV, tunique. Solide et poli.' },
  voleur: { label: 'Voleur', desc: 'Agilité +3, 10 PV. Esquive, fuit, trahit.' },
  mage: { label: 'Mage', desc: 'Intelligence +3, 8 PV. Puissant, fragile, fier.' },
};
const ROOM_LABEL: Record<string, string> = { normale: 'Salle', safe: 'Safe room', piege: 'Salle (pièges ?)', tresor: 'Salle du trésor', arene: 'Arène', boss: 'Salle du boss' };

const params = new URLSearchParams(location.search);
const spectatorKey = params.get('spectateur');
const tiles = new Tiles();
const map = new MapRenderer($('map') as HTMLCanvasElement, tiles);
let ws: WebSocket | null = null;
let state: PlayerViewMsg | null = null;
let clockOffset = 0;
let myName = localStorage.getItem('donjon-pseudo') ?? '';

// ---------------------------------------------------------------- réseau
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    if (spectatorKey) send({ type: 'hello', name: '', spectatorKey });
    else if (myName) send({ type: 'hello', name: myName });
  };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data) as ServerMsg);
  ws.onclose = () => {
    logLine('Connexion perdue, nouvelle tentative…', 'k-feedback-ko');
    setTimeout(connect, 2000);
  };
}
function send(m: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}
function cmd(text: string) {
  send({ type: 'cmd', text });
}

function onMessage(m: ServerMsg) {
  if (m.type === 'state') {
    state = m;
    clockOffset = m.serverNow - Date.now();
    render();
  } else if (m.type === 'events') {
    for (const e of m.events) logEvent(e);
  } else if (m.type === 'feedback') {
    logLine(m.text, m.ok ? 'k-prive' : 'k-feedback-ko');
    if (!m.ok && !state?.me) $('login-msg').textContent = m.text;
  } else if (m.type === 'chat') {
    chatLine(m.from, m.text, !!m.cmd);
    if (!m.cmd) map.bubble(m.from, m.text);
  }
}

// ---------------------------------------------------------------- journal
const userColors = new Map<string, string>();
function colorFor(name: string) {
  if (!userColors.has(name)) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
    userColors.set(name, `hsl(${h} 80% 68%)`);
  }
  return userColors.get(name)!;
}
function logLine(text: string, cls = '', turn?: number) {
  const box = $('log');
  const div = document.createElement('div');
  div.className = cls;
  div.innerHTML = (turn ? `<span class="t">T${turn}</span>` : '') + esc(text).replace(/\n/g, '<br>');
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  box.appendChild(div);
  while (box.children.length > 250) box.firstChild!.remove();
  if (stick) box.scrollTop = box.scrollHeight;
}
const seen = new Set<number>();
function logEvent(e: GameEvent) {
  if (seen.has(e.id)) return;
  seen.add(e.id);
  logLine(e.text, e.scope === 'prive' ? 'k-prive' : `k-${e.kind}`, e.turn);
  if (e.drama >= 80) map.shake = Math.max(map.shake, 4);
}
function chatLine(from: string, text: string, isCmd = false) {
  const box = $('chat');
  const div = document.createElement('div');
  if (isCmd) div.className = 'cmdline';
  div.innerHTML = `<b style="color:${colorFor(from)}">${esc(from)}</b>${esc(text)}`;
  box.appendChild(div);
  while (box.children.length > 150) box.firstChild!.remove();
  box.scrollTop = box.scrollHeight;
}

// ---------------------------------------------------------------- rendu
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

function itemLine(it: Item) {
  const stats = it.dmg ? `d${it.dmg}${it.hit ? ` · +${it.hit} au jet` : ''}` : it.def ? `+${it.def} défense` : '';
  return `<span class="rar-${it.rarity}">${esc(it.name)}</span>${stats ? ` <span class="item-sub">${stats}</span>` : ''}<div class="item-sub">${esc(it.desc)}</div>`;
}

function render() {
  if (!state) return;
  const s = state;
  const me = s.me;
  const f = s.floor;

  // Écran de connexion / choix de classe
  if (s.spectator) $('login').classList.add('hidden');
  else if (me) {
    if (!$('login').classList.contains('hidden') && !localStorage.getItem('donjon-aide-vue')) {
      localStorage.setItem('donjon-aide-vue', '1');
      $('help').classList.remove('hidden');
    }
    $('login').classList.add('hidden');
  }
  else {
    $('login').classList.remove('hidden');
    $('login-form').classList.add('hidden');
    $('class-pick').classList.remove('hidden');
  }

  $('hud-floor').textContent = f ? `Étage ${f.n}` : 'Étage —';
  $('hud-theme').textContent = f ? `thème : ${f.theme}` : '';
  $('hud-online').textContent = `${s.online} connecté(s)`;
  map.setFloor(f);

  if (s.spectator) return renderSpectator();
  if (!me || !f) return;
  const room = f.rooms.find((r) => r.current) ?? null;

  // Fiche personnage
  const im = me.immuneSeconds > 0 ? `<span class="badge immune">Immunisé ${fmtTime(me.immuneSeconds)}</span>` : '';
  const tr = me.traitorTurns > 0 ? `<span class="badge traitor">TRAÎTRE (${me.traitorTurns} tours)</span>` : '';
  const al = me.alliance.length ? `<span class="badge ally">Alliés : ${me.alliance.map(esc).join(', ')}</span>` : '';
  const invites = me.pendingAllianceFrom.map((n) => `<div class="row"><span class="grow">${esc(n)} propose une alliance</span><button data-cmd="!alliance ${esc(n)}">Accepter</button></div>`).join('');
  const stats = (['for', 'agi', 'int', 'cha'] as const).map((k) => `<div class="stat"><small>${k}</small><b>${sign(me.stats[k])}</b>${me.statPoints ? `<button data-cmd="!monte ${k}">+</button>` : ''}</div>`).join('');
  $('me-card').innerHTML = `
    <div class="card-title">${esc(me.name)} <span class="muted">${CLASS_INFO[me.cls].label} niv. ${me.level}</span></div>
    <div class="row">
      <img class="portrait" src="${tiles.icon(CLASS_SPRITE[me.cls], 3)}" alt="">
      <div class="grow">
        <div class="meter-label"><span>PV</span><span>${me.hp}/${me.maxHp}</span></div>
        <div class="meter hp"><i style="width:${(100 * me.hp) / me.maxHp}%"></i></div>
        <div class="meter-label" style="margin-top:6px"><span>XP</span><span>${me.xp}/${me.xpNext}</span></div>
        <div class="meter xp"><i style="width:${(100 * me.xp) / me.xpNext}%"></i></div>
        <div class="badges"><span class="badge gold">${me.gold} po</span><span class="badge">${me.kills} kills · ${me.deaths} morts</span>${im}${tr}${al}</div>
      </div>
    </div>
    <div class="stats">${stats}</div>
    ${me.statPoints ? `<div class="item-sub" style="color:var(--gold)">${me.statPoints} point(s) de stat à dépenser</div>` : ''}
    ${invites}`;

  // Action en attente / mort
  const pend = $('pending');
  if (!me.alive) {
    pend.className = 'pending dead';
    pend.textContent = `Tu es mort. Réapparition dans ${me.respawnInTurns} tour(s).`;
  } else if (me.pending) {
    pend.className = 'pending';
    pend.textContent = `Action prévue : ${me.pending}`;
  } else {
    pend.className = 'pending hidden';
  }

  // Salle courante
  if (room) renderRoom(room, s);
  // Inventaire
  const inSafe = room?.type === 'safe';
  const eq = (label: string, it: Item | null) => `<div class="entity">${it ? `<img src="${tiles.icon(it.sprite)}" alt="">` : '<span style="width:32px"></span>'}<div class="grow"><div class="section-label" style="margin:0">${label}</div>${it ? itemLine(it) : '<span class="muted">rien</span>'}</div></div>`;
  const items = me.items.map((it, i) => {
    const use = it.kind === 'arme' || it.kind === 'armure' ? `<button data-cmd="!equipe ${i + 1}">Équiper</button>` : `<button data-cmd="!utilise ${i + 1}">Utiliser</button>`;
    const sell = inSafe ? `<button data-cmd="!vends ${i + 1}">Vendre ${Math.max(1, Math.ceil(it.value / 2))} po</button>` : '';
    return `<div class="entity"><img src="${tiles.icon(it.sprite)}" alt=""><div class="grow">${itemLine(it)}</div><div style="display:flex;flex-direction:column;gap:3px">${use}${sell}</div></div>`;
  }).join('');
  $('inv-card').innerHTML = `<div class="card-title">Équipement <span class="muted">${me.items.length}/8 objets</span></div>
    ${eq('Arme', me.weapon)}${eq('Armure', me.armor)}
    <div class="section-label">Sac</div>${items || '<span class="muted">Sac vide.</span>'}`;

  // Croix directionnelle
  for (const b of $('dpad').querySelectorAll('button')) {
    const d = { '!nord': 'n', '!sud': 's', '!est': 'e', '!ouest': 'o' }[b.dataset.cmd!] as 'n';
    (b as HTMLButtonElement).disabled = !room || room.doors[d] === undefined || !me.alive;
  }
}

function renderRoom(room: RoomView, s: PlayerViewMsg) {
  const me = s.me!;
  const ms = room.monsters ?? [];
  const others = (room.players ?? []).filter((p) => !p.me);
  const canPvp = room.type !== 'safe' && me.immuneSeconds === 0;
  const monsters = ms.map((m, i) => `<div class="entity"><img src="${tiles.icon(m.sprite)}" alt=""><div class="grow"><b style="color:${m.boss ? 'var(--gold)' : '#ffb0b0'}">${esc(m.name)}</b><div class="meter hp"><i style="width:${(100 * m.hp) / m.maxHp}%"></i></div></div><button class="danger" data-cmd="!attaque ${i + 1}">Attaquer</button></div>`).join('');
  const players = others.map((p) => {
    const tags = [p.ally ? '<span class="badge ally">allié</span>' : '', p.traitor ? '<span class="badge traitor">traître</span>' : '', p.immune ? '<span class="badge immune">immunisé</span>' : '', !p.alive ? '<span class="badge">mort</span>' : ''].join('');
    const atk = p.alive && canPvp && !p.immune ? `<button class="danger" data-cmd="!attaque ${esc(p.name)}">${p.ally ? 'Trahir' : 'Attaquer'}</button>` : '';
    const ally = p.alive && !p.ally ? `<button data-cmd="!alliance ${esc(p.name)}">Alliance</button>` : '';
    return `<div class="entity"><img src="${tiles.icon(CLASS_SPRITE[p.cls])}" alt=""><div class="grow"><b>${esc(p.name)}</b> <span class="muted">niv. ${p.level}</span> ${tags}<div class="meter hp"><i style="width:${(100 * p.hp) / p.maxHp}%"></i></div></div><div style="display:flex;flex-direction:column;gap:3px">${atk}${ally}</div></div>`;
  }).join('');
  const ground = (room.ground ?? []).map((it) => `<div class="entity"><img src="${tiles.icon(it.sprite)}" alt=""><div class="grow">${itemLine(it)}</div><button data-cmd="!ramasse ${esc(it.name)}">Prendre</button></div>`).join('');
  const shop = (s.merchant ?? []).map((o) => `<div class="entity"><img src="${tiles.icon(o.item.sprite)}" alt=""><div class="grow">${itemLine(o.item)}</div><button data-cmd="!achete ${o.index}" ${o.price > me.gold ? 'disabled' : ''}>${o.price} po</button></div>`).join('');

  const acts: string[] = [];
  if (room.chest === 'ferme') acts.push('<button data-cmd="!fouille">Ouvrir le coffre</button>');
  else if (!room.searched && room.type !== 'safe') acts.push('<button data-cmd="!fouille">Fouiller</button>');
  if (room.type === 'piege') acts.push('<button data-cmd="!fouille">Chercher un piège</button>');
  if ((room.groundGold ?? 0) > 0 || (room.ground ?? []).length) acts.push(`<button data-cmd="!ramasse">Tout ramasser${room.groundGold ? ` (${room.groundGold} po)` : ''}</button>`);
  if (room.type === 'safe') acts.push('<button data-cmd="!repos">Se reposer</button>');
  if (room.stairs) acts.push(`<button data-cmd="!descendre" ${room.bossAlive ? 'disabled title="Le boss bloque l\'escalier"' : ''}>Descendre</button>`);

  $('room-card').innerHTML = `
    <div class="card-title">${ROOM_LABEL[room.type]} <span class="muted">salle ${room.id}</span></div>
    ${room.desc ? `<div class="desc">${esc(room.desc)}</div>` : ''}
    <div class="actions">${acts.join('')}</div>
    ${monsters ? `<div class="section-label">Monstres</div>${monsters}` : ''}
    ${players ? `<div class="section-label">Crawlers</div>${players}` : ''}
    ${ground ? `<div class="section-label">Au sol</div>${ground}` : ''}
    ${shop ? `<div class="section-label">Marchand</div>${shop}` : ''}`;
}

function renderSpectator() {
  const s = state!;
  const f = s.floor;
  $('dpad').classList.add('hidden');
  $('cmd-form').classList.add('hidden');
  $('inv-card').classList.add('hidden');
  const bar = $('spectator-bar');
  bar.classList.remove('hidden');
  if (f) bar.innerHTML = `<b>Vue spectateur</b> <button data-floor="${f.n - 1}">◀</button> étage ${f.n} <button data-floor="${f.n + 1}">▶</button>`;
  if (!f) return;
  const all = f.rooms.flatMap((r) => (r.players ?? []).map((p) => ({ ...p, room: r.id })));
  $('me-card').innerHTML = `<div class="card-title">Crawlers de l'étage <span class="muted">${all.length}</span></div>` + all.map((p) => `<div class="entity"><img src="${tiles.icon(CLASS_SPRITE[p.cls])}" alt=""><div class="grow"><b>${esc(p.name)}</b> <span class="muted">niv. ${p.level} · salle ${p.room}</span>${p.traitor ? ' <span class="badge traitor">traître</span>' : ''}<div class="meter hp"><i style="width:${(100 * p.hp) / p.maxHp}%"></i></div></div></div>`).join('');
  const mons = f.rooms.flatMap((r) => r.monsters ?? []);
  $('room-card').innerHTML = `<div class="card-title">Étage ${f.n}</div><div class="desc">${f.rooms.length} salles · ${mons.length} monstres · boss : ${mons.find((m) => m.boss)?.name ?? 'vaincu'}</div>`;
  $('pending').className = 'pending hidden';
}

function tickHud() {
  if (state) {
    const now = Date.now() + clockOffset;
    const left = Math.max(0, (state.turnEndsAt - now) / 1000);
    $('hud-turn').textContent = `Tour ${state.turn} · ${Math.ceil(left)} s`;
    ($('turn-bar') as HTMLElement).style.width = `${100 - (100 * left) / state.turnSeconds}%`;
    const c = state.floor?.collapseInSec;
    const el = $('hud-collapse');
    if (c !== null && c !== undefined) {
      const elapsed = (now - state.serverNow) / 1000;
      const rest = Math.max(0, c - elapsed);
      el.textContent = `Effondrement dans ${fmtTime(rest)}`;
      el.classList.toggle('urgent', rest < 60);
    } else el.textContent = '';
  }
  requestAnimationFrame(tickHud);
}

// ---------------------------------------------------------------- interactions
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!b) return;
  if (b.dataset.cmd) cmd(b.dataset.cmd);
  if (b.dataset.floor) send({ type: 'floor', n: Number(b.dataset.floor) });
  if (b.dataset.class) cmd(`!join ${b.dataset.class}`);
});
$('cmd-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('cmd') as HTMLInputElement;
  const text = input.value.trim();
  if (!text) return;
  history.unshift(text);
  history.length = Math.min(history.length, 30);
  histIdx = -1;
  if (text.startsWith('!')) cmd(text);
  else send({ type: 'say', text });
  input.value = '';
});
// Historique des commandes avec les flèches haut/bas
const history: string[] = [];
let histIdx = -1;
$('cmd').addEventListener('keydown', (e) => {
  const input = e.target as HTMLInputElement;
  if (e.key === 'ArrowUp' && history.length) {
    histIdx = Math.min(history.length - 1, histIdx + 1);
    input.value = history[histIdx];
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    histIdx = Math.max(-1, histIdx - 1);
    input.value = histIdx >= 0 ? history[histIdx] : '';
    e.preventDefault();
  }
});
$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  myName = ($('pseudo') as HTMLInputElement).value.trim();
  if (!myName) return;
  localStorage.setItem('donjon-pseudo', myName);
  send({ type: 'hello', name: myName });
});
$('help-btn').addEventListener('click', () => $('help').classList.remove('hidden'));
$('help').addEventListener('click', (e) => {
  if (e.target === $('help') || (e.target as HTMLElement).closest('.close')) $('help').classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('help').classList.add('hidden');
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.key === '?') return $('help').classList.remove('hidden');
  const k: Record<string, string> = { ArrowUp: '!nord', ArrowDown: '!sud', ArrowLeft: '!ouest', ArrowRight: '!est', z: '!nord', s: '!sud', q: '!ouest', d: '!est', f: '!fouille', a: '!attaque' };
  if (k[e.key]) {
    e.preventDefault();
    cmd(k[e.key]);
  }
});

// ---------------------------------------------------------------- démarrage
(async () => {
  await tiles.load();
  const classes = document.querySelector('#class-pick .classes')!;
  classes.innerHTML = Object.entries(CLASS_INFO).map(([id, c]) => `<button class="class-btn" data-class="${id}"><img src="${tiles.icon(CLASS_SPRITE[id], 3)}" alt=""><b>${c.label}</b><small>${c.desc}</small></button>`).join('');
  if (myName) ($('pseudo') as HTMLInputElement).value = myName;
  if (spectatorKey) $('login').classList.add('hidden');
  connect();
  const loop = (t: number) => {
    map.draw(t / 1000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  tickHud();
})();
