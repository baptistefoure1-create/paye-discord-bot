@echo off
setlocal
cd /d "%~dp0"
title Pillbox Paie - Verification GitHub

echo ============================================================
echo  VERIFICATION AVANT ENVOI SUR GITHUB
echo ============================================================
echo.

if exist ".env" (
  echo [ATTENTION] Un fichier .env existe dans ce dossier.
  echo Il est ignore par .gitignore, mais ne le publie jamais manuellement.
) else (
  echo [OK] Aucun .env dans ce dossier.
)

if exist "Dockerfile" (echo [OK] Dockerfile present) else (echo [ERREUR] Dockerfile absent)
if exist "package.json" (echo [OK] package.json present) else (echo [ERREUR] package.json absent)
if exist ".gitignore" (echo [OK] .gitignore present) else (echo [ERREUR] .gitignore absent)

echo.
echo Variables a ajouter dans Northflank :
echo   DISCORD_TOKEN = ton token
 echo  CLIENT_ID = 1564403459187548240
 echo  GUILD_ID  = 1564379186657763431

echo.
echo Lis NORTHFLANK_24_7_GUIDE.txt pour les clics exacts.
echo.
pause
