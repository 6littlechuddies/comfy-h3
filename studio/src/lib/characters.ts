// Character library: saved once, used everywhere. The data and the reference pictures are kept with your
// settings (ComfyUI/user/default/studio), so they come back on every new rental via the B2 backup.
import { create } from "zustand";
import { deleteKept, keepFile, loadState, saveState, splitSheet, toInput, viewUrl, type FileRef } from "./api";
import type { LoraPick } from "./graphs";
import { useJobs } from "./jobs";
import type { Media } from "./tray";
import { uploadImport, type ImportResult } from "./importer";

export const VIEWS = [
  { id: "front", label: "Front", hint: "full body, made first" },
  { id: "back", label: "Back", hint: "from behind" },
  { id: "left", label: "Left side", hint: "profile, facing left" },
  { id: "right", label: "Right side", hint: "profile, facing right" },
  { id: "threeq", label: "3/4 front", hint: "three-quarter view" },
  { id: "face", label: "Face close-up", hint: "head and shoulders" },
  { id: "cutout", label: "Cut-out", hint: "transparent background" },
  { id: "smile", label: "Smiling", hint: "expression" },
  { id: "angry", label: "Angry", hint: "expression" },
  { id: "surprised", label: "Surprised", hint: "expression" },
  { id: "sheet", label: "All angles", hint: "the whole sheet in one picture" },
] as const;
export type View = (typeof VIEWS)[number]["id"];

export interface SiteItem extends FileRef { rating?: "sfw" | "suggestive" | "explicit"; caption?: string; duration?: number }
export interface SiteSet { set_key: string; title: string; description: string; tier: "free" | "premium"; price?: number; rating: "sfw" | "suggestive" | "explicit"; items: SiteItem[] }
export interface SiteInfo {
  bio?: string; greeting?: string; backstory?: string; personality?: string; persona?: string; voice?: string; tags?: string[];
  avatar?: View; cover?: View; send_reference?: boolean; sets?: SiteSet[];
  /** when it was last sent, and what the site said */
  sent?: { at: number; ok: boolean; note: string; hash?: string };
}
export interface TrainItem { id: string; file?: FileRef; shot: "close" | "half" | "full"; prompt: string; caption: string; status: "making" | "checking" | "done" | "failed";
  /** 0–10 from the face check (null = face not visible, so not checked) */ score?: number | null; why?: string; keep?: boolean }
export interface TrainSet { trigger: string; items: TrainItem[]; minScore: number }

export interface Character {
  id: string;
  name: string;
  age: number;
  gender: "female" | "male" | "other";
  style: "anime" | "realistic";
  hair: string; eyes: string; body: string; ethnicity: string; outfit: string; details: string; personality: string;
  loras: LoraPick[];
  /** the fixed "look block": pasted word-for-word into every starting frame and shot (Scenes) */
  block?: string;
  /** how their starting frame is made (Characters → Starting frame): model, your checkpoint, prompt, LoRAs, batch */
  frame?: { model?: string; checkpoint?: string; prompt?: string; loras?: LoraPick[]; count?: number; shape?: string };
  /** how their reference sheet is made: anime (Anima / Illustrious draw each angle) or realistic (Krea 2 Edit) */
  sheet?: { style?: "anime" | "realistic"; model?: "anima" | "noob" | "krea";
    /** realistic back / side / three-quarter views: the Qwen angle tool (default, when downloaded) or Krea 2 Edit */
    angles?: "qwen" | "krea"; /** Illustrious: how closely each angle copies the front picture (IP-Adapter weight) */ refWeight?: number;
    /** your own checkpoint for the sheet, per model (a Krea 2 / Anima fine-tune, or an Illustrious checkpoint); empty = official */
    ckpt?: Partial<Record<"krea" | "anima" | "noob", string>>;
    /** anime + "Copy the picture": after Krea 2 Edit copies each angle, redraw it lightly in this anime model (its look, checkpoint and LoRAs) */
    redraw?: "anima" | "noob"; redrawStrength?: number };
  /** anime characters: which anime model makes their pictures everywhere (Create, frames, Scenes) */
  animeModel?: "anima" | "noob";
  views: Partial<Record<View, FileRef>>;
  /** the picture each view had before it was last replaced — "↶ Back" swaps it back */
  prev?: Partial<Record<View, FileRef>>;
  /** the front picture is one you gave (not made here): Redo asks before replacing it */
  frontYours?: boolean;
  /** what goes to your site (⋯ → Your site): profile text, chat persona, photo sets */
  site?: SiteInfo;
  /** Characters → Build a training set: varied pictures of them made from their picture, each checked against it */
  trainset?: TrainSet;
  /** identity card: which picture shows their face best (face pass, face checks), and whether Edit uses them by itself */
  identity?: { face?: View; auto?: boolean };
  source?: string;
  createdAt: number;
  updatedAt: number;
}

export const isAdult = (c: Pick<Character, "age">) => Number.isFinite(c.age) && c.age >= 18;

const clean = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean).join(", ");
export function animeTags(c: Character): string {
  const subj = c.gender === "male" ? "1boy, solo, adult, mature male" : c.gender === "female" ? "1girl, solo, adult, mature female" : "1other, solo, adult";
  const eyes = c.eyes && !/eye/i.test(c.eyes) ? `${c.eyes} eyes` : c.eyes;
  return clean([subj, c.hair, eyes, c.body, c.outfit, c.details].join(", "));
}
const DEFAULT_NAME = /^(new character|character|untitled)( \d+)?$/i;
const isDefaultName = (n: string) => !n.trim() || DEFAULT_NAME.test(n.trim());
const cap = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());
/** a name you can tell apart, made from how they look ("Teal-Streak Bob · Paramedic Jacket") until you give them one */
export function autoName(c: Pick<Character, "hair" | "outfit" | "ethnicity" | "gender" | "details">): string {
  const words = (s: string, n: number) => s.replace(/[(),.;]/g, " ").split(/\s+/).filter((w) => w && !/^(a|an|the|with|and|of|in|her|his|long|short|very)$/i.test(w)).slice(0, n).join(" ");
  const hair = c.hair ? words(c.hair.replace(/\bhair\b/i, ""), 3) : "";
  const outfit = c.outfit ? words(c.outfit, 2) : "";
  const parts = [hair && `${hair}${/hair|bob|braid|ponytail|bun|curls/i.test(hair) ? "" : " hair"}`, outfit].filter(Boolean);
  return parts.length ? cap(parts.join(" · ")).slice(0, 48) : "";
}
/** the long description when there is one, else the short one built from the profile */
export const looks = (c: Character) => c.block?.trim() || describe(c);
export function describe(c: Character): string {
  const who = c.gender === "male" ? "man" : c.gender === "female" ? "woman" : "person";
  const parts = [
    `A ${c.age}-year-old ${c.ethnicity ? c.ethnicity + " " : ""}${who}`,
    c.hair && `with ${c.hair}`, c.eyes && `${c.eyes} eyes`.replace(/eyes eyes/, "eyes"), c.body && `${c.body} build`.replace(/build build/, "build"),
    c.outfit && `wearing ${c.outfit}`, c.details,
  ].filter(Boolean);
  // their manner, not a fixed face: a set of pictures each gets its own expression (same-face-itis otherwise)
  return parts.join(", ") + (c.personality ? `; ${c.personality} by nature.` : ".");
}

interface CharState {
  list: Character[];
  sel: string | null;
  loaded: boolean;
  save: (c: Character) => void;
  remove: (id: string) => void;
  select: (id: string | null) => void;
  setView: (id: string, view: View, from: FileRef, opts?: { yours?: boolean }) => Promise<void>;
  /** swap a view back to the picture it had before */
  undoView: (id: string, view: View) => Promise<void>;
  /** a view's picture, copied into ComfyUI's input folder for use in a job */
  asMedia: (id: string, view: View) => Promise<Media | null>;
}

let timer: ReturnType<typeof setTimeout> | undefined;
const persist = () => { clearTimeout(timer); timer = setTimeout(() => saveState("characters", useCharacters.getState().list).catch(() => {}), 500); };

export const useCharacters = create<CharState>((set, get) => ({
  list: [],
  sel: null,
  loaded: false,
  save: (c) => {
    const now = Date.now();
    // until you name them: a name made from their look, which follows their look as you edit it
    const prev = get().list.find((x) => x.id === c.id);
    if (isDefaultName(c.name) || (prev && c.name === prev.name && prev.name === autoName(prev))) { const n = autoName(c); if (n) c = { ...c, name: n }; }
    const exists = get().list.some((x) => x.id === c.id);
    set((s) => ({ list: exists ? s.list.map((x) => (x.id === c.id ? { ...c, updatedAt: now } : x)) : [{ ...c, createdAt: now, updatedAt: now }, ...s.list] }));
    persist();
  },
  remove: (id) => {
    set((s) => ({ list: s.list.filter((x) => x.id !== id), sel: s.sel === id ? null : s.sel }));
    deleteKept(`characters/${id}`).catch(() => {});
    persist();
  },
  select: (id) => { set({ sel: id }); try { localStorage.setItem("h3.character", id ?? ""); } catch { /* private mode */ } },
  setView: async (id, view, from, opts) => {
    // keep what was there, so a Redo that comes out worse (or replaces your own picture) can be undone
    const before = get().list.find((x) => x.id === id)?.views[view];
    let prev: FileRef | undefined;
    if (before) { try { prev = { ...(await keepFile(before, `characters/${id}/prev_${view}.png`)), v: Date.now() } as FileRef; } catch { /* nothing to keep */ } }
    const kept = await keepFile(from, `characters/${id}/${view}.png`);
    const bust = { ...kept, v: Date.now() }; // same file name every time -> version it so the picture refreshes
    set((s) => ({ list: s.list.map((x) => (x.id === id ? { ...x, views: { ...x.views, [view]: bust }, ...(prev ? { prev: { ...x.prev, [view]: prev } } : {}),
      ...(view === "front" ? { frontYours: !!opts?.yours } : {}), updatedAt: Date.now() } : x)) }));
    persist();
  },
  undoView: async (id, view) => {
    const c = get().list.find((x) => x.id === id);
    const prev = c?.prev?.[view], cur = c?.views[view];
    if (!c || !prev) return;
    // three-way swap through a spare file: now ↔ before
    const spare = cur ? await keepFile(cur, `characters/${id}/swap_${view}.png`) : null;
    const back = await keepFile(prev, `characters/${id}/${view}.png`);
    const newPrev = spare ? await keepFile(spare, `characters/${id}/prev_${view}.png`) : null;
    const now = Date.now();
    set((s) => ({ list: s.list.map((x) => (x.id === id ? { ...x, views: { ...x.views, [view]: { ...back, v: now } }, prev: { ...x.prev, [view]: newPrev ? { ...newPrev, v: now } : undefined }, updatedAt: now } : x)) }));
    persist();
  },
  asMedia: async (id, view) => {
    const c = get().list.find((x) => x.id === id);
    const f = c?.views[view];
    if (!c || !f) return null;
    const input = await toInput(f);
    return { ...input, url: viewUrl(f), label: `${c.name}${view === "front" ? "" : ` (${view})`}` };
  },
}));

loadState<Character[]>("characters").then((l) => {
  const list = Array.isArray(l) ? l : [];
  let last = ""; try { last = localStorage.getItem("h3.character") ?? ""; } catch { /* private mode */ }
  useCharacters.setState({ list, loaded: true, sel: list.some((x) => x.id === last) ? last : null });
});

/** download every character (or some) with all their pictures as one .zip — keep it, or drag it into any rental */
export function exportCharacters(ids?: string[]) {
  const a = document.createElement("a");
  a.href = `/studio-api/characters/export${ids?.length ? `?ids=${encodeURIComponent(ids.join(","))}` : ""}`;
  a.download = ""; document.body.appendChild(a); a.click(); a.remove();
}
/** bring characters back from an Export .zip: new ones are added, ones you already have are updated */
export async function importCharacters(file: File): Promise<ImportResult> {
  clearTimeout(timer); // don't let a pending save overwrite what arrives
  const d = await uploadImport(file);
  await afterImport(d);
  return d;
}
/** an import finished (yours, or the rental's own restore from Proton Drive): pick up what came in */
export async function afterImport(d: ImportResult | undefined) {
  clearTimeout(timer);
  // results that came along show up in every tab's results right away
  import("./jobs").then((m) => m.syncJobs()).catch(() => {});
  const l = await loadState<Character[]>("characters");
  useCharacters.setState({ list: Array.isArray(l) ? l : [], loaded: true });
  // scenes, presets, chats, prompt files or preferences came along: start fresh so every part of the Studio picks them up
  if (d?.extras && Object.keys(d.extras).some((k) => k !== "packs")) setTimeout(() => location.reload(), 2500);
}
export const importNote = (r: { added: number; updated: number; kept_newer?: number; refused: string[]; aged?: string[]; extras?: Record<string, number | boolean> }) =>
  [r.added && `${r.added} character${r.added > 1 ? "s" : ""} added`, r.updated && `${r.updated} updated`, r.kept_newer && `${r.kept_newer} kept as you have them (yours are newer)`,
    r.extras?.scenes && `${r.extras.scenes} scene${r.extras.scenes === 1 ? "" : "s"}`, r.extras?.scene_presets && "scene presets", r.extras?.presets && "presets",
    r.extras?.packs && "prompt files", r.extras?.settings && "your preferences",
    r.aged?.length && `${r.aged.length} had no age, set to 25 (change it under Looks → Age): ${r.aged.slice(0, 3).join(", ")}`,
    r.refused.length && `${r.refused.length} refused (age under 18): ${r.refused.slice(0, 3).join(", ")}`].filter(Boolean).join(" · ") || "Nothing new in that file";

/** put a finished picture into one of their site sets (made if missing), e.g. "Beach at dusk" · premium */
export function addToSiteSet(charId: string, title: string, tier: "free" | "premium", file: FileRef) {
  const st = useCharacters.getState();
  const c = st.list.find((x) => x.id === charId);
  if (!c) return;
  const sets = [...(c.site?.sets ?? [])];
  let i = sets.findIndex((x) => x.tier === tier && x.title.toLowerCase() === title.toLowerCase());
  if (i < 0) { sets.push({ set_key: `${tier}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "set"}-${Date.now().toString(36)}`, title, description: "", tier, rating: tier === "premium" ? "suggestive" : "sfw", items: [] }); i = sets.length - 1; }
  if (sets[i].items.some((x) => x.filename === file.filename && x.subfolder === file.subfolder)) return;
  sets[i] = { ...sets[i], items: [...sets[i].items, { ...file }] };
  st.save({ ...c, site: { ...c.site, sets } });
}

/** the picture that shows their face best: your pick on their identity card, else the face close-up, else the front */
export function faceView(c: Character): View | null {
  const f = c.identity?.face;
  if (f && c.views[f]) return f;
  return c.views.face ? "face" : c.views.front ? "front" : null;
}

export function newCharacter(p: Partial<Character> = {}): Character {
  return {
    id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: "New character", age: 25, gender: "female", style: "anime",
    hair: "", eyes: "", body: "", ethnicity: "", outfit: "", details: "", personality: "",
    loras: [], views: {}, createdAt: Date.now(), updatedAt: Date.now(), ...p,
  };
}

/** jobs that make a character view: keep the result in the library when they finish */
useJobs.subscribe((s, prev) => {
  for (const j of s.jobs) {
    if (j.status !== "done" || !j.meta?.charId) continue;
    const before = prev.jobs.find((x) => x.id === j.id);
    if (before?.status === "done") continue;
    const out = j.outputs.find((o) => o.kind === "image" && o.type === "output");
    if (!out) continue;
    const id = j.meta.charId as string;
    const st = useCharacters.getState();
    const saved = st.setView(id, j.meta.view as View, out);
    saved.catch((e) => useJobs.getState().toast(`Couldn't save the view: ${e.message}`, "bad"));
    // copied by Krea 2 Edit, finished in their anime model
    const redraw = j.meta.redraw as "anima" | "noob" | undefined;
    if (redraw && j.meta.view !== "cutout" && j.meta.view !== "sheet") saved.then(() => import("./sheet")).then(({ redrawView }) => redrawView(id, j.meta!.view as View, redraw))
      .catch((e) => useJobs.getState().toast(`Couldn't redraw it: ${e.message}`, "bad"));
    // made the front first because you asked for the full sheet: carry on with the sheet now
    if (j.meta.then === "sheet" && j.meta.view === "front") {
      const c = st.list.find((x) => x.id === id);
      if (c) st.setView(id, "front", out).then(() => import("./sheet")).then(({ queueFullSheet }) => queueFullSheet(useCharacters.getState().list.find((x) => x.id === id)!, (j.meta!.bg as "grey" | "white") ?? "grey"))
        .catch((e) => useJobs.getState().toast(`Couldn't start the sheet: ${e.message}`, "bad"));
    }
    // a whole turnaround sheet: cut it into the separate angles too
    if (j.meta.view === "sheet" && !j.meta.single) {
      const order = (j.meta.order as View[]) ?? ["front", "left", "back", "threeq"];
      splitSheet(out, order.length).then(async (parts) => {
        const keepFront = !!useCharacters.getState().list.find((c) => c.id === id)?.views.front;
        for (let i = 0; i < parts.length; i++) {
          if (order[i] === "front" && keepFront) continue; // your own front picture stays the main one
          await useCharacters.getState().setView(id, order[i], parts[i]);
        }
        useJobs.getState().toast("Sheet done — cut into the separate angles. Redo any single one in the sheet maker if it's off.", "good", "characters");
      }).catch((e) => useJobs.getState().toast(`Couldn't cut the sheet into views: ${e.message}`, "bad"));
    }
  }
});

/** read a profile the extractor returned (JSON somewhere in the text) */
export function parseExtracted(raw: string): Partial<Character> | null {
  const m = raw.replace(/<think>[\s\S]*?<\/think>/g, "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[0]);
    const g = String(d.gender ?? "").toLowerCase();
    return {
      name: String(d.name ?? "").trim() || "Unnamed", age: Number(d.age) || 25, // no age given: an adult by default
      gender: g.startsWith("m") ? "male" : g.startsWith("f") ? "female" : "other",
      hair: d.hair ?? "", eyes: d.eyes ?? "", body: d.body ?? "", ethnicity: d.ethnicity ?? "", outfit: d.outfit ?? "",
      details: d.details ?? "", personality: d.personality ?? "",
      ...(d.style === "anime" || d.style === "realistic" ? { style: d.style } : {}),
    };
  } catch { return null; }
}

/** the developer's export format (see README: "Character creator format") */
export function fromCreatorJson(d: any): Partial<Character> | null {
  if (!d || typeof d !== "object" || !d.name) return null;
  const a = d.appearance ?? {};
  const g = String(d.gender ?? "").toLowerCase();
  return {
    name: d.name, age: Number(d.age) || 25, gender: g.startsWith("m") ? "male" : g.startsWith("f") ? "female" : "other",
    style: d.style === "realistic" ? "realistic" : "anime",
    hair: a.hair ?? "", eyes: a.eyes ?? "", body: a.body ?? "", ethnicity: a.ethnicity ?? "", outfit: a.outfit ?? "", details: a.details ?? "",
    personality: d.personality ?? "", source: d.id ? `creator:${d.id}` : "creator",
  };
}

/** the model that makes this character's pictures: realistic → Krea 2, anime → Anima or Illustrious */
export function charModel(c: Character): "krea2" | "anima" | "noob" {
  if (c.style === "realistic") return "krea2";
  return c.animeModel ?? (c.sheet?.model === "noob" || c.frame?.model === "noob" ? "noob" : "anima");
}
/** their own checkpoint for a model (shared with the sheet maker), or undefined for the official one */
export function charCkpt(c: Character, model: "krea2" | "anima" | "noob" = charModel(c)): string | undefined {
  return c.sheet?.ckpt?.[model === "krea2" ? "krea" : model] || undefined;
}
/** LoRA family for a model */
export const familyOfModel = (m: "krea2" | "anima" | "noob") => (m === "noob" ? "sdxl" : m) as "krea2" | "anima" | "sdxl";
