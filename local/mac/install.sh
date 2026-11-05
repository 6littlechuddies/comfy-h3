#!/bin/bash
# H3 Hugging Face key helper for macOS — installer. Run it in Terminal with:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/6littlechuddies/comfy-h3/main/local/mac/install.sh)"
# Safe to run again: it updates the helper and keeps your accounts and Drive sign-in.
set -euo pipefail

RAW="${H3_RAW:-https://raw.githubusercontent.com/6littlechuddies/comfy-h3/main/local/mac}"
APP="$HOME/Library/Application Support/H3KeyHelper"
SHORT="$HOME/H3 Key Helper"
PLIST="$HOME/Library/LaunchAgents/com.h3.keyhelper.plist"
SERVICE="h3-hf-key-helper"
PY="$APP/venv/bin/python"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

[ "$(uname)" = "Darwin" ] || { echo "This installer is for macOS."; exit 1; }
mkdir -p "$APP" "$SHORT"; chmod 700 "$APP"

say "1/6  Python"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  echo "A window asked to install Apple's command line tools. Click Install, wait for it to finish, then run this installer again."
  exit 0
fi
command -v python3 >/dev/null || { echo "python3 is missing even after the command line tools. Install it from python.org and run this again."; exit 1; }

say "2/6  The helper and its hidden browser (a few minutes the first time)"
curl -fsSL "$RAW/h3_key_helper.py" -o "$APP/h3_key_helper.py"
[ -x "$PY" ] || python3 -m venv "$APP/venv"
"$PY" -m pip install -q --upgrade pip playwright
"$PY" -m playwright install chromium

say "3/6  Google Drive connection"
if [ ! -x "$APP/rclone" ]; then
  case "$(uname -m)" in arm64) ARCH=arm64;; *) ARCH=amd64;; esac
  T=$(mktemp -d)
  curl -fsSL "https://downloads.rclone.org/rclone-current-osx-$ARCH.zip" -o "$T/rclone.zip"
  unzip -q "$T/rclone.zip" -d "$T"
  cp "$T"/rclone-*/rclone "$APP/rclone"; chmod +x "$APP/rclone"
  xattr -d com.apple.quarantine "$APP/rclone" 2>/dev/null || true
  rm -rf "$T"
fi
RC=("$APP/rclone" --config "$APP/rclone.conf")
if ! "${RC[@]}" listremotes 2>/dev/null | grep -q '^h3drive:'; then
  echo "Your browser will open: sign in with the Google account your rentals use, and click Allow."
  "${RC[@]}" config create h3drive drive scope=drive >/dev/null
fi
chmod 600 "$APP/rclone.conf" 2>/dev/null || true
if "${RC[@]}" lsjson "h3drive:H3 Studio" --files-only --max-depth 1 >/dev/null 2>&1; then
  echo "Google Drive: OK — found the \"H3 Studio\" folder."
else
  echo "Couldn't open \"H3 Studio\" on that Google Drive. Make sure it's the same account as your rentals"
  echo "(to switch: delete \"$APP/rclone.conf\" and run this installer again)."
fi

say "4/6  Hugging Face accounts (passwords go in your Mac's Keychain, never in a file)"
existing=$("$PY" - "$APP/config.json" <<'EOF'
import json,sys
try: print(" ".join(a["login"] for a in json.load(open(sys.argv[1])).get("accounts",[])))
except Exception: pass
EOF
)
[ -n "$existing" ] && echo "Already set up: $existing"
while true; do
  read -r -p "Hugging Face username or email to add (just press Return when done): " LOGIN </dev/tty
  [ -z "$LOGIN" ] && break
  echo "Type the Hugging Face password for $LOGIN (twice; nothing shows while you type):"
  security add-generic-password -U -s "$SERVICE" -a "$LOGIN" -l "H3 key helper: Hugging Face" -w </dev/tty
  "$PY" "$APP/h3_key_helper.py" add-account "$LOGIN" || true
done

say "5/6  Shortcuts in your home folder: \"H3 Key Helper\""
mk() { printf '#!/bin/bash\n%s\necho; read -r -p "Press Return to close." _\n' "$2" > "$SHORT/$1.command"; chmod +x "$SHORT/$1.command"; }
Q="\"$PY\" \"$APP/h3_key_helper.py\""
mk "Make a key now"               "$Q now 1"
mk "Log in (show window)"         "$Q login"
mk "Status"                       "$Q status; echo; tail -n 20 \"$APP/helper.log\" 2>/dev/null"
mk "Add a Hugging Face account"   "bash -c \"\$(curl -fsSL $RAW/install.sh)\""
mk "Uninstall"                    "bash -c \"\$(curl -fsSL $RAW/uninstall.sh)\""

say "6/6  Background check (once a minute; does nothing unless a rental asks)"
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.h3.keyhelper</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$APP/h3_key_helper.py</string><string>check</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>$APP/launchd-errors.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

say "Done."
echo "When you press \"Get a fresh key from my PC\" on a rental's start page, this Mac makes the keys in a hidden"
echo "window and adds them to H3 Studio/hf_tokens.txt — the rental picks them up in about 2 minutes."
echo "If your Windows PC's helper is still running too, turn one of them off so they don't both answer."
open "$SHORT" 2>/dev/null || true
