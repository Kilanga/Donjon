// Modération du texte qui finit à l'écran du stream : bulles des joueurs, pseudos de la page web, répliques de l'IA.
// Deux niveaux :
//  - HAINE : insultes racistes/homophobes, nazisme, appels au suicide, contenu sexuel explicite → masqué partout, refusé
//    dans un pseudo, et une réponse d'IA qui en contient est jetée (le PNJ dit une réplique écrite à la place).
//  - GROSSIER : insultes courantes → toléré dans le chat des joueurs (c'est leur chat), mais jamais dans la bouche de l'IA.
// La comparaison se fait sur un texte normalisé (minuscules, sans accents, chiffres « leet » remplacés).

const HATE = [
  'n+[i1]+g+[e3]*r*s?', 'n+[i1]+g+a+[sz]?', 'negr[eo]s?', 'negresses?', 'bougnoules?', 'bougnoul', 'youpins?', 'youtres?', 'bicots?',
  'crouilles?', 'chinetoques?', 'bamboulas?', 'f+a+g+(?:g?ots?)?', 'pd', 'peds?', 'pedes?', 'tarlouzes?', 'tapettes?', 'gouines?',
  'nazis?', 'hitler', 'heil', 'sieg', 'kkk', 'shoah', 'kys', 'suicides?', 'suicider?', 'pendez?-?toi', 'tue[sz]?-?toi',
  'kill ?yourself', 'pedophiles?', 'pedos?', 'violer', 'violee?s?', 'viol', 'rape', 'porn\\w*', 'sexe', 'bites?', 'nichons?',
  'sale (?:arabe|noir|juif|renoi|bougnoule|musulman|chinois|gay|pd)s?',
];
const RUDE = [
  'connard', 'connasse', 'encul\\w*', 'salope', 'putes?', 'putain', 'fdp', 'ntm', 'nique', 'niquer', 'batard', 'fuck\\w*', 'shit',
  'bitch', 'cunt', 'merdeux', 'abruti', 'debile', 'mongol', 'trisomique', 'autiste',
];
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|fr|net|org|io|gg|tv|ly|be|xyz|ru|me)\b\S*/gi;

const re = (words: string[]) => new RegExp(`(?<![a-z0-9])(?:${words.join('|')})(?![a-z0-9])`, 'i');
const HATE_RE = re(HATE);
const RUDE_RE = re(RUDE);
const HATE_G = new RegExp(HATE_RE.source, 'gi');

/** Minuscules, sans accents, « leet » ramené aux lettres. Même longueur que l'entrée (pour masquer au bon endroit). */
export function normalize(s: string): string {
  const leet: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '€': 'e' };
  return [...s].map((c) => {
    const d = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const one = d.length === 1 ? d : c.toLowerCase();
    return leet[one] ?? (one.length === 1 ? one : c);
  }).join('');
}

export function hasHate(s: string): boolean {
  return HATE_RE.test(normalize(s));
}

export function hasLink(s: string): boolean {
  URL_RE.lastIndex = 0;
  return URL_RE.test(s);
}

/** Pour un texte que l'IA veut afficher : null s'il ne doit pas passer à l'écran. */
export function screenAi(s: string): string | null {
  const n = normalize(s);
  if (HATE_RE.test(n) || RUDE_RE.test(n) || hasLink(s)) return null;
  return s;
}

/** Texte libre d'un joueur affiché sur le stream : liens retirés, mots haineux masqués. */
export function maskPlayerText(s: string): string {
  let out = s.replace(URL_RE, '[lien]');
  if (out.length === [...out].length) {
    // Masque au même endroit que dans le texte normalisé (même longueur quand il n'y a pas de caractères composés)
    const n = normalize(out);
    let masked = '';
    let last = 0;
    HATE_G.lastIndex = 0;
    for (const m of n.matchAll(HATE_G)) {
      masked += out.slice(last, m.index) + '***';
      last = m.index! + m[0].length;
    }
    out = masked + out.slice(last);
  } else if (hasHate(out)) out = '***';
  return out;
}

/** Un pseudo est-il acceptable à l'écran ? */
export function nameAllowed(name: string): boolean {
  const n = normalize(name).replace(/[_\-.\s]+/g, ' ');
  return !HATE_RE.test(n) && !RUDE_RE.test(n) && !hasLink(name);
}

/** Message d'un joueur à glisser dans un prompt : une ligne, sans guillemets ni chevrons, borné. */
export function quoteForPrompt(s: string, max = 200): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/["«»“”<>{}[\]`]/g, "'").replace(/\s+/g, ' ').trim().slice(0, max);
}
