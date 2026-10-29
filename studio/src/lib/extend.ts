// "Extend to wallpaper": a portrait picture becomes 16:9 (or 21:9) with more of its scene on the sides; the picture itself
// is pasted back untouched (see buildExtend).
import type { Media } from "./tray";

export const RATIOS = { "16:9": 16 / 9, "21:9": 21 / 9, "1:1": 1 } as const;
export type Ratio = keyof typeof RATIOS;

export async function extendPicture(pic: Media, ratio: Ratio, anime = false): Promise<string> {
  const [{ buildExtend }, { useJobs }, { newSeed, useSettings }, { promptOfPicture }] = await Promise.all([import("./graphs"), import("./jobs"), import("./settings"), import("./likeness")]);
  const { useDownloads } = await import("./downloads");
  const gr = useDownloads.getState().groups.find((x) => x.id === (anime ? "anime" : "image"));
  if (gr && gr.state !== "done") throw new Error(`The ${anime ? "anime" : "Krea 2"} picture models are still downloading — try again in a few minutes`);
  const size = pic.width && pic.height ? { w: pic.width, h: pic.height } : await new Promise<{ w: number; h: number }>((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => rej(new Error("Couldn't open the picture")); i.src = pic.url; });
  const R = RATIOS[ratio];
  const wider = size.w / size.h < R - 0.01, taller = size.w / size.h > R + 0.01;
  if (!wider && !taller) return `It's already ${ratio}`;
  // the model works at about 2 MP in sizes that are multiples of 16; the canvas takes exactly that shape (a hair off the
  // named ratio at most) so scaling back up lines the new parts up with the original to the pixel
  const sH = Math.max(512, Math.round(Math.sqrt((2 * 1048576) / R) / 16) * 16), sW = Math.round((sH * R) / 16) * 16;
  let W = size.w, H = size.h;
  if (wider) W = Math.round((size.h * sW) / sH); else H = Math.round((size.w * sH) / sW);
  const left = Math.floor((W - size.w) / 2), top = Math.floor((H - size.h) / 2);
  const where = W > size.w ? "left and right" : "top and bottom";
  // what the new strips should show: the writer looks at the picture and describes the place (not the person), so they
  // continue the same surroundings; the picture's own prompt or a plain line stands in if the writer isn't there yet
  const { readPicture } = await import("./make");
  let place = await readPicture(pic, "scene", anime, "one person", "short", "edit").catch(() => "");
  if (!place) { const own = await promptOfPicture(pic).catch(() => null); place = own?.prompt?.replace(/<lora:[^>]+>/gi, " ").replace(/\s{2,}/g, " ").trim().slice(0, 900) ?? ""; }
  const wide = `A wide view of the same place: the ${where} show more of these surroundings, continuing the walls, floor, objects, light and perspective. Only the one person already there; no other people.`;
  const prompt = anime ? `masterpiece, best quality, ${place ? `${place}, ` : ""}wide shot, scenery, detailed background` : `${place ? `${place} ` : "A photo. "}${wide}`;
  const cs = useSettings.getState().s.create;
  const a = anime ? cs.advAnima : cs.advKrea;
  const g = buildExtend({ image: pic.name, w: size.w, h: size.h, left, right: W - size.w - left, top, bottom: H - size.h - top, sceneW: sW, sceneH: sH, engine: anime ? "anima" : "krea",
    prompt, negative: anime ? "worst quality, low quality, extra people, crowd" : cs.negative, seed: newSeed(), steps: anime ? a.steps : Math.max(10, a.steps), cfg: a.cfg,
    sampler: a.sampler, scheduler: a.scheduler, prefix: "studio/edit/extend" });
  await useJobs.getState().run("edit", `Extend to ${ratio} → ${W}×${H}`, g, "edit:extend", { before: pic.url });
  return `Extending to ${ratio} (${W}×${H}) — the picture itself stays exactly as it is. It appears in Edit in a minute or two.`;
}
