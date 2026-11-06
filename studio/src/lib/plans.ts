// Planned prompts history: every timeline the writer plans (Prompt → Write) is kept, filed under each character in it
// (or the project you were on), with what it was planned from — so a good plan can be found, reused or sent again later.
// Saved with your settings and in exports (so it follows you across rentals).
import { create } from "zustand";
import { loadState, saveState } from "./api";

export interface Plan {
  id: string;
  at: number;
  /** the characters in it (their ids) — empty when no character was in the references */
  chars: string[];
  /** the project you were on when it was planned */
  project: string | null;
  idea: string;
  seconds: number;
  mode: string;
  cuts: number;
  camera: string;
  /** the planned prompt, as it goes to Animate */
  text: string;
  /** when it was last sent to Animate, and how many videos were made from it */
  sent?: number;
  made?: number;
  /** ★: kept at the top, never trimmed */
  fav?: boolean;
  /** your words on it ("great motion, too dark") */
  note?: string;
}

const MAX = 600; // the oldest non-★ plans go past this many
let loaded = false;
export const usePlans = create<{ list: Plan[] }>(() => ({ list: [] }));
loadState<Plan[]>("plans").then((l) => { usePlans.setState({ list: Array.isArray(l) ? l : [] }); loaded = true; }).catch(() => { loaded = true; });

let timer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (!loaded) { setTimeout(persist, 500); return; }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { saveState("plans", usePlans.getState().list).catch(() => {}); }, 400);
}

export function addPlan(p: Omit<Plan, "id" | "at">): Plan {
  const plan: Plan = { ...p, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now() };
  usePlans.setState((s) => {
    let list = [plan, ...s.list];
    if (list.length > MAX) { const keep = list.filter((x) => x.fav); list = [...list.filter((x) => !x.fav).slice(0, Math.max(0, MAX - keep.length)), ...keep].sort((a, b) => b.at - a.at); }
    return { list };
  });
  persist();
  return plan;
}
export function updatePlan(id: string, p: Partial<Plan>) {
  usePlans.setState((s) => ({ list: s.list.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  persist();
}
export function removePlan(id: string) {
  usePlans.setState((s) => ({ list: s.list.filter((x) => x.id !== id) }));
  persist();
}
/** the plans one character is in (or that were planned in their project), newest first, ★ first */
export function plansFor(list: Plan[], charId: string): Plan[] {
  return list.filter((p) => p.chars.includes(charId) || (!p.chars.length && p.project === charId)).sort((a, b) => Number(!!b.fav) - Number(!!a.fav) || b.at - a.at);
}
/** the plan a prompt came from (to count the videos made from it) */
export function planOfText(text: string): Plan | undefined {
  const t = text.trim();
  return t ? usePlans.getState().list.find((p) => p.text.trim() === t) : undefined;
}
