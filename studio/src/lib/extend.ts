// "Extend to wallpaper": a picture becomes 16:9 or 21:9 with more of its own scene on the sides (or above and below), by
// Qwen-Image-2.1 + the Outpaint LoRA, in steps for big extensions; the picture itself is pasted back untouched (buildExtend).
import type { Media } from "./tray";
import type { ExtendStage } from "./graphs";

export const RATIOS = { "16:9": 16 / 9, "21:9": 21 / 9, "1:1": 1 } as const;
export type Ratio = keyof typeof RATIOS;
const TRIGGER = "Outpaint the image: replace the solid gray areas with a seamless continuation of the scene, keeping the existing picture unchanged.";
const r32 = (v: number) => Math.max(32, Math.round(v / 32) * 32);
const c32 = (v: number) => Math.max(32, Math.ceil(v / 32) * 32);

/** working sizes: the last canvas about 2 MP (the LoRA's 1–2 MP), each stage widening by at most ~1.6× */
export function planExtend(w: number, h: number, R: number): { work: { w: number; h: number }; stages: ExtendStage[] } | null {
  const r0 = w / h;
  if (Math.abs(r0 - R) < 0.01) return null;
  const wider = r0 < R;
  const fixed = wider ? r32(Math.sqrt((2 * 1048576) / R)) : r32(Math.sqrt(2 * 1048576 * R)); // height when widening, else width
  const work = wider ? { w: Math.round(w * (fixed / h)), h: fixed } : { w: fixed, h: Math.round(h * (fixed / w)) };
  const span = wider ? R / r0 : r0 / R;
  const n = Math.max(1, Math.ceil(Math.log(span) / Math.log(1.6)));
  const stages: ExtendStage[] = [];
  let last = wider ? work.w : work.h;
  for (let k = 1; k <= n; k++) {
    const want = k === n ? (wider ? r32(fixed * R) : r32(fixed / R)) : c32((wider ? work.w : work.h) * Math.pow(span, k / n));
    const v = Math.max(want, c32(last + 64));
    stages.push(wider ? { w: v, h: fixed } : { w: fixed, h: v });
    last = v;
  }
  return { work, stages };
}

export async function extendPicture(pic: Media, ratio: Ratio, anime = false): Promise<string> {
  const [{ buildExtend }, { useJobs }, { newSeed }, { useDownloads, setLater }] = await Promise.all([import("./graphs"), import("./jobs"), import("./settings"), import("./downloads")]);
  const gr = useDownloads.getState().groups.find((x) => x.id === "extend");
  if (gr && gr.state !== "done") {
    if (gr.state === "later") await setLater("extend", false);
    throw new Error(`The Extend models (Qwen Image 2.1, ~17 GB) are downloading${gr.state === "downloading" ? ` (${gr.pct}%)` : " now"} — try again when they're in (status menu shows progress)`);
  }
  const size = pic.width && pic.height ? { w: pic.width, h: pic.height } : await new Promise<{ w: number; h: number }>((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => rej(new Error("Couldn't open the picture")); i.src = pic.url; });
  const plan = planExtend(size.w, size.h, RATIOS[ratio]);
  if (!plan) return `It's already ${ratio}`;
  // the place, in words, for the new parts (the LoRA's optional "Scene:" line) — the writer reads the picture
  const { readPicture } = await import("./make");
  const place = await readPicture(pic, "scene", anime, "one person", "short", "edit").catch(() => "");
  const prompt = place ? `${TRIGGER} Scene: ${place.replace(/\s+/g, " ").trim().slice(0, 900)}` : TRIGGER;
  const g = buildExtend({ image: pic.name, full: size, work: plan.work, stages: plan.stages, prompt, seed: newSeed(), prefix: "studio/edit/extend" });
  const last = plan.stages[plan.stages.length - 1];
  const W = Math.round(last.w * (size.h / plan.work.h)), H = Math.round(last.h * (size.h / plan.work.h));
  await useJobs.getState().run("edit", `Extend to ${ratio} → ${W}×${H}${plan.stages.length > 1 ? ` · ${plan.stages.length} steps` : ""}`, g, `edit:extend:${plan.stages.length}`, { before: pic.url });
  return `Extending to ${ratio} (${W}×${H})${plan.stages.length > 1 ? ` in ${plan.stages.length} steps` : ""} — the picture itself stays exactly as it is. It appears in Edit in a minute or two.`;
}
