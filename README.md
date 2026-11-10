# Le Donjon — prototype (phase 1)

Jeu de donjon multijoueur au tour par tour, piloté par des commandes de chat (`!attaque`, `!nord`…).
Chaque joueur suit son crawler sur une page web en pixel art. Le but de cette phase : vérifier qu'on s'amuse
à 5–10 joueurs pendant 30 minutes, avant d'ajouter le stream, l'IA et la 3D.

Spécifications complètes : doc « Le Donjon — architecture du stream interactif » (section *Cahier des charges du prototype*).

## Ce qui est en place

- Tours de 20 s (réglables) ; une seule commande par tour, la dernière envoyée compte.
- Étages générés à la demande (≈ 2 salles par joueur, 20 minimum), avec safe rooms, marchand, pièges, trésors (et mimiques), arène et boss qui garde l'escalier.
- Chaque étage s'effondre au bout de 15 min : ceux qui restent dessus meurent et réapparaissent à l'étage suivant.
- 4 classes (Barbare, Chevalier, Voleur, Mage), 4 stats, jets `d20 + stat + niveau/2`, critiques, fiascos et gags.
- Niveaux, XP, points de stat (`!monte`), loot à 4 raretés avec objets absurdes, or, achat/vente.
- Combat entre joueurs partout sauf en safe room ; alliances (XP et carte partagées) ; trahisons (bonus au jet, vol d'or, marque de traître).
- Mort : réapparition après 5 tours en safe room, loot laissé au sol, −25 % de l'XP du niveau, puis 3 min d'immunité JvJ.
- Joueur inactif : continue d'attaquer s'il attaquait, sinon riposte s'il est attaqué.
- Page joueur 2D pixel art avec brouillard de guerre, faux chat, boutons d'action, journal.
- Vue spectateur sans brouillard (pour toi, et plus tard pour le stream).
- Lecture du vrai chat Twitch en option (sans jeton).
- Sauvegarde automatique à chaque tour (`data/save.json`).

## Installation (Windows)

1. Installe **Node.js 20 ou plus récent** (version LTS) : <https://nodejs.org>
2. Dans un terminal (PowerShell) :

```powershell
git clone https://github.com/Kilanga/Donjon.git
cd Donjon
npm install
```

## Lancer une partie

```powershell
npm run dev
```

Cette commande construit la page puis démarre le serveur. Ensuite :

- **Jouer** : <http://localhost:3000> — choisis un pseudo puis une classe.
- **Vue spectateur** (toute la carte, sans brouillard) : <http://localhost:3000/?spectateur=regie>

Pour relancer sans reconstruire la page : `npm start`. Pour repartir de zéro : `npm start -- --nouvelle-partie`
(ou supprime `data/save.json`). `Ctrl+C` arrête le serveur et sauvegarde la partie.

## Faire jouer des amis à distance

Le serveur tourne sur ton PC ; un tunnel gratuit Cloudflare lui donne une adresse publique.

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```

`cloudflared` affiche une adresse en `https://….trycloudflare.com` : envoie-la à tes amis.
Elle change à chaque lancement, et ton PC doit rester allumé pendant la session.

## Réglages

Copie `config.example.json` en `config.json` et modifie ce que tu veux :

| Réglage | Défaut | Rôle |
| --- | --- | --- |
| `turnSeconds` | 20 | Durée d'un tour (s) |
| `floorMinutes` | 15 | Durée de vie d'un étage avant effondrement (min) |
| `respawnTurns` | 5 | Tours avant réapparition |
| `immunitySeconds` | 180 | Immunité JvJ après arrivée ou réapparition (s) |
| `roomsPerPlayer` / `minRooms` | 2 / 20 | Taille des étages |
| `deathXpLoss` | 0.25 | Part de l'XP du niveau perdue à la mort |
| `spectatorKey` | `regie` | Clé de la vue spectateur — change-la si tu partages l'adresse |
| `twitchChannel` | vide | Nom de ta chaîne Twitch pour lire les commandes du chat |

Pour tester vite seul, mets par exemple `"turnSeconds": 5` et `"floorMinutes": 5`.

## Brancher le vrai chat Twitch

Mets ton nom de chaîne dans `config.json` (`"twitchChannel": "tachaine"`) et relance.
Le serveur lit le chat en anonyme (aucun jeton nécessaire) : chaque message qui commence par `!` est une commande,
avec le pseudo Twitch comme nom de joueur. Un spectateur peut suivre son crawler sur la page web en entrant
**le même pseudo** que sur Twitch. Le bot ne répond pas dans le chat (lecture seule) : les réponses s'affichent sur la page.

## Commandes

| Commande | Alias anglais | Effet |
| --- | --- | --- |
| `!join [classe]` | `!join` | Entrer dans le donjon (`barbare`, `chevalier`, `voleur`, `mage`) |
| `!nord` `!sud` `!est` `!ouest` | `!north` `!south` `!east` `!west` | Changer de salle (fuir un monstre demande un jet d'Agilité) |
| `!attaque [cible]` | `!attack` | Attaquer un monstre (nom ou numéro) ou un joueur (pseudo) |
| `!fouille` | `!search` | Fouiller, ouvrir un coffre, désarmer un piège |
| `!ramasse [objet]` | `!pickup` | Ramasser l'or et les objets au sol |
| `!utilise <objet>` / `!equipe <objet>` | `!use` / `!equip` | Utiliser ou équiper (nom ou numéro dans le sac) |
| `!marchand`, `!achete <n°>`, `!vends <objet>` | `!shop`, `!buy`, `!sell` | Commerce en safe room |
| `!repos` | `!rest` | Récupérer des PV en safe room |
| `!alliance <joueur>` / `!quitte` | `!ally` / `!leave` | Proposer/accepter une alliance, ou la quitter |
| `!monte <for/agi/int/cha>` | `!levelup` | Dépenser un point de stat (immédiat) |
| `!descendre` | `!down` | Prendre l'escalier une fois le boss vaincu |
| `!statut`, `!aide` | `!status`, `!help` | Infos |

Raccourcis clavier sur la page : flèches ou ZQSD pour se déplacer, `F` fouiller, `A` attaquer.

## Tests et outils

```powershell
npm test               # tests du moteur (règles, génération, mort, alliances, effondrement)
npm run simulate       # simule une session de 10 bots pendant 1 h de jeu et affiche un bilan
npm run bots -- 6      # connecte 6 bots au serveur lancé, pour voir la page s'animer
npm run typecheck      # vérification TypeScript
```

## Organisation du code

```
src/shared/        types et analyse des commandes, partagés serveur/page
src/server/        serveur HTTP + WebSocket, sauvegarde, Twitch
src/server/game/   moteur : engine.ts (tours, combats…), dungeon.ts (génération), data.ts (classes, objets, monstres, textes)
client/            page joueur (Vite) : main.ts (interface), map.ts (rendu pixel art), tiles.ts (planche de sprites)
scripts/           simulation et bots de test
tests/             tests Vitest
```

Presque tout l'équilibrage se règle dans `src/server/game/data.ts` (stats des classes, objets, monstres, textes drôles).

## Limites connues

- L'équilibrage n'a été testé qu'avec des bots : à ajuster après la première vraie session.
- La lecture du chat Twitch n'a pas pu être testée en conditions réelles.
- Pas de comptes : n'importe qui peut prendre un pseudo sur la page. Suffisant entre amis, à revoir pour Twitch.
- Hors périmètre de la phase 1 : stream 3D, réalisateur, IA, points de chaîne.
