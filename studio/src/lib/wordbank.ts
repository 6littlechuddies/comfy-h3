// The word bank: every CivitAI picture you open (pasted link, collection, LoRA gallery) leaves its prompt here, cut
// into short clickable words and phrases sorted by what they describe (looks, outfit, pose, place, light, camera…).
// One bank for all projects, kept with your settings across rentals. Create shows it next to the prompt box.
import { create } from "zustand";
import { loadState, saveState, type CivitGen } from "./api";
import { cleanPrompt } from "./civitUse";
import { categorize, toPieces, type PieceCat } from "./tweak";

export interface BankTerm { t: string; cat: PieceCat }
export interface BankRef { id: string; at: number; thumb: string; page?: string; prompt: string; base?: string; terms: BankTerm[] }
interface Bank { refs: BankRef[]; mine: BankTerm[]; hidden: string[] }
const MAX_REFS = 400;

/** "(long hair:1.2)" → "long hair"; "((smile))" → "smile"; drops LoRA tags, trailing commas and full stops */
function tidy(t: string): string {
  let s = t.replace(/<[^>]+>/g, " ").replace(/\\([()])/g, "$1").trim();
  for (let i = 0; i < 3; i++) s = s.replace(/^[([{]+(.*?)(?::\s*-?\d*\.?\d+)?[)\]}]+$/, "$1").trim();
  s = s.replace(/:\s*-?\d*\.?\d+\s*$/, "").replace(/[()[\]{}]/g, "").replace(/\s+/g, " ");
  return s.replace(/^[,.;:\s]+|[,.;:\s]+$/g, "").trim();
}

/** a prompt cut into bank words: tag prompts by comma; sentence prompts by sentence, then long ones by comma */
export function termsOf(prompt: string): BankTerm[] {
  const out: BankTerm[] = []; const seen = new Set<string>();
  const push = (raw: string) => {
    const t = tidy(raw);
    const words = t.split(/\s+/).length;
    if (!t || t.length < 2 || words > 22 || /^(score_\d|source_|rating_)/i.test(t)) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return; seen.add(k);
    const cat = categorize(t);
    if (cat !== "lora") out.push({ t, cat });
  };
  for (const p of toPieces(cleanPrompt(prompt))) {
    const t = p.text;
    if (t.split(/\s+/).length > 12) {
      const bits = t.split(/,(?![^()]*\))/).map((x) => x.trim()).filter(Boolean);
      if (bits.length > 1) { bits.forEach(push); continue; }
    }
    push(t);
  }
  return out;
}

export const useWordBank = create<Bank & {
  loaded: boolean;
  add: (gen: CivitGen) => void;
  addPrompt: (id: string, prompt: string, thumb: string) => void;
  remove: (id: string) => void;
  addMine: (t: string) => void;
  hide: (t: string) => void;
  clearHidden: () => void;
}>((set, get) => ({
  refs: [], mine: [], hidden: [], loaded: false,
  add: (gen) => {
    const prompt = cleanPrompt(gen.prompt || gen.workflow?.prompt || "");
    if (!prompt || gen.local) return;
    const id = gen.id ? `civitai:${gen.id}` : `p:${prompt.slice(0, 80)}`;
    const terms = termsOf(prompt);
    if (!terms.length) return;
    const ref: BankRef = { id, at: Date.now(), thumb: gen.thumb || gen.url || "", page: gen.page || undefined, prompt, base: gen.base || undefined, terms };
    set((s) => ({ refs: [ref, ...s.refs.filter((r) => r.id !== id)].slice(0, MAX_REFS) }));
    persist();
  },
  addPrompt: (id, prompt, thumb) => {
    const terms = termsOf(prompt);
    if (!terms.length) return;
    const ref: BankRef = { id, at: Date.now(), thumb, prompt, base: "Read from a picture", terms };
    set((s) => ({ refs: [ref, ...s.refs.filter((r) => r.id !== id)].slice(0, MAX_REFS) }));
    persist();
  },
  remove: (id) => { set((s) => ({ refs: s.refs.filter((r) => r.id !== id) })); persist(); },
  addMine: (raw) => {
    const t = tidy(raw); if (!t) return;
    if (get().mine.some((x) => x.t.toLowerCase() === t.toLowerCase())) return;
    set((s) => ({ mine: [{ t, cat: categorize(t) }, ...s.mine], hidden: s.hidden.filter((h) => h !== t.toLowerCase()) })); persist();
  },
  hide: (t) => {
    const k = t.toLowerCase();
    set((s) => ({ hidden: [...new Set([...s.hidden, k])], mine: s.mine.filter((x) => x.t.toLowerCase() !== k) })); persist();
  },
  clearHidden: () => { set({ hidden: [] }); persist(); },
}));

let timer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { const { refs, mine, hidden } = useWordBank.getState(); saveState("wordbank", { refs, mine, hidden }).catch(() => {}); }, 600);
}
loadState<Bank>("wordbank").then((b) => {
  const cur = useWordBank.getState();
  // anything added before the saved bank arrived stays on top
  const refs = [...cur.refs, ...(b?.refs ?? []).filter((r) => !cur.refs.some((x) => x.id === r.id))].slice(0, MAX_REFS);
  useWordBank.setState({ refs, mine: b?.mine ?? cur.mine, hidden: b?.hidden ?? cur.hidden, loaded: true });
}).catch(() => useWordBank.setState({ loaded: true }));

/** every word across the bank, with how many pictures used it (yours first, then most used) */
export function allTerms(b: Bank): (BankTerm & { n: number; mine?: boolean })[] {
  const m = new Map<string, BankTerm & { n: number; mine?: boolean }>();
  for (const x of b.mine) m.set(x.t.toLowerCase(), { ...x, n: 0, mine: true });
  for (const r of b.refs) for (const x of r.terms) {
    const k = x.t.toLowerCase();
    const cur = m.get(k);
    if (cur) cur.n++; else m.set(k, { ...x, n: 1 });
  }
  const hidden = new Set(b.hidden);
  return [...m.entries()].filter(([k]) => !hidden.has(k)).map(([, v]) => v)
    .sort((a, b2) => Number(!!b2.mine) - Number(!!a.mine) || b2.n - a.n || a.t.length - b2.t.length);
}

/** is this word already in the prompt? (whole words, any case) */
export function hasTerm(prompt: string, t: string): boolean {
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w])${esc}($|[^\\w])`, "i").test(prompt);
}
/** add the word at the end (comma-separated), or take it out if it's there */
export function toggleTerm(prompt: string, t: string): string {
  if (hasTerm(prompt, t)) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // as its own comma piece first; inside a sentence, just the words
    const a = prompt.replace(new RegExp(`(^|,\\s*)${esc}(?=\\s*(,|$))`, "i"), "").replace(/^\s*,\s*/, "").replace(/,\s*,/g, ",").trim();
    if (a !== prompt.trim()) return a;
    return prompt.replace(new RegExp(`\\s*${esc}`, "i"), "").replace(/\s{2,}/g, " ").replace(/^\s*,\s*/, "").trim();
  }
  const p = prompt.trim();
  return p ? `${p.replace(/[,\s]+$/, "")}, ${t}` : t;
}
