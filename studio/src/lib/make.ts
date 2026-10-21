// Create with pictures: Picture 1 = your character, Picture 2 = a reference (a CivitAI post, a pose, a scene).
// Realistic runs Krea 2 Edit; anime characters are redrawn by Anima / Illustrious on top of the reference.
// Also: plain words → anime tags (the local writer does the commas for you).
import { charModel, familyOfModel } from "./characters";
import { create } from "zustand";
import { animeTags, type Character, type View } from "./characters";
import { loraLibrary, type FileRef } from "./api";
import { castEditLine, castTags, nounOf, stripCountTags, type Cast, type Gender } from "./cast";
import { BUDGET, balanceLoras } from "./loraBalance";
import { buildEdit } from "./graphs";
import { useJobs, type Tab } from "./jobs";
import { DEFAULTS, editArgs, editKeys, modelOf, newSeed, qualityTags, useSettings } from "./settings";
import { copiesPicture, viewEngine } from "./sheet";
import type { LoraPick } from "./graphs";

/** which anime model draws: the character's own (their sheet / starting frame), else the one picked in Create */
export function animeEngine(c: Character | null): "anima" | "noob" {
  if (c) { const v = viewEngine(c); if (v === "noob") return "noob"; if (v === "anima") return "anima"; }
  if (c?.frame?.model === "noob") return "noob";
  return useSettings.getState().s.create.animeModel === "noob" ? "noob" : "anima";
}
import type { Media } from "./tray";
import { runWriter } from "./writer";

export type Take = "look" | "pose" | "scene" | "face" | "remake";
export const TAKES: { value: Take; label: string; hint: string }[] = [
  { value: "look", label: "Insert my character", hint: "your character replaces the person in picture 2: same pose, framing, light and background — only what your words ask for changes" },
  { value: "pose", label: "Just the pose", hint: "your character copies the pose and framing; the place comes from your words (or picture 2's, if you say nothing)" },
  { value: "scene", label: "Its place", hint: "your character goes into that place; the pose comes from your words" },
  { value: "remake", label: "Remake with words", hint: "picture 2's own prompt (from CivitAI or the file, or read off it) with your character written in, made fresh from text with their LoRA — never two people. The merged prompt lands in the box" },
  { value: "face", label: "Just their face", hint: "everything in this picture stays — body, outfit, pose, setting — only the face and hair become your character's (your Studio characters only)" },
];

/** what your words already change, so the "keep exactly" list doesn't fight them */
function keepOnly(words: string, keep: string[]): string[] {
  const w = words.toLowerCase();
  const drop = new Set<string>();
  if (/\b(background|setting|place|location|room|outside|outdoors|indoors|beach|street|bedroom|city|forest|studio|scene)\b/.test(w)) drop.add("background");
  if (/\b(light|lighting|lit|night|sunset|sunrise|day|dark|neon|glow|colou?rs?)\b/.test(w)) { drop.add("lighting"); drop.add("colours"); }
  if (/\b(pose|posing|sitting|sits|standing|stands|kneeling|lying|lies|leaning|walking|running|arms?|hands?|legs?|looking)\b/.test(w)) { drop.add("pose"); drop.add("body position"); drop.add("hand placement"); drop.add("facial angle"); }
  if (/\b(outfit|wearing|wears|dress|clothes|shirt|jacket|skirt|bikini|lingerie|naked|nude|uniform|suit)\b/.test(w)) drop.add("outfit");
  if (/\b(camera|close-?up|wide shot|from above|from below|angle|framing|zoom)\b/.test(w)) { drop.add("camera angle"); drop.add("framing"); drop.add("composition"); }
  return keep.filter((k) => !drop.has(k));
}
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");

interface RefState {
  /** Picture 1 — null = their front picture, filled in by itself */
  pic1: Media | null; pic1Own: boolean;
  /** Picture 2 — the reference */
  pic2: Media | null;
  /** Picture 3 (optional) — the place: a background / room / location picture (Pinterest, anywhere) */
  place: Media | null;
  take: Take;
  /** a result you pressed Remix on: shown small in the prompt box */
  remixOf: { url: string; out: FileRef; label: string } | null;
  /** remixing a picture: how much may change (0.3 = a little … 0.9 = a lot) */
  strength: number;
  /** the last plain-words → tags conversion, shown under the prompt box */
  tags: { from: string; to: string } | null;
  /** the character's sheet pictures that go in with Picture 1 (front always; face, 3/4, sides… shown side by side) */
  sheetViews: View[];
  /** how hard Krea 2 Edit holds on to your character's look (1 = loose, follows the reference; 8 = very strict) */
  hold: number;
  /** how closely to follow the reference's layout and pose: "auto" (loosens when your words ask for another pose),
   * 1 = exactly, 0.7 = loosely, 0.45 = just the feel */
  follow: "auto" | number;
  /** Remix: the prompt the picture was made with — words you add after it are worked in by the writer, not stapled on */
  remixBase: string | null;
  /** what the last press with pictures actually sent (shown under the prompt box, to see what the edit was told) */
  lastSent: { instruction: string; changes?: string; balanced?: string[]; loras: string[]; pictures: string[] } | null;
}
/** your words describe a pose or action → the reference's pose must be allowed to change */
export const POSE_WORDS = /\b(standing|stands?|sitting|sits?|seated|lying|lies|lays?|kneeling|kneels?|squatting|crouching|walking|running|jumping|dancing|leaning|bending|bent over|pose|posing|poses|arms?|hands?|legs?|looking (back|away|up|down|over|at)|over (her|his|the) shoulder|from behind|from the side|from above|from below|on (her|his|their) (back|knees|side|stomach)|turn(s|ed|ing)?|facing|crossed|spread|holding|reaching|stretching|waving|hugging|full body|close.?up|selfie)\b/i;
/** what goes into the edit's picture-1 dial (see EditOpts.sceneBoost) */
export function followFor(words: string, take: Take, follow: "auto" | number): number {
  if (follow !== "auto") return follow;
  if (take === "pose" || take === "face") return 1;
  return POSE_WORDS.test(words) ? 0.6 : 1;
}
/** your character goes in as ONE picture of their front and back — more angles side by side read as more people */
export const SHEET_DEFAULT: View[] = ["front", "back"];
const OLD_DEFAULT = JSON.stringify(["front", "face", "threeq"]);
const loadViews = (): View[] => { try { const raw = localStorage.getItem("h3.create.sheetViews") || "null"; if (raw === OLD_DEFAULT) return SHEET_DEFAULT; const v = JSON.parse(raw); return Array.isArray(v) && v.length ? v : SHEET_DEFAULT; } catch { return SHEET_DEFAULT; } };
export const useMakeRefs = create<RefState>(() => ({ pic1: null, pic1Own: false, pic2: null, place: null, take: "look", remixOf: null, strength: 0.6, tags: null, sheetViews: loadViews(), hold: 4, follow: "auto", remixBase: null, lastSent: null }));
useMakeRefs.subscribe((s, p) => { if (s.sheetViews !== p.sheetViews) try { localStorage.setItem("h3.create.sheetViews", JSON.stringify(s.sheetViews)); } catch { /* */ } });

/** Picture 1 as the character's whole look: their chosen sheet pictures side by side in one picture (null = just the one) */
let boardSides = "";
async function characterBoard(c: Character | null, own: boolean): Promise<string | null> {
  if (!c || own) return null;
  // the one-picture character sheet (six views of them): goes in as it is
  if (useMakeRefs.getState().sheetViews.includes("sheet") && c.views.sheet) {
    boardSides = "shown in six views on one character sheet (front, three-quarter, back and face close-ups)";
    const { toInput } = await import("./api");
    return (await toInput(c.views.sheet)).name;
  }
  const views = (["front", ...useMakeRefs.getState().sheetViews.filter((v) => v !== "front")] as View[]).filter((v) => c.views[v]);
  if (views.length < 2) return null;
  boardSides = views.length === 2 && views[1] === "back" ? "shown from the front and from the back" : `shown from ${views.length} sides`;
  const { makeBoard } = await import("./api");
  return (await makeBoard(views.map((v) => c.views[v]!))).name;
}

/** "a girl standing in the rain looking up" (plain words) vs "1girl, rain, looking up" (tags) */
export function looksPlain(text: string): boolean {
  const t = text.replace(/<lora:[^>]+>/g, "").trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words < 5) return false;
  const commas = (t.match(/,/g) ?? []).length;
  return /[.!?]\s|\b(the|with|and|is|are|she|he|her|his|while|who)\b/i.test(t) && commas / words < 0.3;
}

const cache = new Map<string, string>();
/** plain words → tags with the local writer (cached); tags stay as they are */
export async function toTags(text: string, c: Character | null): Promise<string> {
  if (!looksPlain(text)) return text;
  const key = `${c?.id ?? ""}|${text}`;
  const hit = cache.get(key);
  if (hit) { useMakeRefs.setState({ tags: { from: text, to: hit } }); return hit; }
  const out = (await runWriter("tags", { text, character: c ? animeTags(c) : "none" }, { tab: "create", label: "Turning your words into tags", big: true }))
    .split("\n")[0].replace(/\b(masterpiece|best quality|amazing quality|very aesthetic|absurdres|highres)\b,?\s*/gi, "").trim();
  cache.set(key, out);
  useMakeRefs.setState({ tags: { from: text, to: out } });
  return out;
}

const polishCache = new Map<string, string>();
/** realistic: plain words → a detailed Krea 2 prompt (the "Krea 2 frame builder" prompt file; your own one if you added it) */
export async function polishKrea(text: string, c: Character | null, shape: string): Promise<string> {
  const key = `${c?.id ?? ""}|${shape}|${text}|${(await import("./models")).writerFast() ? "fast" : ""}`;
  const hit = polishCache.get(key);
  if (hit) { useMakeRefs.setState({ tags: { from: text, to: hit } }); return hit; }
  const { looks } = await import("./characters");
  const character = c ? looks(c) : "An adult person exactly as FRAME describes them (no fixed character — describe them from FRAME).";
  const out = await runWriter("krea", { character, frame: text, aspect: shape === "wide" ? "16:9" : shape === "square" ? "1:1" : shape === "tall" ? "2:3" : "9:16" }, { tab: "create", label: "Writing your Krea 2 prompt", big: true });
  polishCache.set(key, out);
  useMakeRefs.setState({ tags: { from: text, to: out } });
  return out;
}

/** LoRAs for one model family: yours from Create + the character's own (no duplicates, Create's strength wins) */
export function mergeLoras(a: LoraPick[] = [], b: LoraPick[] = []): LoraPick[] {
  const out = [...a];
  for (const l of b) if (!out.some((x) => x.name === l.name)) out.push(l);
  return out;
}
/** the character's own LoRAs, when they're for this family (their style decides: realistic → Krea 2, anime → their anime model) */
export function charLoras(c: Character | null, family: "krea2" | "anima" | "sdxl"): LoraPick[] {
  if (!c) return [];
  if (family === "krea2") return c.style === "realistic" ? c.loras ?? [] : [];
  const eng = family === "sdxl" ? "noob" : "anima";
  if (c.frame?.model === eng && c.frame.loras?.length) return c.frame.loras;
  return c.style === "anime" && familyOfModel(charModel(c)) === family ? c.loras ?? [] : [];
}

/** a short request in plain words ("make it night, she's laughing") — used as typed. Anything longer, tag-like or copied
 *  from another picture goes through the writer, which keeps only the changes (see prompts/studio_changes.txt) */
export function isShortRequest(t: string): boolean {
  const w = t.trim().split(/\s+/).filter(Boolean).length;
  return w > 0 && w <= 25 && (t.match(/,/g) ?? []).length <= 4 && !/<lora:|\(\s*[^)]+:\s*\d/.test(t);
}
/** the writer off: your words as the change, untouched (on a remix, only what you added after the old prompt) */
export function typedChanges(words: string, before = ""): string {
  const w = words.trim(), b = before.trim();
  if (!w || (b && w === b)) return "";
  return b && w.startsWith(b) ? w.slice(b.length).replace(/^[\s,.;:]+/, "") : w;
}
const changesCache = new Map<string, string>();
/** what you want different from the picture, without anyone's looks and without the parts the take keeps.
 *  before = the prompt the picture was made with (Remix): only what you added or changed counts */
export async function changesOf(words: string, take: string, before = ""): Promise<string> {
  let w = words.trim(); const b = before.trim();
  if (!w || (b && w === b)) return "";
  if (b && w.startsWith(b)) { w = w.slice(b.length).replace(/^[\s,.;:]+/, ""); if (!w) return ""; if (isShortRequest(w)) return w; }
  else if (!b && isShortRequest(w)) return w;
  const key = `${take}|${b}|${w}`;
  const hit = changesCache.get(key); if (hit != null) return hit;
  const out = (await runWriter("changes", { take, before: b && !w.startsWith(b) ? b : "(none)", text: w }, { tab: "create", label: "Reading what you want changed", big: true }))
    .split("\n")[0].trim().replace(/^changes?:\s*/i, "");
  const res = /^none\.?$/i.test(out) ? "" : out;
  changesCache.set(key, res);
  return res;
}

const remixCache = new Map<string, string>();
/** Remix with words added at the end: the writer works them into the original prompt (replacing what they contradict)
 *  instead of stapling them on. Edited in place, or unchanged: used as it is */
export async function mergeRemix(words: string, base: string): Promise<string> {
  const w = words.trim(), b = base.trim();
  if (!b || !w.startsWith(b) || w === b) return w;
  const added = w.slice(b.length).replace(/^[\s,.;:]+/, "");
  if (!added) return b;
  const key = `${b}|${added}`;
  const hit = remixCache.get(key); if (hit) return hit;
  const out = (await runWriter("remix", { prompt: b, change: added }, { tab: "create", label: "Working your changes into the prompt", big: true })).trim();
  const res = out.length > 10 ? out : w;
  remixCache.set(key, res);
  useMakeRefs.setState({ tags: { from: `${b} + ${added}`, to: res } });
  return res;
}

/** a NEW picture of a character from a written shot: a blank canvas + their sheet view closest to the angle the words ask
 *  for ("from behind" → their back view), Krea 2 Identity Edit. Shared by Create (character + words) and Batch. */
export async function characterShot(c: Character, words: string, shot: string, shape: string, extra: LoraPick[], lib: Awaited<ReturnType<typeof loraLibrary>> | null) {
  const { angleView, plainOf } = await import("./editchat");
  const { useCharacters } = await import("./characters");
  const want: View = angleView(words) ?? (/\b(close.?up|portrait|headshot|selfie)\b/i.test(words) ? "face" : "front");
  const view: View = c.views[want] ? want : "front";
  const ref0 = await useCharacters.getState().asMedia(c.id, view);
  if (!ref0) throw new Error(`${c.name} needs a front picture first`);
  const ref = view === "front" ? await plainOf(c, ref0).catch(() => ref0) : ref0;
  const canvas = shape === "wide" || shape === "16:9" ? { width: 1216, height: 832 } : shape === "square" || shape === "1:1" ? { width: 1024, height: 1024 } : shape === "tall" ? { width: 832, height: 1248 } : { width: 768, height: 1344 };
  const noun = nounOf(c.gender);
  const instruction = `The first picture is a blank canvas; the second picture shows who this ${noun} is. Make this new photo of exactly that ${noun} — the same face, eyes, hair, skin and body proportions — in the pose, angle, expression, outfit and place described here, not the pose or angle of the second picture: ${shot} Only this one ${noun} in the picture, alone — do not copy the second picture in. Everyone is an adult.`;
  const e = useSettings.getState().s.edit;
  let loras = mergeLoras(editArgs(e, "krea").loras, mergeLoras(extra, charLoras(c, "krea2")));
  if (lib) loras = balanceLoras(loras, lib, BUDGET.kreaEdit).loras;
  return { ref, view, instruction, loras, canvas };
}

/** make pictures from Picture 1 (character) + Picture 2 (reference) + your words.
 *  loras: Create's LoRAs for the model in use (they carry into the edit); strength: how much a remix may change (0–1);
 *  every picture of one press stacks together in Results. */
const only1IsRef = (pic1: Media | null, pic2: Media | null) => !!pic2 && !pic1;
const VIEW_LABEL: Partial<Record<View, string>> = { front: "front picture", back: "back view", left: "side view", threeq: "three-quarter view", face: "face close-up" };
export async function makeWithRefs(o: { c: Character | null; anime: boolean; prompt: string; count: number;
  /** the writer is off: your words are used as typed (no rewriting, no tags) */
  asTyped?: boolean; label: string; loras?: LoraPick[]; strength?: number; stack?: string; snapshot?: unknown;
  cast?: Cast; gender?: Gender; outfit?: "character" | "picture"; balance?: boolean;
  /** Create's "Sharpen the face after": each picture goes through the SAM 3 face pass when it's done */
  faceFix?: { character: string | null; strength: number } }) {
  const st0 = useMakeRefs.getState();
  const { pic2, take, pic1Own, hold, follow, remixOf, remixBase } = st0;
  if (take === "remake" && pic2 && !remixOf) return remakeWithWords(pic2, o.c, o.anime, o.outfit === "picture", o.prompt);
  if (st0.place && !remixOf) return makeWithPlace(o.c, st0.pic1, pic2, st0.place, take, o.prompt, o.outfit === "picture");
  // Remix = one picture, changed by your words; your character's pictures don't go in (they're already in it)
  const remixing = !!remixOf && !!pic2;
  const pic1 = remixing ? null : st0.pic1;
  if (!pic1 && !pic2 && !st0.place) throw new Error("Add a picture first");
  const e = useSettings.getState().s.edit;
  const run = useJobs.getState().run;
  const words = o.prompt.trim();
  const stack = o.stack ?? `batch:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const gender: Gender = o.c?.gender ?? o.gender ?? "female";
  const noun = nounOf(gender);
  const cast = o.cast ?? "solo";
  const label = (i: number) => `${o.label}${o.count > 1 ? ` ${i + 1}/${o.count}` : ""}`;
  const engine = o.anime ? animeEngine(o.c) : "anima";
  const lib = o.balance === false ? [] : await loraLibrary().catch(() => []);
  // an anime character with their own picture: Illustrious can look at it (IP-Adapter); otherwise Krea 2 Edit copies it,
  // so the picture — not the description — decides how they look
  const charPic = !!(o.c && pic1);
  const animeRedraw = o.anime && (!charPic || (engine === "noob" && copiesPicture()));
  if (animeRedraw) {
    const mi = modelOf(useSettings.getState().s.create, "anime", engine);
    // a remix with words added: worked into the original prompt; then plain words become tags
    const merged = remixing && remixBase && !o.asTyped ? await mergeRemix(words, remixBase) : words;
    const tags = stripCountTags(o.asTyped ? merged : await toTags(merged, o.c));
    // people are always adults: the character's tags say so; without a character, say it here
    const instruction = [qualityTags(mi), castTags(gender, cast), o.c ? stripCountTags(animeTags(o.c)) : "adult", tags].filter(Boolean).join(", ");
    let loras = mergeLoras(o.loras, charLoras(o.c, engine === "noob" ? "sdxl" : "anima"));
    if (o.balance !== false) loras = balanceLoras(loras, lib, BUDGET[engine === "noob" ? "sdxl" : "anima"]).loras;
    const base = pic2 ?? pic1!;
    const d0 = (!pic2 ? 0.55 : take === "look" ? 0.62 : take === "pose" ? 0.78 : 0.7);
    // your words ask for another pose: redraw more of it, or the picture's pose shows through
    const g = followFor(words, take, follow);
    const denoise = o.strength ?? (g >= 1 ? d0 : Math.max(d0, Math.min(0.9, 1 - g * 0.35)));
    const ref = charPic && pic2 ? { image: pic1!.name, weight: o.c?.sheet?.refWeight ?? 0.7, endAt: 0.8 } : undefined;
    useMakeRefs.setState({ lastSent: { instruction, loras: loras.filter((l) => !l.off).map((l) => `${l.name.split("/").pop()!.replace(/\.safetensors$/, "")} ${l.strength.toFixed(2)}`), pictures: [base.label ?? "picture"] } });
    for (let i = 0; i < o.count; i++) {
      const graph = buildEdit({ ...editArgs(e, engine), loras, denoise, ...(ref ? { ref } : {}), enhance: false, seed: newSeed(), images: [base.name], instruction, negative: DEFAULTS.create.negative, resolution: 1024, prefix: "studio/create/refs" });
      await run("create", label(i), graph, `edit:${engine}:1:raw`, { before: base.url, stack, ...(o.snapshot ? { snapshot: o.snapshot } : {}), ...(o.faceFix ? { faceFix: o.faceFix } : {}), sent: sentOf(instruction, loras, o.c, words, engine === "noob" ? "Illustrious redraw" : "Anima redraw") });
    }
    return;
  }
  // Your character + words only (no picture to copy): a NEW picture on a blank canvas. It used to edit their front picture,
  // which kept its angle, pose, light and face — the same picture every time. The sheet view closest to the angle your
  // words ask for ("from behind" → their back view) goes in as who they are, and the writer (or your Grok tab) writes the shot.
  if (pic1 && !pic2 && !pic1Own && o.c && !remixing && !o.anime) {
    const c = o.c;
    const shape = useSettings.getState().s.create.shape;
    // several takes: the writer gives each its own pose, angle and expression (the same prompt ×4 made near-copies)
    const takeNote = (i: number) => o.count > 1 ? `\n(Take ${i + 1} of ${o.count}: keep the person, outfit and idea, but give this take its own pose, camera angle and expression, different from the other takes.)` : "";
    const shots = o.asTyped || !words ? Array(o.count).fill(words || "A natural candid photo of them.") as string[]
      : await Promise.all(Array.from({ length: o.count }, (_, i) => polishKrea(words + takeNote(i), c, shape)));
    for (let i = 0; i < o.count; i++) {
      const shot = shots[i];
      const { ref, view, instruction, loras, canvas } = await characterShot(c, `${words} ${shot}`, shot, shape, o.loras ?? [], o.balance !== false ? lib : null);
      useMakeRefs.setState({ lastSent: { instruction, changes: shot, balanced: [], loras: loras.filter((l) => !l.off).map((l) => `${l.name.split("/").pop()!.replace(/\.safetensors$/, "")} ${l.strength.toFixed(2)}`),
        pictures: [`${c.name} — ${VIEW_LABEL[view] ?? view}`] } });
      const graph = buildEdit({ ...editArgs(e, "krea"), loras, enhance: false, seed: newSeed(), images: [ref.name], blank: canvas, instruction, negative: "", resolution: 1024, refBoost: 4, prefix: "studio/create/refs" });
      await run("create", label(i), graph, `edit:krea:1:raw`, { stack, ...(o.snapshot ? { snapshot: o.snapshot } : {}), ...(o.faceFix ? { faceFix: o.faceFix } : {}), sent: sentOf(instruction, loras, c, words) });
    }
    return;
  }
  // Krea 2 Edit (realistic, or an anime character copied from their own picture)
  const keepStyle = o.anime ? " Keep the drawing style: anime art with the same line art and colouring as the pictures, not a photo." : "";
  const takeName = remixing ? "remix" : !(pic1 && pic2) ? "remix" : take === "look" ? "insert" : take;
  // only what you want different — never a whole copied prompt (that described someone else and fought your character)
  const changes = o.asTyped ? typedChanges(words, remixing ? remixBase ?? "" : "") : await changesOf(words, takeName, remixing ? remixBase ?? "" : "");
  const chg = changes ? ` Changes: ${changes.replace(/\.?$/, ".")}` : "";
  let images: string[], instruction: string, refBoost: number | undefined;
  // their front and back as one picture (one person, two sides), so the edit sees all of them
  const board = pic1 ? await characterBoard(o.c, pic1Own).catch(() => null) : null;
  // just their front picture: on a plain background (cached), so its room or street can't bleed into the new picture
  const front = pic1 && pic2 && !board && o.c && !pic1Own ? await (await import("./editchat")).plainOf(o.c, pic1).catch(() => pic1) : pic1;
  const who = board ? `the ${noun} from the second picture (one single ${noun}, ${boardSides} — not several people)` : `the ${noun} from the second picture`;
  // your words name clothes → those win; otherwise their own outfit (or picture 2's, if you chose that)
  const newClothes = /\b(outfit|wearing|wears|dressed|dress|clothes|shirt|t-shirt|top|jacket|coat|hoodie|sweater|skirt|pants|jeans|shorts|bikini|swimsuit|lingerie|bra|uniform|suit|gown|naked|nude|topless)\b/i.test(changes);
  const ident = `exactly their face, hair, eye colour, skin tone and body proportions${o.outfit === "picture" || newClothes ? "" : ", and their outfit"}`;
  const outfitLine = o.outfit === "picture" && !newClothes ? " They wear the clothes of the person in this picture." : "";
  const castLine = ` ${castEditLine(gender, cast)}`;
  if (pic1 && pic2) {
    refBoost = hold;
    if (take === "face" && o.c && !pic1Own) {
      images = [pic2.name, board ?? front!.name];
      instruction = `Change only the face and hair of the ${noun} in this picture so they become ${who}: exactly their face, eye colour, hairstyle and hair colour. Keep everything else in this picture exactly as it is — body, skin, outfit, pose, hands, expression, camera, lighting, colours and background.${chg}${keepStyle}${castLine}`;
    } else if (take === "pose") {
      images = [pic2.name, board ?? front!.name];
      const where = /\b(background|setting|place|location|room|outside|outdoors|indoors|beach|street|bedroom|city|forest|studio|park|night|kitchen|office)\b/i.test(changes) ? "" : " Use the background and setting of this picture.";
      instruction = `Show ${who} in exactly the pose of the person in this picture: the same body position, arms, hands, legs, head tilt and camera framing. They keep ${ident}.${where}${chg}${keepStyle}${castLine}`;
    } else if (take === "scene") {
      images = [pic2.name, board ?? front!.name];
      instruction = `Place ${who} into the scene of this picture, once. They keep ${ident}. Match this picture's background, lighting and colours.${chg}${keepStyle}${castLine}`;
    } else {
      // Insert my character: the person in the picture is replaced; everything about the picture stays
      images = [pic2.name, board ?? front!.name];
      const keep = keepOnly(changes, ["pose", "body position", "hand placement", "facial angle", "camera angle", "framing", "composition", "background", "lighting", "colours"]);
      instruction = `Replace the ${noun} in this picture with ${who}.${keep.length ? ` Keep this picture's exact ${list(keep)}.` : ""} The new ${noun} has ${ident}.${outfitLine}${chg}${keepStyle}${castLine}`;
    }
  } else {
    const only = (pic1 ?? pic2)!;
    images = board && only === pic1 ? [only.name, board] : [only.name];
    const same = images.length > 1 ? ` Keep this ${noun}'s face, hair and body exactly the same as in both pictures (the second shows the same ${noun} ${boardSides}).` : "";
    instruction = changes ? `${changes.replace(/\.?$/, ".")} Keep everything else in this picture the same.${same}${keepStyle}${castLine}` : `Make a natural new version of this same picture.${same}${keepStyle}${castLine}`;
  }
  // picture 1 of the edit is the canvas: the edit model keeps its layout and pose unless told it may let go
  // Insert my character (realistic): SAM 3 outlines the person in picture 2 and only that area is redrawn, so Krea 2 Edit
  // can't paint your character in NEXT TO the person who was there (two people instead of a swap)
  let mask: { mask: string; maskSoftness: number } | undefined;
  if (pic1 && pic2 && !remixing && take === "look" && !o.anime && !/\b(background|setting|place|room|outfit|wearing|clothes)\b/i.test(changes)) {
    const { useDownloads } = await import("./downloads");
    const sam = useDownloads.getState().groups.find((g) => g.id === "sam");
    if (!sam || sam.state === "done") {
      const { selectByWords } = await import("./faceDetail");
      const sel = await selectByWords(pic2.name, noun, 12, true).catch(() => null);
      if (sel && (sel.box.width * sel.box.height) / (sel.box.W * sel.box.H) < 0.92) mask = { mask: sel.mask.name, maskSoftness: 12 };
    }
  }
  const grip = followFor(changes, take, follow);
  const sceneBoost: number | undefined = images.length > 1 && grip < 1 ? grip : undefined;
  // one picture only, and it's the reference (not your character): it is the only "last" ref, so loosen that dial
  if (images.length === 1 && only1IsRef(pic1, pic2) && grip < 1 && o.strength == null) refBoost = grip;
  const adv = e[editKeys("krea").adv];
  // LoRAs on top of the identity-edit LoRA: Edit's, Create's and the character's — balanced, or they smear the picture
  let loras = mergeLoras(editArgs(e, "krea").loras, o.anime ? [] : mergeLoras(o.loras, charLoras(o.c, "krea2"))); // anime LoRAs can't load into Krea 2
  let balanced: string[] = [];
  if (o.balance !== false) { const r = balanceLoras(loras, lib, BUDGET.kreaEdit); loras = r.loras; balanced = r.changed; }
  // a remix of one picture: start from it and only change this much. The edit model also holds on to the picture by itself
  // (refBoost 4 = strongly), which made remixes copy the original whatever the slider said — so the hold loosens as
  // "How much may change" goes up, and more when your words change a pose, hands or expression
  const posey = grip < 1;
  if (remixing && o.strength != null) refBoost = Math.max(1, 4 - o.strength * 3 - (posey ? 0.8 : 0));
  const denoise = images.length === 1 && o.strength != null ? Math.min(1, o.strength + (remixing && posey ? 0.15 : 0)) : undefined;
  useMakeRefs.setState({ lastSent: { instruction, changes, balanced, loras: loras.filter((l) => !l.off).map((l) => `${l.name.split("/").pop()!.replace(/\.safetensors$/, "")} ${l.strength.toFixed(2)}`),
    pictures: images.length > 1 ? ["the picture being changed", board ? "your character (front + back)" : "your character"] : ["the picture"] } });
  for (let i = 0; i < o.count; i++) {
    const graph = buildEdit({ ...editArgs(e, "krea"), loras, ...(refBoost != null ? { refBoost } : {}), ...(sceneBoost != null ? { sceneBoost } : {}), ...(denoise != null ? { denoise } : {}), ...(mask ?? {}), enhance: false, seed: i === 0 && adv.lockSeed && adv.seed ? adv.seed : newSeed(), images, instruction, negative: "", resolution: 1024, prefix: "studio/create/refs" });
    await run("create", label(i), graph, `edit:krea:${images.length}:raw`, { before: (pic2 ?? pic1)!.url, stack, ...(o.snapshot ? { snapshot: o.snapshot } : {}), ...(o.faceFix ? { faceFix: o.faceFix } : {}), sent: sentOf(instruction, loras, o.c, words) });
  }
}

/** Remake with words: picture 2's prompt with your character written in (the writer swaps only the person's looks), then
 *  Create runs it as an exact prompt — text to image with their LoRA. Your own words in the box are added at the end. */
export async function remakeWithWords(pic: Media, c: Character | null, anime: boolean, theirOutfit: boolean, extra = ""): Promise<void> {
  if (!c) throw new Error("Pick a character on the left first — their look is what goes into the prompt");
  const { carryLikeness } = await import("./likeness");
  const r = await carryLikeness({ pic1: pic, pic2: null, character: c, anime, outfit: theirOutfit ? "scene" : "new person" });
  const add = extra.trim() && !r.prompt.includes(extra.trim()) ? ` ${extra.trim()}` : "";
  const st = useSettings.getState();
  st.set("create", { characterId: c.id, raw: true, make: "scene", extra: `${r.prompt}${add}` });
  useJobs.getState().toast(`Picture 2's prompt (${r.scene === "civitai" ? "from CivitAI" : r.scene === "file" ? "from the file" : "read off it"}) with ${c.name} in it is in the box — making pictures from it now.`, "good", "create");
  setTimeout(async () => { const { usePrimary } = await import("../App"); usePrimary.getState().fns.create?.(); }, 700);
}

/** with a place picture (3 pictures: your character, the reference, the place): Krea 2 Edit only takes two, so it runs as an
 *  Edit chat message — Qwen-Image-Edit takes all three, Krea 2 repaints with their LoRA, then the face pass and check. */
export async function makeWithPlace(c: Character | null, pic1: Media | null, pic2: Media | null, place: Media, take: Take, words: string, theirOutfit: boolean): Promise<void> {
  const { useDownloads } = await import("./downloads");
  const q = useDownloads.getState().groups.find((g) => g.id === "qwen");
  if (q && q.state !== "done") throw new Error(`Three pictures need the Edit chat helper (Qwen-Image-Edit) — it's ${q.state === "downloading" ? `downloading, ${q.pct}%` : q.state === "error" ? "failed to download (status menu → Retry)" : "in line"}. Until then use two pictures.`);
  const ec = await import("./editchat");
  await ec.useEditChat.getState().load();
  const chat = ec.useEditChat.getState().newChat();
  const me = c ? await ec.addCharacter(chat.id, c) : pic1 ? ec.addPic(chat.id, pic1, { label: "person" }) : null;
  const ref = pic2 ? ec.addPic(chat.id, pic2, { label: "reference", start: true }) : null;
  const pl = ec.addPic(chat.id, place, { label: "place", start: !ref });
  ec.useEditChat.getState().patch(chat.id, (x) => ({ ...x, title: `${c?.name ?? "Picture"} · with a place` }));
  const who = me ? `@${me.key}` : "the person";
  const noun = c?.gender === "male" ? "man" : "woman";
  const own = theirOutfit ? `, wearing the clothes from @${ref?.key ?? pl.key}` : me ? `, in ${noun === "man" ? "his" : "her"} own outfit from @${me.key}` : "";
  const msg = ref
    ? take === "pose" ? `${who} in exactly the pose and framing of the ${noun} in @${ref.key}${own}, placed in the setting of @${pl.key} with its light.`
      : take === "scene" ? `${who} placed into @${pl.key}${own}, lit like @${ref.key}.`
      : `${who} replaces the ${noun} in @${ref.key}${own}, keeping that pose, hands and framing, with the background and light of @${pl.key} instead of the original one. Only one person.`
    : `${who} in @${pl.key}${own}: the same place, background and light. Only one person.`;
  const text = words.trim() ? `${msg} ${words.trim()}` : msg;
  useSettings.getState().set("edit", { chat: true });
  useSettings.getState().setTab("edit");
  useJobs.getState().toast("Three pictures go to Edit chat (Qwen takes all three) — follow it there.", "info", "edit");
  ec.send(text).catch(() => {});
}

/** what was sent, for full screen → How it was made */
function sentOf(instruction: string, loras: LoraPick[], c: Character | null, words?: string, model = "Krea 2 Edit") {
  return { prompt: instruction, words, negative: "", model, checkpoint: "official", loras: loras.filter((l) => !l.off).map((l) => ({ name: l.name, strength: l.strength })), character: c?.name };
}

/** Picture → prompt: the local writer looks at a picture and writes the prompt for its pose, place, outfit (or all of it),
 *  in the model's language — without anyone's looks, so your character can be put into it */
export async function readPicture(pic: Media, focus: "all" | "pose" | "scene" | "outfit" | "look", anime: boolean, people: string, detail: "short" | "full" = "full", tab: Tab = "create"): Promise<string> {
  // the big writer sees more detail when it's in; the small one stands in while it downloads
  const out = await runWriter("read", { model: anime ? "anime" : "krea2", focus, people, detail }, { tab, label: "Reading the picture", images: [pic.name], big: detail === "full" });
  return out.trim();
}
