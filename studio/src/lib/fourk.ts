// "4K": every picture Create and Edit make is enlarged ×2 at the end of its own job by NVIDIA RTX Video Super Resolution
// (a second or two, sharpens what's there, no redraw) — 1088×1920 becomes 2176×3840. The models themselves draw best at
// about 2 MP; past that they repeat and warp, so 4K comes from upscaling, not from a bigger canvas.
import { create } from "zustand";
import type { ApiGraph } from "./graphs";

const KEY = "h3.4k";
export const useFourK = create<{ on: boolean }>(() => ({ on: (() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })() }));
export function setFourK(on: boolean) { useFourK.setState({ on }); try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode */ } }

/** the job's result picture(s) go through the RTX upscaler before saving (cut-outs and helper files untouched) */
export function withFourK(graph: ApiGraph, tab: string): ApiGraph {
  if (!useFourK.getState().on || (tab !== "create" && tab !== "edit")) return graph;
  if (Object.values(graph).some((n) => n.class_type === "RTXVideoSuperResolution")) return graph;
  for (const [id, n] of Object.entries(graph)) {
    if (n.class_type !== "SaveImage" || n._meta?.title !== "result") continue;
    const up = `${id}_4k`;
    graph[up] = { class_type: "RTXVideoSuperResolution", inputs: { images: n.inputs.images, resize_type: "scale by multiplier", "resize_type.scale": 2, quality: "HIGHBITRATE_ULTRA", strength: 1, image_encoding: "8-bit RGB" } };
    n.inputs = { ...n.inputs, images: [up, 0] };
  }
  return graph;
}
