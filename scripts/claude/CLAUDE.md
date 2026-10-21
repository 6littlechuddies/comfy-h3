# You are on an H3 kit rental (Vast.ai GPU)

The person you're helping runs this machine to make pictures and videos with the **H3 Studio** (a simple web app over ComfyUI).
They are not a developer: explain in plain words, keep answers short, and fix things rather than describe how to fix them.
Your job here: find out why something failed, fix it, and check the fix — reading the logs, the GPU, the queue and the code yourself.

## What runs where

| Thing | Where | Notes |
|---|---|---|
| Front door (password) | Caddy on `:8188` → `/opt/h3/Caddyfile` | `/studio/` Studio, `/studio-api/*` helper, `/terminal/` this terminal, `/` ComfyUI |
| ComfyUI | `127.0.0.1:18188`, code in `/opt/ComfyUI` | started by `/opt/h3/start.sh`; the watchdog restarts it if it dies |
| Studio helper API | `127.0.0.1:18190`, `/opt/h3/studio_server.py` (Python, aiohttp) | writer steps, characters, site uploads, training, downloads, state |
| Studio web app | `/opt/h3/studio/` (built JS only — the source is in the repo, see below) | builds every ComfyUI graph in the browser (`studio/src/lib/graphs.ts`) |
| Model downloads | `/opt/h3/downloader.py`, list in `/opt/h3/models.txt` (`# @group` blocks) | some groups are "later" until asked for: `trainer`, `qwen`, `qwen_full` |
| Idle watchdog | `/opt/h3/watchdog.py` | destroys/stops the rental after `IDLE_MINUTES` (45) with no jobs, no browser tab and no Claude activity |
| Secure link | cloudflared → `/opt/h3/run/https_url` | |

**How everything fits together:** `docs/HOW_IT_WORKS.md`.
**Slow model downloads / Hugging Face keys:** read `/opt/h3/repo/docs/HF_DOWNLOADS.md` (in the repo: `docs/HF_DOWNLOADS.md`)
before touching the downloader — keys slow down after one use, switching keys is wanted, and how to avoid getting flagged.

## Where to look first

- `h3-report` — one text report: GPU, disk, downloads per group, ComfyUI errors with tracebacks, the Studio's failed jobs, custom
  nodes that failed to load, and the last lines of every log (secrets hidden). `h3-report 400` for more log lines.
- Logs: `/var/log/studio.log`, `/var/log/comfyui.log`, `/var/log/downloader.log`, `/var/log/h3-start.log` (start + watchdog),
  `/var/log/caddy.log`, `/var/log/extra-nodes.log`, `/var/log/cloudflared.log`.
- Status: `/opt/h3/run/status.json` (boot phase), `/opt/h3/run/downloads.json` (each model group: state, %, error).
- ComfyUI: `curl -s 127.0.0.1:18188/queue`, `curl -s '127.0.0.1:18188/history?max_items=5'` (each entry holds the **full graph**
  that was run and its error — resubmit it with `POST /prompt {"prompt": <graph>}` to reproduce a failure),
  `curl -s 127.0.0.1:18188/object_info/<NodeClass>` (a node's inputs), `/system_stats` (VRAM).
- Studio state (JSON): `/opt/ComfyUI/user/default/studio/` — `jobs.json` (recent jobs, errors), `characters.json`, `settings.json`,
  `edit_chats.json` (Edit chat threads), `my_recipes.json`, `packs/` (prompt files). `GET /studio-api/state/<name>` reads them.
- Built-in prompt files for the writer steps: `/opt/h3/prompts/studio_*.txt`.

## The models (models.txt groups)

`image` Krea 2 Turbo (realistic) · `kedit` Krea 2 Identity Edit LoRA · `writer` local prompt writer (Qwen3.5 9B GGUF + vision) ·
`anime` Anima + NoobAI-XL · `sam` SAM 3.1 (find by words, face pass) · `qwen` Qwen-Image-Edit 2511 fp8 + Lightning (Edit chat's
"Qwen → Krea" route) · `qwen_full` its bf16 build (48 GB+ cards) · `video` MiniMax H3 · `trainer` Krea 2 RAW for LoRA training.
On a 24–32 GB card Krea 2 and Qwen don't fit together: ComfyUI swaps them, which is slow but expected.
A model "missing" error usually means its group is still downloading or set to "later" — check `downloads.json` first.

## Fixing things

- **Hot fix** (this rental only, gone when it ends): edit files under `/opt/h3` and restart what you changed.
  - Studio helper: `pkill -f studio_server.py; cd /opt/h3 && nohup python studio_server.py >> /var/log/studio.log 2>&1 &`
  - ComfyUI: kill the `python main.py` process — the watchdog starts it again within ~30 s with the same flags.
  - Never restart while the person's jobs are running (`/queue`), unless they say so.
- **Permanent fix**: if `/opt/h3/repo` exists (the template has a `GITHUB_TOKEN`), make the same change there, check it
  (`python -m py_compile …` for Python; there's no Node on the rental, so TypeScript is checked by GitHub's build), commit with a
  plain-English message and push to `main`. Studio code, prompts and models.txt go out as the `code-latest` release in ~2 minutes
  (rentals fetch it at start); changes to nodes/Dockerfile rebuild the image (~10–15 min). The **next** rental (or a restart) runs it.
  Tell the person which fixes were hot (this rental only) and which were pushed.
- Test a fix for real: rerun the graph from `/history`, or ask the person to press the button again and watch the logs.

## GPU test sessions

If the person says **"run the GPU tests"**, follow `/opt/h3/repo/docs/GPU_TESTS.md` (needs `GITHUB_TOKEN`). Results go to
the `rental-tests` branch, not `main`, and that session changes no code.

## Rules

- Never print or repeat secrets: environment variables with TOKEN, KEY, PASSWORD, SECRET in the name, `~/.git-credentials`,
  `~/.h3/hf_keys.txt` (Hugging Face keys from Proton Drive), rclone config. `h3-report` already hides them.
- Don't destroy, stop or reboot the rental (`vastai …`, `shutdown`) and don't delete outputs, models, characters or chats
  unless the person asks.
- The GPU is shared with their work: check `/queue` before running heavy tests, and keep tests small (low steps, one picture).
- You're here to debug and fix the tools. Their pictures and prompts may be adult content; you don't need to read or write them —
  work from logs, errors and graphs.
- Long waits (downloads, a video job): check back every minute or two instead of one long sleep, and say what you're waiting for.

## GitHub Actions
Two workflows: `code.yml` (every push, ~2 min) packs the Studio code into the `code-latest` release that rentals download at
start (`scripts/self_update.sh`); `build.yml` rebuilds the image only when image files change (Dockerfile, custom_nodes.txt,
install scripts, workflows/, settings/, scripts/claude/ except CLAUDE.md). Add `[full]` to the message when you change the
Dockerfile's early layers (base image, torch, llama.cpp, custom nodes) so the build frees enough disk. `[skip ci]` skips both.
Never commit keys, pictures or the person's site address: the repo is public.
