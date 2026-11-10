// npm run rapport                 → rapport de la dernière soirée (logs/rapport-….md)
// npm run rapport -- logs/x.jsonl → rapport de fichiers précis
import fs from 'node:fs';
import path from 'node:path';
import { Journal, stamp } from '../src/server/journal.js';
import { buildReport } from '../src/server/report.js';

const logsDir = path.join(process.cwd(), 'logs');
const args = process.argv.slice(2).filter((a) => a !== '--');
const files = args.length ? args.map((a) => path.resolve(a)) : Journal.lastEvening(logsDir);
if (!files.length) {
  console.log('Aucun journal dans logs/ : lance le jeu (npm start) pour en produire.');
  process.exit(0);
}
const md = buildReport(Journal.read(files), files);
fs.mkdirSync(logsDir, { recursive: true });
const out = path.join(logsDir, `rapport-${stamp()}.md`);
fs.writeFileSync(out, md);
console.log(`Rapport écrit : ${out}`);
console.log(`(${files.length} journal(aux) : ${files.map((f) => path.basename(f)).join(', ')})`);
console.log('Envoie ce fichier à Claude, avec le journal complet (.jsonl) si possible.');
