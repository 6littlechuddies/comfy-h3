#!/usr/bin/env bash
# Runs automatically when a Vast instance boots (via the launcher's --onstart-cmd).
# 1. starts a password-protected front door on port 8188
# 2. downloads every model in models.txt in parallel, and checks the host's real speed
#    -> if the host is a dud (too slow), it destroys itself so you stop paying for it
# 3. starts ComfyUI with SageAttention, then an idle watchdog that auto-destroys when unused
#
# Settings (all optional, passed as -e VAR=value by the launcher):
#   COMFY_USER / COMFY_PASSWORD   login for the web UI   (default user "admin", random password if unset)
#   MIN_MBPS=25                   below this (best 15 s of the first 2 min, MB/s) the start page warns it will be slow
#   KILL_MBPS=10                  below this the host is unusable: it stops (and destroys itself, see below)
#   SPEED_CHECK_SECONDS=120       how long to measure before judging the host
#   AUTO_DESTROY_SLOW=1           destroy this instance if it fails the speed check
#   IDLE_MINUTES=30               shut down after this many minutes unused: no jobs, no downloads, nobody using the Studio (0 = never)
#   EXTRA_NODES                   comma-separated GitHub links of extra custom nodes to install at boot (no rebuild)
#   HF_TOKEN                      Hugging Face token (sent to huggingface.co only) — makes downloads ~300 MB/s
#   HF_TOKENS                     several keys, comma-separated: when Hugging Face slows one down, the next is used
#   CIVITAI_TOKEN                 CivitAI API key for LoRA downloads (sent to civitai.com only)
#   EXTRA_MODELS                  extra downloads without a rebuild: folder|url|filename,folder|url|filename
#   COMFY_ARGS                    extra ComfyUI flags (default: --disable-pinned-memory --preview-method auto)
#   H3_SAGE                       1 = allow --use-sage-attention (off: it makes Qwen-Image-Edit pictures black)
#   RCLONE_REMOTE                 e.g. r2:my-bucket/outputs  -> outputs are backed up there (see README)
#   STUDIO_HTTPS=1                also open a secure https link (Cloudflare quick tunnel) for the Studio's microphone
#   GITHUB_TOKEN                  optional: lets Claude on the rental (h3-claude) clone this kit's repo and push its fixes
set -uo pipefail

# ---- run in background so Vast's onstart returns immediately --------------------------------
if [[ "${H3_BG:-}" != "1" ]]; then
  mkdir -p /opt/h3/run
  H3_BG=1 nohup setsid bash "$0" >>/var/log/h3-start.log 2>&1 &
  echo "h3 startup running in background — log: /var/log/h3-start.log"
  exit 0
fi

exec 9>/opt/h3/run/start.lock
flock -n 9 || { echo "start.sh already running"; exit 0; }

# ---- Vast ssh-mode: make sure container env vars are visible ---------------------------------
if [[ -z "${CONTAINER_ID:-}" && -r /proc/1/environ ]]; then
  while IFS= read -r -d '' kv; do
    k="${kv%%=*}"; [[ "$k" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && [[ -z "${!k:-}" ]] && export "$kv"
  done < <(cat /proc/1/environ 2>/dev/null)
fi

# ---- newest Studio code, without rebuilding the image (scripts/self_update.sh; H3_UPDATE=0 turns it off) ----------
if [[ "${H3_UPDATED:-}" != "1" && -f /opt/h3/self_update.sh ]]; then
  bash /opt/h3/self_update.sh; rc=$?
  if [[ $rc == 10 ]]; then echo "start.sh changed — running the new one"; exec 9>&-; H3_UPDATED=1 exec bash /opt/h3/start.sh; fi
fi

COMFY_DIR="${COMFY_DIR:-/opt/ComfyUI}"
RUN=/opt/h3/run
MODELS_TXT=/opt/h3/models.txt
MIN_MBPS="${MIN_MBPS:-25}"
KILL_MBPS="${KILL_MBPS:-}"
SPEED_CHECK_SECONDS="${SPEED_CHECK_SECONDS:-120}"
AUTO_DESTROY_SLOW="${AUTO_DESTROY_SLOW:-1}"
export IDLE_MINUTES="${IDLE_MINUTES:-30}"
# the template's example value (b2:YOUR-BUCKET-NAME/…) isn't a real backup: treat it as no backup at all
if [[ "${RCLONE_REMOTE:-}" == *YOUR-BUCKET* || "${RCLONE_REMOTE:-}" == *your-bucket* ]]; then
  echo "RCLONE_REMOTE is still the example value — backup to it is off"; unset RCLONE_REMOTE
fi
COMFY_ARGS="${COMFY_ARGS:---disable-pinned-memory --preview-method auto}"
# sage attention makes Qwen-Image-Edit output all-black pictures (NaNs) — the Edit chat's swaps and three-picture edits
# break. It's off even when an older template still passes the flag; H3_SAGE=1 turns it back on.
if [[ "${H3_SAGE:-0}" != "1" ]]; then COMFY_ARGS="$(echo " $COMFY_ARGS " | sed 's/ --use-sage-attention / /g; s/^ *//; s/ *$//')"; fi
export COMFY_ARGS
export COMFY_USER="${COMFY_USER:-admin}"
if [[ -z "${COMFY_PASSWORD:-}" ]]; then
  COMFY_PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)"
  echo "No COMFY_PASSWORD given — generated one: $COMFY_PASSWORD"
fi
export PATH="/opt/venv/bin:$PATH"
START_TS=$(date +%s)

status() {  # status <phase> <message> [extra json fields]
  local extra="${3:-}"
  printf '{"phase":"%s","message":"%s","elapsed_s":%d%s}\n' "$1" "$2" "$(( $(date +%s) - START_TS ))" "${extra:+,$extra}" \
    > "$RUN/status.json.tmp" && mv "$RUN/status.json.tmp" "$RUN/status.json"
  echo "[$(date +%T)] $1: $2"
}

self_destroy() {
  echo "Self-destroying instance ${CONTAINER_ID:-?}: $1"
  if [[ -n "${CONTAINER_ID:-}" ]]; then
    vastai destroy instance "$CONTAINER_ID" -y ${CONTAINER_API_KEY:+--api-key "$CONTAINER_API_KEY"} \
      || echo "!! self-destroy failed — the launcher will destroy it"
  fi
}

# ---- 1. front door --------------------------------------------------------------------------
status booting "starting web front door"
export COMFY_HASH="$(caddy hash-password --plaintext "$COMFY_PASSWORD")"
caddy run --config /opt/h3/Caddyfile --adapter caddyfile >/var/log/caddy.log 2>&1 &

# ---- GPU driver check: the image's PyTorch needs a driver for its CUDA version (13.0). An older host driver (Vast's
# "Max CUDA" 12.x) can't run it at all — ComfyUI would crash only after minutes of downloading. Say so now.
DRIVER_CUDA="$(nvidia-smi 2>/dev/null | grep -oP 'CUDA Version:\s*\K[0-9]+\.[0-9]+' | head -1)"
TORCH_CUDA="$(python -c 'import torch; print(torch.version.cuda or "")' 2>/dev/null)"
if [[ -n "$DRIVER_CUDA" && -n "$TORCH_CUDA" ]] && \
   python -c "import sys; d,t=[tuple(map(int,v.split('.')[:2])) for v in sys.argv[1:]]; sys.exit(0 if d<t else 1)" "$DRIVER_CUDA" "$TORCH_CUDA"; then
  WAIT_MIN=5; [[ "$AUTO_DESTROY_SLOW" == "1" ]] || WAIT_MIN=0
  status error "This machine's GPU driver is too old: it supports CUDA $DRIVER_CUDA, the Studio needs $TORCH_CUDA or newer. Destroy it and rent another one - on Vast set Filter Options, Min Cuda Version to $TORCH_CUDA (or pick offers that show Max CUDA $TORCH_CUDA or higher).$([[ $WAIT_MIN -gt 0 ]] && echo " It destroys itself in $WAIT_MIN minutes.")"
  if [[ $WAIT_MIN -gt 0 ]]; then sleep $(( WAIT_MIN * 60 )); self_destroy "GPU driver too old (CUDA $DRIVER_CUDA < $TORCH_CUDA)"; fi
  sleep infinity
fi

# ---- H3 Studio (http://<instance>/studio/) ----------------------------------------------------
# your remembered Studio settings/presets come back from cloud backup first, then the helper API starts
STUDIO_STATE="$COMFY_DIR/user/default/studio"; mkdir -p "$STUDIO_STATE"
if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  status restoring "bringing back your settings, characters and LoRA list"
  timeout 60 rclone copy "${RCLONE_REMOTE%/}/_studio" "$STUDIO_STATE" >/var/log/studio-restore.log 2>&1 \
    && echo "restored Studio settings from backup" || echo "(no Studio settings in backup yet)"
fi
export COMFY_DIR
nohup python /opt/h3/studio_server.py >/var/log/studio.log 2>&1 &

# ---- a terminal in the browser (/terminal/), inside tmux so closing the tab keeps it (and Claude) running ---------------
# ?arg=claude starts Claude Code on this rental straight away (h3-claude). Same password as everything else (Caddy).
if command -v ttyd >/dev/null; then
  nohup ttyd -p 7681 -i lo -b /terminal -W -a -t titleFixed="H3 rental" -t fontSize=14 \
    tmux new -A -s h3 /usr/local/bin/h3-terminal >/var/log/ttyd.log 2>&1 &
fi

# ---- secure https link (needed for the microphone in the Studio) — STUDIO_HTTPS=0 turns it off ---
# a free Cloudflare quick tunnel to the same password-protected front door; new random address each rental
if [[ "${STUDIO_HTTPS:-1}" != "0" ]] && command -v cloudflared >/dev/null; then
  rm -f "$RUN/https_url"
  nohup cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8188 >/var/log/cloudflared.log 2>&1 &
  ( for _ in $(seq 1 60); do
      u=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /var/log/cloudflared.log | head -1)
      [[ -n "$u" ]] && { echo "$u" > "$RUN/https_url"; echo "secure link: $u"; break; }
      sleep 2
    done ) &
fi

# ---- quick-add custom nodes (EXTRA_NODES) — installs in parallel with the model download ------
install_extra_nodes() {
  local IFS=','; local repo name
  for repo in ${EXTRA_NODES:-}; do
    repo="$(echo "$repo" | xargs)"; [[ -z "$repo" ]] && continue
    name="$(basename "${repo%.git}")"
    [[ -d "$COMFY_DIR/custom_nodes/$name" ]] && { echo "extra node $name already present"; continue; }
    echo "installing extra node $name"
    git clone --depth 1 "$repo" "$COMFY_DIR/custom_nodes/$name" \
      && { [[ ! -f "$COMFY_DIR/custom_nodes/$name/requirements.txt" ]] || pip install -q -r "$COMFY_DIR/custom_nodes/$name/requirements.txt"; } \
      || echo "!! failed to install $repo"
  done
}
EXTRA_PID=""
if [[ -n "${EXTRA_NODES:-}" ]]; then install_extra_nodes >/var/log/extra-nodes.log 2>&1 & EXTRA_PID=$!; fi

# ---- 2. models: downloaded group by group in the background (scripts/downloader.py) -------------
# Order comes from the "# @group" lines in models.txt (anime first, video last). The Studio opens as soon as the
# first group is in; each tab unlocks when its own group arrives. Progress: /opt/h3/run/downloads.json (/h3-downloads).
status downloading "checking model files"
rm -f "$RUN"/dl_*.done
MIN_MBPS="$MIN_MBPS" KILL_MBPS="$KILL_MBPS" SPEED_CHECK_SECONDS="$SPEED_CHECK_SECONDS" COMFY_DIR="$COMFY_DIR" H3_RUN="$RUN" \
  nohup python /opt/h3/downloader.py "$MODELS_TXT" >/var/log/downloader.log 2>&1 &
DL_PID=$!

# ---- 3. ComfyUI ------------------------------------------------------------------------------
# LoRA Manager reads its CivitAI key from CIVITAI_API_KEY; reuse the template's CIVITAI_TOKEN
[[ -n "${CIVITAI_TOKEN:-}" && -z "${CIVITAI_API_KEY:-}" ]] && export CIVITAI_API_KEY="$CIVITAI_TOKEN"
if [[ -n "$EXTRA_PID" ]]; then status loading "finishing extra custom nodes"; wait "$EXTRA_PID"; cat /var/log/extra-nodes.log; fi
cd "$COMFY_DIR"
# shellcheck disable=SC2086
python main.py --listen 127.0.0.1 --port 18188 $COMFY_ARGS >/var/log/comfyui.log 2>&1 &
COMFY_PID=$!
COMFY_UP=0
for _ in $(seq 1 3600); do
  [[ $COMFY_UP -eq 0 ]] && curl -sf http://127.0.0.1:18188/system_stats >/dev/null && COMFY_UP=1
  if ! kill -0 "$COMFY_PID" 2>/dev/null; then
    status error "ComfyUI crashed on startup — see /var/log/comfyui.log"
    tail -n 40 /var/log/comfyui.log; exit 1
  fi
  if [[ ! -f "$RUN/dl_first.done" ]] && ! kill -0 "$DL_PID" 2>/dev/null; then
    wait "$DL_PID"; rc=$?
    tail -n 20 /var/log/downloader.log
    if [[ $rc -eq 3 ]]; then
      status slow "host too slow to download the models"
      [[ "$AUTO_DESTROY_SLOW" == "1" ]] && self_destroy "slow download"
      exit 1
    fi
    status error "model download failed — see /var/log/downloader.log"; exit 1
  fi
  [[ -f "$RUN/dl_first.done" && $COMFY_UP -eq 1 ]] && break
  if [[ -f "$RUN/dl_first.done" ]]; then status starting "starting ComfyUI and loading its add-ons"
  else status downloading "downloading the first models"; fi
  sleep 2
done
status ready "ComfyUI is up (boot took $(( $(date +%s) - START_TS ))s; other models keep downloading in the background)"

# ---- 4. idle watchdog (auto-destroy + optional output backup) ---------------------------------
export COMFY_ARGS COMFY_DIR   # watchdog relaunches ComfyUI with the same flags if it crashes
exec python /opt/h3/watchdog.py
