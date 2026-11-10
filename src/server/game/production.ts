// Les événements que « la production » soumet au vote des joueurs.

export interface ProductionEvent {
  key: string;
  label: string;
  desc: string;
}

export const PRODUCTION_EVENTS: ProductionEvent[] = [
  { key: 'pluie_or', label: 'Pluie d\'or', desc: 'Des tas d\'or tombent du plafond dans des salles au hasard.' },
  { key: 'lacher_monstres', label: 'Lâcher de monstres', desc: 'La production libère une fournée de monstres errants.' },
  { key: 'happy_hour', label: 'Happy hour', desc: 'Marchands à −50 % et réapprovisionnés pendant 10 tours.' },
  { key: 'resurrection', label: 'Résurrection générale', desc: 'Tous les morts reviennent immédiatement.' },
  { key: 'prime', label: 'Prime sur le meilleur tueur', desc: 'Une prime en or sur la tête du crawler qui a le plus de kills.' },
  { key: 'inondation', label: 'Inondation', desc: 'Pendant 5 tours, on glisse : 1 déplacement sur 3 échoue.' },
  { key: 'festin', label: 'Festin', desc: 'Tous les crawlers vivants récupèrent leurs PV.' },
  { key: 'pieges_promo', label: 'Pièges en promo', desc: 'Tous les pièges se réarment, et de nouveaux apparaissent.' },
  { key: 'prolongation', label: 'Prolongation', desc: 'Les étages tiennent 3 minutes de plus.' },
  { key: 'acceleration', label: 'Accélération', desc: 'Les étages s\'effondrent 2 minutes plus tôt. Pour le spectacle.' },
];

export const PRODUCTION_BY_KEY: Record<string, ProductionEvent> = Object.fromEntries(PRODUCTION_EVENTS.map((e) => [e.key, e]));
