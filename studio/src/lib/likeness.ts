// Edit → "Carry picture 2's look into picture 1": the way that worked by hand, as one button. Picture 1's prompt (from
// CivitAI, from the file, or read off the picture in detail) is rewritten by the local writer with picture 2's person in it —
// their look from picture 2's own prompt, your character's profile, or a read of picture 2 — keeping picture 1's pose,
// composition, light and style word for word. The result goes into Edit's box, and both pictures go to Krea 2 Edit.
import { fileGen, type CivitGen } from "./api";
import { cleanPrompt, GEN_OF } from "./civitUse";
import type { Character } from "./characters";
import { readPicture } from "./make";
import type { Media } from "./tray";
import { runWriter } from "./writer";

export type Source = "civitai" | "file" | "read" | "character";

/** a picture's own prompt: CivitAI's data for it, or what's written inside the file; null when it has none */
export async function promptOfPicture(m: Media): Promise<{ prompt: string; source: Source } | null> {
  const known: CivitGen | undefined = GEN_OF.get(m.name);
  if (known?.prompt?.trim()) return { prompt: cleanPrompt(known.prompt), source: "civitai" };
  if (m.kind !== "image") return null;
  const g = await fileGen(m).catch(() => null);
  if (g?.found && g.prompt?.trim()) return { prompt: cleanPrompt(g.prompt), source: g.source === "civitai" ? "civitai" : "file" };
  return null;
}

const noLoras = (t: string) => t.replace(/<lora:[^>]+>/gi, " ").replace(/\s{2,}/g, " ").trim();

export interface Carried { prompt: string; scene: Source; person: Source }

/** picture 1's prompt with picture 2's person (or your character) in it */
export async function carryLikeness(o: { pic1: Media; pic2: Media | null; character: Character | null; anime: boolean; outfit: "new person" | "scene";
  progress?: (what: string) => void }): Promise<Carried> {
  const people = o.character ? `one ${o.character.gender === "male" ? "man" : o.character.gender === "female" ? "woman" : "person"}` : "as many as in the picture";
  o.progress?.("Getting picture 1's prompt…");
  const p1 = await promptOfPicture(o.pic1);
  const scene = p1 ? noLoras(p1.prompt) : await readPicture(o.pic1, "all", o.anime, people, "full", "edit");
  o.progress?.("Getting the person's look…");
  let person = "", personFrom: Source = "read";
  const p2 = o.pic2 ? await promptOfPicture(o.pic2) : null;
  if (p2) { person = noLoras(p2.prompt); personFrom = p2.source; }
  else if (o.character && !o.pic2) {
    const { looks } = await import("./characters");
    person = looks(o.character); personFrom = "character";
  } else if (o.pic2) {
    person = await readPicture(o.pic2, "look", o.anime, "one person", "full", "edit");
    // your character's profile fills in what a picture can't show (eye colour up close, marks)
    if (o.character) { const { looks } = await import("./characters"); person += `\n\nTheir profile: ${looks(o.character)}`; }
  }
  if (!person.trim()) throw new Error("Add picture 2 (the person to put in), or pick a character on the left");
  o.progress?.("Writing the merged prompt…");
  const out = await runWriter("likeness", { scene, person, outfit: o.outfit, model: o.anime ? "anime" : "krea2" }, { tab: "edit", label: "Carrying the likeness into picture 1's prompt", big: true });
  return { prompt: out.trim(), scene: p1?.source ?? "read", person: personFrom };
}

export const SOURCE_LABEL: Record<Source, string> = { civitai: "its CivitAI prompt", file: "the prompt saved in the file", read: "read off the picture", character: "your character's profile" };

/** right-click → "Make this with <character>": the picture becomes picture 1, their front picture picture 2, the writer
 *  carries their look into the picture's prompt, and Krea 2 Edit makes `takes` versions — the whole hand workflow, one click */
export async function makeWithCharacter(pic: Media, c: Character, takes = 2, progress?: (s: string) => void): Promise<string> {
  const [{ useTray }, { useSettings }] = await Promise.all([import("./tray"), import("./settings")]);
  const r = await withCharacterJobs(pic, c, takes, { progress });
  // both pictures into Edit too, with the merged prompt — to tweak and run again by hand
  const id1 = useTray.getState().addOutput({ filename: pic.name, subfolder: "", type: "input" }, pic.label)?.id;
  const id2 = useTray.getState().addOutput({ filename: r.front.name, subfolder: "", type: "input" }, `${c.name} front`)?.id;
  useSettings.getState().set("edit", { engine: "krea", instruction: r.instruction });
  const { sendTo } = await import("../App");
  if (id1) sendTo("edit", [id1], "1");
  if (id2) sendTo("edit", [id2], "2");
  return `Making ${takes} versions with ${c.name} (picture 1: ${SOURCE_LABEL[r.scene]}). They appear in Edit, with both pictures and the merged prompt loaded to tweak.`;
}

export interface JobOpts {
  /** where the jobs show (default Edit) */
  tab?: import("./jobs").Tab;
  /** extra job meta (quiet steps of a recipe, a stack…) */
  meta?: Record<string, unknown>;
  /** sharpen the face afterwards — default: Edit's “Sharpen the face after” setting */
  faceFix?: boolean;
  progress?: (s: string) => void;
}
const faceFixMeta = async (c: Character, o: JobOpts) => {
  const { useSettings } = await import("./settings");
  const e = useSettings.getState().s.edit;
  return (o.faceFix ?? !!e.faceFix) ? { faceFix: { character: c.id, strength: e.faceStrength ?? 0.45 } } : {};
};

/** "<character> in this picture": the writer carries their look into the picture's prompt, Krea 2 Edit makes it */
export async function withCharacterJobs(pic: Media, c: Character, takes = 1, o: JobOpts = {}) {
  const [{ useCharacters }, { buildEdit }, { useJobs }, { editArgs, newSeed, useSettings }] = await Promise.all([
    import("./characters"), import("./graphs"), import("./jobs"), import("./settings")]);
  const front = await useCharacters.getState().asMedia(c.id, "front");
  if (!front) throw new Error(`${c.name} needs a front picture first (Characters → their page)`);
  const r = await carryLikeness({ pic1: pic, pic2: front, character: c, anime: false, outfit: "new person", progress: o.progress });
  const style = c.style === "anime" ? " Keep the drawing style of the picture: anime art, not a photo." : "";
  const instruction = `${r.prompt}${style}`;
  const base = editArgs(useSettings.getState().s.edit, "krea");
  const loras = c.style === "realistic" ? [...(base.loras ?? []), ...(c.loras ?? [])] : base.loras ?? [];
  const fix = await faceFixMeta(c, o);
  const jobs = [];
  for (let i = 0; i < takes; i++) {
    const g = buildEdit({ ...base, loras, enhance: false, seed: newSeed(), images: [pic.name, front.name], instruction, negative: "", resolution: 1024, prefix: "studio/edit/with" });
    jobs.push(await useJobs.getState().run(o.tab ?? "edit", `${c.name} in this picture${takes > 1 ? ` ${i + 1}/${takes}` : ""}`, g, "edit:krea:2:raw", { before: pic.url, ...fix, ...o.meta }));
  }
  return { jobs, front, instruction, scene: r.scene };
}

/** right-click → "Finish: upscale ×2": enlarged and lightly redrawn by the model that made it (Krea 2, Anima or Illustrious),
 *  with its own prompt when it has one — sharper skin, hair and fabric, same picture. Capped near 4 MP so it fits the GPU. */
export async function upscalePicture(pic: Media, family: "krea2" | "anima" | "sdxl" = "krea2"): Promise<string> {
  const r = await upscaleJob(pic, family);
  return `Upscaling to ${r.W}×${r.H} with ${r.engine === "krea" ? "Krea 2" : r.engine === "anima" ? "Anima" : "Illustrious"} — it appears in Edit`;
}
export async function upscaleJob(pic: Media, family: "krea2" | "anima" | "sdxl" = "krea2", o: JobOpts & { scale?: number; denoise?: number; prefix?: string } = {}) {
  const [{ buildUpscale }, { useJobs }, { modelOf, modelArgs, newSeed, useSettings }] = await Promise.all([import("./graphs"), import("./jobs"), import("./settings")]);
  const size = pic.width && pic.height ? { w: pic.width, h: pic.height } : await new Promise<{ w: number; h: number }>((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => rej(new Error("Couldn't open the picture")); i.src = pic.url; });
  const scale = o.scale ?? Math.max(1.25, Math.min(2, Math.sqrt((4.2 * 1048576) / (size.w * size.h))));
  const cs = useSettings.getState().s.create;
  const engine = family === "anima" ? "anima" : family === "sdxl" ? "noob" : "krea";
  const mi = modelOf(cs, engine === "krea" ? "realistic" : "anime", engine === "krea" ? "krea2" : engine);
  const ma = modelArgs(cs, mi) as { unet?: string; ckpt?: string };
  const own = await promptOfPicture(pic).catch(() => null);
  const generic = engine === "krea" ? "A sharp, highly detailed photo with natural skin texture, fine hair strands and crisp fabric." : "masterpiece, best quality, highly detailed, sharp lines";
  const prompt = own?.prompt ? noLoras(own.prompt) : generic;
  const g = buildUpscale({ image: pic.name, engine, scale, denoise: o.denoise ?? (engine === "krea" ? 0.3 : 0.35), prompt, negative: cs.negative, steps: mi.adv.steps, cfg: mi.adv.cfg,
    sampler: mi.adv.sampler, scheduler: mi.adv.scheduler, seed: newSeed(), unet: ma.unet, ckpt: ma.ckpt, loras: engine === "krea" ? [] : mi.loras, prefix: o.prefix ?? "studio/edit/finish" });
  const W = Math.round(size.w * scale), H = Math.round(size.h * scale);
  const job = await useJobs.getState().run(o.tab ?? "edit", `Finish ×${scale.toFixed(1)} → ${W}×${H}`, g, `upscale:${engine}`, { before: pic.url, ...o.meta });
  return { job, W, H, scale, engine };
}

/** right-click → "Put <character>'s face on this": the picture stays (body, outfit, pose, place); only the face and hair become
 *  theirs. No writer step, so it's quick — good for many pictures. */
export async function faceOnto(pic: Media, c: Character, takes = 2): Promise<string> {
  await faceOntoJobs(pic, c, takes);
  return `Putting ${c.name}'s face on it — ${takes} versions in Edit. Everything else in the picture stays.`;
}
export async function faceOntoJobs(pic: Media, c: Character, takes = 1, o: JobOpts = {}) {
  const [{ useCharacters }, { buildEdit }, { useJobs }, { editArgs, newSeed, useSettings }] = await Promise.all([
    import("./characters"), import("./graphs"), import("./jobs"), import("./settings")]);
  const front = await useCharacters.getState().asMedia(c.id, "front");
  if (!front) throw new Error(`${c.name} needs a front picture first (Characters → their page)`);
  const noun = c.gender === "male" ? "man" : c.gender === "female" ? "woman" : "person";
  const style = c.style === "anime" ? " Keep the picture's own art style." : "";
  const instruction = `Change only the face and hair of the ${noun} in this picture so they become the ${noun} from the second picture: exactly their face, eye colour, eyebrows, nose, lips, skin tone, hairstyle and hair colour. Keep everything else in this picture exactly as it is — body, outfit, pose, hands, expression, camera, lighting, colours and background.${style} Only one ${noun} in the picture. Everyone is an adult.`;
  const base = editArgs(useSettings.getState().s.edit, "krea");
  const fix = await faceFixMeta(c, o);
  // SAM 3 finds the face first and only a square around it is redrawn, with their face close-up as the reference — the
  // rest of the picture can't drift, and nobody gets blended with the person who was there
  const { findFaces, faceWindow } = await import("./faceDetail");
  const { charLoras } = await import("./make");
  const found = await findFaces(pic.name, o.tab ?? "edit", true).catch(() => ({ boxes: [], W: 0, H: 0 }));
  const face = found.boxes.find((b) => b.score >= 0.3);
  const closeup = c.views.face ? await useCharacters.getState().asMedia(c.id, "face").catch(() => null) : null;
  const region = face ? faceWindow(face, found.W, found.H) : null;
  const ref = region && closeup ? closeup : front;
  const regionWords = `This is a crop around one person's face. Replace the face and hairline with the ${noun} from the second picture: exactly their face shape, eyes, eye colour, eyebrows, nose, lips and skin tone. Keep this crop's head angle, expression, lighting, colours and framing.${style} Everyone is an adult.`;
  const jobs = [];
  for (let i = 0; i < takes; i++) {
    const g = region
      ? buildEdit({ ...base, loras: [...(base.loras ?? []), ...(c.style === "anime" ? [] : charLoras(c, "krea2"))], enhance: false, seed: newSeed(), images: [pic.name, ref.name], instruction: regionWords, negative: "", resolution: 1024,
          denoise: 0.88, refBoost: 4, region, prefix: "studio/edit/face-onto" })
      : buildEdit({ ...base, enhance: false, seed: newSeed(), images: [pic.name, front.name], instruction, negative: "", resolution: 1024, prefix: "studio/edit/face-onto" });
    jobs.push(await useJobs.getState().run(o.tab ?? "edit", `${c.name}'s face on this${takes > 1 ? ` ${i + 1}/${takes}` : ""}`, g, "edit:krea:2:raw", { before: pic.url, ...fix, ...o.meta }));
  }
  return jobs;
}
