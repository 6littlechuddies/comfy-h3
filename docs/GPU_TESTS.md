# GPU test session (for Claude on the rental)

When the person says **"run the GPU tests"**, follow this. The goal is evidence for the Claude that writes the code
(it has no GPU): logs, timings and result pictures, pushed to the **`rental-tests`** branch. Don't change code in this
session and don't push to `main`. Never include secrets in anything you write or push.

## 1. Before they start (you)
- Record: GPU name and VRAM (`nvidia-smi`), free disk (`df -h /`), image version (`cat /opt/h3/VERSION` if present),
  the download state (`/opt/h3/run/downloads.json` — which groups are done).
- Start a VRAM log in the background for the whole session:
  `nvidia-smi --query-gpu=timestamp,memory.used,utilization.gpu --format=csv -l 2 > ~/gpu-tests/vram.csv &`
- Note the current line count of `/var/log/comfyui.log` so only this session's lines are collected.

## 2. Ask them to do these in the Studio, one at a time, and tell you when each is done
1. **Writer timing.** Make one picture in Create. Right after it finishes, right-click part of a prompt → Change this part.
   Then do a second rewrite with nothing else running.
2. **Swap into it.** CivitAI → pick a picture with one person → With your character → Swap into it.
3. **Edit with a place.** 04 Edit (classic): Picture 1 = a picture of a person, Picture 2 = their character,
   The place = a room or street. Write "Put her on the sofa" (or similar) → Make edit.
4. **Small fix.** Edit chat on any result: "close her eyes" and "put her tongue away".
5. **LoRA strengths** (only if a character has a LoRA). Create with no pictures, same prompt and seed, the LoRA at
   0.6, 0.8 and 1.0 (change it on the identity card between runs).

Ask them for a one-line opinion on each result (good / wrong and how).

## 3. Collect (you)
Into `~/gpu-tests/<date>/`:
- `notes.md`: the GPU info, each test with its time taken (from `Prompt executed in … seconds` lines), whether
  `[h3] freed the GPU for the writer` appeared, any errors, and the person's opinion of each result.
- `comfyui.log`: only this session's lines. `vram.csv`.
- The result pictures of each test (newest files under `output/studio/`), shrunk to 768 px on the long side as JPEG
  (`python -c` with PIL) so the push stays small. Name them `1-writer.jpg`, `2-swap.jpg`, ….
- What each model was told: for Edit chat, `curl -s http://127.0.0.1:18190/studio-api/state/edit_chats` — keep only the
  chats from this session.

## 4. Push
In `/opt/h3/repo`: `git fetch origin && git checkout -B rental-tests origin/main` (or the existing `origin/rental-tests`),
copy the folder to `gpu-tests/<date>/`, commit "GPU tests <date> on <GPU>", `git push origin rental-tests`.
Tell the person it's pushed so they can say "check rental-tests" to the other Claude.

## Brush / painted-area tests ("run the brush tests")
For the Claude that writes the code to see what the painted-area edit really does. Ask the person to do these in
04 Edit (classic Edit, Paint area), one at a time, with pictures of their choice, and tell you when each is done:
1. **Remove a person**: paint over one person in a picture with two people → "remove the man" (or woman) → Make edit.
2. **Remove an object**: paint over a cup, bag, logo or similar → "remove the cup" → Make edit.
3. **Fix a part**: paint over a hand or face → "fix the hand" (or "make her smile") → Make edit.
4. **Change a part**: paint over a shirt → "make it a red hoodie" → Make edit.

Collect into `~/gpu-tests/<date>-brush/`, for each test `N-…`:
- the input picture and the painted mask (newest `mask_*.png` in `/opt/ComfyUI/input/`), and the result (newest file
  under `output/studio/edit/`) — shrunk to 1024 px long side, JPEG;
- the exact graph that ran: `curl -s 127.0.0.1:18188/history?max_items=10` → keep the prompt (graph) of each edit
  job as `N-graph.json` (it shows the instruction, denoise, crop and mask settings);
- the person's one-line verdict in `notes.md`.
Push to `rental-tests` as in step 4 above, and tell the person to say "check the brush tests" to the other Claude.

## Angle & blotch tests ("run the angle tests")
Why: pictures made from a reference look blotchy and keep the same face/angle. Find out which setting causes it, and
whether the Qwen angle tool turns a character around properly. You (Claude on the rental) can queue graphs yourself
on ComfyUI at `127.0.0.1:18188` (POST `/prompt` with `{"prompt": <graph>}`); nothing here needs a new image.

Ask the person for ONE realistic character that has a front picture (and, if they have one, a trained LoRA), then:
1. **Angles (they press it):** Characters → that character → tick Back, Left side, Right side, 3/4 front → Make views.
   These now come from Qwen-Image-Edit 2511 + the Multiple Angles LoRA (`<sks> back view eye-level shot wide shot`).
   Note in `notes.md` whether "Left side" really faces left (the mapping is `ANGLE_OF` in `studio/src/lib/sheet.ts`;
   if left/right come out swapped, swap them there).
2. **One identity edit (they do it):** Create with pictures → a found picture + the character → Insert my character →
   Generate once. Take that job's graph from `curl -s 127.0.0.1:18188/history?max_items=5`.
3. **Variations (you queue them, same seed as the original):** copy that graph and change one thing at a time:
   a. `Krea2EditModelPatch.ref_boost` 1, 1.5, 2 (the Studio sends 2 for V2 Identity);
   b. `KSampler.steps` 10 vs 20 vs 28 (cfg unchanged);
   c. the character's own LoRA (a `LoraLoaderModelOnly` after the identity LoRA) removed vs kept;
   d. the identity LoRA swapped for the V1.2 edit LoRA (`krea2_edit*` in `models/loras`), ref_boost 4.
4. **LoRA test (they press it, only if a LoRA exists):** Training set → Test their LoRA · 6 pictures. Note the scores
   from the message.

Collect into `~/gpu-tests/<date>-angles/`: every result shrunk to 1024 px long side (JPEG), one contact sheet per
test (PIL: pictures side by side with the changed setting written under each), the graphs as `N-graph.json`, and the
person's one-line verdict per sheet in `notes.md` (which one is least blotchy, which one turns the head). Push to
`rental-tests` as in step 4 above, and tell the person to say "check the angle tests" to the other Claude.
