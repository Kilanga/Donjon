// Victoria anime l'émission : déroulé (inscriptions, règles, étages, compte à rebours, escalier, fin), accueil des
// nouveaux, rubriques quand l'antenne est trop calme, et réactions aux événements Twitch (abonnements, bits, raids).
// Les grands moments eux-mêmes (morts, trahisons, effondrements…) restent commentés par Narrator.onTurn.
import type { GameEvent } from '../shared/types.js';
import { THEME_LABEL, THEME_EFFECTS } from '../shared/themes.js';
import type { Game } from './game/engine.js';
import { CHATTY, type Narrator } from './narrator.js';

export type TwitchEvent =
  | { kind: 'sub'; user: string; months: number }
  | { kind: 'gift'; user: string; count: number }
  | { kind: 'bits'; user: string; bits: number }
  | { kind: 'raid'; user: string; viewers: number };

const WELCOME_EVERY_MS = 45_000;
const RULES_AFTER_MS = 25_000; // les règles, juste après le « THE GAME BEGINS! » commenté par onTurn
const TWITCH_MERGE_MS = 20_000; // plusieurs cadeaux d'affilée : une seule annonce

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));
const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;
const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

type Segment = 'leaderboard' | 'race' | 'spotlight' | 'story' | 'join' | 'stakes' | 'roster';
const SEGMENTS: Segment[] = ['leaderboard', 'join', 'race', 'spotlight', 'stakes', 'story'];
const LOBBY_SEGMENTS: Segment[] = ['join', 'roster'];

export class Host {
  private said = new Set<string>();
  private seen = new Set<string>();
  private started = false;
  private welcome: string[] = [];
  private lastWelcome = 0;
  private segment = 0;
  private lastSegmentAt = 0;
  private spotlit: string[] = [];
  private notes: string[] = []; // les petites histoires de la soirée (trahisons, morts, boss)
  private lastTwitch = new Map<string, { at: number }>();

  constructor(
    private game: Game,
    private narrator: Narrator,
    private rand: () => number = Math.random,
  ) {}

  private once(key: string): boolean {
    if (this.said.has(key)) return false;
    this.said.add(key);
    return true;
  }

  private humans(floor?: number) {
    return Object.values(this.game.state.players).filter((p) => !p.bot && p.alive && (floor === undefined || p.floor === floor));
  }

  /** À chaque seconde : le déroulé de l'émission. */
  tick(now = Date.now()) {
    const s = this.game.state;
    // Les présents au démarrage du serveur ne sont pas « nouveaux »
    for (const p of Object.values(s.players)) {
      if (p.bot || this.seen.has(p.key)) continue;
      this.seen.add(p.key);
      const lobby = !!s.lobbyUntil && now < s.lobbyUntil;
      if (this.started && (lobby || (s.seasonStart !== null && now - s.seasonStart > RULES_AFTER_MS))) this.welcome.push(p.name);
    }
    this.started = true;
    if (s.seasonOver) return; // la fin de saison est commentée par onTurn (Légendes, vainqueurs)

    // Inscriptions ouvertes (salon d'attente)
    if (s.lobbyUntil && now < s.lobbyUntil && this.once(`lobby:${s.lobbyUntil}`)) {
      const m = minutes(s.lobbyUntil - now);
      void this.narrator.announce(
        `Sign-ups are open. The game starts in ${m} minutes. Viewers type !join in the chat to enter the Dungeon.`,
        `Sign-ups are open, darlings! The game starts in ${m} minutes. Type !join in the chat if you think you can survive.`,
        { urgent: true, floor: 1 },
      );
    }
    // Les nouveaux, accueillis par petits groupes
    if (this.welcome.length && now - this.lastWelcome > WELCOME_EVERY_MS && !this.narrator.busy(now)) {
      const names = this.welcome.splice(0, 6);
      this.lastWelcome = now;
      void this.narrator.announce(
        `Welcome to our new ${names.length > 1 ? 'contestants' : 'contestant'}: ${list(names)}.`,
        `A warm welcome to our new ${names.length > 1 ? 'contestants' : 'contestant'}, ${list(names)}. Make yourselves at home. While it lasts.`,
      ).then((ok) => {
        if (!ok) this.welcome.unshift(...names); // elle parlait : ce sera pour la prochaine fois
      });
    }

    if (s.seasonStart === null) return this.deadAir(now, true);

    // Les règles, une fois la partie lancée
    if (now - s.seasonStart > RULES_AFTER_MS && this.once(`rules:${s.seasonStart}`)) {
      void this.narrator.announce(
        'The rules in a nutshell: every floor collapses at a fixed time; its stairs only unseal in the last minutes, and a boss guards them; whoever is still inside when it collapses is out; the chat can vote the dead back; type !help for the commands.',
        "The rules, darlings: every floor collapses on schedule. The stairs only unseal in the last minutes, and a boss guards them. Still inside when it falls? You're out, unless the chat votes you back. Lost? Type !help.",
        { urgent: true, floor: 1, tone: 'crisp and theatrical, like the opening of a TV show' },
      );
    }

    // Les étages où il y a de vrais joueurs : arrivée, 5 min, 1 min, escalier
    for (const f of Object.values(s.floors)) {
      if (f.collapsed || f.collapseAt === null) continue;
      const here = this.humans(f.n);
      if (!here.length) continue;
      const id = `${s.seasonStart}:${f.n}:${f.collapseAt}`;
      const left = f.collapseAt - now;
      if (f.n > 1 && this.once(`floor:${id}`)) {
        const theme = THEME_LABEL[f.theme] ?? f.theme;
        const effect = THEME_EFFECTS[f.theme];
        void this.narrator.announce(
          `${list(here.map((p) => p.name))} reached floor ${f.n}. Its theme: ${theme}${effect ? ` (${effect})` : ''}. It collapses in ${minutes(left)} minutes.`,
          `Floor ${f.n}, everyone: ${theme}. ${list(here.map((p) => p.name))}, you have ${minutes(left)} minutes. Enjoy the view.`,
          { floor: f.n },
        );
      }
      if (f.warned5 && left > 60_000 && this.once(`five:${id}`)) {
        void this.narrator.announce(
          `Floor ${f.n} collapses in five minutes. ${plural(here.length, 'contestant')} still on it: ${list(here.map((p) => p.name))}.`,
          `Five minutes before floor ${f.n} collapses. ${list(here.map((p) => p.name))}, I would start running.`,
          { floor: f.n, urgent: true, tone: 'rising tension, a countdown on live television' },
        );
      }
      if (f.warned1 && left > 0 && this.once(`one:${id}`)) {
        void this.narrator.announce(
          `ONE minute before floor ${f.n} collapses, and ${list(here.map((p) => p.name))} ${here.length > 1 ? 'are' : 'is'} still inside.`,
          `One minute! Floor ${f.n} is about to fall, and ${list(here.map((p) => p.name))} ${here.length > 1 ? 'are' : 'is'} still inside. This is going to be close.`,
          { floor: f.n, urgent: true, tone: 'breathless, the final seconds of a game show' },
        );
      }
      if (f.stairsOpened && left > 0 && this.once(`stairs:${id}`)) {
        const boss = f.monsters.some((m) => m.boss && m.hp > 0);
        void this.narrator.announce(
          `The stairs of floor ${f.n} are unsealed. ${boss ? 'The boss still guards them.' : 'The boss is already down.'} ${minutes(left)} minutes before the collapse.`,
          `The stairs of floor ${f.n} are open! ${boss ? 'Of course, the boss is still guarding them.' : 'And the boss is already down. Go, go, go!'}`,
          { floor: f.n, urgent: true },
        );
      }
    }

    this.deadAir(now, false);
  }

  /** Antenne trop calme : une rubrique, jamais la même deux fois de suite. */
  private deadAir(now: number, lobby: boolean) {
    const quiet = CHATTY[this.narrator.chatty].quietMs;
    if (now - this.narrator.lastSpokeAt < quiet || now - this.lastSegmentAt < quiet || this.narrator.busy(now)) return;
    const pool = lobby ? LOBBY_SEGMENTS : SEGMENTS;
    for (let tries = 0; tries < pool.length; tries++) {
      const seg = pool[this.segment++ % pool.length];
      const text = this.segmentText(seg, now);
      if (!text) continue;
      this.lastSegmentAt = now;
      void this.narrator.announce(text[0], text[1], { tone: 'relaxed host filling the airtime, witty' });
      return;
    }
  }

  private segmentText(seg: Segment, now: number): [string, string] | null {
    const s = this.game.state;
    switch (seg) {
      case 'leaderboard': {
        const top = this.game.leaderboard().filter((r) => !r.bot).slice(0, 3);
        if (!top.length) return null;
        const rows = top.map((r, i) => `${i + 1}. ${r.name} (deepest floor ${r.deepest}, level ${r.level}${r.alive ? '' : ', dead'})`).join('; ');
        return [`Leaderboard update: ${rows}.`, `Leaderboard check! ${top.map((r) => r.name).join(', then ')}. Everyone else: try harder.`];
      }
      case 'race': {
        const lead = this.humans().sort((a, b) => b.floor - a.floor || b.level - a.level)[0];
        const f = lead && this.game.floor(lead.floor);
        if (!lead || !f || f.collapseAt === null) return null;
        const stairs = this.game.stairsInMs(f);
        const when = stairs === 0 ? 'the stairs are already open' : `the stairs unseal in ${minutes(stairs ?? 0)} minutes`;
        return [`The race for the exit: ${lead.name} leads, on floor ${lead.floor}; ${when}.`, `Out in front: ${lead.name}, on floor ${lead.floor}, and ${when}. Can anyone catch up?`];
      }
      case 'spotlight': {
        const pool = this.humans().filter((p) => !this.spotlit.includes(p.key));
        if (!pool.length) return null;
        const p = pool[Math.floor(this.rand() * pool.length)];
        this.spotlit = [...this.spotlit, p.key].slice(-5);
        return [
          `Spotlight on ${p.name}: a level ${p.level} ${p.cls} on floor ${p.floor}, with ${p.gold} gold and ${plural(p.kills, 'kill')}.`,
          `Spotlight on ${p.name}! Level ${p.level}, floor ${p.floor}, ${p.gold} gold in the pocket. Quietly dangerous, or just quiet?`,
        ];
      }
      case 'story': {
        if (!this.notes.length) return null;
        const picks = this.notes.slice(-2);
        this.notes = this.notes.slice(0, -2);
        return [`Callback to earlier tonight: ${picks.join(' Also: ')}`, `Let's not forget what happened earlier tonight. ${picks[picks.length - 1]}`];
      }
      case 'join': {
        if (s.joinsClosed) return ['The gates are sealed for this season. Viewers can still bet with !bet, sponsor a contestant with !sponsor, and vote to bring the dead back.', 'The gates are sealed, but you can still play along: !bet, !sponsor, and your vote when the dead beg to come back.'];
        const f1 = this.game.floor(1);
        if (s.seasonStart === null && !s.lobbyUntil) return ['A brand-new season is waiting for its first contestant. Viewers type !join in the chat to open the sign-ups.', 'A fresh dungeon, and nobody in it yet. Type !join in the chat, darlings, and let the show begin.'];
        const left = s.lobbyUntil ? s.lobbyUntil - now : f1?.collapseAt ? f1.collapseAt - now : null;
        const until = left && left > 0 ? ` Sign-ups close in ${minutes(left)} minutes.` : '';
        return [`Viewers can still join: type !join in the chat, or open the link at the bottom left of the stream.${until}`, `Want in? Type !join in the chat, or use the link at the bottom left.${until}`];
      }
      case 'roster': {
        const names = Object.values(s.players).filter((p) => !p.bot).map((p) => p.name);
        if (!names.length) return null;
        const shown = names.slice(0, 5);
        const more = names.length > shown.length ? ` and ${names.length - shown.length} more` : '';
        return [
          `${plural(names.length, 'contestant')} signed up so far: ${list(shown)}${more}. The game starts soon.`,
          `So far, ${plural(names.length, 'brave soul')} signed up: ${list(shown)}${more}. Who's next?`,
        ];
      }
      case 'stakes': {
        const floors = Object.values(s.floors).filter((f) => !f.collapsed && f.collapseAt !== null && this.humans(f.n).length);
        const f = floors.sort((a, b) => this.humans(b.n).length - this.humans(a.n).length)[0];
        if (!f) return null;
        const n = this.humans(f.n).length;
        return [`Floor ${f.n} collapses in ${minutes(f.collapseAt! - now)} minutes, with ${plural(n, 'contestant')} still on it.`, `Floor ${f.n} falls in ${minutes(f.collapseAt! - now)} minutes, and ${plural(n, 'contestant')} ${n > 1 ? 'are' : 'is'} still down there. Tick tock.`];
      }
    }
  }

  /** Les petites histoires de la soirée, pour y revenir pendant les rubriques. */
  onEvents(events: GameEvent[]) {
    for (const e of events) {
      if (e.narrator || e.scope === 'prive') continue;
      if ((e.kind === 'trahison' || e.kind === 'mort') && e.drama >= 40) this.notes.push(e.text.slice(0, 160));
      else if (e.kind === 'systeme' && / is defeated by /.test(e.text)) this.notes.push(e.text.split('!')[0].slice(0, 120) + '.');
    }
    this.notes = this.notes.slice(-10);
  }

  /** Abonnements, bits, raids : jamais le message de l'abonné, seulement qui et combien. */
  onTwitch(ev: TwitchEvent, now = Date.now()) {
    const last = this.lastTwitch.get(ev.kind);
    if (last && now - last.at < TWITCH_MERGE_MS && ev.kind !== 'raid') return; // une vague de cadeaux : une seule annonce
    this.lastTwitch.set(ev.kind, { at: now });
    const joinHint = this.game.state.joinsClosed ? '' : ' Type !join to play.';
    const [facts, fallback] =
      ev.kind === 'raid'
        ? [`${ev.user} is raiding the channel with ${ev.viewers} viewers. Welcome the raiders.${joinHint}`, `A raid! ${ev.user} brings ${ev.viewers} new faces. Welcome to the Dungeon, everyone.${joinHint}`]
        : ev.kind === 'sub'
          ? [`${ev.user} just subscribed${ev.months > 1 ? ` (${ev.months} months)` : ''}. Thank them.`, `${ev.user} subscribes${ev.months > 1 ? ` for ${ev.months} months` : ''}. Darling, you have impeccable taste.`]
          : ev.kind === 'gift'
            ? [`${ev.user} gifted ${plural(ev.count, 'subscription')} to the chat. Thank them.`, `${ev.user} just gifted ${plural(ev.count, 'sub')}. Generosity, on my show? How refreshing.`]
            : [`${ev.user} cheered ${ev.bits} bits. Thank them.`, `${ev.bits} bits from ${ev.user}. The Dungeon thanks you, and so do I.`];
    void this.narrator.announce(facts, fallback, { urgent: ev.kind === 'raid', tone: 'delighted, glamorous gratitude' });
  }
}
