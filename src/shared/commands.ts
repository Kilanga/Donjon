// Analyse des commandes du chat (français + alias anglais).

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
  | 'sell'
  | 'shop'
  | 'rest'
  | 'ally'
  | 'leave'
  | 'levelup'
  | 'status'
  | 'help'
  | 'vote';

export interface ParsedCommand {
  name: CommandName;
  arg: string; // reste de la commande, normalisé
  raw: string;
}

const ALIASES: Record<string, { name: CommandName; arg?: string }> = {
  join: { name: 'join' }, rejoindre: { name: 'join' },
  nord: { name: 'move', arg: 'n' }, north: { name: 'move', arg: 'n' }, n: { name: 'move', arg: 'n' },
  sud: { name: 'move', arg: 's' }, south: { name: 'move', arg: 's' }, s: { name: 'move', arg: 's' },
  est: { name: 'move', arg: 'e' }, east: { name: 'move', arg: 'e' }, e: { name: 'move', arg: 'e' },
  ouest: { name: 'move', arg: 'o' }, west: { name: 'move', arg: 'o' }, o: { name: 'move', arg: 'o' }, w: { name: 'move', arg: 'o' },
  descendre: { name: 'descend' }, descend: { name: 'descend' }, down: { name: 'descend' },
  attaque: { name: 'attack' }, attaquer: { name: 'attack' }, attack: { name: 'attack' }, atk: { name: 'attack' },
  trahis: { name: 'attack' }, betray: { name: 'attack' },
  fouille: { name: 'search' }, fouiller: { name: 'search' }, search: { name: 'search' },
  ramasse: { name: 'pickup' }, ramasser: { name: 'pickup' }, pickup: { name: 'pickup' }, take: { name: 'pickup' },
  utilise: { name: 'use' }, utiliser: { name: 'use' }, use: { name: 'use' }, bois: { name: 'use' }, drink: { name: 'use' },
  equipe: { name: 'equip' }, equiper: { name: 'equip' }, equip: { name: 'equip' },
  achete: { name: 'buy' }, acheter: { name: 'buy' }, buy: { name: 'buy' },
  vends: { name: 'sell' }, vendre: { name: 'sell' }, sell: { name: 'sell' },
  marchand: { name: 'shop' }, shop: { name: 'shop' },
  repos: { name: 'rest' }, rest: { name: 'rest' },
  alliance: { name: 'ally' }, allie: { name: 'ally' }, ally: { name: 'ally' },
  quitte: { name: 'leave' }, quitter: { name: 'leave' }, leave: { name: 'leave' },
  monte: { name: 'levelup' }, levelup: { name: 'levelup' }, up: { name: 'levelup' },
  statut: { name: 'status' }, status: { name: 'status' }, stats: { name: 'status' },
  aide: { name: 'help' }, help: { name: 'help' }, commandes: { name: 'help' }, commands: { name: 'help' }, regles: { name: 'help' },
  vote: { name: 'vote' }, voter: { name: 'vote' },
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

/** Pour une commande inconnue, la commande la plus proche (« !attque Kilak » → « !attaque Kilak »), sinon null. */
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
  '!join [barbare|chevalier|voleur|mage] — entrer dans le donjon',
  '!nord !sud !est !ouest — changer de salle',
  '!attaque [cible] — attaquer un monstre ou un joueur',
  '!fouille — fouiller la salle, ouvrir un coffre, désarmer un piège',
  '!ramasse [objet] — ramasser ce qui traîne au sol',
  '!utilise <objet> / !equipe <objet> — utiliser ou équiper',
  '!marchand, !achete <n°>, !vends <objet> — commerce (safe room)',
  '!repos — se soigner (safe room)',
  '!parle <message> — discuter avec le marchand (safe room)',
  '!alliance <joueur> / !quitte — former ou quitter une alliance',
  '!monte <for|agi|int|cha> — dépenser un point de stat',
  '!descendre — prendre l\'escalier (salle du boss vaincu)',
  '!vote <n°> — voter pour l\'événement proposé par la production',
  '!bug <description> / !avis <message> — signaler un souci ou donner ton avis (test)',
  '!commandes ou !aide — afficher cette liste',
];
