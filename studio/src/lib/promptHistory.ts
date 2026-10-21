// Every prompt you've tried, kept per tab and project and grouped by the pictures it went with ("folders"): each Generate,
// and the text before and after each right-click rewrite. Nothing is lost when the writer rewrites the box.
import { create } from "zustand";
import type { Tab } from "./jobs";

export interface HistPic { name: string; url: string; label?: string; /** which box it was in ("1", "2", "place") */ slot?: string }
export interface HistEntry { id: string; tab: Tab; project: string | null; text: string; pics: HistPic[]; at: number; why: "sent" | "before a rewrite" | "rewritten" | "replaced" }

const KEY = "h3.prompthist";
const MAX = 400;
const load = (): HistEntry[] => { try { const d = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(d) ? d : []; } catch { return []; } };

/** the pictures a tab is working with right now, and how to put pictures back (each tab registers its own) */
const PICS: Partial<Record<Tab, { get: () => HistPic[]; set?: (pics: HistPic[]) => void }>> = {};
export function registerPics(tab: Tab, get: () => HistPic[], set?: (pics: HistPic[]) => void) { PICS[tab] = { get, set }; }
export const canRestorePics = (tab: Tab) => !!PICS[tab]?.set;
export const restorePics = (tab: Tab, pics: HistPic[]) => PICS[tab]?.set?.(pics);

let projectOf: () => string | null = () => null;
export const setHistoryProject = (f: () => string | null) => { projectOf = f; };

export const groupKey = (pics: HistPic[]) => pics.map((p) => p.name).join("|");

export const usePromptHistory = create<{ list: HistEntry[]; open: Tab | null }>(() => ({ list: load(), open: null }));
usePromptHistory.subscribe((s, p) => { if (s.list !== p.list) try { localStorage.setItem(KEY, JSON.stringify(s.list.slice(0, MAX))); } catch { /* full or private */ } });

/** keep this prompt (skipped when it's empty or the same as the last one kept for these pictures) */
export function remember(tab: Tab, text: string, why: HistEntry["why"] = "sent") {
  const t = text.trim();
  if (t.length < 3) return;
  const pics = PICS[tab]?.get() ?? [];
  const project = projectOf();
  const key = groupKey(pics);
  const list = usePromptHistory.getState().list;
  const last = list.find((e) => e.tab === tab && e.project === project && groupKey(e.pics) === key);
  if (last && last.text.trim() === t) return;
  const e: HistEntry = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, tab, project, text: t, pics, at: Date.now(), why };
  usePromptHistory.setState({ list: [e, ...list].slice(0, MAX) });
}
export const forget = (id: string) => usePromptHistory.setState((s) => ({ list: s.list.filter((e) => e.id !== id) }));
export const currentKey = (tab: Tab) => groupKey(PICS[tab]?.get() ?? []);
export const projectNow = () => projectOf();
