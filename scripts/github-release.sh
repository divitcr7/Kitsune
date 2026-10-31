#!/usr/bin/env bash
# Publishes the GitHub release for the version in app.json: creates it as a draft, attaches
# dist/Kitsune-vX.Y.Z.apk and its .sha256, then publishes it. Installed apps (phones and Android TV)
# see it within a few hours and offer the update.
#
#   bash scripts/github-release.sh release-notes.md
#
# Build first (npm run build:apk). Uses your existing GitHub login (the git credential helper).
# The first lines of the notes are what the in-app update sheet shows.
set -euo pipefail
cd "$(dirname "$0")/.."
NOTES_FILE="${1:?Pass a file with the release notes}"
VERSION=$(node -p "require('./app.json').expo.version")
APK="dist/Kitsune-v$VERSION.apk"
[ -f "$APK" ] && [ -f "$APK.sha256" ] || { echo "Build $APK first (npm run build:apk)." >&2; exit 1; }
(cd dist && shasum -a 256 -c "Kitsune-v$VERSION.apk.sha256")

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
H=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
API=https://api.github.com/repos/divitcr7/Kitsune

BODY=$(VERSION="$VERSION" NOTES_FILE="$NOTES_FILE" node -e '
const fs = require("fs");
const v = process.env.VERSION;
process.stdout.write(JSON.stringify({ tag_name: "v" + v, target_commitish: "main", name: "Kitsune v" + v, body: fs.readFileSync(process.env.NOTES_FILE, "utf8").trim(), draft: true }));
')

ID=$(curl -fsS "${H[@]}" -X POST "$API/releases" -d "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
echo "draft release $ID"
for f in "$APK:application/vnd.android.package-archive" "$APK.sha256:text/plain"; do
  file=${f%%:*}; type=${f#*:}; name=$(basename "$file")
  curl -fsS "${H[@]}" -H "Content-Type: $type" --data-binary "@$file" \
    "https://uploads.github.com/repos/divitcr7/Kitsune/releases/$ID/assets?name=$name" >/dev/null
  echo "attached $name"
done
curl -fsS "${H[@]}" -X PATCH "$API/releases/$ID" -d '{"draft": false, "make_latest": "true"}' >/dev/null
echo "published https://github.com/divitcr7/Kitsune/releases/tag/v$VERSION"
