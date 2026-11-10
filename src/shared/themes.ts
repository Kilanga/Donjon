// Thèmes d'étage : chacun change une règle (les effets sont appliqués par le moteur).
export const THEME_EFFECTS: Record<string, string> = {
  classique: '',
  'inondé': 'Sol glissant : un déplacement sur trois finit à plat ventre.',
  'en feu': 'Des braises jaillissent du sol : on peut se brûler à chaque tour (hors safe room).',
  'plongé dans le noir': 'On y voit mal : −2 pour toucher pour tout le monde, mais fuir est plus facile.',
  'moisi': 'La moisissure nourrit les monstres : ils regagnent 1 PV par tour.',
  'hanté': 'Des fantômes chapardeurs volent un peu d\'or et vont le cacher ailleurs.',
};
