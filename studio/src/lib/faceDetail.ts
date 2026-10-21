// Face-detail pass: SAM 3 finds the face by the word "face", Krea 2 Edit redraws just that crop at full size (sharper skin,
// eyes, lashes, lips) looking at the character's own picture so the face stays theirs, and it's pasted back with soft edges.
// Works on any picture: your results, CivitAI pictures, a character's front picture.
import { inputUrl, toInput, type FileRef, type InputFile } from "./api";
import { addToSiteSet, faceView, useCharacters, type Character } from "./characters";
import { buildEdit, buildFind, buildFindMask } from "./graphs";
import { useJobs, waitForJob, type Tab } from "./jobs";
import { editArgs, newSeed, useSettings } from "./settings";

import { faceWindow, parseBoxes, type Box } from "./faceBox";
export { faceWindow, parseBoxes, type Box };

const size = (url: string) => new Promise<{ w: number; h: number }>((res, rej) => {
  const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => rej(new Error("Couldn't open the picture")); i.src = url;
});

export interface FaceOpts {
  tab?: Tab;
  /** whose face it is: their own picture is shown to the model so the face stays theirs */
  character?: Character | null;
  /** 0.2–0.7: how much the face is redrawn */
  strength?: number;
  /** redo every face found (default: only the biggest one) */
  all?: boolean;
  label?: string;
  prefix?: string;
  /** extra meta on the redraw job (a recipe's quiet middle step, a stack…) */
  meta?: Record<string, unknown>;
}
export const FACE_DEFAULT = 0.45;

/** the faces SAM 3 finds in a picture (biggest first) */
export async function findFaces(name: string, tab: Tab = "edit", quietFail = false): Promise<{ boxes: Box[]; W: number; H: number }> {
  const [{ w, h }, job] = await Promise.all([
    size(inputUrl(name)),
    useJobs.getState().run(tab, "Finding the face (SAM 3)", buildFind(name, "face"), "face:find", { kind: "face:find", front: true, ...(quietFail ? { quietFail: true } : {}) }),
  ]);
  const done = await waitForJob(job.id);
  if (done.status !== "done") throw new Error(done.error ?? "Couldn't look for the face");
  const boxes = parseBoxes(done.texts.boxes ?? "").sort((a, b) => b.width * b.height - a.width * a.height);
  return { boxes, W: w, H: h };
}

/** sharpen the face(s) in this picture; resolves with the new picture's file (the last one when several faces are done) */
export async function sharpenFace(src: FileRef | { name: string }, o: FaceOpts = {}): Promise<FileRef | null> {
  const tab = o.tab ?? "edit";
  // run many at once (a recipe, picked pictures): no popup per picture
  const toast = o.meta?.quietFail ? () => {} : useJobs.getState().toast;
  const name = "name" in src ? src.name : (await toInput(src)).name;
  const { boxes, W, H } = await findFaces(name, tab, !!o.meta?.quietFail);
  if (!boxes.length) { toast("Couldn't find a face in that picture", "bad", tab); return null; }
  const pick = (o.all ? boxes : boxes.slice(0, 1)).filter((b) => b.score >= 0.3);
  toast(`SAM 3 found ${boxes.length} face${boxes.length > 1 ? "s" : ""} (best ${Math.round(boxes[0].score * 100)}% sure) — redrawing ${pick.length > 1 ? `${pick.length} of them` : "the biggest"}`, "info", tab);
  if (!pick.length) { toast("Couldn't find a face in that picture", "bad", tab); return null; }
  const c = o.character ?? null;
  // their face close-up shows the model the face best; the front picture when there's no close-up
  const view = c ? faceView(c) : null;
  const ident = c && view ? await useCharacters.getState().asMedia(c.id, view).catch(() => null) : null;
  const anime = c ? c.style === "anime" : false;
  const e = useSettings.getState().s.edit;
  const base = editArgs(e, "krea");
  const style = anime ? "Keep exactly the same art style, line art and colours — it is a drawing, not a photo." : "Keep it a photo with the same skin tone, lighting and colours.";
  const instruction = `This is a close-up crop of one person's face. Redraw the face sharper and more detailed: crisp eyes and lashes, clear lips, natural skin texture and fine hair strands. `
    + (ident ? "The second picture shows who this is — take only who they are from it: the same face shape, eye colour, eyebrows, nose, lip shape and skin. Do NOT copy its expression, mouth, gaze or head angle. " : "")
    + `Keep this crop's own expression exactly (an open mouth stays open, a laugh stays a laugh, closed eyes stay closed), its head angle, gaze, hair, lighting and framing; change nothing else. ${style}`;
  let cur = name, last: FileRef | null = null;
  for (let i = 0; i < pick.length; i++) {
    const win = faceWindow(pick[i], W, H);
    const g = buildEdit({ ...base, loras: [...(base.loras ?? [])], enhance: false, seed: newSeed(), images: ident ? [cur, ident.name] : [cur], instruction, negative: "", resolution: 1024,
      denoise: o.strength ?? FACE_DEFAULT, refBoost: ident ? 2.5 : 1, region: win, prefix: o.prefix ?? `studio/${tab}/face` });
    const job = await useJobs.getState().run(tab, `${o.label ?? "Sharpening the face"}${pick.length > 1 ? ` ${i + 1}/${pick.length}` : ""}`, g, "face:edit", { kind: "face:edit", faceOf: name, ...o.meta });
    const done = await waitForJob(job.id);
    const out = done.outputs.find((x) => x.kind === "image" && x.type === "output");
    if (done.status !== "done" || !out) throw new Error(done.error ?? "The face pass didn't finish");
    last = out;
    if (i < pick.length - 1) cur = (await toInput(out)).name;
  }
  return last;
}

/** Create's "Sharpen the face after": every picture a job with `faceFix` finishes goes through the face pass */
useJobs.subscribe((s, prev) => {
  for (const j of s.jobs) {
    const fix = j.meta?.faceFix as { character: string | null; strength: number } | undefined;
    if (!fix || j.status !== "done" || prev.jobs.find((x) => x.id === j.id)?.status === "done") continue;
    const c = fix.character ? useCharacters.getState().list.find((x) => x.id === fix.character) ?? null : null;
    const outs = j.outputs.filter((x) => x.kind === "image" && x.type === "output");
    (async () => {
      for (const out of outs) {
        try {
          const sharp = await sharpenFace(out, { tab: j.tab, character: c, strength: fix.strength, label: "Sharpening the face", prefix: `studio/${j.tab}/face` });
          const to = j.meta?.toSet as { charId: string; title: string; tier: "free" | "premium" } | undefined;
          if (to) addToSiteSet(to.charId, to.title, to.tier, sharp ?? out);
        }
        catch (e) { useJobs.getState().toast(`Face pass: ${(e as Error).message}`, "bad", j.tab); break; }
      }
    })();
  }
});

/** Edit → "Select by words": SAM 3 outlines what the words name ("her right hand", "the cup") in picture 1 and returns it
 *  as a mask the size of the picture, with the box around everything it found (for the cut-out-and-redraw edit) */
export async function selectByWords(name: string, words: string, grow = 16, quietFail = false): Promise<{ mask: InputFile & { url: string }; box: { x: number; y: number; width: number; height: number; W: number; H: number }; found: number; best: number } | null> {
  const [{ w, h }, job] = await Promise.all([
    size(inputUrl(name)),
    useJobs.getState().run("edit", `Finding “${words.slice(0, 40)}” (SAM 3)`, buildFindMask(name, words, grow, 0.35, wholePerson(words)), "face:find", { kind: "sam:select", quiet: true, front: true, noTray: true, ...(quietFail ? { quietFail: true } : {}) }),
  ]);
  const done = await waitForJob(job.id);
  const boxes = parseBoxes(done.texts.boxes ?? "");
  const out = done.outputs.find((x) => x.kind === "image");
  if (!boxes.length || !out) return null;
  const pad = grow;
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad), y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const x1 = Math.min(w, Math.max(...boxes.map((b) => b.x + b.width)) + pad), y1 = Math.min(h, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  const f = await toInput(out);
  return { mask: { ...f, url: inputUrl(f.name) }, box: { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0), W: w, H: h }, found: boxes.length, best: Math.max(...boxes.map((b) => b.score)) };
}

/** content plan pictures without the face pass: straight into their site set when they're done */
useJobs.subscribe((s, prev) => {
  for (const j of s.jobs) {
    const to = j.meta?.toSet as { charId: string; title: string; tier: "free" | "premium" } | undefined;
    if (!to || j.meta?.faceFix || j.status !== "done" || prev.jobs.find((x) => x.id === j.id)?.status === "done") continue;
    for (const out of j.outputs.filter((x) => x.kind === "image" && x.type === "output")) addToSiteSet(to.charId, to.title, to.tier, out);
  }
});

/** "the woman on the left", "person", "man" — a whole person (not "her hand", "the woman's dress") */
export function wholePerson(words: string): boolean {
  const w = words.toLowerCase();
  return /\b(person|people|woman|man|girl|guy|boy|lady|character|figure)\b/.test(w)
    && !/\b(hand|hands|arm|arms|leg|legs|foot|feet|face|head|hair|eye|eyes|mouth|lips|tongue|teeth|neck|chest|breast|breasts|waist|hip|hips|back|shoulder|finger|fingers|shirt|top|dress|skirt|pants|jeans|shorts|jacket|coat|sweater|shoes|boots|hat|clothes|clothing|outfit|bra|bikini|underwear|necklace|bag)\b/.test(w);
}
