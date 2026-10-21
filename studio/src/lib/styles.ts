// Style picker: named looks with example pictures. The examples are made once on your GPU
// (one small picture per style) and kept with your settings, so every new rental has them.
import { create } from "zustand";
import { keepFile, loadState, saveState, type FileRef } from "./api";
import { useJobs } from "./jobs";

export interface Style { id: string; name: string; add: string }
export const STYLES: Record<"anime" | "realistic", Style[]> = {
  anime: [
    { id: "default", name: "NoobAI default", add: "" },
    { id: "cel", name: "Clean cel shading", add: "cel shading, flat color, clean lineart" },
    { id: "painterly", name: "Painterly", add: "painterly, oil painting (medium), soft lighting" },
    { id: "watercolor", name: "Watercolor", add: "watercolor (medium), traditional media, soft colors" },
    { id: "retro", name: "90s anime", add: "1990s (style), retro artstyle, film grain" },
    { id: "semireal", name: "Semi-realistic", add: "semi-realistic, detailed skin, cinematic lighting" },
    { id: "ink", name: "Ink sketch", add: "sketch, monochrome, ink (medium), hatching" },
    { id: "neon", name: "Neon cyber", add: "neon lights, cyberpunk, glowing, dark background, rim lighting" },
    { id: "pastel", name: "Soft pastel", add: "pastel colors, soft lighting, bloom, dreamy" },
    { id: "comic", name: "Western comic", add: "comic style, bold lineart, halftone, dramatic shadows" },
    { id: "3d", name: "3D render", add: "3d, blender (medium), subsurface scattering, soft shadows" },
    { id: "ukiyo", name: "Woodblock print", add: "ukiyo-e, woodblock print, traditional media" },
  ],
  realistic: [
    { id: "default", name: "Natural photo", add: "" },
    { id: "cinematic", name: "Cinematic film", add: "Cinematic film still, anamorphic lens, shallow depth of field, film grain." },
    { id: "studio", name: "Studio portrait", add: "Studio portrait photography, softbox lighting, seamless backdrop." },
    { id: "golden", name: "Golden hour", add: "Golden hour sunlight, warm tones, gentle lens flare." },
    { id: "noir", name: "Black & white", add: "Black and white photograph, high contrast, film noir lighting." },
    { id: "neon", name: "Neon night", add: "Neon-lit night street, wet reflections, teal and magenta light." },
    { id: "fashion", name: "Fashion editorial", add: "High-fashion editorial photoshoot, bold styling, magazine look." },
    { id: "vintage", name: "Vintage film", add: "1990s point-and-shoot film photo, direct flash, slight grain." },
    { id: "fantasy", name: "Fantasy concept", add: "Fantasy concept art, epic lighting, matte painting." },
  ],
};
export const SAMPLE = {
  anime: "masterpiece, best quality, newest, 1girl, solo, adult, mature female, upper body, looking at viewer, smile, long hair, jacket, outdoors",
  realistic: "A photo of an adult woman with long hair and a jacket, upper body, looking at the camera, smiling, outdoors.",
};

type Previews = Partial<Record<string, FileRef>>; // key: "anime/cel"
export const useStylePreviews = create<{ map: Previews }>(() => ({ map: {} }));
loadState<Previews>("styles").then((m) => m && useStylePreviews.setState({ map: m }));

useJobs.subscribe((s, prev) => {
  for (const j of s.jobs) {
    if (j.status !== "done" || !j.meta?.styleKey || prev.jobs.find((x) => x.id === j.id)?.status === "done") continue;
    const out = j.outputs.find((o) => o.kind === "image" && o.type === "output");
    if (!out) continue;
    const key = j.meta.styleKey as string;
    keepFile(out, `styles/${key}.png`).then((f) => {
      const map = { ...useStylePreviews.getState().map, [key]: { ...f, v: Date.now() } };
      useStylePreviews.setState({ map });
      saveState("styles", map).catch(() => {});
    }).catch(() => {});
  }
});
