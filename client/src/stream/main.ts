import { sfx } from '../sfx';
import { Music, pickMood } from './music';
// Page « stream 3D » : la partie en cours rendue avec les modèles KayKit, pour OBS ou un partage d'écran.
// Adresse : /stream.html?cle=<clé de la régie>
import type { ClientMsg, GameEvent, PlayerViewMsg, ServerMsg } from '../../../src/shared/types';
import { Assets } from './assets';
import { World } from './world';
import { THEME_LABEL } from '../../../src/shared/themes';
import { initTelemetry, telemetryReady } from '../telemetry';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const params = new URLSearchParams(location.search);
const key = params.get('cle') ?? params.get('spectateur') ?? '';
const follow = params.get('suivre');

const assets = new Assets();
// Deux scènes 3D, une par étage actif ; une seule est visible et rendue. Bascule instantanée de l'une à l'autre.
const worlds: World[] = [];
const slotFloor: (number | null)[] = [null, null];
let visible = 0;
let world: World; // la scène visible
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
      console.error('[stream] unhandled message', err);
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

// ------------------------------------------------------------------ Victoria
// Ses répliques arrivent avec un clip à télécharger (avec la clé) : sous-titre pendant toute la réplique,
// le reste du son baisse. Une file courte : jamais deux répliques l'une sur l'autre.
const voiceOn = soundOnParam() && !params.has('sansvoix');
const voiceQueue: { id: string | null; text: string; ms: number; volume: number }[] = [];
let voicePlaying = false;
const voiceTexts: string[] = []; // répliques déjà arrivées par la voix : leur sous-titre suit la parole
function soundOnParam() {
  return !params.has('muet');
}
function showVictoria(text: string, ms: number) {
  $('ia-text').textContent = text;
  $('ia').classList.remove('hidden');
  clearTimeout(iaTimer);
  iaTimer = window.setTimeout(() => $('ia').classList.add('hidden'), ms + 1500);
}
async function playVoice() {
  if (voicePlaying) return;
  const v = voiceQueue.shift();
  if (!v) return;
  voicePlaying = true;
  try {
    showVictoria(v.text, v.ms);
    if (v.id && voiceOn && sfx.running) {
      const res = await fetch(`/voix/${v.id}.wav?cle=${encodeURIComponent(key)}`, { cache: 'no-store' });
      if (res.ok) await sfx.voice(await res.arrayBuffer(), v.volume);
      else await new Promise((r) => setTimeout(r, v.ms));
    } else await new Promise((r) => setTimeout(r, v.ms));
  } catch (err) {
    console.warn('[stream] voice clip lost', err);
  } finally {
    voicePlaying = false;
    void playVoice();
  }
}

function onMessage(m: ServerMsg) {
  if (m.type === 'voice') {
    if (replay) return;
    voiceQueue.push(m);
    voiceTexts.push(m.text);
    while (voiceTexts.length > 6) voiceTexts.shift();
    while (voiceQueue.length > 2) voiceQueue.shift();
    void playVoice();
    return;
  }
  if (m.type === 'voiceStop') {
    voiceQueue.length = 0;
    sfx.stopVoice();
    $('ia').classList.add('hidden');
    return;
  }
  if (m.type === 'state') {
    state = m;
    clockOffset = m.serverNow - Date.now();
    if (m.floor) {
      if (slotFloor[visible] !== m.floor.n && slotFloor[1 - visible] === m.floor.n) visible = 1 - visible;
      slotFloor[visible] = m.floor.n;
      worlds[visible].setFloor(m.floor);
      worlds[visible].noteTurnEnd(m.turnEndsAt - clockOffset);
    }
    if (m.standby) {
      slotFloor[1 - visible] = m.standby.n;
      worlds[1 - visible].setFloor(m.standby);
      worlds[1 - visible].noteTurnEnd((m.standbyTurnEndsAt ?? m.turnEndsAt) - clockOffset);
    }
    applyVisible();
    renderHud(m);
    pickFloor(m);
  } else if (m.type === 'events') {
    const fresh = m.events.filter((e) => !seen.has(e.id));
    fresh.forEach((e) => seen.add(e.id));
    for (const w of worlds) w.onEvents(fresh); // chaque scène ne garde que les évènements de son étage
    for (const e of fresh) onEvent(e);
    for (const e of fresh) heatFloor(e);
    const win = fresh.find((e) => e.victory);
    const first = replay;
    replay = false;
    if (first) return;
    if (win?.victory) showCard('Victory!', `${win.victory.name}${win.victory.bot ? ' (NPC)' : ''} escapes the Dungeon and becomes a Legend`);
  } else if (m.type === 'chat' && !m.cmd) {
    for (const w of worlds) w.bubble(m.from, m.text);
    chatLine(m.from, m.text, undefined, m.src === 'twitch');
  } else if (m.type === 'pos') {
    for (const w of worlds) w.setPos(m.name, m.floor, m.roomId, m.x, m.y);
  } else if (m.type === 'forecast') {
    // Anticipation : 5 s avant que l'étage joue, la caméra part vers l'action ; si l'action est sur l'autre étage chargé,
    // on bascule dessus (tours décalés : un étage, puis l'autre, toutes les 10 s)
    for (const w of worlds) w.onForecast(m.rooms);
    const now = performance.now();
    for (const r of m.rooms) floorHeat.set(r.floor, { s: heatOf(r.floor, now) + r.score * 0.5, t: now });
    const top = m.rooms[0];
    const other = 1 - visible;
    if (top && top.score + top.floor >= 10 && slotFloor[other] === top.floor && state) {
      const sum = state.floors ?? [];
      const humansThere = sum.find((f) => f.n === top.floor)?.humans ?? 0;
      const humansHere = sum.find((f) => f.n === slotFloor[visible])?.humans ?? 0;
      if (humansThere > 0 || (humansHere === 0 && top.floor >= (slotFloor[visible] ?? 0)) || top.score + top.floor >= 20) switchTo(other); // vrais joueurs d'abord, puis vers le bas, sauf gros moment ailleurs
    }
    if (state) pickFloor(state);
  } else if (m.type === 'chat' && m.cmd && m.ok !== undefined) {
    chatLine(m.from, m.text, { ok: m.ok, reply: m.reply ?? '' }, m.src === 'twitch');
  } else if (m.type === 'feedback' && !m.ok) {
    const lm = document.getElementById('load-msg');
    if (lm) lm.textContent = m.text + ' Add ?cle=<control-room key> to the address.';
  }
}

/**
 * Chat en direct, écrit en transparence sur le voile de droite : les messages, et les commandes avec
 * leur verdict (✓ passée, ✗ refusée + pourquoi), pour que le joueur Twitch sache où il en est.
 * Les lignes s'effacent au bout de 2 minutes : quand le chat est calme, l'image reste propre.
 */
const CHAT_MAX = 14;
const CHAT_TTL = 120_000;
const chatHue = new Map<string, number>();
function hueOf(name: string) {
  if (!chatHue.has(name)) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
    chatHue.set(name, h);
  }
  return chatHue.get(name)!;
}
function chatLine(from: string, text: string, cmd?: { ok: boolean; reply: string }, twitch = false) {
  const list = $('chat-list');
  const row = document.createElement('div');
  const bot = !!state?.leaderboard.find((r) => r.name === from && r.bot);
  row.className = `m${cmd ? (cmd.ok ? ' ok' : ' ko') : ''}${twitch ? ' tw' : ''}${bot ? ' pnj' : ''}`;
  row.dataset.t = String(Date.now());
  const name = `<b style="color:hsl(${hueOf(from)} 70% ${bot ? 66 : 74}%)">${esc(from)}</b>`;
  if (cmd) {
    const why = !cmd.ok && cmd.reply ? `<span class="why">${esc(cmd.reply)}</span>` : '';
    row.innerHTML = `${name} <code>${esc(text.slice(0, 50))}</code> <span class="v">${cmd.ok ? '✓' : '✗'}</span>${why}`;
  } else row.innerHTML = `${name} ${esc(text)}`;
  list.append(row);
  while (list.children.length > CHAT_MAX) list.firstElementChild!.remove();
  list.classList.toggle('full', list.scrollHeight > list.clientHeight + 2);
}
setInterval(() => {
  const now = Date.now();
  for (const el of [...$('chat-list').children] as HTMLElement[]) if (now - Number(el.dataset.t) > CHAT_TTL) el.remove();
  $('chat').classList.toggle('empty', $('chat-list').children.length === 0);
  $('chat-list').classList.toggle('full', $('chat-list').scrollHeight > $('chat-list').clientHeight + 2);
}, 2000);

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
// ------------------------------------------------------------------ son
// Le stream a sa bande-son : les effets de ce qui est à l'image, les grands moments, une ambiance discrète.
// ?muet : aucun son ; ?sansambiance : effets seulement ; ?volume=0.5 : volume général (0 à 1) ;
// ?sansmusique : pas de musique ; ?musique=0.5 : volume de la musique (0 à 1).
const FX_SOUND: Record<string, Parameters<typeof sfx.play>[0]> = {
  hit: 'hit', crit: 'crit', miss: 'miss', gag: 'gag', death: 'death', kill: 'kill', loot: 'coin', levelup: 'levelup', trap: 'trap', heal: 'heal', forge: 'forge', rumble: 'rumble',
};
const soundOn = !params.has('muet');
function initSound() {
  if (!soundOn) return;
  const vol = Number(params.get('volume'));
  sfx.setVolume(Number.isFinite(vol) && vol > 0 ? Math.min(1, vol) * 0.45 : 0.45);
  sfx.setMuted(false);
  // OBS / Streamlabs autorisent le son sans clic ; dans un navigateur ordinaire, il démarre au premier clic
  const mv = Number(params.get('musique'));
  const music = params.has('sansmusique') ? null : new Music(Number.isFinite(mv) && mv > 0 ? Math.min(1, mv) : 0.5);
  const loaded = music?.load();
  const start = () => {
    sfx.unlock();
    if (sfx.running && !params.has('sansambiance')) sfx.ambience(true, music ? 0.45 : 0.8); // sous la musique, l'ambiance se fait discrète
  };
  // Musique adaptative : ce que montre la caméra décide de l'ambiance
  if (music)
    void loaded?.then(() =>
      setInterval(() => {
        const w = worlds[visible];
        if (w) music.set(pickMood({ seasonOver: state?.seasonOver, floor: w.floor, room: w.shotRoom }));
      }, 1000),
    );
  start();
  const retry = setInterval(() => {
    start();
    if (sfx.running) clearInterval(retry);
  }, 1000);
  addEventListener('pointerdown', start);
  for (const w of worlds) w.onSound = (kind, v) => {
    if (w !== worlds[visible]) return; // seulement l'étage à l'écran
    const name = FX_SOUND[kind];
    if (name) sfx.play(name, v);
  };
}
const cue = (name: Parameters<typeof sfx.play>[0], v = 1) => soundOn && sfx.play(name, v);
let lastVoteKey = '';
let lastBetKey = '';
let bellFloor = -1;

function showCard(n: number | string, sub: string) {
  cue(typeof n === 'number' ? 'whoosh' : 'fanfare', 0.8);
  const card = $('card');
  card.querySelector('.c1')!.textContent = typeof n === 'number' ? `Floor ${n}` : n;
  card.querySelector('.c2')!.textContent = sub;
  card.classList.remove('hidden');
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';
  clearTimeout(cardTimer);
  cardTimer = window.setTimeout(() => card.classList.add('hidden'), 2700);
}

/** Les deux étages les plus intéressants restent chargés (vrais joueurs d'abord, puis l'action) ; on montre le meilleur. */
function pickFloor(s: PlayerViewMsg) {
  const floors = s.floors ?? [];
  const occupied = floors.filter((f) => f.humans + f.bots > 0);
  if (!occupied.length) return;
  const now = performance.now();
  // Les vrais joueurs d'abord ; puis la course en tête : chaque étage plus profond vaut +2, le front (l'étage le plus
  // profond occupé) +6. Le nombre de PNJ compte peu (les retardataires qui meurent en boucle en haut ne volent plus la caméra).
  const front = Math.max(...occupied.map((f) => f.n));
  const score = (f: { n: number; humans: number; bots: number }) =>
    f.humans * 8 + Math.min(f.bots, 4) * 1.5 + Math.min(heatOf(f.n, now), 30) * 0.5 + (f.n - 1) * 2 + (f.n === front ? 6 : 0);
  const ranked = [...occupied].sort((a, b) => score(b) - score(a)).slice(0, 2).map((f) => f.n);
  let changed = false;
  // On garde les scènes déjà chargées sur un étage voulu ; on recharge la scène cachée en priorité
  for (const n of ranked) {
    if (slotFloor.includes(n)) continue;
    const free = [1 - visible, visible].find((i) => slotFloor[i] === null || !ranked.includes(slotFloor[i]!));
    if (free === undefined) continue;
    slotFloor[free] = n;
    changed = true;
  }
  // L'étage visible n'est plus intéressant (vide, effondré) : on montre le meilleur
  if (!ranked.includes(slotFloor[visible]!) || !occupied.some((f) => f.n === slotFloor[visible])) {
    const best = slotFloor.indexOf(ranked[0]);
    if (best >= 0 && best !== visible) {
      visible = best;
      changed = true;
      const f = floors.find((x) => x.n === ranked[0]);
      if (f) showCard(f.n, [f.humans ? `${f.humans} adventurer${f.humans > 1 ? 's' : ''}` : '', f.bots ? `${f.bots} NPC${f.bots > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') + ` · ${THEME_LABEL[f.theme] ?? f.theme}`);
    }
  }
  if (changed || slotFloor[visible] !== wantedFloor) requestFloors();
}

/** Dit au serveur quels étages envoyer : le visible et celui gardé chargé. */
function requestFloors() {
  const n = slotFloor[visible];
  if (n === null) return;
  wantedFloor = n;
  floorSince = performance.now();
  const sb = slotFloor[1 - visible];
  send({ type: 'floor', n, ...(sb !== null ? { standby: sb } : {}) });
}

/** Bascule instantanée vers l'autre étage chargé. */
function switchTo(i: number) {
  if (i === visible || slotFloor[i] === null) return;
  visible = i;
  applyVisible();
  requestFloors();
  $('shot').textContent = `Floor ${slotFloor[i]}`;
}

function applyVisible() {
  world = worlds[visible];
  $('c').classList.toggle('off', visible !== 0);
  $('labels').classList.toggle('off', visible !== 0);
  $('c2').classList.toggle('off', visible !== 1);
  $('labels2').classList.toggle('off', visible !== 1);
}

/** Vue (et fin de tour) de l'étage visible, que le serveur l'ait envoyé comme principal ou comme second. */
function shown(s: PlayerViewMsg): { floor: PlayerViewMsg['floor']; turnEndsAt: number } {
  if (s.standby && s.standby.n === slotFloor[visible]) return { floor: s.standby, turnEndsAt: s.standbyTurnEndsAt ?? s.turnEndsAt };
  return { floor: s.floor, turnEndsAt: s.turnEndsAt };
}

// ------------------------------------------------------------------ habillage

function renderHud(s: PlayerViewMsg) {
  const f = shown(s).floor;
  const alive = s.leaderboard.filter((r) => r.alive).length;
  $('meta').innerHTML = f ? `Floor <b>${f.n}</b> · ${esc(THEME_LABEL[f.theme] ?? f.theme)} · <b>${alive}</b> crawlers alive` : '—';
  $('pause').classList.toggle('hidden', !s.paused || !!s.seasonOver);
  // Fin de saison : écran final avec les Légendes de la saison
  if (s.seasonOver) {
    const champs = s.champions ?? [];
    $('season').classList.remove('hidden');
    $('season-sub').textContent = champs.length ? `${champs.length} legend${champs.length > 1 ? 's' : ''} this season` : 'Nobody got out: the Dungeon wins.';
    $('season-list').innerHTML = champs.slice(0, 10).map((c) => `<div class="lg"><b>${esc(c.name)}${c.bot ? ' <small>(NPC)</small>' : ''}</b><span>lvl ${c.level} · ${c.kills} monsters · ${c.deaths} deaths</span></div>`).join('');
  } else $('season').classList.add('hidden');
  // Les étages : qui est où, et combien de temps avant l'effondrement
  if (s.floors && s.floors.length > 1) {
    $('floors').classList.remove('hidden');
    $('floors').innerHTML = '<h3>Floors</h3>' + s.floors.map((x) => {
      const who = [x.humans ? `${x.humans} ⚔` : '', x.bots ? `${x.bots} NPC` : ''].filter(Boolean).join(' · ') || 'empty';
      const t = x.collapseInSec === null ? '—' : `${x.stairsInSec ? '🔒' : '🔓'} ${fmt(x.collapseInSec)}`;
      return `<div class="f ${x.n === f?.n ? 'on' : ''}"><span class="n">Floor ${x.n}</span><span class="w">${who}</span><span class="t ${x.collapseInSec !== null && x.collapseInSec < 60 ? 'urgent' : ''}">${t}</span></div>`;
    }).join('');
  } else $('floors').classList.add('hidden');
  // Classement
  $('lb').innerHTML = `<h3>Leaderboard</h3>` + s.leaderboard.slice(0, 6).map((r, i) => `<div class="r ${r.alive ? '' : 'dead'}"><span class="k">${i + 1}</span><span class="nm">${esc(r.name)}${r.bot ? ' <small style="opacity:.6">NPC</small>' : ''}${r.bounty ? ' <small style="color:var(--gold)">bounty</small>' : ''}${r.traitor ? ' <small style="color:var(--pink)">traitor</small>' : ''}</span><span class="s">lvl ${r.level} · fl. ${r.deepest} · ${r.kills} kills</span></div>`).join('');
  // Vote
  const v = s.vote;
  const voteKey = v ? `${v.title ?? ''}|${v.options.map((o) => o.key).join(',')}` : '';
  if (voteKey && voteKey !== lastVoteKey) cue('horn', 0.8);
  lastVoteKey = voteKey;
  $('vote').classList.toggle('hidden', !v);
  if (v) $('vote').innerHTML = `<div class="t">${v.title ? `${esc(v.title)}: !vote &lt;#&gt;, ${v.turnsLeft} turn(s) left` : `Vote in chat, ${v.turnsLeft} turn(s) left`}</div>` + v.options.map((o) => `<div class="o"><span class="n">${o.votes}</span><b>!vote ${o.n} · ${esc(o.label)}</b><small>${esc(o.desc)}</small></div>`).join('');
  // Pari éclair, grand pari et meilleurs parieurs
  const b = s.bet;
  const betKey = b ? b.title : '';
  if (betKey && betKey !== lastBetKey) cue('coin', 0.9);
  lastBetKey = betKey;
  $('bet').classList.toggle('hidden', !b && !s.grandBet?.open);
  if (b) {
    const tot = Math.max(1, b.oui + b.non);
    $('bet').innerHTML = `<div class="t">Flash bet${b.closesInSec ? `: ${b.closesInSec} s to bet` : ': bets closed'}</div><div class="q">${esc(b.title)}</div>
      <div class="bar"><span class="oui" style="width:${(100 * b.oui) / tot}%">yes ${b.oui}</span><span class="non" style="width:${(100 * b.non) / tot}%">no ${b.non}</span></div>
      <small>!bet yes &lt;amount&gt; · !bet no &lt;amount&gt; · ${b.bettors} bettor(s)</small>`;
  } else if (s.grandBet?.open) {
    $('bet').innerHTML = `<div class="t">Big bet: who gets out first?</div><div class="q">Pot: ${s.grandBet.pot} pts${s.grandBet.top.length ? ' · ' + s.grandBet.top.map((x) => `${esc(x.name)} ${x.pot}`).join(' · ') : ''}</div><small>!bet &lt;name&gt; &lt;amount&gt; · !sponsor &lt;name&gt; potion|gold|monster</small>`;
  }
  // Appel à jouer
  const tips = s.joinsClosed ? [
    'The gates are sealed: <b>!bet</b> on who survives',
    '<b>!sponsor &lt;name&gt; potion</b> to help a crawler (or <b>monster</b> to troll them)',
    'After each collapse, chat votes to bring one of the dead back: <b>!vote &lt;#&gt;</b>',
    s.effects.bounty ? `Bounty on <b>${esc(s.effects.bounty.target)}</b>: ${s.effects.bounty.gold} gold` : 'Attacking an ally = betrayal (and everyone will know)',
  ] : [
    'Type <b>!join</b> in chat to enter the dungeon',
    'Classes: <b>!join barbarian</b>, <b>knight</b>, <b>rogue</b> or <b>mage</b>',
    s.publicUrl ? 'On the map page, your Twitch name + <b>!link</b> in chat: you control your character' : 'One command per turn: the last one typed counts',
    s.effects.bounty ? `Bounty on <b>${esc(s.effects.bounty.target)}</b>: ${s.effects.bounty.gold} gold` : 'Attacking an ally = betrayal (and everyone will know)',
  ];
  const tip = tips[Math.floor(Date.now() / 8000) % tips.length];
  $('cta').innerHTML = s.publicUrl
    ? `<div class="url">Your own map: <b>${esc(s.publicUrl.replace(/^https:\/\//, ''))}</b> <small>(use your Twitch name)</small></div><div>${tip}</div>`
    : tip;
}

let ltTimer = 0;
let iaTimer = 0;
function onEvent(e: GameEvent) {
  const isIa = !!(e as GameEvent & { narrator?: boolean }).narrator;
  if (isIa && !voicePlaying && !voiceTexts.includes(e.text)) {
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
    const view = shown(state);
    const left = Math.max(0, (view.turnEndsAt - now) / 1000);
    $('turn').textContent = `Turn ${state.turn} · ${Math.ceil(left)} s`;
    $('turn-bar').style.width = `${100 - (100 * left) / state.turnSeconds}%`;
    const se = state.seasonEndsInSec;
    if (se !== null && se !== undefined) {
      const r = Math.max(0, se - (now - state.serverNow) / 1000);
      const h = Math.floor(r / 3600);
      $('season-left').innerHTML = `Season ends in <b>${h ? `${h}:${String(Math.floor((r % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(r % 60)).padStart(2, '0')}` : fmt(r)}</b>`;
    } else $('season-left').textContent = '';
    const c = view.floor?.collapseInSec;
    const lobby = state.lobbyInSec;
    if (lobby !== null && lobby !== undefined) {
      const rest = Math.max(0, lobby - (now - state.serverNow) / 1000);
      $('collapse').textContent = `The game starts in ${fmt(rest)}: type !join`;
    } else if (c !== null && c !== undefined) {
      const elapsed = (now - state.serverNow) / 1000;
      const rest = Math.max(0, c - elapsed);
      const st = view.floor?.stairsInSec;
      const seal = st !== null && st !== undefined ? Math.max(0, st - elapsed) : 0;
      $('collapse').textContent = seal > 0 ? `🔒 Stairs sealed ${fmt(seal)} · collapse ${fmt(rest)}` : `🔓 Stairs open · collapse in ${fmt(rest)}`;
      $('collapse').classList.toggle('urgent', rest < 60);
      // la cloche sonne une fois quand l'étage affiché entre dans sa dernière minute
      const fn = view.floor?.n ?? -1;
      if (rest < 60 && rest > 50 && bellFloor !== fn) {
        bellFloor = fn;
        cue('bell', 0.9);
      }
    } else $('collapse').textContent = view.floor ? 'Timer waiting for an adventurer' : '';
  }
}

// ------------------------------------------------------------------ démarrage
(async () => {
  if (!key) {
    $('load-msg').textContent = 'The control-room key is missing: open /stream.html?cle=<key> (it is shown when the server starts).';
    return;
  }
  await assets.load((d, t) => {
    $('load-bar').style.width = `${(100 * d) / t}%`;
  });
  World.light = params.has('leger');
  worlds.push(new World($('c') as HTMLCanvasElement, $('labels'), assets), new World($('c2') as HTMLCanvasElement, $('labels2'), assets));
  initSound();
  world = worlds[0];
  for (const w of worlds) {
    if (follow) w.followName = follow;
    w.onShot = (label) => {
      if (w === world) $('shot').textContent = label;
    };
  }
  if (params.has('debug')) Object.assign(window as unknown as Record<string, unknown>, { world: worlds[0], worlds, switchTo, sfx });
  // Le HUD est dessiné pour du 1920×1080 : on le réduit dans une fenêtre plus petite
  const ui = document.querySelector('.ui') as HTMLElement;
  const resize = () => {
    for (const w of worlds) w.resize(innerWidth, innerHeight);
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
      if (++loopErrors <= 5) console.error('[stream] frame not rendered', e); // la télémétrie remonte l'erreur au journal
    } finally {
      requestAnimationFrame(loop);
    }
  };
  requestAnimationFrame(loop);
})();
