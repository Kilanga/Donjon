# Backlog — retours du stream du 11/11/2026

Mis de côté pendant le passage du jeu en anglais. À reprendre dans cet ordre.

## 1. Ce qui casse la partie — FAIT (12/11)
- Bloquer la création de nouveaux personnages après la fin de l'étage 1, pour tout le monde (PNJ compris). Seule la résurrection reste possible. Règle aussi la « partie infinie » (les PNJ en game over refaisaient !join et l'étage 1 était recreusé en boucle).
- Bug : un joueur ressuscité par le vote alors qu'il a refait !join est téléporté avec son nouveau perso à l'étage n+1 (Kilak, game over n°1 puis n°2).
- Inondé : supprimer les déplacements ratés (1 sur 3, beaucoup trop). Proposition : l'eau cache les pièges, −1 agilité, des objets dérivent.
- Pièges : plafond à 25 % des salles ; « Pièges à foison » ne fait que réarmer + 1 piège ; les PNJ ne votent plus aux votes de production (7 voix PNJ pour 1 humain).
- !commandes : ne plus ouvrir le grand panneau sur le stream (sabotage possible), juste une ligne de chat, avec limite par personne.
- Étages de 15 min (le premier 30) : environ 2 h 15 de partie. Afficher « Fin de saison dans … » sur le stream.
- Immunité après réapparition : 1 min, perdue dès qu'on attaque.

## 2. Règles — FAIT (12/11) : résurrection au choix or (50 × étage) ou moitié des PV actuels
- !attaque sans monstre : cible au hasard parmi les joueurs de la salle (hors alliés et immunisés).
- Fusionner !fouille et !ramasse. Si deux joueurs le font au même tour : jet de d20 contre d20. Le butin de fouille revient au bout de 5 tours.
- Monstres : réapparition dans la salle où ils sont morts (si elle est vide), avec un message.
- Résurrection par un autre joueur : les tombes des éliminés réapparaissent dans une crypte de l'étage suivant ; `!resurrect <nom>` dans la crypte, contre un coût (or ou PV — à décider).
- Équilibrage : un boss d'étage doit être battable seul par un joueur de niveau étage+1 (viser ~80 % pour toutes les classes). Simulation actuelle : boss de l'étage 1 trop fort, mage trop faible, derniers étages trop durs sauf voleur (l'agilité sert à toucher et à esquiver).
- Caméra : +1 au score d'action par étage, seuil plus bas pour changer d'étage (aujourd'hui elle reste collée à l'étage des vrais joueurs).
- Alliances : OK. Les PNJ acceptent un peu trop vite, ils pourraient parfois refuser.

## 3. Interface
- Onglet « Mon journal » (uniquement ce qui me concerne).
- Décor partagé entre 2D et 3D (tiré une fois, même place dans les deux vues) : la 2D paraît vide.
- Carte 2D : l'écusson « piège » seulement si le piège a été vu ; corriger « scellé (saison pas commencée) » sur un étage recreusé.
- Nouvelles salles possibles : autel (bénédiction/malédiction), fontaine (soin ou poison), tripot squelette, prisonnier à libérer, salle aux leviers (vote du chat), bibliothèque (parchemins), statue à énigme, puits à vœux, portail instable, ogre endormi, mini-boss errant, coffre du sponsor.

## 4. Son et voix
- ~~Voix pour l'IA du donjon~~ : fait — Victoria Steele, Qwen3-TTS en local (voix créée sur mesure), 15 s max en fin de tour, réagit parfois au chat (jamais aux commandes ni aux bots), baisse du reste du son, régie (Say this, Skip, Mute, volume).
- Musique adaptative (exploration / combat / boss / dernière minute) à partir de morceaux sans risque sur Twitch (StreamBeats).
- Lien de la partie dans le chat : !lien est déjà pris (liaison de compte) et le jeu ne peut pas écrire dans le chat. Options : (a) adresse fixe via un tunnel Cloudflare sur un domaine à soi + commande Cloudbot !carte ; (b) compte bot Twitch autorisé à écrire.

## Décisions en attente
- Lien : adresse fixe ou bot Twitch.
- Quelles nouvelles salles garder.
