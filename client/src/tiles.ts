// Chargement de la planche 0x72 DungeonTileset II (CC0) et dessin de sprites.

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
        i.src = `${base}/tileset.png`;
      }),
      fetch(`${base}/tile_list.txt`).then((r) => r.text()),
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

  /** Résout un nom de sprite, animé (préfixe + _fN) ou fixe. */
  resolve(name: string, t = 0, speed = 7): Rect | undefined {
    const n = this.frames.get(name);
    if (n) return this.rects.get(`${name}_f${Math.floor(t * speed) % n}`);
    return this.rects.get(name) ?? this.rects.get(`${name}_f0`);
  }

  /** Dessine un sprite ancré en bas au centre de (x, y). */
  drawAnchored(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, t = 0, flip = false) {
    const r = this.resolve(name, t);
    if (!r) return;
    ctx.save();
    if (flip) {
      ctx.translate(Math.round(x), 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.img, r.x, r.y, r.w, r.h, Math.round(-r.w / 2), Math.round(y - r.h), r.w, r.h);
    } else ctx.drawImage(this.img, r.x, r.y, r.w, r.h, Math.round(x - r.w / 2), Math.round(y - r.h), r.w, r.h);
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
  barbare: 'dwarf_m_idle_anim',
  chevalier: 'knight_m_idle_anim',
  voleur: 'elf_m_idle_anim',
  mage: 'wizzard_m_idle_anim',
};
