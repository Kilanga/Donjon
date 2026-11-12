// Chat command parsing (English commands, French aliases kept).

export type CommandName =
  | 'join'
  | 'move'
  | 'descend'
  | 'attack'
  | 'search'
  | 'pickup'
  | 'use'
  | 'equip'
  | 'buy'
  | 'forge'
  | 'bet'
  | 'sponsor'
  | 'favor'
  | 'sell'
  | 'shop'
  | 'rest'
  | 'ally'
  | 'leave'
  | 'levelup'
  | 'status'
  | 'help'
  | 'resurrect'
  | 'vote';

export interface ParsedCommand {
  name: CommandName;
  arg: string; // reste de la commande, normalisé
  raw: string;
}

// English first (shown everywhere), French kept as silent aliases for French-speaking viewers.
const ALIASES: Record<string, { name: CommandName; arg?: string }> = {
  join: { name: 'join' }, rejoindre: { name: 'join' },
  north: { name: 'move', arg: 'n' }, n: { name: 'move', arg: 'n' }, nord: { name: 'move', arg: 'n' },
  south: { name: 'move', arg: 's' }, s: { name: 'move', arg: 's' }, sud: { name: 'move', arg: 's' },
  east: { name: 'move', arg: 'e' }, e: { name: 'move', arg: 'e' }, est: { name: 'move', arg: 'e' },
  west: { name: 'move', arg: 'o' }, w: { name: 'move', arg: 'o' }, ouest: { name: 'move', arg: 'o' }, o: { name: 'move', arg: 'o' },
  descend: { name: 'descend' }, down: { name: 'descend' }, stairs: { name: 'descend' }, descendre: { name: 'descend' },
  attack: { name: 'attack' }, atk: { name: 'attack' }, hit: { name: 'attack' }, betray: { name: 'attack' },
  attaque: { name: 'attack' }, attaquer: { name: 'attack' }, trahis: { name: 'attack' },
  search: { name: 'search' }, loot: { name: 'search' }, fouille: { name: 'search' }, fouiller: { name: 'search' },
  pickup: { name: 'pickup' }, take: { name: 'pickup' }, grab: { name: 'pickup' }, ramasse: { name: 'pickup' }, ramasser: { name: 'pickup' },
  use: { name: 'use' }, drink: { name: 'use' }, utilise: { name: 'use' }, utiliser: { name: 'use' }, bois: { name: 'use' },
  equip: { name: 'equip' }, wear: { name: 'equip' }, equipe: { name: 'equip' }, equiper: { name: 'equip' },
  buy: { name: 'buy' }, achete: { name: 'buy' }, acheter: { name: 'buy' },
  bet: { name: 'bet' }, wager: { name: 'bet' }, parie: { name: 'bet' }, parier: { name: 'bet' }, pari: { name: 'bet' }, mise: { name: 'bet' },
  sponsor: { name: 'sponsor' }, gift: { name: 'sponsor' }, sponsorise: { name: 'sponsor' }, offre: { name: 'sponsor' }, cadeau: { name: 'sponsor' },
  favor: { name: 'favor' }, favour: { name: 'favor' }, points: { name: 'favor' }, faveur: { name: 'favor' },
  forge: { name: 'forge' }, upgrade: { name: 'forge' }, forger: { name: 'forge' }, ameliore: { name: 'forge' }, ameliorer: { name: 'forge' },
  sell: { name: 'sell' }, vends: { name: 'sell' }, vendre: { name: 'sell' },
  shop: { name: 'shop' }, merchant: { name: 'shop' }, marchand: { name: 'shop' },
  rest: { name: 'rest' }, repos: { name: 'rest' },
  ally: { name: 'ally' }, alliance: { name: 'ally' }, allie: { name: 'ally' },
  leave: { name: 'leave' }, quitte: { name: 'leave' }, quitter: { name: 'leave' },
  levelup: { name: 'levelup' }, up: { name: 'levelup' }, train: { name: 'levelup' }, monte: { name: 'levelup' },
  status: { name: 'status' }, stats: { name: 'status' }, statut: { name: 'status' },
  help: { name: 'help' }, commands: { name: 'help' }, rules: { name: 'help' }, aide: { name: 'help' }, commandes: { name: 'help' }, regles: { name: 'help' },
  vote: { name: 'vote' }, voter: { name: 'vote' },
  resurrect: { name: 'resurrect' }, revive: { name: 'resurrect' }, raise: { name: 'resurrect' }, ressuscite: { name: 'resurrect' }, ressusciter: { name: 'resurrect' },
};

/** Minuscules et sans accents, pour comparer des noms tapés au clavier. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function parseCommand(raw: string): ParsedCommand | null {
  const text = raw.trim();
  if (!text.startsWith('!')) return null;
  const parts = text.slice(1).trim().split(/\s+/);
  const word = normalize(parts.shift() ?? '');
  const alias = ALIASES[word];
  if (!alias) return null;
  const rest = normalize(parts.join(' '));
  return { name: alias.name, arg: alias.arg ?? rest, raw: text };
}

/** Distance d'édition (fautes de frappe, lettres inversées comprises). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // lettres inversées
    }
  return d[a.length][b.length];
}

/** For an unknown command, the closest one ("!atack Kilak" → "!attack Kilak"), else null. */
export function suggestCommand(raw: string): string | null {
  const text = raw.trim();
  if (!text.startsWith('!')) return null;
  const parts = text.slice(1).trim().split(/\s+/);
  const word = normalize(parts.shift() ?? '');
  if (word.length < 2) return null;
  let best: string | null = null;
  let bestD = Infinity;
  for (const k of Object.keys(ALIASES)) {
    if (k.length < 3) continue; // n, s, e, o : trop courts pour deviner
    const dd = distance(word, k);
    if (dd < bestD) {
      bestD = dd;
      best = k;
    }
  }
  const tolerance = word.length <= 4 ? 1 : 2;
  if (!best || bestD > tolerance) return null;
  return ['!' + best, ...parts].join(' ');
}

export const HELP_TEXT = [
  '!join [barbarian|knight|rogue|mage] — enter the dungeon',
  '!north !south !east !west — move to another room',
  '!attack [target] — attack a monster or a player (no monster here: a random player)',
  '!search or !pickup — grab the loot on the floor, open a chest, disarm a trap, search the room (two at once: d20 vs d20)',
  '!use <item> / !equip <item> — use or equip',
  '!shop, !buy <#>, !sell <item> — trade (safe room)',
  '!rest — heal up (safe room)',
  'Strange rooms (altar, fountain, wishing well, prisoner, sleeping ogre): !search to use them',
  '!forge weapon / !forge armor — upgrade your gear at the blacksmith (+1, up to +3, for gold)',
  '!talk <message> — chat with the merchant (safe room)',
  '!ally <player> / !leave — form or leave an alliance',
  '!levelup <str|dex|int|cha> — spend a stat point',
  '!resurrect <name> [gold|hp] — in the crypt, bring an eliminated player back (50 gold × floor, or half your current HP)',
  '!descend — take the stairs (the boss must be dead, and the stairs stay sealed for the first minutes of each floor). Last floor: killing its boss ends the season',
  '!vote <#> — vote for the production\'s event (or to bring back a dead player after a collapse: one vote per name)',
  '!bet <name> <amount> — big bet: who gets out first? · !bet yes|no <amount> — current flash bet',
  '!sponsor <name> potion|gold|monster — send a gift (or a dirty trick) with your favor points · !favor — your points',
  '!bug <description> / !feedback <message> — report a problem or share your opinion',
  '!commands or !help — show this list',
];
