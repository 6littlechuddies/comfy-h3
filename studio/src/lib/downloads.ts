// Which model groups are on this rental yet (see the "# @group" lines in models.txt). The first group is in
// before the Studio opens; the rest keep downloading in the background and each tab unlocks when its group arrives.
import { create } from "zustand";
import { forgetObjectInfo } from "./api";
import { H3_CACHE_KEY, H3_CACHE_NODE, H3_MODEL_KEY, REALISM_KEY, setH3Cache, setRealism, setQuadSheet, setBfs, RTX_KEY, SMOOTH_KEY, setInterp, setRtx, setH3Eros, KREA_BOOST_KEY, KREA_BOOST_NODE, KREA_EDIT_KEY, KREA_TE_KEY, setKreaBoost, setKreaEditV2, setKreaTE } from "./models";

/** Krea 2 uses the uncensored text encoder once its group is downloaded, unless you chose the stock one */
export function syncKreaTE(groups: { id: string; state: string }[] = useDownloads.getState().groups) {
  let stock = false; try { stock = localStorage.getItem(KREA_TE_KEY) === "stock"; } catch { /* private mode */ }
  setKreaTE(!stock && groups.some((g) => g.id === "krea_te" && g.state === "done"));
  let v1 = false; try { v1 = localStorage.getItem(KREA_EDIT_KEY) === "v1"; } catch { /* private mode */ }
  setKreaEditV2(!v1 && groups.some((g) => g.id === "kedit2" && g.state === "done"));
  let eros = false; try { eros = localStorage.getItem(H3_MODEL_KEY) === "eros"; } catch { /* private mode */ }
  setH3Eros(eros && groups.some((g) => g.id === "eros" && g.state === "done"));
  let noReal = false; try { noReal = localStorage.getItem(REALISM_KEY) === "off"; } catch { /* private mode */ }
  setRealism(!noReal && groups.some((g) => g.id === "hreal" && g.state === "done"));
  setQuadSheet(groups.some((g) => g.id === "csheet" && g.state === "done"));
  setBfs(groups.some((g) => g.id === "bfs" && g.state === "done"));
  let noSmooth = false; try { noSmooth = localStorage.getItem(SMOOTH_KEY) === "off"; } catch { /* private mode */ }
  const rife = groups.some((g) => g.id === "smooth" && g.state === "done");
  if (noSmooth || !rife) setInterp(false);
  else if (interpWidget === null) void fetch("/object_info/FrameInterpolate").then((r) => (r.ok ? r.json() : Promise.reject())).then((b) => {
    const req = b?.FrameInterpolate?.input?.required ?? {};
    interpWidget = Object.keys(req).find((k) => k !== "interp_model" && k !== "images" && req[k]?.[0] === "INT") ?? (b?.FrameInterpolate ? "multiplier" : "");
    setInterp(!!interpWidget, interpWidget || undefined);
  }).catch(() => { /* not up yet */ });
  else setInterp(!!interpWidget, interpWidget || undefined);
  let noRtx = false; try { noRtx = localStorage.getItem(RTX_KEY) === "off"; } catch { /* private mode */ }
  if (noRtx) setRtx(false);
  else if (rtxNode === null) void fetch("/object_info/RTXVideoSuperResolution").then((r) => (r.ok ? r.json() : Promise.reject())).then((b) => { rtxNode = !!b?.RTXVideoSuperResolution; setRtx(rtxNode); }).catch(() => { /* not up yet */ });
  else setRtx(rtxNode);
  let off = false; try { off = localStorage.getItem(KREA_BOOST_KEY) === "off"; } catch { /* private mode */ }
  if (off) setKreaBoost(false);
  else if (boostNode === null) void fetch(`/object_info/${KREA_BOOST_NODE}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((b) => { boostNode = !!b?.[KREA_BOOST_NODE]; setKreaBoost(boostNode); }).catch(() => { /* not up yet: ask again next poll */ });
  else setKreaBoost(boostNode);
  let cacheWant = false; try { cacheWant = localStorage.getItem(H3_CACHE_KEY) === "on"; } catch { /* private mode */ }
  if (h3CacheNode === null) void fetch(`/object_info/${H3_CACHE_NODE}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((b) => { h3CacheNode = !!b?.[H3_CACHE_NODE]; setH3Cache(cacheWant && h3CacheNode); }).catch(() => { /* not up yet */ });
  else setH3Cache(cacheWant && h3CacheNode);
}
/** is the RTX Video Super Resolution node installed? (null = not asked yet) */
let rtxNode: boolean | null = null;
export const rtxInstalled = () => rtxNode;
/** the node is there but this rental's GPU/driver can't run it (NvVFX_Load failed): off until the next rental */
export function rtxBroken() { rtxNode = false; setRtx(false); }
/** FrameInterpolate's "how many times" input name ("" = node missing, null = not asked yet) */
let interpWidget: string | null = null;
/** is the Krea2T Enhancer node installed? (null = not asked yet) */
let boostNode: boolean | null = null;
export const kreaBoostInstalled = () => boostNode;
/** is ApplyMiniMaxH3FirstBlockCache installed? (null = not asked yet) */
let h3CacheNode: boolean | null = null;
export const h3CacheInstalled = () => h3CacheNode;

export type GroupId = "anime" | "image" | "edit" | "writer" | "video" | string;
export interface Group { id: GroupId; label: string; state: "checking" | "waiting" | "downloading" | "done" | "error" | "skipped" | "later"; pct: number; left_s: number; total_mb: number; done_mb: number; error?: string | null; can_later?: boolean; /** why it waits: no disk room, or the card is too small */ why?: string | null }
export interface Preset { id: string; label: string; groups: string[] }
interface Downloads { /** what this rental is for (download preset) and the choices */ preset?: string; presets?: Preset[];
  /** the Studio is running on your own PC (not a rental) */ local?: boolean; known: boolean; active: boolean; groups: Group[]; mbps: number; pct: number; left_s: number; gpu?: { name?: string; vram_mb?: number; images_only?: boolean } }

export const useDownloads = create<Downloads>(() => ({ known: false, active: false, groups: [], mbps: 0, pct: 100, left_s: 0 }));

let timer: ReturnType<typeof setTimeout> | undefined;
async function poll() {
  let next = 30000;
  try {
    const r = await fetch("/h3-downloads", { cache: "no-store" });
    if (r.ok) {
      const d = await r.json();
      const before = useDownloads.getState().groups;
      const dsm = await import("./deepseek");
      await dsm.ensureDeepseek();
      const ds = dsm.deepseekOn();
      const groups = ((d.groups ?? []) as Group[]).map((g) => (ds && g.id === "writer" ? { ...g, label: "Prompt writer (DeepSeek)", state: "done" as const, pct: 100, why: null } : g));
      useDownloads.setState({ known: true, active: !!d.active, groups, mbps: d.mbps ?? 0, pct: d.pct ?? 0, left_s: d.left_s ?? -1, gpu: d.gpu, local: !!d.local, preset: d.preset, presets: d.presets });
      // on your own PC there's no local prompt writer: prompts come from your Grok tab unless you've picked something else
      if (d.local) { try { if (!localStorage.getItem("h3.writer")) localStorage.setItem("h3.writer", "outside"); } catch { /* */ } }
      syncKreaTE(d.groups ?? []);
      const arrived = (d.groups as Group[] ?? []).filter((g) => g.state === "done" && before.some((b) => b.id === g.id && b.state !== "done"));
      if (arrived.length) {
        forgetObjectInfo(); // ComfyUI now lists the new model files
        import("../components/Checkpoint").then((m) => m.bumpModels()).catch(() => {});
        const { useJobs } = await import("./jobs");
        arrived.forEach((g) => useJobs.getState().toast(`${g.label} models are in — ready to use.`, "good"));
      }
      if (d.active) next = 3000;
    }
  } catch { /* older image or dev server: assume everything is there */ }
  timer = setTimeout(poll, next);
}
if (typeof window !== "undefined") { clearTimeout(timer); poll(); }
/** ask the downloader again now (e.g. DeepSeek was just switched on: the writer shows ready) */
export function refreshDownloads() { clearTimeout(timer); void poll(); }

/** leave a group out on this rental, or fetch it now / try a failed one again */
export async function setLater(id: GroupId, later: boolean | "next"): Promise<void> {
  const body = later === "next" ? { group: id, next: true } : { group: id, later };
  const r = await fetch("/studio-api/downloads/later", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "That didn't work — try again in a moment");
  clearTimeout(timer); timer = setTimeout(poll, 2500); // show the change as soon as the downloader picks it up
}

/** what this rental is for: its model groups download first, the rest wait as Later (kept for your next rentals) */
export async function setPreset(id: string): Promise<void> {
  const r = await fetch("/studio-api/downloads/preset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preset: id }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "That didn't work — try again in a moment");
  useDownloads.setState({ preset: id });
  clearTimeout(timer); timer = setTimeout(poll, 2500);
}

/** the model groups an Edit engine needs: Krea 2 Edit also uses the Krea 2 model, text encoder and VAE */
/** Krea 2 Edit's models: V2 (the default; V1 is retired and only downloads if you switch Edit → Edit model back to it) */
export function kreaEditGroup(): GroupId {
  let v1 = false; try { v1 = localStorage.getItem(KREA_EDIT_KEY) === "v1"; } catch { /* private mode */ }
  return v1 ? "kedit" : "kedit2";
}
const ENGINE_GROUPS: Record<string, string[]> = { get krea() { return ["image", kreaEditGroup()]; }, anima: ["anime"], noob: ["anime"] } as Record<string, string[]>;
/** the first of an Edit engine's groups that isn't in yet (for the "still downloading" notice), else its main group */
export function editGroup(engine: string): GroupId {
  const need = ENGINE_GROUPS[engine] ?? ENGINE_GROUPS.krea;
  const gs = useDownloads.getState().groups;
  return need.find((id) => { const g = gs.find((x) => x.id === id); return g && g.state !== "done"; }) ?? need[need.length - 1];
}

const fmtLeft = (s: number) => (s < 0 ? "" : s < 60 ? "under a minute" : `about ${Math.ceil(s / 60)} min`);

/** is this group of models here yet? (unknown groups / no download info = ready) */
export function useGroup(id: GroupId | null | undefined) {
  const g = useDownloads((s) => (id ? s.groups.find((x) => x.id === id) : undefined));
  if (!g || g.state === "done") return { ready: true as const, group: g };
  if (g.state === "skipped" || g.state === "later") return { ready: false as const, group: g, why: `${g.label} models are set to download later` };
  const reason = g.error?.split(" — ").slice(1).join(" — ");
  const what = g.state === "error" ? `${g.label} models failed to download${reason ? `: ${reason}` : ""}` : `${g.label} models are still downloading${g.state === "downloading" ? ` — ${g.pct}%` : " (in line)"}${fmtLeft(g.left_s) ? `, ${fmtLeft(g.left_s)}` : ""}`;
  return { ready: false as const, group: g, why: what };
}

/** the 27B writer (~19 GB) only runs at a usable speed when it fits on the card; on 16–24 GB cards it spills onto the CPU and a
 *  prompt takes minutes (and times out) — those use the 9B writer even when the 27B is downloaded */
export const bigWriterFits = () => { const v = useDownloads.getState().gpu?.vram_mb; return !v || v >= 28000; };
