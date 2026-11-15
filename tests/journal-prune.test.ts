import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pruneJournals } from '../src/server/journal.js';

describe('journaux de session', () => {
  it('on garde les plus récents, le reste du dossier n\'est pas touché', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journaux-'));
    for (let d = 1; d <= 5; d++) fs.writeFileSync(path.join(dir, `session-2026-11-0${d}_20-00.jsonl`), '{}');
    fs.writeFileSync(path.join(dir, 'voix.log'), 'x');
    expect(pruneJournals(dir, 3)).toEqual(['session-2026-11-01_20-00.jsonl', 'session-2026-11-02_20-00.jsonl']);
    expect(fs.readdirSync(dir).sort()).toEqual(['session-2026-11-03_20-00.jsonl', 'session-2026-11-04_20-00.jsonl', 'session-2026-11-05_20-00.jsonl', 'voix.log']);
  });
});
