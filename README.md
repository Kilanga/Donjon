# Le Donjon — prototype (phase 1)

Jeu de donjon multijoueur au tour par tour, piloté par des commandes de chat (`!attaque`, `!nord`…).
Chaque joueur suit son crawler sur une page web en pixel art ; le maître du jeu pilote la partie depuis la régie.
Le but de cette phase : vérifier qu'on s'amuse à 5–10 joueurs pendant 30 minutes, avant d'ajouter le stream et la 3D.

Spécifications complètes : doc « Le Donjon — architecture du stream interactif » (section *Cahier des charges du prototype*).

## Pour la session de ce soir

1. **Mets à jour** (si tu as déjà cloné) : `git pull` puis `npm install`.
2. **Lance le jeu** : double-clic sur `lancer.bat`. La première fois, il installe tout ; ensuite il construit la page,
   ouvre <http://localhost:3000> et démarre le serveur. Garde la fenêtre ouverte.
3. **Repère l'adresse de la régie** affichée dans la fenêtre : `http://localhost:3000/?spectateur=xxxxxxxx`.
   La clé est générée au premier lancement (fichier `data/cle-regie.txt`). **Ne la partage pas** : la régie peut tout faire, y compris effacer la partie.
4. **Ouvre le tunnel** : double-clic sur `tunnel.bat` (installe `cloudflared` la première fois, relance ensuite).
   Envoie à tes amis l'adresse `https://….trycloudflare.com` qui s'affiche.
5. **Chaque ami** ouvre l'adresse sur PC ou téléphone, choisit un pseudo, puis une classe. L'aide s'ouvre au premier passage (bouton « ? Aide » ensuite).
6. **Pendant la partie**, depuis la régie : pause si quelqu'un décroche, « Tour suivant » si ça traîne, lancer un vote,
   déclencher un événement pour relancer l'action, régler la durée du tour (15 s si tout le monde suit bien, 25–30 s sinon).
7. **Pendant la partie, les joueurs signalent les soucis** avec `!bug ce qui cloche` (ou leur avis avec `!avis …`).
   C'est noté avec leur situation exacte (étage, salle, PV, dernières actions) et tu le vois passer dans la régie.
8. **À la fin**, fais une capture du classement, puis pose trois questions : qu'est-ce qui vous a fait rire ?
   À quel moment vous vous êtes ennuyés ? Vous rejoueriez ?
9. **Renvoie tout à Claude** : dans la régie, lien « Journaux pour Claude » (ou l'adresse `…/journaux?cle=…` affichée
   au démarrage). Télécharge le **Rapport** (.md) et le **Journal complet** (.jsonl), et glisse les deux dans la conversation,
   avec les réponses aux trois questions. Voir [Journaux de session](#journaux-de-session).

Pour une partie toute neuve : bouton « Nouvelle partie » de la régie, ou supprime `data/save.json` avant de lancer.
Si quelqu'un ferme son onglet, son crawler reste dans le donjon (il riposte tout seul) : il le retrouve en revenant avec le même pseudo.

## Ce qui est en place

**Le jeu**
- Tours de 20 s (réglables, y compris en cours de partie) ; une seule commande par tour, la dernière envoyée compte.
- Étages générés à la demande (≈ 2 salles par joueur, 20 minimum), avec safe rooms et marchand, pièges, trésors (et mimiques), arène et boss qui garde l'escalier.
- Chaque étage s'effondre au bout de 15 min : ceux qui restent dessus meurent et réapparaissent à l'étage suivant.
- 4 classes (Barbare, Chevalier, Voleur, Mage), 4 stats, jets `d20 + stat + niveau/2`, critiques, fiascos et gags.
- Niveaux, XP, points de stat (`!monte`), loot à 4 raretés avec objets absurdes, or, achat/vente.
- Combat entre joueurs partout sauf en safe room ; alliances (XP et carte partagées) ; trahisons (bonus au jet, vol d'or, marque de traître).
- Mort : réapparition après 5 tours en safe room, loot laissé au sol, −25 % de l'XP du niveau, puis 3 min d'immunité JvJ.
- Joueur inactif : continue d'attaquer s'il attaquait, sinon riposte s'il est attaqué.
- **Votes de la production** toutes les 4 min (voir plus bas) et **prime** sur le meilleur tueur.

**La page joueur**
- Carte pixel art avec brouillard de guerre, fiche perso, salle, inventaire, journal, chat.
- Messages libres : tout ce qui ne commence pas par `!` s'affiche en bulle au-dessus de ton crawler (comme le chat Twitch).
- Classement, titres (boucher, traître en chef…) et nécrologie ; bandeau de vote ; effets en cours (happy hour, inondation, prime).
- Utilisable sur téléphone ; raccourcis clavier sur PC.

**La régie** (vue spectateur avec la clé)
- Toute la carte sans brouillard, liste des crawlers, classement.
- Pause/reprise (les chronos sont gelés), tour suivant, lancer un vote, déclencher un événement, effondrer l'étage affiché,
  soigner tout le monde, changer la durée du tour, expulser un joueur, nouvelle partie.

**Technique**
- Sauvegarde à chaque tour (`data/save.json`) + 3 sauvegardes de secours en rotation ; une erreur ne fait pas tomber la partie.
- Lecture du vrai chat Twitch en option (sans jeton) ; IA du donjon en option (Ollama ou API Claude).

## Installation (Windows)

1. Installe **Node.js 20 ou plus récent** (version LTS) : <https://nodejs.org>
2. Dans un terminal (PowerShell) :

```powershell
git clone https://github.com/Kilanga/Donjon.git
cd Donjon
npm install
```

## Lancer une partie

Double-clic sur `lancer.bat`, ou en ligne de commande :

```powershell
npm run dev        # construit la page puis démarre le serveur
npm start          # démarre sans reconstruire la page
npm start -- --nouvelle-partie   # repart de zéro
```

- **Jouer** : <http://localhost:3000> — choisis un pseudo puis une classe.
- **Régie** : l'adresse avec la clé s'affiche au démarrage.

`Ctrl+C` arrête le serveur et sauvegarde la partie. Après un `git pull`, relance `lancer.bat` (ou `npm install` puis `npm run dev`).

## Faire jouer des amis à distance

Le serveur tourne sur ton PC ; un tunnel gratuit Cloudflare lui donne une adresse publique. Double-clic sur `tunnel.bat`, ou :

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```

`cloudflared` affiche une adresse en `https://….trycloudflare.com` : envoie-la à tes amis.
Elle change à chaque lancement, et ton PC doit rester allumé pendant la session.

## Votes de la production

Toutes les 4 minutes, la production propose 3 événements tirés au hasard. Les joueurs votent pendant 3 tours avec
`!vote 1`, `!vote 2` ou `!vote 3` (ou en cliquant dans le bandeau). Sans vote, la production choisit seule.
La régie peut aussi lancer un vote ou déclencher un événement directement.

| Événement | Effet |
| --- | --- |
| Pluie d'or | Des tas d'or tombent dans des salles au hasard |
| Lâcher de monstres | Une fournée de monstres errants |
| Happy hour | Marchands à −50 % et réapprovisionnés pendant 10 tours |
| Résurrection générale | Tous les morts reviennent au tour suivant |
| Prime sur le meilleur tueur | De l'or pour qui tue le crawler qui a le plus de kills (15 tours) |
| Inondation | Pendant 5 tours, un déplacement sur trois échoue |
| Festin | Tous les vivants récupèrent leurs PV |
| Pièges en promo | Pièges réarmés, trois salles de plus piégées |
| Prolongation / Accélération | Les étages tiennent 3 min de plus / s'effondrent 2 min plus tôt |

Les textes et la liste se règlent dans `src/server/game/production.ts` (et l'application dans `engine.ts`, `applyProduction`).

## Réglages

Copie `config.example.json` en `config.json` et modifie ce que tu veux :

| Réglage | Défaut | Rôle |
| --- | --- | --- |
| `turnSeconds` | 20 | Durée d'un tour (s) ; modifiable aussi depuis la régie |
| `floorMinutes` | 15 | Durée de vie d'un étage avant effondrement (min) |
| `respawnTurns` | 5 | Tours avant réapparition |
| `immunitySeconds` | 180 | Immunité JvJ après arrivée ou réapparition (s) |
| `roomsPerPlayer` / `minRooms` | 2 / 20 | Taille des étages |
| `deathXpLoss` | 0.25 | Part de l'XP du niveau perdue à la mort |
| `voteEveryMinutes` / `voteTurns` | 4 / 3 | Fréquence des votes (0 = jamais) / durée d'un vote en tours |
| `spectatorKey` | `regie` | Clé de la régie ; `regie` = clé aléatoire générée dans `data/cle-regie.txt` |
| `twitchChannel` | vide | Nom de ta chaîne Twitch pour lire les commandes du chat |
| `ai` | désactivée | IA du donjon, voir plus bas |

Pour tester vite seul : `"turnSeconds": 5`, `"floorMinutes": 5`, puis `npm run bots -- 6` dans un second terminal.

## Vue stream 3D (bonus, à tester)

Une deuxième page montre la partie en 3D, façon émission : caméra « réalisateur » qui va là où ça chauffe,
plan large quand c'est calme, bandeau « EN DIRECT » sur les moments forts, classement, vote en cours, bulles du chat.

- Adresse : `http://localhost:3000/stream.html?cle=<clé de la régie>` (lien « Vue stream 3D » dans la régie).
- Pour suivre un seul crawler : ajoute `&suivre=Pseudo`.
- **Dans OBS** : Sources → « Navigateur », URL ci-dessus, largeur 1920, hauteur 1080. Le HUD est prévu pour ce format
  et se réduit tout seul dans une fenêtre plus petite (partage d'écran Discord, par exemple).
- C'est la page la plus gourmande : il faut une carte graphique correcte. Si elle saccade, reste sur la vue 2D de la régie.
  Sa fluidité est notée dans le journal de session.
- Modèles 3D : KayKit (Kay Lousberg, licence CC0).

## Brancher le vrai chat Twitch

Mets ton nom de chaîne dans `config.json` (`"twitchChannel": "tachaine"`) et relance.
Le serveur lit le chat en anonyme (aucun jeton nécessaire) : chaque message qui commence par `!` est une commande,
avec le pseudo Twitch comme nom de joueur ; les autres messages s'affichent en bulle au-dessus du crawler.
Un spectateur peut suivre son crawler sur la page web en entrant **le même pseudo** que sur Twitch.
Le bot ne répond pas dans le chat (lecture seule) : les réponses s'affichent sur la page.

## Commandes

| Commande | Alias anglais | Effet |
| --- | --- | --- |
| `!join [classe]` | `!join` | Entrer dans le donjon (`barbare`, `chevalier`, `voleur`, `mage`) |
| `!nord` `!sud` `!est` `!ouest` | `!north` `!south` `!east` `!west` | Changer de salle (fuir un monstre demande un jet d'Agilité) |
| `!attaque [cible]` | `!attack` | Attaquer un monstre (nom ou numéro) ou un joueur (pseudo) ; un allié = trahison |
| `!fouille` | `!search` | Fouiller, ouvrir un coffre, désarmer un piège |
| `!ramasse [objet]` | `!pickup` | Ramasser l'or et les objets au sol |
| `!utilise <objet>` / `!equipe <objet>` | `!use` / `!equip` | Utiliser ou équiper (nom ou numéro dans le sac) |
| `!marchand`, `!achete <n°>`, `!vends <objet>` | `!shop`, `!buy`, `!sell` | Commerce en safe room |
| `!parle <message>` | `!talk` | Parler au marchand (safe room) |
| `!repos` | `!rest` | Récupérer des PV en safe room |
| `!alliance <joueur>` / `!quitte` | `!ally` / `!leave` | Proposer/accepter une alliance, ou la quitter |
| `!monte <for/agi/int/cha>` | `!levelup` | Dépenser un point de stat (immédiat) |
| `!descendre` | `!down` | Prendre l'escalier une fois le boss vaincu |
| `!vote <n°>` | `!vote` | Voter pour l'événement de la production (immédiat) |
| `!statut`, `!aide` | `!status`, `!help` | Infos |
| `!bug <description>` / `!avis <message>` | `!feedback` | Signaler un souci ou donner son avis (noté dans le journal, visible en régie) |
| un message sans `!` ou `!dis …` | `!say` | Parler : bulle au-dessus de ton crawler |

Raccourcis clavier sur la page : flèches ou ZQSD pour se déplacer, `F` fouiller, `A` attaquer, `?` aide,
flèches haut/bas dans le champ de commande pour l'historique.

## IA du donjon (optionnel)

Par défaut, le jeu n'appelle aucune IA : tous les textes drôles sont écrits à l'avance.
Tu peux activer une « IA du donjon » qui commente les grands moments (morts, trahisons, boss vaincu)
d'une phrase sarcastique dans le journal, et qui fait parler le marchand quand un joueur tape `!parle <message>` en safe room.
Si l'IA ne répond pas (éteinte, trop lente, erreur), le jeu continue normalement avec ses textes habituels.

> Non testé en conditions réelles : le réseau de l'environnement de développement bloquait Ollama et l'API.
> Les appels sont couverts par des tests automatiques avec des réponses simulées.

### Option 1 : ton IA locale avec Ollama (gratuit)

```powershell
ollama pull qwen2.5:14b
```

Puis dans `config.json` :

```json
"ai": { "provider": "ollama", "ollamaModel": "qwen2.5:14b" }
```

Prends un modèle **généraliste** (`qwen2.5:14b`, `mistral-nemo`…) plutôt que Qwen2.5-Coder : un modèle de code
est bon pour programmer, beaucoup moins pour faire de l'humour en français. Un modèle d'environ 14B tient dans les 12 Go
de ta RTX 4070 Ti. Si le serveur affiche « délai dépassé », augmente `timeoutMs` ou prends un modèle plus petit.

### Option 2 : l'API Claude

Mets `"ai": { "provider": "anthropic" }` dans `config.json`, puis lance le serveur avec ta clé dans une variable
d'environnement (**jamais dans config.json**, qui pourrait finir sur GitHub) :

```powershell
$env:ANTHROPIC_API_KEY="sk-ant-..."
npm start
```

Le modèle par défaut est `claude-haiku-5-5` (rapide et peu cher), réglable avec `anthropicModel`.
L'API est facturée à part de l'abonnement Claude : les crédits API inclus dans l'abonnement Max doivent d'abord être
réclamés dans la Console (<https://platform.claude.com>, page Billing), en y liant une organisation. Le coût reste faible :
l'IA n'est appelée que quelques dizaines de fois par heure (limite réglable avec `maxPerMinute`, 8 par défaut).

### Réglages

| Réglage (`ai`) | Défaut | Rôle |
| --- | --- | --- |
| `provider` | `off` | `off`, `ollama` ou `anthropic` |
| `ollamaUrl` / `ollamaModel` | `http://localhost:11434` / `qwen2.5:14b` | Adresse et modèle Ollama |
| `anthropicModel` | `claude-haiku-5-5` | Modèle de l'API Claude |
| `timeoutMs` | 12000 | Au-delà, la réponse est abandonnée |
| `maxPerMinute` | 8 | Nombre maximum d'appels par minute |

Les variables d'environnement `AI_PROVIDER` et `OLLAMA_MODEL` remplacent `config.json` le temps d'une session.
Au démarrage, le serveur affiche la ligne « IA du donjon : … » pour confirmer ce qui est actif.

## Journaux de session

Le serveur note tout dans `logs/session-<date>_<heure>.jsonl` (un fichier par lancement, une ligne JSON par fait) :
commandes et réponses du jeu, messages, tous les évènements (privés compris), connexions (téléphone ou ordinateur),
résumé de chaque tour (durée de calcul, joueurs en vie, pages ouvertes), classement toutes les 10 tours,
actions de la régie, `!bug` et `!avis` avec contexte, erreurs du serveur, erreurs JavaScript des pages
et images/seconde de chaque page (toutes les 2 min).

- **Régie → « Journaux pour Claude »** : télécharge le rapport Markdown (résumé lisible : retours des joueurs, erreurs
  regroupées, commandes refusées, morts et causes, activité par tranche de 10 min, perfs) et le journal brut.
  Les deux couvrent la dernière soirée, même si le serveur a été relancé plusieurs fois (une pause de plus de 2 h
  sans serveur sépare deux soirées : les essais de l'après-midi ne sont pas mélangés).
- **En ligne de commande** : `npm run rapport` écrit `logs/rapport-<date>.md` (ou `npm run rapport -- logs/session-x.jsonl`).
- La clé de régie et la clé API ne sont jamais écrites dans les journaux. Les pseudos et messages du chat, si.
- `LOGS=0` désactive le journal. Le dossier `logs/` n'est pas envoyé sur GitHub.

## Tests et outils

```powershell
npm test               # tests (règles, génération, mort, alliances, effondrement, votes, régie, IA simulée)
npm run simulate       # simule une session de 10 bots pendant 1 h de jeu et affiche un bilan
npm run bots -- 6      # connecte 6 bots au serveur lancé, pour voir la page s'animer
npm run typecheck      # vérification TypeScript
npm run rapport        # rapport de la dernière soirée à partir de logs/
```

## Organisation du code

```
src/shared/        types et analyse des commandes, partagés serveur/page
src/server/        serveur HTTP + WebSocket, sauvegarde, Twitch
src/server/game/   moteur : engine.ts (tours, combats, votes…), dungeon.ts (génération), data.ts (classes, objets,
                   monstres, textes), production.ts (événements soumis au vote)
src/server/ai.ts   appels à l'IA (Ollama / API Claude) ; narrator.ts : narration et marchand
src/server/journal.ts  journal de session (logs/*.jsonl) ; report.ts : rapport Markdown
client/            page joueur (Vite) : main.ts (interface), map.ts (rendu pixel art), tiles.ts (planche de sprites)
client/src/stream/ page stream 3D (three.js) : world.ts (scène, réalisateur, étiquettes), assets.ts (modèles KayKit)
scripts/           simulation et bots de test
tests/             tests Vitest
```

Presque tout l'équilibrage se règle dans `src/server/game/data.ts` (stats des classes, objets, monstres, textes drôles).

## Limites connues

- L'équilibrage n'a été testé qu'avec des bots : à ajuster après la première vraie session.
- La lecture du chat Twitch n'a pas pu être testée en conditions réelles.
- Pas de comptes : n'importe qui peut prendre un pseudo sur la page. Suffisant entre amis, à revoir pour Twitch.
- L'IA du donjon (Ollama ou API Claude) n'a pas pu être testée en conditions réelles.
- La régie est protégée par une simple clé dans l'adresse : ne la partage pas.
- Hors périmètre de la phase 1 : stream 3D, IA des PNJ, points de chaîne.
