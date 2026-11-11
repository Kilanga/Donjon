// Les événements que « la production » soumet au vote des joueurs.

export interface ProductionEvent {
  key: string;
  label: string;
  desc: string;
}

export const PRODUCTION_EVENTS: ProductionEvent[] = [
  { key: 'pluie_or', label: 'Gold rain', desc: 'Piles of gold fall from the ceiling into random rooms.' },
  { key: 'lacher_monstres', label: 'Monster release', desc: 'Production lets loose a batch of wandering monsters.' },
  { key: 'happy_hour', label: 'Merchant fair', desc: 'Merchants at −50% and restocked for 10 turns.' },
  { key: 'resurrection', label: 'Mass resurrection', desc: 'Every dead crawler comes back right away.' },
  { key: 'prime', label: 'Bounty on the top killer', desc: 'A gold bounty on the head of the crawler with the most kills.' },
  { key: 'inondation', label: 'Flood', desc: 'For 5 turns, the whole dungeon is knee-deep: −1 Dexterity, hidden traps, drifting loot.' },
  { key: 'festin', label: 'Feast', desc: 'Every living crawler gets their HP back.' },
  { key: 'pieges_promo', label: 'Traps galore', desc: 'Every trap re-arms, and one more room per floor is trapped.' },
  { key: 'prolongation', label: 'Overtime', desc: 'Floors hold for 3 more minutes.' },
  { key: 'acceleration', label: 'Speed-up', desc: 'Floors collapse 2 minutes earlier. For the show.' },
];

export const PRODUCTION_BY_KEY: Record<string, ProductionEvent> = Object.fromEntries(PRODUCTION_EVENTS.map((e) => [e.key, e]));
