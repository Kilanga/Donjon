// Rapport de session : résume le journal (logs/*.jsonl) en un Markdown à renvoyer à Claude.
import type { JournalLine } from './journal.js';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const clip = (t: string, n = 160) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
const cell = (t: unknown) => clip(s(t).replace(/\|/g, '/').replace(/\s+/g, ' '), 200);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '—');
const hm = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function count<T>(arr: T[], key: (x: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const x of arr) {
    const k = key(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}
function table(head: string[], rows: unknown[][]): string {
  if (!rows.length) return '_rien_\n';
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n') + '\n';
}
/** Erreurs regroupées par message (les chiffres variables sont fondus). */
function groupErrors(lines: JournalLine[]) {
  const m = new Map<string, { n: number; first: JournalLine; who: Set<string> }>();
  for (const l of lines) {
    const key = s(l.message).replace(/\d+/g, '#').slice(0, 200);
    const g = m.get(key) ?? { n: 0, first: l, who: new Set<string>() };
    g.n++;
    if (l.name) g.who.add(s(l.name));
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

export function buildReport(lines: JournalLine[], files: string[] = []): string {
  const out: string[] = [];
  const by = (k: string) => lines.filter((l) => l.k === k);
  if (!lines.length) return '# Rapport de session — Le Donjon\n\nAucun journal trouvé (dossier `logs/` vide).\n';

  const t0 = Date.parse(lines[0].t);
  const t1 = Date.parse(lines[lines.length - 1].t);
  const starts = by('start');
  const stops = by('stop');
  const allCmds = by('cmd');
  const cmds = allCmds.filter((l) => l.src !== 'bot'); // les PNJ figurants ne comptent pas dans la participation
  const says = by('say');
  const events = by('event');
  const turns = by('turn');
  const conns = by('connect');
  const errors = by('error');
  const clientErrors = by('clientError');
  const bugs = by('bug');
  const avis = by('avis');
  const admins = by('admin');
  const perfs = by('clientPerf');
  const snaps = by('snapshot');

  // ------------------------------------------------------------ en-tête
  out.push('# Rapport de session — Le Donjon\n');
  out.push(`- Période : ${new Date(t0).toLocaleString('fr-FR')} → ${new Date(t1).toLocaleString('fr-FR')} (${hm(t1 - t0)})`);
  out.push(`- Fichiers : ${files.length ? files.map((f) => '`' + f.split(/[\\/]/).pop() + '`').join(', ') : '—'}`);
  out.push(`- Démarrages du serveur : ${starts.length} · arrêts propres : ${stops.length}${starts.length > stops.length + 1 ? ' ⚠️ (arrêt brutal ou plantage probable)' : ''}`);
  const st = starts[starts.length - 1];
  if (st) {
    out.push(`- Version : ${s(st.version)} (commit ${s(st.commit) || 'inconnu'}) · Node ${s(st.node)} · ${s(st.platform)}`);
    out.push(`- Réglages : \`${JSON.stringify(st.config)}\``);
  }
  const maxTurn = Math.max(0, ...lines.map((l) => Number(l.turn) || 0));
  out.push(`- Tours joués : ${turns.length} (dernier tour : ${maxTurn})`);
  out.push(`- **${bugs.length} bug(s) signalé(s)**, ${avis.length} avis, ${errors.length} erreur(s) serveur, ${clientErrors.length} erreur(s) navigateur\n`);

  // ------------------------------------------------- retours des joueurs
  out.push('## Retours des joueurs (!bug et !avis)\n');
  const fb = [...bugs, ...avis].sort((a, b) => a.t.localeCompare(b.t));
  if (!fb.length) out.push('_Aucun retour._\n');
  for (const l of fb) {
    const c = (l.ctx ?? {}) as Record<string, unknown>;
    out.push(`- **${l.k === 'bug' ? '🐞 Bug' : '💬 Avis'}** ${clock(l.t)} · tour ${l.turn} · **${s(l.name)}** (${s(l.src)}) : « ${s(l.text)} »`);
    if (c.cls) out.push(`  - contexte : ${s(c.cls)} niv ${s(c.level)}, étage ${s(c.floor)} salle ${s(c.roomId)}, ${s(c.hp)}/${s(c.maxHp)} PV${c.alive === false ? ', mort' : ''}${c.device ? ', ' + s(c.device) : ''}`);
    const recent = (c.recent as string[] | undefined) ?? [];
    if (recent.length) out.push(`  - juste avant : ${recent.map((x) => '« ' + clip(x, 110) + ' »').join(' · ')}`);
  }
  out.push('');

  // ------------------------------------------------------------ erreurs
  out.push('## Erreurs serveur\n');
  const ge = groupErrors(errors);
  if (!ge.length) out.push('_Aucune._\n');
  for (const g of ge.slice(0, 15)) {
    out.push(`- **×${g.n}** (première à ${clock(g.first.t)}, tour ${g.first.turn}, ${s(g.first.source)}) : ${clip(s(g.first.message), 300)}`);
    if (g.first.stack) out.push('  ```\n' + s(g.first.stack).split('\n').map((x) => '  ' + x).join('\n') + '\n  ```');
  }
  out.push('\n## Erreurs dans les navigateurs\n');
  const gc = groupErrors(clientErrors);
  if (!gc.length) out.push('_Aucune._\n');
  for (const g of gc.slice(0, 15)) {
    out.push(`- **×${g.n}** (${g.who.size} joueur(s) : ${[...g.who].slice(0, 6).join(', ')}) ${s(g.first.page)} : ${clip(s(g.first.message), 300)}`);
    out.push(`  - appareil : ${clip(s(g.first.ua), 140)}`);
    if (g.first.stack) out.push('  ```\n' + s(g.first.stack).split('\n').slice(0, 6).map((x) => '  ' + x).join('\n') + '\n  ```');
  }
  out.push('');

  // ----------------------------------------------------- participation
  out.push('## Participation\n');
  const players = conns.filter((l) => !l.spectator && l.name);
  const uniq = new Map<string, JournalLine>();
  for (const l of players) uniq.set(s(l.name).toLowerCase(), l);
  const mobile = [...uniq.values()].filter((l) => l.mobile).length;
  out.push(`- Joueurs distincts sur la page : ${uniq.size} (${mobile} sur téléphone) · connexions : ${players.length} · régie : ${conns.filter((l) => l.spectator).length}`);
  const twitchNames = new Set(cmds.filter((l) => l.src === 'twitch').map((l) => s(l.name).toLowerCase()));
  out.push(`- Joueurs venus du chat Twitch : ${twitchNames.size}`);
  out.push(`- PNJ figurants : jusqu'à ${Math.max(0, ...turns.map((l) => Number(l.bots) || 0))} en jeu (exclus des statistiques de participation)`);
  const peak = Math.max(0, ...turns.map((l) => Number(l.online) || 0));
  out.push(`- Pic de pages ouvertes : ${peak} · pic de crawlers en jeu : ${Math.max(0, ...turns.map((l) => Number(l.players) || 0))}`);
  out.push(`- Commandes : ${cmds.length} (${pct(cmds.filter((l) => !l.ok).length, cmds.length)} refusées) · messages libres : ${says.length} · anti-spam déclenché : ${by('spam').length} fois\n`);

  const perPlayer = count(cmds, (l) => s(l.name));
  const lastSnap = snaps[snaps.length - 1];
  const finalPlayers = new Map<string, Record<string, unknown>>();
  for (const p of ((lastSnap?.leaderboard as Record<string, unknown>[]) ?? [])) finalPlayers.set(s(p.name).toLowerCase(), p);
  out.push(
    table(
      ['Joueur', 'Commandes', 'Refusées', 'Messages', 'Classe', 'Niveau', 'Étage max', 'Kills', 'Morts', 'Appareil'],
      perPlayer.slice(0, 40).map(([name, n]) => {
        const p = finalPlayers.get(name.toLowerCase()) ?? {};
        const dev = uniq.get(name.toLowerCase());
        return [name, n, cmds.filter((l) => l.name === name && !l.ok).length, says.filter((l) => l.name === name).length, p.cls, p.level, p.deepest, p.kills, p.deaths, dev ? (dev.mobile ? 'téléphone' : 'ordinateur') : 'Twitch'];
      }),
    ),
  );

  // ---------------------------------------------------- commandes
  out.push('## Commandes\n');
  const word = (t: string) => (t.trim().split(/\s+/)[0] || '').toLowerCase();
  out.push('**Les plus utilisées**\n');
  out.push(table(['Commande', 'Fois', 'Refusées'], count(cmds, (l) => word(s(l.text))).slice(0, 20).map(([w, n]) => [w, n, cmds.filter((l) => word(s(l.text)) === w && !l.ok).length])));
  out.push('\n**Réponses de refus les plus fréquentes** (là où les joueurs bloquent)\n');
  out.push(table(['Réponse du jeu', 'Fois', 'Exemple tapé'], count(cmds.filter((l) => !l.ok), (l) => s(l.reply).replace(/\d+/g, '#')).slice(0, 15).map(([r, n]) => [r, n, s(cmds.find((l) => !l.ok && s(l.reply).replace(/\d+/g, '#') === r)?.text)])));
  const slow = cmds.filter((l) => Number(l.ms) > 50);
  if (slow.length) out.push(`\n⚠️ ${slow.length} commande(s) ont pris plus de 50 ms (max ${Math.max(...slow.map((l) => Number(l.ms)))} ms).\n`);

  // ---------------------------------------------------- partie
  out.push('\n## Déroulé de la partie\n');
  const fx = count(events.filter((e) => (e.fx as { kind?: string } | undefined)?.kind), (e) => s((e.fx as { kind: string }).kind));
  out.push(`- Évènements : ${events.length} · par effet : ${fx.map(([k, n]) => `${k} ${n}`).join(', ') || '—'}`);
  out.push(`- Par type : ${count(events, (e) => s(e.kind)).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  const deaths = events.filter((e) => (e.fx as { kind?: string } | undefined)?.kind === 'death');
  const causes = count(deaths, (e) => {
    const m = s(e.text).match(/Cause ?: ([^.]+)/);
    if (!m) return 'inconnue';
    return /effondrement/.test(m[1]) ? "effondrement de l'étage" : /piège|trap/i.test(m[1]) ? 'piège' : m[1].trim().replace(/\d+/g, '#');
  });
  out.push(`- Morts de joueurs : ${deaths.length}${causes.length ? ' · causes : ' + causes.slice(0, 10).map(([c, n]) => `${c} (${n})`).join(', ') : ''}`);
  out.push(`- Trahisons : ${events.filter((e) => e.kind === 'trahison').length} · alliances : ${events.filter((e) => e.kind === 'alliance').length} · montées de niveau : ${events.filter((e) => e.kind === 'niveau').length}`);
  out.push(`- Étage le plus profond : ${Math.max(0, ...events.map((e) => Number(e.floor) || 0))}`);
  const prod = events.filter((e) => /production|vote/i.test(s(e.text)) && e.scope === 'global');
  if (prod.length) out.push(`- Annonces de la production : ${prod.length}, par ex. ${prod.slice(0, 4).map((e) => '« ' + clip(s(e.text), 90) + ' »').join(' · ')}`);
  out.push(`- Commentaires de l'IA du donjon : ${events.filter((e) => e.narrator).length}\n`);

  // Ligne du temps par tranches de 10 minutes
  out.push('**Activité par tranche de 10 minutes**\n');
  const slots = new Map<number, { cmd: number; ev: number; deaths: number; online: number; players: number }>();
  const slot = (l: JournalLine) => Math.floor((Date.parse(l.t) - t0) / 600000);
  for (const l of lines) {
    const k = slot(l);
    const v = slots.get(k) ?? { cmd: 0, ev: 0, deaths: 0, online: 0, players: 0 };
    if (l.k === 'cmd') v.cmd++;
    if (l.k === 'event') v.ev++;
    if (l.k === 'event' && deaths.includes(l)) v.deaths++;
    if (l.k === 'turn') {
      v.online = Math.max(v.online, Number(l.online) || 0);
      v.players = Math.max(v.players, Number(l.alive) || 0);
    }
    slots.set(k, v);
  }
  out.push(table(['Début', 'Pages ouvertes', 'Crawlers vivants', 'Commandes', 'Évènements', 'Morts'], [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [clock(new Date(t0 + k * 600000).toISOString()), v.online, v.players, v.cmd, v.ev, v.deaths])));

  // ------------------------------------------------------ classement
  if (lastSnap) {
    out.push(`\n## Classement final (tour ${lastSnap.turn})\n`);
    const lb = (lastSnap.leaderboard as Record<string, unknown>[]) ?? [];
    out.push(table(['#', 'Joueur', 'Classe', 'Niveau', 'Étage max', 'Kills', 'Morts', 'Or'], lb.slice(0, 15).map((r, i) => {
      return [i + 1, `${r.name}${r.bot ? ' (PNJ)' : ''}`, r.cls, r.level, r.deepest, r.kills, r.deaths, r.gold];
    })));
  }

  // ------------------------------------------------------ technique
  out.push('\n## Technique\n');
  const tickMs = turns.map((l) => Number(l.ms) || 0);
  const late = turns.map((l) => Number(l.late) || 0);
  out.push(`- Calcul d'un tour : médiane ${quantile(tickMs, 0.5)} ms, 95 % ${quantile(tickMs, 0.95)} ms, max ${Math.max(0, ...tickMs)} ms`);
  out.push(`- Retard des tours sur l'horaire : 95 % ${quantile(late, 0.95)} ms, max ${Math.max(0, ...late)} ms`);
  if (perfs.length) {
    const fps = perfs.map((l) => Number(l.fps) || 0).filter((x) => x > 0);
    const low = perfs.filter((l) => Number(l.fps) > 0 && Number(l.fps) < 30);
    out.push(`- Images/seconde des pages : médiane ${quantile(fps, 0.5)}, 10 % les plus lentes ≤ ${quantile(fps, 0.1)}${low.length ? ` · sous 30 i/s : ${[...new Set(low.map((l) => s(l.name) || 'régie'))].join(', ')}` : ''}`);
  }
  const disc = by('disconnect');
  const shortVisits = disc.filter((l) => !l.spectator && Number(l.secs) < 20).length;
  out.push(`- Déconnexions : ${disc.length} (dont ${shortVisits} après moins de 20 s : rechargements ou réseau instable)`);
  out.push('');

  // ------------------------------------------------------ régie
  out.push('## Actions de la régie\n');
  out.push(admins.length ? admins.map((l) => `- ${clock(l.t)} · tour ${l.turn} : ${s(l.action)}${l.arg !== undefined ? ' ' + s(l.arg) : ''} → ${s(l.msg)}`).join('\n') + '\n' : '_Aucune._\n');

  // ------------------------------------------------------ extraits
  out.push('## Moments forts (drame le plus élevé)\n');
  const top = [...events].filter((e) => e.scope !== 'prive').sort((a, b) => (Number(b.drama) || 0) - (Number(a.drama) || 0)).slice(0, 12);
  out.push(top.map((e) => `- tour ${e.turn}, étage ${s(e.floor)} (drame ${s(e.drama)}) : ${clip(s(e.text), 200)}`).join('\n') + '\n');

  out.push('\n---\n_Rapport généré automatiquement. Le journal complet (`.jsonl`) contient chaque commande et chaque évènement si besoin de creuser._\n');
  return out.join('\n');
}
