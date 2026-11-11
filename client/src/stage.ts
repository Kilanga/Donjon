// Mise en scène : relie les évènements aux effets visuels, aux sons et à la caméra réalisateur.
import { normalize } from '../../src/shared/commands';
import type { GameEvent, GameFx, PlayerViewMsg } from '../../src/shared/types';
import { Director } from './director';
import type { MapRenderer } from './map';
import { sfx, type SoundName } from './sfx';

const FX_SOUND: Record<GameFx['kind'], SoundName> = {
  hit: 'hit', crit: 'crit', miss: 'miss', gag: 'gag', death: 'death', kill: 'kill', loot: 'coin', levelup: 'levelup', trap: 'trap', heal: 'heal', forge: 'forge',
};

const keyOf = (name: string) => normalize(name).replace(/^@/, '').replace(/[^a-z0-9_]/g, '_').slice(0, 25);

export class Stage {
  readonly director: Director | null;
  private map: MapRenderer;
  private spectator: boolean;
  private state: PlayerViewMsg | null = null;
  private lastRoom: string | null = null;
  private lastTick = -1;

  constructor(map: MapRenderer, mapWrap: HTMLElement, spectator: boolean) {
    this.map = map;
    this.spectator = spectator;
    map.spectator = spectator;
    this.director = spectator ? new Director(map, mapWrap) : null;
    if (this.director) this.director.onChange = () => this.renderTools();

    // Le son ne peut démarrer qu'après une interaction
    const unlock = () => sfx.unlock();
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);

    // Bouton son dans l'en-tête
    const btn = document.createElement('button');
    btn.id = 'sound-btn';
    const paint = () => {
      btn.textContent = sfx.muted ? '🔇' : '🔈';
      btn.title = sfx.muted ? 'Activer le son' : 'Couper le son';
    };
    paint();
    btn.addEventListener('click', () => {
      sfx.unlock();
      sfx.setMuted(!sfx.muted);
      paint();
      if (!sfx.muted) sfx.play('coin', 0.6);
    });
    const help = document.getElementById('help-btn');
    help?.parentElement?.insertBefore(btn, help);

    // Son au moment où l'effet démarre à l'écran
    map.fx.onStart = (fx, visible) => {
      const me = this.state?.me?.name;
      const mine = !!me && (fx.src === `p:${me}` || fx.dst === `p:${me}`);
      const vol = this.spectator ? (visible ? 0.5 : 0.15) : mine ? 1 : visible ? 0.7 : 0.25;
      sfx.play(FX_SOUND[fx.kind], vol);
    };

    // Vue spectateur : clic sur un crawler de la liste = la caméra le suit
    document.getElementById('me-card')?.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-focus]') as HTMLElement | null;
      if (el && this.director) this.director.follow(el.dataset.focus!);
    });
  }

  onEvent(e: GameEvent) {
    this.map.onEvent(e);
    this.director?.onEvent(e);
    const me = this.state?.me;
    const concernsMe = !!me && (e.actors?.includes(keyOf(me.name)) ?? false);
    if (e.kind === 'trahison' && e.text.startsWith('TRAHISON')) sfx.play('betrayal', concernsMe || this.spectator ? 0.9 : 0.45);
    else if (e.kind === 'alliance' && e.text.startsWith('Alliance')) sfx.play('alliance', concernsMe ? 1 : 0.35);
  }

  onState(s: PlayerViewMsg) {
    this.state = s;
    this.director?.setFloor(s.floor);
    if (s.me && s.floor) {
      const room = `${s.floor.n}:${s.me.roomId}`;
      if (this.lastRoom && room !== this.lastRoom && s.me.alive) sfx.play('step', 0.8);
      this.lastRoom = room;
    }
    this.renderTools();
  }

  /** Bip discret pendant les 3 dernières secondes du tour (joueur vivant). */
  onTick(secondsLeft: number) {
    if (this.spectator || !this.state?.me?.alive) return;
    const s = Math.ceil(secondsLeft);
    if (s !== this.lastTick && s >= 1 && s <= 3) sfx.play('tick', 0.6);
    this.lastTick = s;
  }

  update() {
    this.director?.update(performance.now());
  }

  /** Bouton « Caméra auto » dans la barre spectateur. */
  private renderTools() {
    const host = document.getElementById('spec-tools');
    if (!host || !this.director) return;
    const d = this.director;
    const label = d.followName ? `Suivi : ${d.followName}` : d.auto ? 'Caméra auto : on' : 'Caméra auto : off';
    let b = host.querySelector('button');
    if (!b) {
      b = document.createElement('button');
      b.addEventListener('click', () => d.setAuto(!d.auto || !!d.followName));
      host.appendChild(b);
    }
    b.textContent = label;
    b.classList.toggle('on', d.auto && !d.followName);
  }
}
