# Pillbox Paie Test — V0.2.8 Northflank 24/7

Cette version est préparée pour héberger le bot Discord sur **Northflank** sans laisser un terminal ouvert sur le PC.

## Ce qui change

- Railway retiré de cette version.
- Dockerfile corrigé : l'ancienne version utilisait `npm ci` sans `package-lock.json`.
- Northflank construit maintenant avec `npm install --omit=dev`.
- `/paye` est toujours vérifiée/déployée automatiquement au démarrage.
- Aucun serveur web et aucun port public ne sont nécessaires.
- Le token Discord n'est pas inclus dans ce ZIP.
- Les 3 variables nécessaires restent :
  - `DISCORD_TOKEN`
  - `CLIENT_ID=1564403459187548240`
  - `GUILD_ID=1564379186657763431`

## Déploiement

Lis **NORTHFLANK_24_7_GUIDE.txt**.

## Mise à jour future

Le plus simple est de mettre ce dossier dans un dépôt GitHub. Northflank peut construire et redéployer automatiquement les nouveaux commits de la branche liée.

## Important

La session de paie courante est encore conservée en mémoire. Si le conteneur redémarre ou si tu déploies une nouvelle version pendant une session, cette session est perdue. Les données métier permanentes ne sont pas ajoutées dans cette version.
