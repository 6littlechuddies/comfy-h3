// Live pack: the clips your site plays for a character's Live Stream (tips) and Live Action (video call buttons).
// The site makes nothing — it plays these back to back, so the pack has to look like ONE continuous shot:
//   · one still (the anchor, 9:16) every clip starts and/or ends on;
//   · idle loops (anchor → anchor): plain, typing on her phone, talking to the camera;
//   · actions (tips / buttons): 1-4 segments, the first from the anchor, each next from the last frame of the one before,
//     then a short return clip from that last frame back to the anchor.
// Videos are made with H3 (loop / image → video / first → last), then re-encoded on the rental exactly as the site wants
// (H.264 High, 24 fps constant, 720×1280, silent), each join eased onto the exact frame it meets, and how big the jump was
// before that is shown on every clip — plus a reel of the whole pack to watch by eye before it's sent.
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
}
export interface LiveAction {
  key: string; title: string; prompt: string; hint: string;
  rating: "sfw" | "suggestive" | "explicit"; seconds: number; segs: number;
  tier: "free" | "premium" | "ultimate"; tokens: number; on: boolean;
}
export interface LiveState {
  anchor?: { ref: FileRef; input: string; at: number };
  framing: "waist_up" | "full_body";
  idle: { key: string; kind: "idle" | "typing" | "talk"; prompt: string; seconds: number; on: boolean }[];
  actions: LiveAction[];
  clips: Record<string, LiveClip>;
  sent?: { at: number; status: number; problems?: string };
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
export async function makeClip(cid: string, key: string): Promise<void> {
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
      prompt = `${i > 0 ? "She carries on from where she is: " : ""}${act.prompt} ${STILL.replace(" She ends in exactly the pose she started in.", "")}`;
    }
  } else throw new Error(`Unknown clip ${key}`);
  await patchClip(cid, key, kind, { status: "making", error: undefined, ok: false });
  try {
    const a = useSettings.getState().s.animate;
    const { width, height } = h3Size("9:16", 0.88);
    const g = buildAnimate({ sampler: a.adv.sampler, scheduler: a.adv.scheduler, steps: a.adv.steps, seed: newSeed(), mode, prompt, images, videos: [], audios: [],
      seconds, width, height, turbo: a.turbo, loras: a.loras, refImageSize: a.refImageSize, lowMemDecode: a.lowMemDecode, prefix: `studio/live/${cid}`, plain: true,
      mouth: talk ? "talk" : "closed", music: "none", avoid: "camera movement, cuts, zoom, text, watermark" });
    const j = await useJobs.getState().run("characters", `${c.name} · live · ${key.replace(/^act_/, "").replace(/_/g, " ")}`, g, `animate:${mode}:live:${seconds}s`, { charId: cid, live: key });
    await patchClip(cid, key, kind, { jobId: j.id });
    const done = await waitForJob(j.id);
    const src = done.outputs.find((o) => o.kind === "video" && o.type === "output");
    if (!src) throw new Error("H3 finished without a video");
    await patchClip(cid, key, kind, { status: "encoding", src: { filename: src.filename, subfolder: src.subfolder, type: src.type } });
    const e = await post<{ d_start?: number | null; d_end?: number | null; last: string; seconds: number }>("/studio-api/live/encode", { cid, key, src, start, end });
    await patchClip(cid, key, kind, { status: "ready", enc: { ...e, at: Date.now() } });
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
  const pack = {
    framing: l.framing,
    idle: l.idle.filter((x) => x.on).map((x) => ({ key: x.key, kind: x.kind, rating: "sfw" })),
    actions: l.actions.filter((a) => a.on).map((a) => ({
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
