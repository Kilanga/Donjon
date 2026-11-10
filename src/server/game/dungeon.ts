// Génération procédurale d'un étage : salles sur une grille, reliées par des portes.
import type { Dir, RoomType } from '../../shared/types.js';
import { BOSSES, MIMIC, MONSTERS, ROOM_DESCRIPTIONS, THEMES, type MonsterTpl } from './data.js';
import { makeItem, randomLoot } from './items.js';
import type { Rng } from './rng.js';
import type { FloorState, MonsterState, RoomState } from './state.js';

export const DIRS: Dir[] = ['n', 's', 'e', 'o'];
export const DELTA: Record<Dir, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], o: [-1, 0] };
export const OPPOSITE: Record<Dir, Dir> = { n: 's', s: 'n', e: 'o', o: 'e' };
export const DIR_LABEL: Record<Dir, string> = { n: 'nord', s: 'sud', e: 'est', o: 'ouest' };

export function generateFloor(n: number, roomCount: number, rng: Rng, nextId: () => string): FloorState {
  const count = Math.max(4, roomCount);
  const W = Math.ceil(Math.sqrt(count * 1.6));
  const H = Math.ceil((count * 1.6) / W);
  const grid = new Map<string, RoomState>();
  const rooms: RoomState[] = [];
  const at = (x: number, y: number) => grid.get(`${x},${y}`);

  const addRoom = (x: number, y: number): RoomState => {
    const r: RoomState = {
      id: rooms.length, x, y, type: 'normale', doors: {}, desc: '', searchedBy: null, chest: 'aucun', mimic: false,
      trapArmed: false, trapRevealed: false, merchant: [], stairs: false, ground: [], groundGold: 0,
    };
    rooms.push(r);
    grid.set(`${x},${y}`, r);
    return r;
  };
  const link = (a: RoomState, b: RoomState, d: Dir) => {
    a.doors[d] = b.id;
    b.doors[OPPOSITE[d]] = a.id;
  };

  // Croissance aléatoire depuis le centre : donne un arbre de salles connexe.
  addRoom(Math.floor(W / 2), Math.floor(H / 2));
  let guard = 0;
  while (rooms.length < count && guard++ < count * 200) {
    const from = rng.pick(rooms);
    const d = rng.pick(DIRS);
    const [dx, dy] = DELTA[d];
    const x = from.x + dx;
    const y = from.y + dy;
    if (x < 0 || y < 0 || x >= W || y >= H || at(x, y)) continue;
    link(from, addRoom(x, y), d);
  }
  // Quelques boucles en plus pour éviter les culs-de-sac à répétition.
  for (const r of rooms) {
    for (const d of ['e', 's'] as Dir[]) {
      const [dx, dy] = DELTA[d];
      const nb = at(r.x + dx, r.y + dy);
      if (nb && r.doors[d] === undefined && rng.chance(0.18)) link(r, nb, d);
    }
  }

  // Entrée = safe room ; boss = salle la plus éloignée.
  const spawn = rooms[0];
  const dist = bfs(rooms, spawn.id);
  const boss = rooms.reduce((best, r) => (dist[r.id] > dist[best.id] ? r : best), spawn);
  const setType = (r: RoomState, t: RoomType) => (r.type = t);
  setType(spawn, 'safe');
  setType(boss, 'boss');
  boss.stairs = true;

  const free = () => rng.shuffle(rooms.filter((r) => r.type === 'normale'));
  if (count >= 30) {
    const far = free().sort((a, b) => dist[b.id] - dist[a.id])[Math.floor(count / 6)];
    if (far) setType(far, 'safe');
  }
  const arena = free()[0];
  if (arena) setType(arena, 'arene');
  const treasures = Math.max(1, Math.round(count / 20));
  for (const r of free().slice(0, treasures)) {
    setType(r, 'tresor');
    r.chest = 'ferme';
    r.mimic = rng.chance(0.25);
  }
  for (const r of free().slice(0, Math.round(count / 6))) {
    setType(r, 'piege');
    r.trapArmed = true;
  }

  const floor: FloorState = {
    n, theme: n === 1 ? 'classique' : rng.pick(THEMES.slice(1)), rooms, monsters: [], spawnRoom: spawn.id, bossRoom: boss.id,
    startedAt: null, collapseAt: null, collapsed: false,
  };

  for (const r of rooms) {
    r.desc = rng.pick(ROOM_DESCRIPTIONS[r.type]);
    if (r.type === 'safe') r.merchant = merchantStock(n, rng, nextId);
  }

  // Monstres
  const pool = MONSTERS.filter((m) => m.minFloor <= n);
  const fixed = pool.filter((m) => !m.wanderer);
  const wanderers = pool.filter((m) => m.wanderer);
  for (const r of rooms) {
    if (r.type === 'normale' && dist[r.id] > 1 && rng.chance(n === 1 ? 0.5 : 0.6)) {
      const k = rng.int(1, n >= 3 ? 3 : n === 2 ? 2 : 1); // étage 1 : un monstre par salle
      for (let i = 0; i < k; i++) floor.monsters.push(spawnMonster(rng.pick(fixed), n, r.id, rng, nextId));
    }
    if (r.type === 'tresor' && rng.chance(0.6)) floor.monsters.push(spawnMonster(rng.pick(fixed), n, r.id, rng, nextId));
    if (r.type === 'arene') floor.monsters.push(spawnMonster(rng.pick(fixed), n + 1, r.id, rng, nextId));
  }
  floor.monsters.push(spawnMonster(rng.pick(BOSSES), n, boss.id, rng, nextId));
  const normals = rooms.filter((r) => r.type === 'normale' && dist[r.id] > 1);
  const nWander = Math.max(2, Math.round(count / 8));
  for (let i = 0; i < nWander && normals.length; i++) {
    floor.monsters.push(spawnMonster(rng.pick(wanderers), n, rng.pick(normals).id, rng, nextId));
  }
  return floor;
}

export function spawnMonster(tpl: MonsterTpl, floorN: number, roomId: number, rng: Rng, nextId: () => string): MonsterState {
  const f = Math.max(0, floorN - 1);
  const hp = Math.round(tpl.hp * (1 + 0.25 * f));
  const [g0, g1] = tpl.gold;
  return {
    id: nextId(), kind: tpl.kind, name: rng.pick(tpl.names), sprite: tpl.sprite, hp, maxHp: hp,
    atk: tpl.atk + Math.ceil(f / 2), def: tpl.def + Math.floor(f / 2), dmg: tpl.dmg, xp: Math.round(tpl.xp * (1 + 0.5 * f)),
    gold: rng.int(g0, g1) * (1 + f), roomId, wanderer: !!tpl.wanderer, boss: !!tpl.boss, distracted: 0, aggro: null,
  };
}

export function spawnMimic(floorN: number, roomId: number, rng: Rng, nextId: () => string): MonsterState {
  return spawnMonster(MIMIC, floorN, roomId, rng, nextId);
}

function merchantStock(n: number, rng: Rng, nextId: () => string) {
  const stock = [makeItem('potion', nextId), makeItem('potion', nextId)];
  for (let i = 0; i < 4; i++) stock.push(randomLoot(rng, nextId, n, true));
  return stock;
}

export function bfs(rooms: RoomState[], start: number): number[] {
  const dist = rooms.map(() => Infinity);
  dist[start] = 0;
  const q = [start];
  while (q.length) {
    const id = q.shift()!;
    for (const nb of Object.values(rooms[id].doors)) {
      if (nb !== undefined && dist[nb] === Infinity) {
        dist[nb] = dist[id] + 1;
        q.push(nb);
      }
    }
  }
  return dist;
}
