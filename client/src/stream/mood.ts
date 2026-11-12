// Quelle ambiance musicale pour ce que montre la caméra (sans dépendance au son : testable).
import type { FloorView, RoomView } from '../../../src/shared/types';

export type Mood = 'lobby' | 'explore' | 'tension' | 'boss' | 'safe' | 'crypt' | 'finale';

/** Ambiance de remplacement quand une ambiance n'a pas (encore) de morceau. */
export const FALLBACK: Record<Mood, Mood | null> = {
  lobby: 'explore',
  explore: null,
  tension: 'explore',
  boss: 'tension',
  safe: 'explore',
  crypt: 'explore',
  finale: 'lobby',
};

/** Ce que la caméra montre → l'ambiance. Fonction pure (testée). */
export function pickMood(s: { seasonOver?: boolean; floor: FloorView | null; room?: RoomView }): Mood {
  if (s.seasonOver) return 'finale';
  const f = s.floor;
  if (!f || f.collapseInSec === null) return 'lobby';
  if (f.collapseInSec <= 90) return 'tension';
  const r = s.room;
  if (r?.type === 'boss' && r.bossAlive && (r.players?.length ?? 0) > 0) return 'boss';
  if (r?.merchant || r?.forge) return 'safe';
  if (r?.crypt) return 'crypt';
  if (f.stairsInSec === 0 && f.collapseInSec <= 240) return 'tension';
  return 'explore';
}

