// Scenes: multi-shot videos with the same original characters, built in steps that each use a drop-in system prompt.
//   character look block ─► Krea 2 frame builder ─► starting frame (Krea 2)
//   short shot description ─► Scene context (blueprint) ─► H3 compiler (final prompt) ─► MiniMax H3 video (FL2VA from the frame)
// Every step's output is plain text you can edit before the next step. "Run all" chains the steps for a shot.
// Scenes are kept with your settings (and backed up), start frames are kept files, so they survive rentals.
import { create } from "zustand";
import { stopMessage } from "./adult";
import { keepFile, loadState, saveState, toInput, viewUrl, type FileRef } from "./api";
import { buildAnimate, buildCreate, buildEdit, buildStage, MINOR_FLAG, type LoraPick } from "./graphs";
import { useJobs, waitForJob, type Job } from "./jobs";
import { activePack, fillTemplate, usePacks, type Stage } from "./packs";
import { animeTags, charCkpt, charModel, describe, familyOfModel, isAdult, useCharacters, type Character } from "./characters";
import { bigWriterFits, useDownloads } from "./downloads";
import { h3Size } from "./models";
import { editArgs, modelArgs, modelOf, newSeed, qualityTags, useSettings } from "./settings";

export type ShotMode = "i2v" | "ref" | "t2v";
export type Step = "krea" | "frame" | "context" | "compiler" | "video";
export const MODE_INFO: Record<ShotMode, { label: string; sub: string }> = {
  i2v: { label: "From start frame", sub: "FL2VA · the video begins on your frame" },
  ref: { label: "References", sub: "Ref model · character pictures, no fixed first frame" },
  t2v: { label: "Text only", sub: "no pictures" },
};
export interface Shot {
  id: string; description: string; seconds: number; mode: ShotMode;
  /** characters in this shot (empty = the scene's cast) */
  cast: string[];
  frameNotes: string; kreaPrompt: string; frame: FileRef | null; candidates: FileRef[];
  blueprint: string; h3: string; videos: FileRef[];
  busy: Step | null; queue: Step[]; error?: string;
  /** notes on what's wrong ("this part: … — she should smile here"), applied together with "Apply fixes" */
  fixes: Fix[];
  /** earlier versions, newest last, for Undo */
  history: Partial<Record<TextStep, string[]>>;
  /** the blueprint the H3 prompt was written from (to show when it's out of date) */
  h3From?: string;
  /** what the writer was thinking, per step (only when thinking is on) */
  thinking?: Partial<Record<TextStep, string>>;
  /** your own reference pictures for this shot (a location, an outfit, a pose…): the writer sees them at every step,
   * and reference-mode videos get them as extra <Picture n> after the characters */
  refs?: { file: FileRef; label: string }[];
}
export type TextStep = "context" | "compiler" | "krea";
export interface Fix { id: string; stage: TextStep; quote: string; note: string }
export interface SceneVideo { steps: number; sampler: string; scheduler: string; quality: "auto" | number; loras: LoraPick[]; frameLoras: LoraPick[] }
export interface Scene {
  id: string; name: string; cast: string[]; aspect: "16:9" | "9:16" | "1:1"; writer: "small" | "big";
  /** starting frames: also make versions with the face locked to the character's front picture (one-character shots) */
  lockFace?: boolean;
  /** "Make all" also makes missing starting frames with Krea 2 (off by default: you drop in frames you made in Create) */
  autoFrames?: boolean;
  video: SceneVideo; shots: Shot[]; createdAt: number; updatedAt: number;
}

const uid = () => Math.random().toString(36).slice(2, 10);
export const newShot = (p: Partial<Shot> = {}): Shot => ({
  id: uid(), description: "", seconds: 8, mode: "i2v", cast: [], frameNotes: "", kreaPrompt: "", frame: null, candidates: [],
  blueprint: "", h3: "", videos: [], busy: null, queue: [], fixes: [], history: {}, ...p,
});
export const newScene = (name = "New scene"): Scene => ({
  id: uid(), name, cast: [], aspect: "16:9", writer: "big", shots: [], createdAt: Date.now(), updatedAt: Date.now(),
  video: { steps: 40, sampler: "res_multistep", scheduler: "simple", quality: "auto", loras: [], frameLoras: [] },
});

interface ScenesState {
  list: Scene[]; sel: string | null; loaded: boolean;
  select: (id: string) => void;
  add: (s?: Scene) => Scene;
  patch: (id: string, p: Partial<Scene>) => void;
  remove: (id: string) => void;
  patchShot: (sceneId: string, shotId: string, p: Partial<Shot>) => void;
}
let timer: ReturnType<typeof setTimeout> | undefined;
const persist = () => {
  clearTimeout(timer);
  // busy/queue are per-session; don't keep them
  timer = setTimeout(() => saveState("scenes", useScenes.getState().list.map((s) => ({ ...s, shots: s.shots.map((x) => ({ ...x, busy: null, queue: [] })) }))).catch(() => {}), 600);
};
export const useScenes = create<ScenesState>((set, get) => ({
  list: [], sel: null, loaded: false,
  select: (id) => set({ sel: id }),
  add: (s = newScene()) => { set((st) => ({ list: [s, ...st.list], sel: s.id })); persist(); return s; },
  patch: (id, p) => { set((st) => ({ list: st.list.map((s) => (s.id === id ? { ...s, ...p, updatedAt: Date.now() } : s)) })); persist(); },
  remove: (id) => { set((st) => { const list = st.list.filter((s) => s.id !== id); return { list, sel: st.sel === id ? list[0]?.id ?? null : st.sel }; }); persist(); },
  patchShot: (sceneId, shotId, p) => {
    const s = get().list.find((x) => x.id === sceneId);
    if (!s) return;
    get().patch(sceneId, { shots: s.shots.map((x) => (x.id === shotId ? { ...x, ...p } : x)) });
  },
}));
loadState<Scene[]>("scenes").then((l) => {
  const list = Array.isArray(l) ? l.map((s) => ({ ...newScene(), ...s, writer: "big" as const /* the 27B writes; Fable 9B only stands in while it downloads */, video: { ...newScene().video, ...(s.video ?? {}) }, shots: (s.shots ?? []).map((x) => newShot({ ...x, busy: null, queue: [] })) })) : [];
  useScenes.setState({ list, sel: list[0]?.id ?? null, loaded: true });
});

// ------------------------------------------------------------------ helpers
/** "12 second i2v. The girl…" → { seconds: 12, mode: "i2v", rest: "The girl…" } — the way you'd write it in LM Studio */
export function parseShotPrefix(text: string): { seconds?: number; mode?: ShotMode; rest: string } {
  const m = text.match(/^\s*(?:(\d{1,2})\s*-?\s*(?:s|secs?|seconds?)\b)?\s*(i2v|r2v|ref|t2v)?\b\s*[.,:;-]?\s*/i);
  if (!m || (!m[1] && !m[2])) return { rest: text.trim() };
  const mode = m[2] ? ({ i2v: "i2v", r2v: "ref", ref: "ref", t2v: "t2v" } as const)[m[2].toLowerCase() as "i2v"] : undefined;
  return { seconds: m[1] ? Math.max(2, Math.min(15, Number(m[1]))) : undefined, mode, rest: text.slice(m[0].length).trim() };
}
export const sceneOf = (id: string) => useScenes.getState().list.find((s) => s.id === id);
const shotOf = (s: Scene, id: string) => s.shots.find((x) => x.id === id);
/** every cast member is anime: frames are drawn by their anime model, not Krea 2 */
export const animeCast = (cast: Character[]) => cast.length > 0 && cast.every((c) => c.style === "anime");
/** the model that makes this scene's starting frames */
export const frameModelLabel = (cast: Character[]) => (animeCast(cast) ? (charModel(cast[0]) === "noob" ? "Illustrious" : "Anima") : "Krea 2");
export const lookBlock = (c: Character) => (c.block?.trim() || describe(c));
export function castOf(scene: Scene, shot?: Shot): Character[] {
  const ids = shot?.cast.length ? shot.cast : scene.cast;
  const all = useCharacters.getState().list;
  return ids.map((id) => all.find((c) => c.id === id)).filter((c): c is Character => !!c && isAdult(c));
}
export const frameSize = (aspect: Scene["aspect"]) => (aspect === "16:9" ? [1664, 928] : aspect === "9:16" ? [928, 1664] : [1328, 1328]);
/** H3 resolution: 8 s and shorter at higher resolution, longer shots lower (the model's memory grows with length) */
export const videoMp = (scene: Scene, seconds: number) => (scene.video.quality !== "auto" ? scene.video.quality : seconds <= 8 ? 0.9 : seconds <= 12 ? 0.7 : 0.55);
const groupReady = (id: string) => { const g = useDownloads.getState().groups.find((x) => x.id === id); return !g || g.state === "done"; };
/** the 27B writer (default) or the small Fable 9B. While the 27B is still downloading (or switched to "later") and the
 * 9B is already here, the 9B writes for now, so you're never stuck waiting; the 27B takes over once it's in. */
export const bigWriter = (scene: Scene) => scene.writer !== "small" && ((groupReady("writer_xl") && bigWriterFits()) || !groupReady("writer"));
/** the 27B is wanted but the 9B is standing in for it */
export const standIn = (scene: Scene) => scene.writer !== "small" && !groupReady("writer_xl") && groupReady("writer");
/** why the writer can't run yet (still downloading), or undefined */
export function writerWhy(scene: Scene): string | undefined {
  const g = useDownloads.getState().groups.find((x) => x.id === (bigWriter(scene) ? "writer_xl" : "writer"));
  if (!g || g.state === "done") return undefined;
  if (g.state === "later") return `${g.label} is set to download later — press Download now in the status menu`;
  if (g.state === "skipped") return `${g.label} is switched off (SKIP_MODELS in your Vast template)`;
  return g.state === "error" ? `${g.label} failed to download` : `${g.label} is still downloading${g.state === "downloading" ? ` — ${g.pct}%` : " (in line)"}`;
}
const toast = (t: string, tone: "good" | "bad" | "info" = "info") => useJobs.getState().toast(t, tone, "scenes");

/** reference pictures for "ref" shots: each character's sheet — full body, face, then back / sides / 3/4 as room allows
 *  (up to 9 pictures shared across the cast), numbered <Picture n> */
async function refPictures(cast: Character[]): Promise<{ files: string[]; tags: Record<string, string[]> }> {
  const files: string[] = []; const tags: Record<string, string[]> = {};
  const each = Math.max(2, Math.floor(9 / Math.max(1, cast.length)));
  for (const c of cast) {
    let n = 0;
    for (const v of ["front", "face", "threeq", "back", "left", "right"] as const) {
      if (n >= each || files.length >= 9 || !c.views[v]) continue;
      const m = await useCharacters.getState().asMedia(c.id, v);
      if (!m) continue;
      n++;
      files.push(m.name);
      (tags[c.id] ??= []).push(`<Picture ${files.length}>`);
    }
  }
  return { files, tags };
}
/** the shot's own reference pictures, numbered after the characters' ones */
async function extraRefs(shot: Shot, after: number): Promise<{ files: string[]; lines: string[] }> {
  const files: string[] = [], lines: string[] = [];
  for (const r of (shot.refs ?? []).slice(0, 3)) {
    try { files.push((await toInput(r.file)).name); } catch { continue; }
    lines.push(`<Picture ${after + files.length}> = ${r.label.trim() || "reference"}`);
  }
  return { files, lines };
}
/** a line for the writer about the attached reference pictures */
const refsNote = (lines: string[]) => (lines.length ? `\nREFERENCE PICTURES (attached; use what they show): ${lines.join("; ")}` : "");
function charactersVar(cast: Character[], tags?: Record<string, string[]>) {
  return cast.map((c) => `${c.name}${tags?.[c.id]?.length ? ` (${tags[c.id].join(", ")})` : ""}: ${lookBlock(c)}`).join("\n");
}

// ------------------------------------------------------------------ steps
async function runText(stage: Stage, scene: Scene, vars: Record<string, string | number | undefined>, images: string[], meta: Record<string, unknown>, label: string, inputOverride?: string, forceImages = false) {
  if (!usePacks.getState().loaded) await usePacks.getState().load();
  const pack = activePack(stage);
  if (!pack) throw new Error("No prompt file for this step");
  const why = writerWhy(scene);
  if (why) throw new Error(why);
  const input = inputOverride ?? fillTemplate(pack.template || usePacks.getState().templates[stage] || "", vars);
  const big = bigWriter(scene);
  const graph = buildStage({ promptFile: pack.prompt_file, promptChars: pack.chars, input, params: pack.params, images: pack.see_image || forceImages ? images : [], big, seed: newSeed(), thinking: pack.thinking });
  return useJobs.getState().run("scenes", label, graph, `scene:${stage}:${big ? "big" : "small"}:${pack.thinking}`, { ...meta, stage, pack: pack.name, input });
}

const MODE_WORD: Record<ShotMode, string> = { i2v: "I2V", ref: "REF2V", t2v: "T2V" };
/** what each picture is, for the compiler: "<Picture 1> is the first frame." / "<Picture 1> = Rin (full body), …" */
function referencesVar(shot: Shot, cast: Character[], tags?: Record<string, string[]>) {
  if (shot.mode === "i2v") return "<Picture 1> is the actual first frame of the target video.";
  if (shot.mode === "ref" && tags) return cast.flatMap((c) => (tags[c.id] ?? []).map((t, i) => `${t} = ${c.name} (${i === 0 ? "full body" : "face close-up"})`)).join("; ");
  return "";
}
/** the input for a "fix" run: the current text plus your notes */
function fixInput(stage: TextStep, shot: Shot, current: string, fixes: Fix[]): string {
  const what = stage === "compiler" ? `MiniMax H3 prompt (we are doing ${MODE_WORD[shot.mode]}, ${shot.seconds} seconds)` : stage === "context" ? "scene blueprint" : "Krea 2 image prompt";
  const notes = fixes.map((f, i) => `${i + 1}. ${f.quote ? `About this part: "${f.quote.trim()}" — ` : ""}${f.note.trim()}`).join("\n");
  return [
    `Here is the current ${what}:`, "", current.trim(), "",
    stage === "context" ? `(The original shot request was: ${shot.seconds} second ${shot.mode}. ${parseShotPrefix(shot.description).rest})\n` : "",
    "Make these changes:", notes, "",
    `Return the complete updated ${stage === "context" ? "blueprint" : "prompt"} only, describing the target video as if this had always been the plan.`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

const shotLabel = (scene: Scene, shot: Shot) => `Shot ${scene.shots.indexOf(shot) + 1}`;

export async function runStep(sceneId: string, shotId: string, step: Step): Promise<void> {
  const scene = sceneOf(sceneId); const shot = scene && shotOf(scene, shotId);
  if (!scene || !shot) return;
  const st = useScenes.getState();
  const cast = castOf(scene, shot);
  const meta = { scene: sceneId, shot: shotId, step };
  st.patchShot(sceneId, shotId, { busy: step, error: undefined });
  try {
    if (step === "krea") {
      if (!cast.length) throw new Error("Add a character to the scene first — the frame is built from their look block");
      const ex = await extraRefs(shot, 0);
      const frame = (shot.frameNotes.trim() || `The opening moment of this shot: ${shot.description}`) + refsNote(ex.lines);
      if (animeCast(cast)) // anime cast: the frame is drawn by their anime model, so the writer makes tags (the "Words → tags" prompt file)
        await runText("tags", scene, { text: frame, character: cast.map((c) => animeTags(c)).join(", ") }, ex.files, meta, `${shotLabel(scene, shot)} · frame tags`, undefined, ex.files.length > 0);
      else await runText("krea", scene, { character: charactersVar(cast), frame, aspect: scene.aspect }, ex.files, meta, `${shotLabel(scene, shot)} · frame prompt`, undefined, ex.files.length > 0);
    } else if (step === "frame") {
      const prompt = shot.kreaPrompt.trim();
      if (!prompt) throw new Error("No frame prompt yet");
      const [w, h] = frameSize(scene.aspect);
      const { charLoras, mergeLoras } = await import("./make");
      if (animeCast(cast)) {
        // anime cast: their anime model (Anima / Illustrious), their checkpoint and LoRAs — never Krea 2
        const mo = charModel(cast[0]) as "anima" | "noob";
        const cs = useSettings.getState().s.create;
        const mi = modelOf(cs, "anime", mo);
        const ck = charCkpt(cast[0], mo);
        const loras = cast.reduce((acc, c) => mergeLoras(acc, charLoras(c, familyOfModel(mo) as "anima" | "sdxl")), [] as LoraPick[]);
        const [aw, ah] = scene.aspect === "16:9" ? [1344, 768] : scene.aspect === "9:16" ? [768, 1344] : [1024, 1024];
        const tags = prompt.replace(/\b(masterpiece|best quality|amazing quality|very aesthetic|absurdres|highres|score_\d)\b,?\s*/gi, "");
        const g = buildCreate({ ...mi.adv, seed: newSeed(), ...modelArgs(cs, mi), ...(ck ? (mo === "noob" ? { ckpt: ck } : { unet: ck }) : {}), positive: `${qualityTags(mi)}, ${tags}`, negative: cs.negative,
          loras, width: aw, height: ah, count: 2, cutout: false, prefix: `studio/scenes/${sceneId}_frame` });
        await useJobs.getState().run("scenes", `${shotLabel(scene, shot)} · starting frames (${mo === "noob" ? "Illustrious" : "Anima"})`, g, `scene:frame:${mo}:${scene.aspect}`, meta);
        return;
      }
      const adv = useSettings.getState().s.create.advKrea;
      // the scene's frame LoRAs + every realistic cast member's own LoRAs (Characters → Their LoRAs) — they carry everywhere
      const castLoras = cast.reduce((acc, c) => mergeLoras(acc, charLoras(c, "krea2")), scene.video.frameLoras ?? []);
      const ck = cast.map((c) => charCkpt(c, "krea2")).find(Boolean);
      const g = buildCreate({ ...adv, seed: newSeed(), style: "realistic", realModel: "krea2", ...(ck ? { unet: ck } : {}), positive: prompt, negative: "", loras: castLoras,
        width: w, height: h, count: 2, cutout: false, prefix: `studio/scenes/${sceneId}_frame` });
      const solo = cast.length === 1 && cast[0].views.front && scene.lockFace !== false ? cast[0] : null;
      const job = await useJobs.getState().run("scenes", `${shotLabel(scene, shot)} · starting frames`, g, `scene:frame:${scene.aspect}`, { ...meta, ...(solo ? { waitLock: true } : {}) });
      // one character with a front picture: also make face-locked versions — Krea 2 Edit swaps the person in each frame for
      // the one in their reference picture, so the face, hair and body match the sheet exactly
      if (solo) {
        const done = await waitForJob(job.id).catch(() => null);
        const front = await useCharacters.getState().asMedia(solo.id, "front");
        const e = useSettings.getState().s.edit;
        for (const out of (done?.outputs ?? []).filter((x) => x.kind === "image")) {
          if (!front) break;
          const frameIn = await toInput(out);
          const ge = buildEdit({ ...editArgs(e, "krea"), loras: mergeLoras(editArgs(e, "krea").loras, charLoras(solo, "krea2")), refBoost: 4, enhance: false, seed: newSeed(), images: [frameIn.name, front.name], resolution: 1280, prefix: `studio/scenes/${sceneId}_frame`, negative: "",
            instruction: "Replace the person in this picture with the person from the second picture. Keep this picture's exact pose, body position, hands, facial angle, expression, composition, camera, framing, lighting, colours and background. The person has exactly the second person's face, hair, eye colour, skin tone, body proportions and outfit. The person is an adult." });
          await useJobs.getState().run("scenes", `${shotLabel(scene, shot)} · frame, face locked to ${solo.name}`, ge, "edit:krea:2:raw", { ...meta, locked: true });
        }
      }
    } else if (step === "context") {
      if (!shot.description.trim()) throw new Error("Write what happens in the shot first");
      let images: string[] = [], tags: Record<string, string[]> | undefined;
      if (shot.mode === "i2v" && shot.frame) images = [(await toInput(shot.frame)).name];
      if (shot.mode === "ref") { const r = await refPictures(cast); images = r.files.slice(0, 4); tags = r.tags; }
      const ex = await extraRefs(shot, images.length);
      await runText("context", scene, { seconds: shot.seconds, mode: MODE_WORD[shot.mode].toLowerCase(), MODE: MODE_WORD[shot.mode], description: parseShotPrefix(shot.description).rest + refsNote(ex.lines) + (shot.mode === "i2v" && shot.frame ? "\nSTARTING FRAME (attached as the first picture): plan the shot so it begins exactly on what this picture shows — who is in it, where they are, how they stand, what they wear." : ""), characters: charactersVar(cast, tags), aspect: scene.aspect },
        [...images, ...ex.files], meta, `${shotLabel(scene, shot)} · blueprint`, undefined, ex.files.length > 0 || (shot.mode === "i2v" && !!shot.frame));
    } else if (step === "compiler") {
      if (!shot.blueprint.trim()) throw new Error("Build the blueprint first");
      const refs = shot.mode === "ref" ? await refPictures(cast) : undefined;
      const images = shot.mode === "i2v" && shot.frame ? [(await toInput(shot.frame)).name] : refs?.files.slice(0, 4) ?? [];
      // ref videos number the shot's own pictures after the characters' (they go to H3 too); otherwise the writer just sees them
      const ex = await extraRefs(shot, shot.mode === "ref" ? (refs?.files.length ?? 0) : images.length);
      const references = [referencesVar(shot, cast, refs?.tags), shot.mode === "ref" ? ex.lines.join("; ") : ""].filter(Boolean).join("; ");
      await runText("compiler", scene, { blueprint: shot.blueprint.trim(), seconds: shot.seconds, mode: MODE_WORD[shot.mode].toLowerCase(), MODE: MODE_WORD[shot.mode], references,
        characters: charactersVar(cast, refs?.tags), aspect: scene.aspect, description: parseShotPrefix(shot.description).rest + (shot.mode === "ref" ? "" : refsNote(ex.lines)) },
        [...images, ...ex.files], { ...meta, from: shot.blueprint }, `${shotLabel(scene, shot)} · H3 prompt`, undefined, ex.files.length > 0 || (shot.mode === "i2v" && !!shot.frame));
    } else if (step === "video") {
      if (!shot.h3.trim()) throw new Error("Compile the H3 prompt first");
      if (shot.mode === "i2v" && !shot.frame) throw new Error("This shot starts from a frame — make or pick one first");
      const { width, height } = h3Size(scene.aspect, videoMp(scene, shot.seconds));
      let images = shot.mode === "i2v" ? [(await toInput(shot.frame!)).name] : shot.mode === "ref" ? (await refPictures(cast)).files : [];
      if (shot.mode === "ref") images = [...images, ...(await extraRefs(shot, images.length)).files];
      const a = useSettings.getState().s.animate;
      const g = buildAnimate({
        sampler: scene.video.sampler, scheduler: scene.video.scheduler, steps: scene.video.steps, seed: newSeed(),
        mode: shot.mode === "ref" ? "ref" : "i2v", prompt: shot.h3.trim(), images, videos: [], audios: [], seconds: shot.seconds, width, height,
        turbo: false, loras: scene.video.loras, refImageSize: a.refImageSize, lowMemDecode: a.lowMemDecode, prefix: `studio/scenes/${sceneId}`,
      });
      await useJobs.getState().run("scenes", `${shotLabel(scene, shot)} · video`, g, `scene:video:${shot.seconds}:${Math.round(videoMp(scene, shot.seconds) * 10)}`, meta);
    }
  } catch (e) {
    useScenes.getState().patchShot(sceneId, shotId, { busy: null, queue: [], error: (e as Error).message });
    toast((e as Error).message, "bad");
  }
}

/** apply your notes to one step's text: the same prompt file rewrites it with the changes */
export async function applyFixes(sceneId: string, shotId: string, stage: TextStep, thenRest = false) {
  const scene = sceneOf(sceneId); const shot = scene && shotOf(scene, shotId);
  if (!scene || !shot || shot.busy) return;
  const fixes = shot.fixes.filter((f) => f.stage === stage && f.note.trim());
  const current = stage === "context" ? shot.blueprint : stage === "compiler" ? shot.h3 : shot.kreaPrompt;
  if (!fixes.length || !current.trim()) return;
  const cast = castOf(scene, shot);
  const st = useScenes.getState();
  const queue: Step[] = thenRest ? (stage === "context" ? ["compiler"] : stage === "compiler" ? [] : ["frame"]) : stage === "krea" ? ["frame"] : [];
  st.patchShot(sceneId, shotId, { busy: stage, error: undefined, queue });
  try {
    let images: string[] = [];
    if (stage !== "krea" && shot.mode === "i2v" && shot.frame) images = [(await toInput(shot.frame)).name];
    if (stage !== "krea" && shot.mode === "ref") images = (await refPictures(cast)).files.slice(0, 4);
    const ex = await extraRefs(shot, images.length);
    await runText(stage, scene, {}, [...images, ...ex.files], { scene: sceneId, shot: shotId, step: stage, fix: fixes.map((f) => f.id), ...(stage === "compiler" ? { from: shot.blueprint } : {}) },
      `${shotLabel(scene, shot)} · fixing the ${stage === "context" ? "blueprint" : stage === "compiler" ? "H3 prompt" : "frame prompt"}`, fixInput(stage, shot, current, fixes), ex.files.length > 0);
  } catch (e) {
    st.patchShot(sceneId, shotId, { busy: null, queue: [], error: (e as Error).message });
    toast((e as Error).message, "bad");
  }
}
/** go back to the previous version of a step's text */
export function undoStep(sceneId: string, shotId: string, stage: TextStep) {
  const scene = sceneOf(sceneId); const shot = scene && shotOf(scene, shotId);
  const prev = shot?.history[stage]?.slice(-1)[0];
  if (!scene || !shot || prev === undefined) return;
  const key = stage === "context" ? "blueprint" : stage === "compiler" ? "h3" : "kreaPrompt";
  useScenes.getState().patchShot(sceneId, shotId, { [key]: prev, history: { ...shot.history, [stage]: shot.history[stage]!.slice(0, -1) } } as Partial<Shot>);
}
const withHistory = (shot: Shot, stage: TextStep, old: string) =>
  (old.trim() ? { ...shot.history, [stage]: [...(shot.history[stage] ?? []), old].slice(-10) } : shot.history);

/** the steps still missing for a finished video, in order */
export function plan(scene: Scene, shot: Shot): Step[] {
  const out: Step[] = [];
  const needFrame = shot.mode === "i2v" && !shot.frame;
  if (needFrame && scene.autoFrames) out.push(...(shot.kreaPrompt ? [] : ["krea" as Step]), "frame");
  if (!shot.blueprint.trim()) out.push("context");
  if (!shot.h3.trim()) out.push("compiler");
  // the plan only: the video is made when you press Make video (never by itself)
  return out;
}
export function runAll(sceneId: string, shotId: string, from?: Step) {
  const scene = sceneOf(sceneId); const shot = scene && shotOf(scene, shotId);
  if (!scene || !shot || shot.busy) return;
  const order: Step[] = ["krea", "frame", "context", "compiler", "video"];
  const steps = from ? order.slice(order.indexOf(from)).filter((s) => ((s !== "krea" && s !== "frame") || shot.mode === "i2v") && (s !== "video" || from === "video")) : plan(scene, shot);
  if (!from && !steps.length) useJobs.getState().toast("The plan is written — press Make video when you're happy with it.", "info", "scenes");
  if (!steps.length) return;
  const [first, ...rest] = steps;
  useScenes.getState().patchShot(sceneId, shotId, { queue: rest });
  runStep(sceneId, shotId, first);
}

/** start the next shot where the previous one ends */
export async function continueFromPrevious(sceneId: string, shotId: string) {
  const scene = sceneOf(sceneId); if (!scene) return;
  const i = scene.shots.findIndex((x) => x.id === shotId);
  const prev = scene.shots[i - 1];
  if (!prev?.videos[0]) { toast("The shot before this one has no video yet", "bad"); return; }
  const r = await fetch("/studio-api/last-frame", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prev.videos[0]) });
  if (!r.ok) { toast(`Couldn't read the last frame: ${await r.text()}`, "bad"); return; }
  const { name } = await r.json();
  await setFrame(sceneId, shotId, { filename: name, subfolder: "", type: "input" });
  toast("Starting frame = the last frame of the previous shot.", "good");
}
/** keep a picture as the shot's starting frame (a kept file, so it survives rentals) */
export async function setFrame(sceneId: string, shotId: string, f: FileRef | null) {
  if (!f) { useScenes.getState().patchShot(sceneId, shotId, { frame: null }); return; }
  const kept = await keepFile(f, `scenes/${sceneId}/${shotId}_frame.png`);
  useScenes.getState().patchShot(sceneId, shotId, { frame: { ...kept, v: Date.now() } });
}
export const frameUrl = (f: FileRef) => viewUrl(f);

/** a character's look block, written by the "look" step from their saved details (and front picture) */
export async function writeLook(sceneId: string, c: Character) {
  const scene = sceneOf(sceneId); if (!scene) return;
  const notes = [describe(c), c.personality && `Personality: ${c.personality}`, c.details && `Details: ${c.details}`, c.style === "anime" ? "Art style: anime" : "Photorealistic"].filter(Boolean).join("\n");
  const m = await useCharacters.getState().asMedia(c.id, "front");
  await runText("look", scene, { notes }, m ? [m.name] : [], { lookChar: c.id, scene: sceneId }, `${c.name} · look block`);
}

// ------------------------------------------------------------------ results come back
function onDone(j: Job) {
  const m = j.meta ?? {};
  if (m.lookChar) {
    const out = (j.texts.out ?? "").trim();
    if (out.includes(MINOR_FLAG) || out.includes("UNDERAGE_STOP")) return toast("Stopped: the look block would describe someone under 18.", "bad");
    const c = useCharacters.getState().list.find((x) => x.id === m.lookChar);
    if (c && out) { useCharacters.getState().save({ ...c, block: out.replace(/^["']|["']$/g, "") }); toast(`${c.name}'s look block is ready — it's used word-for-word in every frame.`, "good"); }
    return;
  }
  const scene = sceneOf(m.scene as string); const shot = scene && shotOf(scene, m.shot as string);
  if (!scene || !shot) return;
  const patch = useScenes.getState().patchShot;
  const step = m.step as Step;
  const out = (j.texts.out ?? "").trim();
  if (out && /UNDERAGE_STOP/.test(out)) { patch(scene.id, shot.id, { busy: null, queue: [], error: stopMessage([shot.description, shot.frameNotes, shot.blueprint]) }); return; }
  const fixed = new Set((m.fix as string[] | undefined) ?? []);
  const thinking = j.texts.thinking?.trim() ? { ...shot.thinking, [step]: j.texts.thinking.trim() } : shot.thinking;
  const common = { fixes: shot.fixes.filter((f) => !fixed.has(f.id)), thinking };
  if (step === "krea") {
    const cast = castOf(scene, shot);
    // keep the look blocks (anime: the character tags) word-for-word, whatever the prompt file did
    const anime = animeCast(cast);
    const missing = anime ? cast.map((c) => animeTags(c)).filter((b) => !out.includes(b.split(",")[0])) : cast.map(lookBlock).filter((b) => !out.includes(b));
    const kreaPrompt = missing.length ? `${missing.join(anime ? ", " : " ")}${anime ? ", " : " "}${out.split("\n")[0]}` : anime ? out.split("\n")[0] : out;
    patch(scene.id, shot.id, { ...common, kreaPrompt, history: withHistory(shot, "krea", shot.kreaPrompt), busy: null, queue: shot.queue[0] === "frame" ? shot.queue : ["frame", ...shot.queue] });
  } else if (step === "frame") {
    const imgs = j.outputs.filter((o) => o.kind === "image").map(({ filename, subfolder, type }) => ({ filename, subfolder, type }));
    patch(scene.id, shot.id, { candidates: [...imgs, ...shot.candidates].slice(0, 12), busy: null });
    // face-locked versions are on their way: the frame is picked from those
    if (m.waitLock) return;
    if (!shot.frame && imgs[0]) { setFrame(scene.id, shot.id, imgs[0]).then(() => next(scene.id, shot.id)); return; }
  } else if (step === "context") {
    patch(scene.id, shot.id, { ...common, blueprint: out, history: withHistory(shot, "context", shot.blueprint), busy: null });
  } else if (step === "compiler") {
    patch(scene.id, shot.id, { ...common, h3: out.replace(/^```\w*\n?|```$/g, "").trim(), h3From: (m.from as string) ?? shot.blueprint, history: withHistory(shot, "compiler", shot.h3), busy: null });
  } else if (step === "video") {
    const vids = j.outputs.filter((o) => o.kind === "video").map(({ filename, subfolder, type }) => ({ filename, subfolder, type }));
    patch(scene.id, shot.id, { videos: [...vids, ...shot.videos], busy: null });
  }
  next(scene.id, shot.id);
}
function next(sceneId: string, shotId: string) {
  const s = sceneOf(sceneId); const x = s && shotOf(s, shotId);
  if (!s || !x || !x.queue.length) return;
  const [n, ...rest] = x.queue;
  useScenes.getState().patchShot(sceneId, shotId, { queue: rest });
  runStep(sceneId, shotId, n);
}
useJobs.subscribe((s, prev) => {
  for (const j of s.jobs) {
    if (j.tab !== "scenes" || (j.status !== "done" && j.status !== "error" && j.status !== "cancelled")) continue;
    const before = prev.jobs.find((x) => x.id === j.id);
    if (!before || before.status === j.status) continue;
    if (j.status === "done") onDone(j);
    else if (j.meta?.scene && j.meta?.shot) useScenes.getState().patchShot(j.meta.scene as string, j.meta.shot as string, { busy: null, queue: [], error: j.status === "error" ? j.error : "Cancelled" });
  }
});
