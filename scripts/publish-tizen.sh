#!/usr/bin/env bash
# Publishes the Samsung TV module (tv/tizen) to npm and clears jsDelivr's cache of it, so TVs pick
# up the new version the next time TizenBrew starts (instead of whenever the CDN cache expires).
#
#   bash scripts/publish-tizen.sh [one-time-code]
#
# The npm login can live in the gitignored .npmrc.local (NPM_CONFIG_USERCONFIG=$PWD/.npmrc.local
# npm login); it's used when present.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .npmrc.local ] && export NPM_CONFIG_USERCONFIG="$PWD/.npmrc.local"

NAME=$(node -p "require('./tv/tizen/package.json').name")
VERSION=$(node -p "require('./tv/tizen/package.json').version")
if [ "$(npm view "$NAME@$VERSION" version 2>/dev/null)" = "$VERSION" ]; then
  echo "$NAME@$VERSION is already published; bump the version in tv/tizen/package.json first." >&2
  exit 1
fi

npm run build:tizen
npm publish --access public ${1:+--otp="$1"} ./tv/tizen

for path in "" /package.json /dist/kitsune.js; do
  curl -fsS -o /dev/null "https://purge.jsdelivr.net/npm/$NAME$path" && echo "purged jsDelivr: npm/$NAME$path"
done
echo "Published $NAME@$VERSION"
