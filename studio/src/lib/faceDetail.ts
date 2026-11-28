// Face-detail pass: SAM 3 finds the face by the word "face", Krea 2 Edit redraws just that crop at full size (sharper skin,
// eyes, lashes, lips) looking at the character's own picture so the face stays theirs, and it's pasted back with soft edges.
// Works on any picture: your results, CivitAI pictures, a character's front picture.
import { inputUrl, toInput, type FileRef, type InputFile } from "./api";
import { addToSiteSet, faceView, useCharacters, type Character } from "./characters";
import { buildEdit, buildFind, buildFindMask } from "./graphs";
import { useJobs, waitForJob, type Tab } from "./jobs";
import { M } from "./models";
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
  /** Optional explicit staged Gen-0 hero input filename (takes precedence over character lookup & works for quick photos) */
  refImage?: string;
  /** Force clean Krea 2 Turbo (0 extra LoRAs, 6 steps, refBoost 2.9 -> 1.45 on V2 Identity) for V4 Gen-0 face locking */
  kreaFaceLock?: boolean;
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
  // explicit Gen-0 reference first, else character's face/front view
  const view = !o.refImage && c ? faceView(c) : null;
  const ident = o.refImage ? { name: o.refImage } : (c && view ? await useCharacters.getState().asMedia(c.id, view).catch(() => null) : null);
  const anime = c ? c.style === "anime" : false;
  const e = useSettings.getState().s.edit;
  const base = editArgs(e, "krea");
  const style = anime ? "Keep exactly the same art style, line art and colours — it is a drawing, not a photo." : "Keep it a candid real photo with natural unretouched skin tone, soft lighting, and natural ambient shadows on the eyes (never glowing or artificially bright irises).";
  const instruction = `This is a close-up crop of one person's face. Redraw the face sharper and more detailed: crisp natural eyes and lashes, clear sculpted lips, natural skin texture and fine hair strands. `
    + (ident ? "The second picture shows who this exact person is — take only who they are from it: the exact same attractive face shape, natural eye colour in ambient light, eyebrows, eyeliner, nose, lip shape, freckles and skin. Do NOT copy its expression, mouth, gaze or head angle. " : "")
    + `Keep this crop's own expression exactly (an open mouth stays open, a laugh stays a laugh, closed eyes stay closed), its head angle, gaze, hair, room lighting and framing; change nothing else. ${style}`;
  const editParams = o.kreaFaceLock
    ? { ...base, unet: M.kreaUnet, loras: [], sampler: "euler", scheduler: "simple", steps: 6, cfg: 1 }
    : { ...base, loras: [...(base.loras ?? [])] };
  let cur = name, last: FileRef | null = null;
  for (let i = 0; i < pick.length; i++) {
    const win = faceWindow(pick[i], W, H);
    const g = buildEdit({ ...editParams, enhance: false, seed: newSeed(), images: ident ? [cur, ident.name] : [cur], instruction, negative: "", resolution: 1024,
      denoise: o.strength ?? FACE_DEFAULT, refBoost: ident ? (o.kreaFaceLock ? 2.9 : 2.5) : 1, region: win, prefix: o.prefix ?? `studio/${tab}/face` });
    const job = await useJobs.getState().run(tab, `${o.label ?? "Sharpening the face"}${pick.length > 1 ? ` ${i + 1}/${pick.length}` : ""}`, g, "face:edit", { kind: "face:edit", faceOf: name, ...o.meta });
    const done = await waitForJob(job.id);
    const out = done.outputs.find((x) => x.kind === "image" && x.type === "output");
    if (done.status !== "done" || !out) throw new Error(done.error ?? "The face pass didn't finish");
    last = out;
    if (i < pick.length - 1) cur = (await toInput(out)).name;
  }
  return last;
}

/** Create's / V9 Master Pack's "Sharpen the face after": only when a job transitions live from queued/running -> done (never on reload/restore!) */
const faceRan = new Set<string>();
useJobs.subscribe((s, prev) => {
  for (const j of s.jobs) {
    const fix = j.meta?.faceFix as { character: string | null; strength: number; refImage?: string; prefix?: string; kreaFaceLock?: boolean; label?: string } | undefined;
    const before = prev.jobs.find((x) => x.id === j.id);
    if (!fix || j.status !== "done" || !before || (before.status !== "running" && before.status !== "queued") || faceRan.has(j.id)) continue;
    faceRan.add(j.id);
    const c = fix.character ? useCharacters.getState().list.find((x) => x.id === fix.character) ?? null : null;
    const outs = j.outputs.filter((x) => x.kind === "image" && x.type === "output");
    (async () => {
      for (const out of outs) {
        try {
          const sharp = await sharpenFace(out, {
            tab: j.tab,
            character: c,
            refImage: fix.refImage,
            kreaFaceLock: fix.kreaFaceLock,
            strength: fix.strength,
            label: fix.label ?? (fix.kreaFaceLock ? "V4 Gen-0 face lock" : "Sharpening the face"),
            prefix: fix.prefix ?? `studio/${j.tab}/face`,
            meta: { quietFail: !!fix.kreaFaceLock, ...(j.meta?.project ? { project: j.meta.project } : {}) },
          });
          const to = j.meta?.toSet as { charId: string; title: string; tier: "free" | "premium"; setKey?: string; rating?: "sfw" | "suggestive" | "explicit" } | undefined;
          if (to) addToSiteSet(to.charId, to.title, to.tier, sharp ?? out, { setKey: to.setKey, rating: to.rating });
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
    const to = j.meta?.toSet as { charId: string; title: string; tier: "free" | "premium"; setKey?: string; rating?: "sfw" | "suggestive" | "explicit" } | undefined;
    if (!to || j.meta?.faceFix || j.status !== "done" || prev.jobs.find((x) => x.id === j.id)?.status === "done") continue;
    for (const out of j.outputs.filter((x) => x.kind === "image" && x.type === "output")) addToSiteSet(to.charId, to.title, to.tier, out, { setKey: to.setKey, rating: to.rating });
  }
});

/** "the woman on the left", "person", "man" — a whole person (not "her hand", "the woman's dress") */
export function wholePerson(words: string): boolean {
  const w = words.toLowerCase();
  return /\b(person|people|woman|man|girl|guy|boy|lady|character|figure)\b/.test(w)
    && !/\b(hand|hands|arm|arms|leg|legs|foot|feet|face|head|hair|eye|eyes|mouth|lips|tongue|teeth|neck|chest|breast|breasts|waist|hip|hips|back|shoulder|finger|fingers|shirt|top|dress|skirt|pants|jeans|shorts|jacket|coat|sweater|shoes|boots|hat|clothes|clothing|outfit|bra|bikini|underwear|necklace|bag)\b/.test(w);
}

/** Edit → "Pick a person": every person SAM 3 finds in the picture, biggest (usually nearest) first */
export async function findPeople(name: string): Promise<{ boxes: Box[]; W: number; H: number }> {
  const [{ w, h }, job] = await Promise.all([
    size(inputUrl(name)),
    useJobs.getState().run("edit", "Finding the people (SAM 3)", buildFind(name, "person", 0.35), "face:find", { kind: "sam:people", quiet: true, front: true, noTray: true }),
  ]);
  const done = await waitForJob(job.id);
  if (done.status !== "done") throw new Error(done.error ?? "Couldn't look for people");
  const boxes = parseBoxes(done.texts.boxes ?? "").filter((b) => b.score >= 0.3).sort((a, b) => b.width * b.height - a.width * a.height);
  return { boxes, W: w, H: h };
}

/** one of those people as a mask (their exact outline, nobody else's) with the box around them */
export async function selectPerson(name: string, b: Box, W: number, H: number) {
  const box = { x: b.x, y: b.y, width: b.width, height: b.height, W, H };
  const job = await useJobs.getState().run("edit", "Outlining the person (SAM 3)", buildFindMask(name, "person", 16, 0.35, true, box), "face:find",
    { kind: "sam:select", quiet: true, front: true, noTray: true });
  const done = await waitForJob(job.id);
  const out = done.outputs.find((x) => x.kind === "image");
  if (done.status !== "done" || !out) throw new Error(done.error ?? "Couldn't outline that person");
  const f = await toInput(out);
  const pad = 16;
  const x0 = Math.max(0, b.x - pad), y0 = Math.max(0, b.y - pad), x1 = Math.min(W, b.x + b.width + pad), y1 = Math.min(H, b.y + b.height + pad);
  return { mask: { ...f, url: inputUrl(f.name) }, box: { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0), W, H } };
}

/** Swap the person → "Start from a BFS still": the video's first frame with her head put on the person being replaced (BFS on
 *  Krea 2, only inside that person's outline). It goes in as the swap's first reference picture: her, already in that scene,
 *  pose and light — so H3 doesn't have to work out what she looks like there. Resolves with the still's input file name. */
export async function bfsFirstFrame(video: string, herPic: string, pick: "largest" | "leftmost" | "rightmost" = "largest"): Promise<string> {
  const { TEMPLATES, editArgs } = await import("./settings");
  // frame 1 of the clip, as a picture
  const frameGraph = { "1": { class_type: "VHS_LoadVideo", inputs: { video, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 1, skip_first_frames: 0, select_every_nth: 1, format: "None" } },
    "2": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "studio/_work/frame1" }, _meta: { title: "result" } } };
  const fj = await useJobs.getState().run("animate", "Swap · taking the first frame", frameGraph as never, "frame:first", { quiet: true, front: true, noTray: true });
  const fd = await waitForJob(fj.id);
  const fo = fd.outputs.find((x) => x.kind === "image");
  if (fd.status !== "done" || !fo) throw new Error(fd.error ?? "Couldn't take the video's first frame");
  const frame = (await toInput(fo)).name;
  const { boxes, W, H } = await findPeople(frame);
  if (!boxes.length) throw new Error("SAM 3 found nobody in the first frame");
  const b = pick === "leftmost" ? [...boxes].sort((p, q) => p.x - q.x)[0] : pick === "rightmost" ? [...boxes].sort((p, q) => q.x + q.width - (p.x + p.width))[0] : boxes[0];
  const { mask } = await selectPerson(frame, b, W, H);
  const e = (await import("./settings")).useSettings.getState().s.edit;
  const g = buildEdit({ ...editArgs(e, "krea"), loras: [], seed: newSeed(), images: [frame, herPic], instruction: TEMPLATES("krea").head, negative: "", resolution: 1024,
    swap: "head", mask: mask.name, maskSoftness: 12, prefix: "studio/animate/bfs_first" });
  const j = await useJobs.getState().run("animate", "Swap · her head on frame 1 (BFS)", g, "edit:krea:2:raw", { front: true });
  const d = await waitForJob(j.id);
  const out = d.outputs.find((x) => x.kind === "image" && x.type === "output");
  if (d.status !== "done" || !out) throw new Error(d.error ?? "The BFS still didn't finish");
  return (await toInput(out)).name;
}
