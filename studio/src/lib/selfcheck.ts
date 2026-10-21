// "Check everything": one tiny job through every model that's downloaded, so a broken piece shows up in minutes with its
// exact error instead of halfway through real work. Groups still downloading (or set to later) are skipped.
import { create } from "zustand";
import { myModels, uploadFile } from "./api";
import { useDownloads } from "./downloads";
import { buildQwenEdit, buildAnimate, buildCreate, buildCutout, buildEdit, buildFind, buildStage, type ApiGraph } from "./graphs";
import { parseBoxes } from "./faceBox";
import { TESTING, useJobs, waitForJob } from "./jobs";
import { activePack, fillTemplate, usePacks } from "./packs";

export type CheckState = "waiting" | "running" | "pass" | "fail" | "skipped";
export interface Check { id: string; label: string; group: string; state: CheckState; ms?: number; error?: string; note?: string }
export const useSelfCheck = create<{ running: boolean; checks: Check[]; at: number | null; video: boolean }>(() => ({ running: false, checks: [], at: null, video: false }));

const ready = (id: string) => { const g = useDownloads.getState().groups.find((x) => x.id === id); return !g || g.state === "done"; };
const known = (id: string) => useDownloads.getState().groups.some((x) => x.id === id);
const S = { sampler: "euler", scheduler: "simple", seed: 1 };
const tiny = (o: Partial<Parameters<typeof buildCreate>[0]>) => buildCreate({
  ...S, steps: 2, cfg: 1, style: "realistic", positive: "a red apple on a table", negative: "", loras: [], width: 512, height: 512,
  count: 1, cutout: false, prefix: "studio/check/c", ...o,
});

/** a small test picture made in the browser (a gradient with a shape), uploaded as an input */
async function testPicture(): Promise<string> {
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = 512;
  const ctx = cv.getContext("2d")!;
  const gr = ctx.createLinearGradient(0, 0, 512, 512); gr.addColorStop(0, "#5a6b7c"); gr.addColorStop(1, "#c9b79c");
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "#b03030"; ctx.beginPath(); ctx.arc(256, 280, 110, 0, Math.PI * 2); ctx.fill();
  const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b!), "image/png"));
  return (await uploadFile(blob, "studio_check.png")).name;
}

function writerGraph(big: boolean): ApiGraph | null {
  const pack = activePack("tweak");
  if (!pack) return null;
  const input = fillTemplate(pack.template || usePacks.getState().templates.tweak || "", { prompt: "a red apple on a table", part: "red apple", change: "make it green" });
  return buildStage({ promptFile: pack.prompt_file, promptChars: pack.chars, input, params: { ...pack.params, max_tokens: 64 }, big, seed: 1, thinking: "off" });
}

export async function runSelfCheck(includeVideo: boolean) {
  if (useSelfCheck.getState().running) return;
  if (!usePacks.getState().loaded) await usePacks.getState().load().catch(() => {});
  const own = await myModels().then((r) => r.items.filter((m) => m.here)).catch(() => []);
  type T = { id: string; label: string; group: string; make: (pic: string) => ApiGraph | null; note?: string };
  const tests: T[] = [
    { id: "anima", label: "Anima (anime pictures)", group: "anime", make: () => tiny({ style: "anime", animeModel: "anima", sampler: "er_sde", cfg: 4 }) },
    { id: "noob", label: "Illustrious / NoobAI-XL", group: "anime", make: () => tiny({ style: "anime", animeModel: "noob", sampler: "euler_ancestral", scheduler: "normal", cfg: 5 }) },
    { id: "krea", label: "Krea 2 Turbo (realistic)", group: "image", make: () => tiny({ realModel: "krea2" }) },
    { id: "kedit", label: "Krea 2 Edit (Identity Edit LoRA + nodes)", group: "kedit", make: (pic) => buildEdit({ ...S, steps: 2, cfg: 1, engine: "krea", images: [pic], instruction: "make the circle green", negative: "", resolution: 512, prefix: "studio/check/e" }) },
    { id: "kedit2", label: "Krea 2 Edit, two pictures", group: "kedit", make: (pic) => buildEdit({ ...S, steps: 2, cfg: 1, engine: "krea", images: [pic, pic], instruction: "put the circle from the second picture here", negative: "", resolution: 512, prefix: "studio/check/e" }) },
    { id: "sam", label: "SAM 3 — find by words (the face pass finds faces with it)", group: "sam", make: (pic) => buildFind(pic, "red circle") },
    { id: "qwen", label: "Edit chat helper (Qwen-Image-Edit 2511, fast, two pictures)", group: "qwen", make: (pic) => buildQwenEdit({ images: [pic, pic], prompt: "Put the circle from Picture 2 in Picture 1", seed: 1, fast: true, prefix: "studio/check/q" }) },
    { id: "bgswap", label: "New background (Krea 2 Edit, kept area flipped)", group: "kedit", make: (pic) => buildEdit({ ...S, steps: 2, cfg: 1, engine: "krea", images: [pic], instruction: "a blue sky", negative: "", resolution: 512, mask: pic, maskInvert: true, prefix: "studio/check/b" }) },
    { id: "facefix", label: "Face pass redraw (Krea 2 Edit on one square, pasted back)", group: "kedit", make: (pic) => buildEdit({ ...S, steps: 2, cfg: 1, engine: "krea", images: [pic], instruction: "sharper", negative: "", resolution: 512, denoise: 0.45, region: { x: 128, y: 160, width: 256, height: 256 }, prefix: "studio/check/f" }) },
    { id: "anedit", label: "Anime redraw (Anima, painted area)", group: "anime", make: (pic) => buildEdit({ ...S, sampler: "er_sde", steps: 2, cfg: 4, engine: "anima", images: [pic], instruction: "1girl", negative: "", resolution: 512, denoise: 0.5, prefix: "studio/check/e" }) },
    { id: "cutout", label: "Remove background (RMBG — first run downloads ~1 GB)", group: "anime", make: (pic) => buildCutout(pic, "studio/check/cut") },
    ...own.map((m): T => ({
      id: `own:${m.name}`, label: `Your checkpoint: ${m.title}${m.version ? ` · ${m.version}` : ""}`, group: "library",
      make: () => m.family === "sdxl" ? tiny({ style: "anime", animeModel: "noob", ckpt: m.name, cfg: 5 })
        : m.family === "anima" ? tiny({ style: "anime", animeModel: "anima", unet: m.name, cfg: 4 })
        : tiny({ realModel: "krea2", unet: m.name }),
    })),
    { id: "writer", label: "Prompt writer (Fable 9B)", group: "writer", make: () => writerGraph(false), note: "loads the model: ~30 s" },
    { id: "writer_xl", label: "Big prompt writer (Qwen3.8 27B)", group: "writer_xl", make: () => writerGraph(true), note: "loads the model: ~1 min" },
    ...(includeVideo ? [{ id: "video", label: "Video (MiniMax H3), 1 s tiny clip", group: "video", note: "loads ~47 GB: a few minutes",
      make: (pic: string) => buildAnimate({ ...S, steps: 4, mode: "i2v", prompt: "The camera slowly pushes in.", images: [pic], videos: [], audios: [], seconds: 1, width: 256, height: 256, turbo: false, loras: [], refImageSize: "match", lowMemDecode: true, prefix: "studio/check/v" }) } as T] : []),
  ];
  const checks: Check[] = tests.map((t) => ({ id: t.id, label: t.label, group: t.group, state: "waiting", note: t.note }));
  useSelfCheck.setState({ running: true, checks, at: Date.now(), video: includeVideo });
  const set = (id: string, p: Partial<Check>) => useSelfCheck.setState((s) => ({ checks: s.checks.map((c) => (c.id === id ? { ...c, ...p } : c)) }));
  civitNote = "";
  try { const p = await (await fetch("/studio-api/proton")).json(); protonNote = p.on ? `${p.cloud ? `(${p.cloud}) ` : ""}${p.state}${p.last_ok ? `, last sent ${new Date(p.last_ok * 1000).toISOString()}` : ""}${p.error ? ` — ${p.error}` : ""}` : ""; } catch { protonNote = ""; }
  try { const r = await fetch("/studio-api/civitai/debug", { signal: AbortSignal.timeout(60_000) }); civitNote = r.ok ? JSON.stringify(await r.json()) : `HTTP ${r.status} ${(await r.text()).slice(0, 200)}`; } catch (e) { civitNote = `failed: ${(e as Error).message}`; }
  let pic = "";
  try { pic = await testPicture(); } catch (e) { /* tests that need it will fail with the reason */ }
  for (const t of tests) {
    if (t.group !== "library" && known(t.group) && !ready(t.group)) { set(t.id, { state: "skipped", error: "not downloaded yet (or set to later)" }); continue; }
    if (t.id.startsWith("writer") && !activePack("tweak")) { set(t.id, { state: "skipped", error: "no prompt file for the rewriter" }); continue; }
    const t0 = Date.now();
    set(t.id, { state: "running" });
    try {
      const g = t.make(pic);
      if (!g) throw new Error("couldn't build the test");
      const job = await useJobs.getState().run("create", `Check: ${t.label}`, g, `check:${t.id}`, { kind: "selfcheck", project: TESTING, selfcheck: true });
      const done = await waitForJob(job.id);
      // SAM 3 has to actually find the red circle in the test picture, not just run
      const found = t.id === "sam" ? parseBoxes(done.texts.boxes ?? "") : null;
      if (found && !found.length) throw new Error(`ran, but found nothing — it printed: ${(done.texts.boxes ?? "(nothing)").slice(0, 200)}`);
      set(t.id, { state: "pass", ms: Date.now() - t0, ...(found ? { note: `found it, ${Math.round(found[0].score * 100)}% sure` } : {}) });
    } catch (e) {
      set(t.id, { state: "fail", ms: Date.now() - t0, error: String((e as Error).message ?? e).slice(0, 600) });
    }
  }
  useSelfCheck.setState({ running: false });
}

let civitNote = "";
let protonNote = "";
export const BUILT = typeof __BUILT__ === "string" ? __BUILT__ : "dev";

/** the report as plain text, to paste into a chat */
export function checkReport(): string {
  const { checks, at, video } = useSelfCheck.getState();
  const line = (c: Check) => `${c.state === "pass" ? "PASS" : c.state === "fail" ? "FAIL" : c.state === "skipped" ? "SKIP" : c.state.toUpperCase()}  ${c.label}${c.ms ? ` (${(c.ms / 1000).toFixed(0)} s)` : ""}${c.state === "pass" && c.note ? ` — ${c.note}` : ""}${c.error ? `\n      ${c.error}` : ""}`;
  return [`H3 Studio check — ${at ? new Date(at).toISOString() : ""}${video ? " (with video)" : ""} · Studio built ${BUILT}`, ...checks.map(line), ...(civitNote ? [`CivitAI: ${civitNote}`] : []), ...(protonNote ? [`Backups: ${protonNote}`] : [])].join("\n");
}
