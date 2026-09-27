#!/usr/bin/env bash
# Build the static site and publish it to the gh-pages branch (served by GitHub Pages).
# Usage: npm run deploy
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_NAME="$(basename -s .git "$(git remote get-url origin)")"
REMOTE="$(git remote get-url origin)"

STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH="/$REPO_NAME" npx next build
touch .next-export/.nojekyll   # serve _next/ as-is
rm -f .next-export/house.fbx   # local-only source asset, not used by the game

TMP="$(mktemp -d)"
cp -R .next-export/. "$TMP"
cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="deploy" -c user.email="deploy@localhost" commit -qm "Deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -f -q "$REMOTE" gh-pages
cd - >/dev/null
rm -rf "$TMP"
echo "Deployed → https://$(git remote get-url origin | sed -E 's#https://github.com/([^/]+)/.*#\1#').github.io/$REPO_NAME/"
