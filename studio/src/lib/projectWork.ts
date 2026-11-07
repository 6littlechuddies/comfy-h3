// Each project (character on the left) keeps its own Animate and Plan a video workspace: the prompt, the Avoid words,
// the starting / last pictures, the references and the planned timeline. Switching projects puts the one you're
// leaving away and brings back the one you open (empty the first time) — the prompt and pictures of one character no
// longer carry over to the next. Video type, length, size, LoRAs and Advanced stay shared. Kept in browser storage,
// mirrored to the rental like the rest of "where I was".
import { useCharacters } from "./characters";
import { useSettings } from "./settings";
import { useWork } from "./work";

const WORK_KEYS = ["promptRefs", "animateRefs", "animateFrames", "timeline", "textOverride", "seen", "sentPlan"] as const;
type Snap = { animate: { prompt: string; avoid?: string }; prompt: { idea: string; avoid?: string }; work: Record<string, unknown> };
const keyOf = (id: string | null) => `h3.proj.${id ?? "free"}`;

function snap(): Snap {
  const s = useSettings.getState().s;
  const w = useWork.getState();
  return {
    animate: { prompt: s.animate.prompt, avoid: s.animate.avoid },
    prompt: { idea: s.prompt.idea, avoid: s.prompt.avoid },
    work: Object.fromEntries(WORK_KEYS.map((k) => [k, w[k]])),
  };
}
function save(id: string | null) {
  try { localStorage.setItem(keyOf(id), JSON.stringify(snap())); } catch { /* full or private mode */ }
}
function load(id: string | null) {
  let d: Snap | null = null;
  try { d = JSON.parse(localStorage.getItem(keyOf(id)) || "null"); } catch { d = null; }
  const st = useSettings.getState();
  st.set("animate", { prompt: d?.animate.prompt ?? "", avoid: d?.animate.avoid ?? "" });
  st.set("prompt", { idea: d?.prompt.idea ?? "", avoid: d?.prompt.avoid ?? "" });
  useWork.getState().set({
    promptRefs: [], animateRefs: [], animateFrames: [null, null], timeline: null, textOverride: null, seen: {}, sentPlan: null,
    ...((d?.work ?? {}) as object),
  });
}

let current: string | null | undefined; // undefined = not started (the first project shown keeps what's on screen)
let started = false;
export function startProjectWork() {
  if (started) return; started = true;
  const begin = () => { current = useCharacters.getState().sel; };
  if (useCharacters.getState().loaded) begin();
  useCharacters.subscribe((s, prev) => {
    if (current === undefined) { if (s.loaded) begin(); return; }
    if (s.sel === prev.sel || s.sel === current) return;
    save(current);       // the project you're leaving: put away as it is
    current = s.sel;
    load(current);       // the one you opened: as you left it (empty the first time)
  });
}
