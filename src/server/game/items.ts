import type { Item, Rarity } from '../../shared/types.js';
import { ITEMS, ITEM_BY_TPL, RARITY_WEIGHTS } from './data.js';
import type { Rng } from './rng.js';

export function makeItem(tpl: string, nextId: () => string): Item {
  const t = ITEM_BY_TPL[tpl];
  if (!t) throw new Error(`Objet inconnu : ${tpl}`);
  const item: Item = { id: nextId(), tpl: t.tpl, name: t.name, kind: t.kind, rarity: t.rarity, value: t.value, desc: t.desc, sprite: t.sprite };
  if (t.dmg !== undefined) item.dmg = t.dmg;
  if (t.hit !== undefined) item.hit = t.hit;
  if (t.def !== undefined) item.def = t.def;
  return item;
}

/** Tire un objet au hasard selon les raretés ; la profondeur améliore un peu les chances. */
export function randomLoot(rng: Rng, nextId: () => string, floorN: number, shopOnly = false, minRarity?: Rarity): Item {
  const order: Rarity[] = ['commun', 'rare', 'epique', 'legendaire'];
  const weights = RARITY_WEIGHTS.map(([r, w], i) => [r, i === 0 ? Math.max(20, w - (floorN - 1) * 8) : w + (floorN - 1) * i] as [Rarity, number]);
  let rarity = rng.weighted(weights);
  if (minRarity && order.indexOf(rarity) < order.indexOf(minRarity)) rarity = minRarity;
  const candidates = ITEMS.filter((i) => i.tpl !== 'poings' && (!shopOnly || i.shop));
  let pool = candidates.filter((i) => i.rarity === rarity);
  for (let k = order.indexOf(rarity); pool.length === 0 && k >= 0; k--) pool = candidates.filter((i) => i.rarity === order[k]);
  return makeItem(rng.pick(pool).tpl, nextId);
}

export function itemEffect(item: Item): string | undefined {
  return ITEM_BY_TPL[item.tpl]?.effect;
}
