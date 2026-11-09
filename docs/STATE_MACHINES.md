# State machines in H3 Studio

Anything in the Studio that goes through states (a job, a download, a board run, a training picture) is listed here. For each one: its states, which ones are final, what moves it along, where it's saved, and what happens after a reload or a rental restart.

**See them live:** `GET /studio-api/machines` lists every machine that is mid-way or has errored (`?all=1` lists everything). Each row has the shape `{machine, id, state, label, since, error}`.

- **Rental machines** are read straight from the server.
- **Browser machines** have the prefix `browser:`. The page posts them every minute and when its tab is hidden (`lib/machines.ts`).
- **The debug report** has an "In progress" section built from the same list.
- **In the browser console** (with `?debug` in the URL), `studio.machines()` prints the page's own machines.

These states count as final: `done error cancelled failed none ok off later skipped ready idle`. Anything else is still in progress. If something stays in progress long after you'd expect it to finish, that's a bug.

## Two rules for new code

1. **Waiting for a rental job** (`/studio-api/…/job/<id>`): use `watchServerJob` from `lib/serverJob.ts` instead of writing a polling loop.
   - It gives up if the job is gone (a 404 means the rental restarted) or the rental stops answering for 45 s.
   - Each case ends with a message that says what to press next.
   - This replaced five hand-written loops. Some of them used to spin forever.
2. **Background work on the rental** (`asyncio`): start it with `_spawn(coro)` in `studio_server.py`, not a bare `create_task`.
   - `_spawn` holds a reference to the task until it finishes.
   - Python can otherwise garbage-collect a task nobody references while it's still running, which would leave the job "running" forever.
   - The task's body should catch its own errors and set `status = "error"`.

And for anything with states that's saved (browser storage or `saveState`): **settle it when it loads.** A saved state that only makes sense while the page is open, like "running" or "making", has to become a final state with a note that says what to press, or be picked up again. Never leave it showing as in progress.

## In the browser

| Machine | States (final ones in bold) | Moved by | Saved | After a reload |
|---|---|---|---|---|
| `job` (`lib/jobs.ts`) | queued → running → **done / error / cancelled** | ComfyUI websocket, plus a check of `/queue` every 3 s | browser storage and the rental (`jobs`) | Open jobs are checked against ComfyUI's history: finished ones are collected. A job that's neither in the line nor in history becomes **error** ("Lost: the card's ComfyUI restarted…"). `jobsReady` resolves once the saved list is back. |
| `board_run` (`lib/board.ts`) | planning → queued, or **error** | `runKind` puts the plan job in the line, then `continueRun` waits for the plan and lines up the takes | `saveState("board")` | `resumeRuns()` waits for `jobsReady`, then carries on with every run that's still planning or is short of takes. It reads the plan from `planJob` (or the saved `plan`) and uses the run's own `cfg`, not the current settings. If the plan job is gone, or an old run has no `cfg`: **error** "interrupted — … press Make videos again". |
| `train_picture` (`lib/builder.ts`) | making → checking → **done / failed** | `buildTrainSet`, `recheck`, `addToSet` | each character's `trainset` | `settleTrainSets()` in `lib/characters.ts`: making → **failed** ("build again or remove it"). checking → **done**, unchecked and left out, with the note "press Check again". Before this fix, a cut-off picture kept Build greyed out for good. |
| `edit_turn` (`lib/editchat.ts`) | running → **done / failed** | `send` | `saveState("edit_chats")` | running → **failed** ("The page was closed while this was running — its pictures are in Edit's results"). |
| `batch_row` (`lib/batch.ts`) | new → writing → ready → queued, or **error** | Batch tab | not saved (this page only) | Starts empty. |
| `import` (`lib/importer.ts`, rental `IMPORTS`) | uploading, or finding → fetching → unpacking → **done / none / error** | Upload in pieces; restoring from Proton/Google Drive | rental memory | The rental's own state is the source of truth. **none** means no export was found, which isn't an error. |
| per-project workspace (`lib/projectWork.ts`) | which project's work is on screen | changing the selected character | `h3.proj.<id>` in browser storage | Restored as you left it. |

## On the rental (`scripts/studio_server.py` unless noted)

| Machine | States | Moved by | After a restart |
|---|---|---|---|
| `lora_download` (`LORA_JOBS`) | running → **done / error** | `lora_job` (`_spawn`) | Forgotten. The browser gets a 404 and shows "The rental restarted before the LoRA download finished — start it again". |
| `finish_export` (`JOBS`) | running → **done / error** | `finish_job` (`_spawn`) | Same: Finish shows "Export: …" and resets. |
| `lora_training` (`TRAIN_JOBS`) | running → **done / error** | `_train` (`_spawn`) | Same: Train shows "training stopped: the rental restarted…". |
| `site_send` (`SITE_JOBS`) | running → **done / error** | `_site_push` (`_spawn`) | Same: the send ends with an error you can retry. |
| `drive_backup` (`PROTON`) | off → waiting → **ok / error** | `proton_sync` | Starts at off and checks again on its own timer. |
| `warmup` (`WARM`) | waiting → **sent to N cards / failed: …** | first-load warm-up | Runs again. |
| `hf_key_request` (`KEY_REQ`) | asked → cleared | the page asks the Mac helper for a Hugging Face key | Forgotten. The page asks again if it needs to. |
| `rental` (`status.json`, written by `scripts/start.sh` and `watchdog.py`) | booting → restoring → downloading → loading → starting → **ready**; also slow, **error** | `start.sh` phases | Runs from the top. |
| `download_group` (`downloads.json`) | checking → waiting → downloading → **done / error / skipped / later** | the downloader | Picks up where the files left off. |
| `card`, `card_line`, `split_video` (`scripts/comfy_router.py` via `/h3-router`) | card idle / busy. The line of jobs is held and handed out by priority (writer → other → video, with "front" first). Ray split on, or off with a reason. | the router's dispatch (under a lock) and its poll loop (which never dies) | Starts empty. ComfyUI's own queue is the source of truth for jobs. |
