// Floor themes: each one changes a rule (the engine applies the effects).
// The keys stay in French (saves, internal comparisons); THEME_LABEL is what players see.
export const THEME_LABEL: Record<string, string> = {
  classique: 'classic',
  'inondé': 'flooded',
  'en feu': 'on fire',
  'plongé dans le noir': 'pitch black',
  'moisi': 'moldy',
  'hanté': 'haunted',
};

export const THEME_EFFECTS: Record<string, string> = {
  classique: '',
  'inondé': 'Knee-deep water: −1 Dexterity outside safe rooms, traps are hidden under the surface, and loot drifts from room to room.',
  'en feu': 'Embers burst from the floor: you can get burned every turn (outside safe rooms).',
  'plongé dans le noir': 'Hard to see: −2 to hit for everyone, but running away is easier.',
  'moisi': 'The mold feeds the monsters: they regain 1 HP per turn.',
  'hanté': 'Thieving ghosts steal a bit of gold and hide it somewhere else.',
};
