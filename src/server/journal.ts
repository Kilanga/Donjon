// Journal de session : tout ce qui se passe pendant une soirée de test, une ligne JSON par fait,
// dans logs/session-AAAA-MM-JJ_HH-MM.jsonl. Le rapport (report.ts) se fabrique à partir de ces fichiers.
// Écriture groupée toutes les secondes pour ne pas ralentir le jeu.
import fs from 'node:fs';
import path from 'node:path';

export type JournalKind =
  | 'start' // démarrage du serveur (config, version)
  | 'stop' // arrêt propre
  | 'connect' // une page s'ouvre (pseudo, appareil)
  | 'disconnect'
  | 'cmd' // commande d'un joueur et réponse du jeu
  | 'say' // message libre
  | 'event' // évènement du jeu (y compris privés)
  | 'turn' // résumé de chaque tour
  | 'snapshot' // classement et état des joueurs (toutes les 10 tours)
  | 'admin' // action de la régie
  | 'spam' // anti-spam déclenché
  | 'bug' // !bug d'un joueur
  | 'avis' // !avis d'un joueur
  | 'error' // erreur côté serveur
  | 'clientError' // erreur JavaScript remontée par une page
  | 'clientPerf' // images/seconde et infos de la page
  | 'log'; // console.log du serveur

export interface JournalLine {
  t: string; // horodatage ISO
  k: JournalKind;
  turn: number;
  [field: string]: unknown;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function stamp(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

export class Journal {
  readonly file: string;
  readonly dir: string;
  private buf: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private broken = false;
  private bytes = 0;
  /** Numéro de tour courant, fourni par le serveur. */
  turn: () => number = () => 0;
  /** Textes à ne jamais écrire (clé de régie, clé API) : remplacés par ***. */
  secrets: string[] = [];

  constructor(dir: string, private enabled = true) {
    this.dir = dir;
    this.file = path.join(dir, `session-${stamp()}.jsonl`);
    if (!enabled) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      this.broken = true;
    }
    this.timer = setInterval(() => this.flush(), 1000);
    this.timer.unref();
  }

  write(k: JournalKind, data: Record<string, unknown> = {}) {
    if (!this.enabled || this.broken) return;
    let line: string;
    try {
      line = JSON.stringify({ t: new Date().toISOString(), k, turn: this.turn(), ...data });
    } catch {
      line = JSON.stringify({ t: new Date().toISOString(), k, turn: this.turn(), note: 'données non sérialisables' });
    }
    for (const sec of this.secrets) if (sec && sec.length >= 4) line = line.split(sec).join('***');
    // Garde-fou : au-delà de 200 Mo, on n'écrit plus que l'essentiel
    if (this.bytes > 200e6 && !['bug', 'avis', 'error', 'clientError', 'stop', 'admin'].includes(k)) return;
    this.bytes += line.length + 1;
    this.buf.push(line);
    if (k === 'error' || k === 'bug' || k === 'avis' || k === 'stop') this.flush();
  }

  flush() {
    if (!this.buf.length || this.broken) return;
    const chunk = this.buf.join('\n') + '\n';
    this.buf = [];
    try {
      fs.appendFileSync(this.file, chunk);
    } catch (e) {
      this.broken = true;
      process.stderr.write(`[journal] écriture impossible dans ${this.file} : ${String(e)}\n`);
    }
  }

  /** Fichiers de session présents, du plus ancien au plus récent. */
  static list(dir: string): string[] {
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => /^session-.*\.jsonl$/.test(f))
        .sort();
    } catch {
      return [];
    }
  }

  /** Lit un ou plusieurs fichiers (lignes illisibles ignorées). */
  static read(files: string[]): JournalLine[] {
    const out: JournalLine[] = [];
    for (const f of files) {
      let txt = '';
      try {
        txt = fs.readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      for (const l of txt.split('\n')) {
        if (!l.trim()) continue;
        try {
          out.push(JSON.parse(l) as JournalLine);
        } catch {
          /* ligne coupée (arrêt brutal) */
        }
      }
    }
    return out;
  }

  /** Fichiers de la dernière soirée : on remonte depuis le plus récent tant qu'il n'y a pas eu
   *  plus de 2 h sans serveur entre deux fichiers (les relances pendant la soirée restent groupées,
   *  les essais de l'après-midi non). */
  static lastEvening(dir: string): string[] {
    const all = Journal.list(dir);
    if (!all.length) return [];
    const started = (f: string) => {
      const m = f.match(/(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)/);
      return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0;
    };
    const ended = (f: string) => {
      try {
        return fs.statSync(path.join(dir, f)).mtimeMs;
      } catch {
        return started(f);
      }
    };
    const out = [all[all.length - 1]];
    for (let i = all.length - 2; i >= 0; i--) {
      if (started(all[i + 1]) - ended(all[i]) > 2 * 3600e3) break;
      out.unshift(all[i]);
    }
    return out.map((f) => path.join(dir, f));
  }
}

/** Erreur → objet lisible pour le journal. */
export function errInfo(e: unknown): { message: string; stack?: string } {
  if (e instanceof Error) return { message: e.message, stack: e.stack?.split('\n').slice(0, 8).join('\n') };
  return { message: typeof e === 'string' ? e : JSON.stringify(e) };
}
