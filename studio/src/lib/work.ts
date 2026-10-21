// Work in progress for this session (references, the timeline). Not remembered across rentals,
// because the files they point to live on this rental only.
import { create } from "zustand";
import type { Media } from "./tray";
import type { Timeline } from "./timeline";
import type { Kind } from "./api";

export interface Ref { id: string; media: Media; label: string; start: number; end: number; useSound: boolean; /** set when the picture is a view of a saved character */ charId?: string }
export const LIMITS: Record<Kind, number> = { image: 9, video: 3, audio: 3 };
const TAGS: Record<Kind, string> = { image: "Picture", video: "Video", audio: "Audio" };

/** <Picture n> / <Video n> / <Audio n>, numbered per kind in list order */
export function tagsFor(refs: Ref[]): Record<string, string> {
  const n: Record<string, number> = {};
  return Object.fromEntries(refs.map((r) => {
    const k = r.media.kind;
    n[k] = (n[k] ?? 0) + 1;
    return [r.id, `<${TAGS[k]} ${n[k]}>`];
  }));
}

let i = 0;
export function makeRef(media: Media): Ref {
  return { id: `r${Date.now()}${i++}`, media, label: media.label || "", start: 0, end: Math.min(media.duration ?? 5, 15), useSound: !!media.has_audio };
}

interface Work {
  promptRefs: Ref[];
  animateRefs: Ref[];
  /** Animate's first / last frame pictures */
  animateFrames: (Media | null)[];
  timeline: Timeline | null;
  textOverride: string | null;
  seen: Record<string, string>;
  /** a first frame handed to Animate from elsewhere (e.g. a character's front view) */
  animateFrame: Media | null;
  /** the plan text last sent to Animate — while Animate still holds it, edits in Plan a video follow it there */
  sentPlan: string | null;
  set: (p: Partial<Omit<Work, "set">>) => void;
}
const KEEP = ["promptRefs", "animateRefs", "animateFrames", "timeline", "textOverride", "seen", "sentPlan"] as const;
// remembered (and mirrored to the rental), so a refresh, the secure link or another tab opens with the same references
const KEY = "h3.work";
function loadWork(): Partial<Work> {
  try { const d = JSON.parse(localStorage.getItem(KEY) || "{}"); return d && typeof d === "object" ? d : {}; } catch { return {}; }
}
export const useWork = create<Work>((set) => ({
  promptRefs: [], animateRefs: [], animateFrames: [null, null], timeline: null, textOverride: null, seen: {}, animateFrame: null, sentPlan: null,
  ...loadWork(),
  set: (p) => set(p),
}));
let saveT: number | undefined;
useWork.subscribe((st) => {
  window.clearTimeout(saveT);
  saveT = window.setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(KEEP.map((k) => [k, st[k]])))); } catch { /* full or private mode */ }
  }, 500);
});

/** Animate's undo (Ctrl+Z outside a text box, or the Undo button): what the box, references, frames and LoRAs were
 *  before a big change (remix, clearing, a removed reference…) */
export interface AnimateState { prompt: string; refs: Ref[]; frames: (Media | null)[]; loras: unknown[] }
export const useAnimateUndo = create<{ stack: AnimateState[]; push: (s: AnimateState) => void; pop: () => AnimateState | undefined }>((set, get) => ({
  stack: [],
  push: (s) => {
    const top = get().stack.at(-1);
    if (top && JSON.stringify(top) === JSON.stringify(s)) return;
    set({ stack: [...get().stack.slice(-29), s] });
  },
  pop: () => { const st = get().stack; const last = st.at(-1); set({ stack: st.slice(0, -1) }); return last; },
}));
