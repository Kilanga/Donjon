// Page joueur : connexion, affichage de l'état, envoi des commandes.
import type { ClientMsg, GameEvent, Item, PlayerViewMsg, RoomView, ServerMsg } from '../../src/shared/types';
import { MapRenderer } from './map';
import { PRODUCTION_EVENTS } from '../../src/server/game/production';
import { Stage } from './stage';
import { CLASS_SPRITE, Tiles } from './tiles';
import { initTelemetry, telemetryReady } from './telemetry';

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
const stage = new Stage(map, $('map-wrap'), spectatorKey !== null);
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
    telemetryReady();
  };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data) as ServerMsg);
  ws.onclose = () => {
    logLine('Connexion perdue, nouvelle tentative…', 'k-feedback-ko');
    setTimeout(connect, 2000);
  };
}
function send(m: ClientMsg): boolean {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(m));
  return true;
}
initTelemetry(send, spectatorKey !== null ? 'régie' : 'joueur');
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
  logLine(e.text, e.narrator ? 'k-ia' : e.scope === 'prive' ? 'k-prive' : `k-${e.kind}`, e.turn);
  stage.onEvent(e);
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
  renderShared(s);
  stage.onState(s);

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

/** Éléments communs aux joueurs et à la régie : vote, effets, classement, régie. */
function renderShared(s: PlayerViewMsg) {
  // Effets en cours
  const fx = s.effects;
  const chips: string[] = [];
  if (fx.happyHourTurns) chips.push(`<span class="chip hh">Happy hour ${fx.happyHourTurns} tours</span>`);
  if (fx.floodTurns) chips.push(`<span class="chip flood">Inondation ${fx.floodTurns} tours</span>`);
  if (fx.bounty) chips.push(`<span class="chip bounty">Prime sur ${esc(fx.bounty.target)} : ${fx.bounty.gold} po</span>`);
  if (fx.nextVoteInTurns !== null && !s.vote) chips.push(`<span class="chip">Vote dans ${fx.nextVoteInTurns} tours</span>`);
  $('hud-effects').innerHTML = chips.join('');
  $('paused').classList.toggle('hidden', !s.paused);

  // Vote de la production
  const v = s.vote;
  const box = $('vote');
  if (v) {
    box.classList.remove('hidden');
    box.classList.toggle('voted', !!v.myVote);
    const opts = v.options.map((o) => {
      const tag = s.spectator ? 'div' : 'button';
      const attr = s.spectator ? 'class="vote-opt card"' : `class="vote-opt${v.myVote === o.key ? ' mine' : ''}" data-cmd="!vote ${o.n}"`;
      return `<${tag} ${attr} title="${esc(o.desc)}"><span class="n">${o.votes}</span><b>${o.n}. ${esc(o.label)}</b><small>${esc(o.desc)}</small></${tag}>`;
    }).join('');
    box.innerHTML = `<div class="vote-title">La production propose — encore ${v.turnsLeft} tour(s) · <span class="muted">!vote 1, 2 ou 3</span></div><div class="vote-options">${opts}</div>`;
  } else box.classList.add('hidden');

  // Classement
  const rows = s.leaderboard;
  const me = s.me?.name;
  const top = (k: 'kills' | 'betrayals' | 'deaths' | 'gold') => {
    const r = [...rows].sort((a, b) => b[k] - a[k])[0];
    return r && r[k] > 0 ? `<b>${esc(r.name)}</b> (${r[k]})` : '—';
  };
  $('rank-card').innerHTML = `<div class="card-title">Classement <span class="muted">${rows.length} crawlers</span></div>
    <div class="titles">Boucher : ${top('kills')} · Traître en chef : ${top('betrayals')} · Abonné à la mort : ${top('deaths')} · Riche : ${top('gold')}</div>
    <table class="rank"><tr><th>#</th><th>Crawler</th><th>Niv</th><th>Étage</th><th>Kills</th><th>Morts</th></tr>
    ${rows.slice(0, 12).map((r, i) => `<tr class="${r.name === me ? 'me' : ''} ${r.alive ? '' : 'dead'}"><td>${i + 1}</td><td><img src="${tiles.icon(CLASS_SPRITE[r.cls], 1)}" alt=""> ${esc(r.name)}${r.traitor ? ' <span class="badge traitor">traître</span>' : ''}${r.bounty ? ' <span class="badge gold">prime</span>' : ''}</td><td>${r.level}</td><td>${r.deepest}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`).join('')}
    </table>
    ${s.obituary.length ? `<div class="section-label">Nécrologie</div>${s.obituary.slice(0, 5).map((o) => `<div class="obit">T${o.turn} · ${esc(o.text.split(' Cause')[0])}${o.text.includes('Cause :') ? ` — ${esc(o.text.split('Cause : ')[1].split('.')[0])}` : ''}</div>`).join('')}` : ''}`;

  // Panneau régie (vue spectateur avec la clé)
  const adm = $('admin-card');
  if (!s.admin) return adm.classList.add('hidden');
  adm.classList.remove('hidden');
  if (adm.dataset.ready && adm.dataset.paused === String(s.paused)) return; // ne pas réécrire pendant la saisie
  adm.dataset.ready = '1';
  adm.dataset.paused = String(s.paused);
  adm.innerHTML = `<div class="card-title">Régie <span class="muted">maître du jeu</span></div>
    <div class="admin-grid">
      <button data-admin="${s.paused ? 'resume' : 'pause'}">${s.paused ? 'Reprendre' : 'Pause'}</button>
      <button data-admin="next">Tour suivant</button>
      <button data-admin="vote">Lancer un vote</button>
      <button data-admin="healAll">Soigner tout le monde</button>
      <button data-admin="collapse" class="danger">Effondrer l'étage affiché</button>
      <button data-admin="reset" class="danger">Nouvelle partie</button>
    </div>
    <div class="admin-row"><select id="adm-event">${PRODUCTION_EVENTS.map((e) => `<option value="${e.key}">${esc(e.label)}</option>`).join('')}</select><button data-admin="event">Déclencher</button></div>
    <div class="admin-row"><input id="adm-turn" type="number" min="3" max="120" placeholder="Durée du tour (s), actuellement ${s.turnSeconds}"><button data-admin="turnSeconds">OK</button></div>
    <div class="admin-row"><input id="adm-kick" placeholder="Pseudo à expulser"><button data-admin="kick" class="danger">Expulser</button></div>
    <div class="admin-row"><a class="btn-link" href="/bilan?cle=${encodeURIComponent(spectatorKey ?? '')}" target="_blank" rel="noopener">Bilan de la soirée ↗</a> <a class="btn-link" href="/journaux?cle=${encodeURIComponent(spectatorKey ?? '')}" target="_blank" rel="noopener">Journaux pour Claude ↗</a></div>`;
}

function adminAction(action: string) {
  let arg: string | number | undefined;
  if (action === 'event') arg = ($('adm-event') as HTMLSelectElement).value;
  if (action === 'turnSeconds') arg = Number(($('adm-turn') as HTMLInputElement).value);
  if (action === 'kick') arg = ($('adm-kick') as HTMLInputElement).value.trim();
  if (action === 'collapse') arg = state?.floor?.n;
  if ((action === 'reset' || action === 'collapse' || action === 'kick') && !confirm('Sûr ? Cette action est irréversible.')) return;
  send({ type: 'admin', action: action as never, arg });
}

function renderSpectator() {
  const s = state!;
  const f = s.floor;
  $('dpad').classList.add('hidden');
  $('cmd-form').classList.add('hidden');
  $('inv-card').classList.add('hidden');
  const bar = $('spectator-bar');
  bar.classList.remove('hidden');
  if (!bar.querySelector('#spec-floor')) bar.innerHTML = '<b>Vue spectateur</b> <span id="spec-floor"></span> <span id="spec-tools"></span>';
  if (f) $('spec-floor').innerHTML = `<button data-floor="${f.n - 1}">◀</button> étage ${f.n} <button data-floor="${f.n + 1}">▶</button>`;
  if (!f) return;
  const all = f.rooms.flatMap((r) => (r.players ?? []).map((p) => ({ ...p, room: r.id })));
  $('me-card').innerHTML = `<div class="card-title">Crawlers de l'étage <span class="muted">${all.length}</span></div>` + all.map((p) => `<div class="entity focusable" data-focus="${esc(p.name)}" title="Suivre ${esc(p.name)}"><img src="${tiles.icon(CLASS_SPRITE[p.cls])}" alt=""><div class="grow"><b>${esc(p.name)}</b> <span class="muted">niv. ${p.level} · salle ${p.room}</span>${p.traitor ? ' <span class="badge traitor">traître</span>' : ''}<div class="meter hp"><i style="width:${(100 * p.hp) / p.maxHp}%"></i></div></div></div>`).join('');
  const mons = f.rooms.flatMap((r) => r.monsters ?? []);
  $('room-card').innerHTML = `<div class="card-title">Étage ${f.n}</div><div class="desc">${f.rooms.length} salles · ${mons.length} monstres · boss : ${mons.find((m) => m.boss)?.name ?? 'vaincu'}</div>`;
  $('pending').className = 'pending hidden';
}

function tickHud() {
  if (state) {
    const now = Date.now() + clockOffset;
    const left = Math.max(0, (state.turnEndsAt - now) / 1000);
    $('hud-turn').textContent = `Tour ${state.turn} · ${Math.ceil(left)} s`;
    stage.onTick(left);
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
  if (b.dataset.admin) adminAction(b.dataset.admin);
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
    stage.update();
    map.draw(t / 1000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  tickHud();
})();
