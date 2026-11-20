// Batch: a list of things to make, run back to back. Each row can carry something to imitate (a clip
// whose moves to copy, or a picture whose pose/scene to copy) and an idea. For videos, the prompt writer
// turns each row into an H3 timeline first; then everything is queued on the instance at once, so it
// keeps running with this page closed, and your phone gets one alert when the whole batch is done.
import { create } from "zustand";
import { planWriter, useBigPlanner } from "./packs";
import { buildAnimate, buildCreate, buildEdit, buildPromptHelper, MINOR_FLAG, type AnimateOpts } from "./graphs";
import { look } from "./charVideo";
import { h3Frames, h3Size } from "./models";
import { useJobs, type Job } from "./jobs";
import { DEFAULTS, editArgs, modelArgs, modelOf, newSeed, qualityTags, useSettings } from "./settings";
import { animeTags, describe, looks, isAdult, useCharacters, type View } from "./characters";
import { parseTimeline, toPrompt } from "./timeline";
import type { Media } from "./tray";
import { watchJobs } from "./notify";
import { runWriter } from "./writer";
import { writerOutside } from "./outside";
import { expressionFor } from "./inspo";

export interface Row {
  id: string;
  imitate: Media | null;
  idea: string;
  prompt: string;
  takes: number;
  status: "new" | "writing" | "ready" | "queued" | "error";
  error?: string;
  jobIds: string[];
  /** content plan rows: their own star (instead of the batch's), the site set the pictures go into, and the face pass */
  charId?: string;
  toSet?: { title: string; tier: "free" | "premium" };
  faceFix?: boolean;
  /** a saved CivitAI scene prompt to borrow the setting, light, camera and finish from (never its person) */
  inspo?: string;
  /** this row's own expression and head angle (so a set isn't the same face over and over) */
  expression?: string;
  /** Swap in (run from this page): what it's doing now, the finished pictures, the face check's score */
  step?: string;
  results?: string[];
  score?: number;
  /** Recreate: a CivitAI post made again with its own prompt (in `prompt`, editable), settings and LoRAs */
  civit?: import("./api").CivitGen;
  /** a line under the row (e.g. which LoRAs were turned down) */
  note?: string;
  /** this row's own LoRAs (Cosplay: the character's approved LoRA), on top of Create's / the star's */
  loras?: import("./graphs").LoraPick[];
  /** never the batch's Star (Cosplay: a new woman in each picture) */
  noStar?: boolean;
  /** always a photo (Krea 2), whatever Create's style is (Cosplay) */
  realistic?: boolean;
  /** copy a pose through its depth (PoseWear): the picture on the rental, how strongly, and whether its depth is worked out first */
  control?: { image: string; strength: number; estimate: boolean };
  /** the PoseWear pose (its picture, for a character made from her sheet: then the pose goes in as a reference picture) */
  pose?: import("./posewear").PwPick;
  /** which "Add to batch" press made this row (so one press can be taken back) */
  group?: { id: string; label: string };
  /** what this row actually sent last time (Copy debug) */
  debug?: Record<string, unknown>;
}
let groupN = 0;
export const newGroup = (label: string) => ({ id: `g${Date.now().toString(36)}${groupN++}`, label });
/** the presses that added rows, newest last (Undo takes back the newest that still has waiting rows) */
export function addGroups(): { id: string; label: string; n: number }[] {
  const m = new Map<string, { id: string; label: string; n: number }>();
  for (const r of useBatch.getState().rows) if (r.group && r.status !== "queued") { const g = m.get(r.group.id) ?? { ...r.group, n: 0 }; g.n++; m.set(r.group.id, g); }
  return [...m.values()];
}
export function undoGroup(id: string) { useBatch.setState((s) => ({ rows: s.rows.filter((r) => !(r.group?.id === id && r.status !== "queued")) })); }
/** waiting rows that are exact copies of an earlier one (same prompt and words) */
export function removeDuplicates(): number {
  const seen = new Set<string>(); let n = 0;
  useBatch.setState((s) => ({ rows: s.rows.filter((r) => {
    if (r.status === "queued") return true;
    const k = `${r.idea}\n${r.prompt}\n${r.imitate?.url ?? ""}\n${r.civit?.id ?? ""}`;
    if (!r.prompt.trim() && !r.idea.trim() && !r.imitate && !r.civit) return true;
    if (seen.has(k)) { n++; return false; }
    seen.add(k); return true;
  }) }));
  return n;
}
export function clearWaiting() { useBatch.setState((s) => ({ rows: s.rows.filter((r) => r.status === "queued") })); }
export interface BatchOpts {
  target: "video" | "image";
  characterId: string | null;
  seconds: number;
  aspect: "16:9" | "9:16" | "1:1";
  mp: number;
  useClipSound: boolean;
  /** pictures: several stars — every picture to copy is made with each of them */
  stars?: string[];
  /** pictures to copy: only the face (and hair) becomes the star's, or the whole person with their outfit */
  take?: "face" | "person" | "swap";
  /** Swap in: their own outfit, or the clothes in the picture */
  swapOutfit?: "theirs" | "picture";
  /** pictures: where the results go (a site set of each star), and the face pass */
  setTitle?: string;
  tier?: "free" | "premium";
  faceFix?: boolean;
  /** Recreate (CivitAI posts): see RecreatePrefs */
  rec?: RecreatePrefs;
}
/** Recreate: how the posts are made again. The look stays as posted; the framing can rotate through a mix (so a set
 *  isn't all one shot), and a change typed once (a background, an outfit, the light) goes into every post. */
export interface RecreatePrefs {
  frame: "posted" | "mix";
  frames: FrameId[];
  change: Partial<Record<"setting" | "outfit" | "lighting", string>>;
  /** the project (character) the results go to; "" = Free work */
  project: string;
  /** "mine" (default): your Create settings (checkpoint, sampler, steps, shape, size, finish) — only the post's words and
   *  LoRAs come over · "post": the post's own sampler / steps / CFG and shape */
  settings?: "mine" | "post";
}
export type FrameId = "full" | "chest" | "face" | "selfie" | "knees";
export const FRAMES: { id: FrameId; label: string; sentence: string; tags: string }[] = [
  { id: "full", label: "Full body", sentence: "Full-body shot, the whole person in frame from head to feet, camera at chest height.", tags: "full body, wide shot" },
  { id: "chest", label: "Chest up", sentence: "Medium close-up from the chest up, camera at eye level.", tags: "upper body, portrait" },
  { id: "face", label: "Face close-up", sentence: "Close-up of the face and shoulders.", tags: "close-up, face focus, portrait" },
  { id: "selfie", label: "Selfie from above", sentence: "A selfie taken at arm's length from slightly above, looking up into the camera.", tags: "selfie, from above, looking at viewer" },
  { id: "knees", label: "Knees up", sentence: "Three-quarter shot from the knees up.", tags: "cowboy shot" },
];
const REC_KEY = "h3.batch.recreate";
export const DEFAULT_REC: RecreatePrefs = { frame: "mix", frames: ["full", "chest", "selfie", "face"], change: {}, project: "" };
export function loadRec(): RecreatePrefs { try { return { ...DEFAULT_REC, ...JSON.parse(localStorage.getItem(REC_KEY) || "{}") }; } catch { return DEFAULT_REC; } }
export function saveRec(r: RecreatePrefs) { try { localStorage.setItem(REC_KEY, JSON.stringify(r)); } catch { /* private mode */ } }
/** which character each CivitAI post became (New character from it) — its later recreations go straight there */
const LINK_KEY = "h3.batch.postChar";
export function postCharacter(civitId: number): string | null { try { return (JSON.parse(localStorage.getItem(LINK_KEY) || "{}") as Record<string, string>)[String(civitId)] ?? null; } catch { return null; } }
export function linkPostCharacter(civitId: number, charId: string) {
  try { const m = JSON.parse(localStorage.getItem(LINK_KEY) || "{}"); m[String(civitId)] = charId; localStorage.setItem(LINK_KEY, JSON.stringify(m)); } catch { /* */ }
}
/** a post's prompt for one take: the framing swapped for this take's (when mixing) and your changes put in place of
 *  the matching pieces — everything else (the look, outfit, pose) word for word */
export async function recreatePrompt(prompt: string, rec: RecreatePrefs, frame: FrameId | null): Promise<string> {
  const { toPieces, fromPieces, isTagPrompt, pid } = await import("./tweak");
  const tags = isTagPrompt(prompt);
  let ps = toPieces(prompt);
  for (const cat of ["setting", "outfit", "lighting"] as const) {
    const want = rec.change[cat]?.trim();
    if (!want) continue;
    const at = ps.findIndex((x) => x.cat === cat);
    ps = ps.filter((x) => x.cat !== cat);
    const piece = { id: pid(), cat, text: tags ? want : want.replace(/\.?$/, ".") };
    ps.splice(at < 0 ? ps.length : Math.min(at, ps.length), 0, piece);
  }
  if (frame) {
    const f = FRAMES.find((x) => x.id === frame)!;
    // the post's own shot words go, wherever they sit ("This is a close-up photograph of…" + "Full-body shot" contradicted itself)
    const SHOT = /\b(?:extreme\s+)?close[- ]?up\b|\bfull[- ]body\b|\bupper[- ]body\b|\bcowboy shot\b|\bmedium (?:close-up |)shot\b|\bwide shot\b|\bhead(?:-and-|\s+and\s+)shoulders\b/gi;
    ps = ps.map((x) => (x.cat === "camera" ? x : { ...x, text: x.text.replace(SHOT, "").replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/\ba\s+(photograph|photo|portrait|shot)\b/gi, "a $1") }))
      .filter((x) => x.text.replace(/[\s,.]/g, "").length > 0);
    // camera pieces out — except lens/look words that aren't framing (35mm, depth of field, bokeh)
    ps = ps.filter((x) => x.cat !== "camera" || /\b(\d+mm|lens|depth of field|bokeh|blurry background|film|looking at|eye contact)\b/i.test(x.text) && !/\b(close.?up|full body|upper body|cowboy|portrait|selfie|from above|from below|wide shot|medium shot)\b/i.test(x.text));
    ps.push({ id: pid(), cat: "camera", text: tags ? f.tags : f.sentence });
  }
  return fromPieces(ps, tags);
}
interface BatchState extends BatchOpts {
  rows: Row[];
  set: (p: Partial<BatchOpts>) => void;
  add: (p?: Partial<Row>) => void;
  update: (id: string, p: Partial<Row>) => void;
  remove: (id: string) => void;
  clearDone: () => void;
}
let n = 0;
export const newRow = (p: Partial<Row> = {}): Row => ({ id: `b${Date.now().toString(36)}${n++}`, imitate: null, idea: "", prompt: "", takes: 1, status: "new", jobIds: [], ...p });

export const useBatch = create<BatchState>((set) => ({
  target: (() => { try { return localStorage.getItem("h3.batch.target") === "video" ? "video" : "image"; } catch { return "image"; } })(), characterId: null, seconds: 8, aspect: "9:16", mp: 0.6, useClipSound: true,
  rows: [newRow()],
  rec: loadRec(),
  set: (p) => { if (p.target) try { localStorage.setItem("h3.batch.target", p.target); } catch { /* private mode */ } if (p.rec) saveRec(p.rec); set(p); },
  add: (p) => set((s) => ({ rows: [...s.rows, newRow(p)] })),
  update: (id, p) => set((s) => ({ rows: s.rows.map((r) => (r.id === id ? { ...r, ...p } : r)) })),
  remove: (id) => set((s) => ({ rows: s.rows.filter((r) => r.id !== id) })),
  clearDone: () => set((s) => ({ rows: s.rows.filter((r) => r.status !== "queued") })),
}));

const character = (r?: Row) => { if (r?.noStar) return null; const id = r?.charId ?? useBatch.getState().characterId; const c = useCharacters.getState().list.find((x) => x.id === id) ?? null; return c && isAdult(c) ? c : null; };
const rowSeconds = (r: Row) => (r.imitate?.kind === "video" && r.imitate.duration ? Math.min(15, Math.max(2, Math.round(r.imitate.duration))) : useBatch.getState().seconds);

/** the character's sheet views (front, face) + the row's thing to imitate, as references */
async function refsFor(r: Row) {
  const c = character(r);
  const pics: { file: string; tag: string; label: string }[] = [];
  if (c) {
    for (const v of ["front", "face"] as View[]) {
      const m = await useCharacters.getState().asMedia(c.id, v);
      if (m) pics.push({ file: m.name, tag: `<Picture ${pics.length + 1}>`, label: `${c.name} — ${v === "front" ? "full body" : "face"}` });
    }
  }
  const videos: { file: string; tag: string; label: string; start: number; end: number; useSound: boolean }[] = [];
  if (r.imitate?.kind === "image") pics.push({ file: r.imitate.name, tag: `<Picture ${pics.length + 1}>`, label: "pose, framing and scene to copy" });
  if (r.imitate?.kind === "video") videos.push({ file: r.imitate.name, tag: "<Video 1>", label: "moves, timing and camera to copy", start: 0, end: rowSeconds(r), useSound: useBatch.getState().useClipSound && !!r.imitate.has_audio });
  return { c, pics, videos };
}

function defaultIdea(r: Row, cName: string | null, pics: { tag: string }[]) {
  const who = cName ? `${cName} (<Picture 1>)` : "the person";
  if (r.imitate?.kind === "video") return `${who} performs exactly what happens in <Video 1> — same moves, timing, framing and camera.`;
  if (r.imitate?.kind === "image") return `${who} in the pose, framing and setting of ${pics[pics.length - 1].tag}, with natural movement.`;
  return "";
}

/** step 1 (videos): have the writer turn every row without a prompt into an H3 timeline */
export async function writePrompts() {
  const { rows, update } = useBatch.getState();
  const todo = rows.filter((r) => !r.prompt.trim() && (r.idea.trim() || r.imitate) && r.status !== "writing");
  for (const r of todo) {
    try {
      const { c, pics, videos } = await refsFor(r);
      const idea = [r.idea.trim(), defaultIdea(r, c?.name ?? null, pics)].filter(Boolean).join(" ");
      const pw = await planWriter(useSettings.getState().s.prompt.guide, DEFAULTS.prompt.guide, useBigPlanner());
      const g = buildPromptHelper({
        pictures: pics, videos, audios: [], idea,
        characters: c ? [{ name: c.name, look: look(c), tags: pics.filter((x) => x.label.startsWith(`${c.name} — `)).map((x) => x.tag) }] : undefined, seconds: rowSeconds(r), cuts: 0, camera: "auto",
        mode: "reference-to-video", guide: pw.guide, writer: pw.writer, seed: newSeed(),
      });
      const job = await useJobs.getState().run("batch", `Writing prompt ${rows.indexOf(r) + 1}`, g, `prompt:${videos.length}v`, { batchRow: r.id, kind: "write", seconds: rowSeconds(r) });
      update(r.id, { status: "writing", jobIds: [job.id], error: undefined });
    } catch (e) { update(r.id, { status: "error", error: (e as Error).message }); }
  }
  return todo.length;
}

/** pictures: rows that are just an idea (no picture to copy, no prompt yet) → a full Krea 2 prompt each, in the row's
 *  prompt box to check before queueing. With the "Grok tab" writer they all go to Grok as one message. */
export function picturesToWrite(): Row[] {
  const b = useBatch.getState();
  if (b.target !== "image") return [];
  return b.rows.filter((r) => !r.imitate && !r.prompt.trim() && (r.idea.trim() || r.inspo) && r.status !== "writing" && r.status !== "queued"
    && (character(r) ? character(r)!.style !== "anime" : useSettings.getState().s.create.style !== "anime"));
}
export async function writePicturePrompts(): Promise<number> {
  const { update, aspect } = useBatch.getState();
  const todo = picturesToWrite();
  const shape = aspect === "16:9" ? "16:9" : aspect === "1:1" ? "1:1" : "9:16";
  const one = async (r: Row) => {
    update(r.id, { status: "writing", error: undefined });
    try {
      const c = character(r);
      const out = await runWriter("krea", { character: c ? looks(c) : "An adult person exactly as FRAME describes them (no fixed character — describe them from FRAME).",
        frame: r.idea.trim() || "Take the pose and moment from INSPIRATION.", aspect: shape, inspiration: r.inspo ?? "", expression: r.expression ?? "" },
        { tab: "batch", label: `Batch ${useBatch.getState().rows.indexOf(r) + 1}${c ? ` · ${c.name}` : ""}: ${(r.idea.trim() || "from a saved scene").slice(0, 60)}`, big: true });
      update(r.id, { prompt: out, status: "ready" });
    } catch (e) { update(r.id, { status: "new", error: (e as Error).message === "Cancelled" ? undefined : (e as Error).message }); }
  };
  // the Grok tab answers them all from one message, so ask for all at once; the local writer goes one by one
  if (writerOutside()) await Promise.all(todo.map(one));
  else for (const r of todo) await one(r);
  return todo.length;
}

// when a writing job finishes, put its timeline into the row
const consumed = new Set<string>();
useJobs.subscribe((s) => {
  for (const j of s.jobs) {
    if (j.tab !== "batch" || j.meta?.kind !== "write" || consumed.has(j.id) || (j.status !== "done" && j.status !== "error")) continue;
    consumed.add(j.id);
    const id = j.meta.batchRow as string;
    if (j.status === "error") { useBatch.getState().update(id, { status: "error", error: j.error }); continue; }
    if (Object.entries(j.texts).some(([k, v]) => k.startsWith("seen:") && v.includes(MINOR_FLAG))) {
      useBatch.getState().update(id, { status: "error", error: "Stopped: someone in this clip may be under 18. Use a clip with adults only." });
      continue;
    }
    const t = parseTimeline(j.texts.timeline ?? "", (j.meta.seconds as number) ?? 8);
    const text = t.cuts.some((c) => c.text) ? toPrompt(t) : (j.texts.timeline ?? "").trim();
    useBatch.getState().update(id, { prompt: text, status: text ? "ready" : "error", error: text ? undefined : "The writer returned nothing — write the prompt yourself or try again" });
  }
});

/** why a row can't be queued yet (undefined = fine) */
export function rowProblem(r: Row): string | undefined {
  const b = useBatch.getState();
  if (b.target === "video") {
    if (!r.prompt.trim()) return r.status === "writing" ? "Writing…" : "Needs a prompt — press Write prompts or type one";
    if (!character(r) && !r.imitate) return "Pick a character or add something to imitate";
  } else {
    if (r.civit) return r.prompt.trim() ? undefined : "Its prompt is empty — type one";
    if (!r.idea.trim() && !r.prompt.trim() && !r.inspo && !(r.imitate && (character(r) || b.stars?.length))) return "Describe it, or add a picture to copy plus a character";
  }
  return undefined;
}

/** step 2: queue everything on the instance; returns the number of jobs */
/** a content-plan row's extras on its jobs: the face pass (as that character) and the site set the results go into */
const extra = (r: Row, c: { id: string } | null) => ({
  ...(r.idea ? { idea: r.idea } : {}),
  ...(r.faceFix ? { faceFix: { character: c?.id ?? null, strength: 0.45 } } : {}),
  ...(r.toSet && c ? { toSet: { charId: c.id, ...r.toSet } } : {}),
});

/** Content plan: every character × background × pose becomes a row (pictures), with its site set and the face pass */
export function planRows(o: { charIds: string[]; themes: string[]; poses: string[]; takes: number; tier: "free" | "premium"; faceFix: boolean;
  /** saved CivitAI scenes to use instead of typed backgrounds (each becomes its own site set) */
  scenes?: { text: string; title: string }[]; vary?: boolean;
  /** how many poses each scene gets, taken in turn from the pose list (0 = every pose) */
  posesPer?: number }): number {
  const themes = o.themes.map((t) => t.trim()).filter(Boolean);
  const poses = o.poses.map((t) => t.trim()).filter(Boolean);
  const places: { theme: string; inspo?: string; title: string }[] = o.scenes?.length
    ? o.scenes.map((x) => ({ theme: "", inspo: x.text, title: x.title }))
    : (themes.length ? themes : [""]).map((t) => ({ theme: t, title: t ? t.replace(/^\w/, (x) => x.toUpperCase()) : "New pictures" }));
  const rows: Partial<Row>[] = [];
  let k = Math.floor(Math.random() * 50);
  let turn = Math.floor(Math.random() * Math.max(1, poses.length));
  const posesOf = () => {
    if (!poses.length) return [""];
    if (!o.posesPer || o.posesPer >= poses.length) return poses;
    return Array.from({ length: o.posesPer }, () => poses[turn++ % poses.length]);
  };
  for (const charId of o.charIds) for (const pl of places) for (const pose of posesOf()) {
    const idea = [pose, pl.theme && `setting: ${pl.theme}`].filter(Boolean).join(". ");
    if (!idea && !pl.inspo) continue;
    rows.push({ charId, idea, inspo: pl.inspo, expression: o.vary === false ? undefined : expressionFor(k++), takes: o.takes, faceFix: o.faceFix, toSet: { title: pl.title, tier: o.tier } });
  }
  const b = useBatch.getState();
  b.set({ target: "image" });
  const empty = b.rows.filter((r) => !r.imitate && !r.idea.trim() && !r.prompt.trim());
  useBatch.setState((s) => ({ rows: [...s.rows.filter((r) => !empty.includes(r)), ...rows.map((p) => newRow(p))] }));
  return rows.length;
}

/** saved scenes, exact pose: each saved CivitAI picture itself becomes a row, and the character is swapped into it (its
 *  pose, framing, light and place stay exactly; their sheet picture at the same angle goes in) */
export async function planExactRows(o: { charIds: string[]; items: { url: string; title: string }[]; tier: "free" | "premium"; faceFix: boolean; onStep?: (t: string) => void }): Promise<number> {
  const { useTray } = await import("./tray");
  const pics: { m: Media; title: string }[] = [];
  for (const [i, it] of o.items.entries()) {
    o.onStep?.(`Fetching saved picture ${i + 1}/${o.items.length}…`);
    try { pics.push({ m: await useTray.getState().addUrl(it.url), title: it.title }); } catch { /* gone from CivitAI: skipped */ }
  }
  const rows: Row[] = [];
  for (const charId of o.charIds) for (const p of pics) rows.push(newRow({ charId, imitate: p.m, idea: "", takes: 1, faceFix: o.faceFix, toSet: { title: p.title, tier: o.tier } }));
  const b = useBatch.getState();
  b.set({ target: "image", take: "swap" });
  const empty = b.rows.filter((r) => !r.imitate && !r.idea.trim() && !r.prompt.trim());
  useBatch.setState((s) => ({ rows: [...s.rows.filter((r) => !empty.includes(r)), ...rows] }));
  return rows.length;
}

let recTurn = 0;
/** a row made from a CivitAI picture or clip ("CivitAI 12345" in the tray): mark the post as used — animated (videos) or
 *  swapped (pictures) — with the characters it was made for */
function noteRowUse(r: Row, b: BatchState, charId: string | null, stars?: (string | null)[]) {
  const m = /^CivitAI (\d+)$/.exec(r.imitate?.label ?? "");
  if (!m) return;
  const who = stars?.length ? stars : [charId ?? r.charId ?? b.characterId];
  import("./civitUsed").then(({ noteUsed }) => noteUsed([m[1]], b.target === "video" ? "animate" : "swap", who, r.takes)).catch(() => {});
}
export async function queueAll(only?: string[]): Promise<number> {
  // rows from saved scenes (or with their own expression) need their prompt written first
  if (useBatch.getState().target === "image" && picturesToWrite().some((r) => r.inspo || r.expression)) await writePicturePrompts();
  const b = useBatch.getState();
  const st = useSettings.getState().s;
  const ids: string[] = [];
  const ready = b.rows.filter((r) => r.status !== "queued" && !rowProblem(r) && (!only || only.includes(r.id)));
  // Swap in: the Edit chat pipeline (Qwen + Krea + face pass) for each picture, run one by one from this page
  const swaps: import("./batchSwap").SwapItem[] = [];
  const swapping = b.target === "image" && (b.take ?? "swap") === "swap";
  if (swapping && ready.some((r) => r.imitate?.kind === "image")) {
    const { useDownloads } = await import("./downloads");
    const q = useDownloads.getState().groups.find((g) => g.id === "qwen");
    if (q && q.state !== "done") throw new Error(`Swap in needs the Edit chat helper (Qwen-Image-Edit) — it's ${q.state === "downloading" ? `downloading, ${q.pct}%` : q.state === "error" ? "failed to download (status menu → Retry)" : "in line"}. Pick Face only or Whole person meanwhile.`);
  }
  for (const r of ready) {
    const rowIds: string[] = [];
    // Recreate: a CivitAI post again, as posted — its prompt, settings and its own LoRAs, a new seed per take
    if (b.target === "image" && r.civit) {
      try {
        useBatch.getState().update(r.id, { step: "Getting its LoRAs…" });
        const { recreatePlan, exactPrompt } = await import("./civitUse");
        const rec = b.rec ?? DEFAULT_REC;
        const pl = await recreatePlan(r.civit, (m) => useBatch.getState().update(r.id, { step: m }), rec.settings ?? "mine");
        const frames = rec.frame === "mix" && rec.frames.length ? rec.frames : null;
        // where the results go: this row's own pick, else the character this post became, else the batch's choice
        const project = r.charId ?? postCharacter(r.civit.id) ?? (rec.project || null);
        for (let t = 0; t < r.takes; t++) {
          const seed = t === 0 && pl.seed ? pl.seed : newSeed();
          const frame = frames ? frames[(recTurn++) % frames.length] : null;
          const words = await recreatePrompt(r.prompt, rec, frame);
          const fl = frame ? FRAMES.find((x) => x.id === frame)!.label.toLowerCase() : "";
          const job = await useJobs.getState().run("batch", `Recreate ${b.rows.indexOf(r) + 1}${r.takes > 1 ? ` · take ${t + 1}` : ""}${fl ? ` · ${fl}` : ""}`, buildCreate({
            ...pl.adv, seed, ...modelArgs(st.create, pl.mi), positive: exactPrompt(words), negative: pl.negative, loras: pl.loras,
            width: pl.width, height: pl.height, count: 1, hires: pl.hires, cutout: false, prefix: "studio/batch/recreate",
          }), `create:${pl.mi.model}:portrait:1${pl.up > 1.01 ? `:x${pl.up}` : ""}`, { batchRow: r.id, kind: "make", civitId: r.civit.id, civitThumb: r.civit.thumb || r.civit.url, project, sent: { prompt: exactPrompt(words), words, negative: pl.negative, model: pl.mi.label, checkpoint: pl.checkpoint,
            loras: pl.loras.map((l) => ({ name: l.name, strength: l.strength })), size: `${pl.width}×${pl.height}${pl.hires ? ` → ${Math.round(pl.width * pl.up / 16) * 16}×${Math.round(pl.height * pl.up / 16) * 16}` : ""}`, seed, steps: pl.adv.steps, cfg: pl.adv.cfg, sampler: pl.adv.sampler, scheduler: pl.adv.scheduler } });
          rowIds.push(job.id); ids.push(job.id);
        }
        import("./civitUsed").then(({ noteUsed }) => noteUsed([r.civit!.id], "recreate", [project], r.takes)).catch(() => {});
        useBatch.getState().update(r.id, { status: "queued", jobIds: rowIds, step: undefined, error: pl.failed.length ? `Without ${pl.failed.length} LoRA${pl.failed.length > 1 ? "s" : ""} it couldn't download: ${pl.failed.join("; ")}` : undefined,
          note: pl.balanced.length ? `LoRAs balanced so they don't overcook the picture: ${pl.balanced.join(", ")}` : undefined });
      } catch (e) { useBatch.getState().update(r.id, { status: "error", step: undefined, error: (e as Error).message }); }
      continue;
    }
    try {
      const { c, pics, videos } = await refsFor(r);
      for (let t = 0; t < r.takes; t++) {
        let job: Job;
        if (b.target === "video") {
          const secs = rowSeconds(r);
          const { width, height } = h3Size(b.aspect, b.mp);
          const o: AnimateOpts = {
            ...st.animate.adv, seed: newSeed(), mode: "ref", prompt: r.prompt, seconds: secs, width, height, turbo: false, loras: st.animate.loras,
            refImageSize: st.animate.refImageSize, lowMemDecode: st.animate.lowMemDecode, prefix: "studio/batch/h3",
            images: pics.map((p) => p.file), videos: videos.map((v) => ({ file: v.file, start: v.start, end: v.end, useSound: v.useSound })), audios: [],
          };
          job = await useJobs.getState().run("batch", `Batch ${b.rows.indexOf(r) + 1}${r.takes > 1 ? ` · take ${t + 1}` : ""} · ${secs} s`, buildAnimate(o), `animate:ref:full:${secs}s:${b.mp}`, { batchRow: r.id, kind: "make", opts: o, frames: h3Frames(secs) });
        } else if (r.imitate?.kind === "image") {
          // copy the picture with each star: only their face and hair (default), or the whole person in their own outfit
          const stars = !r.charId && b.stars?.length
            ? b.stars.map((id) => useCharacters.getState().list.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x && isAdult(x))
            : [c];
          if (swapping) {
            const toSet = r.toSet ?? (b.setTitle?.trim() ? { title: b.setTitle.trim(), tier: b.tier ?? "premium" } : undefined);
            for (const who of stars) if (who) swaps.push({ row: r, who, outfit: b.swapOutfit ?? "theirs", toSet });
            if (!stars.some(Boolean)) throw new Error("Pick a character to swap in (Star, or tick them under Photo set)");
            useBatch.getState().update(r.id, { status: "queued", jobIds: [], error: undefined, step: "Waiting its turn", results: [] });
            noteRowUse(r, b, null, stars.map((x) => x?.id ?? null));
            continue;
          }
          for (const who of stars) {
            // their sheet picture at the same angle as the picture they go into (front only when nothing better fits)
            const view = who && r.imitate ? await (await import("./editchat")).viewFor(who, r.imitate, r.idea) : "front";
            const front = who ? await useCharacters.getState().asMedia(who.id, view) : null;
            const engine = "krea" as const;
            const noun = who?.gender === "male" ? "man" : who?.gender === "female" ? "woman" : "person";
            // Krea 2: picture 1 = the picture being redone, picture 2 = the person to put in
            const images = !front ? [r.imitate.name] : [r.imitate.name, front.name];
            const extraWords = r.idea.trim() ? ` ${r.idea.trim().replace(/\.?$/, ".")}` : "";
            const instruction = !front ? (r.idea.trim() || "Improve this picture.")
              : (b.take ?? "face") === "face"
                ? `Change only the face and hair of the ${noun} in this picture so they become the ${noun} from the second picture: exactly their face, eye colour, eyebrows, nose, lips, skin tone, hairstyle and hair colour. Keep everything else in this picture exactly as it is — body, outfit, pose, hands, expression, camera, lighting, colours and background.${extraWords} Only one ${noun} in the picture. Everyone is an adult.`
                : `Replace the ${noun} in this picture with the ${noun} from the second picture: keep this picture's exact pose, framing, setting and lighting, and keep the second ${noun}'s face, hair, body and outfit exactly the same.${extraWords} Only one ${noun} in the picture. Everyone is an adult.`;
            const rr: Row = { ...r, faceFix: r.faceFix || b.faceFix, toSet: r.toSet ?? (b.setTitle?.trim() ? { title: b.setTitle.trim(), tier: b.tier ?? "premium" } : undefined) };
            job = await useJobs.getState().run("batch", `Batch ${b.rows.indexOf(r) + 1}${who ? ` · ${who.name}` : ""} · picture`, buildEdit({ ...editArgs(st.edit, engine), enhance: false, seed: newSeed(), images, instruction, negative: "", resolution: 1024, prefix: "studio/batch/edit" }), "edit:batch", { batchRow: r.id, kind: "make", ...extra(rr, who) });
            rowIds.push(job.id); ids.push(job.id);
          }
          noteRowUse(r, b, null, stars.map((x) => x?.id ?? null));
          continue;
        } else {
          const anime = !r.realistic && (c ? c.style === "anime" : st.create.style === "anime");
          const text = r.prompt.trim() || r.idea.trim();
          const mi = modelOf(st.create, anime ? "anime" : "realistic");
          // a written Krea 2 prompt (Write prompts) already carries the character's look word for word
          const positive = anime
            ? `${qualityTags(mi)}, ${c ? `${animeTags(c)}, ` : ""}${text}`
            : r.prompt.trim() ? r.prompt.trim() : `${c ? `A photo of ${looks(c).replace(/^A /, "a ")} ` : ""}${text}${r.expression ? `. ${r.expression}.` : ""}`;
          const adv = mi.adv;
          const [w0, h0] = b.aspect === "16:9" ? (anime ? [1216, 832] : [1920, 1088]) : b.aspect === "1:1" ? (anime ? [1024, 1024] : [1440, 1440]) : (anime ? [832, 1216] : [1088, 1920]); // Krea 2: ~2 MP, as the community makes them
          // Create's Draft size (~1 MP, twice as fast) carries over to Batch — make many, upscale the keepers in 07 Upscale
          const dr = !anime && useSettings.getState().s.create.draft;
          const [w, h] = dr ? [Math.round(w0 * 0.72 / 16) * 16, Math.round(h0 * 0.72 / 16) * 16] : [w0, h0];
          if (c && !anime && c.views.front) {
            // a character: a new picture from their sheet view closest to the shot's angle (Krea 2 Identity Edit), so the face is
            // theirs and the pose, angle and expression are the row's own — not a description-only guess at them
            const shot = r.prompt.trim() || [text, r.expression].filter(Boolean).join(". ");
            const { characterShot } = await import("./make");
            const cs = await characterShot(c, shot, shot, b.aspect, r.loras ?? [], null);
            // a PoseWear pose: its depth steers her body on the blank canvas (experimental — see Copy debug)
            if (r.control) await (await import("./posewear")).depthReady();
            const named = r.idea.replace(/^(Cosplay|Pose) · /, "").slice(0, 50);
            job = await useJobs.getState().run("batch", `Batch ${b.rows.indexOf(r) + 1} · ${c.name}${named ? ` · ${named}` : ""} · ${cs.view}`, buildEdit({ ...editArgs(st.edit, "krea"), loras: cs.loras, enhance: false, seed: newSeed(),
              images: [cs.ref.name], blank: cs.canvas, instruction: cs.instruction, negative: "", resolution: 1024, refBoost: 4, prefix: "studio/batch/create", control: r.control }), "edit:krea:1:raw", { batchRow: r.id, kind: "make", ...extra(r, c) });
            useBatch.getState().update(r.id, { debug: { path: "character sheet (Krea 2 Identity Edit on a blank canvas)", character: c.name, view: cs.view, reference: cs.ref.name, pose: r.pose?.title ?? null,
              poseImage: r.control?.image ?? null, poseDepth: r.control ? (r.control.estimate ? "worked out from the pose picture" : "depth map as given") : null, poseStrength: r.control?.strength ?? null,
              loras: cs.loras.map((l) => `${l.name} @${l.strength}`), instruction: cs.instruction.slice(0, 600), canvas: `${cs.canvas.width}×${cs.canvas.height}` } });
            rowIds.push(job.id); ids.push(job.id);
            continue;
          }
          if (r.control && !anime) await (await import("./posewear")).depthReady();
          const named = r.idea.replace(/^(Cosplay|Pose) · /, "").slice(0, 60);
          job = await useJobs.getState().run("batch", `Batch ${b.rows.indexOf(r) + 1} · ${named || "picture"}`, buildCreate({
            ...adv, seed: newSeed(), ...modelArgs(st.create, mi), positive, negative: st.create.negative, loras: [...(c?.loras ?? []), ...mi.loras, ...(r.loras ?? [])],
            width: w, height: h, count: 1, cutout: false, prefix: "studio/batch/create", control: !anime && r.control ? r.control : undefined,
          }), `create:${anime ? "anime" : "realistic"}:portrait:1`, { batchRow: r.id, kind: "make", ...extra(r, c) });
          useBatch.getState().update(r.id, { debug: { path: anime ? "anime text-to-picture" : "Krea 2 text-to-picture", character: c?.name ?? null, model: mi.label, size: `${w}×${h}`,
            pose: r.pose?.title ?? null, poseImage: !anime && r.control ? r.control.image : null, poseDepth: !anime && r.control ? (r.control.estimate ? "worked out from the pose picture" : "depth map as given") : r.control ? "skipped (anime)" : null,
            poseStrength: !anime && r.control ? r.control.strength : null, loras: [...(c?.loras ?? []), ...mi.loras, ...(r.loras ?? [])].map((l) => `${l.name} @${l.strength}`), prompt: positive.slice(0, 900) } });
        }
        rowIds.push(job.id); ids.push(job.id);
      }
      useBatch.getState().update(r.id, { status: "queued", jobIds: rowIds, error: undefined });
      noteRowUse(r, b, c?.id ?? null);
    } catch (e) { useBatch.getState().update(r.id, { status: "error", error: (e as Error).message }); }
  }
  if (swaps.length) (await import("./batchSwap")).startSwaps(swaps);
  if (ids.length) await watchJobs(ids, `Batch done: ${ids.length} ${b.target === "video" ? "video" : "picture"}${ids.length > 1 ? "s" : ""}`);
  return ids.length + swaps.length;
}

/** CivitAI posts → Recreate rows (Batch → Pictures): each post's prompt, settings and LoRAs, made again in bulk */
export async function addRecreateRows(ids: (number | string)[], takes = 2, onStep?: (t: string) => void): Promise<{ added: number; skipped: number }> {
  const { civitImage } = await import("./api");
  const { cleanPrompt } = await import("./civitUse");
  let added = 0, skipped = 0;
  for (const [i, id] of ids.entries()) {
    onStep?.(`Reading ${i + 1} of ${ids.length}…`);
    try {
      const g = await civitImage(String(id));
      const prompt = cleanPrompt(g.prompt || g.workflow?.prompt || "");
      if (g.video || !prompt) { skipped++; continue; }
      useBatch.getState().add({ civit: g, prompt, takes, status: "ready" });
      added++;
    } catch { skipped++; }
  }
  const b = useBatch.getState();
  b.set({ target: "image" });
  const empty = b.rows.filter((r) => !r.imitate && !r.civit && !r.idea.trim() && !r.prompt.trim());
  if (added && empty.length) useBatch.setState((s) => ({ rows: s.rows.filter((r) => !empty.includes(r)) }));
  return { added, skipped };
}

/** a post became a character: every result recreated from it moves into their project, and later ones go there too */
export async function postToCharacter(civitId: number, charId: string): Promise<number> {
  linkPostCharacter(civitId, charId);
  const { moveResults } = await import("./move");
  const items = useJobs.getState().jobs.filter((j) => j.meta?.civitId === civitId)
    .flatMap((j) => j.outputs.filter((o) => o.type === "output").map((o) => ({ jobId: j.id, filename: o.filename, subfolder: o.subfolder })));
  return items.length ? moveResults(items, charId) : 0;
}
