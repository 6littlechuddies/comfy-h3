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
