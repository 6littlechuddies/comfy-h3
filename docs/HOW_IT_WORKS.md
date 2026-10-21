# How the H3 Studio works

A plain-words map of the whole setup: what happens when you rent a machine, where the models come from, what each tab
uses, and where to look when something's off. (Details for Claude sessions are in the code comments and
`scripts/claude/CLAUDE.md`; the download story in full is in `docs/HF_DOWNLOADS.md`.)

---

## 1. The pieces

| Piece | What it is | Where it lives |
|---|---|---|
| **The image** | Everything except the models: ComfyUI, the custom nodes, llama.cpp, the trainer, the Studio | Built by GitHub Actions when nodes/system parts change (~10–15 min); the Studio code itself comes from the `code-latest` release, fetched by each rental at start → `ghcr.io/6littlechuddies/comfy-h3:latest` |
| **The rental** | A Vast.ai GPU machine that runs the image | Rented from your Vast template |
| **The models** | ~180 GB of model files | Downloaded fresh on every rental (mostly Hugging Face, some CivitAI) |
| **Your work** | Characters, chats, presets, settings, results | Studio export `.zip` + results, copied to Proton Drive and brought back on the next rental |

A rental starts with an empty disk, so the models download every time; your work comes back from Proton Drive.

---

## 2. What happens when you rent

1. **Vast pulls the image** and runs `bash /opt/h3/start.sh` (the template's on-start script; launch mode **Interactive
   shell server, SSH** — not "Docker ENTRYPOINT").
2. **Checks:** the GPU driver's CUDA version must be at least the image's (13.x). Too old → the start page says so
   (pick hosts with `cuda_max_good>=13`).
3. **The front door** (Caddy on port 8188, password from `COMFY_PASSWORD`) and a **secure https link** (Cloudflare
   tunnel) come up. The start page shows progress.
4. **Your settings come back:** the Proton Drive login (`PROTON_USER` / `PROTON_PASSWORD`) brings back your newest
   export `.zip` and `hf_tokens.txt` (your Hugging Face keys).
5. **Models download** (next section). The Studio opens as soon as the first group — *Realistic pictures (Krea 2)* —
   is in; everything else keeps downloading and each tab unlocks when its models arrive.
6. **ComfyUI starts** and the Studio opens.
7. **Idle watchdog:** after `IDLE_MINUTES` (45) with no jobs, no open tab and no Claude activity, the rental shuts
   itself down (destroy if everything's backed up, otherwise stop).

---

## 3. Downloads

**The list** is `models.txt`, in groups (`# @group id Label`). They download in this order, 8 files at a time:

1. Realistic pictures (Krea 2) — *opens the Studio*
2. Uncensored text encoder · Edit (v1.2) · Edit V2 · Prompt writer (9B) · Select by words (SAM 3) · Edit chat helper (Qwen)
3. Anime · Anime sheets · Smoother videos (frame interpolation)
4. Video (H3) · Big prompt writer (27B) · full-precision Qwen (48 GB+ cards only)
5. **Waiting until you ask** (status menu → Now, or the tab that needs it): Eros Max video model, Character LoRA
   training, AutoPrompter extras

On a card under ~30 GB (4090, 5080, 5070 Ti…) the Studio runs in **pictures-only mode**: video and the 27B writer go
to the end of the line.

**Hugging Face keys** (in `hf_tokens.txt` on Proton Drive, plain text, one per line — or `HF_TOKENS` in the template,
comma-separated):
- Hugging Face slows each key down after a few GB. The downloader watches the speed and **switches to a rested key**
  when the current one drops under half of its own best speed for ~30 s, and keeps cycling (slowed keys recover).
- Each file is asked for **once** with the key, then downloaded straight from Hugging Face's file servers (signed links,
  refreshed every 30 min and after a key switch). Calm settings: 8 connections per file, no reconnect storms.
- Keep **10–20 keys**. Don't bulk-create hundreds — that, plus hammering, got a network flagged ("suspicious
  activity", 30-minute block).

**Speed you get = the slower of the machine's line and Hugging Face.** A 1 Gbps machine tops out ~115 MB/s; 300–500
MB/s needs a 2.5–10 Gbps line and fresh keys.

**If a group fails:** status menu → Retry. The reason is shown (CivitAI key missing, gated file, 404…).

---

## 4. Renting the right machine

Template → **Extra Filters**:

```
cuda_max_good>=13 inet_down>=2000 verified=true cpu_ram>=48 geolocation notin [CN]
```

- `inet_down>=2000`: fast downloads (500 still works, just slower).
- `geolocation notin [CN]`: machines in China reach Hugging Face/CivitAI at a crawl.
- `cpu_ram>=48`: room for video decoding and upscaling.
- **GPU:** 16 GB (5070 Ti, 5080) = pictures; 24 GB (4090) = pictures, limited video; **32 GB+** (5090, A6000 /
  6000 Ada, Pro 6000) = everything.
- Disk: **250 GB**.

---

## 5. The Studio, tab by tab

| Tab | What it does | Main models |
|---|---|---|
| **01 Characters** | Your characters: pictures, sheet views (front, back, three-quarter…), identity card, LoRAs, training set, LoRA training | Krea 2 Edit, writer, (trainer) |
| **02 Prompt / Scenes** | Plan a video shot by shot; the writer turns ideas into H3 prompts | Writer (27B when downloaded) |
| **03 Create** | New pictures from words, or from a character + a reference photo | Krea 2 (~2 MP), uncensored encoder, Krea2T Enhancer, Krea 2 Edit V2 |
| **04 Edit** | Edit chat (talk to the picture), brush fixes, swaps | Krea 2 Edit V2, SAM 3, RMBG, Qwen-Image-Edit (optional) |
| **05 Animate** | Videos from references or a first frame | MiniMax H3 (or Eros Max), RIFE smoothing, NVIDIA RTX upscale |
| **07 Batch** | Many at once: photo sets for a character (themes × poses → rows, filed into site sets), swap a character into found pictures (CivitAI, Pinterest), recipes, videos | Same as Create/Edit/Animate |
| **Finish** | Join clips, transitions, sound, export | — |

**Scenes & poses (inspiration):** right-click a CivitAI picture → **Save as scene inspiration** (its setting, light, camera
and finish are borrowed — never its person) or **Save its pose to my poses**; in How it was made → pieces, **Add to my
poses** / **Save as scene**. Batch → Content plan → Backgrounds: *Saved scenes*, Poses: a collection, *Poses per
background* to keep the count sane; **Manage scenes & pose collections** to type poses, rename, remove. Each row gets its
own expression and head angle (same-face fix), and its Krea 2 prompt is written before queueing (Grok tab: 10 per
message).

**Angles and character LoRAs:** a character's Back / Left / Right / 3/4 views are made by Qwen-Image-Edit 2511 with the
Multiple Angles LoRA (it turns the camera around the person; Krea 2 Edit copies the front picture's angle). The training
set copies each shot from the sheet view closest to its angle, includes from-behind shots, and doesn't use the old LoRA.
After training, **Test their LoRA** makes 6 pictures from words + the LoRA only (laughing, 3/4, profile, over the
shoulder, back of the hair, low angle) and scores each face — 7+ on nearly all = good. The trained LoRA is put on their
identity card and used wherever they appear; their trigger word is added for you.

**Same-face fix, in short:** the character's personality no longer goes in as a fixed "… expression"; the writer picks a
specific expression and head angle for every picture; the face pass keeps the picture's own expression (reference
strength 2.5, was 4). A character LoRA trained on a varied set (01 Characters → training set) helps most.

**Batch → Plan it for me (one click):** pick characters, sets each, pictures per set, how bold (all free / half premium
/ mostly premium), places that fit them or a plain backdrop, optional pose ideas → the writer (or your Grok tab) plans
sets that fit who each character is (from their look + site profile), a different pose and angle per picture, then every
prompt is written and only those rows are queued. Character pictures in Batch (and Create with a character + words) are
new pictures on a blank canvas from their sheet view closest to the shot's angle.

**Saved scenes, exact pose:** Content plan → Backgrounds: a saved-scenes collection → "Exact pose — put them in it": each
saved CivitAI picture itself becomes a row and the character replaces the person in it (Swap in). Every Batch swap (this, and
Batch pictures to copy) hands the edit their sheet picture at the same angle as the picture (from its prompt,
or the local writer looks at it), not always the front one.

**Dragging a character** from the left rail shows their face in an accent ring and "Character · N sheet pictures"; the
drop frame says what they become (Create's character / @name in the Edit chat).

**Pictures at scale:** Create → Size **Draft (~1 MP, about twice as fast)** — it carries over to Batch — make many, keep the
good ones, then select them → **Upscale ×2** (or right-click → Upscale ×2 with detail / quick).

**The prompt writer.** Your plain words go through a local writer model that rewrites them into a full prompt in the
community style (kind of photo first, pose, outfit, setting, light, real-photo finish; 120–260 words). The 27B writer is
used once it's downloaded; **Prompt writer: 9B · fast** switches back (Create / Batch). Its rules are editable:
Scenes → prompt files.

**Prompt writer: Grok tab** (copy & paste, no keys): a panel bottom-right copies each request (the prompt file's rules +
your words) — paste it into Grok in your own browser tab, press Grok's copy button under the reply and come back to the
Studio tab: the reply is read from the clipboard and used by itself (on the secure link; the browser asks once to allow
it). Elsewhere, paste it into the panel → **Use this answer**. Batch → Pictures → **Write prompts** sends every idea row as one message ("### REQUEST 1…"), and the one reply
is split back into the rows by its "### ANSWER n" headings. Covers Create, Batch picture prompts and "Change this part";
steps that look at a picture, the Assistant and video plans stay on the local writer.

**Grok sees pictures too** (Prompt writer → Grok tab → "Grok also looks at pictures", on by default): steps that look at a
picture (reading a pose or angle before a swap, face checks, Read picture, Sort into sets for pictures without a prompt,
Edit chat's planner) go to the connected Grok tab with the pictures attached — the helper (v1.1) fetches them from the
rental through the token-checked relay and puts them in Grok's upload box. Not connected, switched off, or Grok refuses →
the local 9B writer does it, quietly.

**Hands-off Grok (the H3 Grok helper):** install the Tampermonkey extension (Chrome: its Details → allow user scripts),
then the panel's **Install the helper (once)**, then **Connect Grok tab** (each rental — the rental's address changes).
That opens grok.com wired to this rental: the helper (`scripts/h3-grok.user.js`, runs in your own browser, your Grok
login never touches the rental) picks up each request, opens a fresh chat, types it in, waits for the reply and sends it
back through `/grok-relay/` (token-checked, no front-door password). A badge bottom-left on grok.com shows what it's
doing. Keep the Grok tab in its own window (browsers slow down hidden tabs). It finds Grok's chat box and reply by shape,
not exact page code — if Grok changes its site and the badge shows an error, copy & paste still works. Automating
grok.com is against xAI's terms; the owner chose to accept that risk to their account.

**Likeness.** A character's own LoRA comes along automatically wherever they appear. Identity Edit V2 copies the face
from their picture (shown on a plain background so their old room doesn't bleed in). Edit chat sends the sheet view your
words ask for (three-quarter, back, side). The face pass and face check score every result against their best face
picture.

**Switches worth knowing:** Create → Text encoder (Uncensored/Stock), Follow the prompt harder (Krea2T Enhancer),
Prompt writer. Edit → Edit model (V2/v1.2). Animate → Video model (Official H3/Eros Max), Smoother motion, Upscale to
1080p.

**CivitAI** (⋯ menu → CivitAI): browse collections, filter "With a workflow", download workflows as a .zip, pick
pictures into Batch, or select pieces of a prompt (lighting, pose, setting…) → Add to Create / Add to Edit chat.

---

**Your site, hands-off (⋯ → Your site):** tick characters → **Sort, fill & send**: for each one it (1) reads the prompt
inside every picture of them (their folders + everything made as them; pictures without one are looked at by the local
writer) and sorts them into themed sets — sfw → a free set, suggestive / explicit → that theme's premium set, 30 pictures
per writer call, set titles reused across calls; (2) fills the blank profile fields (bio, first message, backstory,
traits, persona, tags) from their look + their pictures' prompts + set titles, keeping what you wrote; (3) sends it as a
draft. One character's page has the same as separate buttons (Fill the blanks / Rewrite all / Sort into sets). Runs on
whichever prompt writer you picked — the Grok tab included. Prompt files: "Site profile writer", "Sort pictures into
site sets".

## 6. Your work and backups

- **Proton Drive** (`PROTON_USER` / `PROTON_PASSWORD`): after a rental, the Studio copies new **results** to
  `H3 Studio/results` and an **export** (characters, chats, presets, settings) to `H3 Studio/exports` (newest 3 kept;
  older ones go to Proton's trash, which still counts against storage — empty it now and then). A new rental restores
  the newest export.
- **Google Drive instead of Proton** (optional): `GDRIVE_TOKEN` in the template (from the PC folder's "3 - Connect Google
  Drive (optional).bat", which runs `rclone authorize drive`; raw JSON or base64). Same folders ("H3 Studio/exports",
  "/results"); Google Drive wins when both are set.
- **Which backup is "newest":** each export is named by your last real change (`h3-…-YYYY-MM-DD-HHMMSS.zip`, UTC — characters,
  settings, presets…; re-saving unchanged settings doesn't count), not by when a machine uploaded. A machine uploads only
  when it has a change since its last upload or restore, and a machine that already has work pulls the cloud copy at start
  only when that copy holds a newer change. Older day-only names count by their file time.
- **Backblaze B2** (`RCLONE_*`): optional second backup; off while `RCLONE_REMOTE` still says `YOUR-BUCKET-NAME`.
- **Alerts:** ⋯ menu → **Alerts when done** — a chime, and a Windows pop-up on the **secure link** (⋯ → Secure link;
  browsers block pop-ups on plain `http://` addresses).

---

## 7. When something's wrong

1. **Status menu** (top right) → Full download screen: every file, its speed and source, the current key, Retry.
2. **Debug report** (Full download screen → Debug report, or ⋯ → Copy debug report): logs, downloads, GPU, errors — keys
   and passwords hidden. Send it to Claude.
3. **Claude on this rental** (⋯ menu): a Claude session on the machine itself that reads the logs and fixes things; it
   can push fixes to the repo.
4. **Check everything** (⋯ menu): runs a tiny job on every model to see what works.

Changes to the Studio itself go through this repo: push → GitHub packs the code (~2 min, the `code-latest` release) → the
**next** rental (or a stopped one when you start it again) downloads it at start. Changes to ComfyUI nodes or the Dockerfile
also rebuild the image (~10–15 min). A rental that's already running keeps the version it started with. `H3_UPDATE=0` in
the template turns the self-update off.
