#!/bin/bash
# builds H3-Studio-Local.zip (the Studio for your own PC) from this repo: run after "npm run build" in studio/
set -e
cd "$(dirname "$0")/.."
OUT=${1:-/tmp/H3-Studio-Local.zip}
T=$(mktemp -d); D="$T/H3-Studio-Local"; mkdir -p "$D"
cp -r studio/dist "$D/studio"
cp scripts/studio_server.py scripts/h3-grok.user.js models.txt "$D/"
cp -r prompts "$D/prompts"
cp local/setup.ps1 local/start.ps1 local/README.txt local/models_local.txt "local/1 - Setup (run once).bat" "local/2 - Start Studio.bat" "local/3 - Connect Google Drive (optional).bat" local/connect-google-drive.ps1 "$D/"
rm -f "$OUT"; (cd "$T" && zip -qr "$OUT" H3-Studio-Local)
rm -rf "$T"; echo "$OUT"
