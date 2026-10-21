// Remembered settings: every tab reopens exactly as you left it — on this rental and the next
// (saved on the instance, backed up to your cloud storage by the watchdog).
import { create } from "zustand";
import { loadState, saveState } from "./api";
import { DEFAULT_GUIDE, type AnimeModel, type EditEngine, type LoraPick, type RealModel } from "./graphs";
import type { Tab } from "./jobs";

export interface Adv { sampler: string; scheduler: string; steps: number; cfg: number; seed: number; lockSeed: boolean }

export interface CreateS {
  /** with a character: start from their picture (Krea 2 Edit / the anime redraw keeps their face) or from words only
   *  (text to image with their LoRA). auto = words when they have a LoRA, their picture when they don't */
  startFrom?: "auto" | "picture" | "words";
  /** Draft size: ~1 MP instead of ~2 MP (Krea 2), about twice as fast — make many, upscale the keepers */
  draft?: boolean;
  /** your own checkpoint per model ("" or missing = the official one): a file name from your models library */
  checkpoint?: Partial<Record<"anima" | "noob" | "krea2" | "krea2raw", string>>;
  style: "anime" | "realistic";
  make: "character" | "background" | "scene";
  subject: "woman" | "man";
  hair: string; eyes: string; outfit: string; pose: string; background: string; extra: string;
  negative: string;
  cutout: boolean;
  lorasAnime: LoraPick[]; lorasReal: LoraPick[];
  /** realistic model: Krea 2 Turbo / Krea 2 RAW — each keeps its own LoRAs and settings */
  realModel: RealModel; lorasKrea: LoraPick[]; advKrea: Adv; advKreaRaw: Adv;
  /** realistic: plain words go through the local writer first (default on) */
  /** Krea 2: the local writer rewrites plain words into a long prompt (default off — your words go in as typed) */
  polish?: boolean;
  /** Anima / Illustrious: the local writer turns plain words into tags (default on) */
  animeTags?: boolean;
  /** Krea 2 RAW only: add Krea's turbo LoRA at this strength (0 = off) for fewer steps */
  kreaTurboLora: number;
  /** anime model: Anima (default) or NoobAI-XL (Illustrious family) */
  animeModel: AnimeModel; lorasAnima: LoraPick[]; advAnima: Adv;
  shape: "portrait" | "tall" | "square" | "wide";
  /** finish bigger: the picture is made at the model's own size, then enlarged and redrawn lightly (×1.5 ≈ 2K) */
  upscale?: number;
  count: number;
  advAnime: Adv; advReal: Adv;
  characterId: string | null;
  styleAnime: string; styleReal: string;
  /** use the prompt box exactly as typed (e.g. a prompt copied from a CivitAI example) */
  raw: boolean;
  /** who is in the picture: your character alone (default), + one man, + one woman, or a group */
  cast?: "solo" | "plusMan" | "plusWoman" | "group";
  /** fit the LoRA stack into what the model holds (character leads, sliders apart) when you generate — default on */
  balance?: boolean;
  /** with pictures: your character keeps their own outfit (default) or wears the clothes of the person in picture 2 */
  outfitFrom?: "character" | "picture";
  /** after each picture of a person: find the face with SAM 3 and redraw it sharper (the character's own picture shows who it is) */
  faceFix?: boolean;
  faceStrength?: number;
}
export interface EditS {
  mode: "pose" | "scene" | "free";
  /** which model edits (Krea 2, or Anima / Illustrious for anime); each keeps its own settings and LoRAs. adv/loras/enhance: unused (were Qwen's) */
  engine: EditEngine;
  instruction: string; negative: string; enhance: boolean; resolution: number; count: number; adv: Adv;
  loras: LoraPick[];
  advKrea: Adv; lorasKrea: LoraPick[]; refBoost: number;
  /** a painted-area fix: how much of the painted part is redrawn (0.35 touch-up … 1 from scratch) */
  brushStrength?: number;
  advAnima: Adv; lorasAnima: LoraPick[]; advNoob: Adv; lorasNoob: LoraPick[];
  /** anime redraw: how much of the picture changes (0.2 = touch-up, 0.8 = mostly new) */
  strength: number;
  /** your own checkpoint per edit model; missing = the same one Create uses, "" = the official one */
  checkpoint?: Partial<Record<EditEngine, string>>;
  /** after each edit: find the face with SAM 3 and redraw it sharper */
  faceFix?: boolean;
  faceStrength?: number;
  /** Edit as a chat: one message at a time on the latest picture (components/EditChat) */
  chat?: boolean;
}
/** Edit model ↔ Create model */
export const EDIT_TO_CREATE: Record<EditEngine, CreateModel> = { krea: "krea2", anima: "anima", noob: "noob" };
/** the checkpoint an edit runs on: the one picked in Edit, else the one Create uses for that model */
export function editCheckpoint(e: EditS, create: CreateS, engine: EditEngine = e.engine ?? "krea"): { own?: string; fromCreate: boolean } {
  const mine = e.checkpoint?.[engine];
  if (mine !== undefined) return { own: mine || undefined, fromCreate: false };
  const c = create.checkpoint?.[EDIT_TO_CREATE[engine] as "krea2" | "anima" | "noob"];
  return { own: c || undefined, fromCreate: true };
}
export interface PromptS {
  mode: "references" | "first-last" | "image" | "text";
  idea: string; seconds: number; cuts: number; camera: string; guide: string; style: string;
  /** which model plans videos (Animate + Plan a video): Fable 9B (fast) or Qwen3.8 27B (better, needs its download) */
  writer?: "small" | "big";
}
export interface AnimateS {
  mode: "ref" | "i2v" | "fl" | "loop";
  prompt: string; seconds: number; aspect: "auto" | "16:9" | "9:16" | "1:1"; mp: number;
  turbo: boolean; takes: 1 | 2; loras: LoraPick[]; refImageSize: "match" | "max"; lowMemDecode: boolean; adv: Adv;
  /** plain words: the video prompt writer (Plan a video) plans it second by second first, with your references (default on) */
  plan?: boolean;
}
export interface FinishS {
  transition: "cut" | "crossfade" | "black" | "white" | "slide" | "wipe"; transitionDur: number;
  ending: "once" | "boomerang" | "fade_start" | "fade_black"; fade: number;
  audio: "keep" | "fade" | "mute"; speed: number; format: "mp4" | "webm" | "gif"; size: string; customW: number; customH: number;
}
export interface Settings {
  tab: Tab;
  drawers: Partial<Record<Tab, boolean>>;
  create: CreateS; edit: EditS; prompt: PromptS; animate: AnimateS; finish: FinishS;
}
const adv = (sampler: string, scheduler: string, steps: number, cfg: number): Adv => ({ sampler, scheduler, steps, cfg, seed: 0, lockSeed: false });

export const DEFAULTS: Settings = {
  tab: "create",
  drawers: {},
  create: {
    style: "anime", make: "character", subject: "woman",
    hair: "long silver hair", eyes: "green eyes", outfit: "black leather jacket", pose: "standing, hand on hip",
    background: "neon city street at night, rain", extra: "smiling, looking at viewer, full body",
    negative: "worst quality, low quality, lowres, bad anatomy, bad hands, extra digits, missing fingers, watermark, signature, text, blurry",
    cutout: false, lorasAnime: [], lorasReal: [], shape: "portrait", count: 4,
    advAnime: adv("euler_ancestral", "normal", 28, 5.5), advReal: adv("euler", "simple", 25, 1),
    realModel: "krea2", lorasKrea: [], advKrea: adv("euler", "simple", 8, 1), advKreaRaw: adv("euler", "simple", 28, 4.5), kreaTurboLora: 0,
    animeModel: "anima", lorasAnima: [], advAnima: adv("er_sde", "simple", 30, 4),
    characterId: null, styleAnime: "default", styleReal: "default", raw: false,
  },
  edit: {
    mode: "pose", engine: "krea", instruction: TEMPLATES("krea").pose, negative: "", enhance: true, resolution: 1024, count: 1, loras: [],
    adv: adv("euler", "simple", 25, 1),
    advKrea: adv("euler", "simple", 10, 1), lorasKrea: [], refBoost: 4,
    advAnima: adv("er_sde", "simple", 30, 4), lorasAnima: [], advNoob: adv("euler_ancestral", "normal", 28, 5.5), lorasNoob: [], strength: 0.55,
  },
  prompt: { mode: "references", idea: "", seconds: 10, cuts: 0, camera: "auto", guide: DEFAULT_GUIDE, style: "" },
  animate: {
    mode: "ref", prompt: "", seconds: 8, aspect: "auto", mp: 0.6, turbo: false, takes: 1, loras: [], refImageSize: "match",
    lowMemDecode: false, adv: adv("er_sde", "beta", 10, 1),
  },
  finish: {
    transition: "crossfade", transitionDur: 0.5, ending: "once", fade: 0.8, audio: "keep", speed: 1, format: "mp4",
    size: "same", customW: 1920, customH: 1080,
  },
};

export type CreateModel = AnimeModel | RealModel;
type AdvKey = "advAnime" | "advAnima" | "advKrea" | "advKreaRaw" | "advReal";
type LorasKey = "lorasAnime" | "lorasAnima" | "lorasKrea" | "lorasReal";
export interface ModelInfo {
  style: "anime" | "realistic"; model: CreateModel; adv: Adv; advKey: AdvKey; loras: LoraPick[]; lorasKey: LorasKey;
  group: string; family: "sdxl" | "anima" | "krea2"; label: string; short: string;
}
const INFO: Record<CreateModel, Omit<ModelInfo, "adv" | "loras">> = {
  anima: { style: "anime", model: "anima", advKey: "advAnima", lorasKey: "lorasAnima", group: "anime", family: "anima", label: "Anima", short: "Anima anime" },
  noob: { style: "anime", model: "noob", advKey: "advAnime", lorasKey: "lorasAnime", group: "anime", family: "sdxl", label: "Illustrious (NoobAI-XL)", short: "Illustrious anime" },
  krea2: { style: "realistic", model: "krea2", advKey: "advKrea", lorasKey: "lorasKrea", group: "image", family: "krea2", label: "Krea 2 Turbo", short: "Krea 2 realistic" },
  krea2raw: { style: "realistic", model: "krea2raw", advKey: "advKreaRaw", lorasKey: "lorasKrea", group: "kraw", family: "krea2", label: "Krea 2 RAW", short: "Krea 2 RAW" },
};
export const CREATE_MODELS = Object.values(INFO).filter((m) => m.model !== "krea2raw"); // RAW was dropped: Krea 2 Turbo only
/** the model a Create picture uses (for this style), with its own settings and LoRAs */
export function modelOf(c: CreateS, style: "anime" | "realistic" = c.style, model?: CreateModel): ModelInfo {
  let m = model ?? (style === "anime" ? (c.animeModel ?? "anima") : (c.realModel ?? "krea2"));
  if (m === "krea2raw") m = "krea2"; // older saved settings
  const i = INFO[m] ?? INFO.krea2;
  return { ...i, adv: c[i.advKey] ?? DEFAULTS.create[i.advKey], loras: c[i.lorasKey] ?? [] };
}
/** settings to switch Create to a model */
export const pickModel = (m: CreateModel): Partial<CreateS> => (INFO[m].style === "anime" ? { style: "anime", animeModel: m as AnimeModel } : { style: "realistic", realModel: m as RealModel });
/** the buildCreate() arguments for a model */
export function modelArgs(c: CreateS, m: ModelInfo) {
  const own = c.checkpoint?.[m.model as CreateModel] || undefined; // your own fine-tune, if you picked one
  return { style: m.style, animeModel: m.style === "anime" ? (m.model as AnimeModel) : undefined, realModel: m.style === "realistic" ? (m.model as RealModel) : undefined,
    kreaTurboLora: m.model === "krea2raw" ? c.kreaTurboLora ?? 0 : 0, ...(own ? (m.model === "noob" ? { ckpt: own } : { unet: own }) : {}) };
}
/** the quality words each anime model was trained on */
export const qualityTags = (m: Pick<ModelInfo, "model">) => (m.model === "anima" ? "masterpiece, best quality, score_7" : "masterpiece, best quality, newest, absurdres, highres");
/** the realistic model in use (kept for older callers) */
export const realOf = (c: CreateS) => modelOf(c, "realistic");

/** the ready-made instructions for each kind of edit. Krea 2 reads picture 1 as the scene being edited and picture 2
 * as the person to put in; the anime redraw describes the result (tags work). */
export function TEMPLATES(engine: EditEngine = "krea") {
  if (engine === "krea") return {
    pose: "Replace the person in this picture with the person from the second picture, in exactly the same pose. Keep the background, framing and lighting the same, and keep the second person's face, hair, body and outfit.",
    scene: "Place the person from the second picture into this scene, standing naturally. Keep their face, hair and outfit exactly the same, and match the scene's lighting and colours.",
    free: "",
  };
  return { pose: "", scene: "", free: "" };
}
const ENGINE_KEYS: Record<EditEngine, { adv: "advKrea" | "advAnima" | "advNoob"; loras: "lorasKrea" | "lorasAnima" | "lorasNoob"; family: "krea2" | "anima" | "sdxl" }> = {
  krea: { adv: "advKrea", loras: "lorasKrea", family: "krea2" },
  anima: { adv: "advAnima", loras: "lorasAnima", family: "anima" }, noob: { adv: "advNoob", loras: "lorasNoob", family: "sdxl" },
};
export const editKeys = (engine: EditEngine) => ENGINE_KEYS[engine] ?? ENGINE_KEYS.krea;
/** everything buildEdit needs from the Edit settings for one engine (the Edit tab's choice unless given) */
export function editArgs(e: EditS, engine: EditEngine = e.engine ?? "krea") {
  if (!ENGINE_KEYS[engine]) engine = "krea";
  const k = ENGINE_KEYS[engine];
  const a = e[k.adv];
  return {
    engine, sampler: a.sampler, scheduler: a.scheduler, steps: a.steps, cfg: a.cfg, loras: e[k.loras] ?? [],
    refBoost: e.refBoost ?? 4, ...(engine === "anima" || engine === "noob" ? { denoise: e.strength ?? 0.55 } : {}),
    enhance: false,
  };
}

type Section = Exclude<keyof Settings, "tab" | "drawers">;
interface SettingsState {
  s: Settings;
  loaded: boolean;
  presets: Partial<Record<Section, Record<string, unknown>>>;
  set: <K extends Section>(k: K, patch: Partial<Settings[K]>) => void;
  setTab: (t: Tab) => void;
  setDrawer: (t: Tab, open: boolean) => void;
  reset: (k: Section) => void;
  savePreset: (k: Section, name: string) => void;
  applyPreset: (k: Section, name: string) => void;
  deletePreset: (k: Section, name: string) => void;
}

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || Array.isArray(base)) return (over ?? base) as T;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [k, v] of Object.entries(over as object)) {
    const b = (base as any)?.[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? merge(b, v) : v;
  }
  return out;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState("settings", useSettings.getState().s).catch(() => {}), 700);
}

export const useSettings = create<SettingsState>((set, get) => ({
  s: DEFAULTS,
  loaded: false,
  presets: {},
  set: (k, patch) => { set((st) => ({ s: { ...st.s, [k]: { ...st.s[k], ...patch } } })); persist(); },
  setTab: (t) => { set((st) => ({ s: { ...st.s, tab: t } })); persist(); },
  setDrawer: (t, open) => { set((st) => ({ s: { ...st.s, drawers: { ...st.s.drawers, [t]: open } } })); persist(); },
  reset: (k) => { set((st) => ({ s: { ...st.s, [k]: DEFAULTS[k] } })); persist(); },
  savePreset: (k, name) => {
    const presets = { ...get().presets, [k]: { ...(get().presets[k] ?? {}), [name]: get().s[k] } };
    set({ presets }); saveState("presets", presets).catch(() => {});
  },
  applyPreset: (k, name) => {
    const p = get().presets[k]?.[name];
    if (p) { set((st) => ({ s: { ...st.s, [k]: merge(DEFAULTS[k], p) } })); persist(); }
  },
  deletePreset: (k, name) => {
    const sec = { ...(get().presets[k] ?? {}) }; delete sec[name];
    const presets = { ...get().presets, [k]: sec };
    set({ presets }); saveState("presets", presets).catch(() => {});
  },
}));

Promise.all([loadState<Settings>("settings"), loadState<SettingsState["presets"]>("presets")]).then(([s, p]) => {
  const merged = merge(DEFAULTS, s);
  // Qwen Image was removed: anything still set to it moves to Krea 2
  if ((merged.create.realModel as string) === "qwen") merged.create.realModel = "krea2";
  if ((merged.edit.engine as string) === "qwen") merged.edit.engine = "krea";
  useSettings.setState({ s: merged, presets: p ?? {}, loaded: true });
});

export const useSection = <K extends Section>(k: K) => {
  const v = useSettings((st) => st.s[k]);
  const set = useSettings((st) => st.set);
  return [v, (patch: Partial<Settings[K]>) => set(k, patch)] as const;
};

export const newSeed = () => Math.floor(Math.random() * 2 ** 48);
/** seed to use for a run: the locked one, or a fresh random one (written back so you can lock it later) */
export function seedFor(a: Adv, write: (p: Partial<Adv>) => void): number {
  if (a.lockSeed && a.seed) return a.seed;
  const s = newSeed();
  write({ seed: s });
  return s;
}
