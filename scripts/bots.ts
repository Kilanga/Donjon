// Bots de test : se connectent au serveur comme de vrais joueurs et jouent au hasard.
// Usage : npm run bots -- [nombre=6] [adresse=ws://localhost:3000/ws]
import WebSocket from 'ws';
import type { PlayerViewMsg, ServerMsg } from '../src/shared/types.js';

const n = Number(process.argv[2] ?? 6);
const url = process.argv[3] ?? 'ws://localhost:3000/ws';
const classes = ['barbare', 'chevalier', 'voleur', 'mage'];
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const DIRS: Record<string, string> = { n: '!nord', s: '!sud', e: '!est', o: '!ouest' };

for (let i = 0; i < n; i++) {
  const name = `Bot_${['Gérard', 'Josiane', 'Kevin', 'Sylvie', 'Momo', 'Lulu', 'Titou', 'Nadine', 'Bernard', 'Chantal'][i % 10]}${i >= 10 ? i : ''}`;
  const ws = new WebSocket(url);
  let lastTurn = -1;
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', name })));
  ws.on('message', (data) => {
    const m = JSON.parse(String(data)) as ServerMsg;
    if (m.type !== 'state') return;
    const s = m as PlayerViewMsg;
    if (!s.me) {
      ws.send(JSON.stringify({ type: 'cmd', text: `!join ${pick(classes)}` }));
      return;
    }
    if (s.turn === lastTurn || !s.me.alive || !s.floor) return;
    lastTurn = s.turn;
    setTimeout(() => act(ws, s), 300 + Math.random() * 1500);
  });
}

function act(ws: WebSocket, s: PlayerViewMsg) {
  const me = s.me!;
  const room = s.floor!.rooms.find((r) => r.current)!;
  const say = (text: string) => ws.send(JSON.stringify({ type: 'cmd', text }));
  if (me.statPoints) say(`!monte ${pick(['for', 'agi', 'int', 'cha'])}`);
  for (const inv of me.pendingAllianceFrom) if (Math.random() < 0.6) say(`!alliance ${inv}`);
  const others = (room.players ?? []).filter((p) => !p.me && p.alive);
  if (others.length && Math.random() < 0.05) say(`!alliance ${pick(others).name}`);
  const potion = me.items.findIndex((i) => i.tpl === 'potion' || i.tpl === 'grande_potion');
  if (me.hp < me.maxHp * 0.4 && potion >= 0) return say(`!utilise ${potion + 1}`);
  if ((room.monsters ?? []).length) return say('!attaque');
  const prey = others.find((o) => !o.immune && (o.ally ? Math.random() < 0.08 : Math.random() < 0.2));
  if (prey && room.type !== 'safe' && me.immuneSeconds === 0) return say(`!attaque ${prey.name}`);
  if ((room.ground ?? []).length || room.groundGold) return say('!ramasse');
  if (room.type === 'safe' && me.hp < me.maxHp) return say('!repos');
  if (room.stairs && !room.bossAlive) return say('!descendre');
  if (room.chest === 'ferme' || (!room.searched && room.type === 'normale' && Math.random() < 0.3)) return say('!fouille');
  const known = new Set(s.floor!.rooms.map((r) => r.id));
  const doors = Object.entries(room.doors);
  const fresh = doors.filter(([, id]) => !known.has(id!));
  const [d] = fresh.length && Math.random() < 0.8 ? pick(fresh) : pick(doors);
  say(DIRS[d]);
}
