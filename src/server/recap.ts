// Page « Bilan de la soirée » : classement, titres et moments forts, à capturer en fin de session.
import { CLASSES } from './game/data.js';
import type { Game } from './game/engine.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function recapHtml(game: Game, turnSeconds: number): string {
  const st = game.state;
  const rows = game.leaderboard();
  const top = (k: 'kills' | 'deaths' | 'betrayals' | 'gold' | 'deepest' | 'level', label: string, unit: string) => {
    const r = [...rows].sort((a, b) => b[k] - a[k])[0];
    return r && r[k] > 0 ? `<div class="title"><small>${label}</small><b>${esc(r.name)}</b><span>${r[k]} ${unit}</span></div>` : '';
  };
  const moments = [...st.events]
    .filter((e) => e.scope !== 'prive' && e.drama >= 60)
    .sort((a, b) => b.drama - a.drama || a.turn - b.turn)
    .slice(0, 15)
    .sort((a, b) => a.turn - b.turn);
  const deaths = st.events.filter((e) => e.kind === 'mort');
  const causes = new Map<string, number>();
  for (const d of deaths) {
    const c = d.text.split('Cause : ')[1]?.split('.')[0]?.trim() ?? 'inconnue';
    causes.set(c, (causes.get(c) ?? 0) + 1);
  }
  const topCauses = [...causes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const minutes = Math.round((st.turn * turnSeconds) / 60);
  const deepest = Math.max(1, ...rows.map((r) => r.deepest));

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Le Donjon — bilan de la soirée</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@500;700&family=Inter:wght@400;600&display=swap">
<style>
body{margin:0;background:#0c0a12;color:#ece6f6;font:15px/1.5 Inter,system-ui,sans-serif;padding:32px 20px}
main{max-width:980px;margin:0 auto}
h1{font-family:'Pixelify Sans',monospace;color:#ffd65a;font-size:44px;margin:0;text-shadow:3px 3px 0 #000}
h2{font-family:'Pixelify Sans',monospace;color:#ffd65a;margin:28px 0 10px}
.sub{color:#9a90ad;margin-bottom:20px}
.titles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.title{background:#171320;border:1px solid #2f2740;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column}
.title small{color:#9a90ad;text-transform:uppercase;font-size:11px;letter-spacing:.5px}
.title b{font-size:18px;color:#ffd65a}
table{width:100%;border-collapse:collapse;background:#171320;border-radius:10px;overflow:hidden}
th,td{padding:7px 10px;text-align:right;border-bottom:1px solid #241d31}
th{color:#9a90ad;font-weight:600;font-size:12px;text-transform:uppercase}
td:nth-child(2),th:nth-child(2){text-align:left}
tr:first-child td{color:#ffd65a;font-weight:600}
.m{background:#171320;border-left:3px solid #a77bff;padding:7px 12px;margin:6px 0;border-radius:0 8px 8px 0}
.m small{color:#6f6884;margin-right:8px}
.causes{display:flex;flex-wrap:wrap;gap:8px}
.causes span{background:#2a1820;border:1px solid #5a2232;border-radius:999px;padding:3px 10px;font-size:13px}
</style></head><body><main>
<h1>LE DONJON</h1>
<div class="sub">Bilan de la soirée · ${st.turn} tours (~${minutes} min) · ${rows.length} crawlers · étage le plus profond : ${deepest} · ${deaths.length} morts</div>
<div class="titles">
${top('deepest', 'Le plus profond', 'étages')}${top('level', 'Le plus fort', 'niveaux')}${top('kills', 'Boucher', 'kills')}
${top('deaths', 'Abonné à la mort', 'morts')}${top('betrayals', 'Traître en chef', 'trahisons')}${top('gold', 'Le plus riche', 'po')}
</div>
<h2>Classement</h2>
<table><tr><th>#</th><th>Crawler</th><th>Classe</th><th>Niv.</th><th>Étage max</th><th>Kills</th><th>Morts</th><th>Trahisons</th><th>Or</th></tr>
${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${CLASSES[r.cls].label}</td><td>${r.level}</td><td>${r.deepest}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.betrayals}</td><td>${r.gold}</td></tr>`).join('')}
</table>
${moments.length ? `<h2>Moments forts</h2>${moments.map((e) => `<div class="m"><small>Tour ${e.turn}</small>${esc(e.text)}</div>`).join('')}` : ''}
${topCauses.length ? `<h2>Causes de décès</h2><div class="causes">${topCauses.map(([c, n]) => `<span>${esc(c)} · ${n}</span>`).join('')}</div>` : ''}
</main></body></html>`;
}
