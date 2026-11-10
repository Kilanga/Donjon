// Fichiers de données : écriture atomique (fichier temporaire puis renommage) et lecture qui met de côté un fichier abîmé
// au lieu de l'écraser (on ne perd jamais l'historique sur un fichier corrompu).
import fs from 'node:fs';
import path from 'node:path';

export function writeAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Lit un JSON. Absent : undefined. Illisible : le fichier est renommé en « .corrompu-<date>.json » et on renvoie undefined. */
export function readJsonSafe<T>(file: string, label: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as T;
  } catch (e) {
    const aside = file.replace(/\.json$/, '') + `.corrompu-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    try {
      fs.renameSync(file, aside);
    } catch {
      /* tant pis, on ne l'écrasera pas plus tard non plus : l'appelant repart de zéro */
    }
    console.error(`[${label}] fichier illisible, mis de côté dans ${path.basename(aside)} :`, (e as Error).message);
    return undefined;
  }
}
