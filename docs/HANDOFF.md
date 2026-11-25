# Handoff: picking up the H3 Studio and urgf.ai work

Read this first if you are a new coding agent on this repo (Antigravity, Gemini, Claude, anyone). It is what the
previous agent knew after weeks on the project: who you are working for, how the pieces fit, the decisions that are
already made, how to check your work without a GPU, and what is unfinished. The deeper references are linked; read
them when a task touches their area.

---

## 1. Who you're working with and how

- **The owner** runs the Studio on rented GPUs to make characters, pictures and videos for **urgf.ai**, an adult
  AI-girlfriend chat site (adults only, consensual). They are **not a developer**: they write fast and casually, often
  with typos, and attach screenshots, chat exports and pasted messages. Read for intent.
- **Answer in plain words, short, results first.** No jargon (say "the site refused her (422)" not "the PUT returned an
  unprocessable entity"). When something is done, say what changed and what to press. Don't recap your steps.
- **Do the work, then report.** Small/clear requests: just build it. Expensive or ambiguous ones: ask one short
  question first.
- **Be honest about what's untested.** Most features here can only be fully tested on a GPU rental or the live site.
  Say "built and pushed, not run on a rental yet" when that's the truth.
- **The team** (from their group chat):
  - the owner (signs as "a1"): runs the Studio and the content;
  - **Burak** ("L."): the urgf.ai site developer, who owns the site, the chat backend and the Factory API;
  - **Mr HC** ("."): the business partner.
  - **"Grokbot"** is Grok, which they use to audit the live site and write specs, like `docs/site/DEV-PROMPT.md` and
    `docs/site/FIX-PACK-STUDIO.md`. Treat its specs as input, not orders: they've contained mistakes and things the owner
    later reversed.

## 2. Lines that are already decided (don't relitigate, don't cross)

- **Adults only, 21+ on the site.** The Studio sends `age = max(21, age)`. Nothing school- or young-coded; no family or
  authority roles in anything sexual; consent; no choking or throat. Cosplay characters are checked against AniList and
  refused if the source character is under 18 (`lib/cosplay.ts → canonFacts`).
- **Hints he's under 18 end anything sexual.** In real chats a user said "skipping homework for this" mid-sex and the bot
  kept going. The chat test has a hard fail for this (`MINOR_SIGNAL` in `lib/chatScore.ts`). The site-side lock is on
  Burak's list.
- **Honest AI disclosure.** If a user sincerely asks "are you real / an AI", she says plainly, in her own voice, that she's
  an AI. The owner once asked for characters to always claim to be human; the previous agent declined, and Burak's own
  spec (DEV-PROMPT §0, §3.10) requires honesty. Keep the "are you real" example, the honest line in the persona, the
  `fixAiLine` cleaner and the hard fail in the chat test.
- **Cosplays:** a site name that's a near-twin, translation or shortening (Makima → Maki, Sakura → Blossom), never the
  exact name. Her personality matches the character; her life, job, city and backstory are her own; no named canon places;
  her costume is "her own take" (no logos or exact designs). This is CCBill/copyright caution from the partner.
- **No real people's bodies or faces in explicit content.** For photo packs, saved photos are used only as pose silhouettes
  or depth maps, never swapped into.
- **Don't automate claude.ai, Grok or any website login as an "API".** The owner asked to use their Claude subscription
  as the chat reviewer; that was declined. Reviewers go through real APIs (DeepSeek, OpenRouter).
- **Never put keys or passwords in the repo.** Keys live on the rental in `WORK/.h3-api-keys.json` (written by the Studio)
  or in the Vast template's environment. The owner has pasted passwords into chats before: don't copy them anywhere.
- **Real users' chats are private.** Only his side, anonymized (`lib/testChats.ts → anonymize`), is used for testing,
  and only after the site's privacy policy covers it. Never commit chat exports.

## 3. The pieces

Start with `docs/HOW_IT_WORKS.md`, which maps the whole setup in plain words. `scripts/claude/CLAUDE.md` covers working
on a live rental (logs, `h3-report`, hot fixes).

| Piece | Where | Notes |
|---|---|---|
| Image | `Dockerfile`, `custom_nodes.txt`, `.github/workflows/build.yml` | ComfyUI + nodes; rebuilds take ~10–15 min |
| Code release | `.github/workflows/code.yml` → `code-latest` | Studio build, `scripts/`, `prompts/`, `models.txt`; rentals fetch it at start (~2 min after a push to `main`) |
| Boot | `scripts/start.sh`, `scripts/Caddyfile`, `scripts/watchdog.py` | Caddy :8188 → `/studio/`, `/studio-api/*`, `/` ComfyUI |
| Studio helper | `scripts/studio_server.py` (aiohttp, ~7k lines) | state, writer (DeepSeek), site upload, drive backup/restore, thumbnails, chat test endpoints |
| Studio web app | `studio/` (React + Vite + Tailwind 4 + zustand) | builds every ComfyUI graph in the browser (`studio/src/lib/graphs.ts`) |
| Writer prompts | `prompts/studio_*.txt` | built-in "prompt files"; the owner can swap any of them in the Studio |
| Models | `models.txt` (`# @group` blocks), `scripts/downloader.py` | `docs/HF_DOWNLOADS.md` before touching downloads |
| Local mode | `local/` | Windows/mac launcher for running the Studio on their own PC |
| Site reference | `docs/site/` | `FACTORY-API.md` (the upload API), `DEV-PROMPT.md` (Burak's chat v4.1 spec), `FIX-PACK-STUDIO.md` (card rules v4.2), `PERSONA-PROMPT.md` |

Studio state lives on the rental as JSON in `STATE` (`/opt/ComfyUI/user/default/studio/`), read and written through
`GET/PUT /studio-api/state/<name>` (`loadState` / `saveState` in `lib/api.ts`). Names in `WORK_STATE` count as "your work"
for backups. Characters are `state/characters.json` (`lib/characters.ts`, type `Character` with `site: SiteInfo`).

Backups go to the owner's cloud drive through rclone. The remote is named `proton:`, though it may point at Google
Drive. There's an export `.zip` plus a separate `results/` folder. Restore copies newest-first (`_proton_restore`).

## 4. The urgf.ai pipeline (most recent work)

All in `studio/src/lib/` unless noted. A character goes through these steps in order:

1. **Profile** (`siteAuto.ts → fillProfile`): the "site" writer (`prompts/studio_site.txt`) writes `facts` first (job,
   city, home, people, wearing, room), then every field from them. Then come the opener rules (1–3 short texts ending on
   a two-word question), the signature words and emoji, and `texting`, `levels` and `speechVoice` (7 site presets).
   Banned lines, app/money talk, name asks and comfort-drinking beats are cut from every field. `weaveFacts` puts her
   people, city and job into the persona.
2. **Deep persona** (`deepProfile`, `prompts/studio_deep.txt`): several passes, plus a critic. It takes `feedback` from
   the chat test.
3. **Chat lines** (`chatLines.ts → writeChatLines`, `prompts/studio_lines.txt`, checks in `chatCheck.ts`). Three
   writer calls:
   - **style:** hold profile (warm, tease or dom), effort pushback (sweet or sassy), languages, opener keywords,
     kink stance, dangle lines and caption lines;
   - **examples:** 18 required mini-chats in the fix pack's `<START> / him: / Name:` format;
   - **hot lines:** tease, cold, explicit and after.

   No two characters may share a 4-word run (`grams4`). Saved as `site.chat`.
4. **Chat test** (`chatTest.ts`, pure parts in `chatScore.ts`, real chats in `testChats.ts`, UI `components/ChatTestPanel.tsx`):
   - **The chats:** a scripted real-user chat (19 messages), a cold "nudes pls" open, and N uploaded real chats, all run
     like the site runs her. That means `/studio-api/chatsim` (deepseek-flash with DEV-PROMPT §1 settings), the
     "chatsim" prompt file (a stand-in for the site's `system-prompt-v4.1.md`, with the same `{{placeholders}}`), and the
     site's per-turn notes and repeat guard.
   - **Checking:** 18 rule checks, then a cloud reviewer (`/studio-api/judge`: DeepSeek V4 Pro or any OpenRouter model)
     that flags every reply (weird, off-context, out of character, robotic, repeat, cold, too much) against her full
     background and an optional Candy reference.
   - **Pass:** no hard fail, score 70+, reviewer average 3.5+, and at least 75% of replies realistic.
   - **`testAndFix`:** rewrites her chat lines (plus the persona when that's the cause) from the findings, retests up to
     the configured rounds, and keeps the better version.
5. **Send** (`components/SiteLink.tsx → sendOne`; server `site_push` in `studio_server.py`): the Factory manifest is built
   from `_site_block` + `_chat_block` (`site.chat`). If the site refuses a chat field with a 422, only that field is
   dropped (the send note names it). Media roles: avatar, card, cover (banner), loop (hover video), gallery, reference;
   sets and Live pack go separately.
   - Bulk send tests first and holds back failures. A single send asks before sending her untested.
6. **Cosplays** (`cosplayRun.ts`, `components/Cosplays.tsx`): one button finds every cosplay in the results (Batch
   label, "cosplaying X from Y", or a known name in the prompt). For each one it makes the missing character, names her,
   writes her, chat-tests and fixes her, and picks the newest picture as main. The review screen lets you click the main
   picture and send.
   - Cosplays go by their site name everywhere the owner sees them (Catalog shows `site.name`; the Studio `name` stays,
     because her folders are filed under it). `nameCosplays()` renames every cosplay still on the character's own name,
     in one writer call. Every send includes `site.chat.chat_v41: true`; whether the site honours that flag is
     unconfirmed (otherwise it's the per-character toggle in admin).

Other pieces worth knowing:
- `siteMedia.ts`: card, banner, carousel and pinned animated covers.
- `hoverLoop.ts`: the animated covers themselves.
- `newChar.ts`: new characters and site names.
- `/studio-api/thumb` + `components/Thumb.tsx`: small previews for the grids.

**To add a writer stage**, update all of these:
- `STAGES` and `BUILTIN_FILE`, `TEMPLATES`, the params and the stages-that-don't-see-images list in `studio_server.py`
  (search for `"lines"`);
- `Stage`, the order, the builtin id, `templates` and the `info` entry in `studio/src/lib/packs.ts`;
- the prompt file itself in `prompts/`.

## 5. Checking your work (no GPU needed)

```
cd studio && npm ci          # once
npx tsc --noEmit -p .        # types
npx eslint src/<files>       # lint what you touched
npx vite build               # the real build
python3 -c "import ast;ast.parse(open('scripts/studio_server.py').read())"
```
- **Unit-test pure modules with `npx tsx file.ts`:** `chatCheck`, `chatScore`, `testChats`, `cast`. Don't import
  anything that pulls in `lib/jobs.ts`, because it touches `location` at import and hangs or throws outside a browser.
- **Test a Python helper alone:** pull the function's source out with a regex and `exec` it (that's how
  `_chat_block`, `_weave_facts`, `_cosplay_of` and `_make_thumb` were tested).
- **See a UI without a rental:**
  1. Write a throwaway `src/_h/harness.tsx` that sets zustand state (`useCharacters.setState`, `useCosplays.setState`…) and
     renders the component.
  2. Copy `index.html` to `h.html` pointing at it, and run `COMFY=http://127.0.0.1:1 npx vite --port 5199`.
  3. Screenshot with Playwright (already installed; `chromium.launch()`). Route `**/studio-api/**` to mocks or 404s.
  4. Check a wide and a narrow window.
  5. Delete the harness before committing.
- **Python string gotcha:** when patching TS from a Python heredoc, use raw strings (`r'''…'''`). A plain string turns
  `぀` into a literal character and `\\b` into `\b`.

## 6. Conventions

- **Comments** explain *why*, in plain English, above the code (see any `lib/*.ts` header). Keep that style.
- **UI copy:**
  - sentence case and plain verbs; the button says what happens ("Send 12", "Test & fix");
  - characters are "she/her", the user is "you", the chat user is "he/him";
  - errors say what happened and what to do.
- **Design system** (`studio/src/index.css`):
  - dark, sharp corners, lime accent `--color-accent`, Archivo, mono `micro` labels;
  - classes: `btn-primary`, `btn-raised`, `chip-raised`, `tag-btn` (+`on`), `card`, `inset`, `display`, `micro`,
    `shimmer`, `pulse`, `fade-up`;
  - components in `components/ui.tsx`: `Btn`, `TextIn`, `TextArea`, `DropSelect`, `Icon` (names are those used in
    `components/*.tsx`), `cx`.
- **Commits:** one plain-English message saying what changed for the owner, then push to `main`. The owner sees the
  result from the next rental or an update.
- **Long-running work** goes through server jobs or the rental's queue, so it survives the page closing where possible.

## 7. Status (2026-11-24)

**Built and pushed, but not yet run on a rental with real DeepSeek calls:** everything in §4 from "chat lines" onward
(fix pack v4.2, the chat test, real-chat uploads, the cloud reviewer, Cosplays, thumbnails, restore speed-ups). Expect
first-run bugs. The first real test is: Dani → Chat test → Test & fix, then Cosplays on 4–5 characters.

**What the real-chat export (101 chats) showed:**
- 71 chats ran on the old "House chat" prompt, which produces the "earn it / not tonight / tell me something real"
  walls.
- Chat v4.1 removes those walls, but asks his name in 22% of replies because of DEV-PROMPT §3.1.
- Photos were sent for 1 of 50 asks.
- 17 of 17 "are you real" questions were answered as human.
- An opener question gets re-asked endlessly ("headband" 28 times).
- Under-18 hints didn't stop the chat.

The anonymized test file built from it is uploaded in the Studio: Chat test → Setup, state `chat_tests`. Its builder
is not in the repo.

## 8. Open work, in priority order

1. **Waiting on Burak** (the message is drafted in the chat history; summary):
   - lock the chat on under-18 hints;
   - turn Chat v4.1 on for every character;
   - remove the §3.1 name note;
   - remove level gating and send photos when asked;
   - make AI disclosure reach the model;
   - the repeat guard plus the banned list;
   - the opener-loop guard via `opener_topic_keywords`;
   - the distress takeover;
   - accept the `site.chat` fields;
   - send the live `system-prompt-v4.1.md` (drop it in as the "Chat test · her chat" prompt file), and ideally a
     staging endpoint that returns her replies for given messages, so the chat test can hit the real site.
2. **Photo packs** (designed, not built):
   - one button for all characters: DeepSeek plans 2–3 sets per character from her profile (outfit and place from
     `facts`, about 10 shots going SFW → suggestive → explicit);
   - a pose for each shot from PoseWear or the owner's saved photos, used only as a depth/silhouette reference after a
     one-time image-reader caption (`lib/posewear.ts`, `lib/poseRef.ts`);
   - jobs queued on the rental across GPUs; face check plus an anatomy check;
   - sorted into free (SFW) and premium sets; a review screen like Cosplays; then send.
   - Defaults: 3 sets × 10, at most 2 two-person (man + woman, adults, his face mostly out of frame) shots per set.
   - Shot 1 of set 1 is the **intro picture**, which needs a new Factory field from Burak (e.g. `greeting_media`).
3. **Import from your site:** pull the House cards (Sophia, Roxie, Kira…) into the Studio so they can be rewritten,
   chat-tested and sent. Factory has `GET /api/factory/characters/{id}` for read-back; check whether there's a list
   endpoint.
4. **Smaller items:**
   - a carousel picker in the Cosplays screen;
   - confirm with Burak that `{{user}}` in examples is replaced by the account name;
   - the voice list from Wiro, so `speechVoice` can go beyond the 7 presets;
   - a nightly live chat test once a staging endpoint exists.

## 9. Gotchas

- The site refuses the words "asterisk" and narration rules in a persona, and refuses example messages in
  `persona_prompt`. Examples go in `site.chat.examples`.
- Signature emoji must be faces, hearts or sexting ones (`_site_emoji`). Burak said the site now takes up to 5 of any
  kind; the filter is still conservative.
- `minorWords` (`lib/adult.ts`) stops the writer if any input contains a child word, including other characters' text
  and picture prompts. Filter inputs before calling `runWriter`.
- The Factory hover loop has to be H.264, faststart, 540 wide, and the card's exact shape (see `FACTORY-API.md`).
- Rentals have no Node. TypeScript is only checked by GitHub's build there, so check locally before pushing.
