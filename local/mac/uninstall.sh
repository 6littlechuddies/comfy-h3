#!/bin/bash
# removes the H3 Hugging Face key helper from this Mac (the keys already on your Google Drive stay)
APP="$HOME/Library/Application Support/H3KeyHelper"
PLIST="$HOME/Library/LaunchAgents/com.h3.keyhelper.plist"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
if [ -f "$APP/config.json" ]; then
  for a in $(/usr/bin/python3 -c 'import json,sys; print(" ".join(x["login"] for x in json.load(open(sys.argv[1])).get("accounts",[])))' "$APP/config.json" 2>/dev/null); do
    security delete-generic-password -s h3-hf-key-helper -a "$a" >/dev/null 2>&1 && echo "Removed the Keychain password for $a"
  done
fi
rm -rf "$APP" "$HOME/H3 Key Helper"
echo "The H3 key helper is removed."
