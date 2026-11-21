// Live pack: the clips your site plays for a character's Live Stream (tips) and Live Action (video call buttons).
// The site makes nothing — it plays these back to back, so the pack has to look like ONE continuous shot:
//   · one still (the anchor, 9:16) every clip starts and/or ends on;
//   · idle loops (anchor → anchor): plain, typing on her phone, talking to the camera;
//   · actions (tips / buttons): 1-4 segments, the first from the anchor, each next from the last frame of the one before,
//     then a short return clip from that last frame back to the anchor.
// Videos are made with H3 (loop / image → video / first → last), then re-encoded on the rental exactly as the site wants
// (H.264 High, 24 fps constant, 720×1280, silent), each join eased onto the exact frame it meets, and how big the jump was
// before that is shown on every clip — plus a reel of the whole pack to watch by eye before it's sent.
import { create } from "zustand";
import type { FileRef } from "./api";
import type { Character } from "./characters";

export type ClipKind = "idle" | "typing" | "talk" | "seg" | "return";
export interface LiveClip {
  key: string; kind: ClipKind;
  status: "new" | "making" | "encoding" | "ready" | "error";
  jobId?: string; src?: FileRef;
  /** the join frames it was eased onto (input pictures) and what the re-encode reported */
  enc?: { d_start?: number | null; d_end?: number | null; last: string; seconds: number; at: number };
  error?: string;
  /** you watched it and the joins look right */
  ok?: boolean;
  /** the H3 prompt the compiler wrote from the plan (and what it was written from — a changed plan writes it again) */
  h3?: string; h3From?: string;
  /** her likeness on this part's last frame (DeepSeek's face match, 0-10) before and after the face fix, and which went on */
  likeness?: { before?: number | null; after?: number | null; used: "fixed" | "original" | "no sheet"; why?: string };
}
export interface LiveAction {
  key: string; title: string; prompt: string; hint: string;
  rating: "sfw" | "suggestive" | "explicit"; seconds: number; segs: number;
  /** a longer action (over 15 s): what happens in each part, in order — the site plays them back to back as one take */
  parts?: string[];
  /** its step on her ladder (1 = the free opener, higher = bolder), as on the tip menus — the order it's sent in */
  level?: number;
  tier: "free" | "premium" | "ultimate"; tokens: number; on: boolean;
}
export interface LiveState {
  anchor?: { ref: FileRef; input: string; at: number };
  framing: "waist_up" | "full_body";
  /** fix her face on the last frame of every action part before the next part starts from it (on unless turned off) */
  faceFix?: boolean;
  idle: { key: string; kind: "idle" | "typing" | "talk"; prompt: string; seconds: number; on: boolean }[];
  actions: LiveAction[];
  clips: Record<string, LiveClip>;
  sent?: { at: number; status: number; problems?: string };
  /** the writer's place for her (one line) and the prompt her webcam still is made from */
  setting?: string; stillPrompt?: string;
}

const STILL = "The camera is fixed (a phone on a stand, live-webcam look), one continuous shot with no cuts, the same light and background throughout. She ends in exactly the pose she started in.";
export const DEFAULT_IDLE: LiveState["idle"] = [
  { key: "idle_main", kind: "idle", seconds: 6, on: true, prompt: `She rests in the same pose and spot, looking softly into the camera: slow natural breathing, a blink, a faint smile, a small shift of her weight, one hand briefly touching her hair. ${STILL}` },
  { key: "idle_typing", kind: "typing", seconds: 6, on: true, prompt: `She glances down at a phone held just below the bottom of the frame, thumbs typing a message, a small smile at what she writes, then she looks back up into the camera. ${STILL}` },
  { key: "idle_talk", kind: "talk", seconds: 6, on: true, prompt: `She talks to the camera in a relaxed, friendly way, as if answering a message in her live stream chat: small natural hand gestures, a nod, a smile. ${STILL}` },
];
export const DEFAULT_ACTIONS: LiveAction[] = [
  { key: "blow_kiss", title: "Blow a kiss", seconds: 5, segs: 1, rating: "sfw", tier: "free", tokens: 20, on: true, hint: "blows a kiss at the camera and laughs",
    prompt: "She raises her hand to her lips, blows a kiss toward the camera and laughs softly." },
  { key: "wave", title: "Wave hello", seconds: 4, segs: 1, rating: "sfw", tier: "free", tokens: 10, on: true, hint: "waves hello at the camera with a big smile",
    prompt: "She waves at the camera with a big bright smile, a little bounce in her shoulders." },
  { key: "wink", title: "Wink", seconds: 4, segs: 1, rating: "sfw", tier: "free", tokens: 10, on: true, hint: "leans in a little and winks at the camera",
    prompt: "She leans a little toward the camera, winks with one eye and gives a playful smile." },
  { key: "heart_hands", title: "Heart hands", seconds: 5, segs: 1, rating: "sfw", tier: "free", tokens: 15, on: true, hint: "makes a heart with her hands for the camera",
    prompt: "She makes a heart shape with both hands in front of her chest, tilts her head and smiles warmly at the camera." },
];
export const emptyLive = (): LiveState => ({ framing: "waist_up", idle: DEFAULT_IDLE.map((x) => ({ ...x })), actions: DEFAULT_ACTIONS.map((x) => ({ ...x })), clips: {} });
export const liveOf = (c: Character): LiveState => ({ ...emptyLive(), ...(c.live ?? {}) });
export const segKey = (a: string, i: number) => `act_${a}_s${i + 1}`;
export const retKey = (a: string) => `act_${a}_ret`;
export const fileUrl = (cid: string, key: string, at = 0) => `/studio-api/live/file?cid=${encodeURIComponent(cid)}&key=${encodeURIComponent(key)}&v=${at}`;

/** how big a join's jump was before it was eased (0-100, mean pixel difference): under 3 nobody sees it, under 8 the
 *  easing hides it, more is a visible jump — make that clip again */
export const jumpLevel = (d?: number | null): "none" | "clean" | "eased" | "jump" => (d == null ? "none" : d < 3 ? "clean" : d < 8 ? "eased" : "jump");

// ---- state on the character (saved with it, so it's there on every rental)
async function chars() { return (await import("./characters")).useCharacters.getState(); }
async function get(cid: string): Promise<{ c: Character; l: LiveState }> {
  const c = (await chars()).list.find((x) => x.id === cid);
  if (!c) throw new Error("That character is gone");
  return { c, l: liveOf(c) };
}
export async function saveLive(cid: string, f: (l: LiveState) => LiveState) {
  const st = await chars();
  // read and write in the same tick: clips finishing side by side don't overwrite each other's progress
  const c = st.list.find((x) => x.id === cid);
  if (!c) return;
  st.save({ ...c, live: f(liveOf(c)) });
}
const patchClip = (cid: string, key: string, kind: ClipKind, p: Partial<LiveClip>) =>
  saveLive(cid, (l) => ({ ...l, clips: { ...l.clips, [key]: { ...(l.clips[key] ?? { key, kind, status: "new" }), ...p } } }));

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  let d: unknown; try { d = JSON.parse(t); } catch { d = { error: t.slice(0, 200) }; }
  if (!r.ok || (d as { error?: string }).error) throw new Error((d as { error?: string }).error || `The rental answered ${r.status}`);
  return d as T;
}

/** the still: the picture cut to 9:16 and sized 720×1280. A new still means every clip has to be made again */
export async function setAnchor(cid: string, ref: FileRef) {
  const d = await post<{ input: string }>("/studio-api/live/anchor", { cid, ref });
  await saveLive(cid, (l) => ({ ...l, anchor: { ref, input: d.input, at: Date.now() },
    clips: Object.fromEntries(Object.entries(l.clips).map(([k, c]) => [k, { ...c, status: "new" as const, enc: undefined, ok: false, jobId: undefined, src: undefined }])) }));
}

/** one clip: H3 makes it, the rental re-encodes it onto its joins. Segments wait for the one before them */
export async function makeClip(cid: string, key: string, attempt = 0): Promise<void> {
  const [{ buildAnimate }, { useJobs, waitForJob }, { useSettings, newSeed }, { h3Size }] = await Promise.all([import("./graphs"), import("./jobs"), import("./settings"), import("./models")]);
  const { c, l } = await get(cid);
  if (!l.anchor) throw new Error("Pick her still first");
  const anchor = l.anchor.input;
  const idle = l.idle.find((x) => x.key === key);
  const act = l.actions.find((a) => key.startsWith(`act_${a.key}_`));
  let kind: ClipKind, prompt: string, seconds: number, mode: "loop" | "i2v" | "fl", images: string[], start: string, end: string | undefined, talk = false;
  if (idle) {
    kind = idle.kind; prompt = idle.prompt; seconds = idle.seconds; mode = "loop"; images = [anchor]; start = anchor; end = anchor; talk = idle.kind === "talk";
  } else if (act) {
    const isRet = key === retKey(act.key);
    const i = isRet ? act.segs : Number(/_s(\d+)$/.exec(key)?.[1] ?? 1) - 1;
    const prev = i === 0 ? anchor : l.clips[segKey(act.key, i - 1)]?.enc?.last;
    if (!prev) throw new Error(`${act.title}: make part ${i} first`);
    if (isRet) {
      kind = "return"; seconds = 3; mode = "fl"; images = [prev, anchor]; start = prev; end = anchor;
      prompt = `She settles smoothly back into her resting pose, facing the camera with a soft smile. ${STILL}`.replace(" She ends in exactly the pose she started in.", "");
    } else {
      kind = "seg"; seconds = Math.min(15, act.seconds); mode = "i2v"; images = [prev]; start = prev; end = undefined;
      // a longer action: each part its own beat, told what came before so it carries the move on instead of restarting it
      const beat = act.parts?.[i] ?? act.prompt;
      const before = i > 0 ? (act.parts?.[i - 1] ?? act.prompt) : "";
      prompt = `${i > 0 ? `This continues a move already under way (the part before: ${before}) — from the first frame she is mid-motion and keeps the same direction and tempo, no restart: ` : ""}${beat}${act.parts && i < act.parts.length - 1 ? " The move is still going at the end of this part (it continues in the next)." : ""} ${STILL.replace(" She ends in exactly the pose she started in.", "")}`;
    }
  } else throw new Error(`Unknown clip ${key}`);
  await patchClip(cid, key, kind, { status: "making", error: undefined, ok: false });
  try {
    // the same planning as 02 Scenes: the plan line goes through the H3 prompt compiler (timing, motion beats, what stays
    // still), with her start frame attached — written once per plan line and reused when the clip is made again
    const old = l.clips[key];
    let h3 = old?.h3 && old.h3From === prompt ? old.h3 : "";
    if (!h3) {
      try {
        const { runWriter } = await import("./writer");
        const { describe } = await import("./characters");
        const refs = mode === "loop" ? "<Picture 1> is the actual first frame AND the last frame of the target video (a seamless loop — it must end exactly as it starts)."
          : mode === "fl" ? "<Picture 1> is the actual first frame; the video must end exactly on her resting pose from her still (the last frame is given to the model)."
          : "<Picture 1> is the actual first frame of the target video.";
        h3 = (await runWriter("compiler", { blueprint: `${prompt}${l.setting ? `\nPlace: ${l.setting}.` : ""}\nOne fixed camera (a phone on a stand at eye level), one continuous shot — no cuts, no zoom, no camera moves, nothing else in the room changes. Silent.`,
          MODE: "I2V", seconds: String(seconds), references: refs, characters: `${c.site?.name || c.name}: ${describe(c).slice(0, 400)}`, aspect: "9:16", description: prompt },
          { tab: "characters", label: `${c.name} · live · H3 prompt · ${key.replace(/^act_/, "").replace(/_/g, " ")}`, images: [images[0]] })).trim();
        await patchClip(cid, key, kind, { h3, h3From: prompt });
      } catch { h3 = ""; } // no writer: the plan line goes in as it is
    }
    const a = useSettings.getState().s.animate;
    const { width, height } = h3Size("9:16", 0.88);
    const g = buildAnimate({ sampler: a.adv.sampler, scheduler: a.adv.scheduler, steps: a.adv.steps, seed: newSeed(), mode, prompt: h3 || prompt, images, videos: [], audios: [],
      seconds, width, height, turbo: a.turbo, loras: a.loras, refImageSize: a.refImageSize, lowMemDecode: a.lowMemDecode, prefix: `studio/live/${cid}`, plain: true,
      mouth: talk ? "talk" : "closed", music: "none", avoid: "camera movement, cuts, zoom, text, watermark" });
    const j = await useJobs.getState().run("characters", `${c.name} · live · ${key.replace(/^act_/, "").replace(/_/g, " ")}`, g, `animate:${mode}:live:${seconds}s`, { charId: cid, live: key });
    await patchClip(cid, key, kind, { jobId: j.id });
    const done = await waitForJob(j.id);
    const src = done.outputs.find((o) => o.kind === "video" && o.type === "output");
    if (!src) throw new Error("H3 finished without a video");
    await patchClip(cid, key, kind, { status: "encoding", src: { filename: src.filename, subfolder: src.subfolder, type: src.type } });
    const e = await post<{ d_start?: number | null; d_end?: number | null; last: string; seconds: number }>("/studio-api/live/encode", { cid, key, src, start, end });
    // a join that visibly jumps: made again by itself (twice at most) before anyone has to look at it
    if ((jumpLevel(e.d_start) === "jump" || jumpLevel(e.d_end) === "jump") && attempt < 2) { await patchClip(cid, key, kind, { enc: { ...e, at: Date.now() } }); return makeClip(cid, key, attempt + 1); }
    let enc = e;
    // an action part: her face on its last frame is fixed against her reference sheet before anything continues from it,
    // and both are scored — the fix is only used when it scores at least as well; a part whose likeness is still low is
    // made again (twice at most)
    if (kind === "seg" && l.faceFix !== false) {
      await patchClip(cid, key, kind, { status: "encoding", error: "fixing her face on the last frame…" });
      const fx = await fixJoin(c, cid, e.last).catch((err) => ({ used: "original" as const, why: (err as Error).message, last: undefined, before: undefined, after: undefined }));
      if (fx.used === "fixed" && fx.last) enc = await post("/studio-api/live/encode", { cid, key, src, start, end: fx.last });
      await patchClip(cid, key, kind, { likeness: { before: fx.before, after: fx.after, used: fx.used, why: fx.why }, error: undefined });
      const final = fx.used === "fixed" ? fx.after : fx.before;
      if (final != null && final < 6 && attempt < 2) { await patchClip(cid, key, kind, { enc: { ...enc, at: Date.now() } }); return makeClip(cid, key, attempt + 1); }
    }
    await patchClip(cid, key, kind, { status: "ready", enc: { ...enc, at: Date.now() } });
  } catch (err) {
    await patchClip(cid, key, kind, { status: "error", error: (err as Error).message });
    throw err;
  }
}

/** every clip this pack needs, in play order */
export function packKeys(l: LiveState): string[] {
  return [...l.idle.filter((x) => x.on).map((x) => x.key), ...l.actions.filter((a) => a.on).flatMap((a) => [...Array.from({ length: a.segs }, (_, i) => segKey(a.key, i)), retKey(a.key)])];
}

/** make what's missing (or everything with redo): idle loops side by side, each action's parts one after another */
export async function makeAll(cid: string, redo = false): Promise<void> {
  const { l } = await get(cid);
  const need = (k: string) => redo || l.clips[k]?.status !== "ready";
  const jobs: Promise<void>[] = l.idle.filter((x) => x.on && need(x.key)).map((x) => makeClip(cid, x.key).catch(() => {}));
  for (const a of l.actions.filter((x) => x.on)) {
    const keys = [...Array.from({ length: a.segs }, (_, i) => segKey(a.key, i)), retKey(a.key)];
    jobs.push((async () => {
      let after = false; // once a part is made again, everything after it has to be too (it starts from its last frame)
      for (const k of keys) { if (after || need(k)) { after = true; await makeClip(cid, k); } }
    })().catch(() => {}));
  }
  await Promise.all(jobs);
}

/** a clip made again: the parts of that action after it start from a different frame now, so they're redone too */
export async function redoClip(cid: string, key: string): Promise<void> {
  const { l } = await get(cid);
  const a = l.actions.find((x) => key.startsWith(`act_${x.key}_`));
  if (!a) return makeClip(cid, key);
  const keys = [...Array.from({ length: a.segs }, (_, i) => segKey(a.key, i)), retKey(a.key)];
  for (const k of keys.slice(keys.indexOf(key))) await makeClip(cid, k);
}

/** the order to watch it in: every idle from and back to the plain idle, every action between two plain idles — so every
 *  join the site can play is in it once */
export function reelKeys(l: LiveState): string[] {
  const base = l.idle.find((x) => x.on && x.kind === "idle")?.key ?? l.idle.find((x) => x.on)?.key;
  const out: string[] = base ? [base] : [];
  for (const x of l.idle.filter((y) => y.on && y.key !== base)) out.push(x.key, ...(base ? [base] : []));
  for (const a of l.actions.filter((y) => y.on)) out.push(...Array.from({ length: a.segs }, (_, i) => segKey(a.key, i)), retKey(a.key), ...(base ? [base] : []));
  return out;
}
export async function makeReel(cid: string): Promise<string> {
  await ensureFitted(cid);
  const { l } = await get(cid);
  await post("/studio-api/live/reel", { cid, keys: reelKeys(l) });
  return fileUrl(cid, "reel", Date.now());
}

/** what's still in the way of sending (empty = ready) */
export function blockers(l: LiveState): string[] {
  const out: string[] = [];
  if (!l.anchor) out.push("pick her still");
  const keys = packKeys(l);
  const notReady = keys.filter((k) => l.clips[k]?.status !== "ready");
  if (notReady.length) out.push(`${notReady.length} clip${notReady.length === 1 ? "" : "s"} not made yet`);
  const unchecked = keys.filter((k) => l.clips[k]?.status === "ready" && !l.clips[k]?.ok);
  if (unchecked.length) out.push(`${unchecked.length} clip${unchecked.length === 1 ? "" : "s"} not checked by eye yet`);
  if (!l.idle.some((x) => x.on && x.kind === "idle")) out.push("at least one plain idle loop");
  if (l.actions.filter((a) => a.on).length > 24) out.push("at most 24 actions");
  return out;
}

export async function sendLive(cid: string): Promise<{ ok: boolean; note: string }> {
  const { c, l } = await get(cid);
  if (!c.site?.sent?.ok) throw new Error(`${c.name} isn't on the site yet — send her first (the site answers 409 otherwise)`);
  await ensureFitted(cid);
  const pack = {
    framing: l.framing,
    idle: l.idle.filter((x) => x.on).map((x) => ({ key: x.key, kind: x.kind, rating: "sfw" })),
    actions: l.actions.filter((a) => a.on).sort((a, b) => (a.level ?? 99) - (b.level ?? 99)).map((a) => ({
      key: a.key, title: a.title.slice(0, 40), segments: Array.from({ length: a.segs }, (_, i) => segKey(a.key, i)), return: retKey(a.key),
      rating: a.rating, reaction_hint: a.hint.slice(0, 200), live_action: { min_tier: a.tier }, live_stream: { tokens: a.tokens },
    })),
  };
  const r = await post<{ status: number; body: unknown; problems: string }>("/studio-api/live/send", { cid, pack });
  const ok = r.status >= 200 && r.status < 300;
  await saveLive(cid, (x) => ({ ...x, sent: { at: Date.now(), status: r.status, problems: ok ? undefined : r.problems || JSON.stringify(r.body).slice(0, 600) } }));
  return { ok, note: ok ? "it's in as a draft — publish it from the site's admin" : `the site answered ${r.status}: ${r.problems || JSON.stringify(r.body).slice(0, 300)}` };
}

export async function checkOnSite(cid: string): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`/studio-api/live/site?cid=${encodeURIComponent(cid)}`);
  return r.json();
}


// ---- planned by the writer: her actions and idle loops, in her manner, learning from examples of other creators

/** what the writer knows about her: look, canon (for cosplay characters), her site profile and how she texts */
async function whoShe(c: Character): Promise<string> {
  const { describe } = await import("./characters");
  const { canonNote } = await import("./siteAuto");
  const st = c.site ?? {};
  return [`Name: ${st.name || c.name}. Adult woman.`, describe(c), canonNote(c.source), st.direction && `Owner's direction: ${st.direction}`, st.bio && `Bio: ${st.bio}`,
    st.personality && `Traits: ${st.personality}`, (st.personaCore || st.persona) && `Persona: ${String(st.personaCore || st.persona).slice(0, 1500)}`,
    st.voice && `How she texts: ${st.voice}`, st.quirks && `Habits: ${st.quirks}`, c.personality && `Personality notes: ${c.personality}`].filter(Boolean).join("\n");
}

export interface PlanOpts { examples: string; pictures?: string[]; count: number; ratings: LiveAction["rating"][]; keep?: boolean }

/** the writer plans her actions (and words her idle loops) — made clips of actions it keeps (same key) stay */
export async function planActions(cid: string, o: PlanOpts): Promise<number> {
  const { c, l } = await get(cid);
  const { runWriter } = await import("./writer");
  const { looseJson } = await import("./looseJson");
  const keep = o.keep ? l.actions.filter((a) => a.on && l.clips[segKey(a.key, 0)]?.status === "ready") : [];
  const raw = await runWriter("live", {
    character: await whoShe(c), framing: l.framing === "full_body" ? "full body" : "waist up", count: String(o.count),
    ratings: o.ratings.join(", "), keep: keep.length ? keep.map((a) => `${a.key}: ${a.title}`).join("\n") : "(none)",
    examples: o.examples.trim() || "(none — use your own judgement of what live-stream creators offer)",
  }, { tab: "characters", label: `${c.name} · planning her live pack`, big: true, images: [...(l.anchor ? [l.anchor.input] : await sheetPic(c)), ...(o.pictures ?? [])].slice(0, 8) });
  type A = Partial<LiveAction> & { key?: string };
  const d = looseJson<{ setting?: string; still?: string; idle?: Record<string, string>; actions?: A[] }>(raw);
  const STILL_END = " The camera is fixed (a phone on a stand, live-webcam look), one continuous shot with no cuts, the same light and background throughout. She ends in exactly the pose she started in.";
  const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `action_${Math.random().toString(36).slice(2, 7)}`;
  const seen = new Set<string>();
  const acts: LiveAction[] = (d.actions ?? []).flatMap((a) => {
    const key = slug(a.key || a.title || "");
    if (seen.has(key) || !a.prompt) return [];
    seen.add(key);
    const rating = (o.ratings.includes(a.rating as LiveAction["rating"]) ? a.rating : o.ratings[0]) as LiveAction["rating"];
    return [{ key, title: String(a.title || key).slice(0, 40), prompt: String(a.prompt), hint: String(a.hint || "").slice(0, 200), rating,
      seconds: Math.max(3, Math.min(15, Number(a.seconds) || 5)), segs: Math.max(1, Math.min(4, Number(a.segs) || 1)),
      tier: (["free", "premium", "ultimate"].includes(String(a.tier)) ? a.tier : rating === "sfw" ? "free" : rating === "suggestive" ? "premium" : "ultimate") as LiveAction["tier"],
      tokens: Math.max(1, Math.round(Number(a.tokens) || 20)), on: true,
      ...(Array.isArray((a as { parts?: unknown }).parts) && ((a as { parts: unknown[] }).parts).length > 1 ? { parts: ((a as { parts: unknown[] }).parts).map(String).slice(0, 4), segs: Math.min(4, ((a as { parts: unknown[] }).parts).length) } : {}), level: Math.max(1, Math.min(30, Math.round(Number((a as { level?: number }).level) || 0))) || undefined }];
  }).sort((a, b) => (a.level ?? 99) - (b.level ?? 99)).slice(0, 24);
  if (!acts.length) throw new Error(`${c.name}: the writer planned no actions — try again`);
  await saveLive(cid, (x) => ({
    ...x,
    ...(d.setting ? { setting: String(d.setting).slice(0, 200) } : {}), ...(d.still ? { stillPrompt: String(d.still) } : {}),
    idle: x.idle.map((y) => (d.idle?.[y.kind] ? { ...y, prompt: `${String(d.idle[y.kind]).replace(/\s*$/, "")}${STILL_END}` } : y)),
    actions: acts,
    // clips of actions that aren't in the plan any more go; the kept ones (same key) stay
    clips: Object.fromEntries(Object.entries(x.clips).filter(([k]) => !k.startsWith("act_") || acts.some((a) => k.startsWith(`act_${a.key}_`)))),
  }));
  return acts.length;
}

// ---- Batch → Live packs: many characters, unattended until the eye check
export interface LiveRun { cid: string; name: string; step: string; error?: string; done?: boolean }
export const useLiveBatch = create<{ runs: LiveRun[]; running: boolean }>(() => ({ runs: [], running: false }));
const setRun = (cid: string, p: Partial<LiveRun>) => useLiveBatch.setState((s) => ({ runs: s.runs.map((r) => (r.cid === cid ? { ...r, ...p } : r)) }));

/** for each character: her still (her sheet's front picture unless she has one), her actions planned from the examples,
 *  every clip made and fitted to its joins (big jumps made again by themselves). Sending waits for your eye check. */
export async function liveBatch(cids: string[], o: PlanOpts & { replan: boolean; still: "new" | "sheet" | "keep" }) {
  const { useCharacters, coverOf } = await import("./characters");
  const list = useCharacters.getState().list.filter((c) => cids.includes(c.id));
  useLiveBatch.setState({ running: true, runs: list.map((c) => ({ cid: c.id, name: c.site?.name || c.name, step: "waiting" })) });
  // the writer plans several side by side; the GPU line takes the clips one at a time anyway
  let next = 0;
  const one = async (c: Character) => {
    try {
      let l = liveOf(c);
      const newStill = o.still === "new" && c.style !== "anime" && !(l.anchor && !o.replan && l.stillPrompt);
      // the plan comes first when she gets a new still: it writes her room and the still's prompt, and words every action for it
      if (newStill || o.replan || l.actions.every((a) => DEFAULT_ACTIONS.some((d) => d.key === a.key && d.prompt === a.prompt))) {
        setRun(c.id, { step: "the writer is planning her room and actions" });
        const n = await planActions(c.id, o);
        setRun(c.id, { step: `${n} actions planned` });
      }
      l = liveOf(useCharacters.getState().list.find((x) => x.id === c.id)!);
      // her reference sheet first, when she has none: the still and the face fix at every join are made from it
      if (c.style !== "anime" && !c.views.sheet && (newStill || l.faceFix !== false)) {
        setRun(c.id, { step: "making her reference sheet (all angles) first" });
        if (!(await ensureSheet(c.id).catch(() => false))) setRun(c.id, { step: "no sheet came out — going on with her front picture" });
      }
      if (newStill) {
        setRun(c.id, { step: `making her webcam still${l.setting ? ` · ${l.setting}` : ""}` });
        const outs = await makeStill(c.id, 2);
        await setAnchor(c.id, outs[0]);
      } else if (!l.anchor || o.still === "sheet") {
        const face = c.views.front ?? coverOf(c);
        if (!face) throw new Error("no picture of her to use as the still — pick one in her Live pack");
        setRun(c.id, { step: "using her sheet picture as the still" }); await setAnchor(c.id, face);
      }
      setRun(c.id, { step: "clips in the GPU line" });
      await makeAll(c.id);
      const fin = liveOf(useCharacters.getState().list.find((x) => x.id === c.id)!);
      const keys = packKeys(fin);
      const bad = keys.filter((k) => fin.clips[k]?.status !== "ready").length;
      setRun(c.id, { step: bad ? `${keys.length - bad}/${keys.length} clips made — open her pack to redo the rest` : `all ${keys.length} clips made — watch the reel and tick them`, done: true });
    } catch (e) { setRun(c.id, { step: "stopped", error: (e as Error).message, done: true }); }
  };
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => { while (next < list.length) await one(list[next++]); }));
  useLiveBatch.setState({ running: false });
}


async function sheetPic(c: Character): Promise<string[]> {
  const { coverOf } = await import("./characters");
  const f = c.views.front ?? coverOf(c);
  if (!f) return [];
  return [await (await import("./api")).toInput(f).then((x) => x.name).catch(() => "")].filter(Boolean);
}

/** her webcam still, made from the writer's still prompt with her character reference (Krea 2 identity edit on a 9:16
 *  blank canvas — the same way Batch makes a character's pictures): `takes` pictures in her project; the first becomes
 *  her still (pick another from her pictures in her Live pack) */
export async function makeStill(cid: string, takes = 2): Promise<FileRef[]> {
  const { c, l } = await get(cid);
  if (c.style === "anime") throw new Error(`${c.name} is an anime character — pick her still yourself in her Live pack`);
  const shot = l.stillPrompt || `She sits facing the camera at eye level in her bedroom, relaxed, hands in her lap, a soft smile, a warm bedside lamp. A phone-on-a-stand webcam frame, ${l.framing === "full_body" ? "full body" : "waist up"}, unretouched skin with visible texture.`;
  const [{ characterShot }, { buildEdit }, { editArgs, newSeed, useSettings }, { useJobs, waitForJob }] = await Promise.all([import("./make"), import("./graphs"), import("./settings"), import("./jobs")]);
  const cs = await characterShot(c, shot, `${shot} Framing: ${l.framing === "full_body" ? "full body, head to feet in frame" : "waist up"}, vertical 9:16 phone frame.`, "9:16", [], null);
  const st = useSettings.getState().s;
  // her reference sheet goes in beside her picture: every angle of the same woman, so the still gets her face and body right
  const sheet = c.views.sheet ? (await (await import("./api")).toInput(c.views.sheet).catch(() => null))?.name : undefined;
  const images = sheet ? [cs.ref.name, sheet] : [cs.ref.name];
  const instruction = sheet ? cs.instruction.replace("do not copy the second picture in", "do not copy the second or third picture in").replace(/ Only this one /, " The third picture is her reference sheet — the same person from every angle (front, back, side, face, three-quarter); use it for her face, hair and body from any angle. Only this one ") : cs.instruction;
  const jobs = await Promise.all(Array.from({ length: takes }, () => useJobs.getState().run("characters", `${c.name} · live still`, buildEdit({ ...editArgs(st.edit, "krea"), loras: cs.loras, enhance: false, seed: newSeed(),
    images, blank: cs.canvas, instruction, negative: "", resolution: 1024, refBoost: 4, prefix: `studio/live/${cid}` }), "edit:krea:1:raw", { project: cid, charId: cid, live: "still" })));
  const outs: FileRef[] = [];
  for (const j of jobs) {
    const d = await waitForJob(j.id).catch(() => null);
    const o = d?.outputs.find((x) => x.kind === "image" && x.type === "output");
    if (o) outs.push({ filename: o.filename, subfolder: o.subfolder, type: o.type });
  }
  if (!outs.length) throw new Error(`${c.name}: her still didn't come out — try again`);
  return outs;
}


/** a new rental: the fitted clips (and her still) stay on the old one, but every raw video is in your results — fit them
 *  again, in order (each part starts on the new last frame of the one before), keeping your "Looks right" ticks */
export async function ensureFitted(cid: string): Promise<number> {
  const { l } = await get(cid);
  const have = await (await fetch(`/studio-api/live/have?cid=${encodeURIComponent(cid)}`)).json() as { have: string[]; anchor: boolean };
  const keys = packKeys(l).filter((k) => l.clips[k]?.status === "ready");
  if (have.anchor && keys.every((k) => have.have.includes(k))) return 0;
  if (!l.anchor) return 0;
  let anchor = l.anchor.input;
  if (!have.anchor) {
    const d = await post<{ input: string }>("/studio-api/live/anchor", { cid, ref: l.anchor.ref });
    anchor = d.input;
    await saveLive(cid, (x) => ({ ...x, anchor: x.anchor ? { ...x.anchor, input: anchor } : x.anchor }));
  }
  let n = 0;
  const fit = async (key: string, start: string, end: string | undefined) => {
    const cl = (await get(cid)).l.clips[key];
    if (!cl?.src) return undefined;
    const e = await post<{ d_start?: number | null; d_end?: number | null; last: string; seconds: number }>("/studio-api/live/encode", { cid, key, src: cl.src, start, end });
    await saveLive(cid, (x) => ({ ...x, clips: { ...x.clips, [key]: { ...x.clips[key], enc: { ...e, at: Date.now() } } } }));
    n++; return e.last;
  };
  for (const x of l.idle.filter((y) => y.on)) if (l.clips[x.key]?.status === "ready") await fit(x.key, anchor, anchor);
  for (const a of l.actions.filter((y) => y.on)) {
    let prev: string | undefined = anchor;
    for (let i = 0; i < a.segs && prev; i++) prev = await fit(segKey(a.key, i), prev, undefined);
    if (prev) await fit(retKey(a.key), prev, anchor);
  }
  return n;
}


/** Batch: send every ticked character whose pack is ready (made and checked by eye) */
export async function sendReady(cids: string[]): Promise<{ sent: string[]; skipped: string[]; failed: string[] }> {
  const { useCharacters } = await import("./characters");
  const out = { sent: [] as string[], skipped: [] as string[], failed: [] as string[] };
  for (const cid of cids) {
    const c = useCharacters.getState().list.find((x) => x.id === cid);
    if (!c) continue;
    const name = c.site?.name || c.name;
    if (blockers(liveOf(c)).length || !c.site?.sent?.ok) { out.skipped.push(name); continue; }
    try { const r = await sendLive(cid); (r.ok ? out.sent : out.failed).push(name); } catch { out.failed.push(name); }
  }
  return out;
}


/** her reference: the "All angles" sheet (front, back, side, face, three-quarter in one picture) — else her front picture */
const sheetOf = (c: Character): FileRef | undefined => c.views.sheet ?? c.views.front;
const faceRefOf = (c: Character): FileRef | undefined => c.views.face ?? c.views.front ?? c.views.sheet;

async function likeness(c: Character, file: FileRef): Promise<{ score: number | null | undefined; why: string }> {
  const ref = faceRefOf(c);
  if (!ref) return { score: undefined, why: "no picture of her to compare with" };
  const [{ makeBoard }, { runWriter }, { parseScore }] = await Promise.all([import("./api"), import("./writer"), import("./builder")]);
  const board = await makeBoard([ref, file]);
  return parseScore(await runWriter("match", { who: `${c.name}, the reference`, what: "a frame from her video" }, { tab: "characters", label: `${c.name} · live · likeness check`, images: [board.name], big: false }));
}

/** the face fix at a join: Krea 2 edit of the part's last frame with her reference sheet — only her face and hair change */
async function fixJoin(c: Character, cid: string, last: string): Promise<{ used: "fixed" | "original" | "no sheet"; last?: string; before?: number | null; after?: number | null; why?: string }> {
  const sheet = sheetOf(c);
  if (!sheet) return { used: "no sheet", why: "she has no reference sheet or front picture" };
  const [{ buildEdit }, { editArgs, newSeed, useSettings }, { useJobs, waitForJob }, { toInput }] = await Promise.all([import("./graphs"), import("./settings"), import("./jobs"), import("./api")]);
  const sheetIn = (await toInput(sheet)).name;
  const instruction = `Picture 1 is one frame from a video of a woman; picture 2 is her reference sheet (${c.views.sheet ? "several views of the same woman" : "a picture of her"}). Redraw ONLY her face and hair in picture 1 so they match the woman in picture 2 exactly — face shape, jaw, eyes, eyebrows, nose, lips, skin tone, hair colour and hairline — keeping the head angle, expression and gaze direction of picture 1. Everything else in picture 1 stays exactly as it is: body, pose, hands, clothes, the room, the light, the colours, the framing and the sharpness. Nothing from picture 2 is added (no grey background, no second person). She is an adult.`;
  const j = await useJobs.getState().run("characters", `${c.name} · live · face fix`, buildEdit({ ...editArgs(useSettings.getState().s.edit, "krea"), enhance: false, seed: newSeed(),
    images: [last, sheetIn], instruction, negative: "", resolution: 1280, prefix: `studio/live/${cid}` }), "edit:krea:2:raw", { charId: cid, live: "facefix" });
  const d = await waitForJob(j.id);
  const o = d.outputs.find((x) => x.kind === "image" && x.type === "output");
  if (!o) return { used: "original", why: "the face fix made no picture" };
  const fixedRef: FileRef = { filename: o.filename, subfolder: o.subfolder, type: o.type };
  const [b, a] = await Promise.all([likeness(c, { filename: last, subfolder: "", type: "input" }), likeness(c, fixedRef)]);
  const better = a.score != null && (b.score == null || a.score >= b.score);
  return better ? { used: "fixed", last: (await toInput(fixedRef)).name, before: b.score, after: a.score, why: a.why } : { used: "original", before: b.score, after: a.score, why: b.why };
}


/** her "All angles" reference sheet, made first when she has none (the same job as Characters → Make sheet, which also
 *  cuts it into her angles) — the still and the face fix at every join use it. Waits until it's on her character. */
export async function ensureSheet(cid: string): Promise<boolean> {
  const { useCharacters } = await import("./characters");
  const c0 = useCharacters.getState().list.find((x) => x.id === cid);
  if (!c0 || c0.views.sheet) return !!c0?.views.sheet;
  if (c0.style === "anime" || !c0.views.front) return false;
  const [{ sheetGraph, SHEET_ORDER }, { useJobs, waitForJob }] = await Promise.all([import("./sheet"), import("./jobs")]);
  const front = await useCharacters.getState().asMedia(cid, "front");
  if (!front) return false;
  const j = await useJobs.getState().run("characters", `${c0.name}: character sheet`, sheetGraph(c0, front.name), "characters:view:krea", { charId: cid, view: "sheet", order: [...SHEET_ORDER] });
  await waitForJob(j.id);
  // the sheet lands on her character when the job's result is taken in — give it a moment
  for (let i = 0; i < 40; i++) {
    if (useCharacters.getState().list.find((x) => x.id === cid)?.views.sheet) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
