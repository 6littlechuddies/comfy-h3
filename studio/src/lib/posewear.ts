// PoseWear (posewear.pages.dev — MIT index of @giaaibusi's pose, depth-pose and outfit galleries, CC0 portraits):
// browse them in the Studio, tick many, and use them in Batch (Cosplay or Poses) or Create.
// A pose is recreated with its words AND its picture: Krea 2's depth control follows the picture's depth (a depth map
// as given, or one worked out from a pose picture), the words say the rest.
import { create } from "zustand";

export type PwLib = "poses" | "depths" | "costumes" | "anime" | "portraits";
export const LIBS: { id: PwLib; label: string; note: string }[] = [
  { id: "depths", label: "Depth poses", note: "Depth maps: Krea 2 copies the body position exactly" },
  { id: "poses", label: "Poses", note: "Pose pictures: their depth is worked out, then copied" },
  { id: "costumes", label: "Outfits", note: "Outfit words, added to each picture" },
  { id: "anime", label: "Anime outfits", note: "Anime-style outfit words" },
  { id: "portraits", label: "Faces", note: "Face and hair descriptions" },
];

interface RawAngle { en: string; t: string; i: string }
interface RawItem { id: string; no?: string; en?: string; lineEn?: string; cat?: string; catEn?: string; line?: string; a?: number; angles?: RawAngle[]; t?: string; m?: string; i?: string }
export interface PwAngle { en: string; thumb: string; image: string }
export interface PwItem { key: string; lib: PwLib; id: string; no?: string; title: string; words: string; group: string; cat: string; adult: boolean; couple: boolean; angles?: PwAngle[]; thumb?: string; image?: string }

/** something picked: a pose at one angle, or an outfit / face */
export interface PwPick { key: string; lib: PwLib; title: string; words: string; thumb: string; image: string; depth: boolean; /** a two-person pose (18+): a man and a woman */ couple?: boolean; cat?: string }

const abs = (base: string, u?: string) => (!u ? "" : /^https?:\/\//.test(u) ? u : base.replace(/\/?$/, "/") + u.replace(/^\//, ""));
const LINE_EN: Record<string, string> = { "全身·性感": "Full body · sexy", "全身·标准": "Full body", "上半身": "Upper body", "双人互动": "Two people" };
/** PoseWear's pose categories (Chinese on the site) in English */
const CAT_EN: Record<string, string> = { "躺卧": "Lying down", "性感·大胆": "Sexy · bold", "站姿": "Standing", "坐姿": "Sitting", "可爱": "Cute", "挤胸·乳沟": "Cleavage", "跪立·趴姿": "Kneeling · all fours",
  "特殊": "Special", "正面位": "Missionary", "跪立": "Kneeling", "侧坐·鸭子坐": "Side-sitting", "后入位": "From behind", "背面坐位": "Reverse sitting", "蹲姿": "Squatting", "前倾": "Leaning forward",
  "贴脸": "Faces close", "骑乘位": "On top", "立位": "Standing together", "立位贴身": "Standing, pressed close", "后仰": "Arching back", "扭身": "Twisting", "侧位": "Side by side (lying)", "坐位": "Seated together",
  "对面坐位": "Facing, seated", "坐位贴身": "Seated, pressed close", "贴身": "Pressed close" };
const catEn = (c?: string) => (c ? CAT_EN[c] ?? c : "");

const cache: Partial<Record<PwLib, Promise<PwItem[]>>> = {};
export function loadLib(lib: PwLib): Promise<PwItem[]> {
  return (cache[lib] ??= fetch(`/studio-api/posewear/${lib}`).then(async (r) => {
    const txt = await r.text();
    let d: { base: string; data: unknown; error?: string };
    try { d = JSON.parse(txt); } catch { throw new Error(r.status === 404 ? "This rental's code is older than the PoseWear browser — restart the rental (or make a new one) to update it" : `PoseWear list failed (${r.status}): ${txt.slice(0, 120)}`); }
    if (!r.ok || d.error) throw new Error(d.error || `PoseWear answered ${r.status}`);
    const base: string = d.base;
    const raw: RawItem[] = Array.isArray(d.data) ? d.data : (d.data as { items?: RawItem[] })?.items ?? [];
    return raw.map((it): PwItem => {
      const key = `${lib}:${it.id}`;
      if (it.angles) {
        const group = LINE_EN[it.line ?? ""] ?? it.lineEn ?? "";
        const couple = /two people|couple/i.test(it.lineEn ?? "") || it.line === "双人互动";
        return { key, lib, id: it.id, no: it.no, title: it.en ?? it.id, words: [it.en, it.lineEn].filter(Boolean).join(", "), group, cat: catEn(it.cat), adult: !!it.a || couple, couple,
          angles: it.angles.map((a) => ({ en: a.en, thumb: abs(base, a.t), image: abs(base, a.i) })) };
      }
      return { key, lib, id: it.id, title: (it.en ?? it.id).split(",").slice(0, 3).join(","), words: it.en ?? "", group: it.catEn ? it.catEn[0].toUpperCase() + it.catEn.slice(1) : "", cat: "", adult: !!it.a, couple: false, thumb: abs(base, it.t), image: abs(base, it.i || it.m) };
    });
  }).catch((e) => { delete cache[lib]; throw e; }));
}

/** one item at one angle → a pick */
export function pickOf(it: PwItem, angle = 0): PwPick {
  const a = it.angles?.[angle];
  return a
    ? { key: `${it.key}#${angle}`, lib: it.lib, title: `${it.title} · ${a.en}`, words: `${it.words}, ${a.en}`, thumb: a.thumb, image: a.image, depth: it.lib === "depths", couple: it.couple, cat: it.cat || it.group }
    : { key: it.key, lib: it.lib, title: it.title, words: it.words, thumb: it.thumb ?? "", image: it.image ?? "", depth: false };
}
export const isPose = (p: PwPick) => p.lib === "poses" || p.lib === "depths";

const KEY = "h3.posewear";
interface PwState { picks: PwPick[]; strength: number; adult: boolean; who: string; /** Create's depth pose (one) */ create: PwPick | null;
  /** your stars and your hidden ones (by item, all angles) */ favs: Record<string, true>; hidden: Record<string, true> }
const saved = (): Partial<PwState> => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
export const usePoseWear = create<PwState & { set: (p: Partial<PwState>) => void; toggle: (p: PwPick) => void }>((set, get) => ({
  picks: [], strength: 0.75, adult: false, who: "", create: null, favs: {}, hidden: {}, ...saved(),
  set: (p) => { set(p); persist(); },
  toggle: (p) => { const has = get().picks.some((x) => x.key === p.key); set({ picks: has ? get().picks.filter((x) => x.key !== p.key) : [...get().picks, p] }); persist(); },
}));
function persist() { try { const { picks, strength, adult, who, create, favs, hidden } = usePoseWear.getState(); localStorage.setItem(KEY, JSON.stringify({ picks, strength, adult, who, create, favs, hidden })); } catch { /* */ } }
export const posePicks = () => usePoseWear.getState().picks.filter(isPose);
export const wearPicks = () => usePoseWear.getState().picks.filter((p) => p.lib === "costumes" || p.lib === "anime");
export const facePicks = () => usePoseWear.getState().picks.filter((p) => p.lib === "portraits");

/** the depth-control settings for a row: the pose's picture saved on the rental (fetched once) */
const fetched = new Map<string, Promise<string>>();
export function controlFor(p: PwPick, strength = usePoseWear.getState().strength): Promise<{ image: string; strength: number; estimate: boolean }> {
  let f = fetched.get(p.image);
  if (!f) {
    if (p.image.startsWith("/studio-api/civitai/") || /civitai\.(?:com|red|green)/i.test(p.image)) {
      const cid = /^civitai:(\d+)/.exec(p.key)?.[1] ?? /[?&]id=(\d+)/.exec(p.image)?.[1];
      f = import("./api").then(({ civitFetchMedia }) => civitFetchMedia(p.image, cid ? Number(cid) : 0)).then((r) => r.name);
    } else {
      f = fetch("/studio-api/fetch-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: p.image }) })
        .then(async (r) => { if (!r.ok) throw new Error(`Couldn't get the pose picture (${(await r.text()).slice(0, 120)})`); return (await r.json()).name as string; });
    }
    f.catch(() => fetched.delete(p.image));
    fetched.set(p.image, f);
  }
  return f.then((image) => ({ image, strength, estimate: !p.depth }));
}

/** Batch → Poses: one row per pose (× each picked outfit), the pose copied through its depth. Two-person poses (18+ on)
 *  become a man and a woman, both adults; each row is labelled with the pose's category (so the results sort by it) */
export async function posesToBatch(onStep?: (m: string) => void): Promise<number> {
  const { useBatch, newGroup } = await import("./batch");
  const st = usePoseWear.getState();
  const poses = posePicks().filter((p) => st.adult || !p.couple);
  if (!poses.length) throw new Error("Pick some poses first (Browse PoseWear)");
  const wears: (PwPick | null)[] = wearPicks().length ? wearPicks() : [null];
  const face = facePicks()[0];
  const who = st.who.trim() || (face ? `an adult woman, about 25, ${face.words.replace(/^young /i, "")}` : "an adult woman, about 25 years old");
  const group = newGroup("Poses");
  let n = 0;
  for (const p of poses) {
    onStep?.(`Getting pose ${n + 1}…`);
    const control = await controlFor(p);
    for (const w of wears) {
      const people = p.couple ? `${who} and an adult man, about 30, together` : who;
      const prompt = `A realistic photo of ${people}${w ? `; she is wearing ${w.words}` : ""}. Pose: ${p.words}. Natural skin texture, real fabric, professional photo lighting.${p.couple ? " Both are adults." : ""}`;
      useBatch.getState().add({ prompt, idea: `Pose · ${p.cat ? `${p.cat} · ` : ""}${p.title}${w ? ` · ${w.title}` : ""}`, takes: 1, realistic: true, control, status: "ready", group, pose: p });
      n++;
    }
  }
  return n;
}

/** the depth-pose models (Krea 2 depth control, ~0.9 GB) are on the rental — or start them and say so */
export async function depthReady() {
  const { useDownloads, setLater, refreshDownloads } = await import("./downloads");
  const g = useDownloads.getState().groups.find((x) => x.id === "kdepth");
  if (!g || g.state === "done") return;
  if (g.state === "later" || g.state === "skipped") { await setLater("kdepth", false); refreshDownloads(); }
  throw new Error(`The depth-pose models are downloading (${g.state === "downloading" ? `${Math.round(g.pct)}%` : "starting"}, ~0.9 GB) — try again when they're in`);
}

/** "Copy its motion exactly": the H3 depth-control patch (and the depth model from Depth poses) are on the rental — or start them */
export async function motionReady() {
  // ComfyUI's own H3 Fun ControlNet node (added to ComfyUI with H3's control support): an older ComfyUI on the rental lacks it
  const has = await fetch("/object_info/MiniMaxH3FunControlNetApply").then((r) => (r.ok ? r.json() : {})).then((b: Record<string, unknown>) => !!b?.MiniMaxH3FunControlNetApply).catch(() => true);
  if (!has) throw new Error("This rental's ComfyUI is too old for copying motion (no “Apply MiniMax H3 Fun ControlNet” node) — make a new rental from the latest image");
  const vda = await fetch("/object_info/VideoDepthAnythingProcess").then((r) => (r.ok ? r.json() : {})).then((b: Record<string, unknown>) => !!b?.VideoDepthAnythingProcess).catch(() => true);
  if (!vda) throw new Error("The Video Depth Anything nodes aren't on this rental yet — Reboot the instance (they install at start-up) and try again");
  const { useDownloads, setLater, refreshDownloads } = await import("./downloads");
  const missing = ["hmotion"].map((id) => useDownloads.getState().groups.find((x) => x.id === id)).filter((g) => g && g.state !== "done");
  if (!missing.length) return;
  for (const g of missing) if (g!.state === "later" || g!.state === "skipped") await setLater(g!.id, false);
  refreshDownloads();
  throw new Error(`The motion-copy models are downloading (${missing.map((g) => `${g!.label}${g!.state === "downloading" ? ` ${Math.round(g!.pct)}%` : ""}`).join(", ")}) — try again when they're in`);
}
