# H3 Vast Kit: ComfyUI + MiniMax H3 on Vast.ai with no reinstalling

Every Vast GPU you rent starts from **your own ready-made image**. ComfyUI, SageAttention and all your custom nodes are already installed, and the H3 models download on their own. You never open a Jupyter terminal.

**What happens when an instance boots:**
1. The H3 models (about 47 GB) download in parallel, straight from Hugging Face.
2. The instance measures the host's real download speed: the best 15-second stretch of its first 2 minutes, so a slow start doesn't count. Under 25 MB/s (`MIN_MBPS`) the start page warns that it will be slow and how long the download takes, and keeps going. Only a host that is really unusable (under 10 MB/s, `KILL_MBPS`) **destroys itself** so you stop paying for it; set `AUTO_DESTROY_SLOW=0` to keep it anyway.
3. ComfyUI starts behind a password. Your workflows are already in the Workflows sidebar.
4. **Every output is saved automatically** to your own cloud storage (Backblaze B2) within about 30 seconds of being created. See "Automatic output backup" below.
5. After **45 minutes unused**, meaning no jobs running *and* no ComfyUI tab open in your browser, the instance shuts itself down so a forgotten instance can't keep billing you. It **never throws away unsaved outputs**: if everything is backed up it destroys itself; if not, it *stops* instead and keeps its disk until you come back for your files.

**Boot time:** about 5–10 minutes from clicking rent to a ready ComfyUI. Starting a new instance takes the same 5–10 minutes. The ~20-minute setup below happens only once.

---

## Where Docker fits (you don't install it)

The `Dockerfile` is the recipe for your image. **GitHub builds it on its own servers** every time you change the kit, then stores the result in GitHub's registry at `ghcr.io/<you>/comfy-h3`. Vast downloads that finished image. You don't install Docker, and you don't need a Docker Hub account.

## One-time setup

1. **Get the kit onto GitHub.** Create a **private** repo named `comfy-h3` at github.com/new, then upload this folder to it. (If you connect GitHub to Claude, Claude can push it for you.)
2. **Wait for the first build.** Open the repo's **Actions** tab. The first build takes about 45–90 minutes because it compiles llama.cpp for the GPU once. Later builds reuse that work and take about 10–20 minutes.
3. **Make the image downloadable.** Go to github.com → your profile → **Packages** → `comfy-h3` → **Package settings** → **Change visibility → Public**. This lets Vast download it without a login. The image contains no passwords or keys.

Your image is now `ghcr.io/<your-github-username-in-lowercase>/comfy-h3:latest`.

---

## Option A: Rent from the Vast website (nothing to install)

Create a template once. Go to **Templates → New**, or edit a copy of any template:

| Field | Value |
|---|---|
| Image path:tag | `ghcr.io/<you>/comfy-h3:latest` |
| Launch mode | **SSH**, with "Use direct SSH connection" ticked |
| Docker options | `-p 8188:8188 -e OPEN_BUTTON_PORT=8188 -e COMFY_PASSWORD=YourPasswordHere -e IDLE_MINUTES=45` |
| On-start script | `bash /opt/h3/start.sh` |
| Disk space | 250 GB (the models are ~125 GB; the rest is room for your LoRAs, own checkpoints and outputs) |

To work:
1. Pick the template and filter for **RTX 5090**, internet download **≥ 1000 Mbps**, RAM **≥ 64 GB**, and **Min CUDA Version 13.0** (the image needs a host whose card shows *Max CUDA* 13.0 or higher).
2. Click **Rent**.
3. Click **Open** on the instance and log in as `admin` with your password. While it starts you see a startup screen
   (download progress, speed, time left, each model file, and the steps); it opens the Studio by itself when everything's
   ready. Open always lands in the Studio — ComfyUI's node editor is still at the plain address (`/`).

When you're done, **Destroy** the instance, not Stop. If you forget, it destroys itself after 45 minutes unused.

Before destroying, download anything you want to keep from ComfyUI's output queue or history. You can also set up R2 backup (see "Notes").

## Option B: The launcher (one command, several GPUs at once, outputs copied to your PC)

1. Install Python 3 from python.org. On Windows, tick "Add to PATH".
2. Open a terminal and run:
   ```
   pip install vastai
   vastai set api-key YOUR_VAST_API_KEY
   ```
   You can create the key at https://cloud.vast.ai/manage-keys/.
3. In `launcher/`, copy `config.env.example` to `config.env`. Set `DOCKER_IMAGE` and `COMFY_PASSWORD`.

| Do this | Command | Windows |
|---|---|---|
| Rent a GPU and start working | `python h3.py up` | double-click `up.bat` |
| Rent 3 GPUs in parallel | `python h3.py up --count 3` | `up.bat --count 3` |
| See what's running and billing | `python h3.py status` | `status.bat` |
| Reconnect output copying after closing the window | `python h3.py watch` | `watch.bat` |
| Save outputs and destroy everything | `python h3.py down` | `down.bat` |

The launcher also replaces slow hosts automatically, copies every output to `launcher/outputs/` every 20 seconds, and destroys the instances when you press Ctrl+C.

---

### Smaller download: "Later" and "Download now"

Every model group except the first has **Next** (download it right after what's already running) and a **Later** button on the start page and in the Studio's status menu (the
models list). Later leaves that group out of this rental's download, and of your next rentals too (the choice is kept
with your settings), until you press **Download now** — on the start page, in the status menu, or on the notice in any
tab that needs it. Skipping H3 alone saves ~47 GB. **Krea 2 RAW** needs the *Realistic pictures* group, so it comes
along when you download RAW. A group that failed gets **Try again**. The file list at the bottom of the start page shows
every file with where it comes from (Hugging Face / CivitAI), its speed, and **stuck** when one stops moving.

Sizes: `anime` (Anima base 1.0 + NoobAI-XL, ~12 GB), `image` (Krea 2 Turbo + the Krea 2 text encoder, ~18 GB), `kedit`
(the Krea 2 Identity Edit LoRA: Edit, realistic character angles, Compose blend), `writer` (Fable 9B, ~10 GB: Prompt tab, reading clips and
pictures), `writer_xl` (Qwen3.8 27B, ~20 GB: Scenes — the 9B writes for Scenes until it's in), `video` (H3, ~47 GB),
`kraw` (Krea 2 RAW from its CivitAI upload, falling back to the official file + its turbo LoRA), `autoprompter`
(~10 GB, only for the old imported AutoPrompter workflow; *later* by default). `SKIP_MODELS` in the Vast template
still works and sets groups to *later* from the start. LoRAs from CivitAI aren't part of this: they're small and
download separately from your library.

**Everything downloads, in order.** Every group is queued (no more "later" by default); press **Later** on one you don't want. On a card under 30 GB, video and the 27B writer go to the end of the queue.

**The disk never fills up with models.** Before a group downloads, the downloader checks it fits and still leaves 15 GB
free (`DISK_RESERVE_GB`) for your results, imports and the writer's scratch files; one that doesn't fit waits, marked
**No room**. Pressing **Later** on a half-downloaded group deletes the part it downloaded. The full-precision Qwen only
downloads on a 48 GB+ card (**Big card** otherwise).

### Faster start: models download in groups

The models (~125 GB) download as one continuous queue, up to 8 files at a time (set `DL_JOBS` to change it), in the order of the `# @group` lines in
`models.txt`, so a slow file never holds up the rest: **Realistic pictures (Krea 2)** → **Your LoRA library** → **Edit (Krea 2)** → **Prompt writer** → **Anime pictures** → **Big prompt writer (27B)** → **Video (H3)** →
**Krea 2 RAW** → AutoPrompter extras. ComfyUI starts at the same time, and the
Studio opens as soon as the first group is in (a minute or two on a fast host). The rest keeps downloading in the
background: each tab shows "still downloading — 62%, about 4 min" and its button unlocks by itself when its models
arrive. The status button in the top bar lists every group. Files download as `name.downloading` and get their real name
when complete, so ComfyUI never sees half a model. Progress: `/h3-downloads`; log: `/var/log/downloader.log`.

**Your own LoRA files** (not on CivitAI): drop a `.safetensors` anywhere on the Studio page, or use *Upload your own* in a
LoRA list. It goes to `models/loras/uploaded/`, its base model and trigger word are read from the file, and it's copied to
your B2 backup (`_loras/`), so it's restored on every rental without uploading it again.

## Automatic output backup (Backblaze B2, one-time setup, ~10 minutes)

1. Create a free account at **backblaze.com** → *B2 Cloud Storage* (first 10 GB of storage free).
2. **Buckets → Create a Bucket**: pick a unique name (e.g. `yourname-h3-outputs`), set it to **Private**.
3. **Application Keys → Add a New Application Key**: allow access to that bucket only, *Read and Write*. Copy the **keyID** and **applicationKey** (the key is shown only once).
4. In your Vast template, add these **Environment Variables** (Key → Value):

| Key | Value |
|---|---|
| `RCLONE_CONFIG_B2_TYPE` | `b2` |
| `RCLONE_CONFIG_B2_ACCOUNT` | your keyID |
| `RCLONE_CONFIG_B2_KEY` | your applicationKey |
| `RCLONE_REMOTE` | `b2:yourname-h3-outputs/h3` |

Every output then lands in that bucket, in a folder named after the instance ID, and you can download it from the Backblaze website any time. The instance's `/h3-status` page shows whether all outputs are backed up.

**Browse outputs on a running instance:** open `http://<instance address>/outputs/` (same login) to see and download every file.

## H3 Studio: the simple page (no node graph)

Open `http://<instance-ip>:<port>/studio/` (same login as ComfyUI). Six tabs: **Characters**, **Scenes**, **Create** (with
**Batch** as a switch at the top), **Edit** (with **Compose**), **Animate** (with **Plan a video**, the prompt writer) and
**Finish**. What each part does:

| Tab | What it does | Runs |
|---|---|---|
| **Characters** | Save a character once (import profiles or JSON from your character creator, adults only), build a matching reference sheet (front/back/sides/face/cut-out/expressions), use them in any tab | Fable 9B (reads profiles) + Anima / Illustrious / Krea 2 + Krea 2 Edit |
| **Create** | Characters, backgrounds or full scenes — anime (**Anima** by default, or NoobAI-XL for Illustrious LoRAs) or realistic (Krea 2 Turbo or **Krea 2 RAW**, or your own fine-tune of either), LoRAs with sliders, optional cut-out (transparent background) | Anima / NoobAI-XL / Krea 2 + RMBG |
| **Compose** | Layers: background + characters, move / resize / rotate / crop / flip / shadow, any canvas size (1920×1080, custom…), flatten + optional "blend into scene" pass | browser + Krea 2 Edit (or Anima / Illustrious) |
| **Edit** | Change a picture with words; copy a pose, put a character into a scene, or **paint over one area** so only that changes; before/after slider | Krea 2 Identity Edit · Anima / Illustrious redraw |
| **Prompt** | Pick a saved character and add pictures, clips (with their sound) and audio. Describe the idea, or leave it empty to recreate a clip (**Read the clip** writes what happens in it for you). A local writer model plans a timeline you can drag and edit | Fable 9B with its vision file (watches clips and writes) |
| **Animate** | MiniMax H3: references / image→video / first→last / seamless loop, Turbo, 2 quick previews, H3 LoRAs | MiniMax H3 |
| **Finish** | Trim, join clips with transitions, boomerang / fade-to-start loops, upscale to 1080p/4K, MP4 / WebM / GIF | ffmpeg |

- **Your settings are remembered** (every tab reopens as you left it) and **presets** can be saved per tab. They live in
  `ComfyUI/user/default/studio/` and are backed up to your B2 bucket under `_studio/`, so a new rental comes back the same.
- **The tray** along the bottom holds everything you made or uploaded this rental — drag anything into any slot.
- **Ctrl+Enter** runs the visible tab's main button. Every setting has a **?** with a one-line explanation.
- The first cut-out of a rental downloads the background-removal model (~1 GB, once).
- **LoRAs are plug-and-play and kept**: in any LoRA list press *Add LoRA* and paste a CivitAI link. It downloads right away,
  shows which model family it's for (only matching ones are offered first) and its trigger words, and joins your LoRA library
  (`_studio/loras.json` in B2). Every new rental re-downloads your whole library automatically at boot. LoRAs grabbed with the
  LoRA Manager page (`/loras`) are added to the library too. Your `CIVITAI_TOKEN` stays in the Vast template — set it once.
- **Browse LoRAs** has **My collections** (your CivitAI collections: saved LoRAs show as cards right there, saved pictures
  and videos open with their prompts) and **♥ Liked**. **Video** lists LoRAs for every video model (Wan, Hunyuan, LTXV,
  H3): they're there for their example clips and prompts — only the ones marked H3 run in Animate.
- **Browse LoRAs** (the *Browse* button under any LoRA list, the ⋯ menu, or Ctrl K): scroll CivitAI inside the Studio, filtered to the
  model you're using and by category (characters, styles, clothing, poses…), sorted by popular / top rated / newest. Hover a card to
  flip through its examples; press *Add* and it downloads, joins your library and goes straight into what you're making. Click a card
  for every example picture or clip with **how it was made**: prompt, negative, sampler, scheduler, steps, CFG, seed, size, extra
  settings and **every resource used** (checkpoint, LoRAs with their weights and trigger words, each with *Add*). Then:
  **Send to Animate** (prompt, its H3 LoRAs, the aspect, H3 settings, and optionally the clip/picture as a reference),
  **Create** (adds the matching LoRAs, switches to *Exact prompt*, copies the settings and shape — press Generate),
  **Plan in Prompt** (the prompt becomes the idea for an H3 timeline) or **Copy all**.
- **From a CivitAI link**: paste a `civitai.com/images/…` link anywhere in the Studio (or in the LoRA search box, the
  *Copy a video from CivitAI* button in Animate, the ⋯ menu, Ctrl K) and get the same panel for that picture or video.
  Explicit previews show by default (untick *Explicit previews* to blur them). What CivitAI returns for mature content also depends
  on the settings of the account your `CIVITAI_TOKEN` belongs to. LoRAs and example prompts involving minors are filtered out.
- **LoRA switches and trigger words**: every LoRA in a list has an on/off switch, and its trigger words (from CivitAI, or read
  from the description when the creator left them blank) are added to the prompt for you — just write normal words. Click
  *AUTO* to stop that for one LoRA, or *edit* to change the words.
- **Try strengths** (the bars icon on a LoRA, in Create and Animate): the same picture or video at several strengths with the
  same seed, side by side in Results; press *Use strength 0.6* on the one you like. Videos can use quick drafts (lower
  resolution, turbo for References) so a sweep takes minutes, not an hour.
- **Characters → Make a video**: presets (dance like a clip, talk to camera, walk, turnaround, pose showcase, living portrait loop)
  that put the reference sheet in as references and name the character + restate their look in every cut, so they stay the same
  person. *Make it now* or *Set up in Animate* to check first. The prompt writer also restates identity per cut now.
- **Batch** (tab 08): one row per clip/picture to imitate (drop many files at once) plus an optional idea and a star character.
  *Write prompts* has the writer turn each row into an H3 timeline (edit them if you like), then *Queue all* puts everything on the
  instance's queue — it keeps running with the page closed.
- **Phone alerts** (Batch tab, left): install the free **ntfy** app, subscribe to a hard-to-guess name, enter the same name here.
  The instance pings your phone when a batch finishes (optionally after every Animate video). Set `NTFY_TOPIC` in the template to
  use a default name.
- **Exact prompt** (Create, *Prompt* chip): send the prompt box exactly as typed instead of building it from the character settings.
- **Recipes** (top bar) set up common jobs in one click and show the steps: dance like a clip, talking close-up, cover-art loop, 3-shot film…
- **Looks**: the style picker in Create shows example pictures, made once on your GPU and kept for every rental.
- **Characters and style examples are kept with your settings** (backed up to B2 under `_studio/`), so they're on every new rental.
- **Secure link**: each rental also opens a free Cloudflare https link (in the ⋯ menu, same login) — browsers only allow
  the microphone (Talk, Record voice) over https. Turn it off with `STUDIO_HTTPS=0`. Uploads over that link are limited to ~100 MB each.

Developing the page: `cd studio && npm install && COMFY=http://admin:PASSWORD@IP:PORT npm run dev` (live preview against a
running rental). `npm run test:graphs` checks every graph against a ComfyUI (see `studio/scripts/test-graphs.ts`).

### Pictures you saved on CivitAI: copy the style, swap your character in, read any workflow

**How was this made?** (⋯ menu, Ctrl K, the tray's right-click menu, or paste a link anywhere) has three tabs:

- **My collections**: every collection on your CivitAI account (needs `CIVITAI_TOKEN`; collections are private, so the key must be
  allowed to read them). Pick one and scroll its pictures and clips. **Only ones with a prompt** (on by default) hides posts without
  generation data; untick it to see everything, including well-made ones without prompts. Any collection link works too, even
  someone else's.
- **Paste a link**: a `civitai.com/images/…` link.
- **From a file**: drop a PNG, JPEG, WebP or MP4 from anywhere. The **workflow observer** reads what's hidden inside it:
  A1111/Forge parameters, ComfyUI prompts and full workflows (PNG text chunks, EXIF, video tags). It shows the models, LoRAs and
  settings it found, every node if you want, and **Open in ComfyUI** saves the workflow to your ComfyUI workflows and opens it.
  CivitAI pictures made in ComfyUI get the same workflow panel.

On any picture, beside the prompt, settings and resources:

- **Copy style → Create** takes only the look: lighting, camera, art style and quality words, plus the sampler settings and LoRAs.
  Your own subject stays. **Whole prompt → Create** takes everything. Both pick the matching model (Anima, Illustrious/NoobAI,
  Krea 2 or Krea 2 RAW) and add the LoRAs to your library.
- **With your character**: pick a saved character, then one of three:
  - **Swap into it**: the person in the picture *becomes* your character, and the pose, framing, light and place stay. It runs
    as an Edit chat message: Qwen-Image-Edit swaps the person, Krea 2 repaints with their LoRA, then the face pass and the
    face check. Until the Edit chat helper has downloaded, SAM 3 outlines the person and only that outline is redrawn, so a
    second person can't appear next to the first.
  - **Remake with words**: its CivitAI prompt and your character's look are merged by the writer (only the description of
    the person is swapped; pose, place, camera and light stay word for word), then Krea 2 makes new pictures from that text
    with their LoRA. The merged prompt stays in Create's box (exact prompt) to change and run again.
  - **Only the pose**: the pose is read off the picture limb by limb, and your character is made in it from text.

  Create's own two pictures work the same way: **Insert my character** (realistic) now redraws only the outline of the
  person in picture 2, so your character replaces them instead of joining them, and the new **Remake with words** take
  merges picture 2's prompt (CivitAI's, the file's, or read off it) with your character and makes it from text.

  **Dozens at once — Batch → Pictures → "Put your character into pictures you found" → Swap in.** Drop a whole set of
  pictures (files, a downloaded set, straight from a Pinterest tab), or in the CivitAI browser press **Pick several →
  Batch**, tick your character and press Queue. Each picture goes through the same steps as Swap into it — the writer
  reads the picture (no prompt or metadata needed), Qwen swaps, Krea 2 repaints with their LoRA, face pass and face check —
  one after another, each in a hidden chat so your own chats stay put. Results land in Edit's results, the catalog and
  (optional) a site set. The steps run from the page, so keep it open until it's done; Stop finishes the current picture.
  Write "the woman on the left" in a row when a picture has several people. Face only / Whole person are the faster
  Krea-only versions that queue on the rental at once.

  **Community Krea 2 settings.** Pictures are made at ~2 MP (1088×1920 portrait), like the shared Krea 2 workflows and
  CivitAI's generator; steps 8 / CFG 1 / euler-simple stay (their recommended settings). Krea 2 uses the **uncensored
  text encoder** (abliterated Qwen3-VL-4B, civitai.com/models/2731465 — models.txt group "krea_te", 4.5 GB, needs
  CIVITAI_TOKEN) once it has downloaded, so explicit prompts are read as written; Create → *Text encoder* switches back.

  **Only pictures with a workflow.** In your CivitAI collections choose **With a workflow** (next to All / With a prompt):
  only pictures made in ComfyUI are shown, marked WORKFLOW — open one and *How it was made* shows its whole workflow.
  **Pick several → Copy links** copies the ticked pictures' links.

  **Create: Make … from — Words only or Their picture.** With a character picked, Create either makes the picture from
  your words (text to image, their LoRA keeps the face) or works from their front picture. Automatic picks words once
  they have a LoRA.

  Edit has the same pickers: under Picture 1, Picture 2 and the new **place** box there's **Your pictures** and
  **CivitAI**, and Edit chat has a **CivitAI** button next to Add picture. With a place picture, Make edit sends all
  of them to Edit chat (Qwen-Image-Edit takes three pictures, then Krea 2 repaints with the character's LoRA and the face
  pass), like Create's third box.

  Choose their own outfit or the picture's, and say which person if there are several. For a clip, it sets up the Prompt tab
  with the clip and your character's sheet as references.
- **Send to Animate**, **Plan in Prompt** and **Copy all** work as before.

**Dense prompts in pieces.** Long comma prompts are split into labelled groups: who, looks, outfit, pose, expression, setting,
lighting, camera, style, quality, LoRAs. Click a piece (shift-click for more), double-click to edit it, right-click for
**Change this…**, **Stronger** / **Weaker** (adds `(word:1.1)` weights), Copy or Remove. **Change this…** takes plain words
("make it a black leather jacket", "softer evening light") and the local writer rewrites only that part in the same style. The
pieces view is in the picture panel and under the prompt box in Create (*Break it into pieces*). In every prompt box you can also
highlight any text and right-click it for the same **Change this part**.

**Models for this**: Anima base 1.0 is the default for anime; Anima LoRAs are filtered under *Anime · Anima* in Browse LoRAs.
NoobAI-XL is built on Illustrious, so Illustrious LoRAs work with it (*Anime · Illustrious/NoobAI*). For realistic, **Krea 2 RAW**
(the CivitAI upload) is the undistilled base (28 steps, CFG 4.5, slower, more varied); its *Turbo LoRA* slider (Create, left) speeds it up. Krea 2
Turbo stays the quick option. **♥ Liked** in Browse LoRAs shows the LoRAs you liked on CivitAI, and the examples of any LoRA
can be filtered to *With a prompt* or *With a workflow*.

### Scenes: consistent characters, multi-shot videos, your own prompt files

Tab **02 Scenes** runs the "LM Studio" workflow inside the Studio, with every step on this rental's GPU:

1. **Cast**: pick saved characters. Each has a **look block**, a fixed description pasted word for word into every
   starting frame (write it yourself, or *Write it for me*). Only pose, setting, outfit details and action change per shot.
2. **Starting frame**: *Make with Krea 2* runs the **Krea 2 frame builder** prompt (look block + frame notes), then makes
   2 frames with Krea 2 at the scene's shape. You can also drop any picture, or use *Last frame of prev.* to continue
   from the previous shot's video.
3. **What happens**: a short, precise description. You can start it like you would in LM Studio
   (`12 second i2v. The girl…`), and the length and type are read from it.
4. **Blueprint**: the **Scene context** prompt expands it into timing, actions, camera, dialogue and sound. It sees the
   starting frame.
5. **H3 prompt**: the **H3 compiler** prompt turns the blueprint into the final MiniMax H3 prompt (built-in: the official
   `integrated_multimodal_description / overall_soundscape / non_diegetic_music` format).
6. **Video**: FL2VA from the starting frame (or the Ref model with the cast's pictures). Defaults: 40 steps,
   res_multistep, simple; high resolution up to 8 s, lower for longer shots.

Every step's text can be edited before the next one. Use *Redo* for one step, *Redo + rest* for that step and
everything after it, or *Run all* for whatever is missing. *Join in Finish* puts the shots together.

**Your prompt files**: drop `.json`, `.txt` or `.md` files on *Prompt files* in Scenes, or anywhere in the Studio.
LM Studio presets (new and old format) are read along with their temperature, top-p, top-k, repeat penalty and max
tokens. Plain text becomes the system prompt as it is, and a JSON file without a system prompt is used whole (for
example an output schema). Each file goes to the step its name or content points to (`context` / `blueprint`, `compiler` /
`h3`, `krea`, `look`), and the step switches to it straight away. Change that or edit the prompt with *Edit*. Your files
are kept with your settings, so they come back on every rental, and they're also in the ComfyUI node editor's LLM Text
Processor list (`studio_pack_*.txt`). *What it's sent* sets the message each step gets, with fill-ins like
`{seconds} second {mode}. {description}`.

**Writer model**: **Qwen3.8 27B Uncensored** (Q5_K_M with vision, ~20 GB). It downloads right after the prompt
writer and before H3, so you can write shots while the video model arrives. *Fable 9B* is there if you can't wait,
but it follows long prompt files less closely.

**Thinking and pictures, like LM Studio**: your own prompt files use the model's default thinking (Qwen3.8 thinks
before answering, as in LM Studio) and get text only. Change either in *Edit*: thinking on/off, and *Let it see the
starting frame*. *What it was thinking* under a step shows its reasoning.

**Fixing a result**: highlight the part of a blueprint or H3 prompt that's wrong, write what to change in plain words,
and *Add note*. Add as many notes as you like, then *Apply fixes*. The same prompt file rewrites the whole text with
your changes, the way a follow-up message works in LM Studio. *Apply + rewrite H3 + video* carries the fix through to
the end. *Undo* goes back a version. If the blueprint changes after the H3 prompt was written, the H3 prompt is
flagged as out of date.

### Characters from a picture, and the full sheet in one go

- **New character from a picture** (Characters, right side): drop a picture of your character (art you made, a render, a
  design you have the rights to — not a photo of a real person who hasn't agreed). Fable's vision reads the look (hair,
  eyes, outfit, details, anime or realistic) and the picture itself becomes their front view. Pictures that may show
  someone under 18 are refused; if the age can't be told you're asked for it (18+).
- **Make full sheet** (sheet maker): the left side, back and 3/4 views, the face close-up and the cut-out in one click —
  edited from the front picture by Krea 2 Edit (realistic) or drawn by Anima / Illustrious (anime). Single angles can
  still be redone one by one.
- **CivitAI key in the Studio**: ⋯ menu → CivitAI key. Saved with your settings (and their backup), so the template
  doesn't need `CIVITAI_TOKEN`; the template's value wins if both are set.

### Edit: Krea 2, or Anima / Illustrious for anime

The **Model** chip in Edit picks who edits. **Krea 2** (default) uses the community *Identity Edit* LoRA
(huggingface.co/conradlocke/krea2-identity-edit, nodes github.com/lbouaraba/comfyui-krea2edit): say what to change in plain
words; with a Picture 2 it puts that person into Picture 1 (keeping their face, hair and outfit). *Hold on to the reference*
sets how strongly it keeps the look (4 = the creator's default). Two faces in one picture can blend a little. **Anima** and
**Illustrious** redraw Picture 1 from a description (tags work) — *How much changes* sets the strength, and a painted area
redraws only that part. (Qwen Image was removed — realistic is Krea 2 everywhere.) Character
angles: the sheet maker has **Style** (Anime / Realistic) and **Made with**. Anime characters are drawn by **Anima** or
**Illustrious** — each angle from their look tags and LoRAs, one seed for the whole sheet so they match; realistic ones are
edited from the front picture by **Krea 2 Edit**, one view at a time. "With your character"
for an anime character redraws the picture with Anima / Illustrious too (its pose, setting and light, your character's look).
"With your character" on CivitAI pictures, Compose's blend and Batch use the same model choice.

**Right-click any picture** — CivitAI examples and collections, *How was this made?*, any filled picture slot — for: Use in
Edit as Picture 1 or 2, Add to Compose, Use in Animate, Copy its look → Create, Edit with the model it was made with, Copy,
Save, Open on CivitAI. **Compose** layers have **Remove background**. Every main prompt box has a **.txt** button (or drag a
text file onto it) to load a prompt from a file.

### Starting frames for characters, and your own Krea 2 / Anima fine-tunes

Characters → *Open sheet maker* → **Build a starting frame**: pick the model, a **Checkpoint** (the official one or your
own fine-tune), LoRAs, shape (up to 1440×2560) and a full prompt. *Write the prompt for me* has the local writer (your
Krea 2 frame-builder prompt file) write it from their profile, from a picture you drop in (its pose, outfit, setting
and framing, with this character in it), or *Use this post* copies a CivitAI picture's prompt, model and LoRAs. **Make ×4**
makes a batch; hover the one you like → **Use as front** or **+ make sheet**. Everything is remembered per character.

**Your own checkpoints**: the *Checkpoint* picker (Create and Characters) → *+ Add from CivitAI* takes a link to a Krea 2,
Anima or Illustrious checkpoint (.safetensors). It goes to `models/diffusion_models/civitai/` (`checkpoints/` for
Illustrious), joins your models library (`_studio/models.json` in B2) and downloads again on every rental with your
LoRAs. Pasting a checkpoint link into a LoRA list's *Add* box puts it there too.

**Scenes** shots have **Reference pictures** (up to 3, each with a label like "the gym"): the writer sees them when it
writes the frame prompt, blueprint and H3 prompt, and reference-mode videos get them as extra `<Picture n>` after the
characters' pictures.

### Characters are projects

The list on the left of every tab is your cast. Each character folds open into their **profile & sheet**, **make
pictures**, **edit pictures**, their **scenes** (each one listed, + for a new one), **animate**, **batch** and **export
this project**. Whoever is picked is who every tab works on; **Free work** means no character. The narrow-list button
shrinks it to faces only.

Right-click a character: rename, new scene, **new scene from a preset**, export this project (.zip), duplicate, delete.
Right-click a scene: rename, duplicate, **save as preset** (its shots, lengths, types and notes), start a new scene from a
preset, delete. **Export all** (bottom of the list) saves everything — characters, pictures, scenes, presets, your prompt
files and your preferences — as one .zip; drop it on any rental to get it all back.

### Create with your character + a reference

Create has **Pictures to work from**: Picture 1 is your character (their front picture, filled in by itself) and Picture
2 is a reference — a pose, a place, a CivitAI post (right-click any picture → **Use in Create · reference**, or **Copy its
look** with a character picked). Choose what to take from it: **its whole look** (your character takes the person's
place), **just the pose**, or **its scene**. Realistic characters go through Krea 2 Edit; anime characters are redrawn by
Anima / Illustrious with their tags and LoRAs. Both pictures (and a result you pressed Remix on) show small inside the
prompt box. For anime, just write in plain words: the local writer turns them into tags when you press Generate (▸ under
the box shows the tags it sent, and can put them in the box).

### The long Krea 2 description

Characters → **Write it in full**: the local writer turns the profile and their front picture into a 180–260 word
description (face, hair, body, outfit piece by piece, style). It's used word-for-word in every frame, sheet, edit and
scene, and it's yours to edit. Swap in your own prompt file for it under Scenes → prompt files (**Character description**).

### Words as typed (the writer is optional)

Create's **Words as typed / Writer rewrites** chip: with Krea 2 it starts on **Words as typed** — your words go to Krea
exactly as you wrote them, with no writer step (faster, nothing reworded), also with a character and pictures. Krea 2
reads plain sentences well. Your character, their picture, LoRAs and trigger words still apply; the Studio only adds its
fixed lines (e.g. "keep this woman's face…", the settings on the left), and the line under the box shows exactly what
goes in. **Polish it once — see it first** runs the writer on demand. Anima / Illustrious start on **Writer makes tags**
(they follow tags much better than sentences); switch them the same way. **Exact prompt** sends only your words.

### Character sheets: one picture with every view

**Make character sheet** makes ONE picture: six views of the character (full-body front, front neutral, 3/4 or profile,
back, face close-up, side-profile close-up) on a clean white background, plus the cut-out. Krea 2 Edit draws it on a blank
white landscape canvas with their front picture as the subject, so face, outfit and art style match it (anime too). In
Create, the **SHEET** chip sends that one picture as their look instead of separate angles. The single angles (back, sides,
3/4, expressions) are still under **Make or redo single angles**; for those, Illustrious can look at the front picture
while drawing (IP-Adapter Plus, the **Anime sheets that copy the picture** download, ~3.4 GB).

### Face-detail pass (SAM 3)

SAM 3.1 (the **Select by words** download, 1.6 GB; the nodes are built into ComfyUI) finds the face by the word "face".
Krea 2 Edit redraws just that square at full size (eyes, lashes, lips, skin) and it's pasted back with soft edges. With a
character, their own picture is shown to the model so the face stays theirs. Use it from **Create → Sharpen the face
after** (with "How much the face is redrawn") or right-click any picture → **Sharpen the face** / **Sharpen the face · as
<character>**. Check Meta's SAM licence before you sell work made with it.

### Training set for a character LoRA

Characters → their page → **Training set**: from one picture, Krea 2 Edit makes 12/24/36 new pictures of them (40%
close-up, 30% half-body, 30% full-body, with varied angles, expressions, outfits, places and light). The local writer scores
each face 0–10 against their face close-up or front picture (the **Face match check** prompt file). Ones at or above your
threshold are kept, and you can tick or untick any, fix a caption, or drop in your own pictures. **Download the set**
gives `dataset/001.png + 001.txt …` with captions that begin with the trigger word, plus a README with the published
starting settings for a Krea 2 LoRA (AI-Toolkit or musubi-tuner, trained on Krea 2 Raw, used on Turbo). **Train their LoRA here** (realistic characters) trains a Krea 2 LoRA on the rental with musubi-tuner: Krea 2 RAW, rank 32, fp8,
1000/1500/2500 steps (~2 s a step on a 5090). It needs the **Character LoRA training** download (~33 GB, "later" until you ask;
Krea 2 RAW comes from Comfy-Org's copy, which needs no licence click). The finished LoRA lands in your library
(backed up when RCLONE_REMOTE is set) and on the character's identity card at strength 1.0 with their trigger word.

### Assistant and voice

The **Assistant** button (bottom right) is a chat with the local writer. It sees the tab you're on, your character, the
prompt boxes and settings and your last jobs; ask it things or tell it what to change ("make her jacket red leather and
make four") and it changes the settings and can press Generate. Each character keeps its own conversation. The **mic**
(in the Assistant and in every prompt box) turns speech into text on the rental with Whisper — the first use downloads it
(~1.6 GB); it needs the secure link (⋯ menu). Its behaviour comes from the **Studio assistant** prompt file, which you can
replace like any other.

### Check everything, and More like this

**Check everything** (status menu, or Ctrl K) runs a tiny job through every model that's downloaded — Anima, Illustrious,
Krea 2, Krea 2 Edit (one and two pictures), the anime redraw, Krea 2 RAW, background removal, each of your own
checkpoints, both prompt writers, and optionally a 1-second H3 clip — and lists pass / fail with the exact error.
*Copy report* puts it on the clipboard to send to Claude. Run it once on each new rental before real work.

**More like this ×4** (right-click any picture, including your results in Create and Edit): four variations that keep
the face, outfit and setting and change the pose, expression and angle a little — Krea 2 Edit for realistic pictures,
a light Anima / Illustrious redraw from the picture's own prompt for anime. They appear in Edit.

### Catalog: every picture, for good

**Catalog · every picture** (left sidebar, Ctrl K → "Catalog", or "Catalog · all of them" above any results) lists every
picture and video on the rental's disk, by project folder, newest first, searchable by the words each was made from.
Click to view; right-click for the usual menu (use in Create/Edit, add to a site set, put a face on it…). The results
feeds now keep up to 1,200 results (helper jobs like the writer and face checks no longer push them out), the tray loads
the latest 400, and the site folder picker also lists everything in the catalog. Results come back on a new rental from
Proton Drive, and the catalog sees them.

### Prompt history

The **clock** in the Create, Edit, Animate and Prompt boxes opens every prompt you tried in this project, grouped into
folders by the pictures they went with (thumbnails on top), newest first and searchable. Each Generate is kept, and so is
the text before *and* after every right-click rewrite (also reachable from HISTORY on the "Changed" popup), so the writer
never loses an earlier version. **Use this prompt** puts it back; **Use with its pictures** also puts back the pictures
it was made with. Whatever was in the box is kept too.

### Pose picker

**Pose** in the Create, Edit chat and Edit prompt boxes: pick how bold (Clothed · Relaxed · Bold · Framing), a camera
angle (a low or overhead camera makes any pose read a level bolder) and one pose. Its words, written limb by limb (weight,
legs, hands, torso, head and eyes), go into the box as typed; in Edit they're an instruction ("Change her pose: …").
Picking another pose replaces the one you added: one pose per picture, because two get blended. The Krea 2 writer and
the Edit chat's "Refine my words" follow the same rules: one pose spelled out limb by limb, the camera angle named,
visible details instead of mood words, and your own wording kept exactly as strong.

### @ in the prompt box, picking many results, and your recipes

- **Type `@`** in the prompt box of Create, Edit, Animate or Plan a video (or press the **@** button under it). A list of your characters and recent pictures opens; arrow keys and Enter pick one. Create: a character becomes the star, a picture becomes Picture 2. Edit: it goes into Picture 1, or Picture 2 if 1 is taken, and the words say which. Animate / Plan a video: it joins the references.
- **Pick many results**: press **Select** above the results, or tick a picture's top-left corner; Shift+click picks everything in between. A bar at the bottom then does one thing to all of them: upscale ×2, sharpen faces, put the picked character's face on them, add them to their private or training set, run a recipe, favourite, download, delete. Esc lets go.
- **Your recipes** are steps you repeat, saved once: e.g. *put her face on it → sharpen the face as her → upscale → add to her private set*. Make and run them from **Batch → Pictures → Your recipes** (drop pictures, files or web pictures on a recipe), from a picture's right-click menu, or from the bar on picked results. Each step works on the picture the step before made; only the last picture shows in your results. The character is whoever is picked on the left when it runs. Recipes are saved on the rental and travel with character exports and backups. (The one-click setups in the header are now called **Quick starts**.)

### Edit chat: change a picture one message at a time

Edit → **Edit chat** (switch back with **Classic edit**). Start with a picture (drop one in, or type `@` and pick one), then
say what to change. Every message works on the latest picture (or click **Continue here** on any earlier take to branch).
Pictures get short `@names` — your character (`@faery`), a Pinterest photo (`@pinterest`), a sweater (`@sweater`) — so
"`@faery replaces the woman in @pinterest`", then "her right hand open, palm up", then "keep the clothes from the original",
then "`@sweater` on her, keep the background" each do what they say. Each message picks a route (shown under it):

- **One part** — it names a part ("her right hand", "the jacket"): SAM 3 outlines it and only that part is redrawn by Krea 2.
- **New background** — the person is kept (SAM 3), Krea 2 redraws everything else, then a light pass blends the light.
- **Qwen → Krea 2** — big changes (a character in, a new pose, clothes from another picture): Qwen-Image-Edit 2511 (20B,
  Apache 2.0 — fine for commercial use) makes the change with up to 3 pictures, Krea 2 repaints it lightly with the character's
  picture and LoRAs (the look stays Krea's), then the face pass. Needs the **Edit chat helper** models (fp8 build + Qwen2.5-VL
  + the Lightning LoRA, ≈30 GB) — "later" until you press **Download now** in the chat's settings; until then big changes go
  through Krea 2 alone. On a 48 GB+ card you can also get the full-precision model (38 GB); it's used automatically.
- **Krea 2** — everything else.

The chip **Auto route / Krea only / Qwen + Krea** forces a route. **2 takes, best shown** makes two; with **Face check on**
each is scored against the character's picture by the writer and the best is picked (one more try if none match).
**Refine my words** (on by default): before Qwen or Krea, your local writer looks at the pictures and turns the message into
one precise instruction — what changes, what stays, which picture is which (like the cloud editors' prompt enhancers; it
keeps your wording's strength and never refuses). "What it was told" under each step shows it. **Words as typed** skips it.
**Qwen: best** uses Qwen's own 40-step settings; **Qwen: fast** the 4-step Lightning LoRA. (Qwen-Image 2.1 was left out on
purpose: its licence is research-only.)

### All your characters in one file

Characters (with every picture, the sheet and the personality) come back by themselves on every new rental when the B2
backup is on. To keep a copy on your computer or move them anywhere: Characters → **Export all** downloads one `.zip`;
drag that file onto any rental's Studio (or **Import file…**) to bring them all back at once. Characters you already
have are updated, new ones added; anyone without an adult age is refused.

- **Import while it downloads:** the startup screen has its own drop box — drop the `.zip` there while the models come
  in, and everything is waiting when the Studio opens.
- **Big files are fine:** the file goes up in 16 MB pieces, four at a time (Cloudflare's secure link refuses any single
  upload over 100 MB — that was the "Couldn't import that file" error once exports carried your results), then the
  rental unpacks it from disk. A progress bar shows sending speed, time left and pictures unpacked. Pictures and results
  already on the rental are skipped.
- **No import at all, with Proton Drive:** a fresh rental (no characters yet) fetches your newest export from Proton
  Drive by itself, then your results in the background — shown on the startup screen and in the Studio.
  It looks in `H3 Studio/exports` and in an `Exports` folder at the top of your Drive (for zips you upload yourself),
  and takes the newest by the date in the file name. `PROTON_RESTORE=0` turns it off. A fresh rental never sends its
  empty export over your real one. Only the newest 3 of the rental's own exports are kept (`PROTON_KEEP`); your own
  `Exports` folder is never touched.
- **Hugging Face keys from Proton Drive:** upload a text file called `hf_tokens.txt` to "H3 Studio" or the top of My
  files. Every `hf_…` in it is used (any layout), on top of the template's `HF_TOKENS`. Swap keys by replacing that
  file; no template editing. In the template itself, more keys than fit in `HF_TOKENS` go in `HF_TOKENS_2`, `HF_TOKENS_3`…

### Character creator format

The Characters tab imports JSON files (one character or a list) in this shape; anything else is read as a plain profile by the local model:

```json
{"id": "stable-id", "name": "Rin Okada", "age": 26, "gender": "female", "style": "anime",
 "appearance": {"hair": "short black bob with a teal streak", "eyes": "grey", "body": "athletic, tall",
                "ethnicity": "Japanese", "outfit": "navy paramedic jacket", "details": "scar through left eyebrow"},
 "personality": "calm, tired"}
```
`age` must be a number of 18 or more, or the character is refused.

## Claude on the rental (it reads the logs and fixes problems)

Every rental has Claude Code installed. Studio ⋯ → **Claude on this rental** opens a terminal in your browser (behind the
same password) and starts it; the first time on each rental you sign in once (press `c` to copy the link, sign in with your
Claude account, paste the code back). Then talk to it from **claude.ai/code** or the **Claude app → Code** on your phone —
the session is called "H3 · <your GPU>". It uses your Claude plan (Pro, Max, Team or Enterprise), not an API key.

It starts in `/opt/h3` with a briefing (`CLAUDE.md`) on how the kit fits together, so you can just ask: "check the rental",
"why did my last edit fail?", "are the models done downloading?". It reads every log, the GPU, ComfyUI's queue and errors,
reruns a failed job to reproduce it, and fixes things. While it's working the rental doesn't shut itself down for being idle.
Closing the terminal tab keeps it running (Studio ⋯ → **Terminal** brings you back).

- **Hot fixes** apply to this rental only. To make fixes permanent, add `GITHUB_TOKEN` to your Vast template (a fine-grained
  GitHub token with *Contents: read and write* on this repo only): Claude then gets the source in `/opt/h3/repo`, commits
  the fix and pushes it, and the next rental runs it once GitHub has built the image (10–15 min).
- **Copy debug report** (Studio ⋯, or `h3-report` in the terminal): errors, failed jobs, downloads, GPU and the end of every
  log as one text file, with passwords and tokens hidden — attach it in a Claude chat when you're not on a rental.

## Adding your own custom nodes

| When | How | Takes effect |
|---|---|---|
| **Permanently** (recommended) | On github.com, open `custom_nodes.txt`, click the pencil, add the node's GitHub link on a new line, then click **Commit**. | GitHub rebuilds in about 10–20 min. Every instance you rent after that has the node. |
| **Right now, no rebuild** | Add the link to `EXTRA_NODES` in `config.env` (launcher), or add `-e EXTRA_NODES=https://github.com/x/y` to the template's Docker options. | Next rent. Adds about 30 seconds to each boot. |
| **Just testing** | Install it with ComfyUI-Manager on a running instance. | Only that instance. Gone when it's destroyed. |

Already included: ComfyUI-Manager, KJNodes, RMBG, QwenVL, rgthree, LLM Text Processor, Fizgig H3 Still, and VideoHelperSuite.

**The LLM Text Processor fix:** this node, used by *MinimaxH3 Auto Prompter v7.3*, only supports Windows out of the box and errors on Linux. The image compiles llama.cpp for the GPU and patches the node to use it. Keep `scripts/patch_llm_text_processor.py`.

## Adding models / LoRAs

**Quickest (no rebuild): your Vast template.** Add environment variables:

| Key | Value |
|---|---|
| `PROTON_USER`, `PROTON_PASSWORD`, `PROTON_2FA_SECRET` | Proton Drive: every 15 min new results, and every run an export .zip (without the result files — they sync on their own), are copied; a fresh rental restores the newest export by itself (`PROTON_RESTORE=0` to stop that), are copied to the folder "H3 Studio" (`PROTON_FOLDER` to change, `PROTON_MAILBOX_PASSWORD` for two-password accounts, `PROTON_EVERY_MIN` for the interval). `PROTON_2FA_SECRET` = the setup key of your Proton 2FA (the text under the QR code), so each new rental logs in by itself. Uses rclone's Proton Drive backend — unofficial and in beta; if Proton changes something it can stop until rclone catches up. ⋯ → Send to Proton Drive now shows the status |
| `H3_IMAGES_ONLY` | images-only mode: `1` = on, `0` = off. Default: on automatically for cards under 30 GB (4090, 5080…) — H3 video and the 27B writer wait (Download now still gets them) |
| `SITE_FACTORY_TOKEN` | the API key for your site's character factory (⋯ → Your site sends characters there as drafts). Or paste it in the Studio instead. `SITE_FACTORY_URL` changes the address (or paste it in the Studio once; it is kept with your settings) |
| `HF_TOKENS` | several Hugging Face keys, comma-separated (`hf_aaa,hf_bbb,hf_ccc`). Hugging Face slows a key down after heavy use (~300 → ~50 MB/s); the downloader then switches to the next key, carries on where it was, and remembers which keys were slow so the next rental starts on a rested one. Keys from 2–3 different Hugging Face accounts work best. `HF_TOKEN` (one key) still works |
| `CIVITAI_TOKEN` | your CivitAI API key (civitai.com → profile → **Settings → API Keys → Add API key**). Set once here — nothing to paste in the Studio. Adult collections, pictures and models are fetched from civitai.red first, then civitai.com (`CIVITAI_HOST` changes the first site) |
| `EXTRA_MODELS` | `loras\|<download link>\|<file name>.safetensors` — several separated by commas, no spaces |

Example `EXTRA_MODELS` value:
`loras|https://civitai.com/api/download/models/123456|raven_style.safetensors,loras|https://civitai.com/api/download/models/789012|pose_helper.safetensors`

Get the download link on the CivitAI model page: right-click the **Download** button → **Copy link address**. Make sure the page's **Base Model** says MiniMax H3 (or Krea 2 / Anima / Illustrious for pictures). The file name is what you'll see in ComfyUI's LoRA dropdown.

**Permanent: `models.txt`** in the repo, same idea: `loras  <url>  <file name>` (file name optional for Hugging Face links). GitHub rebuilds the image after you save.

Your CivitAI key is only sent to civitai.com; the actual file is fetched from CivitAI's signed link without the key.

## Notes
- **Bandwidth:** each boot downloads about 47 GB. The launcher skips hosts charging over $5/TB.
- **Outputs** live on the instance until backed up. With B2 set up they are uploaded automatically; without it, the idle shutdown *stops* (not destroys) the instance when there are outputs, which keeps a small daily storage charge until you download them and destroy it.
- **If something breaks**, the logs are on the instance (open Vast's SSH button): `/var/log/h3-start.log`, `/var/log/comfyui.log`, `/var/log/aria2.log`, `/var/log/extra-nodes.log`.
- **If you see "no matching offers"**: raise `MAX_PRICE`, lower `MIN_INET_MBIT` to 500, or lower `MIN_RAM_GB`.
