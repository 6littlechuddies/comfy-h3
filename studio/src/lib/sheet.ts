// "Make full sheet": one high-resolution picture with every body angle (cut into separate views when it's done),
// plus the face close-up and the cut-out — one click, three jobs, all from the character's front picture.
import { useDownloads } from "./downloads";
import { buildCreate, buildCutout, buildEdit, buildQwenEdit } from "./graphs";
import { animeTags, charModel, familyOfModel, useCharacters, type Character, type View } from "./characters";
import { useJobs } from "./jobs";
import { DEFAULTS, editArgs, modelArgs, modelOf, newSeed, qualityTags, useSettings } from "./settings";
import type { EditEngine } from "./graphs";

/** the sheet's style: anime characters are drawn by Anima or Illustrious, realistic ones edited by Krea 2 */
export const sheetStyle = (c: Character): "anime" | "realistic" => c.sheet?.style ?? c.style;
export const SHEET_MODELS = {
  anime: [{ value: "krea", label: "Copy the picture (Krea 2 Edit)" }, { value: "noob", label: "Illustrious" }, { value: "anima", label: "Anima" }],
  realistic: [{ value: "krea", label: "Krea 2 Edit" }],
} as const;
/** who draws a character's other angles (Characters → sheet maker → Style / Made with) */
export function viewEngine(c: Character): EditEngine {
  const style = sheetStyle(c);
  const m = c.sheet?.model;
  if (style === "anime") {
    if (m === "anima" || m === "noob" || m === "krea") return m;
    // their own picture is the look: copy it (Krea 2 Edit keeps the face, outfit and art style); no picture → draw from tags
    if (c.views.front) return "krea";
    const fm = c.frame?.model;
    return fm === "noob" ? "noob" : "anima";
  }
  return "krea";
}
/** the IP-Adapter models are on this rental (the "Anime sheets that copy the picture" downloads) */
export function copiesPicture(): boolean {
  const g = useDownloads.getState().groups.find((x) => x.id === "animeref");
  return !!g && g.state === "done";
}
/** anime angles: the character's tags + the view, drawn fresh (same seed for every angle of one sheet so they match) */
const VIEW_TAGS: Record<string, string> = {
  front: "full body, standing, front view, looking at viewer, arms at sides",
  back: "full body, standing, from behind, back view, facing away",
  left: "full body, standing, from side, profile, facing left",
  right: "full body, standing, from side, profile, facing right",
  threeq: "full body, standing, three-quarter view, looking at viewer",
  face: "portrait, close-up, face focus, head and shoulders, looking at viewer, neutral expression",
  smile: "portrait, close-up, face focus, smile, looking at viewer",
  angry: "portrait, close-up, face focus, angry, looking at viewer",
  surprised: "portrait, close-up, face focus, surprised, open mouth, looking at viewer",
};
function animeViewGraph(c: Character, engine: "anima" | "noob", view: string, bg: "grey" | "white", seed: number, frontName?: string) {
  const cs = useSettings.getState().s.create;
  const mi = modelOf(cs, "anime", engine);
  // the character's LoRAs: the ones from their starting frame when it used this model, else their own list
  const loras = c.frame?.model === engine && c.frame.loras?.length ? c.frame.loras : c.loras ?? [];
  const closeUp = /face|smile|angry|surprised/.test(view);
  const positive = `${qualityTags(mi)}, ${animeTags(c)}, ${VIEW_TAGS[view] ?? VIEW_TAGS.front}, solo focus, simple background, ${bg === "white" ? "white" : "grey"} background`;
  const mineCk = c.sheet?.ckpt?.[engine] || (c.frame?.model === engine ? c.frame.checkpoint : undefined);
  const own = mineCk ? (engine === "noob" ? { ckpt: mineCk } : { unet: mineCk }) : {};
  // Illustrious looks at their front picture while drawing (IP-Adapter), so every angle copies it — Anima can only read the tags
  const ref = engine === "noob" && frontName && view !== "front" && copiesPicture() ? { image: frontName, weight: closeUp ? 0.8 : (c.sheet?.refWeight ?? 0.6), endAt: closeUp ? 0.9 : 0.75 } : undefined;
  return buildCreate({ ...mi.adv, seed, ...modelArgs(cs, mi), ...own, positive, negative: DEFAULTS.create.negative, loras, ...(ref ? { ref } : {}),
    width: closeUp ? 1024 : 832, height: closeUp ? 1024 : 1216, count: 1, cutout: false, prefix: `studio/characters/${c.id}_${view}` });
}
/** the prompts name "image 1"; Krea 2 reads plain words about "this" picture */
export const forEngine = (_engine: EditEngine, text: string) => text.replace(/the exact same (character|person) from image 1/gi, "this exact $1").replace(/as image 1/gi, "as in this picture").replace(/image 1/gi, "this picture");
/** every sheet picture shows the one character, alone */
export const ONE = " Only this one person in the picture, alone — no other people, no duplicates, no extra figures.";
/** one angle of a character: anime → drawn by Anima / Illustrious; realistic → edited from their front picture */
/** the camera directions the Multiple Angles LoRA knows, per sheet view (a profile "facing left" = the camera on their right) */
export const ANGLE_OF: Partial<Record<string, string>> = {
  back: "back view", left: "right side view", right: "left side view", threeq: "front-left quarter view",
};
/** the Qwen angle tool is on this rental (it comes with the Edit chat helper download) */
export function anglesReady(): boolean {
  const g = useDownloads.getState().groups.find((x) => x.id === "qwen");
  return !!g && g.state === "done";
}
export function viewGraph(c: Character, frontName: string, instruction: string, view: string, seed = newSeed()) {
  const engine = viewEngine(c);
  if (engine === "anima" || engine === "noob") return animeViewGraph(c, engine, view, /white background/i.test(instruction) ? "white" : "grey", seed, frontName);
  // realistic back / side / three-quarter: Qwen-Image-Edit + the Multiple Angles LoRA turns the camera around them (it was
  // trained on exactly that); Krea 2 Edit copies the front picture's angle and mostly refuses to turn
  const angle = ANGLE_OF[view];
  if (angle && sheetStyle(c) === "realistic" && anglesReady() && c.sheet?.angles !== "krea") {
    return buildQwenEdit({ images: [frontName], prompt: `<sks> ${angle} eye-level shot wide shot`, seed, prefix: `studio/characters/${c.id}_${view}`, angles: true });
  }
  const e = useSettings.getState().s.edit;
  const style = sheetStyle(c) === "anime" ? " Keep exactly the same art style, line art, shading and colours as this picture — it is the same drawing style, not a photo." : " Keep it a photo with the same skin texture, lighting quality and colours.";
  // their LoRAs only when they're for this model (Krea 2) — anime LoRAs can't load here
  const loras = sheetStyle(c) === "realistic" ? c.loras ?? [] : [];
  const unet = c.sheet?.ckpt?.krea || undefined;
  return buildEdit({ ...editArgs(e, engine), loras: [...(editArgs(e, engine).loras ?? []), ...loras], enhance: false, seed: newSeed(), images: [frontName], instruction: forEngine(engine, instruction) + style + ONE, negative: "", resolution: 1024, prefix: `studio/characters/${c.id}_${view}`, ...(unet ? { unet } : {}) });
}
const SHEET_PROMPTS = {
  left: "Show the exact same character from image 1 in a full-body side profile view facing left, standing straight. Keep the same face, hair, outfit, colours and body proportions.",
  back: "Show the exact same character from image 1 seen from directly behind: full body, standing straight, arms relaxed at the sides. Keep the same hair, outfit, colours and body proportions.",
  right: "Show the exact same character from image 1 in a full-body side profile view facing right, standing straight. Keep the same face, hair, outfit, colours and body proportions.",
  threeq: "Show the exact same character from image 1 in a full-body three-quarter view from the front-left, standing. Keep the same face, hair, outfit, colours and body proportions.",
} as const;
/** the expressions that come with a full sheet (close-ups, no background line) */
const SHEET_FACES = {
  smile: "Close-up portrait of the exact same character from image 1, head and shoulders, with a warm genuine smile. Keep the same face, hair, eyes and outfit.",
  angry: "Close-up portrait of the exact same character from image 1, head and shoulders, with an angry, intense expression. Keep the same face, hair, eyes and outfit.",
  surprised: "Close-up portrait of the exact same character from image 1, head and shoulders, with a surprised expression. Keep the same face, hair, eyes and outfit.",
} as const;

export const FACE_PROMPT = "Close-up portrait of the exact same character from image 1: head and shoulders, facing the camera, neutral expression. Keep exactly the same face, hair, eyes, skin and outfit. Sharp, highly detailed.";

/** the one-picture turnaround sheet: six views of the one character on a clean white background, for consistency in AI image and video work */
export const SHEET_PROMPT = "Create a professional character turnaround reference sheet for the same single character, designed for AI image/video production consistency. Show the character in these six clearly separated views on one clean white background: full-body front view, full-body front-facing neutral pose, full-body 3/4/profile view, full-body back view, detailed front facial close-up, and detailed side-profile facial close-up. Keep the exact same character identity, face, facial proportions, hairstyle, body proportions, skin appearance, clothing, accessories, and overall appearance consistent across every view. Arrange all views cleanly with enough spacing between them. No text overlay.";
/** the sheet's canvas (landscape, about 2 megapixels) */
export const SHEET_CANVAS = { width: 1920, height: 1088 };

/** the sheet as ONE Krea 2 Edit picture: a blank white landscape canvas as picture 1, the character's front picture as the subject.
 *  Krea 2 Edit keeps the face, outfit and art style of a drawing too, so it serves anime characters as well. */
export function sheetGraph(c: Character, frontName: string, seed = newSeed()) {
  const e = useSettings.getState().s.edit;
  const anime = sheetStyle(c) === "anime";
  const style = anime ? " Keep exactly the same art style, line art, shading and colours as the character picture — it is the same drawing style, not a photo." : " Keep it a photo with the same skin texture, lighting quality and colours.";
  const intro = "The first picture is a blank white canvas; the second picture is the character. ";
  const unet = c.sheet?.ckpt?.krea || undefined;
  const loras = sheetStyle(c) === "realistic" ? c.loras ?? [] : [];
  return buildEdit({ ...editArgs(e, "krea"), loras: [...(editArgs(e, "krea").loras ?? []), ...loras], enhance: false, seed, images: [frontName],
    blank: SHEET_CANVAS, instruction: `${intro}${SHEET_PROMPT} These are six views of ONE single person, not six different people.${style}`, negative: "", resolution: 1440,
    prefix: `studio/characters/${c.id}_sheet`, ...(unet ? { unet } : {}) });
}

/** "Make sheet": one picture with every view, plus the cut-out. (The angles one by one are still in the sheet maker.) */
export async function queueFullSheet(c: Character, _bg: "grey" | "white" = "white") {
  const front = await useCharacters.getState().asMedia(c.id, "front");
  if (!front) throw new Error("Add their front picture first (drop one in, or make it)");
  const run = useJobs.getState().run;
  await run("characters", `${c.name}: character sheet`, sheetGraph(c, front.name), "characters:view:krea", { charId: c.id, view: "sheet", single: true });
  await run("characters", `${c.name}: cut-out`, buildCutout(front.name, `studio/characters/${c.id}_cutout`), "characters:cutout", { charId: c.id, view: "cutout" });
}

/** what a sheet job carries along: "redraw it in Anima / Illustrious after Krea 2 copies it" */
export function viewMeta(c: Character): Record<string, unknown> {
  return viewEngine(c) === "krea" && sheetStyle(c) === "anime" && c.sheet?.redraw ? { redraw: c.sheet.redraw } : {};
}

/** an angle Krea 2 Edit copied from the front picture, redrawn lightly in the character's anime model: same pose and angle, their anime look */
export async function redrawView(id: string, view: View, engine: "anima" | "noob") {
  const c = useCharacters.getState().list.find((x) => x.id === id);
  if (!c) return;
  const m = await useCharacters.getState().asMedia(id, view);
  if (!m) return;
  const cs = useSettings.getState().s.create;
  const mi = modelOf(cs, "anime", engine);
  const ck = c.sheet?.ckpt?.[engine];
  const tags = VIEW_TAGS[view] ?? "";
  const fam = engine === "noob" ? "sdxl" : "anima";
  const loras = familyOfModel(charModel(c)) === fam ? c.loras ?? [] : [];
  const g = buildEdit({ ...editArgs(useSettings.getState().s.edit, engine), seed: newSeed(), loras, denoise: c.sheet?.redrawStrength ?? 0.45, images: [m.name],
    instruction: `${qualityTags(mi)}, ${animeTags(c)}${tags ? `, ${tags}` : ""}, solo focus, simple background`, negative: DEFAULTS.create.negative,
    resolution: 1024, prefix: `studio/characters/${c.id}_${view}`, ...(ck ? (engine === "noob" ? { ckpt: ck } : { unet: ck }) : {}) });
  await useJobs.getState().run("characters", `${c.name}: ${view} redrawn in ${engine === "noob" ? "Illustrious" : "Anima"}`, g, `characters:redraw:${engine}`, { charId: id, view });
}
