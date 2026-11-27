// "Make full sheet": one high-resolution picture with every body angle (cut into separate views when it's done),
// plus the face close-up and the cut-out — one click, three jobs, all from the character's front picture.
import { useDownloads } from "./downloads";
import { buildCreate, buildCutout, buildEdit, buildQwenEdit } from "./graphs";
import { animeTags, charModel, familyOfModel, useCharacters, type Character, type View } from "./characters";
import { useJobs } from "./jobs";
import { M, quadSheetOn } from "./models";
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

/** the one-picture turnaround sheet, in the industry layout: five panels on a flat mid-grey studio background —
 *  full body (front three-quarter), full body (back three-quarter), side profile bust, front bust, three-quarter bust */
export const SHEET_PROMPT = "Character reference sheet of this exact same single person, keeping her face, hair, skin tone, body proportions, outfit and accessories exactly the same in every panel. One wide image, five panels side by side with clear empty space between them, on a plain flat mid-grey studio background, no text, no labels, no borders, no frames. Panel 1 (left): full body, standing straight, front three-quarter view, arms relaxed at the sides, the whole body visible from head to shoes. Panel 2: full body, back three-quarter view, same standing pose, head turned slightly away, showing the back of the hair and outfit. Panel 3: close side profile facing left, head and chest, neutral expression. Panel 4: straight-on front view, head to waist, looking directly at the camera, neutral relaxed expression, eyes level. Panel 5: three-quarter front view facing right, head to waist, neutral expression. Even soft studio lighting from the front, no harsh shadows, the same lighting in every panel, sharp focus, high detail on face, hair and fabric, consistent scale, a clean turnaround for 3D and animation reference.";
/** the panels, left to right, as her views (the sheet is cut into them) */
export const SHEET_ORDER = ["front", "back", "left", "face", "threeq"] as const;
/** the sheet's canvas: wide (about 2.6:1, like a turnaround strip), about 2 megapixels */
export const SHEET_CANVAS = { width: 2304, height: 896 };

/** the sheet as ONE Krea 2 Edit picture: a blank white landscape canvas as picture 1, the character's front picture as the subject.
 *  Krea 2 Edit keeps the face, outfit and art style of a drawing too, so it serves anime characters as well. */
/** the QuadView LoRA's trained caption (Alissonerdx/CharacterSheet): face close-up + front, side and back full body on 1536×1024 */
export const QUAD_CAPTION = "Convert the character in the image to a Character Sheet showing a face close-up, front full body, side full body and back full body views.";
/** this character's sheet is made with the QuadView LoRA (realistic characters, once it's downloaded) */
export const usesQuad = (c: Character) => quadSheetOn() && sheetStyle(c) === "realistic";
/** what a sheet job carries: QuadView sheets stay one picture (their panels aren't the old five), the others are cut into her angles */
export const sheetJobMeta = (c: Character): Record<string, unknown> => (usesQuad(c) ? { single: true } : { order: [...SHEET_ORDER] });
export function sheetGraph(c: Character, frontName: string, seed = newSeed()) {
  const e = useSettings.getState().s.edit;
  if (usesQuad(c)) {
    const unet = c.sheet?.ckpt?.krea || undefined;
    const base = editArgs(e, "krea").loras ?? [];
    return buildEdit({ ...editArgs(e, "krea"), loras: [...base, ...(c.loras ?? []), { name: M.quadView, strength: 1 }], enhance: false, seed, images: [frontName],
      blank: { width: 1536, height: 1024 }, instruction: `The first picture is a blank canvas; the second picture is the character. ${QUAD_CAPTION} One single person in every panel. Keep it a photo with the same skin texture, lighting quality and colours.`,
      negative: "", resolution: 1024, refBoost: 4, prefix: `studio/characters/${c.id}_sheet`, ...(unet ? { unet } : {}) });
  }
  const anime = sheetStyle(c) === "anime";
  const style = anime ? " Keep exactly the same art style, line art, shading and colours as the character picture — it is the same drawing style, not a photo." : " Keep it a photo with the same skin texture, lighting quality and colours.";
  const intro = "The first picture is a blank canvas; the second picture is the person. ";
  const unet = c.sheet?.ckpt?.krea || undefined;
  const loras = sheetStyle(c) === "realistic" ? c.loras ?? [] : [];
  return buildEdit({ ...editArgs(e, "krea"), loras: [...(editArgs(e, "krea").loras ?? []), ...loras], enhance: false, seed, images: [frontName],
    blank: SHEET_CANVAS, instruction: `${intro}${SHEET_PROMPT} These are five views of ONE single person, not five different people.${style}`, negative: "", resolution: 1440,
    prefix: `studio/characters/${c.id}_sheet`, ...(unet ? { unet } : {}) });
}

/** her expression sheet: ONE picture, a grid of head-and-shoulders close-ups of her face in many moods plus four mouth shapes
 *  (for the talking loops) — the same lighting in every panel. Video uses it as a second reference beside the turnaround, so
 *  her face holds when she laughs, pouts or talks, which is where likeness drifts in long actions. */
export const FACES_PROMPT = "Expression reference sheet of this exact same single person: one image, a neat grid of 12 head-and-shoulders close-ups, 4 columns by 3 rows, with thin even gaps between them, on a plain flat mid-grey studio background, no text, no labels, no borders. In every panel the same face, the same hair, the same skin with visible natural texture, the same outfit neckline, the same soft even front lighting and the same scale; only the expression changes. Row 1: neutral and relaxed, a soft closed-lip smile, laughing with eyes crinkled, a playful wink. Row 2: surprised with raised brows, shy and blushing looking slightly down, a small pout, a calm sultry half-lidded look. Row 3, mouth shapes while talking, facing the camera: saying \"ah\" (mouth open), saying \"ee\" (lips wide), saying \"oo\" (lips rounded), saying \"mm\" (lips pressed together). An adult woman. Sharp focus on the eyes, high detail.";
export const FACES_CANVAS = { width: 1920, height: 1440 };
export function facesGraph(c: Character, frontName: string, seed = newSeed()) {
  const e = useSettings.getState().s.edit;
  const anime = sheetStyle(c) === "anime";
  const style = anime ? " Keep exactly the same art style, line art, shading and colours as the character picture — it is the same drawing style, not a photo." : " Keep it a photo with the same skin texture, lighting quality and colours.";
  const unet = c.sheet?.ckpt?.krea || undefined;
  const loras = sheetStyle(c) === "realistic" ? c.loras ?? [] : [];
  return buildEdit({ ...editArgs(e, "krea"), loras: [...(editArgs(e, "krea").loras ?? []), ...loras], enhance: false, seed, images: [frontName],
    blank: FACES_CANVAS, instruction: `The first picture is a blank canvas; the second picture is the person. ${FACES_PROMPT} These are twelve pictures of ONE single person, not different people.${style}`, negative: "", resolution: 1440,
    prefix: `studio/characters/${c.id}_faces`, ...(unet ? { unet } : {}) });
}

/** her room as a set sheet, made from her webcam still: the same view with nobody in it, a wider view of the same room, and
 *  the wall behind her up close — Live clips get it as a reference picture so the room can't drift from part to part */
export const ROOM_PROMPT = "Location reference sheet of the exact room in the person picture, as a film set reference. One wide image, three panels side by side with thin even gaps, no text, no labels, no borders. Panel 1 (left): exactly the same camera position, angle, framing and light as the person picture, but the room is empty — nobody in it, the seat or bed she was on is empty with a natural dent. Panel 2 (middle): the same room seen from further back and a little higher, a wide view showing what is just outside the edges of the original frame (the rest of the bed, the walls on both sides, the window, the door, shelves and lamps), the same time of day and the same lamps on. Panel 3 (right): the background behind where she sat, closer, showing the wall, the decor and the objects behind her in sharp detail. Every panel is the same room with the same furniture, colours and light; nothing is added or moved. No people in any panel. A real photo, natural light falloff, no studio look.";
export const ROOM_CANVAS = { width: 2304, height: 896 };
export function roomGraph(stillName: string, prefix: string, seed = newSeed()) {
  const e = useSettings.getState().s.edit;
  return buildEdit({ ...editArgs(e, "krea"), enhance: false, seed, images: [stillName], blank: ROOM_CANVAS,
    instruction: `The first picture is a blank canvas; the second picture is a woman in her room. ${ROOM_PROMPT}`, negative: "", resolution: 1440, prefix });
}

/** 1-time unclothed body turnaround baseline edited directly from her clothed All-angles sheet (or front view), locking exact face, hair, height, bust, waist, hips and skin tone */
export const NUDE_SHEET_PROMPT = "Edit this character reference sheet so this exact same adult woman is completely nude in every panel (no clothes, no underwear, no accessories), while keeping her EXACT face, hair, skin tone, natural skin texture, height, bust, waist, hip proportions, standing poses, panel layout, scale and flat mid-grey studio background identical to picture 1. Even soft studio lighting, sharp focus, realistic natural anatomy, no text, no labels, no borders. One single adult woman.";
export function nudeSheetGraph(c: Character, baseSheetName: string, seed = newSeed()) {
  const e = useSettings.getState().s.edit;
  const anime = sheetStyle(c) === "anime";
  const style = anime ? " Keep the exact same anime art style, line art, shading and colours as picture 1." : " Keep it an unretouched realistic photograph with natural skin texture, pores and realistic lighting.";
  const unet = c.sheet?.ckpt?.krea || undefined;
  const loras = sheetStyle(c) === "realistic" ? c.loras ?? [] : [];
  return buildEdit({
    ...editArgs(e, "krea"),
    loras: [...(editArgs(e, "krea").loras ?? []), ...loras],
    enhance: false, seed, images: [baseSheetName],
    instruction: `${NUDE_SHEET_PROMPT}${style}`,
    negative: "", resolution: 1440,
    prefix: `studio/characters/${c.id}_nudeSheet`,
    ...(unet ? { unet } : {}),
  });
}

/** pixel-aligned Nude Anchor edited directly from her Clothed Anchor (+ Nude Body Sheet when present): exact same room, camera, light, pose, face and locked unclothed proportions */
export function nudeAnchorGraph(c: Character, clothedAnchorName: string, nudeSheetName: string | undefined, prefix: string, seed = newSeed()) {
  const e = useSettings.getState().s.edit;
  const anime = sheetStyle(c) === "anime";
  const style = anime ? " Keep the exact same anime art style, line art and shading as picture 1." : " Keep it an unretouched real webcam/phone photo with natural skin texture, pores and the exact same ambient lighting as picture 1.";
  const unet = c.sheet?.ckpt?.krea || undefined;
  const loras = sheetStyle(c) === "realistic" ? c.loras ?? [] : [];
  const images = nudeSheetName ? [clothedAnchorName, nudeSheetName] : [clothedAnchorName];
  const bodyClause = nudeSheetName
    ? " Picture 2 is her unclothed body reference sheet — match her exact face, skin tone, bust, waist, hips and natural body proportions from picture 2 exactly (do not copy picture 2's grey background or layout)."
    : " Keep her exact face, hair, skin tone and natural body build from picture 1.";
  return buildEdit({
    ...editArgs(e, "krea"),
    loras: [...(editArgs(e, "krea").loras ?? []), ...loras],
    enhance: false, seed, images,
    instruction: `Edit picture 1 so this exact same adult woman is completely nude (all clothing, shoes and accessories removed) in the EXACT same sitting/resting pose, exact same camera angle, exact same framing, exact same room, furniture, objects and lighting as picture 1.${bodyClause} Nothing in the background or camera moves by even a millimetre.${style} Only this one adult woman in the picture.`,
    negative: "", resolution: 1280, refBoost: nudeSheetName ? 3 : 2, prefix,
    ...(unet ? { unet } : {}),
  });
}

/** optional Mid-Undress Still edited from her Clothed Anchor (for complex outfits & cosplays): outer layer/top/jacket removed down to base layer/lingerie in the exact same room and pose */
export function undressMidGraph(c: Character, clothedAnchorName: string, prefix: string, seed = newSeed()) {
  const e = useSettings.getState().s.edit;
  const anime = sheetStyle(c) === "anime";
  const style = anime ? " Keep the exact same anime art style, line art and shading as picture 1." : " Keep it an unretouched real webcam/phone photo with natural skin texture and the exact same ambient lighting as picture 1.";
  const unet = c.sheet?.ckpt?.krea || undefined;
  const loras = sheetStyle(c) === "realistic" ? c.loras ?? [] : [];
  return buildEdit({
    ...editArgs(e, "krea"),
    loras: [...(editArgs(e, "krea").loras ?? []), ...loras],
    enhance: false, seed, images: [clothedAnchorName],
    instruction: `Edit picture 1 to show her half-undressed mid-striptease: her outer outfit/jacket/top/costume layers are removed (or slipped off her shoulders and tossed beside her), leaving her in matching simple underwear/lingerie (or base layer) in the EXACT same sitting/resting pose, exact same camera angle, exact same framing, exact same room, furniture and lighting as picture 1. Keep her exact face, hair and body proportions. Nothing in the background or camera moves.${style} Only this one adult woman in the picture.`,
    negative: "", resolution: 1280, prefix,
    ...(unet ? { unet } : {}),
  });
}

/** "Make sheet": one picture with every view, plus the cut-out. (The angles one by one are still in the sheet maker.) */
export async function queueFullSheet(c: Character, _bg: "grey" | "white" = "white") {
  const front = await useCharacters.getState().asMedia(c.id, "front");
  if (!front) throw new Error("Add their front picture first (drop one in, or make it)");
  const run = useJobs.getState().run;
  // cut into her angles too (side, back, face, three-quarter), so "Every angle" and the sheet + face pair both have them
  await run("characters", `${c.name}: character sheet`, sheetGraph(c, front.name), "characters:view:krea", { charId: c.id, view: "sheet", ...sheetJobMeta(c) });
  await run("characters", `${c.name}: expression sheet`, facesGraph(c, front.name), "characters:view:krea", { charId: c.id, view: "faces" });
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
