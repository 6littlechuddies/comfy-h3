// The prompt bank: what you actually keep and build on, learned from what you do — never typed by hand.
// Every picture result made from a prompt can earn points: starred, made into a character, used as a cover, animated,
// upscaled, downloaded, used again in Edit/Create… and lose them when deleted. The best-scoring prompts are the examples the
// writer (DeepSeek) follows when it writes new ones (Cosplay first), and every so often it reads the liked and the deleted
// ones side by side and writes down what you value ("taste notes"). Kept with your settings (state "promptbank"), so a new
// rental starts from everything learned so far, not from blank.
import { create } from "zustand";
import { loadState, saveState, type FileRef } from "./api";
import { madeBy } from "./made";

export interface BankEntry {
  k: string;               // the result's file
  at: number;              // first seen
  prompt: string;
  negative?: string;
  model?: string;
  loras?: { name: string; strength: number }[];
  size?: string;
  kind: string;            // create / batch / edit / …
  who?: string;            // the character (project) it was for
  score: number;
  sig: Record<string, number>; // signal → times
}
interface Taste { notes: string; at: number; basis: number; v?: number }
/** bump when the notes' instructions change, so old notes are written again */
const TASTE_V = 2;
interface Bank { entries: Record<string, BankEntry>; taste: Taste | null; signals: number }

/** how much each thing you do says about a picture (and so about its prompt) */
export const WEIGHTS: Record<string, number> = {
  star: 3, unstar: -3, character: 5, cover: 3, animate: 2, loop: 2, upscale: 2, download: 2, reuse: 1, sfw: 1, site: 3, delete: -4,
};
// Picture menu actions → signals
const MENU: Record<string, string> = { newc: "character", cover: "cover", an: "animate", loop: "loop", "4k": "upscale", up2: "upscale", upq: "upscale",
  save: "download", del: "delete", e1: "reuse", e2: "reuse", cr: "reuse", with: "reuse", faceon: "reuse", face: "reuse", facec: "reuse", sfw: "sfw", green: "reuse", cut: "reuse" };

const key = (f: { subfolder?: string; filename: string }) => `${f.subfolder ?? ""}/${f.filename}`;
const MAX = 400;

export const useBank = create<Bank & { loaded: boolean }>(() => ({ entries: {}, taste: null, signals: 0, loaded: false }));
let loading: Promise<void> | null = null;
export function loadBank(): Promise<void> {
  return (loading ??= loadState<Bank>("promptbank").then((b) => { useBank.setState({ ...(b ?? { entries: {}, taste: null, signals: 0 }), loaded: true }); }).catch(() => { useBank.setState({ loaded: true }); }));
}
if (typeof window !== "undefined") void loadBank().then(() => setTimeout(backfill, 8000));

/** the first time: learn from what you already starred and made characters from (as far as this browser still has
 *  their jobs — How it was made), so it doesn't start from nothing */
async function backfill() {
  if (useBank.getState().signals > 0 || Object.keys(useBank.getState().entries).length) return;
  try {
    const { loadState: ls } = await import("./api");
    const favs = (await ls<Record<string, true>>("favorites")) ?? {};
    for (const k of Object.keys(favs)) {
      const m = /^(output)\/(.*)\/([^/]+)$/.exec(k);
      if (m) record(`${m[2]}/${m[3]}`, madeBy({ type: "output", subfolder: m[2], filename: m[3] })?.j, "star");
    }
    const origins: Record<string, string> = JSON.parse(localStorage.getItem("h3.origins") || "{}");
    for (const v of new Set(Object.values(origins))) {
      const i = v.lastIndexOf("/");
      record(v, madeBy({ type: "output", subfolder: v.slice(0, i), filename: v.slice(i + 1) })?.j, "character");
    }
  } catch { /* nothing to learn from yet */ }
}
let timer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => { const { entries, taste, signals } = useBank.getState(); saveState("promptbank", { entries, taste, signals }).catch(() => {}); }, 800);
}

type Sent = { prompt?: string; words?: string; negative?: string; model?: string; loras?: { name: string; strength: number }[]; size?: string } | null;
type JobLike = { tab?: string; meta?: Record<string, unknown> } | undefined;

function record(k: string, j: JobLike, what: string) {
  const st = useBank.getState();
  const had = st.entries[k];
  const sent = (j?.meta?.sent ?? null) as Sent;
  const prompt = (sent?.words || sent?.prompt || had?.prompt || "").trim();
  if (!prompt || prompt.length < 30) return; // not a prompt-made picture (an upscale, a cut-out…)
  const e: BankEntry = had ? { ...had } : { k, at: Date.now(), prompt, negative: sent?.negative, model: sent?.model, loras: sent?.loras, size: sent?.size,
    kind: String(j?.meta?.kind ?? j?.tab ?? ""), who: (j?.meta?.project as string | undefined) ?? undefined, score: 0, sig: {} };
  e.sig = { ...e.sig, [what]: (e.sig[what] ?? 0) + 1 };
  // repeats count less (the 5th download says less than the 1st)
  e.score = Object.entries(e.sig).reduce((sum, [w, n]) => sum + (WEIGHTS[w] ?? 0) * (1 + Math.log2(Math.max(1, n)) * 0.3), 0);
  let entries = { ...st.entries, [k]: e };
  const all = Object.values(entries);
  if (all.length > MAX) { // keep the strongest (and the most recent) — liked and disliked both teach
    const keep = new Set(all.sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || b.at - a.at).slice(0, MAX).map((x) => x.k));
    entries = Object.fromEntries(Object.entries(entries).filter(([kk]) => keep.has(kk)));
  }
  useBank.setState({ entries, signals: st.signals + 1 });
  persist();
}

/** something you did with a result: find its prompt (How it was made) and score it */
export async function signal(f: FileRef | null | undefined, what: string) {
  if (!f || f.type !== "output" || !(what in WEIGHTS)) return;
  await loadBank();
  record(key(f), madeBy(f)?.j, what);
}
export const menuSignal = (menuKey: string, f: FileRef | null | undefined) => { const s = MENU[menuKey]; if (s) void signal(f, s); };

/** the best examples for a new prompt: highest score, the same character first, no near-duplicates */
export function examples(n = 3, who?: string | null): BankEntry[] {
  const liked = Object.values(useBank.getState().entries).filter((e) => e.score >= 3).sort((a, b) =>
    Number(!!who && b.who === who) - Number(!!who && a.who === who) || b.score - a.score || b.at - a.at);
  const out: BankEntry[] = [];
  for (const e of liked) { if (!out.some((o) => o.prompt.slice(0, 80) === e.prompt.slice(0, 80))) out.push(e); if (out.length >= n) break; }
  return out;
}
const disliked = (n: number) => Object.values(useBank.getState().entries).filter((e) => e.score < 0).sort((a, b) => a.score - b.score).slice(0, n);

/** the taste notes, written again by the writer once enough has changed (8 new signals, 6+ liked prompts) */
export async function tasteNotes(): Promise<string> {
  await loadBank();
  const st = useBank.getState();
  const liked = examples(12);
  if (liked.length < 6) return st.taste?.notes ?? "";
  if (st.taste && st.taste.v === TASTE_V && st.signals - st.taste.basis < 8) return st.taste.notes;
  try {
    const { runWriter } = await import("./writer");
    const fmt = (e: BankEntry) => `- (${e.score.toFixed(1)}; ${Object.keys(e.sig).join(", ")}) ${e.prompt.slice(0, 900)}`;
    const raw = await runWriter("taste", { liked: liked.map(fmt).join("\n"), disliked: disliked(8).map(fmt).join("\n") || "(none yet)" }, { tab: "batch", label: "Learning what you like", big: true });
    const notes = raw.replace(/^```\w*|```$/g, "").trim().slice(0, 2000);
    if (notes) { useBank.setState({ taste: { notes, at: Date.now(), basis: st.signals, v: TASTE_V } }); persist(); return notes; }
  } catch { /* keep the old notes */ }
  return st.taste?.v === TASTE_V ? st.taste.notes : "";
}

/** everything the writer gets about your taste, as one block */
export async function tasteBlock(who?: string | null): Promise<string> {
  const notes = await tasteNotes();
  const ex = examples(3, who);
  if (!notes && !ex.length) return "(nothing learned yet)";
  return [notes && `HOW THEY LIKE PROMPTS WRITTEN (learned from what they starred, used and deleted — wording only, never a reason to repeat a pose or background):\n${notes}`,
    ex.length && `PROMPTS OF PICTURES THEY KEPT AND BUILT ON (follow only how they are WORDED — structure, length, how camera, light and realism are written; never copy their person, outfit, pose, camera angle, background or setting):\n${ex.map((e, i) => `${i + 1}. ${e.prompt.slice(0, 1200)}`).join("\n")}`].filter(Boolean).join("\n\n");
}

// deleting a result is a signal too: watch outputs disappear from the jobs list (the job's own record says how it was made)
void import("./jobs").then(({ useJobs }) => useJobs.subscribe((s, prev) => {
  if (s.jobs === prev.jobs || !useBank.getState().loaded) return;
  const now = new Map(s.jobs.map((j) => [j.id, j]));
  for (const pj of prev.jobs) {
    const nj = now.get(pj.id);
    if (!nj) continue; // a whole job dropped off the list (old ones are trimmed): not a judgement
    for (const o of pj.outputs) if (o.type === "output" && !nj.outputs.some((x) => x.filename === o.filename && x.subfolder === o.subfolder)) record(key(o), pj, "delete");
  }
}));
