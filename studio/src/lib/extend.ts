// "Extend to wallpaper": a portrait picture becomes 16:9 (or 21:9) with more of its scene on the sides; the picture itself
// is pasted back untouched (see buildExtend).
import type { Media } from "./tray";

export const RATIOS = { "16:9": 16 / 9, "21:9": 21 / 9, "1:1": 1 } as const;
export type Ratio = keyof typeof RATIOS;

export async function extendPicture(pic: Media, ratio: Ratio): Promise<string> {
  const [{ buildExtend }, { useJobs }, { newSeed, useSettings }, { promptOfPicture }] = await Promise.all([import("./graphs"), import("./jobs"), import("./settings"), import("./likeness")]);
  const { useDownloads } = await import("./downloads");
  const gr = useDownloads.getState().groups.find((x) => x.id === "kedit");
  if (gr && gr.state !== "done") throw new Error("The Edit (Krea 2) models are still downloading — try again in a few minutes");
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
  const where = W > size.w ? "on the left and right" : "above and below";
  const own = await promptOfPicture(pic).catch(() => null);
  const scene = own?.prompt ? own.prompt.replace(/<lora:[^>]+>/gi, " ").replace(/\s{2,}/g, " ").trim().slice(0, 1200) : "";
  const prompt = `Extend this picture outward: fill the blurred areas ${where} with more of the same scene, continuing the room or place, the lighting, the perspective and the style seamlessly. Keep the person and everything already in the picture exactly as it is; add no new people.${scene ? ` The scene: ${scene}` : ""}`;
  const a = useSettings.getState().s.edit.advKrea;
  const g = buildExtend({ image: pic.name, w: size.w, h: size.h, left, right: W - size.w - left, top, bottom: H - size.h - top, sceneW: sW, sceneH: sH, prompt,
    seed: newSeed(), steps: Math.max(10, a.steps), cfg: a.cfg, sampler: a.sampler, scheduler: a.scheduler, prefix: "studio/edit/extend" });
  await useJobs.getState().run("edit", `Extend to ${ratio} → ${W}×${H}`, g, "edit:extend", { before: pic.url });
  return `Extending to ${ratio} (${W}×${H}) — the picture itself stays exactly as it is. It appears in Edit in a minute or two.`;
}
