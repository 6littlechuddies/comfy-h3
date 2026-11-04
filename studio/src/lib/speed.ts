// Speed-ups: on by default, each with its own switch (⋯ menu → Speed-ups), remembered with your settings. When a job fails
// with any on, its error says which — turning that one off is the first thing to try. The debug report lists them too.
import { create } from "zustand";
import { comboOptions, loadState, saveState } from "./api";

export interface Speed {
  /** Image → video, First → last and Loop with the FL2V 8-step turbo LoRA (References already had its own turbo) */
  videoTurbo: boolean;
  /** Extend with Qwen Image 2.1's official 8-step turbo LoRA (instead of 25 steps per stage) */
  extendTurbo: boolean;
  /** ComfyUI's own INT8 attention (comfy kitchen) for H3 videos and Krea 2 pictures/edits, where the card supports it */
  fastAttn: boolean;
  /** load Krea 2 into the card as soon as it's downloaded, so the first picture doesn't wait for it */
  warmup: boolean;
}
export const SPEED_DEFAULTS: Speed = { videoTurbo: true, extendTurbo: true, fastAttn: true, warmup: true };
export const SPEED_INFO: Record<keyof Speed, { title: string; sub: string }> = {
  videoTurbo: { title: "Faster video steps", sub: "Image → video, First → last and Loop in 8 steps (the H3 turbo LoRA) — about 2–3× faster, a little less fine detail" },
  extendTurbo: { title: "Faster Extend", sub: "Qwen Image 2.1's turbo LoRA: 8 steps per stage instead of 25 — about 3× faster" },
  fastAttn: { title: "Faster attention", sub: "ComfyUI's INT8 attention for H3 and Krea 2 (RTX cards with it) — about 1.3–2× for videos, less for pictures" },
  warmup: { title: "Warm up at start", sub: "Loads Krea 2 into the card when it's downloaded, so the first picture doesn't wait 30–60 s" },
};

export const useSpeed = create<Speed & { loaded: boolean; kitchen: boolean | null }>(() => ({ ...SPEED_DEFAULTS, loaded: false, kitchen: null }));
loadState<Partial<Speed>>("speed").then(async (s) => {
  useSpeed.setState({ ...SPEED_DEFAULTS, ...(s ?? {}), loaded: true });
  if (s) return;
  // the first time: the speed-ups become your defaults — Animate's speed goes to turbo once (pick "full" again any time)
  saveState("speed", SPEED_DEFAULTS).catch(() => {});
  const { useSettings } = await import("./settings");
  const wait = () => new Promise<void>((res) => { if (useSettings.getState().loaded) res(); else { const u = useSettings.subscribe((st) => { if (st.loaded) { u(); res(); } }); } });
  await wait();
  useSettings.getState().set("animate", { turbo: true });
});
// does this rental's ComfyUI have the INT8 attention backend (CUDA 13 + an NVIDIA card)?
comboOptions("ModelAttentionBackend", "attention").then((o) => useSpeed.setState({ kitchen: o.includes("comfy kitchen attention") })).catch(() => useSpeed.setState({ kitchen: false }));

export function setSpeed(p: Partial<Speed>) {
  useSpeed.setState(p);
  const { videoTurbo, extendTurbo, fastAttn, warmup } = useSpeed.getState();
  saveState("speed", { videoTurbo, extendTurbo, fastAttn, warmup }).catch(() => {});
}
export const speedOn = (k: keyof Speed) => useSpeed.getState()[k] !== false;
/** INT8 attention goes into a graph only when it's on and this ComfyUI has it */
export const fastAttnOn = () => speedOn("fastAttn") && useSpeed.getState().kitchen === true;

/** "video turbo, fast attention" — what a job ran with (shown with an error, and in the debug report) */
export function speedLine(kind: "video" | "picture" | "extend"): string {
  const on: string[] = [];
  if (kind === "video" && speedOn("videoTurbo")) on.push(SPEED_INFO.videoTurbo.title);
  if (kind === "extend" && speedOn("extendTurbo")) on.push(SPEED_INFO.extendTurbo.title);
  if ((kind === "video" || kind === "picture") && fastAttnOn()) on.push(SPEED_INFO.fastAttn.title);
  return on.join(", ");
}
