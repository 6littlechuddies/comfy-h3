// Inspiration: CivitAI prompts you save as SCENES (their setting, light, camera and photo finish get borrowed — never
// their person) and your own POSE collections (one pose per item). Batch → Content plan picks from them: every character ×
// scene × pose becomes a row, and the writer turns each into a full Krea 2 prompt with the character's own look.
// Kept with your settings across rentals.
import { create } from "zustand";
import { loadState, saveState } from "./api";
import { cleanPrompt } from "./civitUse";
import { POSES } from "./poses";

export type InspoKind = "scene" | "pose";
export interface InspoItem { id: string; text: string; thumb?: string; /** the full-size picture (for "exact pose") */ url?: string; page?: string; at: number }
export interface InspoSet { id: string; name: string; kind: InspoKind; items: InspoItem[] }

const uid = () => Math.random().toString(36).slice(2, 10);
const STARTER: InspoSet[] = [
  { id: "poses-clothed", name: "Clothed poses (built in)", kind: "pose", items: POSES[0].map((p) => ({ id: p.id, text: p.words, at: 0 })) },
  { id: "poses-relaxed", name: "Relaxed poses (built in)", kind: "pose", items: POSES[1].map((p) => ({ id: p.id, text: p.words, at: 0 })) },
  { id: "poses-bold", name: "Bold poses (built in)", kind: "pose", items: POSES[2].map((p) => ({ id: p.id, text: p.words, at: 0 })) },
  { id: "scenes", name: "Scenes", kind: "scene", items: [] },
];

interface S {
  sets: InspoSet[]; loaded: boolean;
  newSet: (name: string, kind: InspoKind) => string;
  renameSet: (id: string, name: string) => void;
  removeSet: (id: string) => void;
  add: (setId: string, item: Omit<InspoItem, "id" | "at">) => void;
  removeItem: (setId: string, itemId: string) => void;
}
export const useInspo = create<S>((set) => ({
  sets: STARTER, loaded: false,
  newSet: (name, kind) => { const id = uid(); set((s) => ({ sets: [...s.sets, { id, name: name.trim() || (kind === "pose" ? "My poses" : "Scenes"), kind, items: [] }] })); persist(); return id; },
  renameSet: (id, name) => { set((s) => ({ sets: s.sets.map((x) => (x.id === id ? { ...x, name } : x)) })); persist(); },
  removeSet: (id) => { set((s) => ({ sets: s.sets.filter((x) => x.id !== id) })); persist(); },
  add: (setId, item) => {
    const text = cleanPrompt(item.text).trim();
    if (!text) return;
    set((s) => ({ sets: s.sets.map((x) => (x.id !== setId || x.items.some((i) => i.text === text) ? x : { ...x, items: [{ ...item, text, id: uid(), at: Date.now() }, ...x.items] })) }));
    persist();
  },
  removeItem: (setId, itemId) => { set((s) => ({ sets: s.sets.map((x) => (x.id === setId ? { ...x, items: x.items.filter((i) => i.id !== itemId) } : x)) })); persist(); },
}));

let timer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { saveState("inspo", { sets: useInspo.getState().sets }).catch(() => {}); }, 500);
}
loadState<{ sets: InspoSet[] }>("inspo").then((d) => {
  if (d?.sets?.length) useInspo.setState({ sets: d.sets, loaded: true });
  else useInspo.setState({ loaded: true });
}).catch(() => useInspo.setState({ loaded: true }));

/** a collection of this kind to save into: the one you used last, else the first one, else a new one */
export function setFor(kind: InspoKind): string {
  const s = useInspo.getState().sets;
  let last = ""; try { last = localStorage.getItem(`h3.inspo.${kind}`) ?? ""; } catch { /* private mode */ }
  return s.find((x) => x.id === last && x.kind === kind)?.id ?? s.find((x) => x.kind === kind)?.id ?? useInspo.getState().newSet(kind === "pose" ? "My poses" : "Scenes", kind);
}
export function rememberSet(kind: InspoKind, id: string) { try { localStorage.setItem(`h3.inspo.${kind}`, id); } catch { /* private mode */ } }

// ------------------------------------------------------------------ expressions and head angles
// Same-face-itis: one fixed expression and a straight-on head in every picture. Each row of a set gets its own pair,
// spread so no two neighbours repeat.
export const EXPRESSIONS = [
  "laughing with her head tipped back, eyes squeezed half shut", "a slow knowing smirk, one corner of the mouth up", "lips parted, eyes heavy-lidded, looking straight into the lens",
  "biting her lower lip, eyebrows slightly raised", "a big open-mouthed grin, teeth showing, eyes crinkled", "pouting, lips pushed forward, eyes rolled up playfully",
  "serious and intense, jaw set, staring into the camera", "caught mid-laugh, glancing away from the camera", "a soft shy smile, eyes looking down",
  "tongue just touching her upper lip, teasing look", "surprised, mouth open in an O, eyebrows up", "eyes closed, face relaxed, a faint smile",
  "winking at the camera with a crooked smile", "sultry, chin down, looking up through her lashes", "blowing a kiss, lips puckered", "scrunched-nose grin, playful",
];
export const HEAD = [
  "head turned three-quarters to the left", "head turned three-quarters to the right", "in profile, facing left", "chin down, looking up at the camera",
  "head tilted to one side", "chin raised, looking down her nose at the camera", "looking back over her shoulder", "face turned away, eyes cut back to the camera",
  "looking straight into the camera", "head tipped back, eyes toward the ceiling",
];
export function expressionFor(i: number): string {
  return `${EXPRESSIONS[(i * 7) % EXPRESSIONS.length]}, ${HEAD[(i * 3) % HEAD.length]}`;
}
