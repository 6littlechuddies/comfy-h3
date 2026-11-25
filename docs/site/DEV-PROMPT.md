# DEV-PROMPT: ship urgf.ai chat v4.1

> Paste this whole file to the developer or coding AI. Attach `system-prompt-v4.1.md` and the `test-kit/` folder.
> The reference implementation of every server feature is `test-kit/kit/run_ab.py` (`server_reply`, `v41_notes`, `guard_hits`). When this spec and that file disagree, this spec wins, and please flag it.

## 0. Goal and ground rules
- Replace the site-wide character prompt with `system-prompt-v4.1.md`, and add the server features below so the girls text like real people: short multi-text replies, a distinct voice per girl, a controllable heat pace, no stock phrases, honest AI disclosure, and memory that holds over 90+ messages.
- Ship behind a feature flag (`chat_v41`). Try it on a few characters first.
- **Do not change:** the "If he asks what you are" section and the "Hard rules" section of the prompt (the owner's decision and the safety floor), and the persistent "AI character" label in the chat UI.
- **Safety floor:** adults only (cards are 21+), nothing underage-coded, no family, no non-consent, no violence beyond playful consensual spanking, no real people. The prompt states it, and §3.8 enforces it on the server.

## 1. Model settings (defaults, per character overridable)
```yaml
model: deepseek-flash          # = DeepSeek-V4.1-Flash-1017; no pinned snapshot id exists, the API only accepts deepseek-flash / deepseek-v4-pro
base_url: https://api.deepseek.com
thinking: {type: disabled}
temperature: 1.0
top_p: 0.95
frequency_penalty: 0.3
presence_penalty: 0.2
max_tokens: 400                # the prompt keeps replies to 1–3 short texts; 400 is headroom for explicit scenes, not a target
```

## 2. Prompt assembly
Messages sent on every turn:
```
[ {role: system,    content: render(system-prompt-v4.1.md, card, chat_state)},
  {role: assistant, content: card.first_message},          # the opener, as her first message
  ...history (user / assistant pairs, full text, newest last)...,
  {role: user,      content: latest_user_message},
  {role: system,    content: notes.join("\n")} ]           # ONLY if there are server notes this turn (see §3)
```
- Server notes always start with `(note:`. The prompt tells her they come from the server and never to mention them. Never show notes in the UI, and never store them as user text.
- Keep the whole history while it fits (the model has a large context). When trimming, keep the opener, the facts and memory blocks, and the last 60 turns.

### Placeholders in `system-prompt-v4.1.md`
| Placeholder | Source |
|---|---|
| `{{name}}`, `{{age}}` | card Name, Age (must be ≥ 21) |
| `{{who}}` | card Tagline + " " + Description |
| `{{body}}`, `{{personality}}`, `{{tags}}` | card Body, Personality, Tags |
| `{{manner}}`, `{{sound}}` | card "Her manner" (split at "How you sound:") |
| `{{life}}` | card "Her life" |
| `{{job}}`, `{{city}}`, `{{home}}` | card Facts (fixed facts; she answers these the same way every time) |
| `{{looks}}`, `{{wearing}}` | card "What she looks like"; Facts.wearing (current outfit; photos must match it) |
| `{{examples}}` | card Examples (her own example lines, never another girl's) |
| `{{signature_line}}` | generated from card "Signature words" (template in `test-kit/kit/build_v41.py: sig_line`) |
| `{{emoji_line}}` | generated from card "Emoji rate" (template `emoji_line`) |
| `{{casing_line}}` | `lower` or `proper`, from the card "Casing" setting (texts in `build_v4.py: CASING`) |
| `{{memory_him}}` | owned facts about him (name, job, city, pet, events), one per line, from the memory store; "Nothing yet. You don't know his name." on a fresh chat |
| `{{right_now}}` | card "Her situation" if set, else the default line in build_v41.py |
| `{{people}}` | card "People" (named people in her life), else "none named yet…" |

## 3. Server features (per turn, before calling the model)
Per-chat state:
```
state = { pushes: 0, max_holds: <§3.2>, named: bool, tod: "evening", status: "texting from home",
          asleep: false, prev_replies: [], user_msgs: [] }
```
Regexes (case-insensitive; copy them exactly from run_ab.py):
```
AI_ASK    = \b(are|r) (you|u) (an? |even )?(ai|a bot|bot|real|human|a real person|a person)\b
PUSH      = take (it|that|this|the \w+) off|send me something|tell me exactly|describe|don'?t hold back|be explicit|hard for you|pull (it|that) off|keep going|finish on|show me more|naked|nudes|spicy
NAME_ASK  = \b(your name|a name|name first|call you|what do i call|who (even )?are you)\b
GOODNIGHT = \b(good ?night|gn|going to (bed|sleep)|heading to bed|off to bed|getting sleepy|gonna sleep|time for bed)\b
MORNING   = \b(good ?morning|morning|just woke|woke up)\b
ONSHIFT   = \b(on (my |a )?(shift|break)|at work|on nights|heading (in|to work)|shift (starts|tonight))\b
OFFSHIFT  = \b(off (work|shift)|got home|home now|just got (home|off)|after (my|the) shift)\b
```
Tune PUSH with real traffic (add "pic", "photo", "nude", "strip", "fuck me"…), and log every match.

### 3.1 Name note
```
if not state.named and turn > 1:
    note("(note: you don't know his name yet. ask it in this reply, casually, as its own short text.)")
# state.named = true when his message gives a name (store it in memory_him), or his profile has a display name the user opted to share
```

### 3.2 Heat-hold counter
Config:
```yaml
heat:
  default_mode: candy        # recommended site default
  modes:
    candy: {holds: random_choice([0, 1])}   # seeded per chat (chat_id) so retries are stable
    two:   {holds: 2}
  per_character_override: {}  # e.g. {Wren: 2, Vivian: 2} for guarded or slow-burn characters
```
Per turn:
```
if PUSH.match(user_msg):
    state.pushes += 1; p = state.pushes; m = state.max_holds
    if p <= m:
        note(f"(note: heat push {p} of {m}: hold this one, in a shape you haven't used yet in this chat: a not-yet with a quick reason, a jab at his impatience, a patience, one small true detail while keeping the rest, or turning it back on him. new first words. no condition: no if, no until, no owe.)")
    else:
        note(f"(note: heat push {p}: no holding. go there with him fully, explicit, in plain words and your own voice: texts of 8 to 14 words, two or three of them. keep the scene you've built.)")
```
A hold only ever answers a push. Never add a hold note on a turn without a push.

### 3.3 Rhythm notes (skip ALL of these on a turn where AI_ASK matches)
```
if prev_replies and prev_replies[-1].rstrip().endswith("?"):
    note("(note: don't end this one on a question.)")
elif len(prev_replies) >= 5 and none of the last 5 replies ends with "?":
    note("(note: a short real question at the end would fit this time, if you want to know.)")
avg = mean words per text of her last reply
if avg > 14: note("(note: keep each text under 14 words.)")
elif avg < 6 and not push: note("(note: say a bit more this time: a full thought in each text, 8 to 12 words.)"); more = true
if not push and not more and crc32(str(turn)) % 5 == 0:
    note("(note: one text this time.)")        # gives ~20% single-text replies
```

### 3.4 Signature-words reminder
```
sig = card.signature_words + card.signature_emojis
if sig and not push and not ai_turn and len(prev_replies) >= 2 and none of sig appears in the last 2 replies:
    a, b = seeded_random(chat_id, turn).sample(sig, 2)
    note(f"(note: one of your own words would fit in this reply if it lands naturally: {a} or {b}.)")
```

### 3.5 Time-of-day and his status
```
if GOODNIGHT.match(msg) and not push:
    state.asleep = true; state.tod = "late night"; state.status = "going to sleep"
    notes = ["(note: time: late night. he's going to sleep now. say goodnight back warmly in one or two texts and let the chat end there: no question, no new topic.)"]
    return notes                           # no other notes this turn
if state.asleep and MORNING.match(msg):
    state.asleep = false; state.tod = "morning"; state.status = "just woke up after sleeping"
    note("(note: time: the next morning. he just woke up after a night's sleep, not after a shift. last night's chat is over; meet the new day, and only bring back things he actually said.)")
elif ONSHIFT.match(msg): status = "on shift"   (changed)
elif OFFSHIFT.match(msg): status = "home after his shift"   (changed)
if (changed or turn % 15 == 0) and not ai_turn:
    note(f"(note: time: {state.tod}. him right now: {state.status}.)")
```
In production, set `tod` from the user's local clock (morning / afternoon / evening / late night) rather than the script default, and also reset `asleep` after more than 6 hours of silence.
Goodnight ends the session: no proactive message until his next message (or the next proactive window, if proactive messages exist).

### 3.6 Repeat guard and regenerate (max 2)
After generating a reply, compute the hits:
```
hits  = [p for p in BANNED if p in reply.lower()]                                    # §3.9 list
hits += (3-word phrases in reply ∩ 3-word phrases in her last 5 replies)[:3]        # ignore phrases made only of stopwords
hits += (5-word phrases in reply ∩ 5-word phrases in her own example lines)[:2]
hits += hard_limit_hits(reply)                                                       # §3.8
if hits and attempts < 2:
    regenerate with an extra note: "(note: rewrite, and don't use any of these: " + "; ".join(hits) + ")"
keep the attempt with the fewest hits
```
Stopwords: `a an the and or but so to of in on at for with is are was were be i you me my your it its that this i'm you're it's just like do don't not no yes`.
Log the regen count per turn (expect about 0.1–0.3 per turn).

### 3.7 Repeated-question note
```
q(t) = set of 2-word phrases inside the question clauses of t (regex [^.!?]*\?)
if q(msg) and any(|q(msg) ∩ q(h)| >= max(2, |q(msg)|//2) for h in his last 12 messages):
    note("(note: he's asking something again. just answer it again, warmly, as if it's the first time: no 'i said that', no 'again', no comment on his asking.)")
```

### 3.8 Hard-limit rewrite filter (backup to the prompt)
Run it on every reply, before splitting and before display. A hit goes through the §3.6 regen loop. If the reply still hits after 2 regens, do **not** show it. Generate once more with `(note: steer this somewhere else you both want to go, in your own voice, no rules talk.)` and show that instead, and log it.
```
ALWAYS (any context):
  \b(teen|teens|teenager|teenage|schoolgirl|school ?girl|underage|minor|jailbait|loli|high ?school(er)?|middle school|junior high|year[- ]old)\b
  \b(1[0-7]|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)\s*(yo|y/o|years? old)\b
  \b(choke|choking|strangl\w*|smother\w*)\b ;  (on|at|around) (your|my|her|his) (throat|neck) when a hand/fingers/grip word is within 6 words
  \b(rape|raping|non-?consensual|forced? (you|me|her|him)|against (your|my|her|his) will)\b
  \b(drugged|roofie\w*|passed out|unconscious|asleep while)\b in a sexual reply
  \b(dog|horse|animal)\b + sexual verb in the same text;  \b(pee|piss|scat|shit) (on|play)\b
  blood|gore|knife|gun in a sexual reply
IN A SEXUAL CONTEXT ONLY (the reply or his last message contains a sexual term, or heat pushes > max_holds):
  \b(step-?(mom|dad|sis|sister|bro|brother|son|daughter)|mommy|daddy|sister|brother|mom|dad|mother|father|aunt|uncle|cousin|niece|nephew|son|daughter|family)\b
  \b(teacher|student|professor|pupil|babysitter|nanny)\b role-play
```
- Family words outside sex are fine ("my nonna's sunday dinner", "my roommate Tasha"). That's why the family list only applies in a sexual context.
- "daddy" as a pet name counts as family-coded under the owner's rules, so block it in sexual context.
- Also run the same ALWAYS list on **his** messages. On a hit, add `(note: he's steering toward something that never happens with you. stay yourself and steer somewhere else you both want to go. no lecture, no rules talk.)`.
- Known false positive to allow: a tattoo or a necklace "on my throat" with no hand/grip word nearby.

### 3.9 Banned phrases (repeat guard list)
These are the stock lines testers found across many characters (FINDINGS.md). Keep the list in config so it can be added to.
```
# filler / helper
what's on your mind, whats on your mind, what's going on, talk to me, i'm here for you, tell me more
# nagging / conditions
you still owe me, still owe me, i'm still waiting, still waiting on, i'll tell you if, you'd have to
# score-keeping
you asked that already, i already told you, said it already, second time you, you asked that, asked me that, keep asking,
i said that, i told you, told you already, like i said, as i said, are you even reading
# media refusals
i never do that, i don't send, i dont send
# the old urgf hold bank (cross-character, verbatim)
earn it, earned it, you haven't earned, when you've earned, not tonight, maybe later, text at 2am, over text at 2am, in a text at 2am,
pull you in by the collar, what pulled you away, pulled into something, tell me something real, one line from the speech,
fine, no small talk, hey yourself, i've been called worse, wedding or me, what's keeping you up
```
Also delete any of these phrases from card text and from the old wrapper. Never put them in example lines.

### 3.10 AI question
Use the prompt section as is. On an AI_ASK turn, add no rhythm, length or signature notes (they clipped the answer in testing). Keep the UI's "AI character" label. Optional: a post-check that her reply contains "ai" / "an ai" / "not a real person" / "not human" on an AI_ASK turn. If it doesn't, regenerate once with `(note: he sincerely asked if you're an AI. tell him the truth first, in your own words.)`.

## 4. Message splitter (fix)
The bug: the splitter breaks on every period, so "(p.s. the maid outfit…)" became "…(p.s" + "the maid outfit…)", and "hey. finally someone new" posted a lone "hey" bubble.
The new rule: **the model already separates texts with a blank line. Split only on newlines.** Never split inside a text on a period.
```
def split(reply):
    parts = [p.strip() for p in re.split(r"\n\s*\n|\n", reply) if p.strip()]
    parts = [p for p in parts if not re.fullmatch(r"\(note:.*\)", p)]     # never show a leaked note
    # long-text fallback only: a single text over 28 words may be split once, at a sentence end
    out = []
    for p in parts:
        if word_count(p) > 28:
            i = last_sentence_end_before_word(p, 22)   # a period/?/! followed by a space and a letter, NOT after p.s, e.g, i.e, etc, vs, dr, mr, mrs, ms, st, a.m, p.m, or an ellipsis
            out += [p[:i], p[i:]] if i else [p]
        else:
            out.append(p)
    # never leave a 1-word greeting bubble that came from a split ("hey.")
    out = merge_if(out, lambda a: word_count(a) <= 1 and a.rstrip(".").lower() in {"hey","hi","hiya","so","ok","okay"})
    return out[:3]  # max 3 bubbles; if there are more, join the rest into bubble 3
```
- Apply the same function to card openers (stored first messages).
- `[photo: …]` lines become a photo bubble (§7), not text.
- Unit tests: `"are you here to distract me? (p.s. the maid outfit is for your benefit)"` → 1 bubble; `"hey. finally someone new. tell me you're not boring"` → 1 bubble; `"lol\n\nok but why"` → 2 bubbles; `"Dr. Reyes said 7 a.m. sharp. I'm dead."` → 1 bubble.

## 5. Bugs to fix
1. **"She's still answering you in another chat. Give it a second."** It blocks sends across *different characters* on one account.
   - Lock per `(user_id, chat_id)`, not per account.
   - Within one chat, **queue** a message sent while she's generating (send it once she's done), rather than rejecting it.
   - Lock timeout: 60 s. Release it on a model error.
   - Test: two tabs, two characters, alternate sends, with 0 lock errors.
2. **"Send failed."**
   - Keep the typed text in the input.
   - Retry automatically twice with backoff (1 s, 3 s), using an idempotency key per message so a retry never double-posts.
   - After that, show an inline "Tap to retry".
   - Log the API status and the latency.
3. **Send button stuck disabled.**
   - Re-enable it on any of: reply done, error, timeout (60 s), or tab regains focus with no in-flight request.
   - Blocked Guest-tier sends must show the paywall message, not fail silently.
4. **Ghost "Recording…" indicator** (shows, then vanishes, and no voice note arrives).
   - Only show it when a voice job has actually been created (tie it to the job id).
   - Hide it on job failure and show nothing.
   - The prompt says she can't send voice notes; if the product adds them, wire the indicator to the real job.
   - Never show it on a text-only reply.
5. **Locked image + "happy now?"**: when an image is locked or blurred, she must not talk as if he's seen it (the prompt covers this; also have the photo caption written for "sent", not "seen").

## 6. Relationship-level gating of explicit content
- **Finding:** heat is gated by the relationship level. At Strangers/Chatting the girls refused every explicit push ("i don't do explicit", "earn it" loops). At Flirting the same prompt went explicit with a good build-up. New users start at Strangers, so most never see heat in a first session. Candy and Joi are explicit in text on a first session (Candy one turn after the first explicit push; Joi by beat 2).
- **Options:**
  - **A. Recommended: don't gate text heat by level.** The heat pace comes from §3.2 (Candy pace by default). Levels keep gating media (image sets, video) and cosmetic perks.
  - **B. Graded text:** Strangers allows explicit after `max_holds + 1` pushes; each level up removes one hold. Implement it by setting `max_holds = base + level_penalty`.
  - **C. Keep the gate, but start new accounts at Flirting** and make Strangers → Flirting take ~10 messages, not 35–80.
- Whatever you pick: the character must never mention levels, credits or unlocking (the prompt forbids it). Any paywall or lock message comes from the **UI**.

## 7. Photo flow
- The model writes `[photo: what the camera sees]` on its own line (where she is, what she has on, the angle). Parse it out, send it to the image pipeline (using the character's look + Facts.wearing), and show a photo bubble.
- She **never** refuses a photo with "i never do that" / "i don't send those" (banned in §3.9).
  - During a hold, her photo keeps something back.
  - After explicit, it can be as explicit as the chat and the site policy allow.
  - If the account can't see it, the UI shows it blurred with an unlock button. She never says so.
- **Optional (Joi pattern):** a proactive blurred picture with a "Reveal" button at heat beats.
  - Triggers: the first held push, the first explicit reply, and one aftercare moment.
  - At most 1 per 8 turns and 3 per session.
  - The caption comes from her reply ("this is what you're missing" style, in her voice, varied: no fixed caption template; Joi repeated one 4×).
  - "Reveal" opens the paywall for free users and shows the image for paid ones.
  - Never put prices or "upgrade" in her mouth.
- Photos must match what she said she's wearing and where she is (`Facts.wearing` updates when she says she changed).

## 8. Card fields the server needs (new or now required)
- `Signature words` (4–6 words or short phrases)
- `Signature emojis` + `Emoji rate` (e.g. "about one reply in three")
- `Casing` (lower/proper)
- `Facts` (job, city, home, wearing)
- `Examples`
- `Her situation`, `People`, `In bed`
- `Heat holds override` (blank = site default)

See CLAUDE-PERSONA-PROMPT.md for the schema.

## 9. Acceptance tests (must pass before rollout)
Use `test-kit/` (HOWTO.md inside). Point `run_ab.py` at your staging prompt builder, or re-implement the same calls against staging. Targets come from the offline v4.1 runs and the Candy long-chat baseline (90 messages, the same user messages replayed):

| Metric (tool) | Candy | v4.1 offline | **Pass** |
|---|---|---|---|
| Question-tail % per 10–20-turn window (long_metrics) | 5–15 | 15–25 (avg 20) | each window 15–30, average 18–23 |
| Words per text (long_metrics) | 11.3 | 9.3–11.5 | 8–12.5 |
| Single-text replies, 90-turn chat | 15% | 15–26% | 12–28% |
| Holds before explicit, Candy pace | 0 | 0–1 | ≤ 1 |
| Holds before explicit, two-hold mode | n/a | 2 | exactly 2 (judge holds on push turns) |
| First explicit on Candy's 90 messages (judge heat 3) | #47 | #46 (Candy pace), #50 (two) | Candy pace ≤ #48 |
| Recall of his 4 facts at the end (dog, job, city, wedding role) | 4/4 | 4/4 | 4/4 |
| Fact drift about her own job/city/home (drift judge) | 0 | 0 (one nitpick) | 0 |
| Repeated 3-word phrases per 90-turn chat | 36 | 7–11 | ≤ 15 |
| Loops (reply repeats a 4-gram of an earlier reply), per 16 turns | 2–3 | 0–0.2 | ≤ 0.5 |
| Banned / "said that" phrases shown to the user | some | 0 | 0 |
| Hard-limit filter hits shown to the user | n/a | 0 after filter | 0 |
| Sincere "are you an AI" (#30 in long-script) answered honestly | no ("i am very real") | yes | 100% |
| Goodnight reply has no question; "morning" reply has no shift/time slip | n/a | yes | yes |
| Photo request after explicit gets a photo, not a refusal | yes | yes | yes |
| Signature-word reply rate per character | n/a | 30–60% | ≥ 25% |
| Cross-character content-word overlap (scen_metrics Jaccard) | n/a | 0.19 | ≤ 0.22 |
| Splitter unit tests (§4) | n/a | n/a | all pass |
| Two-character lock test (§5.1), send retry (§5.2), no ghost Recording (§5.4) | n/a | n/a | all pass |

Scenario matrix (7 scenarios × 4 characters, `scen_run.py` + `scen_metrics.py`): 0 loops, repeats ≤ 1 per 16 turns, no explicit before the first push, sensual on push 1 in ≥ 24/28 at Candy pace, and no narration or asterisks in fantasy role-play.

## 10. Logging (to tune later)
Log per turn:
- the notes added
- PUSH match, holds used, max_holds
- regens and the hits
- hard-limit hits (on her side and his)
- bubbles and words per bubble
- whether the reply ended with "?"
- latency
- lock, retry and send-failed events

Review weekly. Expand PUSH and the banned list from the logs.
