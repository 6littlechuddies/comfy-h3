// Turn a CivitAI picture or video (an example in the LoRA browser, or a pasted civitai.com/images/… link)
// into ready-to-go settings: its prompt, sampler settings and the LoRAs it used, sent to Animate, Create or Prompt.
import { civitFetchMedia, inputUrl, installLora, type CivitGen, type CivitImage, type CivitResource, type CivitVersion, type LoraJob , CIVITAI_SITE } from "./api";
import type { LoraPick } from "./graphs";
import { useCharacters, type Character } from "./characters";
import { STYLE_CATS, toPieces } from "./tweak";
import { modelOf, pickModel, useSettings, type Adv, type AnimateS, type CreateModel } from "./settings";
import { useTray, type Media } from "./tray";
import { makeRef, useWork } from "./work";

const SAMPLERS: [RegExp, string][] = [
  [/^dpm\+\+ 2m sde gpu/, "dpmpp_2m_sde_gpu"], [/^dpm\+\+ 2m sde/, "dpmpp_2m_sde"], [/^dpm\+\+ 3m sde/, "dpmpp_3m_sde"],
  [/^dpm\+\+ 2s a/, "dpmpp_2s_ancestral"], [/^dpm\+\+ 2m/, "dpmpp_2m"], [/^dpm\+\+ sde/, "dpmpp_sde"],
  [/^dpm2 a/, "dpm_2_ancestral"], [/^dpm2/, "dpm_2"], [/^dpm fast/, "dpm_fast"], [/^dpm adaptive/, "dpm_adaptive"],
  [/^euler a/, "euler_ancestral"], [/^euler/, "euler"], [/^heun/, "heun"], [/^lms/, "lms"], [/^ddim/, "ddim"],
  [/^unipc/, "uni_pc"], [/^lcm/, "lcm"], [/^er.?sde/, "er_sde"],
];
/** "DPM++ 2M Karras" → { sampler: "dpmpp_2m", scheduler: "karras" }; ComfyUI names pass straight through */
export function mapSampler(name: string, sched = ""): { sampler?: string; scheduler?: string } {
  const n = name.trim().toLowerCase();
  if (!n) return {};
  if (/^[a-z0-9_]+$/.test(n)) return { sampler: n, scheduler: sched.toLowerCase().replace(/\s+/g, "_") || undefined };
  const sampler = SAMPLERS.find(([re]) => re.test(n))?.[1];
  const both = `${n} ${sched.toLowerCase()}`;
  const scheduler = /karras/.test(both) ? "karras" : /exponential/.test(both) ? "exponential" : /sgm.?uniform/.test(both) ? "sgm_uniform"
    : /beta/.test(both) ? "beta" : /simple/.test(both) ? "simple" : /ddim/.test(n) ? "ddim_uniform" : sampler ? "normal" : undefined;
  return { sampler, scheduler };
}

export const cleanPrompt = (p: string) => p.replace(/<lora:[^>]+>/gi, "").replace(/\s+,/g, ",").replace(/(,\s*){2,}/g, ", ").replace(/^\s*,|,\s*$/g, "").trim();

/** where a picture made with this base model can be remade in the Studio */
export type CreateTarget = CreateModel;
export function createTargetFor(family: string | undefined): CreateTarget | null {
  return family === "anima" ? "anima" : family === "sdxl" ? "noob" : family === "krea2" ? "krea2" : family === "qwen" ? "krea2" : null;
}
export const targetFamily = (t: CreateTarget) => modelOf(useSettings.getState().s.create, undefined, t).family;
/** the Create target to use for a CivitAI image: its own model if the Studio has it, else what Create is set to now */
export function createTargetOf(g: CivitGen): CreateTarget {
  return createTargetFor(g.family) ?? createTargetFor(g.resources.find((r) => r.kind === "lora" && createTargetFor(r.family))?.family) ?? modelOf(useSettings.getState().s.create).model;
}
export const lorasFor = (g: CivitGen, family: string) => g.resources.filter((r) => r.kind === "lora" && (r.family === family || r.family === "unknown"));

/** an example from the LoRA browser, as generation data (used until the full details arrive, or if CivitAI won't give them) */
export function genFromExample(img: CivitImage, v: CivitVersion, m: { model_id: number; name: string }, installedName?: string): CivitGen {
  return {
    id: img.id, page: `${CIVITAI_SITE}/images/${img.id}`, url: img.url, thumb: img.thumb, video: img.video, width: img.width, height: img.height,
    explicit: img.explicit, username: "", prompt: img.prompt, negative: img.negative, sampler: img.sampler, scheduler: img.scheduler,
    steps: img.steps, cfg: img.cfg, seed: img.seed, size: img.size, base: v.base, family: v.family, process: "", comfy: false, more: {},
    resources: [{ kind: "lora", model_id: m.model_id, version_id: v.id, name: m.name, version: v.name, base: v.base, family: v.family, weight: img.weight, trigger: v.trigger, installed: installedName ?? null }],
  };
}

const clampW = (w: number | null | undefined) => Math.round(Math.max(0.1, Math.min(1.5, w ?? 0.8)) * 20) / 20;

/** download the LoRAs that aren't in the library yet; returns them as picks */
/** LoRAs a picture used, into your library — up to 4 download at once; onEach reports each one's progress (0–1) */
export async function ensureLoras(rs: CivitResource[], onStep?: (msg: string) => void, onEach?: (r: CivitResource, progress: number) => void): Promise<{ picks: LoraPick[]; failed: string[] }> {
  const slots: (LoraPick | null)[] = rs.map(() => null), failed: string[] = [];
  let next = 0, left = rs.filter((r) => !r.installed).length;
  const one = async (i: number) => {
    const r = rs[i];
    let name = r.installed;
    if (!name && r.model_id && r.version_id) {
      onStep?.(left > 1 ? `Adding ${left} LoRAs…` : `Adding ${r.name}…`);
      onEach?.(r, 0);
      const res: LoraJob = await installLora(`https://civitai.com/models/${r.model_id}?modelVersionId=${r.version_id}`, (st) => onEach?.(r, st.progress))
        .catch((e: Error) => ({ status: "error", progress: 0, error: e.message }));
      left--;
      if (res.status === "done" && res.name) { name = res.name; r.installed = name; if (!r.trigger && res.trigger) r.trigger = res.trigger; onEach?.(r, 1); }
      else { failed.push(`${r.name}: ${res.error ?? "download failed"}`); onEach?.(r, -1); return; }
    }
    if (!name) { failed.push(`${r.name}: not downloadable`); return; }
    slots[i] = { name, strength: clampW(r.weight), trigger: r.trigger || undefined };
  };
  const worker = async () => { while (next < rs.length) await one(next++); };
  await Promise.all(Array.from({ length: Math.min(4, rs.length) }, worker));
  return { picks: slots.filter(Boolean) as LoraPick[], failed };
}

const merge = (old: LoraPick[], add: LoraPick[]) => [...old.filter((l) => !add.some((a) => a.name === l.name)), ...add];
const aspectOf = (w?: number, h?: number): AnimateS["aspect"] | undefined => (w && h ? (w / h > 1.25 ? "16:9" : w / h < 0.8 ? "9:16" : "1:1") : undefined);
const seedOk = (s?: number | null) => !!s && s > 0 && s < 2 ** 53;

/** copy the picture/clip into this rental's inputs (and the tray) */
/** the CivitAI picture each copied file came from, so "Copy its look" works on it later in any slot */
export const GEN_OF = new Map<string, CivitGen>();
export async function genMedia(g: CivitGen): Promise<Media> {
  if (g.local) return { ...g.local, url: inputUrl(g.local.name), label: g.local.name };
  const f = await civitFetchMedia(g.url, g.id);
  GEN_OF.set(f.name, g);
  const label = `CivitAI ${g.id}`;
  useTray.getState().addOutput({ filename: f.name, subfolder: "", type: "input" }, label);
  return { ...f, url: inputUrl(f.name), label };
}

/** prompt + video LoRAs (+ optionally the clip/picture as a reference) → Animate */
export async function genToAnimate(g: CivitGen, o: { media: boolean; loras: CivitResource[] }, onStep?: (msg: string) => void): Promise<{ failed: string[] }> {
  const { picks, failed } = await ensureLoras(o.loras, onStep);
  const st = useSettings.getState();
  const a = st.s.animate;
  const patch: Partial<AnimateS> = { prompt: cleanPrompt(g.prompt), loras: merge(a.loras, picks) };
  const asp = aspectOf(g.width, g.height);
  if (asp) patch.aspect = asp;
  if (g.family === "h3") {
    const adv: Adv = { ...a.adv };
    const sm = mapSampler(g.sampler, g.scheduler);
    if (sm.sampler) adv.sampler = sm.sampler;
    if (sm.scheduler) adv.scheduler = sm.scheduler;
    if (g.steps) adv.steps = Math.max(4, Math.min(60, Math.round(g.steps)));
    if (seedOk(g.seed)) { adv.seed = g.seed!; adv.lockSeed = true; }
    patch.adv = adv;
  }
  if (o.media) {
    onStep?.(g.video ? "Copying the clip…" : "Copying the picture…");
    const m = await genMedia(g);
    const ref = { ...makeRef(m), label: g.video ? "moves and camera to copy" : "reference picture" };
    useWork.getState().set({ animateRefs: [...useWork.getState().animateRefs, ref] });
    patch.mode = "ref";
  }
  st.set("animate", patch);
  return { failed };
}

/** prompt, sampler settings, shape and the matching LoRAs → Create (Exact prompt) */
export async function genToCreate(g: CivitGen, onStep?: (msg: string) => void): Promise<{ failed: string[]; target: CreateTarget }> {
  const t = createTargetOf(g);
  const { picks, failed } = await ensureLoras(lorasFor(g, targetFamily(t)), onStep);
  const st = useSettings.getState();
  const c = st.s.create;
  const mi = modelOf(c, undefined, t);
  const adv = copySettings(g, mi.adv, t, true);
  const [w, h] = (g.size || `${g.width}x${g.height}`).split("x").map(Number);
  const r = w && h ? w / h : 0.75;
  st.set("create", {
    ...pickModel(t), raw: true, extra: cleanPrompt(g.prompt), shape: r < 0.85 ? "portrait" : r > 1.2 ? "wide" : "square",
    [mi.advKey]: adv, [mi.lorasKey]: merge(mi.loras, picks),
    ...(g.negative ? { negative: cleanPrompt(g.negative) } : {}),
  });
  return { failed, target: t };
}
/** a CivitAI image's sampler / scheduler / steps / CFG (/ seed) onto a model's settings, within what that model likes */
function copySettings(g: CivitGen, base: Adv, t: CreateTarget, seed: boolean): Adv {
  const adv: Adv = { ...base };
  const sm = mapSampler(g.sampler, g.scheduler);
  if (sm.sampler) adv.sampler = sm.sampler;
  if (sm.scheduler) adv.scheduler = sm.scheduler;
  if (g.steps) adv.steps = Math.max(4, Math.min(60, Math.round(g.steps)));
  if (g.cfg && (t === "noob" || t === "anima" || t === "krea2raw")) adv.cfg = Math.max(1, Math.min(12, g.cfg));
  if (g.cfg && t === "krea2") adv.cfg = Math.max(1, Math.min(6, g.cfg));
  if (seed && seedOk(g.seed)) { adv.seed = g.seed!; adv.lockSeed = true; }
  return adv;
}

/** the prompt as the idea, and the clip/picture as a reference → the Prompt helper writes an H3 timeline from it */
export async function genToPrompt(g: CivitGen, media: boolean, onStep?: (msg: string) => void) {
  const st = useSettings.getState();
  st.set("prompt", { idea: cleanPrompt(g.prompt) });
  if (media) {
    onStep?.(g.video ? "Copying the clip…" : "Copying the picture…");
    const m = await genMedia(g);
    useWork.getState().set({ promptRefs: [...useWork.getState().promptRefs, { ...makeRef(m), label: g.video ? "moves and camera to copy" : "reference picture" }] });
  }
}

/** everything as text, in the usual "A1111" layout */
export function genAsText(g: CivitGen): string {
  const kv = [["Steps", g.steps], ["Sampler", g.sampler], ["Schedule type", g.scheduler], ["CFG scale", g.cfg], ["Seed", g.seed], ["Size", g.size],
    ["Model", g.resources.find((r) => r.kind === "checkpoint")?.name], ...Object.entries(g.more)].filter(([, v]) => v !== undefined && v !== null && v !== "");
  const res = g.resources.map((r) => `${r.kind === "lora" ? "LoRA" : r.kind}: ${r.name}${r.version ? ` (${r.version})` : ""}${r.weight != null ? ` @ ${r.weight}` : ""}${r.base ? ` [${r.base}]` : ""}`);
  return [cleanPrompt(g.prompt), g.negative ? `Negative prompt: ${cleanPrompt(g.negative)}` : "", kv.map(([k, v]) => `${k}: ${v}`).join(", "), ...res, `Source: ${g.page}`].filter(Boolean).join("\n");
}

/** "Copy style": its lighting / camera / style words, settings and matching LoRAs → Create, keeping your own subject and character */
export async function genStyleToCreate(g: CivitGen, onStep?: (msg: string) => void): Promise<{ failed: string[]; target: CreateTarget; words: string }> {
  const t = createTargetOf(g);
  const { picks, failed } = await ensureLoras(lorasFor(g, targetFamily(t)), onStep);
  const words = toPieces(cleanPrompt(g.prompt)).filter((p) => STYLE_CATS.includes(p.cat) && p.cat !== "quality").map((p) => p.text).join(", ");
  const st = useSettings.getState();
  const mi = modelOf(st.s.create, undefined, t);
  st.set("create", { ...pickModel(t), raw: false, extra: words, [mi.advKey]: copySettings(g, mi.adv, t, false), [mi.lorasKey]: merge(mi.loras, picks) });
  return { failed, target: t, words };
}

export type SwapMode = "swap" | "remake" | "pose";
/** put a saved character into a CivitAI picture. Three ways:
 *  - swap: the person in the picture BECOMES your character (pose, framing, light and place stay). With the Edit chat helper
 *    (Qwen-Image-Edit 2511) downloaded it runs as an Edit chat message — Qwen swaps the person, Krea 2 repaints with their
 *    LoRA, the face pass and the face check follow. Without it: SAM 3 outlines the person and Krea 2 Edit redraws only that
 *    area with your character, so a second person can't appear next to the first.
 *  - remake: its CivitAI prompt and your character's look are merged by the writer (only the person's description is
 *    swapped; pose, place, camera and light stay word for word) → a new picture from text in Create, with their LoRA.
 *  - pose: the pose is read off the picture, limb by limb → a new picture of your character in that pose, from text. */
export async function genSwap(g: CivitGen, c: Character, o: { mode: SwapMode; outfit: "theirs" | "picture"; who: string }, onStep?: (msg: string) => void): Promise<"edit" | "create"> {
  onStep?.("Copying the picture…");
  const target = await genMedia(g);
  useCharacters.getState().select(c.id);
  const anime = (c.sheet?.style ?? c.style) === "anime";
  const noun = c.gender === "male" ? "man" : c.gender === "female" ? "woman" : "person";
  const { useDownloads } = await import("./downloads");
  const ready = (id: string) => { const gr = useDownloads.getState().groups.find((x) => x.id === id); return !gr || gr.state === "done"; };
  const st = useSettings.getState();

  if (o.mode === "swap") {
    const front0 = (await useCharacters.getState().asMedia(c.id, "front")) ?? (await useCharacters.getState().asMedia(c.id, "face"));
    if (!front0) throw new Error(`${c.name} has no picture yet — add one in Characters first`);
    // shown without their own background, so it can't end up next to the new one
    const front = await (await import("./editchat")).plainOf(c, front0);
    const whom = o.who.trim() ? `the ${o.who.trim().replace(/^the\s+/i, "")}` : `the ${noun}`;
    if (ready("qwen")) {
      onStep?.("Starting an Edit chat…");
      const ec = await import("./editchat");
      await ec.useEditChat.getState().load();
      const chat = ec.useEditChat.getState().newChat();
      ec.useEditChat.getState().patch(chat.id, (x) => ({ ...x, title: `${c.name} into CivitAI ${g.id}` }));
      const pic = ec.addPic(chat.id, target, { label: "civitai", start: true });
      const me = await ec.addCharacter(chat.id, c);
      const outfit = o.outfit === "picture" ? `, wearing the clothes ${whom} wears in @${pic.key}` : `, in ${c.gender === "male" ? "his" : "her"} own outfit from @${me.key}`;
      st.set("edit", { chat: true });
      st.setTab("edit");
      // the chat shows each step; this returns when the message has gone in
      ec.send(`@${me.key} replaces ${whom} in @${pic.key}${outfit}. Keep the exact pose, hands, framing, light and background of @${pic.key}. Only one person: ${c.name}.`).catch(() => {});
      return "edit";
    }
    if (!anime && ready("sam")) {
      onStep?.(`Finding ${whom} (SAM 3)…`);
      const [{ selectByWords }, { buildEdit }, { editArgs, newSeed }, { useJobs }, { charLoras }] = await Promise.all([import("./faceDetail"), import("./graphs"), import("./settings"), import("./jobs"), import("./make")]);
      const sel = await selectByWords(target.name, o.who.trim() || noun, 12, true); // a tight outline: the old 24 px reached into the background
      if (sel) {
        const base = editArgs(st.s.edit, "krea");
        const wear = o.outfit === "picture" ? " Keep the clothes in this picture." : ` They wear ${c.name}'s outfit from the second picture.`;
        const instruction = `Replace the ${noun} in this picture with the ${noun} from the second picture: exactly their face, hair, eye colour, skin tone and body. Same pose, hands, framing and light.${wear} Only one person. Everyone is an adult.`;
        const fix = st.s.edit.faceFix ? { faceFix: { character: c.id, strength: st.s.edit.faceStrength ?? 0.45 } } : {};
        for (let i = 0; i < 2; i++) {
          const graph = buildEdit({ ...base, loras: [...(base.loras ?? []), ...charLoras(c, "krea2")], seed: newSeed(), images: [target.name, front.name], instruction, negative: "", resolution: 1024,
            prefix: "studio/edit/swap", mask: sel.mask.name, maskSoftness: 6, refBoost: 4 });
          await useJobs.getState().run("edit", `${c.name} into CivitAI ${g.id} ${i + 1}/2`, graph, "edit:krea:2:raw", { before: target.url, ...fix });
        }
        st.setTab("edit");
        return "edit";
      }
    }
    // last resort (anime, or nothing to outline): Krea 2 Edit / the anime redraw in Create with both pictures
    const { useMakeRefs, makeWithRefs } = await import("./make");
    st.set("create", { characterId: c.id, raw: false, style: anime ? "anime" : "realistic", extra: o.who.trim() ? `the ${o.who.trim()}` : "" });
    useMakeRefs.setState({ pic1: front, pic1Own: true, pic2: target, take: "look", remixOf: null, remixBase: null });
    st.setTab("create");
    const cs = useSettings.getState().s.create;
    await makeWithRefs({ c, anime, prompt: o.outfit === "picture" ? "wearing the clothing from this picture" : "", count: 1, loras: modelOf(cs).loras, label: `${c.name} into CivitAI ${g.id}` });
    return "create";
  }

  // remake / pose: a new picture from words, in Create, with the character's LoRA — no second picture, so no second person
  let words: string;
  if (o.mode === "remake") {
    onStep?.("Merging its prompt with your character…");
    const { carryLikeness } = await import("./likeness");
    words = (await carryLikeness({ pic1: target, pic2: null, character: c, anime, outfit: o.outfit === "picture" ? "scene" : "new person", progress: onStep })).prompt;
  } else {
    onStep?.("Reading the pose, limb by limb…");
    const { readPicture } = await import("./make");
    const pose = await readPicture(target, "pose", anime, o.who.trim() ? `the ${o.who.trim()}` : `one ${noun}`, "full");
    const { looks, animeTags } = await import("./characters");
    words = anime ? `${animeTags(c)}, ${pose}` : `${looks(c)} ${pose}`;
  }
  const { useMakeRefs } = await import("./make");
  useMakeRefs.setState({ pic1: null, pic2: null, remixOf: null, remixBase: null });
  // the merged prompt goes to Krea 2 exactly as written (you see it in the box and can change it and press Generate again)
  st.set("create", { ...pickModel(anime ? (st.s.create.animeModel === "noob" ? "noob" : "anima") : "krea2"), characterId: c.id, style: anime ? "anime" : "realistic", raw: true, make: "scene", extra: words });
  st.setTab("create");
  setTimeout(async () => { const { usePrimary } = await import("../App"); usePrimary.getState().fns.create?.(); }, 700);
  return "create";
}

/** a CivitAI clip performed by your character: the clip + their pictures → Prompt (writes the H3 timeline) */
export async function genClipWithCharacter(g: CivitGen, c: Character, onStep?: (msg: string) => void) {
  onStep?.("Copying the clip…");
  const clip = await genMedia(g);
  const views = (await Promise.all((["front", "face"] as const).map(async (v) => [v, await useCharacters.getState().asMedia(c.id, v)] as const))).filter(([, m]) => m);
  const refs = [...views.map(([v, m]) => ({ ...makeRef(m!), label: `${c.name} — ${v === "front" ? "full body" : "face"}`, charId: c.id })), { ...makeRef(clip), label: "moves and camera to copy" }];
  useWork.getState().set({ promptRefs: refs, timeline: null });
  useSettings.getState().set("prompt", { idea: "", mode: "references", seconds: Math.max(2, Math.min(15, Math.round(clip.duration ?? 8))) });
}
