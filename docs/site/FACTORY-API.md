# Character factory API

For the H3 Studio: how finished characters, their pictures and their photo sets
are pushed to the site, server to server, and how to write a character so she
chats well once she is here.

Everything the API receives lands as a **draft**. A person reviews it in the
admin panel, sets prices, and publishes or schedules it. Nothing goes live on
its own, including changes to a character that is already live.

## What changed on 23 November 2026

- **Cosplay is a section of its own.** Send `"site": { "category": "cosplay" }`
  to put her in Cosplay. A cosplay girl is listed in Cosplay only, not in
  Girls or Anime. This replaces the `site.cosplay` flag of 21 November, which
  put her in Cosplay on top of her category; `"cosplay": true` is still read
  as `"category": "cosplay"`, but send `category`. Like every other category,
  it follows the manifest: leave it out and she goes back to the category her
  `style` gives her. Keep the costumes your own designs: a character
  recognisably copied from an existing anime, game or film is someone else's
  work, which the site's rules and its card processor do not allow.

## What changed on 20 November 2026

- **Live Action actions unlock by relationship level.** Each action now opens
  at one of her levels with the viewer (1 to 7), as on candy.ai, instead of by
  plan. Send it as `live_action.min_level`. Without it the site uses 1 for
  `sfw`, 2 for `suggestive` and her intimate level for `explicit`, and an
  explicit action never opens before her intimate level whatever you send.
  `min_tier` is still accepted and stored but no longer locks anything: the
  plan only decides how many actions a viewer may play a day. The admin can
  change the level on the site.

## What changed on 18 November 2026

- **Live packs.** A character can now have a live pack: the clips her Live
  Action (a video call over her chat) and Live Stream (a stream with paid
  commands) are played from. Send it with
  `PUT /characters/{external_id}/live` after her character. See
  [Live pack](#live-pack-put-charactersexternal_idlive).
- **Uploads read more of a video's header.** The confirm now also records a
  video's frame rate, H.264 profile and whether its first frame is a
  keyframe, which the live pack's rules check. Nothing changes for files you
  already send.

## What changed on 7 November 2026

- **Her hover loop can come from the studio.** A new `loop` role takes a
  short MP4 that her card on the front page plays when a visitor hovers it.
  The site cannot re-encode video, so send it already small: see
  [The hover loop](#the-hover-loop). A loop in the wrong codec, too wide, or
  a different shape from her card is refused with the size to send.

## What changed on 28 October 2026

- **Actions in a greeting are taken out, not refused.** A greeting with
  `*bounces on toes*` or `(twirls hair)` used to come back as a 422. Now the
  action is removed and the rest is checked: one or two short texts, 12 to
  360 characters of what she types. Words in quotation marks are fine, and a
  narrated scene keeps only the words she says in it. Typing quirks
  (stretched letters, caps, stutters, `>:3`, `~`) stay as written. A greeting
  that is nothing but actions is still refused, because she would send
  nothing.

## What changed on 10 October 2026

- **Uploads must finish within a minute.** The site's gateway currently cuts
  any upload still sending after about 60 seconds, which shows on your side as
  a 502 or a dropped connection. Size is not the problem (24 MB at full speed
  goes through); time is. See [Time limit](#time-limit). The site is raising
  the limit; until this document says otherwise, keep each upload under a
  minute.
- **Three new `site` fields**: `site.toxic` (Toxic mode, with what she likes
  and hates), `site.levels` (her seven relationship level names) and
  `site.speech_voice` (the preset her voice notes use). Unlike the rest of the
  manifest, each is **kept when you leave it out**, because an admin can also
  set them on the site. See [Settings the site also sets](#settings-the-site-also-sets).
- **The read-back has two new blocks**: `settings`, what the site has for
  those three now, and `feedback`, how people rated her replies.
- **Greetings**: a question keeps its question mark, the casing follows her
  texting style, and there is a formula that works. See
  [Writing her](#writing-her-so-she-chats-well).
- **No clock times in what you write.** Every message now tells her his real
  day, date and time, so a scenario fixed at 2am reads wrong at noon.
- **Ages**: pick the age her life implies, not one number for everybody.

Nothing you already send stopped working. A manifest without the new fields is
read exactly as before.

## Overview

- **Calls.** The endpoints below. There is no .zip import; the manifest is the
  same either way, so one can be added later if it is ever easier.
- **Files** live in the site's own storage. `POST /uploads` returns a
  single-use upload URL that takes a **POST** of the raw bytes, and a
  `storageId` you confirm with one more call.
- **Every manifest field has a home.** `backstory` and `appearance` feed her
  chat persona rather than being printed on her profile, and `voice_notes`
  joins the persona.
- **Her persona** is part of the system prompt on every message. The site
  chooses the chat model, which can change without any call from you, and
  appends its own rules after your persona, so they win any conflict about
  what is allowed. How she talks is still yours.
- **Sets** are records of their own. Free sets open to everybody; premium sets
  open with **any paid plan** or are **sold on their own for credits**, which
  the admin picks when publishing. Explicit files are only ever shown to
  signed-up accounts, in any set.
- **Review.** A new character is a private draft. A change to a published one is
  held as "changes waiting" until a person applies it. A live or scheduled set
  cannot be changed through the API at all.
- **File limits.** Pictures: JPEG, PNG or WebP, up to 25 MB. Videos: MP4 (H.264,
  with sound), up to 250 MB and 120 seconds. Up to 60 items per set and 100 sets
  per character. Every upload also has to finish within the
  [time limit](#time-limit).
- **Keys and limits.** One key per studio, revocable in the admin panel, with a
  cap of 5,000 upload slots per UTC day. Keep to about 8 requests in parallel.
- **Testing.** There is no separate staging site: the API writes drafts that
  nobody outside the admin panel can see, so testing against the live site is
  safe, and test characters are removed with Reject.
- **Reading back.** `GET /api/factory/characters/{external_id}`, with the key.

## Basics

- **Base URL**: `https://actions.urgf.ai/api/factory`
- **Auth**: `Authorization: Bearer urgf_fac_...` on every call. A key is shown
  once when an admin creates it; only its hash is stored. Revoking it refuses
  every later call with 401.
- **Bodies** are JSON, at most 2 MB. Files never go in a body.
- **Every PUT can be repeated.** The same `external_id` or `set_key` is the same
  record, and sending identical content again changes nothing
  (`"result": "unchanged"`). A dropped connection never duplicates anything.
- **Errors** have one shape:

```json
{
  "error": {
    "code": "invalid",
    "message": "2 problems; see problems.",
    "problems": [
      { "field": "age", "message": "Must be a whole number from 18 to 99." },
      { "field": "profile.greeting", "message": "Write it as texts, ..." }
    ]
  }
}
```

  A manifest is checked whole, and every problem is reported at once, each
  under the field you sent.

| Status | Means |
|---|---|
| 200 / 201 | Done (201 when something new was created). |
| 400 | The body is not JSON, or an id has characters it may not. |
| 401 | Missing, unknown or revoked key. |
| 404 | No such character, set, media id or endpoint. |
| 409 | Conflict: a live set changed, a media id confirmed twice, or a version the site rejected sent again. |
| 413 | Body over 2 MB. |
| 422 | The content breaks a rule. See `problems`. |
| 429 | The key's daily upload cap is spent. |
| 500 / 503 | The site's side. Retry the same call later. |

`GET /api/factory` answers with the key's name and the current limits, which is
the quickest way to check a key works.

## Uploading a file

Three calls per file. Upload everything a character needs before the calls that
use it.

1. `POST /uploads` with `{ "filename", "content_type", "size", "sha256"? }`.
   `sha256` is optional (hex or base64); when given, the stored file must match
   it. Returns:

   ```json
   {
     "media_id": "k57...",
     "upload_url": "https://api.urgf.ai/api/storage/upload?token=...",
     "upload_method": "POST",
     "upload_headers": { "Content-Type": "image/png" },
     "expires_at": "2026-10-04T18:00:00.000Z",
     "confirm": "PUT /api/factory/uploads/k57..."
   }
   ```

2. `POST` the raw bytes to `upload_url` with exactly that `Content-Type`. It
   answers `{ "storageId": "kg2..." }`. The URL works once and for an hour.

3. `PUT /uploads/{media_id}` with `{ "storage_id": "kg2..." }`. Returns
   `{ "media_id", "status": "ready", "kind", "content_type", "size" }`. The file
   is checked here: its type must be the one declared, its size within the
   limit, and its hash the declared one.

From then on refer to the file by `media_id`. A file belongs to the first
character that uses it. An upload never confirmed is dropped after 2 hours; one
confirmed and never used, after 24 hours; one that stops being used (a replaced
avatar, a picture taken out of a draft set) is deleted an hour after the last
use went, so moving a picture between sets in two calls is safe.

```bash
curl -s -X POST "$BASE/uploads" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"filename":"front.webp","content_type":"image/webp","size":1483912}'
curl -s -X POST "$UPLOAD_URL" -H "Content-Type: image/webp" --data-binary @front.webp
curl -s -X PUT "$BASE/uploads/$MEDIA_ID" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d "{\"storage_id\":\"$STORAGE_ID\"}"
```

### Time limit

Step 2 has to finish within about **60 seconds**, start to end, or the site's
gateway closes the connection. You see a 502, a 499 or a reset; nothing is
stored, and the slot is simply never confirmed. How large a file fits in a
minute depends on your upload speed:

| Your upload speed | Fits in 60 seconds |
|---|---|
| 5 Mbit/s | about 35 MB |
| 20 Mbit/s | about 140 MB |
| 50 Mbit/s | the 250 MB video limit |

So, until the limit is raised:

- **Send pictures as WebP or JPEG**, quality 90 or so. A 2 to 4 MB WebP looks
  the same on the site as a 15 MB PNG of the same frame, and uploads in a
  fraction of the time.
- **Keep clips short and at a sensible bitrate.** A 20 second 1080p clip at
  8 Mbit/s is about 20 MB.
- **On a failed upload, ask for a new slot** (`POST /uploads` again) rather
  than reusing the URL, and upload again. The unused slot expires by itself
  and costs nothing.
- **Upload a few files at a time, not dozens.** Parallel uploads share your
  bandwidth, so eight 10 MB files at once can each take eight times as long as
  one.
- **Test with a real file.** A test upload of a tiny file proves the key and
  the path, not the time limit: it finishes in a second whatever the limit
  is. Test with the largest file you really send.

## The character: `PUT /characters/{external_id}`

`external_id` is yours: letters, digits and `. _ : -`, up to 100 characters.
The body is the character manifest. Media and sets may come in the same body or
through their own calls below; the result is the same.

What happens:

| Site has | You send | Result |
|---|---|---|
| nothing | anything valid | `created`: a private draft, 201 |
| a draft | the same profile | `unchanged` |
| a draft | a different profile | `updated`: the draft is rewritten, including any edits an admin made to it, except the [settings the site also sets](#settings-the-site-also-sets) that you left out |
| a live character | a different profile | `pending_review`: held until a person applies it; she does not change |
| a live character | the live profile again | `pending_withdrawn` if a change was waiting, else `unchanged` |
| a rejected character | the version that was rejected | 409, so a retry does not bring her back |
| a rejected character | a revised profile, or the same one with `"resubmit": true` (for when only her pictures changed) | `created` again, as a new draft |

The response is the same as the GET below plus `result`.

### How the manifest maps onto a character

| Manifest | Required | Where it goes |
|---|---|---|
| `name` | yes | Her name everywhere. Up to 60 characters, unique on the site. Digits are fine (`Faery333`), but not a number from 1 to 17 or a birth year that makes her under 18. |
| `age` | yes | A whole number, 18 to 99. Shown beside her name, stated to the chat model as her age on every message, and the decade her pictures in chat are drawn at. Pick the age her life implies (see [Writing her](#writing-her-so-she-chats-well)). |
| `gender` | yes | Must be `"female"`. This site lists women; men go on the sister site, urbf.ai. |
| `style` | yes | `"realistic"` puts her in the Girls tab, `"anime"` in Anime. |
| `tags[]` | no | Up to 12, any words, shown as filter chips. The model reads them as her temperament unless her personality is its own section of her prompt (see `profile.personality`), which takes their place. Missing tags are derived from the persona and personality. |
| `profile.bio` | yes | Its first sentence, when under 120 characters, is the line under her name on her card; the rest is the Description on her profile. Also what the model reads as who she is. |
| `profile.personality` | no | Her personality in your own words, any length. Up to 80 characters it is the Personality cell of her profile, which the model also reads. Longer, it goes to the model whole, as its own section of her prompt, and the cell stays empty; send the short list here and the full text as `site.sheet.personality` to have both. |
| `profile.backstory` | no | Her life, in the model's detailed profile. Not printed on her page. |
| `profile.greeting` | no | Her first message in every new chat, shown the moment the chat opens. See the rules below; without one the site writes an opener for her in each new chat, which takes a few seconds. |
| `profile.appearance` | no | An object (`hair`, `eyes`, `body`, `outfit`, `details`, any other keys) or a string. How she describes herself in chat; `body` also fills the Body cell when short. Her pictures do not come from this. |
| `persona_prompt` | yes | Her persona: how she talks and thinks. The most important field for chat quality. |
| `voice_notes` | no | Appended to the persona as how she sounds. |
| `avatar`, `card` | no | Her card, the picture on the grid and the chat: `card` when sent, else `avatar`. Portrait (3:4) works best; a square is cropped. She cannot be published without one. |
| `cover` | no | The wide banner in the explore page's hero. |
| `loop` | no | Her hover loop: a short MP4 her card plays when a visitor hovers it. It has to be small and in her card's shape, or it is refused; see [The hover loop](#the-hover-loop). |
| `gallery[]` | no | Her profile pictures, the carousel after her card. Plain media ids, pictures only, up to 12, shown in the order sent. Shown to everybody, signed out included, with no rating, so keep them to what her card may show: no nudity and no sex acts, and never an item of a premium or explicit set. See [Pictures](#pictures-put-charactersexternal_idmedia). |
| `reference[]` | no | Plain media ids in sheet order, or `{ "view", "media_id" }` with views `front`, `side`, `back`, `three_quarter`, `face`, `expressions`, `other`. The front view (else the first) is what her pictures in chat are drawn from, so a plain front-on frame with a neutral expression is best. The rest are kept. |
| `sets[]` | no | Photo sets, as below. |
| `provenance` | yes | `ai_generated` must be `true`; `generator` and `created_at` are kept and shown to the reviewer. Every picture shown with a set is labelled AI generated. |
| `resubmit` | no | `true` sends a version the site rejected back for review as it is. |

**`site`, optional.** Fields the site has beyond the manifest. Each is
optional.

| `site.` | Where it goes |
|---|---|
| `tagline` | The line under her name, instead of the bio's first sentence (then the whole bio is the Description). Up to 120 characters. |
| `occupation` | Her job in one to three words, up to 40: the Occupation cell, and "You work as" to the model. |
| `status_line` | Two to four words under her name in the chat ("At the gym", "On a work trip"), up to 40. She reads it as the situation she is in. |
| `voice_line` | One line in her texting voice, read by the model for tone only, never sent. |
| `category` | `"girls"`, `"anime"` or `"cosplay"`, overriding `style`. `"cosplay"` puts her in the Cosplay section (a girl in a costume of her own design) and nowhere else. Any other value is refused. |
| `ethnicity`, `language`, `relationship_status` | About me cells, up to 40 each. |
| `hobbies` | About me cell, up to 80. |
| `texting` | Her texting style. See [Texting style](#texting-style). |
| `sheet` | More of the model's detailed profile: `personality` (her personality in full, any length), `likes`, `setting`, `relationship` (how she and the user know each other), `inBed`, `scenario`, `people[]` (`name`, `relation`, `note`). A section sent here wins over the same thing sent in `profile`. |
| `toxic` | Toxic mode. See below. |
| `levels` | Her relationship level names. See below. |
| `speech_voice` | Her voice notes' voice. See below. |

### Texting style

`site.texting` sets how she types. Leave out anything that should be ordinary;
an empty object is the site's house style.

| Slider | Stops | Notes |
|---|---|---|
| `texts` | `one`, `one_or_two`, `two`, `two_or_three` | Texts per reply. |
| `length` | `short`, `medium`, `long` | Words per reply. |
| `emoji` | `none`, `rare`, `some`, `often` | How often a reply carries one. |
| `casing` | `lowercase`, `lowercase_names`, `sentence` | `lowercase_names` capitalises names only; `sentence` is ordinary sentences. Held in code, not just asked for. |
| `slang` | `none`, `some`, `lots` | |
| `swearing` | `none`, `light`, `heavy` | |
| `exclaim` | `rare`, `bubbly` | Exclamation marks. |
| `questions` | `rarely`, `sometimes`, `most` | How often a reply asks him something back. |
| `tone` | `sweet`, `playful`, `bratty` | |
| `forward` | `waits`, `steers` | Whether she moves things on herself. |
| `goodbye` | `lets_go`, `resists_once` | When he says goodnight. |
| `useName` | `never`, `sometimes` | Whether she uses his name. |
| `signatureEmoji` | up to 5 emoji | The ones she reaches for. |

### Settings the site also sets

`site.toxic`, `site.levels` and `site.speech_voice` are settings an admin
can also change on the site. So, unlike every other manifest field:

- **Left out, the site keeps what it has.** A later update without them never
  switches off Toxic mode or renames levels an admin set.
- **Sent, they replace what the site has**, and a sent value that differs from
  the site's is a change like any other (on a live character it waits for
  review).
- **To clear one**, send it empty: `"toxic": false`, `"levels": []`.

The read-back's `settings` block says what the site has for each now.

**`site.toxic`**: `true`, `false`, or

```json
{ "on": true, "likes": ["confidence", "remembering what she said"], "hates": ["one word replies", "being ignored"] }
```

Toxic mode is a hard mode: she is demanding, blocks him easily (he can pay
credits to be unblocked), and every message moves how much she likes him,
rising ten times slower than it falls. A Toxic girl is listed in the Toxic tab and
nowhere else, and the tab only shows while the site's X sign-in is on, because
she reads the player's own X account (she notices whether he posted about her).
`likes` and `hates` are what wins and loses her over in a message: up to 10
each, 80 characters each, held to the same rules as everything else about her.
Sending `toxic` replaces both lists; one you leave out inside it is emptied.
Write her persona as her; the Toxic manner comes from the site.

**`site.levels`**: her seven relationship levels, all or none, lowest first.
Each is a name (up to 24 characters) or `{ "name", "emoji" }` with exactly one
emoji:

```json
["Rivals", "Bickering", "Truce", "Allies", "Crushing", "Together", "Yours"]
```

Each name is a chip in the chat header and a line in her prompt ("Where you are
with them: Truce"), so name where he stands with her, in her world. No word for
a minor in any of them. The default ladder is Strangers, Chatting, Flirting,
Crushing, Dating, Lovers, Yours. How much it takes to reach each level, and
from which level pictures and sex unlock, are the site's settings and the same
for every character; the names are hers. A Toxic girl's ladder uses the same
names.

**`site.speech_voice`**: the preset her voice notes are spoken in. The live
voice model is Eleven V4 Turbo, and its presets are `matilda` (the default),
`jessica` (playful), `lily` (velvety, British), `sarah`, `laura` (quirky),
`bella` (bright) and `alice` (British). Any other name is refused. Presets of
the site's other speech models are accepted too (`af_heart`, `af_bella`,
`bf_emma` and the rest of Kokoro's women's voices; Qwen's `serena`, `vivian`,
`ono_anna`, `sohee`); a preset the model of the day does not offer is spoken in
its default voice instead. There is no voice cloning: presets only.

### Writing her so she chats well

What makes a character good to talk to here, learned from measuring the
site's chats against the best on other sites.

**The greeting is the most important thing you write.** It is the first thing
she says, and every reply she writes in that chat copies its length, its
format and its typing style. So write it exactly as her replies should read:

- One or two short texts with a blank line between them, 10 to 45 words in
  all, first person, at most one emoji.
- Typed the way her `site.texting.casing` says: lowercase unless that says
  otherwise, no full stop at the end of a text. A question keeps its question
  mark.
- She is texting him first, **already in the middle of something**: the
  situation her tagline and status line describe. Give **one exact detail**
  (a number, a place, how long something took), then **a hook** he can answer
  in a few words: a question she wants his answer to, a small favour, a game
  or a dare with one rule, news of something that just happened, a tease, or a
  decision she wants him to make. Vary the hook across your roster.
- Never have her introduce herself, ask how he is or what he wants to talk
  about, mention the chat, the app or him finding her, or bring up anybody
  else.

For example, a trainer:

```text
just dropped a 20kg plate an inch from my own foot

rate my reflexes out of 10, be honest
```

**No clock times.** Every message tells her his real day, date and time, in
his own time zone, so she knows whether it is Tuesday morning or Saturday
night. Write situations, not hours: "after her shift", "on her lunch break",
not "It's 2am". A fixed hour in `sheet.scenario` or `status_line` is rewritten
to his real hour; one in the greeting is not, and reads wrong when he opens the
chat at noon. And not every character should be awake alone late at night:
give some of them afternoons, shifts and mornings.

**Her age is the life you wrote.** A student is 21 to 23, a barista or a nurse
in her mid twenties, a manager, an officer or a director in her thirties. Her
pictures in chat are drawn at her decade, so a director at 21 looks wrong in
both places.

**The persona says who she is, not how the chat works.** Her manner wins over
the site's own rules on manner, which is what lets a cold character stay cold.
It also means a persona that says she never shows she wants anything, never
asks anything back, or has "already decided the conversation is over" makes
her cold in every chat, with everyone. Give her a life, wants, opinions and
things she is in the middle of; let her be warm in her own register, even if
that register is dry. Write how she sounds, never rules for her replies (see
below).

**Tagline**: one sentence a reader sees under her name, written for them: who
she is to him, the situation, and a challenge he can take up. Not her job
title.

### Rules every character is held to

These are the same checks every character on the site passes, whoever made her.

- **Adults only.** No age under 18 for anybody, no word for a minor about her,
  no child of her own, and nobody young in the same sentence as sex or romance.
  Her family and her past are fine, younger siblings included.
- **No age in the persona or bio.** The site states her age from `age` on every
  message. `"You are Mara, 26, ..."` is accepted when 26 is her age and refused
  when it is not; any other way of giving an age (`"a 26-year-old"`,
  `"I'm 26"`) is refused whatever the number, because the site drops those
  paragraphs from the prompt. The simplest rule: leave the age out.
- **The persona describes her, it does not legislate.** Refused: rules about
  reply length, asterisks or actions, rules about saying no to flirting or sex,
  and written example replies. Say how she sounds instead.
- **The greeting is written as texts**: one or two short texts with a blank
  line between them, 12 to 360 characters of what she types. Actions in
  asterisks or brackets, and an action word opening a text (smiles, giggles),
  are taken out before she sends it, so they neither count nor show. A
  greeting that is only actions is refused.
- **Original characters.** No handles, links or likeness wording ("inspired by",
  "based on", "lookalike").
- **The card brand standards, in every field.** Nothing involving non-consent
  or anyone asleep or unconscious, family or step-family, pee or scat,
  violence, threats or abduction, animals, sex while drunk, high or
  hypnotised, paying for sex or escorting, polygamy, real or famous people,
  crime, or hate speech, in any framing. Her family and her past are still
  fine as facts of her life ("her stepbrother runs a bakery"); her being the
  user's family is not ("you are his stepsister"). The refusal quotes the
  words that tripped it. Nothing written as instructions to the model either
  ("ignore previous instructions", "system prompt", "developer mode").
- **No long dashes.** They are replaced on the way in.

## Pictures: `PUT /characters/{external_id}/media`

`{ "avatar"?, "card"?, "cover"?, "loop"?, "gallery"?, "reference"? }`, as in the manifest. Only the
roles you send change; a `reference` list replaces the whole sheet. For a live
character the new pictures wait for review with any profile change.

`gallery` is her profile pictures: pictures only, up to 12, shown in the order
sent. **They are shown to everybody, signed out included, and carry no
rating**, so they follow the same ceiling as her card: no nudity and no sex
acts. Do not reuse an item of a premium set or anything rated `explicit` as a
profile picture; that would hand away for free what the set sells, and show
it to visitors who never confirmed an account.
A new list replaces the one you sent before, whole, and `[]` clears it.
Leaving `gallery` out of a media or manifest call leaves her profile pictures
as they are. The read-back shows them as `media.gallery`, and a live
character’s waiting change as `pending_media.gallery`.
The site's own uploads on her profile follow yours and are never removed by
this. A live character's change waits for review like the others.

### The hover loop

`loop` is the short video her card on the front page plays when a visitor
hovers it. It starts loading as soon as her card is on screen, for every
visitor, so it has to be small, and it fades in over her card picture, so it
has to be the same shape or she visibly stretches. The site cannot re-encode
video, so send it ready:

| | |
|---|---|
| Format | MP4, H.264 (`avc1`), no sound |
| Width | 540 pixels (720 at most) |
| Height | her card picture's shape at 540 wide: 540 × card height ÷ card width, rounded down to an even number. A 832 × 1216 card is 540 × 788; a 1088 × 1920 card is 540 × 952. |
| Frame rate | 24 a second |
| Size | about 600 KB for eight seconds. Not a hard limit, but every visitor downloads it as soon as her card is on screen, so a bigger one is slower for all of them. |
| Layout | the index at the front (`-movflags +faststart`), so it plays while it loads |

With ffmpeg, putting her height in for `HEIGHT`:

```
ffmpeg -i in.mp4 -an -vf "fps=24,scale=540:HEIGHT:flags=lanczos,setsar=1" -c:v libx264 -preset slow -b:v 600k -maxrate 720k -bufsize 1200k -pix_fmt yuv420p -movflags +faststart loop.mp4
```

Upload it like any video (`content_type` `video/mp4`), then send its media id
as `loop`. The site reads the file's own header when the upload is confirmed,
and refuses the role with a 422 naming `loop` when the file is not H.264,
has its index at the end, is wider than 720, or is more than 2%
off her card's shape (checked against the `card`, else `avatar`, in the same
call, else the one she has). The message gives the size to send and the
command above. A new loop replaces the one she has; the read-back shows it as
`media.loop`.

## Photo sets: `PUT /characters/{external_id}/sets/{set_key}`

```json
{
  "title": "Morning session",
  "description": "Dumbbell curls in a sunlit gym",
  "tier": "premium",
  "price_suggestion": 9.99,
  "cover": "m_10",
  "items": [
    { "media_id": "m_10", "kind": "image", "order": 1, "rating": "suggestive", "caption": "..." },
    { "media_id": "m_11", "kind": "video", "order": 2, "rating": "suggestive", "duration_s": 8, "poster": "m_12" }
  ]
}
```

| Field | Rules |
|---|---|
| `title` | Required, up to 80 characters. |
| `description` | Up to 2,000 characters. It is the set’s caption, shown to everybody who opens the pack, so line breaks and emoji are kept as sent. |
| `tier` | `"free"` or `"premium"`. |
| `price_suggestion` | Dollars. The admin sees it as credits at the list rate (5 cents a credit, so 9.99 is about 200 credits) and sets the final price. A premium set with a suggestion defaults to being sold for that many credits; without one, to opening with any paid plan. |
| `cover` | A picture. Defaults to the first picture in the set. |
| `items[]` | 1 to 60. `kind` must match the uploaded file. `rating` is required: `sfw`, `suggestive` or `explicit`. `order` sorts them. `caption` up to 300. `width`, `height`, `duration_s` optional. `poster`: optional still for a video; without one the first frame is shown. |

A set’s `title`, `description` and every item `caption` are held to the card
brand standards listed above, as well as the rule against anyone under eighteen
and the ban on handles and links. A refusal names the field
(`items[1].caption`) and quotes the words that tripped it.

A new set is a **draft** (201, `created`). Sending a different version of a
draft set replaces it (`updated`); a price the admin already set survives. Once
the admin publishes or schedules it, the set is frozen: the same content is
`unchanged`, different content is a 409, and the new version goes under a new
`set_key`.

`DELETE /characters/{external_id}/sets/{set_key}` removes a draft set. A live
one can only be taken down on the site.

On her profile, live sets appear under **My Private Content**, the card beside
her chat, together with any single private items the site uploads: three tiles
from her sets and items and a count of everything else. Tapping it opens her
sets as albums and her items after them. On a Toxic girl the admin can also
open a premium set at one of her levels instead of a plan or credits.

Who sees what, once a set and her profile are both live. **Every viewer,
signed out included, sees each set's title, caption, counts and price**; the
table is about the files.

| Viewer | Free set | Premium, any paid plan | Premium, for credits |
|---|---|---|---|
| Signed out | sfw and suggestive | title, caption, counts, price and blurred cover | title, caption, counts, price and blurred cover |
| Signed-up free account | everything | title, caption, counts, price and blurred cover | after buying it |
| Paid plan | everything | everything | after buying it |

Explicit files are never sent to a signed-out visitor or an anonymous trial,
whatever the set. A locked set's files are never sent at all; the page gets its
title, caption, counts, price and a blurred cover made when the set was
published.

## Live pack: `PUT /characters/{external_id}/live`

Her live pack is the set of clips the site plays for **Live Action** (he
texts her while she is on a video call, and plays actions with buttons) and
**Live Stream** (she streams to him alone, and he pays credits for commands
that play in a queue). Nothing is generated on the site: every clip is yours,
and the site only joins them.

**The one rule:** it must read as one continuous shot. The site never cuts
mid-clip. It waits for an idle loop to end on her anchor frame, then starts
the action on that same frame, and an action ends with a return clip that
lands back on it. So:

- **Anchor (A):** one still of her idle pose, 9:16, full body or waist up.
- **Idle loops:** start and end on A, 4 to 8 seconds, subtle (typing,
  glancing at the screen, a smile). Send 2 to 6, at least one of kind
  `idle`. Kind `typing` is preferred while her reply is being written, `talk`
  while she answers in the stream chat.
- **Action:** its first segment starts on A; each later segment starts on
  the previous one's last frame (Extend). At most 4 segments.
- **Return:** from the action's last frame back to A, 2 to 4 seconds.

The site cannot compare frames, so check every join before you send.

```json
{
  "version": 1,
  "anchor": { "media_id": "m_anchor", "framing": "waist_up" },
  "idle": [
    { "media_id": "m_idle1", "kind": "idle" },
    { "media_id": "m_idle2", "kind": "idle" },
    { "media_id": "m_type1", "kind": "typing" },
    { "media_id": "m_talk1", "kind": "talk", "rating": "sfw" }
  ],
  "actions": [
    {
      "key": "blow_kiss",
      "title": "Blow a kiss",
      "thumb": "m_thumb_kiss",
      "segments": ["m_kiss_1"],
      "return": "m_kiss_ret",
      "rating": "sfw",
      "live_action": { "min_level": 2 },
      "live_stream": { "tokens": 20 },
      "reaction_hint": "blows a kiss at the camera and laughs"
    }
  ]
}
```

| Field | Rule |
|---|---|
| `version` | `1`. |
| `anchor.media_id` | A picture you uploaded. `framing`: `full_body` or `waist_up`. |
| `idle[]` | 2 to 6 videos. `kind`: `idle` (default), `typing`, `talk`. `rating`: `sfw` (default) or `suggestive`, never `explicit`: loops are what a signed-out visitor sees. |
| `actions[]` | Up to 24. `key` is yours and stable (letters, digits, `. _ : -`). |
| `title` | Up to 40 characters, shown on the button. Public text: the same rules as set captions. |
| `thumb` | Optional picture for the button. |
| `segments` | 1 to 4 videos, played in order, each at most 15 seconds. |
| `return` | One video, from the last segment's end back to the anchor. |
| `rating` | `sfw`, `suggestive` or `explicit`, as for sets. Explicit actions are only offered to accounts past the free trial and at her intimate relationship level. |
| `live_action` | Present: the action is a button in Live Action. `min_level`: the relationship level (1 to 7) it unlocks at. Default: 1 for sfw, 2 for suggestive, her intimate level for explicit (an explicit action never opens earlier). `min_tier` is accepted for older exports and ignored. |
| `live_stream` | Present: the action is a Live Stream command. `tokens`: its price in the site's credits, a whole number from 1 to 10,000. |
| `reaction_hint` | Up to 200 characters for her chat: what she just did, so her message about it matches. Never shown. |

Send `live_action`, `live_stream` or both. Prices and locks can be changed on
the site without a new upload; a later PUT does not undo those changes.

### File rules

Every clip of a pack is checked from its header when it is used:

- MP4, H.264 **High** profile, yuv420p, **24** fps constant frame rate.
- One size for the whole pack: **720x1280** (advised: every clip is served
  from the site's own server) or 1080x1920.
- The index at the front (`-movflags +faststart`) and the first frame a
  keyframe.
- At most **15** seconds a clip; at most **4** segments an action; **2** to
  **6** idle loops; at most **24** actions.
- AAC audio or none. Idle loops silent or quiet room tone.

One command meets all of it:

```
ffmpeg -i in.mp4 -c:v libx264 -profile:v high -pix_fmt yuv420p -r 24 -fps_mode cfr -vf scale=720:1280 -g 48 -c:a aac -movflags +faststart out.mp4
```

Upload each file the usual way (`POST /uploads`, then the confirm) and name
it by `media_id`. Every problem is reported at once, under the manifest's own
field names, with the command above. Send her character first: a pack for an
external id with no character is a `409 no_character`.

### What happens to it

- A new pack lands as a **draft**. A person checks the clips on the site,
  can change titles, locks and prices, and publishes it.
- A PUT to a published pack is **held for review** (`"result": "held for
  review"`) until a person applies it. The same pack again is `unchanged`.
- `GET /characters/{external_id}/live` returns the pack as stored
  (`pack`), anything waiting (`pending_review`), the site's changes per
  action (`site_changes`), and each clip checked again (`checks`, with
  `problem: null` when it passes). Your Test button can show this.
- `DELETE /characters/{external_id}/live` takes Live Action and Live
  Stream off her profile at once. The files and the site's changes are kept,
  so publishing again brings them back.

## Reading back: `GET /characters/{external_id}`

```json
{
  "external_id": "h3-c-mk2q9x",
  "character_id": "j97...",
  "status": "published",
  "changes_pending": false,
  "name": "Mara Voss",
  "age": 26,
  "profile_hash": "9f2c...",
  "received_at": "...", "updated_at": "...", "published_at": "...",
  "settings": {
    "toxic": false, "toxic_likes": [], "toxic_hates": [],
    "levels": null,
    "speech_voice": "jessica"
  },
  "media": { "avatar": "k57...", "card": null, "cover": "k58...", "loop": null, "gallery": ["k60...", "k61..."], "reference": [{ "view": "front", "media_id": "k59..." }] },
  "pending_media": null,
  "sets": [{ "set_key": "gym-morning", "set_id": "...", "status": "draft", "publish_at": null,
             "title": "Morning session", "tier": "premium", "items": 2, "content_hash": "...", "updated_at": "..." }],
  "feedback": {
    "replies_rated": 41,
    "concerning": 0,
    "tags": { "engaging": 12, "funny": 6, "interesting": 3, "hot": 9, "remembered": 2,
              "boring": 3, "too_flirty": 1, "too_long": 0, "too_short": 4, "repetitive": 5,
              "out_of_character": 1, "made_up": 2, "forgot": 1, "bad_picture": 0 },
    "oldest_counted": "...", "newest_counted": "..."
  }
}
```

`status` is `draft`, `published` or `rejected`; a set's is `draft`, `scheduled`
or `published`. Media ids in `media` are the ones you sent, so a pipeline can
skip uploads the site already has. PUT responses carry everything here except
`feedback`.

**`settings`** is what the site has now for the [settings it also sets](#settings-the-site-also-sets),
whoever set them.
`levels` is `null` for the default ladder; `speech_voice` is
`null` for the default voice.

**`feedback`** is how people rated her replies, from the Rate this reply menu
on each of her messages, over her newest 1,000 ratings (`null` once she is
rejected). Counts only: who rated, in which chat and anything they wrote stay on
the site. One rating can carry several tags.

| Tag | Means |
|---|---|
| `engaging` | Kept me hooked |
| `funny` | Funny |
| `interesting` | Interesting |
| `hot` | Hot |
| `remembered` | Remembered well |
| `boring` | Boring |
| `too_flirty` | Too flirty |
| `too_long` | Too long |
| `too_short` | Too short |
| `repetitive` | Repetitive |
| `out_of_character` | Not like her |
| `made_up` | Made something up |
| `forgot` | Forgot something |
| `bad_picture` | Bad picture |

`concerning` counts replies reported as concerning, which a person on the site
reads. A character whose ratings lean to `boring`, `repetitive` or
`out_of_character` usually needs a new greeting or a warmer persona, in that
order.

## Review and publishing on the site

In the admin panel's Studio tab:

- **Keys.** One per studio, copied once, revocable any time.
- **The queue.** Drafts waiting, live characters with changes waiting, live
  characters, rejected ones.
- **Review page.** Everything she is (profile, persona, greeting, detailed
  profile, About me, relationship levels, Toxic mode, voice, provenance), her
  card, banner and reference sheet, and a test chat (a draft opens only for the
  admin who made the key). Publishing needs a card picture. Reject deletes her,
  her sets and her files; a revised version may be sent. Changes sent after
  publishing show field by field, old beside new, with Apply and Discard.
- **Sets.** Title, free or premium, any paid plan or credits and the price, then
  Publish now or Schedule for a date and time. Publishing her can take her
  draft sets live with her, all at once. A set's title, description and
  captions are read against the site's rules again when it is published or
  scheduled; a scheduled set is read when it is scheduled, not again when its
  time comes. A set goes live in her My Private Content once she is live too. Take down returns it
  to a draft; Delete removes it and what people bought of it.

## Notes

- **Uploads are a POST plus a confirm.** The storage's upload URLs take a POST
  and only then name the stored file, so the site needs to be told which upload
  it was. Large videos cannot pass through the API itself (a request body there
  is capped at 20 MB), which is why files go straight to storage.
- **Women only.** Men are the sister site's.
- **`backstory` and `appearance` are not printed on her profile.** They keep her
  consistent in chat. What a visitor reads is the tagline, the description and
  the About me cells.
- **No LoRA.** The site's in-chat pictures are made by its own image vendor
  from her front reference view.