// Chargement de la planche DawnLike (DragonDePlatino, palette DawnBringer, CC-BY-SA 3.0 ; construite par
// scripts/dawnlike/build_atlas.py) et dessin de sprites.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Tiles {
  img!: HTMLImageElement;
  rects = new Map<string, Rect>();
  frames = new Map<string, number>(); // préfixe d'animation -> nombre d'images

  async load(base = 'assets') {
    const [img, list] = await Promise.all([
      new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = `${base}/dawnlike.png`;
      }),
      fetch(`${base}/dawnlike.txt`).then((r) => r.text()),
    ]);
    this.img = img;
    for (const line of list.split('\n')) {
      const p = line.trim().split(/\s+/);
      if (p.length !== 5) continue;
      const [name, x, y, w, h] = p;
      this.rects.set(name, { x: +x, y: +y, w: +w, h: +h });
      const m = name.match(/^(.*)_f(\d+)$/);
      if (m) this.frames.set(m[1], Math.max(this.frames.get(m[1]) ?? 0, +m[2] + 1));
    }
  }

  has(name: string): boolean {
    return this.frames.has(name) || this.rects.has(name);
  }

  /** Résout un nom de sprite, animé (préfixe + _fN, deux images à 2,5 par seconde) ou fixe ; les anciens noms
   *  (planche 0x72) passent par ALIAS. */
  resolve(name: string, t = 0, speed = 2.5): Rect | undefined {
    if (!this.has(name) && ALIAS[name]) name = ALIAS[name];
    const n = this.frames.get(name);
    if (n) return this.rects.get(`${name}_f${Math.floor(t * speed) % n}`);
    return this.rects.get(name) ?? this.rects.get(`${name}_f0`);
  }

  /** Dessine un sprite ancré en bas au centre de (x, y) (`scale` entier : 2 pour les boss). */
  drawAnchored(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, t = 0, flip = false, scale = 1) {
    const r = this.resolve(name, t);
    if (!r) return;
    const w = r.w * scale;
    const h = r.h * scale;
    ctx.save();
    if (flip) {
      ctx.translate(Math.round(x), 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.img, r.x, r.y, r.w, r.h, Math.round(-w / 2), Math.round(y - h), w, h);
    } else ctx.drawImage(this.img, r.x, r.y, r.w, r.h, Math.round(x - w / 2), Math.round(y - h), w, h);
    ctx.restore();
  }

  /** Dessine une tuile 16x16 à la case (tx, ty). */
  tile(ctx: CanvasRenderingContext2D, name: string, tx: number, ty: number, t = 0) {
    const r = this.resolve(name, t);
    if (!r) return;
    ctx.drawImage(this.img, r.x, r.y, r.w, r.h, tx * 16, ty * 16 + (16 - r.h), r.w, r.h);
  }

  /** Petite image (data URL) d'un sprite, pour l'interface HTML. */
  icon(name: string, scale = 2): string {
    const r = this.resolve(name);
    if (!r) return '';
    const c = document.createElement('canvas');
    c.width = r.w * scale;
    c.height = r.h * scale;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.img, r.x, r.y, r.w, r.h, 0, 0, r.w * scale, r.h * scale);
    return c.toDataURL();
  }
}

export const CLASS_SPRITE: Record<string, string> = {
  barbare: 'cls_barbare',
  chevalier: 'cls_chevalier',
  voleur: 'cls_voleur',
  mage: 'cls_mage',
};

/** Sprite d'un monstre : par espèce (planche DawnLike), sinon l'ancien nom envoyé par le serveur. */
export const monsterSprite = (m: { kind: string; sprite: string }) => `mon_${m.kind}`;
/** Icône d'un objet : par modèle. */
export const itemSprite = (it: { tpl: string; sprite: string }) => `it_${it.tpl}`;

/** Anciens noms (planche 0x72) encore utilisés çà et là. */
const ALIAS: Record<string, string> = {
  skull: 'dec_skulls', crate: 'dec_crate', coin_anim: 'coin', coin_anim_f0: 'coin', coin: 'coin',
  chest_full_open_anim_f0: 'chest_closed', chest_empty_open_anim_f2: 'chest_open', ui_heart_full: 'heart', ui_heart_empty: 'heart_empty',
  floor_spikes_anim: 'spikes', floor_spikes_anim_f3: 'spikes', doc_idle_anim: 'npc_merchant', dwarf_m_idle_anim: 'npc_smith',
  elf_f_idle_anim: 'npc_prisoner', weapon_hammer: 'it_marteau', weapon_duel_sword: 'it_epee_courte', flask_big_red: 'it_grande_potion',
  flask_big_blue: 'it_potion', ogre_idle_anim_f0: 'mon_ogre_dormeur', floor_stairs: 'stairs', column: 'dec_statue', doors_leaf_closed: 'gate',
};
