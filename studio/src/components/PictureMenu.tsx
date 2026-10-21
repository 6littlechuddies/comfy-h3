// Right-click any picture (CivitAI examples and collections, "How was this made?", the picture slots in every tab):
// use it in Edit as Picture 1 or 2, add it to Compose, copy its look into Create, switch Edit to the model it was made
// with, copy it, save it, or open it on CivitAI.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { CIVITAI_SITE, civitFetchMedia, civitImage, fileGen, inputUrl, viewUrl, type CivitGen, type FileRef } from "../lib/api";
import { cleanPrompt, createTargetOf, genStyleToCreate, GEN_OF } from "../lib/civitUse";
import { buildEdit } from "../lib/graphs";
import { useJobs } from "../lib/jobs";
import { editArgs, newSeed, useSettings } from "../lib/settings";
import { trayIdOf, useTray, type Media } from "../lib/tray";
import { useMakeRefs } from "../lib/make";
import { useCharacters } from "../lib/characters";
import { useRecipes } from "../lib/recipes";
import type { EditEngine } from "../lib/graphs";
import { Icon, cx } from "./ui";

export interface PicTarget {
  /** a picture already on the rental (a slot, the tray) */
  media?: Media;
  /** one of your results (Create, Edit… outputs) */
  output?: FileRef;
  /** everything CivitAI knows about it */
  gen?: CivitGen;
  /** a CivitAI picture by id + its full-size url (collections, examples) */
  civitId?: number;
  url?: string;
  video?: boolean;
  label?: string;
}


const usePicMenu = create<{ at: { x: number; y: number; t: PicTarget } | null }>(() => ({ at: null }));
export function openPictureMenu(e: React.MouseEvent, t: PicTarget) {
  e.preventDefault(); e.stopPropagation();
  usePicMenu.setState({ at: { x: e.clientX, y: e.clientY, t } });
}

/** the picture as a file on this rental (copied from CivitAI the first time) */
async function toMedia(t: PicTarget): Promise<Media> {
  if (t.media) return t.media;
  if (t.output) {
    const item = useTray.getState().addOutput(t.output, t.label ?? t.output.filename);
    if (!item) throw new Error("Can't use that file");
    return useTray.getState().asMedia(item.id);
  }
  if (t.gen?.local) return { ...t.gen.local, url: inputUrl(t.gen.local.name), label: t.gen.local.name };
  const id = t.civitId ?? t.gen?.id;
  const url = t.url ?? t.gen?.url;
  if (!id || !url) throw new Error("Can't copy this picture");
  const f = await civitFetchMedia(url, id);
  const label = t.label ?? `CivitAI ${id}`;
  useTray.getState().addOutput({ filename: f.name, subfolder: "", type: "input" }, label);
  if (t.gen) GEN_OF.set(f.name, t.gen);
  return { ...f, url: inputUrl(f.name), label, trayId: trayIdOf({ filename: f.name, subfolder: "", type: "input" }) };
}
/** how it was made: CivitAI's data, or what's written inside the file */
async function genOf(t: PicTarget): Promise<CivitGen | null> {
  if (t.gen) return t.gen;
  if (t.civitId) return civitImage(`${CIVITAI_SITE}/images/${t.civitId}`);
  if (t.output && !t.media) t = { ...t, media: await toMedia(t) }; // your results carry their prompt inside the file
  if (t.media) {
    const known = GEN_OF.get(t.media.name);
    if (known) return known;
    if (t.media.kind === "image" || t.media.kind === "video") {
      const g = await fileGen(t.media);
      return g.found ? g : null;
    }
  }
  return null;
}
const ENGINE_FOR: Record<string, EditEngine> = { anima: "anima", sdxl: "noob", krea2: "krea", qwen: "krea" };
const ENGINE_LABEL: Record<EditEngine, string> = { krea: "Krea 2", anima: "Anima", noob: "Illustrious" };

async function asPng(url: string): Promise<Blob> {
  const b = await (await fetch(url)).blob();
  if (b.type === "image/png") return b;
  const img = await createImageBitmap(b);
  const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
  cv.getContext("2d")!.drawImage(img, 0, 0);
  return new Promise((res, rej) => cv.toBlob((x) => (x ? res(x) : rej(new Error("couldn't convert"))), "image/png"));
}

export function PictureMenuHost() {
  const at = usePicMenu((s) => s.at);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useJobs((s) => s.toast);
  const close = () => { if (!busy) usePicMenu.setState({ at: null }); };
  useEffect(() => {
    if (!at) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!at) return null;
  const t = at.t;
  const isVideo = t.video || t.media?.kind === "video" || t.gen?.video;
  const picUrl = t.media?.url || (t.output ? viewUrl(t.output) : "") || t.url || t.gen?.url || "";

  const act = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    // close the menu first: an action that asks something (More like this) opens its box under the menu otherwise
    usePicMenu.setState({ at: null });
    try { const msg = await fn(); if (msg) toast(msg, "good"); usePicMenu.setState({ at: null }); }
    catch (e) { toast((e as Error).message, "bad"); }
    finally { setBusy(null); }
  };
  const closeWindows = async () => {
    const [{ useImport }, { useLoraBrowser }] = await Promise.all([import("./ImageImport"), import("./LoraBrowser")]);
    useImport.setState({ open: false }); useLoraBrowser.setState({ open: false });
  };
  const send = async (tab: "edit" | "animate", slot?: string) => {
    const m = await toMedia(t);
    const id = m.trayId ?? trayIdOf({ filename: m.name, subfolder: "", type: "input" });
    if (!useTray.getState().items.some((i) => i.id === id)) useTray.getState().addOutput({ filename: m.name, subfolder: "", type: "input" }, m.label);
    const { sendTo } = await import("../App");
    sendTo(tab, [id], slot);
    // close the CivitAI windows so you land on the tab
    const [{ useImport }, { useLoraBrowser }] = await Promise.all([import("./ImageImport"), import("./LoraBrowser")]);
    useImport.setState({ open: false }); useLoraBrowser.setState({ open: false });
  };
  const myRecipes = useRecipes.getState().list;
  const selName = (() => { const st = useCharacters.getState(); return st.list.find((x) => x.id === st.sel)?.name; })();
  const items: { key: string; icon: string; label: string; run: () => Promise<string | void>; hide?: boolean }[] = [
    {
      // the workflow that works, in one click: this picture + your character, likeness carried into its prompt, 2 takes
      key: "faceon", icon: "user", label: `Put ${selName ?? "your character"}'s face on this`, hide: isVideo || !selName, run: async () => {
        const st = useCharacters.getState();
        const c = st.list.find((x) => x.id === st.sel);
        if (!c) return "Pick a character on the left first";
        const m = await toMedia(t);
        await closeWindows();
        const { faceOnto } = await import("../lib/likeness");
        useSettings.getState().setTab("edit");
        return faceOnto(m, c, 2);
      },
    },
    {
      key: "with", icon: "user", label: `${selName ?? "Your character"} in this · whole person + their outfit`, hide: isVideo || !selName, run: async () => {
        const st = useCharacters.getState();
        const c = st.list.find((x) => x.id === st.sel);
        if (!c) return "Pick a character on the left first";
        const m = await toMedia(t);
        await closeWindows();
        const { makeWithCharacter } = await import("../lib/likeness");
        toast(`Reading this picture's prompt and carrying ${c.name}'s look into it…`, "info");
        return makeWithCharacter(m, c, 2);
      },
    },
    { key: "e1", icon: "brush", label: "Use in Edit · Picture 1", hide: isVideo, run: () => send("edit", "1") },
    { key: "e2", icon: "brush", label: "Use in Edit · Picture 2", hide: isVideo, run: () => send("edit", "2") },
    {
      key: "cr", icon: "sparkle", label: "Use in Create · reference (2)", hide: isVideo, run: async () => {
        const m = await toMedia(t);
        useMakeRefs.setState({ pic2: m });
        useSettings.getState().set("create", { raw: false });
        useSettings.getState().setTab("create");
        await closeWindows();
        const ch = useCharacters.getState().list.find((x) => x.id === useCharacters.getState().sel);
        return ch ? `Picture 2 is in — ${ch.name} is Picture 1. Pick what to take from it, then Generate.` : "Picture 2 is in — pick a character on the left to put them in it";
      },
    },
    {
      key: "newc", icon: "user", label: "New character from this picture", hide: isVideo, run: async () => {
        // its own project: the picture becomes their look, so it doesn't mix into the character you're on
        const m = await toMedia(t);
        const [{ useNewFromPicture }, gen] = await Promise.all([import("../tabs/Characters"), genOf(t).catch(() => null)]);
        useCharacters.getState().select(null);
        useNewFromPicture.setState({ pic: m, gen });
        useSettings.getState().setTab("characters");
        await closeWindows();
        return "On the right: name them and press Read the picture — they get their own project";
      },
    },
    {
      // a picture you love: straight into the picked character's private (premium) folder for your site
      key: "priv", icon: "lock", label: `Add to ${selName ?? "the character"}'s private set`, hide: !selName, run: async () => {
        const st = useCharacters.getState();
        const c = st.list.find((x) => x.id === st.sel);
        if (!c) return "Pick a character on the left first";
        const ref: FileRef = t.output ?? await toMedia(t).then((m) => ({ filename: m.name, subfolder: "", type: "input" as const }));
        const sets = [...(c.site?.sets ?? [])];
        let i = sets.findIndex((x) => x.tier === "premium" && /private/i.test(x.title));
        if (i < 0) { sets.push({ set_key: `private-${Date.now().toString(36)}`, title: "Private", description: "", tier: "premium", rating: "suggestive", items: [] }); i = sets.length - 1; }
        if (sets[i].items.some((x) => x.filename === ref.filename && x.subfolder === ref.subfolder)) return `Already in ${c.name}'s private set`;
        sets[i] = { ...sets[i], items: [...sets[i].items, { ...ref }] };
        st.save({ ...c, site: { ...c.site, sets } });
        return `Added to ${c.name}'s private set (${sets[i].items.length}) — ⋯ → Your site to send it`;
      },
    },
    {
      key: "upq", icon: "up", label: "Upscale ×2 quick (NVIDIA, no redraw)", hide: isVideo, run: async () => {
        const m = await toMedia(t);
        const [{ buildRtxUpscale }, { rtxInstalled }] = await Promise.all([import("../lib/graphs"), import("../lib/downloads")]);
        if (rtxInstalled() === false) return "The quick upscaler isn't on this rental — use “Upscale ×2 with detail”";
        await closeWindows();
        await useJobs.getState().run(useSettings.getState().s.tab, "Quick upscale ×2", buildRtxUpscale({ image: m.name, scale: 2, prefix: "studio/upscale/quick" }), "upscale:rtx", { before: m.url });
        return "Upscaling ×2 (quick) — it appears with your results in a few seconds";
      },
    },
    {
      key: "up2", icon: "up", label: "Upscale ×2 with detail", hide: isVideo, run: async () => {
        const m = await toMedia(t);
        const g = await genOf(t).catch(() => null);
        const fam = g ? (g.family !== "unknown" ? g.family : createTargetOf(g) === "anima" ? "anima" : createTargetOf(g) === "noob" ? "sdxl" : "krea2") : "krea2";
        const { upscalePicture } = await import("../lib/likeness");
        useSettings.getState().setTab("edit");
        await closeWindows();
        return upscalePicture(m, fam === "anima" ? "anima" : fam === "sdxl" ? "sdxl" : "krea2");
      },
    },
    {
      key: "face", icon: "sparkle", label: "Sharpen the face", hide: isVideo, run: async () => {
        const m = await toMedia(t);
        const { sharpenFace } = await import("../lib/faceDetail");
        useSettings.getState().setTab("edit");
        await closeWindows();
        sharpenFace({ name: m.name }, { tab: "edit" }).catch((e) => toast((e as Error).message, "bad"));
        return "Finding the face and redrawing it sharper — the result appears in Edit";
      },
    },
    {
      key: "facec", icon: "sparkle", label: `Sharpen the face · as ${selName ?? "the character"}`, hide: isVideo || !selName, run: async () => {
        const m = await toMedia(t);
        const st = useCharacters.getState();
        const c = st.list.find((x) => x.id === st.sel) ?? null;
        const { sharpenFace } = await import("../lib/faceDetail");
        useSettings.getState().setTab("edit");
        await closeWindows();
        sharpenFace({ name: m.name }, { tab: "edit", character: c }).catch((e) => toast((e as Error).message, "bad"));
        return `Redrawing the face sharper, matched to ${c?.name ?? "the character"}'s picture — the result appears in Edit`;
      },
    },
    { key: "an", icon: "film", label: isVideo ? "Use in Animate" : "Animate it · image → video", run: () => send("animate", isVideo ? undefined : "start") },
    {
      key: "how", icon: "search", label: "How it was made · prompt & settings", hide: !!(t.gen?.page || t.civitId), run: async () => {
        const m = await toMedia(t);
        const { openFileMeta } = await import("./ImageImport");
        openFileMeta(m);
      },
    },
    {
      key: "more", icon: "dice", label: "More like this ×4 · with changes", hide: isVideo, run: async () => {
        const { askText } = await import("./Dialogs");
        const words = await askText("More like this — anything to change? (e.g. “mouth closed”, “hand on hip”; leave empty for plain variations)", "", "Make 4", true);
        if (words === null) return;
        const m = await toMedia(t);
        const g = await genOf(t).catch(() => null);
        const fam = g ? (g.family !== "unknown" ? g.family : createTargetOf(g) === "anima" ? "anima" : createTargetOf(g) === "noob" ? "sdxl" : "krea2") : "krea2";
        const engine: EditEngine = fam === "anima" ? "anima" : fam === "sdxl" ? "noob" : "krea";
        const ed = useSettings.getState().s.edit;
        const anime = engine !== "krea";
        // anime: a light redraw from its own prompt; realistic: Krea 2 Edit keeps the face, outfit and setting
        const change = (words ?? "").trim();
        const instruction = anime
          ? [cleanPrompt(g?.prompt ?? "") || "masterpiece, best quality", change].filter(Boolean).join(", ")
          : change
            ? `Make a version of this picture where: ${change.replace(/\.?$/, ".")} Keep the same person with exactly the same face, hair, outfit, setting, lighting and style; everything not mentioned stays as it is.`
            : "Make a natural variation of this photo: the same person with the same face, hair, outfit, setting and lighting, in a slightly different pose, expression and camera angle.";
        for (let i = 0; i < 4; i++) {
          const graph = buildEdit({ ...editArgs(ed, engine), ...(anime ? { denoise: change ? 0.6 : 0.45 } : { refBoost: change ? 3 : 4 }), seed: newSeed(), images: [m.name], instruction, negative: "", resolution: 1024, prefix: "studio/edit/variation" });
          await useJobs.getState().run("edit", `More like this${change ? ` · ${change.slice(0, 30)}` : ""} ${i + 1}/4`, graph, `edit:${engine}:1:raw`, { before: m.url, stack: t.output ? trayIdOf(t.output) : m.trayId ?? m.name });
        }
        useSettings.getState().setTab("edit");
        const [{ useImport }, { useLoraBrowser }] = await Promise.all([import("./ImageImport"), import("./LoraBrowser")]);
        useImport.setState({ open: false }); useLoraBrowser.setState({ open: false });
        return `4 variations on the way (${engine === "krea" ? "Krea 2 Edit" : engine === "anima" ? "Anima" : "Illustrious"}) — they appear in Edit`;
      },
    },
    {
      key: "look", icon: "sparkle", label: "Copy its look → Create", run: async () => {
        // with a character picked: they take the place of the person in this picture (Picture 1 + Picture 2)
        const ch = useCharacters.getState().list.find((x) => x.id === useCharacters.getState().sel);
        if (ch && !isVideo) {
          const m = await toMedia(t);
          useMakeRefs.setState({ pic2: m, take: "look" });
          useSettings.getState().set("create", { raw: false, extra: "" });
          useSettings.getState().setTab("create");
          await closeWindows();
          return `${ch.name} will take this picture's look, pose and setting — add any changes in words, then Generate`;
        }
        const g = await genOf(t);
        if (!g || !g.prompt) throw new Error("No generation data in this picture — nothing to copy the look from");
        const r = await genStyleToCreate(g);
        useSettings.getState().setTab("create");
        return `Copied its look into Create${r.failed.length ? ` — ${r.failed.length} LoRA(s) couldn't be added` : ""}`;
      },
    },
    {
      // its setting, light, camera and finish become a scene Batch → Content plan can put your characters into
      key: "scene", icon: "plus", label: "Save as scene inspiration", hide: isVideo, run: async () => {
        const g = await genOf(t);
        if (!g?.prompt?.trim()) throw new Error("No prompt in this picture to save");
        const { useInspo, setFor } = await import("../lib/inspo");
        const id = setFor("scene");
        useInspo.getState().add(id, { text: g.prompt, thumb: g.thumb || g.url || picUrl, url: g.url || picUrl || undefined, page: g.page || undefined });
        const set = useInspo.getState().sets.find((x) => x.id === id);
        return `Saved to “${set?.name}” (${set?.items.length}) — use it in Batch → Content plan → Scenes`;
      },
    },
    {
      key: "pose", icon: "plus", label: "Save its pose to my poses", hide: isVideo, run: async () => {
        const g = await genOf(t);
        if (!g?.prompt?.trim()) throw new Error("No prompt in this picture to take the pose from");
        const [{ toPieces, categorize }, { cleanPrompt: clean }, { useInspo, setFor }] = await Promise.all([import("../lib/tweak"), import("../lib/civitUse"), import("../lib/inspo")]);
        const words = toPieces(clean(g.prompt)).map((p) => p.text).filter((x) => categorize(x) === "pose").join(", ");
        if (!words) throw new Error("Couldn't find pose words in its prompt — open How it was made, select the pose pieces and press Add to my poses");
        const id = setFor("pose");
        useInspo.getState().add(id, { text: words, thumb: g.thumb || g.url || picUrl, page: g.page || undefined });
        return `Pose saved to “${useInspo.getState().sets.find((x) => x.id === id)?.name}”: ${words.slice(0, 80)}${words.length > 80 ? "…" : ""}`;
      },
    },
    {
      key: "model", icon: "refresh", label: "Edit with the model it was made with", hide: isVideo, run: async () => {
        const g = await genOf(t);
        const fam = g ? (g.family !== "unknown" ? g.family : createTargetOf(g) === "anima" ? "anima" : createTargetOf(g) === "noob" ? "sdxl" : "krea2") : null;
        const engine = fam ? ENGINE_FOR[fam] : undefined;
        if (!engine) throw new Error("Can't tell which model made this picture — pick one with the Model chip in Edit");
        useSettings.getState().set("edit", { engine });
        return `Edit now uses ${ENGINE_LABEL[engine]} (this picture was made with ${g?.base || fam})`;
      },
    },
    {
      key: "copy", icon: "script", label: "Copy picture", hide: isVideo || !picUrl, run: async () => {
        if (!window.isSecureContext || !navigator.clipboard?.write) throw new Error("Copying a picture only works on the secure link (⋯ menu → Secure link) — your results and characters come along there now. Or use Save picture.");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": asPng(picUrl) })]);
        return "Copied";
      },
    },
    {
      key: "save", icon: "up", label: isVideo ? "Save video" : "Save picture", hide: !picUrl, run: async () => {
        const b = await (await fetch(picUrl)).blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = (t.media?.name ?? t.label ?? `civitai_${t.civitId ?? t.gen?.id ?? "picture"}`).replace(/[^\w.-]+/g, "_") + (/\.\w{3,4}$/.test(t.media?.name ?? "") ? "" : isVideo ? ".mp4" : ".png");
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      },
    },
    {
      key: "del", icon: "trash", label: isVideo ? "Delete this video" : "Delete this picture", hide: !t.output, run: async () => {
        const o = t.output!;
        const job = useJobs.getState().jobs.find((j) => j.outputs.some((x) => x.filename === o.filename && x.subfolder === o.subfolder));
        if (!job) throw new Error("Couldn't find which result this is — delete it from its card");
        useJobs.getState().removeOutputs([{ jobId: job.id, filename: o.filename, subfolder: o.subfolder }]);
        return "Deleted";
      },
    },
    {
      key: "civ", icon: "external", label: "Open on CivitAI", hide: !(t.gen?.page || t.civitId), run: async () => {
        window.open(t.gen?.page || `${CIVITAI_SITE}/images/${t.civitId}`, "_blank", "noopener");
      },
    },
  ];
  return createPortal(
    <div className="fixed inset-0 z-[96]" onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }}>
      <div role="menu" aria-label="Picture" className="fade-in absolute max-h-[min(560px,80vh)] w-64 overflow-y-auto border border-line bg-raised2 py-1 shadow-2xl"
        style={{ left: Math.min(at.x, window.innerWidth - 268), top: Math.max(8, Math.min(at.y, window.innerHeight - Math.min(560, window.innerHeight * 0.8) - 8)) }} onMouseDown={(e) => e.stopPropagation()}>
        {items.filter((i) => !i.hide).map((i) => (
          <button key={i.key} role="menuitem" disabled={!!busy} onClick={() => act(i.key, i.run)}
            className={cx("flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-hover disabled:opacity-50", busy === i.key && "text-accent")}>
            <Icon name={i.icon} size={13} className="text-muted" />{busy === i.key ? "Working…" : i.label}
          </button>
        ))}
      </div>
    </div>, document.body);
}
