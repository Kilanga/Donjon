// Page « Bilan de la soirée » : classement, titres et moments forts, à capturer en fin de session.
import { CLASSES } from './game/data.js';
import type { Game } from './game/engine.js';
import type { Legend } from '../shared/types.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function recapHtml(game: Game, turnSeconds: number, legends: Legend[] = []): string {
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
    const c = d.text.split('Cause: ')[1]?.split('.')[0]?.trim() ?? 'unknown';
    causes.set(c, (causes.get(c) ?? 0) + 1);
  }
  const topCauses = [...causes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const minutes = Math.round((st.turn * turnSeconds) / 60);
  const deepest = Math.max(1, ...rows.map((r) => r.deepest));

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Dungeon — tonight's recap</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Grenze+Gotisch:wght@800&family=Alegreya:ital,wght@0,700;1,400&family=Alegreya+Sans:wght@400;700&display=swap">
<style>
body{margin:0;background:#e2ded3;color:#231d19;font:16px/1.5 'Alegreya Sans',system-ui,sans-serif;font-variant-numeric:lining-nums tabular-nums;padding:32px 20px}
main{max-width:980px;margin:0 auto;background:#f4f2ec;border:1px solid #c4bdae;padding:28px 32px}
h1{font-family:'Grenze Gotisch',serif;font-weight:800;color:#a3161b;font-size:64px;line-height:1;margin:0}
h2{font-family:Alegreya,serif;font-weight:700;font-size:22px;margin:30px 0 10px;padding-bottom:4px;border-bottom:3px double #c4bdae}
.sub{font-family:Alegreya,serif;font-style:italic;color:#4d453c;margin:6px 0 22px}
.titles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.title{background:#fffdf8;border:2px solid #231d19;border-radius:4px;padding:8px 12px;display:flex;flex-direction:column}
.title small{color:#6c6458;font-size:13px}
.title b{font-family:Alegreya,serif;font-size:20px}
table{width:100%;border-collapse:collapse}
th,td{padding:6px 10px;text-align:right;border-bottom:1px solid #e0dbcf}
th{color:#6c6458;font-weight:400;font-size:13px;border-bottom:1px solid #c4bdae}
td:nth-child(2),th:nth-child(2){text-align:left}
tr:nth-child(2) td{color:#a3161b;font-weight:700}
.m{border-left:3px solid #e0a826;padding:5px 12px;margin:6px 0;background:#fffdf8}
.m small{color:#6c6458;margin-right:8px}
.causes{display:flex;flex-wrap:wrap;gap:8px}
.causes span{background:#fbefec;border:1px solid #c99a94;color:#7a1014;border-radius:2px;padding:2px 9px;font-size:14px}
</style></head><body><main>
<h1>The Dungeon</h1>
<div class="sub">Tonight's recap · ${st.turn} turns (~${minutes} min) · ${rows.length} crawlers · deepest floor: ${deepest} · ${deaths.length} deaths</div>
<div class="titles">
${top('deepest', 'Deepest', 'floors')}${top('level', 'Strongest', 'levels')}${top('kills', 'Butcher', 'kills')}
${top('deaths', 'Death subscriber', 'deaths')}${top('betrayals', 'Traitor-in-chief', 'betrayals')}${top('gold', 'Richest', 'gold')}
</div>
${legends.length ? `<h2>Dungeon legends</h2><table><tr><th>Date</th><th>Crawler</th><th>Class</th><th>Lvl</th><th>Kills</th><th>Deaths</th><th>Floor</th></tr>${[...legends].reverse().map((l) => `<tr><td>${new Date(l.date).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(l.name)}${l.bot ? ' <small>(NPC)</small>' : ''}</td><td>${CLASSES[l.cls].label}</td><td>${l.level}</td><td>${l.kills}</td><td>${l.deaths}</td><td>${l.floor}</td></tr>`).join('')}</table>` : ''}
<h2>Leaderboard</h2>
<table><tr><th>#</th><th>Crawler</th><th>Class</th><th>Lvl</th><th>Deepest</th><th>Kills</th><th>Deaths</th><th>Betrayals</th><th>Gold</th></tr>
${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${CLASSES[r.cls].label}</td><td>${r.level}</td><td>${r.deepest}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.betrayals}</td><td>${r.gold}</td></tr>`).join('')}
</table>
${moments.length ? `<h2>Highlights</h2>${moments.map((e) => `<div class="m"><small>Turn ${e.turn}</small>${esc(e.text)}</div>`).join('')}` : ''}
${topCauses.length ? `<h2>Causes of death</h2><div class="causes">${topCauses.map(([c, n]) => `<span>${esc(c)} · ${n}</span>`).join('')}</div>` : ''}
</main></body></html>`;
}
