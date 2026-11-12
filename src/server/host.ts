// Victoria anime l'émission : déroulé (inscriptions, règles, étages, compte à rebours, escalier, fin), accueil des
// nouveaux, rubriques quand l'antenne est trop calme, et réactions aux événements Twitch (abonnements, bits, raids).
// Les grands moments eux-mêmes (morts, trahisons, effondrements…) restent commentés par Narrator.onTurn.
import type { GameEvent } from '../shared/types.js';
import type { Hall } from './hall.js';
import { THEME_LABEL, THEME_EFFECTS } from '../shared/themes.js';
import { playerKey, type Game } from './game/engine.js';
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

type Segment = 'leaderboard' | 'race' | 'spotlight' | 'story' | 'join' | 'stakes' | 'roster' | 'chat' | 'pitch' | 'howto' | 'legends';
const SEGMENTS: Segment[] = ['leaderboard', 'chat', 'race', 'spotlight', 'join', 'stakes', 'chat', 'story'];
// Avant la partie : elle fait venir les joueurs (présenter l'émission, comment jouer, inscrits, questions au chat)
const LOBBY_SEGMENTS: Segment[] = ['pitch', 'join', 'legends', 'chat', 'howto', 'roster', 'pitch', 'chat', 'join'];
// Saison finie : le palmarès, les histoires de la soirée, le chat
const OVER_SEGMENTS: Segment[] = ['legends', 'chat', 'story'];
/** Avant la partie, elle peut occuper l'antenne à 55 % au moins (elle fait venir les joueurs). */
const LOBBY_AIR_MIN = 0.55;
const PLAY_FRESH_MS = 45_000; // une action de jeu se commente tant qu'elle date de moins de 45 s
const PLAY_KINDS = new Set(['combat', 'mort', 'loot', 'piege', 'niveau', 'drole', 'trahison', 'alliance']);

// Questions lancées au chat quand il est calme (Victoria les reformule)
const CHAT_QUESTIONS = [
  'Ask the chat who they think will survive this floor, and to say it in the chat.',
  'Ask the chat which contestant they would bet against tonight.',
  'Ask the chat what they would do with a pile of cursed gold.',
  'Ask the chat to pick a villain of the night.',
  'Ask the chat whether they would trust a smiling merchant in a dungeon.',
  'Ask the chat which monster scares them the most.',
];

export class Host {
  private said = new Set<string>();
  private seen = new Set<string>();
  private started = false;
  private welcome: string[] = [];
  private lastWelcome = 0;
  private segment = 0;
  private lastSegmentAt = 0;
  private spotlit: string[] = [];
  private question = 0;
  private beat = 0;
  private plays: { e: GameEvent; at: number }[] = [];
  private pitch = 0;
  private notes: string[] = []; // les petites histoires de la soirée (trahisons, morts, boss)
  private lastTwitch = new Map<string, { at: number }>();

  constructor(
    private game: Game,
    private narrator: Narrator,
    private rand: () => number = Math.random,
    private hall: Hall | null = null,
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
    this.narrator.tickChat(now);
    // Les présents au démarrage du serveur ne sont pas « nouveaux »
    for (const p of Object.values(s.players)) {
      if (p.bot || this.seen.has(p.key)) continue;
      this.seen.add(p.key);
      const lobby = !!s.lobbyUntil && now < s.lobbyUntil;
      if (this.started && (lobby || (s.seasonStart !== null && now - s.seasonStart > RULES_AFTER_MS))) this.welcome.push(p.name);
    }
    this.started = true;
    if (s.seasonOver) {
      // Le palmarès : le gagnant de la saison (et son total), puis elle meuble jusqu'à la prochaine
      const done = this.hall?.justClosed;
      if (done && !this.narrator.busy(now)) {
        this.hall!.justClosed = null;
        const h = done.winner ? this.hall!.player(playerKey(done.winner)) : undefined;
        const facts = done.winner
          ? `Season ${done.n} is over. Its winner: ${done.winner}, who walked out of the Dungeon a Legend. That makes ${h?.wins ?? 1} season win${(h?.wins ?? 1) > 1 ? 's' : ''} for ${done.winner}.`
          : `Season ${done.n} is over and nobody walked out: GAME OVER for all, the Dungeon wins this one.`;
        const fallback = done.winner ? `Season ${done.n} goes to ${done.winner}. Win number ${h?.wins ?? 1}. The Dungeon will remember. So will I.` : `Season ${done.n}: no winner. The Dungeon keeps the crown, darlings.`;
        void this.narrator.announce(facts, fallback, { urgent: true, tone: 'grand finale, theatrical, acid' });
        return;
      }
      return this.deadAir(now, 'over');
    }

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
      // Les habitués : Victoria connaît leur palmarès (« trois couronnes, et ça revient… »)
      const known = names.map((n) => [n, this.hall?.describe(playerKey(n))] as const).filter(([, d]) => d);
      const history = known.length ? ` Returning contestants, use their record: ${known.map(([n, d]) => `${n} (${d})`).join('; ')}. The others are first-timers.` : '';
      void this.narrator.announce(
        `Welcome to our new ${names.length > 1 ? 'contestants' : 'contestant'}: ${list(names)}.${history}`,
        `A warm welcome to our new ${names.length > 1 ? 'contestants' : 'contestant'}, ${list(names)}. Make yourselves at home. While it lasts.`,
      ).then((ok) => {
        if (!ok) this.welcome.unshift(...names); // elle parlait : ce sera pour la prochaine fois
      });
    }

    if (s.seasonStart === null) return this.deadAir(now, 'lobby');

    // Les règles, une fois la partie lancée
    if (now - s.seasonStart > RULES_AFTER_MS && this.once(`rules:${s.seasonStart}`)) {
      void this.narrator.announce(
        `The rules in a nutshell: every floor has its own countdown and collapses when it runs out; its stairs stay sealed for the first minutes and a boss guards them; whoever is still inside when it collapses is out; the chat can vote the dead back; on the last floor, kill the boss within ${minutes(this.game.floorSpan(this.game.cfg.finalFloor))} minutes or it is game over for everyone; type !help for the commands.`,
        "The rules, darlings: every floor has a countdown. The stairs stay sealed for a few minutes, and a boss guards them. Still inside when it falls? You're out, unless the chat votes you back. Lost? Type !help.",
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
        const final = f.n >= this.game.cfg.finalFloor;
        void this.narrator.announce(
          `${list(here.map((p) => p.name))} reached floor ${f.n}${final ? `, THE FINAL FLOOR: kill its boss within ${minutes(left)} minutes and everyone still standing walks out a Legend; otherwise it is GAME OVER for all` : ''}. Its theme: ${theme}${effect ? ` (${effect})` : ''}.${final ? '' : ` It collapses in ${minutes(left)} minutes.`}`,
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
      if (f.stairsOpened && left > 0 && f.n < this.game.cfg.finalFloor && this.once(`stairs:${id}`)) {
        const boss = f.monsters.some((m) => m.boss && m.hp > 0);
        void this.narrator.announce(
          `The stairs of floor ${f.n} are unsealed. ${boss ? 'The boss still guards them.' : 'The boss is already down.'} ${minutes(left)} minutes before the collapse.`,
          `The stairs of floor ${f.n} are open! ${boss ? 'Of course, the boss is still guarding them.' : 'And the boss is already down. Go, go, go!'}`,
          { floor: f.n, urgent: true },
        );
      }
    }

    this.deadAir(now, 'game');
  }

  /** Antenne trop calme : une rubrique, jamais la même deux fois de suite. */
  private deadAir(now: number, phase: 'lobby' | 'game' | 'over') {
    const lobby = phase !== 'game';
    const set = CHATTY[this.narrator.chatty];
    const quiet = set.quietMs;
    if (now - this.narrator.lastSpokeAt < quiet || now - this.lastSegmentAt < quiet || this.narrator.busy(now)) return;
    // En partie : surtout de l'action en direct (joueurs ou PNJ), une rubrique de temps en temps
    if (!lobby && this.beat++ % 3 !== 2 && this.playByPlay(now)) return;
    const pool = phase === 'over' ? OVER_SEGMENTS : lobby ? LOBBY_SEGMENTS : SEGMENTS;
    for (let tries = 0; tries < pool.length; tries++) {
      const seg = pool[this.segment++ % pool.length];
      const text = this.segmentText(seg, now);
      if (!text) continue;
      this.lastSegmentAt = now;
      void this.narrator.announce(text[0], text[1], {
        tone: lobby ? 'warm-up host before the show, magnetic, makes people want to play' : 'relaxed host filling the airtime, witty',
        context: this.notes.slice(-2).join(' '),
        withChat: true,
        maxAir: lobby ? Math.max(LOBBY_AIR_MIN, set.air) : undefined,
      });
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
      case 'chat': {
        const q = CHAT_QUESTIONS[this.question++ % CHAT_QUESTIONS.length];
        const fallbacks = ['Chat, talk to me: who survives this floor? I want names.', 'Tell me in the chat, darlings: who is the villain of the night?', 'Chat, a question: would you trust a smiling merchant in a dungeon? Thought not.'];
        return [
          this.narrator.chatSummary(now) ? 'Talk with the chat: react to one of the messages below, by name, then throw a question back at them.' : q,
          fallbacks[this.question % fallbacks.length],
        ];
      }
      case 'legends': {
        const sum = this.hall?.summary();
        if (!sum) return null;
        return [`Talk about the hall of fame and dare someone to dethrone the champions. ${sum}`, `${sum} Who dares to take the crown?`];
      }
      case 'pitch': {
        const pitches: [string, string][] = [
          ['Pitch the show to viewers who just arrived: The Dungeon is a game played entirely from the Twitch chat. Each viewer controls a crawler, explores floors that collapse on a timer, fights monsters and a boss on every floor, and the deepest crawler wins the season. Type !join to enter.', 'Just arrived? This is The Dungeon: you play it from the chat. Your crawler, your floors, a boss on each, and the floors collapse on a timer. Type !join, darling.'],
          ['Tease what is waiting below: eight floors, each with its own theme, merchants and a blacksmith, a crypt where the dead can be brought back, strange rooms with altars and wishing wells, and a boss guarding every staircase. Only the bold should type !join.', 'Eight floors, a boss on each, wishing wells, a crypt, a merchant who smiles too much. Type !join if you dare.'],
          ['Tell lurkers they can play too, even without a Twitch account: the link at the bottom left of the stream opens the game in a browser. Or type !join in the chat.', 'Lurkers, I see you. No excuses: type !join, or open the link at the bottom left of the stream.'],
          ['Say that even viewers who do not play take part: they bet on who falls first with !bet, sponsor a contestant with !sponsor, and vote to bring the dead back.', 'Not playing? You still matter: bet with !bet, sponsor with !sponsor, and vote the dead back in.'],
        ];
        return pitches[this.pitch++ % pitches.length];
      }
      case 'howto': {
        if (s.joinsClosed) return null;
        return [
          'Explain in a few words how to play: !join to enter (pick a class: barbarian, knight, rogue or mage), then !north, !south, !east, !west to move, !attack to fight, !search to loot, and !help for every command.',
          'How to play: !join, pick a class, then move with !north, !south, !east, !west, fight with !attack, loot with !search. !help for the rest.',
        ];
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
  /** Commentaire en direct de l'action la plus forte des 45 dernières secondes (joueurs ou PNJ). */
  private playByPlay(now: number): boolean {
    this.plays = this.plays.filter((p) => now - p.at < PLAY_FRESH_MS);
    const best = [...this.plays].sort((a, b) => b.e.drama - a.e.drama || b.at - a.at)[0];
    if (!best) return false;
    this.plays = this.plays.filter((p) => p !== best && p.e.floor !== best.e.floor); // pas deux fois la même scène
    this.lastSegmentAt = now;
    void this.narrator.announce(
      `Live play-by-play, it just happened on floor ${best.e.floor}: ${best.e.text}`,
      '',
      { tone: 'live commentator rooting for the Dungeon: acid, gleeful, quick', context: this.notes.slice(-2).join(' '), floor: best.e.floor, aiOnly: true },
    );
    return true;
  }

  onEvents(events: GameEvent[]) {
    const now = Date.now();
    for (const e of events) {
      if (e.narrator || e.scope === 'prive') continue;
      if (PLAY_KINDS.has(e.kind) && e.drama >= 5 && e.text.length < 400) this.plays.push({ e, at: now });
      if ((e.kind === 'trahison' || e.kind === 'mort') && e.drama >= 40) this.notes.push(e.text.slice(0, 160));
      else if (e.kind === 'systeme' && / is defeated by /.test(e.text)) this.notes.push(e.text.split('!')[0].slice(0, 120) + '.');
    }
    this.notes = this.notes.slice(-10);
    this.plays = this.plays.slice(-30);
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
