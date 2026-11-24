#!/usr/bin/env bash
# Legger ut siste versjon av Flaksefeber fra GitHub på VPS-en.
#
#   ./deploy.sh
#
# Kjør som brukeren som eier pm2-prosessen (IKKE med sudo; skriptet spør selv
# om sudo der det trengs). Skriptet bygger og tester i en midlertidig mappe
# først, så den kjørende siden røres bare hvis alt gikk bra.
#
# Appen startes av pm2 med ecosystem.config.cjs (første gang startes den,
# senere lastes den inn på nytt).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Akademiet-ki-lab/Flaksefeber.git}"
# Privat repo med deploy key: bruk disse to linjene i stedet for REPO_URL over
# REPO_URL="git@github.com:Akademiet-ki-lab/Flaksefeber.git"
# export GIT_SSH_COMMAND="ssh -i ~/.ssh/flaksefeber_deploy -o IdentitiesOnly=yes"
BRANCH="main"

TARGET_DIR="${TARGET_DIR:-/var/www/html/flaksefeber}"
PM2_NAME="flaksefeber"
PM2_USER="$(whoami)"                                   # brukeren som eier pm2-prosessen
export PORT="${PORT:-49000}"                           # må stemme med proxyen (nginx/Apache)

if [[ "$EUID" -eq 0 ]]; then
  echo "Ikke kjør dette med sudo: pm2-prosessen skal eies av en vanlig bruker."
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT   # rydder opp også hvis noe feiler

echo "==> Henter $BRANCH fra GitHub..."
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP_DIR"
[[ -f "$TMP_DIR/ecosystem.config.cjs" && -f "$TMP_DIR/next.config.js" ]] \
  || { echo "Fant ikke ecosystem.config.cjs / next.config.js i repoet"; exit 1; }
echo "    Versjon: $(git -C "$TMP_DIR" log -1 --format='%h %s')"

echo "==> Installerer, tester og bygger (i midlertidig mappe)..."
(
  cd "$TMP_DIR"
  npm ci --no-audit --no-fund
  npm test
  npm run build
)

if [[ -f "$TARGET_DIR/data/flaksefeber.db" ]]; then
  echo "==> Tar backup av databasen..."
  (cd "$TMP_DIR" && DATA_DIR="$TARGET_DIR/data" node scripts/admin.js backup)
fi

echo "==> Kopierer til $TARGET_DIR..."
sudo mkdir -p "$TARGET_DIR"
# data/ (databasen) er utelatt, så --delete rører den aldri
sudo rsync -a --delete \
  --exclude='.git*' --exclude='data/' --exclude='backup/' --exclude='test/' \
  "$TMP_DIR/" "$TARGET_DIR/"

echo "==> Setter rettigheter..."
sudo chown -R www-data:www-data "$TARGET_DIR"
sudo mkdir -p "$TARGET_DIR/data"
# Node må kunne skrive databasen og .next/cache. data/ er 700, så webserveren
# (www-data) aldri kan lese eller servere databasen.
sudo chown -R "$PM2_USER" "$TARGET_DIR/data" "$TARGET_DIR/.next"
sudo chmod 700 "$TARGET_DIR/data"

echo "==> Starter appen på nytt..."
pm2 startOrReload "$TARGET_DIR/ecosystem.config.cjs" --only "$PM2_NAME" --update-env
pm2 save >/dev/null

echo "==> Sjekker at siden svarer..."
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
    echo "Deployment completed successfully! (port $PORT)"
    exit 0
  fi
  sleep 1
done
echo "Appen svarer ikke på port $PORT. Se loggen: pm2 logs $PM2_NAME --lines 50"
exit 1
