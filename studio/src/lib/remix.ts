// Remix: put a result's exact settings (and, on this rental, its pictures/references) back into its tab.
import { create } from "zustand";
import type { Job, Tab } from "./jobs";
import { useSettings, type Settings } from "./settings";
import { useJobs } from "./jobs";
import { viewUrl, type FileRef } from "./api";

export interface Snapshot { section: Exclude<keyof Settings, "tab" | "drawers">; settings: unknown; media?: Record<string, unknown> }
export const useRemix = create<{ pending: { tab: Tab; snap: Snapshot; n: number; source?: { url: string; out: FileRef; label: string } } | null }>(() => ({ pending: null }));
let n = 0;
export const canRemix = (j: Job) => !!j.meta?.snapshot;
export function remix(j: Job) {
  const snap = j.meta?.snapshot as Snapshot | undefined;
  if (!snap) return;
  useSettings.getState().set(snap.section, snap.settings as never);
  // words you add after the restored prompt get worked into it by the writer (Create), not stapled on the end
  if (snap.section === "create") import("./make").then(({ useMakeRefs }) => useMakeRefs.setState({ remixBase: String((snap.settings as { extra?: string }).extra ?? "") || null }));
  const first = j.outputs.find((o) => o.kind === "image");
  useRemix.setState({ pending: { tab: j.tab, snap, n: ++n, ...(first ? { source: { url: viewUrl(first), out: first, label: j.label } } : {}) } });
  useSettings.getState().setTab(j.tab);
  useJobs.getState().toast("Settings restored — change one thing and go again.", "info");
}

/** "Edit / remix" on any picture — one place, like Grok Imagine: the picture goes into Create as the one being changed,
 *  with the prompt, LoRAs and settings it was made with (when it has them) and your character if one is picked. Type what
 *  to change, choose how much may change, Generate. */
export async function editPicture(j: Job, o: import("./jobs").Output) {
  const { useTray } = await import("./tray");
  const { useMakeRefs } = await import("./make");
  const snap = j.meta?.snapshot as Snapshot | undefined;
  const st = useSettings.getState();
  if (snap?.section === "create") st.set("create", snap.settings as never);
  else if (snap?.section === "edit") {
    // an Edit result: its words + LoRAs come along into Create
    const s = snap.settings as Record<string, unknown>;
    const eng = (s.engine as string) ?? "krea";
    const key = eng === "krea" ? "lorasKrea" : eng === "noob" ? "lorasNoob" : "lorasAnima";
    const ckey = eng === "krea" ? "lorasKrea" : eng === "noob" ? "lorasAnime" : "lorasAnima";
    st.set("create", { style: eng === "krea" ? "realistic" : "anime", ...(eng === "krea" ? {} : { animeModel: eng === "noob" ? "noob" : "anima" }), extra: String(s.instruction ?? ""), raw: false, [ckey]: (s[key] as unknown[]) ?? [] } as never);
  }
  const item = useTray.getState().addOutput(o, j.label);
  if (!item) return;
  const m = await useTray.getState().asMedia(item.id);
  const base = snap?.section === "create" ? String((snap.settings as { extra?: string }).extra ?? "") : snap?.section === "edit" ? String((snap.settings as { instruction?: string }).instruction ?? "") : "";
  useMakeRefs.setState({ pic2: m, remixOf: { url: viewUrl(o), out: o, label: j.label }, take: "look", remixBase: base || null });
  st.setTab("create");
  useJobs.getState().toast("In Create: say what to change (or leave the prompt), pick how much may change, then Generate.", "info", "create");
}

/** "Make it again exactly": Create set to the very settings a picture was made with — model, checkpoint, LoRAs at their
 *  strengths, size, sampler, steps, CFG, negative and the same seed (locked). From the full snapshot when it has one (your
 *  character and pictures too); otherwise from what was sent (Batch recreates, older pictures), as an exact prompt. */
export async function recreateExact(j: Job): Promise<boolean> {
  const { modelOf, pickModel, DEFAULTS } = await import("./settings");
  const st = useSettings.getState();
  const snap = j.meta?.snapshot as Snapshot | undefined;
  const sent = j.meta?.sent as { prompt?: string; negative?: string; model?: string; checkpoint?: string; loras?: { name: string; strength: number }[]; size?: string; seed?: number; steps?: number; cfg?: number; sampler?: string; scheduler?: string } | undefined;
  if (snap?.section === "create") {
    const s = snap.settings as import("./settings").CreateS;
    const m = modelOf(s);
    st.set("create", { ...s, ...(sent?.seed != null ? { [m.advKey]: { ...m.adv, seed: sent.seed, lockSeed: true } } : {}) } as never);
    st.setTab("create");
    return true;
  }
  if (!sent?.prompt) return false;
  const label = (sent.model ?? "").toLowerCase();
  const model = label.includes("raw") ? "krea2raw" : label.includes("krea") ? "krea2" : label.includes("illustrious") || label.includes("noob") ? "noob" : label.includes("anima") ? "anima" : "krea2";
  const cur = st.s.create;
  const m = modelOf({ ...cur, ...pickModel(model) } as import("./settings").CreateS);
  const [w, h] = (sent.size ?? "").split("→")[0].split("×").map((x) => parseInt(x, 10));
  const r = w && h ? w / h : 0.5625;
  const shape = r < 0.62 ? "portrait" : r < 0.85 ? "tall" : r < 1.15 ? "square" : "wide";
  const base = cur[m.advKey] ?? DEFAULTS.create[m.advKey];
  st.set("create", {
    ...pickModel(model), raw: true, extra: sent.prompt, negative: sent.negative ?? "", characterId: null, polish: false, animeTags: false, balance: false, shape,
    upscale: (sent.size ?? "").includes("→") ? cur.upscale || 1.5 : 0,
    [m.lorasKey]: (sent.loras ?? []).map((l) => ({ name: l.name, strength: l.strength })),
    [m.advKey]: { ...base, sampler: sent.sampler ?? base.sampler, scheduler: sent.scheduler ?? base.scheduler, steps: sent.steps ?? base.steps, cfg: sent.cfg ?? base.cfg, seed: sent.seed ?? base.seed, lockSeed: sent.seed != null },
    checkpoint: { ...(cur.checkpoint ?? {}), [model === "krea2raw" ? "krea2raw" : model]: !sent.checkpoint || sent.checkpoint === "official" ? "" : sent.checkpoint },
  } as never);
  st.setTab("create");
  return true;
}
