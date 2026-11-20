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
interface RawItem { id: string; en?: string; lineEn?: string; cat?: string; catEn?: string; line?: string; a?: number; angles?: RawAngle[]; t?: string; m?: string; i?: string }
export interface PwAngle { en: string; thumb: string; image: string }
export interface PwItem { key: string; lib: PwLib; id: string; title: string; words: string; group: string; adult: boolean; angles?: PwAngle[]; thumb?: string; image?: string }

/** something picked: a pose at one angle, or an outfit / face */
export interface PwPick { key: string; lib: PwLib; title: string; words: string; thumb: string; image: string; depth: boolean }

const abs = (base: string, u?: string) => (!u ? "" : /^https?:\/\//.test(u) ? u : base.replace(/\/?$/, "/") + u.replace(/^\//, ""));
const LINE_EN: Record<string, string> = { "全身·性感": "Full body · sexy", "全身·标准": "Full body", "上半身": "Upper body", "双人互动": "Two people" };

const cache: Partial<Record<PwLib, Promise<PwItem[]>>> = {};
export function loadLib(lib: PwLib): Promise<PwItem[]> {
  return (cache[lib] ??= fetch(`/studio-api/posewear/${lib}`).then(async (r) => {
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || `PoseWear answered ${r.status}`);
    const base: string = d.base;
    const raw: RawItem[] = Array.isArray(d.data) ? d.data : d.data?.items ?? [];
    return raw.map((it): PwItem => {
      const key = `${lib}:${it.id}`;
      if (it.angles) {
        const group = LINE_EN[it.line ?? ""] ?? it.lineEn ?? "";
        return { key, lib, id: it.id, title: it.en ?? it.id, words: [it.en, it.lineEn].filter(Boolean).join(", "), group, adult: !!it.a,
          angles: it.angles.map((a) => ({ en: a.en, thumb: abs(base, a.t), image: abs(base, a.i) })) };
      }
      return { key, lib, id: it.id, title: (it.en ?? it.id).split(",").slice(0, 3).join(","), words: it.en ?? "", group: it.catEn ?? "", adult: !!it.a, thumb: abs(base, it.t), image: abs(base, it.i || it.m) };
    });
  }).catch((e) => { delete cache[lib]; throw e; }));
}

/** one item at one angle → a pick */
export function pickOf(it: PwItem, angle = 0): PwPick {
  const a = it.angles?.[angle];
  return a
    ? { key: `${it.key}#${angle}`, lib: it.lib, title: `${it.title} · ${a.en}`, words: `${it.words}, ${a.en}`, thumb: a.thumb, image: a.image, depth: it.lib === "depths" }
    : { key: it.key, lib: it.lib, title: it.title, words: it.words, thumb: it.thumb ?? "", image: it.image ?? "", depth: false };
}
export const isPose = (p: PwPick) => p.lib === "poses" || p.lib === "depths";

const KEY = "h3.posewear";
interface PwState { picks: PwPick[]; strength: number; adult: boolean; who: string; /** Create's depth pose (one) */ create: PwPick | null }
const saved = (): Partial<PwState> => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
export const usePoseWear = create<PwState & { set: (p: Partial<PwState>) => void; toggle: (p: PwPick) => void }>((set, get) => ({
  picks: [], strength: 0.75, adult: false, who: "", create: null, ...saved(),
  set: (p) => { set(p); persist(); },
  toggle: (p) => { const has = get().picks.some((x) => x.key === p.key); set({ picks: has ? get().picks.filter((x) => x.key !== p.key) : [...get().picks, p] }); persist(); },
}));
function persist() { try { const { picks, strength, adult, who, create } = usePoseWear.getState(); localStorage.setItem(KEY, JSON.stringify({ picks, strength, adult, who, create })); } catch { /* */ } }
export const posePicks = () => usePoseWear.getState().picks.filter(isPose);
export const wearPicks = () => usePoseWear.getState().picks.filter((p) => p.lib === "costumes" || p.lib === "anime");
export const facePicks = () => usePoseWear.getState().picks.filter((p) => p.lib === "portraits");

/** the depth-control settings for a row: the pose's picture saved on the rental (fetched once) */
const fetched = new Map<string, Promise<string>>();
export function controlFor(p: PwPick, strength = usePoseWear.getState().strength): Promise<{ image: string; strength: number; estimate: boolean }> {
  let f = fetched.get(p.image);
  if (!f) {
    f = fetch("/studio-api/fetch-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: p.image }) })
      .then(async (r) => { if (!r.ok) throw new Error(`Couldn't get the pose picture (${(await r.text()).slice(0, 120)})`); return (await r.json()).name as string; });
    f.catch(() => fetched.delete(p.image));
    fetched.set(p.image, f);
  }
  return f.then((image) => ({ image, strength, estimate: !p.depth }));
}

/** Batch → Poses: one row per pose (× each picked outfit), the pose copied through its depth */
export async function posesToBatch(onStep?: (m: string) => void): Promise<number> {
  const { useBatch } = await import("./batch");
  const st = usePoseWear.getState();
  const poses = posePicks().filter((p) => !/two people|couple/i.test(p.words)); // one person per picture
  if (!poses.length) throw new Error("Pick some poses first (Browse PoseWear)");
  const wears: (PwPick | null)[] = wearPicks().length ? wearPicks() : [null];
  const face = facePicks()[0];
  const who = st.who.trim() || (face ? `an adult woman, ${face.words.replace(/^young /i, "")}` : "an adult woman in her twenties");
  let n = 0;
  for (const p of poses) {
    onStep?.(`Getting pose ${n + 1}…`);
    const control = await controlFor(p);
    for (const w of wears) {
      const prompt = `A realistic photo of ${who}${w ? `, wearing ${w.words}` : ""}. Pose: ${p.words}. Natural skin texture, real fabric, professional photo lighting.`;
      useBatch.getState().add({ prompt, idea: `Pose · ${p.title}${w ? ` · ${w.title}` : ""}`, takes: 1, realistic: true, control, status: "ready" });
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
