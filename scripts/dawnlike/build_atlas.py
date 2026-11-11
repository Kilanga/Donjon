# Construit la planche de sprites 2D (client/public/assets/dawnlike.png + dawnlike.txt) à partir de DawnLike
# (DragonDePlatino, palette DawnBringer, CC-BY-SA 3.0). Usage :
#   python3 -I scripts/dawnlike/build_atlas.py <dossier DawnLike> <dossier de sortie>
# Le fichier texte suit le format de l'ancienne planche : « nom x y largeur hauteur » ; les sprites animés
# ont deux images (_f0 tirée de la planche « 0 », _f1 de la planche « 1 »).
import sys
from pathlib import Path
from PIL import Image

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
T = 16

def anim(folder, base):
    return [f'{folder}/{base}0.png', f'{folder}/{base}1.png']

C = lambda base: anim('Characters', base)
D = anim('Objects', 'Decor')
DOOR = anim('Objects', 'Door')
TRAP = anim('Objects', 'Trap')
GROUND = anim('Objects', 'Ground')

ENTRIES = []  # (nom, [planches], col, ligne, largeur en tuiles, hauteur en tuiles)
def add(name, sheets, c, r, w=1, h=1):
    ENTRIES.append((name, sheets if isinstance(sheets, list) else [sheets], c, r, w, h))

# Classes et PNJ du décor
add('cls_barbare', C('Player'), 1, 11)
add('cls_chevalier', C('Player'), 1, 3)
add('cls_voleur', C('Player'), 2, 4)
add('cls_mage', C('Player'), 6, 3)
add('npc_merchant', C('Humanoid'), 4, 2)
add('npc_smith', C('Player'), 0, 11)
add('npc_prisoner', C('Humanoid'), 7, 2)
add('platino', C('Reptile'), 3, 12)
# Monstres (par espèce) et boss
for kind, sheet, c, r in [
    ('gobelin', 'Player', 0, 14), ('squelette', 'Undead', 0, 2), ('zombie', 'Undead', 3, 0), ('diablotin', 'Demon', 1, 4),
    ('limace', 'Slime', 1, 1), ('demon', 'Demon', 1, 1), ('orque', 'Player', 1, 12), ('necromancien', 'Humanoid', 1, 2),
    ('guerrier', 'Player', 2, 12), ('yeti', 'Quadraped', 0, 11), ('chaman', 'Player', 7, 12), ('marais', 'Slime', 0, 4),
    ('golem', 'Elemental', 0, 1), ('lezard', 'Reptile', 1, 9), ('gargouille', 'Demon', 0, 3), ('chevalier_noir', 'Humanoid', 2, 7),
    ('wyrm', 'Reptile', 0, 3), ('ogre', 'Humanoid', 0, 0), ('gros_zombie', 'Undead', 6, 0), ('golem_ancien', 'Elemental', 1, 1),
    ('chef_orque', 'Player', 4, 12), ('yeti_ancien', 'Humanoid', 6, 0), ('dragon', 'Reptile', 6, 2), ('crapaud_roi', 'Reptile', 2, 8),
    ('liche', 'Undead', 6, 2), ('dragon_ancien', 'Reptile', 3, 2), ('gros_demon', 'Demon', 0, 1), ('mimique', 'Elemental', 0, 8),
    ('ogre_dormeur', 'Humanoid', 1, 0),
]:
    add(f'mon_{kind}', C(sheet), c, r)
# Objets
for tpl, sheet, c, r in [
    ('poings', 'Glove', 0, 0), ('dague', 'ShortWep', 0, 0), ('baton', 'LongWep', 1, 0), ('epee_courte', 'MedWep', 0, 0),
    ('hache_rouillee', 'MedWep', 0, 1), ('epee_longue', 'LongWep', 0, 1), ('hache_guerre', 'MedWep', 1, 1), ('baton_rouge', 'LongWep', 0, 0),
    ('marteau', 'LongWep', 0, 6), ('epee_mousse', 'MedWep', 2, 0), ('tunique', 'Armor', 1, 0), ('cotte', 'Armor', 2, 0),
    ('plastron', 'Armor', 2, 6), ('pyjama', 'Armor', 3, 0), ('potion', 'Potion', 0, 0), ('grande_potion', 'Potion', 3, 2),
    ('fumigene', 'Potion', 0, 2), ('parchemin', 'Scroll', 0, 0), ('poulet', 'Food', 3, 5), ('coupon', 'Scroll', 2, 5),
    ('ticket', 'Tool', 4, 0), ('fromage', 'Food', 1, 4), ('cape', 'Armor', 2, 5), ('miroir', 'Tool', 0, 0), ('couronne', 'Hat', 1, 3),
]:
    add(f'it_{tpl}', f'Items/{sheet}.png', c, r)
add('it_canard', 'Characters/Reptile0.png', 2, 8)
add('coin', 'Items/Money.png', 2, 0)
add('gold_pile', 'Items/Money.png', 0, 0)
add('chest_closed', 'Items/Chest0.png', 0, 0)
add('chest_open', 'Items/Chest1.png', 0, 0)
add('barrel', 'Items/Chest0.png', 0, 1)
add('barrel2', 'Items/Chest0.png', 1, 1)
add('heart', 'GUI/GUI0.png', 0, 1)
add('heart_empty', 'GUI/GUI0.png', 4, 1)
add('bubble_z', 'GUI/GUI0.png', 10, 4)
# Décor
for name, c, r in [
    ('altar', 0, 20), ('altar_blood', 1, 20), ('statue', 3, 20), ('cage', 1, 21), ('tomb_rip', 0, 17), ('tomb_lines', 1, 17),
    ('tomb_skull', 2, 17), ('tomb_plain', 3, 17), ('coffin', 6, 10), ('candles', 3, 8), ('candelabra', 1, 8), ('candle', 2, 8),
    ('skulls', 0, 12), ('skulls2', 2, 12), ('bones', 0, 13), ('bones2', 1, 13), ('rubble', 0, 2), ('rubble2', 1, 2), ('pot', 0, 3),
    ('pot2', 1, 3), ('crate', 2, 9), ('crates', 3, 9), ('bookshelf', 1, 4), ('table', 1, 5), ('chair', 0, 7), ('throne', 6, 7),
    ('furnace', 6, 11), ('weapons', 3, 11), ('armor_stand', 1, 11),
]:
    add(f'dec_{name}', D, c, r)
PIXEL = {'dec_rug_red': (8, 232, 32, 32), 'dec_rug_gray': (56, 232, 32, 32)}  # tapis : à cheval sur les cases
add('dec_rug_red', D, 0, 0)
add('dec_rug_gray', D, 0, 0)
add('door_wood', DOOR, 0, 0)
add('gate', DOOR, 2, 0)
add('fountain', DOOR, 5, 5)
add('fire_arch', DOOR, 7, 5)
add('well', TRAP, 4, 2)
add('spikes', TRAP, 6, 3)
add('spikes_small', TRAP, 0, 3)
for name, c, r in [('puddle', 4, 6), ('puddle_small', 5, 6), ('blood', 0, 6), ('slime', 2, 6), ('scorch', 6, 6), ('debris', 6, 5), ('grass', 0, 0), ('grass2', 1, 1)]:
    add(f'gr_{name}', GROUND, c, r)
add('stairs', 'Objects/Tile.png', 1, 1)
# Sols (neuf cases) et murs, un jeu par thème d'étage
FLOORS = {'classic': (0, 9), 'flooded': (0, 3), 'fire': (14, 9), 'dark': (0, 12), 'moldy': (7, 9), 'haunted': (14, 12)}
WALLS = {'classic': (0, 9), 'flooded': (0, 3), 'fire': (0, 15), 'dark': (0, 12), 'moldy': (14, 3), 'haunted': (0, 12)}
POS = {'tl': (0, 0), 't': (1, 0), 'tr': (2, 0), 'l': (0, 1), 'c': (1, 1), 'r': (2, 1), 'bl': (0, 2), 'b': (1, 2), 'br': (2, 2)}
for th, (c0, r0) in FLOORS.items():
    for p, (dc, dr) in POS.items():
        add(f'fl_{th}_{p}', 'Objects/Floor.png', c0 + dc, r0 + dr)
for th, (c0, r0) in WALLS.items():
    for p, (dc, dr) in {'tl': (0, 0), 'h': (1, 0), 'tr': (2, 0), 'v': (0, 1), 'bl': (0, 2), 'br': (2, 2)}.items():
        add(f'wl_{th}_{p}', 'Objects/Wall.png', c0 + dc, r0 + dr)

cache = {}
def sheet(p):
    if p not in cache:
        cache[p] = Image.open(SRC / p).convert('RGBA')
    return cache[p]

pieces = []  # (nom, image)
for name, sheets, c, r, w, h in ENTRIES:
    frames = []
    for s in sheets:
        if name in PIXEL:
            px, py, pw, ph = PIXEL[name]
            im = sheet(s).crop((px, py, px + pw, py + ph))
        else:
            im = sheet(s).crop((c * T, r * T, (c + w) * T, (r + h) * T))
        if w > 1 or h > 1:  # objets à cheval sur plusieurs cases : on recadre sur les pixels
            bbox = im.getbbox()
            if bbox:
                im = im.crop(bbox)
        frames.append(im)
    if len(frames) == 1:
        pieces.append((name, frames[0]))
    else:
        for i, im in enumerate(frames):
            pieces.append((f'{name}_f{i}', im))

# Rangement en lignes de 512 px
W = 512
x = y = rowh = 0
placed = []
for name, im in pieces:
    if x + im.width > W:
        x, y, rowh = 0, y + rowh, 0
    placed.append((name, x, y, im))
    x += im.width
    rowh = max(rowh, im.height)
H = y + rowh
atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
lines = []
for name, px, py, im in placed:
    atlas.alpha_composite(im, (px, py))
    lines.append(f'{name} {px} {py} {im.width} {im.height}')
OUT.mkdir(parents=True, exist_ok=True)
atlas.save(OUT / 'dawnlike.png', optimize=True)
(OUT / 'dawnlike.txt').write_text('\n'.join(lines) + '\n')
print(f'{len(pieces)} sprites, planche {W}x{H}')
