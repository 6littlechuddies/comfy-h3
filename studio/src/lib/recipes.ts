// Your recipes: the steps you do to a picture again and again (put her face on it → sharpen the face → upscale → add to
// her private set), saved once and run on one picture or fifty. Each step takes the previous step's picture; only the
// last picture shows up in your results, the in-between ones stay quiet. Saved on the rental (state/my_recipes) and in
// character exports / backups.
import { create } from "zustand";
import { loadState, saveState, type FileRef } from "./api";
import { addToSiteSet, useCharacters, type Character } from "./characters";
import { useJobs, waitForJob, type Job, type Tab } from "./jobs";
import { useTray, type Media } from "./tray";

export type StepKind = "face" | "with" | "change" | "sharpen" | "upscale" | "privateSet" | "siteSet" | "trainSet";
export interface Step { id: string; kind: StepKind; words?: string; title?: string; tier?: "free" | "premium"; asChar?: boolean }
export interface MyRecipe { id: string; name: string; steps: Step[]; updated: number }

export interface StepInfo { label: (c: string) => string; icon: string; blurb: string; group: "Change the picture" | "Finish" | "Keep it"; needsChar?: boolean; keeps?: boolean }
export const STEP_INFO: Record<StepKind, StepInfo> = {
  face: { label: (c) => `Put ${c}'s face on it`, icon: "user", group: "Change the picture", needsChar: true, blurb: "Only the face and hair change — body, outfit, pose and place stay" },
  with: { label: (c) => `${c} in this picture`, icon: "user", group: "Change the picture", needsChar: true, blurb: "The whole person and outfit become theirs, in this picture's pose and place (uses the writer)" },
  change: { label: () => "Change it with words", icon: "brush", group: "Change the picture", blurb: "Krea 2 Edit — e.g. “mouth closed”, “make it night”; everything else stays" },
  sharpen: { label: () => "Sharpen the face", icon: "sparkle", group: "Finish", blurb: "SAM 3 finds the face and it's redrawn sharper" },
  upscale: { label: () => "Upscale ×2 with detail", icon: "up", group: "Finish", blurb: "Bigger, lightly redrawn by the model that made it — sharper skin, hair and fabric" },
  privateSet: { label: (c) => `Add to ${c}'s private set`, icon: "lock", group: "Keep it", needsChar: true, keeps: true, blurb: "The premium set for your site — send it from their page" },
  siteSet: { label: (c) => `Add to one of ${c}'s sets`, icon: "folder", group: "Keep it", needsChar: true, keeps: true, blurb: "A free or premium set by name — made if it's new" },
  trainSet: { label: (c) => `Add to ${c}'s training set`, icon: "layers", group: "Keep it", needsChar: true, keeps: true, blurb: "Face-checked, and kept if it scores high enough for a LoRA" },
};
export const stepLabel = (s: Step, who: string) => {
  const base = STEP_INFO[s.kind].label(who);
  if (s.kind === "change" && s.words?.trim()) return `Change: “${s.words.trim()}”`;
  if (s.kind === "siteSet" && s.title?.trim()) return `Add to ${who}'s “${s.title.trim()}” set (${s.tier ?? "free"})`;
  if (s.kind === "sharpen" && s.asChar) return `Sharpen the face as ${who}`;
  return base;
};
export const needsCharacter = (r: Pick<MyRecipe, "steps">) => r.steps.some((s) => STEP_INFO[s.kind].needsChar || (s.kind === "sharpen" && s.asChar));
const uid = () => Math.random().toString(36).slice(2, 9);
export const newStep = (kind: StepKind): Step => ({ id: uid(), kind, ...(kind === "siteSet" ? { title: "", tier: "free" as const } : {}) });

const STARTERS = (): MyRecipe[] => [
  { id: "starter-web", name: "Web picture → my character, ready for the site", updated: 0, steps: [newStep("face"), { ...newStep("sharpen"), asChar: true }, newStep("upscale"), newStep("privateSet")] },
  { id: "starter-polish", name: "Polish", updated: 0, steps: [newStep("sharpen"), newStep("upscale")] },
  { id: "starter-train", name: "Training pictures from the web", updated: 0, steps: [newStep("face"), { ...newStep("sharpen"), asChar: true }, newStep("trainSet")] },
];

interface RecipeState {
  list: MyRecipe[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (r: MyRecipe) => void;
  remove: (id: string) => void;
}
export const useRecipes = create<RecipeState>((set, get) => ({
  list: [], loaded: false,
  load: async () => {
    if (get().loaded) return;
    const saved = await loadState<MyRecipe[]>("my_recipes");
    set({ list: Array.isArray(saved) ? saved : STARTERS(), loaded: true });
  },
  save: (r) => {
    const list = get().list.some((x) => x.id === r.id) ? get().list.map((x) => (x.id === r.id ? { ...r, updated: Date.now() } : x)) : [...get().list, { ...r, updated: Date.now() }];
    set({ list }); saveState("my_recipes", list).catch(() => {});
  },
  remove: (id) => { const list = get().list.filter((x) => x.id !== id); set({ list }); saveState("my_recipes", list).catch(() => {}); },
}));
export const blankRecipe = (steps: Step[] = []): MyRecipe => ({ id: uid(), name: "", steps, updated: 0 });

/** the model family a result was made with (for the upscale step), from its job's saved settings */
export function familyOf(f: FileRef): "krea2" | "anima" | "sdxl" {
  const j = useJobs.getState().jobs.find((x) => x.outputs.some((o) => o.filename === f.filename && o.subfolder === f.subfolder));
  const snap = j?.meta?.snapshot as { section?: string; settings?: Record<string, unknown> } | undefined;
  const s = snap?.settings ?? {};
  if (snap?.section === "create" && s.style === "anime") return s.animeModel === "noob" ? "sdxl" : "anima";
  if (snap?.section === "edit" && (s.engine === "anima" || s.engine === "noob")) return s.engine === "noob" ? "sdxl" : "anima";
  return "krea2";
}
/** any picture (a result, an upload) as a file the next step can read */
export async function mediaOf(f: FileRef, label = "Picture"): Promise<Media> {
  const item = useTray.getState().addOutput(f, label);
  if (!item) throw new Error(`Can't use ${f.filename}`);
  return useTray.getState().asMedia(item.id);
}
const outOf = async (j: Job): Promise<FileRef> => {
  const done = await waitForJob(j.id);
  const o = done.outputs.find((x) => x.kind === "image" && x.type === "output");
  if (!o) throw new Error(`${j.label} made no picture`);
  return { filename: o.filename, subfolder: o.subfolder, type: o.type };
};

/** the character a recipe works with: the one picked on the left */
export function recipeCharacter(): Character | null {
  const st = useCharacters.getState();
  return st.list.find((x) => x.id === st.sel) ?? null;
}

/** one step on one picture → the picture for the next step */
async function runStep(s: Step, cur: FileRef, c: Character | null, family: "krea2" | "anima" | "sdxl", tab: Tab, meta: Record<string, unknown>): Promise<FileRef> {
  const need = () => { if (!c) throw new Error("Pick the character on the left first"); return c; };
  switch (s.kind) {
    case "face": {
      const { faceOntoJobs } = await import("./likeness");
      return outOf((await faceOntoJobs(await mediaOf(cur), need(), 1, { tab, meta, faceFix: false }))[0]);
    }
    case "with": {
      const { withCharacterJobs } = await import("./likeness");
      return outOf((await withCharacterJobs(await mediaOf(cur), need(), 1, { tab, meta, faceFix: false })).jobs[0]);
    }
    case "change": {
      const [{ buildEdit }, { editArgs, newSeed, useSettings }] = await Promise.all([import("./graphs"), import("./settings")]);
      const words = (s.words ?? "").trim();
      if (!words) return cur;
      const m = await mediaOf(cur);
      const instruction = `Make a version of this picture where: ${words.replace(/\.?$/, ".")} Keep the same person with exactly the same face, hair, outfit, setting, lighting and style; everything not mentioned stays as it is.`;
      const g = buildEdit({ ...editArgs(useSettings.getState().s.edit, "krea"), refBoost: 3, seed: newSeed(), images: [m.name], instruction, negative: "", resolution: 1024, prefix: "studio/edit/recipe" });
      return outOf(await useJobs.getState().run(tab, `Change: ${words.slice(0, 40)}`, g, "edit:krea:1:raw", { before: m.url, ...meta }));
    }
    case "sharpen": {
      const { sharpenFace } = await import("./faceDetail");
      return (await sharpenFace(cur, { tab, character: s.asChar ? need() : null, meta })) ?? cur; // no face found → the picture goes on as it was
    }
    case "upscale": {
      const { upscaleJob } = await import("./likeness");
      return outOf((await upscaleJob(await mediaOf(cur), family, { tab, meta })).job);
    }
    case "privateSet": addToSiteSet(need().id, "Private", "premium", cur); return cur;
    case "siteSet": addToSiteSet(need().id, s.title?.trim() || "New set", s.tier ?? "free", cur); return cur;
    case "trainSet": { const { addToSet } = await import("./builder"); await addToSet(need(), cur); return cur; }
  }
}

export interface RecipeRun { id: string; name: string; total: number; done: number; failed: string[]; step: Record<number, string>; started: number; finished?: number; stop?: boolean }
export const useRecipeRuns = create<{ runs: RecipeRun[] }>(() => ({ runs: [] }));
const patchRun = (id: string, f: (r: RecipeRun) => Partial<RecipeRun>) => useRecipeRuns.setState((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...f(r) } : r)) }));

/** run a recipe on pictures, two at a time; resolves when every picture is through (failures are counted, not thrown) */
export async function runRecipe(r: MyRecipe, pics: FileRef[], tab: Tab = "batch"): Promise<RecipeRun> {
  if (!r.steps.length) throw new Error("This recipe has no steps yet");
  if (!pics.length) throw new Error("No pictures to run it on");
  const c = recipeCharacter();
  if (needsCharacter(r) && !c) throw new Error(`“${r.name}” needs a character — pick one on the left first`);
  const run: RecipeRun = { id: uid(), name: r.name || "Recipe", total: pics.length, done: 0, failed: [], step: {}, started: Date.now() };
  useRecipeRuns.setState((s) => ({ runs: [run, ...s.runs.filter((x) => !x.finished || Date.now() - x.finished < 600_000)].slice(0, 8) }));
  // the last step that makes a picture: its result is the one you see; everything before it stays out of your results
  const lastMaker = r.steps.map((s) => !STEP_INFO[s.kind].keeps && !(s.kind === "change" && !s.words?.trim())).lastIndexOf(true);
  const who = c?.name ?? "";
  let next = 0;
  const worker = async () => {
    while (next < pics.length) {
      const i = next++;
      const src = pics[i];
      if (useRecipeRuns.getState().runs.find((x) => x.id === run.id)?.stop) return;
      const family = familyOf(src);
      let cur = src;
      try {
        for (let k = 0; k < r.steps.length; k++) {
          const s = r.steps[k];
          patchRun(run.id, (x) => ({ step: { ...x.step, [i]: `${k + 1}/${r.steps.length} ${stepLabel(s, who)}` } }));
          const meta = k === lastMaker ? { stack: `recipe:${run.id}:${i}`, recipe: r.name, quietFail: true } : { quiet: true, noTray: true, quietFail: true }; // failures: one summary at the end
          cur = await runStep(s, cur, c, family, tab, meta);
        }
        patchRun(run.id, (x) => ({ done: x.done + 1, step: { ...x.step, [i]: "done" } }));
      } catch (e) {
        const msg = /^404\b/.test((e as Error).message) ? "its file isn't on the rental any more" : (e as Error).message;
        patchRun(run.id, (x) => ({ done: x.done + 1, failed: [...x.failed, `Picture ${i + 1}: ${msg}`], step: { ...x.step, [i]: "failed" } }));
      }
    }
  };
  await Promise.all([worker(), worker()]);
  patchRun(run.id, () => ({ finished: Date.now() }));
  const fin = useRecipeRuns.getState().runs.find((x) => x.id === run.id)!;
  const ok = fin.total - fin.failed.length;
  useJobs.getState().toast(`${fin.name}: ${ok} of ${fin.total} picture${fin.total > 1 ? "s" : ""} done${fin.failed.length ? ` — ${fin.failed[0]}` : ""}`, fin.failed.length ? "bad" : "good", tab);
  return fin;
}
export const stopRun = (id: string) => patchRun(id, () => ({ stop: true }));
