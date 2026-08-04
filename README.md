# Panorama Ratio Corrector (PanoRaCo)

Outil en ligne pour ajuster la hauteur de photos panoramiques au ratio **2:1** en étendant verticalement la dernière ligne de pixels du haut.

## Comment ça marche

1. **Upload** — vous uploadez une photo panoramique (PNG, JPEG, WebP, BMP).
2. **Analyse** — l'outil récupère la largeur de l'image et calcule la hauteur cible : `largeur / 2`.
3. **Vérification** — si la hauteur cible est **inférieure** à la hauteur actuelle, l'application affiche un message indiquant qu'elle n'est pas conçue pour ce type de modification.
4. **Extension** — sinon, la dernière ligne de pixels en haut de l'image est étendue verticalement pour combler l'espace manquant.
5. **Téléchargement** — le résultat est exporté en **PNG lossless**, sans perte de qualité.

## Traitement 100% local

Tous les calculs se font dans votre navigateur via Canvas API. Aucune donnée n'est envoyée à un serveur. Vos photos ne quittent jamais votre appareil.

## Cas d'usage typique

Photos panoramiques avec un ratio plus large que 2:1 (par exemple 3:1, 4:1, etc.) qu'on souhaite ramener à un ratio 2:1 en ajoutant une bande de ciel / plafond / fond uniforme en haut.

## Déploiement

Site statique déployé sur Vercel, lié au repo GitHub [`Minher0/PanoRaCo`](https://github.com/Minher0/PanoRaCo).

## License

MIT
