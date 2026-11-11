// Données du jeu : classes, objets, monstres, textes. Tout est réglable ici.
import type { ClassId, ItemKind, Rarity, StatId, Stats } from '../../shared/types.js';

export interface ClassDef {
  id: ClassId;
  label: string;
  stats: Stats; // modificateurs de départ (total +3)
  hp: number; // PV de départ
  hpPerLevel: number;
  attackStat: StatId; // stat utilisée pour attaquer
  sprite: string;
  startWeapon: string;
  startArmor: string | null;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  barbare: { id: 'barbare', label: 'Barbarian', stats: { for: 3, agi: 0, int: -1, cha: 1 }, hp: 14, hpPerLevel: 6, attackStat: 'for', sprite: 'dwarf_m', startWeapon: 'hache_rouillee', startArmor: null },
  chevalier: { id: 'chevalier', label: 'Knight', stats: { for: 2, agi: 0, int: 0, cha: 1 }, hp: 12, hpPerLevel: 5, attackStat: 'for', sprite: 'knight_m', startWeapon: 'epee_courte', startArmor: 'tunique' },
  voleur: { id: 'voleur', label: 'Rogue', stats: { for: 0, agi: 3, int: 0, cha: 0 }, hp: 10, hpPerLevel: 4, attackStat: 'agi', sprite: 'elf_m', startWeapon: 'dague', startArmor: null },
  mage: { id: 'mage', label: 'Mage', stats: { for: -1, agi: 1, int: 3, cha: 0 }, hp: 10, hpPerLevel: 5, attackStat: 'int', sprite: 'wizzard_m', startWeapon: 'baton', startArmor: null },
};

export const STAT_LABELS: Record<StatId, string> = { for: 'Strength', agi: 'Dexterity', int: 'Intelligence', cha: 'Charisma' };

export const RARITY_LABEL: Record<Rarity, string> = { commun: 'common', rare: 'rare', epique: 'epic', legendaire: 'legendary' };
export const RARITY_WEIGHTS: [Rarity, number][] = [['commun', 60], ['rare', 28], ['epique', 10], ['legendaire', 2]];

export interface ItemTpl {
  tpl: string;
  name: string;
  kind: ItemKind;
  rarity: Rarity;
  value: number;
  dmg?: number;
  hit?: number;
  def?: number;
  desc: string;
  sprite: string;
  effect?: string; // pour les consommables et objets bizarres
  shop?: boolean; // vendu par les marchands
}

export const ITEMS: ItemTpl[] = [
  // Armes
  { tpl: 'poings', name: 'Bare fists', kind: 'arme', rarity: 'commun', value: 0, dmg: 3, desc: 'Free, always available.', sprite: 'ui_heart_full' },
  { tpl: 'dague', name: 'Rusty dagger', kind: 'arme', rarity: 'commun', value: 8, dmg: 4, hit: 1, desc: 'Small, precise, mildly tetanus-flavored.', sprite: 'weapon_knife', shop: true },
  { tpl: 'baton', name: 'Gnarled staff', kind: 'arme', rarity: 'commun', value: 8, dmg: 4, desc: 'Channels magic. And splinters.', sprite: 'weapon_green_magic_staff', shop: true },
  { tpl: 'epee_courte', name: 'Short sword', kind: 'arme', rarity: 'commun', value: 12, dmg: 6, desc: 'An honest sword for an adventurer who isn\'t.', sprite: 'weapon_rusty_sword', shop: true },
  { tpl: 'hache_rouillee', name: 'Woodcutter\'s axe', kind: 'arme', rarity: 'commun', value: 12, dmg: 6, desc: 'Still smells of pine.', sprite: 'weapon_axe', shop: true },
  { tpl: 'epee_longue', name: 'Knight\'s sword', kind: 'arme', rarity: 'rare', value: 35, dmg: 8, hit: 1, desc: 'Engraved "Property of Sir Somebody".', sprite: 'weapon_regular_sword', shop: true },
  { tpl: 'hache_guerre', name: 'War axe', kind: 'arme', rarity: 'rare', value: 35, dmg: 8, desc: 'Heavy, loud, effective.', sprite: 'weapon_waraxe', shop: true },
  { tpl: 'baton_rouge', name: 'Fire staff', kind: 'arme', rarity: 'rare', value: 35, dmg: 8, hit: 1, desc: 'Hot to the touch. Do not lick.', sprite: 'weapon_red_magic_staff', shop: true },
  { tpl: 'marteau', name: 'Hammer of the Furious Dwarf', kind: 'arme', rarity: 'epique', value: 90, dmg: 10, hit: 1, desc: 'Forged in anger. Crushes enemies and certainties alike.', sprite: 'weapon_big_hammer' },
  { tpl: 'epee_mousse', name: 'Legendary foam sword', kind: 'arme', rarity: 'legendaire', value: 200, dmg: 12, hit: 3, desc: 'Nobody understands why it hurts so much.', sprite: 'weapon_regular_sword' },
  // Armures
  { tpl: 'tunique', name: 'Holey tunic', kind: 'armure', rarity: 'commun', value: 8, def: 1, desc: 'The holes are decorative.', sprite: 'crate', shop: true },
  { tpl: 'cotte', name: 'Chainmail', kind: 'armure', rarity: 'rare', value: 30, def: 2, desc: 'Jingles like a bunch of keys. Constantly.', sprite: 'crate', shop: true },
  { tpl: 'plastron', name: 'Dented breastplate', kind: 'armure', rarity: 'epique', value: 80, def: 3, desc: 'Every dent has a story.', sprite: 'crate' },
  { tpl: 'pyjama', name: 'Dragon pajamas', kind: 'armure', rarity: 'legendaire', value: 200, def: 5, desc: 'Fireproof, cozy, intimidating.', sprite: 'crate' },
  // Consommables
  { tpl: 'potion', name: 'Small potion', kind: 'conso', rarity: 'commun', value: 10, desc: 'Restores 2d6+2 HP. Strawberry-rust flavor.', sprite: 'flask_red', effect: 'heal_small', shop: true },
  { tpl: 'grande_potion', name: 'Large potion', kind: 'conso', rarity: 'rare', value: 30, desc: 'Restores 4d6+4 HP.', sprite: 'flask_big_red', effect: 'heal_big', shop: true },
  { tpl: 'fumigene', name: 'Smoke bomb', kind: 'conso', rarity: 'rare', value: 25, desc: 'Guaranteed escape on your next move.', sprite: 'bomb_f0', effect: 'smoke', shop: true },
  { tpl: 'parchemin', name: 'Scroll of return', kind: 'conso', rarity: 'rare', value: 40, desc: 'Teleports you to the floor\'s safe room.', sprite: 'flask_blue', effect: 'teleport', shop: true },
  // Objets bizarres (effet unique)
  { tpl: 'poulet', name: 'Chicken. Just a chicken.', kind: 'bizarre', rarity: 'rare', value: 15, desc: 'Thrown into a room, distracts every monster for a turn.', sprite: 'flask_yellow', effect: 'chicken' },
  { tpl: 'coupon', name: 'Resurrection voucher (already stamped)', kind: 'bizarre', rarity: 'rare', value: 15, desc: 'On your next death, respawn 2 turns sooner.', sprite: 'flask_green', effect: 'coupon' },
  { tpl: 'ticket', name: 'Seven-sided die', kind: 'bizarre', rarity: 'commun', value: 1, desc: 'No effect. Nobody has ever managed to roll it.', sprite: 'flask_blue', effect: 'nothing' },
  { tpl: 'fromage', name: 'Stinky cheese', kind: 'bizarre', rarity: 'commun', value: 6, desc: 'Drives wandering monsters out of the room.', sprite: 'flask_yellow', effect: 'cheese' },
  { tpl: 'cape', name: 'Invisibility cloak (holey)', kind: 'bizarre', rarity: 'epique', value: 60, desc: '50% chance to dodge each attack for 3 turns.', sprite: 'flask_big_blue', effect: 'cloak' },
  { tpl: 'miroir', name: 'Pocket mirror', kind: 'bizarre', rarity: 'rare', value: 20, desc: '+3 to the next roll, after a good look at yourself.', sprite: 'flask_big_yellow', effect: 'mirror' },
  { tpl: 'canard', name: 'Whistling toad', kind: 'bizarre', rarity: 'commun', value: 4, desc: 'Whistles near traps. Reveals the ones in the room.', sprite: 'flask_big_yellow', effect: 'duck' },
  { tpl: 'couronne', name: 'Crown of the Goblin King', kind: 'bizarre', rarity: 'legendaire', value: 150, desc: 'Grants a level. Too small, but oh, the prestige.', sprite: 'flask_big_green', effect: 'crown' },
];

export const ITEM_BY_TPL: Record<string, ItemTpl> = Object.fromEntries(ITEMS.map((i) => [i.tpl, i]));

export interface MonsterTpl {
  kind: string;
  names: string[];
  sprite: string;
  hp: number;
  atk: number;
  def: number;
  dmg: number;
  xp: number;
  gold: [number, number];
  minFloor: number;
  wanderer?: boolean;
  boss?: boolean;
}

export const MONSTERS: MonsterTpl[] = [
  { kind: 'gobelin', names: ['Thieving goblin', 'Chipped-dagger goblin', 'Screaming goblin'], sprite: 'goblin_idle_anim', hp: 7, atk: 2, def: 1, dmg: 4, xp: 15, gold: [2, 6], minFloor: 1 },
  { kind: 'squelette', names: ['Creaky skeleton', 'Jawless skeleton', 'Skeleton of the old guard'], sprite: 'skelet_idle_anim', hp: 9, atk: 2, def: 2, dmg: 6, xp: 20, gold: [1, 5], minFloor: 1 },
  { kind: 'zombie', names: ['Rotten little zombie', 'Stunted ghoul'], sprite: 'tiny_zombie_idle_anim', hp: 8, atk: 1, def: 0, dmg: 4, xp: 12, gold: [0, 4], minFloor: 1, wanderer: true },
  { kind: 'diablotin', names: ['Cackling imp', 'Ember imp'], sprite: 'imp_idle_anim', hp: 5, atk: 3, def: 3, dmg: 3, xp: 12, gold: [1, 4], minFloor: 1, wanderer: true },
  { kind: 'limace', names: ['Giant slug', 'Acid ooze'], sprite: 'slug_anim', hp: 12, atk: 0, def: 0, dmg: 4, xp: 15, gold: [0, 3], minFloor: 1 },
  { kind: 'demon', names: ['Horned demon', 'Ash demon'], sprite: 'chort_idle_anim', hp: 11, atk: 3, def: 2, dmg: 6, xp: 30, gold: [3, 9], minFloor: 1 },
  { kind: 'orque', names: ['Masked orc', 'Orc raider'], sprite: 'masked_orc_idle_anim', hp: 14, atk: 3, def: 2, dmg: 8, xp: 35, gold: [4, 12], minFloor: 2 },
  { kind: 'necromancien', names: ['Apprentice necromancer', 'Hooded necromancer'], sprite: 'necromancer_anim', hp: 10, atk: 4, def: 2, dmg: 6, xp: 40, gold: [5, 14], minFloor: 2 },
  { kind: 'guerrier', names: ['Orc warrior', 'Orc warlord'], sprite: 'orc_warrior_idle_anim', hp: 16, atk: 4, def: 3, dmg: 8, xp: 45, gold: [5, 15], minFloor: 3, wanderer: true },
  // Profondeurs (étage 4 et au-delà)
  { kind: 'yeti', names: ['Cave yeti', 'Grumpy yeti'], sprite: 'ice_zombie_anim', hp: 20, atk: 4, def: 3, dmg: 8, xp: 55, gold: [6, 16], minFloor: 4, wanderer: true },
  { kind: 'chaman', names: ['Orc shaman', 'Tribal witch doctor'], sprite: 'orc_shaman_idle_anim', hp: 14, atk: 6, def: 2, dmg: 8, xp: 60, gold: [8, 18], minFloor: 4 },
  { kind: 'marais', names: ['Swamp horror', 'Bog toad'], sprite: 'swampy_anim', hp: 22, atk: 4, def: 4, dmg: 8, xp: 65, gold: [8, 20], minFloor: 5 },
  { kind: 'golem', names: ['Mud golem', 'Sludge colossus'], sprite: 'muddy_anim', hp: 28, atk: 3, def: 6, dmg: 10, xp: 70, gold: [10, 22], minFloor: 5 },
  { kind: 'lezard', names: ['Lizardman assassin', 'Deep lizard'], sprite: 'lizard_m_idle_anim', hp: 16, atk: 7, def: 4, dmg: 10, xp: 80, gold: [12, 26], minFloor: 6, wanderer: true },
  { kind: 'gargouille', names: ['Carved gargoyle', 'Gargoyle of the old vault'], sprite: 'muddy_anim', hp: 30, atk: 5, def: 8, dmg: 10, xp: 90, gold: [14, 28], minFloor: 7 },
  { kind: 'chevalier_noir', names: ['Fallen knight', 'Faceless black guard'], sprite: 'orc_warrior_idle_anim', hp: 24, atk: 8, def: 6, dmg: 12, xp: 100, gold: [16, 32], minFloor: 7, wanderer: true },
  { kind: 'wyrm', names: ['Abyssal wyrmling', 'Young wyvern'], sprite: 'big_demon_idle_anim', hp: 26, atk: 9, def: 5, dmg: 12, xp: 115, gold: [18, 36], minFloor: 8, wanderer: true },
];

export const MIMIC: MonsterTpl = { kind: 'mimique', names: ['Mimic (that was not a chest)'], sprite: 'chest_mimic_open_anim', hp: 16, atk: 4, def: 2, dmg: 8, xp: 50, gold: [15, 40], minFloor: 1 };

export const BOSSES: MonsterTpl[] = [
  { kind: 'ogre', names: ['Grondak, the Hero-Eating Ogre'], sprite: 'ogre_idle_anim', hp: 26, atk: 4, def: 2, dmg: 7, xp: 200, gold: [40, 80], minFloor: 1, boss: true },
  { kind: 'gros_zombie', names: ['Moragh, the Putrid Matron'], sprite: 'big_zombie_idle_anim', hp: 30, atk: 3, def: 1, dmg: 7, xp: 200, gold: [40, 80], minFloor: 1, boss: true },
  { kind: 'golem_ancien', names: ['Brakk, the Living Wall'], sprite: 'ogre_idle_anim', hp: 30, atk: 5, def: 3, dmg: 8, xp: 260, gold: [60, 110], minFloor: 2, boss: true },
  { kind: 'chef_orque', names: ['Warlord Gutrot'], sprite: 'orc_warrior_idle_anim', hp: 34, atk: 5, def: 3, dmg: 9, xp: 300, gold: [70, 120], minFloor: 3, boss: true },
  { kind: 'yeti_ancien', names: ['Grimfrost, the Ancient Yeti'], sprite: 'ogre_idle_anim', hp: 40, atk: 5, def: 4, dmg: 10, xp: 350, gold: [80, 140], minFloor: 4, boss: true },
  { kind: 'dragon', names: ['Vorthrax, Dragon of the Deep'], sprite: 'big_demon_idle_anim', hp: 44, atk: 6, def: 4, dmg: 10, xp: 450, gold: [100, 180], minFloor: 5, boss: true },
  { kind: 'crapaud_roi', names: ['Gorgoth, the Toad King'], sprite: 'big_zombie_idle_anim', hp: 48, atk: 6, def: 5, dmg: 11, xp: 500, gold: [120, 200], minFloor: 6, boss: true },
  { kind: 'liche', names: ['Malzeth, the Lich of a Thousand Names'], sprite: 'necromancer_anim', hp: 52, atk: 7, def: 5, dmg: 11, xp: 600, gold: [140, 220], minFloor: 7, boss: true },
  { kind: 'dragon_ancien', names: ['Nyxareth, Devourer of Floors'], sprite: 'big_demon_idle_anim', hp: 50, atk: 7, def: 6, dmg: 12, xp: 800, gold: [180, 300], minFloor: 8, boss: true },
  { kind: 'gros_demon', names: ['Baal-Zephor, Lord of the Abyss'], sprite: 'big_demon_idle_anim', hp: 26, atk: 4, def: 2, dmg: 7, xp: 220, gold: [50, 90], minFloor: 1, boss: true },
];

export const THEMES = ['classique', 'inondé', 'en feu', 'plongé dans le noir', 'moisi', 'hanté'];

export const ROOM_DESCRIPTIONS: Record<string, string[]> = {
  normale: ['A damp room that smells of old cheese.', 'Cobwebs and a broken chair.', 'Someone wrote "I\'LL BE BACK" on the wall.', 'A mocking echo repeats your footsteps.', 'Bones, lots of bones. Too many bones.'],
  safe: ['A safe room. The merchant stares at you without blinking. Nobody can fight in here.'],
  piege: ['The floor looks a little too clean.', 'Tiny holes in the walls. Nothing to worry about, surely.'],
  tresor: ['A chest sits in the middle of the room. It looks friendly. Too friendly?'],
  arene: ['The arena. Empty stands, a smell of sweat. Player fights here earn double XP.'],
  boss: ['The boss room. The stairs to the next floor are right behind it, of course.'],
};

export const TRAP_TEXTS = [
  '{p} steps on a flagstone that goes "click". Spikes shoot up from the floor.',
  '{p} sets off a shower of pebbles. Very local, very targeted.',
  '{p} takes a swinging axe to the face. A classic, but it works.',
  '{p} falls into a 15-inch pit. Mostly the ego gets hurt.',
  '{p} activates an explosive rune. It explodes. Obviously.',
];

export const CRIT_TEXTS = [
  'CRITICAL HIT! {a} hits {t} so hard their ancestors felt it in the afterlife.',
  'CRITICAL HIT! {a} sends {t} to see the stars, and the stars say hi.',
  'CRITICAL HIT! Natural 20: {a} finds the gap in the armor. Somewhere, a bard takes notes.',
];

export const GAG_TEXTS = [
  '{a} slips on a puddle of slug drool and hurts themself.',
  '{a} swings their weapon… by the wrong end. It comes back. Into their face.',
  '{a} trips mid-battle-cry and bites their own tongue.',
  '{a} misses so beautifully they get hurt out of solidarity.',
];

export const FIASCO_TEXTS = [
  '{a} misses {t} and gets tangled in their cape. They lose their next turn.',
  '{a} attempts an overly ambitious spin and ends up dizzy. They lose their next turn.',
];

export const DEATH_TEXTS = [
  '{p} is dead. Last thought: "I should have drunk the potion."',
  '{p} is dead. Chat types F with great feeling.',
  '{p} is dead, and honestly, we all saw it coming.',
  '{p} joins the Dungeon\'s obituaries. Rest in HP.',
  '{p} is dead. A priest walks by, shrugs, and walks away.',
];

export const SEARCH_FAIL_TEXTS = [
  '{p} searches the room and finds… dust. Lots of dust.',
  '{p} searches everywhere and only finds a rusty gauntlet. Left hand. The right one is missing.',
  '{p} lifts a stone. A woodlouse stares back in contempt.',
];

// The safe room merchant reminds players of the rules, in his own way.
export const MERCHANT_WELCOME =
  "Welcome, adventurer! One command per turn, the last one you type is the one that counts. !north, !south, !east, !west to move, !attack to hit, !search to search. Come back to me to !rest.";
export const MERCHANT_RESPAWN = [
  "Hello again. Your loot stayed where you died: go back and get it with !pickup.",
  "Back already? You're untouchable for a minute, unless you attack someone. Make the most of it and !rest… oh wait, you're already in perfect shape.",
  "Death is mostly embarrassing. Your stuff is waiting for you on the floor, over there.",
];
/** The blacksmith: gear upgrades (+1 per visit, up to FORGE_MAX). */
export const FORGE_MAX = 3;
export const FORGE_LINES = [
  'There you go. Try not to break it on the first goblin you meet.',
  'Fine work. Mine, not yours.',
  'Tempered three times, blessed zero times. It should hold.',
  'Come back when you have more gold. Or more talent.',
  'It sings when you hit it. That\'s a good sign. I think.',
  'Don\'t thank me, pay me. Oh, you did? Then thank you.',
];

export const MERCHANT_TIPS = [
  "One command per turn, and the last one you type is the one that counts. Just like at the tavern.",
  "A potion is drunk before the blows of the turn. Running away, though, happens AFTER you take the hits.",
  "If you don't type anything, you keep hitting your target. Or you strike back. Or you admire the ceiling.",
  "!search picks up what's lying around, opens chests and disarms traps. My favorite tool.",
  "The dead leave all their loot on the floor. !pickup. I don't judge.",
  "Every floor collapses when the timer runs out. Find the boss, beat it, then !descend.",
  "The stairs stay sealed for the first half of the floor. Use that time to loot and level up: down there, things hit hard.",
  "Nobody fights in here. When you arrive or come back from the dead, you're untouchable for a minute. Attack another player and that protection is gone.",
  "Attacking an ally is a betrayal: big bonus, and everyone will know.",
  "!rest heals you, but only in here. !shop to see my stock. Fair prices. Almost.",
  "When you level up: !levelup str, dex, int or cha. Don't save your points for your old age.",
  "Something wrong? !bug followed by what's broken. The dungeon gods read everything.",
  "There's a blacksmith on every floor, halfway to the boss: !forge weapon or !forge armor, for gold.",
  "Production runs votes: !vote 1, 2 or 3. The gods of showbiz like to be listened to.",
  "Running from a monster takes a Dexterity roll. Rogues love it. Knights, not so much.",
  "Trapped rooms can be disarmed with !search and a bit of Intelligence. Or a lot of luck.",
];
