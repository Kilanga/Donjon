import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Journal } from '../src/server/journal';
import { buildReport } from '../src/server/report';

describe('journal de session', () => {
  it('écrit en JSONL, masque les secrets et se relit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'donjon-logs-'));
    const j = new Journal(dir);
    j.turn = () => 7;
    j.secrets = ['cle-secrete-42'];
    j.write('log', { text: 'Régie : http://x/?spectateur=cle-secrete-42' });
    j.write('bug', { name: 'Zoé', text: 'je suis coincée', src: 'web', ctx: { cls: 'mage', level: 2, floor: 1, roomId: 3, hp: 4, maxHp: 8 } });
    j.flush();
    const raw = fs.readFileSync(j.file, 'utf8');
    expect(raw).not.toContain('cle-secrete-42');
    const lines = Journal.read(Journal.lastEvening(dir));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ k: 'bug', turn: 7, name: 'Zoé' });
  });

  it('produit un rapport même avec un journal minimal ou vide', () => {
    expect(buildReport([])).toContain('Aucun journal');
    const t = new Date().toISOString();
    const md = buildReport([
      { t, k: 'start', turn: 0, version: '0.1.0', config: {} },
      { t, k: 'cmd', turn: 1, name: 'Zoé', text: '!nord', ok: false, reply: 'Pas de porte au nord.', src: 'web', ms: 1 },
      { t, k: 'bug', turn: 1, name: 'Zoé', text: 'je suis coincée', src: 'web', ctx: {} },
      { t, k: 'error', turn: 1, source: 'serveur', message: 'boum 12' },
      { t, k: 'error', turn: 2, source: 'serveur', message: 'boum 13' },
    ]);
    expect(md).toContain('je suis coincée');
    expect(md).toContain('Pas de porte au nord.');
    expect(md).toContain('×2'); // erreurs regroupées malgré les chiffres
  });
});
