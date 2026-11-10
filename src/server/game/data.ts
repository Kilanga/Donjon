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
  barbare: { id: 'barbare', label: 'Barbare', stats: { for: 3, agi: 0, int: -1, cha: 1 }, hp: 14, hpPerLevel: 6, attackStat: 'for', sprite: 'dwarf_m', startWeapon: 'hache_rouillee', startArmor: null },
  chevalier: { id: 'chevalier', label: 'Chevalier', stats: { for: 2, agi: 0, int: 0, cha: 1 }, hp: 12, hpPerLevel: 5, attackStat: 'for', sprite: 'knight_m', startWeapon: 'epee_courte', startArmor: 'tunique' },
  voleur: { id: 'voleur', label: 'Voleur', stats: { for: 0, agi: 3, int: 0, cha: 0 }, hp: 10, hpPerLevel: 4, attackStat: 'agi', sprite: 'elf_m', startWeapon: 'dague', startArmor: null },
  mage: { id: 'mage', label: 'Mage', stats: { for: -1, agi: 1, int: 3, cha: 0 }, hp: 8, hpPerLevel: 3, attackStat: 'int', sprite: 'wizzard_m', startWeapon: 'baton', startArmor: null },
};

export const STAT_LABELS: Record<StatId, string> = { for: 'Force', agi: 'Agilité', int: 'Intelligence', cha: 'Charisme' };

export const RARITY_LABEL: Record<Rarity, string> = { commun: 'commun', rare: 'rare', epique: 'épique', legendaire: 'légendaire' };
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
  { tpl: 'poings', name: 'Poings nus', kind: 'arme', rarity: 'commun', value: 0, dmg: 3, desc: 'Gratuit, toujours disponible.', sprite: 'ui_heart_full' },
  { tpl: 'dague', name: 'Dague rouillée', kind: 'arme', rarity: 'commun', value: 8, dmg: 4, hit: 1, desc: 'Petite, précise, légèrement tétanique.', sprite: 'weapon_knife', shop: true },
  { tpl: 'baton', name: 'Bâton noueux', kind: 'arme', rarity: 'commun', value: 8, dmg: 4, desc: 'Canalise la magie. Et les échardes.', sprite: 'weapon_green_magic_staff', shop: true },
  { tpl: 'epee_courte', name: 'Épée courte', kind: 'arme', rarity: 'commun', value: 12, dmg: 6, desc: 'Une épée honnête pour un aventurier qui ne l\'est pas.', sprite: 'weapon_rusty_sword', shop: true },
  { tpl: 'hache_rouillee', name: 'Hache de bûcheron', kind: 'arme', rarity: 'commun', value: 12, dmg: 6, desc: 'Sent encore le sapin.', sprite: 'weapon_axe', shop: true },
  { tpl: 'epee_longue', name: 'Épée de chevalier', kind: 'arme', rarity: 'rare', value: 35, dmg: 8, hit: 1, desc: 'Gravée « Propriété de Sire Quelqu\'un ».', sprite: 'weapon_regular_sword', shop: true },
  { tpl: 'hache_guerre', name: 'Hache de guerre', kind: 'arme', rarity: 'rare', value: 35, dmg: 8, desc: 'Lourde, bruyante, efficace.', sprite: 'weapon_waraxe', shop: true },
  { tpl: 'baton_rouge', name: 'Bâton de feu', kind: 'arme', rarity: 'rare', value: 35, dmg: 8, hit: 1, desc: 'Chaud au toucher. Ne pas lécher.', sprite: 'weapon_red_magic_staff', shop: true },
  { tpl: 'marteau', name: 'Marteau du Nain Furieux', kind: 'arme', rarity: 'epique', value: 90, dmg: 10, hit: 1, desc: 'Forgé dans la colère. Écrase les ennemis et les certitudes.', sprite: 'weapon_big_hammer' },
  { tpl: 'epee_mousse', name: 'Épée en mousse légendaire', kind: 'arme', rarity: 'legendaire', value: 200, dmg: 12, hit: 3, desc: 'Personne ne comprend pourquoi elle fait si mal.', sprite: 'weapon_regular_sword' },
  // Armures
  { tpl: 'tunique', name: 'Tunique trouée', kind: 'armure', rarity: 'commun', value: 8, def: 1, desc: 'Les trous sont décoratifs.', sprite: 'crate', shop: true },
  { tpl: 'cotte', name: 'Cotte de mailles', kind: 'armure', rarity: 'rare', value: 30, def: 2, desc: 'Fait un bruit de clés en permanence.', sprite: 'crate', shop: true },
  { tpl: 'plastron', name: 'Plastron cabossé', kind: 'armure', rarity: 'epique', value: 80, def: 3, desc: 'Chaque bosse a son histoire.', sprite: 'crate' },
  { tpl: 'pyjama', name: 'Pyjama de dragon', kind: 'armure', rarity: 'legendaire', value: 200, def: 5, desc: 'Ignifugé, douillet, intimidant.', sprite: 'crate' },
  // Consommables
  { tpl: 'potion', name: 'Petite potion', kind: 'conso', rarity: 'commun', value: 10, desc: 'Rend 2d6+2 PV. Goût fraise-rouille.', sprite: 'flask_red', effect: 'heal_small', shop: true },
  { tpl: 'grande_potion', name: 'Grande potion', kind: 'conso', rarity: 'rare', value: 30, desc: 'Rend 4d6+4 PV.', sprite: 'flask_big_red', effect: 'heal_big', shop: true },
  { tpl: 'fumigene', name: 'Bombe fumigène', kind: 'conso', rarity: 'rare', value: 25, desc: 'Fuite garantie au prochain déplacement.', sprite: 'bomb_f0', effect: 'smoke', shop: true },
  { tpl: 'parchemin', name: 'Parchemin de retour', kind: 'conso', rarity: 'rare', value: 40, desc: 'Téléporte dans la safe room de l\'étage.', sprite: 'flask_blue', effect: 'teleport', shop: true },
  // Objets bizarres (effet unique)
  { tpl: 'poulet', name: 'Poulet. Juste un poulet.', kind: 'bizarre', rarity: 'rare', value: 15, desc: 'Lancé dans une salle, distrait tous les monstres pendant un tour.', sprite: 'flask_yellow', effect: 'chicken' },
  { tpl: 'coupon', name: 'Bon de résurrection (déjà tamponné)', kind: 'bizarre', rarity: 'rare', value: 15, desc: 'À la prochaine mort, réapparition 2 tours plus tôt.', sprite: 'flask_green', effect: 'coupon' },
  { tpl: 'ticket', name: 'Dé à sept faces', kind: 'bizarre', rarity: 'commun', value: 1, desc: 'Aucun effet. Personne n\'a jamais réussi à le lancer.', sprite: 'flask_blue', effect: 'nothing' },
  { tpl: 'fromage', name: 'Fromage qui pue', kind: 'bizarre', rarity: 'commun', value: 6, desc: 'Fait fuir les monstres errants de la salle.', sprite: 'flask_yellow', effect: 'cheese' },
  { tpl: 'cape', name: 'Cape d\'invisibilité (trouée)', kind: 'bizarre', rarity: 'epique', value: 60, desc: '50 % de chances d\'esquiver chaque attaque pendant 3 tours.', sprite: 'flask_big_blue', effect: 'cloak' },
  { tpl: 'miroir', name: 'Miroir de poche', kind: 'bizarre', rarity: 'rare', value: 20, desc: '+3 au prochain jet, le temps de se trouver beau.', sprite: 'flask_big_yellow', effect: 'mirror' },
  { tpl: 'canard', name: 'Crapaud siffleur', kind: 'bizarre', rarity: 'commun', value: 4, desc: 'Siffle à l\'approche des pièges. Les révèle dans la salle.', sprite: 'flask_big_yellow', effect: 'duck' },
  { tpl: 'couronne', name: 'Couronne du Roi Gobelin', kind: 'bizarre', rarity: 'legendaire', value: 150, desc: 'Gain d\'un niveau. Trop petite, mais quel prestige.', sprite: 'flask_big_green', effect: 'crown' },
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
  { kind: 'gobelin', names: ['Gobelin chapardeur', 'Gobelin à la dague ébréchée', 'Gobelin hurleur'], sprite: 'goblin_idle_anim', hp: 7, atk: 2, def: 1, dmg: 4, xp: 15, gold: [2, 6], minFloor: 1 },
  { kind: 'squelette', names: ['Squelette grinçant', 'Squelette sans mâchoire', 'Squelette de l\'ancienne garde'], sprite: 'skelet_idle_anim', hp: 9, atk: 2, def: 2, dmg: 6, xp: 20, gold: [1, 5], minFloor: 1 },
  { kind: 'zombie', names: ['Petit zombie putride', 'Goule rabougrie'], sprite: 'tiny_zombie_idle_anim', hp: 8, atk: 1, def: 0, dmg: 4, xp: 12, gold: [0, 4], minFloor: 1, wanderer: true },
  { kind: 'diablotin', names: ['Diablotin ricaneur', 'Diablotin des braises'], sprite: 'imp_idle_anim', hp: 5, atk: 3, def: 3, dmg: 3, xp: 12, gold: [1, 4], minFloor: 1, wanderer: true },
  { kind: 'limace', names: ['Limace géante', 'Vase acide'], sprite: 'slug_anim', hp: 12, atk: 0, def: 0, dmg: 4, xp: 15, gold: [0, 3], minFloor: 1 },
  { kind: 'demon', names: ['Démon cornu', 'Démon des cendres'], sprite: 'chort_idle_anim', hp: 11, atk: 3, def: 2, dmg: 6, xp: 30, gold: [3, 9], minFloor: 1 },
  { kind: 'orque', names: ['Orque masqué', 'Orque pillard'], sprite: 'masked_orc_idle_anim', hp: 14, atk: 3, def: 2, dmg: 8, xp: 35, gold: [4, 12], minFloor: 2 },
  { kind: 'necromancien', names: ['Nécromancien apprenti', 'Nécromancien à capuche'], sprite: 'necromancer_anim', hp: 10, atk: 4, def: 2, dmg: 6, xp: 40, gold: [5, 14], minFloor: 2 },
  { kind: 'guerrier', names: ['Orque guerrier', 'Chef de guerre orque'], sprite: 'orc_warrior_idle_anim', hp: 16, atk: 4, def: 3, dmg: 8, xp: 45, gold: [5, 15], minFloor: 3, wanderer: true },
];

export const MIMIC: MonsterTpl = { kind: 'mimique', names: ['Mimique (ce n\'était pas un coffre)'], sprite: 'chest_mimic_open_anim', hp: 16, atk: 4, def: 2, dmg: 8, xp: 50, gold: [15, 40], minFloor: 1 };

export const BOSSES: MonsterTpl[] = [
  { kind: 'ogre', names: ['Grondak, ogre mangeur de héros'], sprite: 'ogre_idle_anim', hp: 38, atk: 5, def: 3, dmg: 10, xp: 200, gold: [40, 80], minFloor: 1, boss: true },
  { kind: 'gros_zombie', names: ['Moragh, la Matrone Putride'], sprite: 'big_zombie_idle_anim', hp: 42, atk: 4, def: 2, dmg: 10, xp: 200, gold: [40, 80], minFloor: 1, boss: true },
  { kind: 'gros_demon', names: ['Baal-Zéphor, seigneur des abysses'], sprite: 'big_demon_idle_anim', hp: 36, atk: 6, def: 4, dmg: 10, xp: 220, gold: [50, 90], minFloor: 1, boss: true },
];

export const THEMES = ['classique', 'inondé', 'en feu', 'plongé dans le noir', 'moisi', 'hanté'];

export const ROOM_DESCRIPTIONS: Record<string, string[]> = {
  normale: ['Une salle humide qui sent le vieux fromage.', 'Des toiles d\'araignée et une chaise cassée.', 'Quelqu\'un a écrit « JE REVIENDRAI » sur le mur.', 'Un écho moqueur répète vos pas.', 'Des os, beaucoup d\'os. Trop d\'os.'],
  safe: ['Une safe room. Le marchand vous fixe sans cligner des yeux. Personne ne peut se battre ici.'],
  piege: ['Le sol a l\'air un peu trop propre.', 'Des petits trous dans les murs. Rien d\'inquiétant, sûrement.'],
  tresor: ['Un coffre trône au milieu de la pièce. Il a l\'air sympa. Trop sympa ?'],
  arene: ['L\'arène. Des gradins vides, une odeur de sueur. Les combats entre joueurs y rapportent double XP.'],
  boss: ['La salle du boss. L\'escalier vers l\'étage suivant est juste derrière lui, évidemment.'],
};

export const TRAP_TEXTS = [
  '{p} marche sur une dalle qui fait « clic ». Des piques sortent du sol.',
  '{p} déclenche une averse de cailloux. Très locale, très ciblée.',
  '{p} se prend une hache pendulaire. Classique, mais efficace.',
  '{p} tombe dans une fosse de 40 cm. Ça fait mal à l\'ego surtout.',
  '{p} active une rune explosive. Elle explose. Évidemment.',
];

export const CRIT_TEXTS = [
  'COUP CRITIQUE ! {a} frappe {t} si fort que ses ancêtres l\'ont senti jusque dans l\'au-delà.',
  'COUP CRITIQUE ! {a} envoie {t} voir les étoiles, et les étoiles disent bonjour.',
  'COUP CRITIQUE ! 20 naturel : {a} trouve le défaut de l\'armure. Un barde, quelque part, prend des notes.',
];

export const GAG_TEXTS = [
  '{a} glisse sur une flaque de bave de limace et se fait mal tout seul.',
  '{a} lance son arme… par le mauvais bout. Elle revient. Dans sa figure.',
  '{a} trébuche en criant son cri de guerre et se mord la langue.',
  '{a} rate son attaque si magnifiquement qu\'il se blesse par solidarité.',
];

export const FIASCO_TEXTS = [
  '{a} rate {t} et s\'emmêle dans sa cape. Il perd son prochain tour.',
  '{a} fait un moulinet trop ambitieux et finit étourdi. Il perd son prochain tour.',
];

export const DEATH_TEXTS = [
  '{p} est mort. Sa dernière pensée : « j\'aurais dû prendre la potion ».',
  '{p} est mort. Le chat écrit F avec ferveur.',
  '{p} est mort, et franchement on l\'a tous vu venir.',
  '{p} rejoint la nécrologie du Donjon. Paix à ses PV.',
  '{p} est mort. Un prêtre passe, hausse les épaules et repart.',
];

export const SEARCH_FAIL_TEXTS = [
  '{p} fouille la salle et trouve… de la poussière. Beaucoup de poussière.',
  '{p} fouille partout et ne trouve qu\'un gantelet rouillé. Gauche. Il manque le droit.',
  '{p} soulève une pierre. Un cloporte le regarde avec mépris.',
];

// Le marchand des safe rooms rappelle les règles, à sa façon.
export const MERCHANT_WELCOME =
  "Bienvenue, aventurier ! Une commande par tour, c'est la dernière tapée qui compte. !nord, !sud, !est, !ouest pour bouger, !attaque pour taper, !fouille pour fouiller. Reviens me voir pour !repos.";
export const MERCHANT_RESPAWN = [
  "Re-bonjour. Ton loot est resté là où tu es mort : retourne le chercher avec !ramasse.",
  "Déjà de retour ? Tu es intouchable 3 minutes. Profites-en pour !repos… ah non, tu es déjà en pleine forme.",
  "La mort, c'est surtout vexant. Tes affaires t'attendent au sol, là-bas.",
];
export const MERCHANT_TIPS = [
  "Une seule commande par tour, et c'est la dernière tapée qui compte. Comme à la taverne.",
  "Les coups passent avant tout le reste : fuir ou boire une potion, c'est APRÈS avoir encaissé.",
  "Si tu ne tapes rien, tu continues de frapper ta cible. Ou tu ripostes. Ou tu admires le plafond.",
  "!fouille ramasse ce qui traîne, ouvre les coffres et désarme les pièges. Mon outil préféré.",
  "Un mort laisse tout son loot au sol. !ramasse. Je ne juge pas.",
  "Chaque étage s'effondre au bout du chrono. Trouve le boss, bats-le, puis !descendre.",
  "Ici, personne ne se bat. En arrivant ou en revenant d'entre les morts, tu es intouchable 3 minutes, et tu ne peux toucher personne.",
  "Attaquer un allié, c'est une trahison : gros bonus, et tout le monde le saura.",
  "!repos te soigne, mais seulement ici. !marchand pour voir mon stock. Les prix sont honnêtes. Presque.",
  "Quand tu gagnes un niveau : !monte for, agi, int ou cha. Ne garde pas tes points pour tes vieux jours.",
  "Un souci ? !bug suivi de ce qui cloche. Les dieux du donjon lisent tout.",
  "La production propose des votes : !vote 1, 2 ou 3. Les dieux du spectacle aiment qu'on les écoute.",
  "Fuir un monstre demande un jet d'Agilité. Les voleurs adorent. Les chevaliers, moins.",
  "Les salles piégées se désarment avec !fouille et un peu d'Intelligence. Ou beaucoup de chance.",
];
