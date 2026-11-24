#!/bin/zsh

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Akademiet-ki-lab/Flaksefeber.git}"
# Privat repo med deploy key: bruk disse to linjene i stedet for REPO_URL over
# REPO_URL="git@github.com:Akademiet-ki-lab/Flaksefeber.git"
# export GIT_SSH_COMMAND="ssh -i ~/.ssh/flaksefeber_deploy -o IdentitiesOnly=yes"
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Bruk: $0 [branch]   (standard: main)"
  exit 0
fi
BRANCH="${1:-main}"

TARGET_DIR="${TARGET_DIR:-/var/www/html/flaksefeber}"
PM2_NAME="flaksefeber"
export PORT="${PORT:-49000}"                           # må stemme med proxyen (nginx/Apache)

if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  source "$NVM_DIR/nvm.sh"
  nvm use --silent default
fi

if [[ "$EUID" -eq 0 ]]; then
  echo "Ikke kjør dette som root; brukeren som kjører deploy må eie appmappa og PM2-prosessen."
  exit 1
fi

if [[ ! -d "$TARGET_DIR" || ! -w "$TARGET_DIR" || ! -x "$TARGET_DIR" ]]; then
  echo "Appmappa finnes ikke eller er ikke skrivbar: $TARGET_DIR"
  exit 1
fi

if [[ "$(stat -c '%u' "$TARGET_DIR")" != "$(id -u)" ]]; then
  echo "Brukeren $(id -un) må eie appmappa: $TARGET_DIR"
  exit 1
fi

if [[ -e "$TARGET_DIR/data" ]]; then
  if [[ ! -d "$TARGET_DIR/data" || ! -w "$TARGET_DIR/data" || ! -x "$TARGET_DIR/data" ]] \
    || [[ "$(stat -c '%u' "$TARGET_DIR/data")" != "$(id -u)" ]]; then
    echo "Deploybrukeren må eie og kunne skrive til $TARGET_DIR/data"
    exit 1
  fi
fi

for command_name in git npm pm2 tar curl stat; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name må være installert og tilgjengelig i PATH."
    exit 1
  fi
done

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT   # rydder opp også hvis noe feiler

echo "==> Henter $BRANCH fra GitHub..."
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP_DIR" \
  || { echo "Fant ikke branchen \"$BRANCH\" i $REPO_URL"; exit 1; }
[[ -f "$TMP_DIR/ecosystem.config.cjs" && -f "$TMP_DIR/package.json" ]] \
  && [[ -f "$TMP_DIR/next.config.ts" || -f "$TMP_DIR/next.config.js" || -f "$TMP_DIR/next.config.mjs" ]] \
  || { echo "Fant ikke ecosystem.config.cjs / package.json / next.config i branchen \"$BRANCH\""; exit 1; }
echo "    Branch: $BRANCH, versjon: $(git -C "$TMP_DIR" log -1 --format='%h %s')"

echo "==> Installerer, tester og bygger (i midlertidig mappe)..."
(
  cd "$TMP_DIR"
  npm ci --no-audit --no-fund
  npm test
  npm run build
)

if [[ -f "$TARGET_DIR/data/flaksefeber.db" ]]; then
  echo "==> Tar backup av databasen..."
  (cd "$TMP_DIR" && DATA_DIR="$TARGET_DIR/data" npm run -s admin -- backup)
fi

echo "==> Kopierer til $TARGET_DIR..."
mkdir -p "$TARGET_DIR/data"
chmod 700 "$TARGET_DIR/data"

# data/ og backup/ bevares; resten av appmappa erstattes atomisk som innhold.
find "$TARGET_DIR" -mindepth 1 -maxdepth 1 \
  ! -name data -exec rm -rf -- {} +
(
  cd "$TMP_DIR"
  tar --exclude='.git' --exclude='.git/*' --exclude='data' --exclude='data/*' \
    --exclude='backup' --exclude='backup/*' --exclude='test' --exclude='test/*' \
    -cf - .
) | (
  cd "$TARGET_DIR"
  tar -xf -
)

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
