// Video board: one box per character (or per set of pictures), each with its own pictures and a few words of its own,
// under one shared prompt. "Make videos" plans every ticked box with the video writer and lines up its takes — no
// copying between Plan a video and Animate. Each box's videos are filed under its character's project (05 Animate
// shows them when that character is open), and stack as one tile per run. Remembered with your settings.
import { create } from "zustand";
import { loadState, saveState, type FileRef } from "./api";
import { buildAnimate, buildPromptHelper, MINOR_FLAG, type AnimateOpts, type LoraPick } from "./graphs";
import { useJobs, waitForJob } from "./jobs";
import { h3ErosOn, h3Size, h3SizeFor } from "./models";
import { DEFAULTS, newSeed, useSettings, type Music } from "./settings";
import { isAdult, useCharacters, type Character } from "./characters";
import { look } from "./charVideo";
import { parseTimeline, toPrompt } from "./timeline";
import { planWriter, useBigPlanner } from "./packs";
import { rayVideoCards } from "./cards";
import { useSpeed } from "./speed";
import { stopMessage } from "./adult";
import type { Media } from "./tray";

/** how many videos of each type one Make videos gives a box (e.g. 2 seamless loops + 2 image → video) */
export interface Mix { ref: number; i2v: number; loop: number }
export const MIX_KINDS: { k: keyof Mix; label: string; short: string; hint: string }[] = [
  { k: "i2v", label: "Image → video", short: "Image → video", hint: "starts on the box's first picture" },
  { k: "loop", label: "Seamless loop", short: "Loop", hint: "starts and ends on the first picture, so it plays round and round" },
  { k: "ref", label: "References", short: "References", hint: "every picture in the box guides the video" },
];
export const mixTotal = (m: Mix) => m.ref + m.i2v + m.loop;
export const mixLabel = (m: Mix) => MIX_KINDS.filter((x) => m[x.k]).map((x) => `${m[x.k]} ${x.short.toLowerCase()}`).join(" + ") || "nothing";

export interface BoardRun {
  id: string; at: number;
  /** the video type of this run's takes */
  mode?: keyof Mix;
  status: "planning" | "queued" | "error";
  words: string; plan?: string; error?: string;
  takes: number; jobIds: string[];
  /** the finished videos (kept here too, so the box still shows them after the job list moves on) */
  outputs: FileRef[];
}
export interface Box {
  id: string;
  /** the character this box is (its videos go to their project) — null: just pictures */
  charId: string | null;
  pics: Media[];
  /** this box's own words: added to the shared prompt (or instead of it, when the board says so) */
  words: string;
  /** this box's own mix of video types (null = the board's) */
  mix: Mix | null;
  /** this box's own H3 LoRAs (null = the shared ones from Animate) */
  loras: LoraPick[] | null;
  /** ticked = runs on the next Make videos */
  on: boolean;
  runs: BoardRun[];
}
export interface BoardS {
  words: string;
  /** what each box makes per press: e.g. 2 seamless loops + 2 image → video */
  mix: Mix;
  seconds: number; mp: number;
  shape: "auto" | "9:16" | "16:9" | "1:1";
  turbo: boolean;
  /** the planner also reads how the box's first picture was made (its Create prompt: outfit, props, accessories, setting),
   *  so she interacts with her own things — off: just the shared prompt and her look */
  useMade: boolean;
  /** a box's own words: "add" to the shared prompt, or "own" = used instead of it */
  ownWords: "add" | "own";
  avoid: string; music: Music;
  boxes: Box[];
}
const DEF: BoardS = { words: "", mix: { ref: 0, i2v: 2, loop: 2 }, seconds: 8, mp: 0.6, shape: "auto", turbo: true, useMade: false, ownWords: "add", avoid: "", music: "none", boxes: [] };

let loaded = false;
export const useBoard = create<BoardS & { loaded: boolean }>(() => ({ ...DEF, loaded: false }));
loadState<Partial<BoardS>>("board").then((d) => {
  const boxes = (d?.boxes ?? []).map((b) => ({ ...b, mix: (b as Box).mix ?? null }));
  useBoard.setState({ ...DEF, ...(d ?? {}), mix: d?.mix ?? DEF.mix, boxes, loaded: true }); loaded = true;
}).catch(() => { useBoard.setState({ loaded: true }); loaded = true; });

let timer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (!loaded) { setTimeout(persist, 400); return; }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const { loaded: _l, ...s } = useBoard.getState();
    // only the newest runs per box travel (the job list keeps the rest)
    saveState("board", { ...s, boxes: s.boxes.map((b) => ({ ...b, runs: b.runs.slice(0, 12) })) }).catch(() => {});
  }, 500);
}
export function setBoard(p: Partial<BoardS>) { useBoard.setState(p); persist(); }
export function setBox(id: string, p: Partial<Box> | ((b: Box) => Partial<Box>)) {
  useBoard.setState((s) => ({ boxes: s.boxes.map((b) => (b.id === id ? { ...b, ...(typeof p === "function" ? p(b) : p) } : b)) }));
  persist();
}
export function setRun(boxId: string, runId: string, p: Partial<BoardRun>) {
  setBox(boxId, (b) => ({ runs: b.runs.map((r) => (r.id === runId ? { ...r, ...p } : r)) }));
}
export function removeBox(id: string) { useBoard.setState((s) => ({ boxes: s.boxes.filter((b) => b.id !== id) })); persist(); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** a character's box: their front + face pictures (references) — or the existing box, which comes forward */
export async function addCharacter(c: Character): Promise<string> {
  const have = useBoard.getState().boxes.find((b) => b.charId === c.id);
  if (have) return have.id;
  const pics: Media[] = [];
  for (const v of ["front", "face"] as const) {
    const m = await useCharacters.getState().asMedia(c.id, v).catch(() => null);
    if (m) pics.push(m);
  }
  const box: Box = { id: uid(), charId: c.id, pics, words: "", mix: null, loras: null, on: true, runs: [] };
  useBoard.setState((s) => ({ boxes: [...s.boxes, box] }));
  persist();
  return box.id;
}
/** a box for pictures that aren't a saved character (or a character's box when the picture came from their project) */
export function addPicsBox(pics: Media[], charId: string | null = null): string {
  const box: Box = { id: uid(), charId, pics, words: "", mix: null, loras: null, on: true, runs: [] };
  useBoard.setState((s) => ({ boxes: [...s.boxes, box] }));
  persist();
  return box.id;
}
export function addPic(boxId: string, m: Media) {
  setBox(boxId, (b) => (b.pics.some((p) => p.name === m.name) ? {} : { pics: [...b.pics, m].slice(0, 9) }));
}

/** the character a result belongs to, from its project folder (output/studio/<their name>/…) */
export function charOfFolder(subfolder?: string): Character | undefined {
  const folder = subfolder?.match(/^studio\/([^/]+)\//)?.[1];
  if (!folder) return undefined;
  const clean = (n: string) => n.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 60);
  return useCharacters.getState().list.find((c) => clean(c.name) === folder || (c.names ?? []).some((n) => clean(n) === folder));
}

export const mixOf = (b: Box): Mix => b.mix ?? useBoard.getState().mix;
export const takesOf = (b: Box) => mixTotal(mixOf(b));
export const wordsOf = (b: Box) => {
  const s = useBoard.getState();
  const own = b.words.trim();
  return s.ownWords === "own" && own ? own : [s.words.trim(), own].filter(Boolean).join(" ");
};
export function boxProblem(b: Box): string | undefined {
  const c = b.charId ? useCharacters.getState().list.find((x) => x.id === b.charId) : null;
  if (c && !isAdult(c)) return "needs an adult age (Characters)";
  if (!b.pics.length) return "add a picture";
  if (!wordsOf(b)) return "write what happens (shared prompt or this box)";
  if (!takesOf(b)) return "pick how many videos (the mix is all zeros)";
  return undefined;
}

function ratioOf(m: Media): Promise<number> {
  if (m.width && m.height) return Promise.resolve(m.width / m.height);
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalHeight ? i.naturalWidth / i.naturalHeight : 9 / 16); i.onerror = () => res(9 / 16); i.src = m.url; });
}

/** what her picture was made from (its Create prompt), to plan with her own outfit, props and setting */
async function madeFrom(m: Media): Promise<string> {
  try {
    const { fileGen } = await import("./api");
    const g = await fileGen(m);
    const p = (g.found ? g.prompt : "").replace(/\s+/g, " ").trim();
    return p.length > 700 ? p.slice(0, 700) + "…" : p;
  } catch { return ""; }
}

const PLAN_MODE: Record<keyof Mix, string> = {
  ref: "References",
  i2v: "Image → video",
  loop: "Seamless loop: the video starts on <Picture 1> and ends exactly on it again, so it plays round and round — the last moments come back to the starting pose, framing and light",
};

/** one box: each video type in its mix is planned once by the video writer, then its takes are lined up (same plan, different seeds) */
export async function runBox(boxId: string): Promise<void> {
  const b = useBoard.getState().boxes.find((x) => x.id === boxId);
  if (!b || boxProblem(b)) return;
  const mix = mixOf(b);
  const extra = useBoard.getState().useMade ? await madeFrom(b.pics[0]) : "";
  await Promise.all(MIX_KINDS.filter((x) => mix[x.k] > 0).map((x) => runKind(boxId, x.k, mix[x.k], extra)));
}

async function runKind(boxId: string, mode: keyof Mix, takes: number, made: string): Promise<void> {
  const s = useBoard.getState();
  const b = s.boxes.find((x) => x.id === boxId)!;
  const c = b.charId ? useCharacters.getState().list.find((x) => x.id === b.charId) ?? null : null;
  const name = c?.name ?? "Pictures";
  const words = wordsOf(b);
  const run: BoardRun = { id: uid(), at: Date.now(), mode, status: "planning", words, takes, jobIds: [], outputs: [] };
  setBox(b.id, (x) => ({ runs: [run, ...x.runs] }));
  const jobs = useJobs.getState();
  const kind = MIX_KINDS.find((x) => x.k === mode)!.label;
  try {
    const ref = mode === "ref";
    const pics = ref ? b.pics.slice(0, 9) : b.pics.slice(0, 1);
    const tagged = pics.map((p, i) => ({ file: p.name, tag: `<Picture ${i + 1}>`, label: ref ? (c ? `${c.name}` : p.label || "reference") : "the first frame" }));
    const a = useSettings.getState().s.animate;
    const pw = await planWriter(useSettings.getState().s.prompt.guide, DEFAULTS.prompt.guide, useBigPlanner());
    const { withAvoidNote } = await import("../components/AvoidLine");
    const madeNote = made ? `\n\nHow her picture was made (its prompt): “${made}”. Keep her outfit, accessories, props and setting from it, and have her interact naturally with her own things — touch, hold, adjust or use them — so the moment feels real. Ignore its camera and quality words.` : "";
    const g = buildPromptHelper({
      pictures: tagged, videos: [], audios: [],
      characters: c ? [{ name: c.name, look: look(c), tags: tagged.map((t) => t.tag) }] : undefined,
      idea: withAvoidNote(words, s.avoid) + madeNote, music: s.music, seconds: s.seconds, cuts: 0, camera: "auto",
      mode: PLAN_MODE[mode], guide: pw.guide, writer: pw.writer, seed: newSeed(),
    });
    const pj = await jobs.run("animate", `${name}: planning (${kind.toLowerCase()})`, g, "prompt:0v", { quiet: true, front: true, project: b.charId, board: b.id });
    const done = await waitForJob(pj.id);
    const raw = done.texts.timeline ?? "";
    if (done.status !== "done" || !raw.trim()) throw new Error(done.error ?? "The writer didn't answer — try again");
    if (Object.entries(done.texts).some(([k, v]) => k.startsWith("seen:") && v.includes(MINOR_FLAG)) || raw.includes(MINOR_FLAG)) throw new Error(stopMessage([words]));
    const parsed = parseTimeline(raw, s.seconds);
    const text = parsed.cuts.some((x) => x.text) ? toPrompt(parsed) : raw.trim();
    setRun(b.id, run.id, { plan: text });
    import("./plans").then(({ addPlan }) => addPlan({ chars: b.charId ? [b.charId] : [], project: b.charId, idea: words, seconds: s.seconds, mode, cuts: 0, camera: "auto", text, sent: Date.now(), made: takes })).catch(() => {});

    const { width, height } = s.shape === "auto" ? h3SizeFor(await ratioOf(pics[0]), s.mp) : h3Size(s.shape, s.mp);
    const turboOk = ref || (useSpeed.getState().videoTurbo !== false && !h3ErosOn());
    const turbo = turboOk && s.turbo;
    const etaKey = `animate:${mode}:${turbo ? "turbo" : "full"}:${s.seconds}s:${s.mp}`;
    const ids: string[] = [];
    for (let i = 0; i < takes; i++) {
      const o: AnimateOpts = {
        ...a.adv, seed: newSeed(), mode, prompt: text, avoid: s.avoid, music: s.music, seconds: s.seconds, width, height, turbo,
        loras: b.loras ?? a.loras, refImageSize: a.refImageSize, lowMemDecode: a.lowMemDecode, prefix: "studio/animate/h3", ray: rayVideoCards(),
        images: pics.map((p) => p.name), videos: [], audios: [],
      };
      const j = await jobs.run("animate", `${name} · ${kind.toLowerCase()}${takes > 1 ? ` · take ${i + 1}/${takes}` : ""}`, buildAnimate(o), etaKey,
        { opts: o, project: b.charId, stack: `board:${run.id}`, board: b.id, sent: { words, character: name } });
      ids.push(j.id);
      setRun(b.id, run.id, { jobIds: [...ids], status: "queued" });
    }
  } catch (e) {
    setRun(b.id, run.id, { status: "error", error: (e as Error).message });
  }
}

/** every ticked box that's ready: all planned at once (the writer goes first in the line), then their takes */
export async function runTicked(): Promise<{ boxes: number; videos: number }> {
  const ready = useBoard.getState().boxes.filter((b) => b.on && !boxProblem(b));
  const videos = ready.reduce((n, b) => n + takesOf(b), 0);
  for (const b of ready) void runBox(b.id);
  return { boxes: ready.length, videos };
}
