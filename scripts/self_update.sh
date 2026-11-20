#!/usr/bin/env bash
# Rental self-update: brings in the newest Studio code (web app, server, downloader, prompt files, models.txt) from the
# repo's "code-latest" release, so most changes reach rentals without rebuilding the image. Only taken when the bundle
# was made for this same image (IMAGE_REV) — a change that needs new ComfyUI nodes etc. waits for the new image.
# Any problem (no internet, private repo, wrong image) just keeps the code the image came with.
# Exit 10 = start.sh itself changed (start.sh then runs the new one).   H3_UPDATE=0 turns it off.
[[ "${H3_UPDATE:-1}" == "0" ]] && { echo "self-update: off (H3_UPDATE=0)"; exit 0; }
H3="${H3_DIR:-/opt/h3}"
URL="${H3_CODE_URL:-https://github.com/${H3_REPO:-6littlechuddies/comfy-h3}/releases/download/code-latest/h3-code.tar.gz}"
TMP="$(mktemp -d /tmp/h3-code.XXXXXX)" || exit 0
trap 'rm -rf "$TMP"' EXIT
if ! curl -fsSL --retry 2 --connect-timeout 10 --max-time 120 -o "$TMP/code.tgz" "$URL"; then
  echo "self-update: couldn't fetch the newest code (repo private or no internet) — using the image's own"; exit 0
fi
mkdir -p "$TMP/b" && tar -xzf "$TMP/code.tgz" -C "$TMP/b" 2>/dev/null || { echo "self-update: broken bundle — skipped"; exit 0; }
want="$(cat "$TMP/b/IMAGE_REV" 2>/dev/null)"; have="$(cat "$H3/IMAGE_REV" 2>/dev/null)"
if [[ -z "$want" || "$want" != "$have" ]]; then
  # only the node list differs (same base image): install the nodes this code needs, here, then take the code
  wbase="$(cat "$TMP/b/IMAGE_BASE" 2>/dev/null)"; hbase="$(cat "$H3/IMAGE_BASE" 2>/dev/null)"
  if [[ -n "$wbase" && "$wbase" == "$hbase" && -s "$TMP/b/custom_nodes.txt" ]]; then
    echo "self-update: new ComfyUI nodes in this code — installing them on this rental"
    COMFY_DIR="${COMFY_DIR:-/opt/ComfyUI}"; cons="$TMP/torch.txt"
    pip freeze 2>/dev/null | grep -iE '^(torch|torchvision|torchaudio)==' > "$cons" || true
    ok=1
    while read -r line; do
      grep -qxF "$line" "$H3/custom_nodes.txt" 2>/dev/null && continue   # already there at this version
      repo="${line%@*}"; ref=""; [[ "$line" == *@* ]] && ref="${line##*@}"
      name="$(basename "$repo" .git)"; dir="$COMFY_DIR/custom_nodes/$name"
      echo "self-update:   node $name ${ref:0:7}"
      rm -rf "$dir.new"
      if git clone -q --depth 1 "$repo" "$dir.new" && { [[ -z "$ref" ]] || (cd "$dir.new" && git fetch -q --depth 1 origin "$ref" && git checkout -q FETCH_HEAD); }; then
        rm -rf "$dir" && mv "$dir.new" "$dir"
        [[ -f "$dir/requirements.txt" ]] && { pip install -q -r "$dir/requirements.txt" -c "$cons" || echo "self-update:   (its requirements didn't all install)"; }
        [[ -f "$dir/install.py" ]] && { (cd "$dir" && python install.py) >/dev/null 2>&1 || true; }
      else echo "self-update:   couldn't get $name"; rm -rf "$dir.new"; ok=0; fi
    done < <(grep -vE '^\s*(#|$)' "$TMP/b/custom_nodes.txt")
    if [[ $ok == 1 ]]; then cp -f "$TMP/b/custom_nodes.txt" "$H3/custom_nodes.txt"; echo "$want" > "$H3/IMAGE_REV"
    else echo "self-update: a node didn't install — keeping this rental's code; try a restart, or a new rental"; exit 0; fi
  else
    echo "self-update: the newest code needs a newer image (${want:-?} vs ${have:-?}) — delete this rental and make a new one to get it"; exit 0
  fi
fi
new="$(cat "$TMP/b/CODE_REV" 2>/dev/null)"
if [[ -n "$new" && "$new" == "$(cat "$H3/CODE_REV" 2>/dev/null)" ]]; then echo "self-update: already up to date (${new:0:7})"; exit 0; fi
for f in studio/index.html studio_server.py downloader.py start.sh models.txt; do
  [[ -s "$TMP/b/$f" ]] || { echo "self-update: bundle is missing $f — skipped"; exit 0; }
done
python3 -m py_compile "$TMP/b/studio_server.py" "$TMP/b/downloader.py" "$TMP/b/watchdog.py" 2>/dev/null || { echo "self-update: bundle's Python doesn't compile — skipped"; exit 0; }
bash -n "$TMP/b/start.sh" || { echo "self-update: bundle's start.sh has errors — skipped"; exit 0; }
old_start="$(sha256sum "$H3/start.sh" | cut -c1-64)"
# the web app: swapped as a whole folder (old asset files gone)
rm -rf "$H3/studio.new" && mv "$TMP/b/studio" "$H3/studio.new" && rm -rf "$H3/studio.old" \
  && { [[ -d "$H3/studio" ]] && mv "$H3/studio" "$H3/studio.old"; mv "$H3/studio.new" "$H3/studio"; } && rm -rf "$H3/studio.old"
[[ -d "$TMP/b/prompts" ]] && rm -rf "$H3/prompts" && mv "$TMP/b/prompts" "$H3/prompts"
for f in studio_server.py downloader.py watchdog.py comfy_router.py Caddyfile h3-grok.user.js start.sh models.txt CLAUDE.md self_update.sh install_nodes.sh; do
  # a new file put in place (not written over): start.sh and this script are running while they're replaced
  [[ -f "$TMP/b/$f" ]] && cp -f "$TMP/b/$f" "$H3/$f.new" && mv -f "$H3/$f.new" "$H3/$f"
done
chmod +x "$H3/start.sh" "$H3/self_update.sh"
mkdir -p "$H3/boot" && [[ -f "$TMP/b/boot/boot.html" ]] && cp -f "$TMP/b/boot/boot.html" "$H3/boot/boot.html"
# the startup screen uses the Studio's own fonts (their file names change with each build)
for pair in "archivo-latin-wdth-normal-:archivo" "ibm-plex-mono-latin-400-normal-:plex-400" "ibm-plex-mono-latin-500-normal-:plex-500"; do
  src="$(ls "$H3"/studio/assets/"${pair%%:*}"*.woff2 2>/dev/null | head -1)"; [[ -n "$src" ]] && cp -f "$src" "$H3/boot/${pair##*:}.woff2"
done
echo "$new" > "$H3/CODE_REV"
echo "self-update: now on the newest code (${new:0:7})"
[[ "$(sha256sum "$H3/start.sh" | cut -c1-64)" != "$old_start" ]] && exit 10
exit 0
