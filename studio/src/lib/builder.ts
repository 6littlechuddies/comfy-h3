// Build a training set from one picture: Krea 2 Edit puts the character onto blank canvases in many different shots
// (40% close-up, 30% half-body, 30% full-body, varied angle, expression, outfit, place and light — the mix the Krea 2
// character-LoRA guides recommend), the local vision writer scores each one 0–10 against their own picture, and the ones
// that keep the face are captioned for a LoRA trainer ("trigger, single person, framing, angle, expression, …").
import { makeBoard, toInput, type FileRef } from "./api";
import { faceView, useCharacters, type Character, type TrainItem, type TrainSet } from "./characters";
import { nounOf } from "./cast";
import { buildEdit } from "./graphs";
import { useJobs, waitForJob } from "./jobs";
import { editArgs, newSeed, useSettings } from "./settings";
import { runWriter } from "./writer";

type Shot = TrainItem["shot"];
interface Variation { shot: Shot; framing: string; angle: string; expression: string; outfit: string | null; place: string; light: string }

// a LoRA learns the angles it's shown: without side and back pictures it can't draw them later
const ANGLES = ["facing the camera", "three-quarter view from the left", "side profile", "seen from behind, looking back over the shoulder", "three-quarter view from the right", "seen slightly from above", "back view, facing away from the camera", "seen slightly from below"];
const EXPRESSIONS = ["neutral expression", "soft smile", "laughing", "serious look", "surprised", "thoughtful, looking away", "playful grin", "calm, eyes closed"];
const OUTFITS: (string | null)[] = [null, "a casual t-shirt and jeans", null, "a cozy knit sweater", "an elegant evening dress", null, "sportswear", "a light summer outfit", null, "a winter coat and scarf"];
const PLACES = ["a plain light grey studio", "a sunny park", "a cafe interior", "a city street", "a bedroom with soft furnishings", "a beach", "an office", "a kitchen", "a forest path", "a rooftop at dusk"];
const LIGHTS = ["soft even light", "warm golden-hour sunlight", "bright daylight", "soft window light", "moody evening light", "overcast daylight"];
const FRAMING: Record<Shot, string> = { close: "close-up portrait, head and shoulders", half: "waist-up shot", full: "full-body shot, head to shoes in frame" };
const CANVAS: Record<Shot, { width: number; height: number }> = { close: { width: 1024, height: 1024 }, half: { width: 896, height: 1152 }, full: { width: 832, height: 1216 } };

/** n varied shots: 40% close-up, 30% half-body, 30% full-body; each list stepped at a different pace so the mixes don't repeat */
export function variations(n: number): Variation[] {
  const close = Math.round(n * 0.4), half = Math.round(n * 0.3);
  return Array.from({ length: n }, (_, i) => {
    const shot: Shot = i < close ? "close" : i < close + half ? "half" : "full";
    return {
      shot, framing: FRAMING[shot],
      angle: ANGLES[(i * 5) % ANGLES.length], expression: EXPRESSIONS[(i * 3) % EXPRESSIONS.length],
      outfit: shot === "close" ? null : OUTFITS[(i * 7) % OUTFITS.length],
      place: PLACES[(i * 3 + 1) % PLACES.length], light: LIGHTS[(i * 5 + 2) % LIGHTS.length],
    };
  });
}

/** a fictional trigger word from their name ("Maki Tanaka" → "makitnk"): short, unlikely to be a real word */
export function triggerOf(name: string): string {
  const s = name.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");
  const t = s.slice(0, 4) + s.slice(4).replace(/[aeiou]/g, "").slice(0, 4);
  return (t.length >= 4 ? t : `${t}chr`) + "x";
}

/** the edit instruction for one shot: the character from the picture, on a blank canvas, in this new scene */
function instructionOf(c: Character, v: Variation): string {
  const n = nounOf(c.gender);
  const outfit = v.outfit ? `wearing ${v.outfit}` : "wearing the same outfit as in the picture";
  const style = c.style === "anime" ? " Keep exactly the same art style, line art, shading and colours as the character picture — a drawing, not a photo." : " A natural, sharp photo with real skin texture.";
  return `The first picture is a blank canvas; the second picture is the ${n}. Make a new picture of this exact same ${n}: ${v.framing}, ${v.angle}, ${v.expression}, ${outfit}, in ${v.place}, ${v.light}. `
    + `Keep exactly the same face, eyes, hair, skin and body proportions as in the second picture. Only this one ${n} in the picture, alone — do not copy the second picture in beside them, there is exactly one person. Everyone is an adult.${style}`;
}

/** the training caption (the guides' format): trigger, single person, framing, angle, expression, hair, clothing, light, background */
function captionOf(c: Character, v: Variation, trigger: string): string {
  const clothes = v.outfit ?? (c.outfit || "their usual outfit");
  return [trigger, "single person", v.framing, v.angle, v.expression, c.hair, v.shot === "close" ? "" : clothes, v.light, v.place.replace(/^an? /, "")]
    .map((x) => x.trim()).filter(Boolean).join(", ");
}

const patchSet = (id: string, fn: (t: TrainSet) => TrainSet) => {
  const st = useCharacters.getState();
  const c = st.list.find((x) => x.id === id);
  if (!c) return;
  st.save({ ...c, trainset: fn(c.trainset ?? { trigger: triggerOf(c.name), items: [], minScore: 7 }) });
};
const patchItem = (id: string, itemId: string, p: Partial<TrainItem>) => patchSet(id, (t) => ({ ...t, items: t.items.map((x) => (x.id === itemId ? { ...x, ...p } : x)) }));

/** SCORE: 8 / SCORE: none → 8 / null; anything unreadable → undefined */
export function parseScore(text: string): { score: number | null | undefined; why: string } {
  const m = text.match(/SCORE:\s*(none|n\/a|\d+(?:\.\d+)?)/i);
  const why = (text.match(/WHY:\s*(.+)/i)?.[1] ?? "").trim();
  if (!m) return { score: undefined, why: why || text.slice(0, 120) };
  return { score: /^\d/.test(m[1]) ? Math.max(0, Math.min(10, Number(m[1]))) : null, why };
}

/** the picture the face check compares against: their face close-up when they have one, else their front picture */
const refOf = (c: Character): FileRef | undefined => { const v = faceView(c); return v ? c.views[v] : undefined; };

/** score one picture against the character (reference left, new picture right) */
export async function checkFace(c: Character, file: FileRef): Promise<{ score: number | null | undefined; why: string }> {
  const ref = refOf(c);
  if (!ref) throw new Error("They need a front picture to compare with");
  const board = await makeBoard([ref, file]);
  const out = await runWriter("match", { who: `${c.name}, the reference`, what: "the new picture to check" }, { tab: "characters", label: `Checking ${c.name}'s face`, images: [board.name], big: false });
  return parseScore(out);
}

let running = false;
export const isBuilding = () => running;

/** make `count` new pictures of the character and check each one; resolves when all are done */
export async function buildTrainSet(c: Character, count = 24): Promise<void> {
  if (running) throw new Error("Already building a set — wait for it to finish");
  const front = await useCharacters.getState().asMedia(c.id, "front");
  if (!front) throw new Error("Add their front picture first");
  running = true;
  try {
    const trig = c.trainset?.trigger || triggerOf(c.name);
    const base = editArgs(useSettings.getState().s.edit, "krea");
    const unet = c.sheet?.ckpt?.krea || undefined;
    // no character LoRA while making the set: a new LoRA trained on pictures an old one drew learns its flaws (and two
    // LoRAs on the identity edit blotch the skin)
    const loras: typeof c.loras = [];
    const vs = variations(count);
    // each shot copies from their sheet view at the closest angle (the edit keeps the angle of the picture it's given)
    const views = new Map<string, string>();
    for (const v of ["face", "threeq", "left", "right", "back"] as const) {
      if (!c.views[v]) continue;
      const m = await useCharacters.getState().asMedia(c.id, v).catch(() => null);
      if (m) views.set(v, m.name);
    }
    const refFor = (v: Variation): string => {
      const a = v.angle;
      const pick = /facing away|from behind|back view/.test(a) ? "back" : /side profile/.test(a) ? (views.has("left") ? "left" : "right")
        : /three-quarter/.test(a) ? "threeq" : v.shot === "close" ? "face" : "";
      return (pick && views.get(pick)) || front.name;
    };
    const stamp = Date.now().toString(36);
    const items: TrainItem[] = vs.map((v, i) => ({ id: `${stamp}${i}`, shot: v.shot, prompt: instructionOf(c, v), caption: captionOf(c, v, trig), status: "making" }));
    patchSet(c.id, (t) => ({ ...t, trigger: trig, items: [...items, ...t.items] }));
    // queue every picture first (the GPU keeps busy), then check them one by one as they finish
    const jobs = [];
    for (let i = 0; i < vs.length; i++) {
      const g = buildEdit({ ...base, loras: [...(base.loras ?? []), ...loras], enhance: false, seed: newSeed(), images: [refFor(vs[i])], blank: CANVAS[vs[i].shot],
        instruction: items[i].prompt, negative: "", resolution: 1024, refBoost: 4, prefix: `studio/characters/${c.id}_set/${vs[i].shot}`, ...(unet ? { unet } : {}) });
      jobs.push(await useJobs.getState().run("characters", `${c.name}: training picture ${i + 1}/${vs.length}`, g, "characters:view:krea", { buildFor: c.id, quiet: true }));
    }
    // all pictures first (Krea 2 stays loaded), then all checks (the writer loads once) — no swapping models back and forth
    const made: (FileRef | null)[] = [];
    for (let i = 0; i < jobs.length; i++) {
      try {
        const done = await waitForJob(jobs[i].id);
        const out = done.outputs.find((x) => x.kind === "image" && x.type === "output") ?? null;
        made.push(out);
        patchItem(c.id, items[i].id, out ? { file: out, status: "checking" } : { status: "failed", why: "no picture came out" });
      } catch (e) { made.push(null); patchItem(c.id, items[i].id, { status: "failed", why: (e as Error).message }); }
    }
    for (let i = 0; i < jobs.length; i++) {
      const it = items[i], out = made[i];
      if (!out) continue;
      const cur = useCharacters.getState().list.find((x) => x.id === c.id) ?? c;
      // two people in it (the model sometimes paints the reference next to the new one): never trained on — it teaches
      // the LoRA that "trigger" means two of them
      const people = await peopleIn(out);
      if (people > 1) { patchItem(c.id, it.id, { status: "done", score: null, why: `${people} people in this picture — left out (a training picture shows only them)`, keep: false }); continue; }
      const r = await checkFace(cur, out).catch((e) => ({ score: undefined, why: (e as Error).message }));
      const min = cur.trainset?.minScore ?? 7;
      // face hidden (from behind) → kept for variety but marked "not checked"; unreadable answer → you decide
      patchItem(c.id, it.id, { status: "done", score: r.score ?? null, why: r.why, keep: r.score === null ? it.shot === "full" : r.score === undefined ? false : r.score >= min });
    }
  } finally { running = false; }
}

/** how many faces SAM 3 sees (0 when it can't tell, or isn't downloaded) */
async function peopleIn(file: FileRef): Promise<number> {
  try {
    const { useDownloads } = await import("./downloads");
    const sam = useDownloads.getState().groups.find((g) => g.id === "sam");
    if (sam && sam.state !== "done") return 0;
    const { findFaces } = await import("./faceDetail");
    const { toInput } = await import("./api");
    const name = (await toInput(file)).name;
    const r = await findFaces(name, "characters", true);
    return r.boxes.filter((b) => b.score >= 0.45).length;
  } catch { return 0; }
}

/** check one picture again (after you changed the prompt file, or it failed) */
export async function recheck(c: Character, it: TrainItem) {
  if (!it.file) return;
  patchItem(c.id, it.id, { status: "checking" });
  const people = await peopleIn(it.file);
  if (people > 1) { patchItem(c.id, it.id, { status: "done", score: null, why: `${people} people in this picture — left out (a training picture shows only them)`, keep: false }); return; }
  const r = await checkFace(c, it.file).catch((e) => ({ score: undefined, why: (e as Error).message }));
  patchItem(c.id, it.id, { status: "done", score: r.score ?? null, why: r.why, keep: r.score != null && r.score >= (c.trainset?.minScore ?? 7) });
}
export const toggleKeep = (c: Character, it: TrainItem) => patchItem(c.id, it.id, { keep: !it.keep });
export const removeItem = (c: Character, it: TrainItem) => patchSet(c.id, (t) => ({ ...t, items: t.items.filter((x) => x.id !== it.id) }));
export const setTrainOpts = (c: Character, p: Partial<Pick<TrainSet, "trigger" | "minScore">>) => patchSet(c.id, (t) => {
  const next = { ...t, ...p };
  // a new trigger word goes into every caption; a new threshold re-sorts what's kept (your own clicks on unchecked ones stay)
  if (p.trigger && p.trigger !== t.trigger) next.items = next.items.map((x) => ({ ...x, caption: x.caption.replace(new RegExp(`^${t.trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), p.trigger!) }));
  if (p.minScore != null) next.items = next.items.map((x) => (typeof x.score === "number" ? { ...x, keep: x.score >= p.minScore! } : x));
  return next;
});
export const editCaption = (c: Character, it: TrainItem, caption: string) => patchItem(c.id, it.id, { caption });

/** what to train with (from the published Krea 2 character-LoRA guides; check them before a long run) */
export function readmeOf(c: Character, t: TrainSet, n: number): string {
  return `${c.name} — training set (${n} pictures), made in H3 Studio from one picture and checked for face match.
Trigger word: ${t.trigger}   (it begins every caption; use it in your prompts with the finished LoRA)

dataset/001.png + dataset/001.txt … — each picture with its caption, the layout every LoRA trainer reads.

Starting settings for a Krea 2 character LoRA, as published by the community guides
(github.com/chengyansen-ai/krea2-lora-training — Ostris AI-Toolkit; huggingface.co/JahJedi/krea2-character-lora-recipe — musubi-tuner):
- Train on Krea 2 RAW (not Turbo), then use the LoRA on Turbo.
- Rank 32, alpha 32 · learning rate 1e-4 (5e-5 if it starts copying backgrounds) · AdamW 8-bit, cosine
- About 2500 steps for a first run (likeness usually shows around 750–900) · batch 1
- Resolution buckets 512 / 768 / 1024 · caption dropout 0.05 · don't train the text encoder
- Timesteps: flowmatch, linear (not the "sigmoid" setting from Flux guides)
- Test each saved checkpoint with the same seed: a prompt like the training ones, a new situation, and one without the trigger word.

${c.style === "anime" ? "This character is anime: for Anima or Illustrious, train with a trainer for that model (kohya / sd-scripts for Illustrious) — the captions work the same way.\n" : ""}`;
}

/** download the kept pictures with their captions as one .zip */
export async function downloadSet(c: Character): Promise<number> {
  const t = c.trainset;
  const keep = (t?.items ?? []).filter((x) => x.keep && x.file);
  if (!t || !keep.length) throw new Error("Tick at least one picture to keep");
  const r = await fetch("/studio-api/trainset/zip", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: c.name, trigger: t.trigger, items: keep.map((x) => ({ file: x.file, caption: x.caption })), readme: readmeOf(c, t, keep.length) }) });
  if (!r.ok) throw new Error((await r.text()) || "Couldn't make the .zip");
  const b = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = (r.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]) ?? `${c.name}-trainset.zip`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return keep.length;
}

/** an imported picture (yours, CivitAI…) straight into the set: checked like the made ones */
export async function addToSet(c: Character, file: FileRef) {
  const t = c.trainset ?? { trigger: triggerOf(c.name), items: [], minScore: 7 };
  const it: TrainItem = { id: Date.now().toString(36), file, shot: "half", prompt: "(added by you)", caption: `${t.trigger}, single person`, status: "checking" };
  patchSet(c.id, (x) => ({ ...x, items: [it, ...x.items] }));
  await toInput(file).catch(() => null);
  const r = await checkFace(c, file).catch((e) => ({ score: undefined, why: (e as Error).message }));
  patchItem(c.id, it.id, { status: "done", score: r.score ?? null, why: r.why, keep: r.score == null || r.score >= t.minScore });
}
