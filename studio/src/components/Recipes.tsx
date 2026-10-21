import { useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import type { Tab } from "../lib/jobs";
import { TEMPLATES, useSettings } from "../lib/settings";
import { Btn, Icon } from "./ui";

interface Guide { tab: Tab; title: string; steps: string[] }
export const useGuide = create<{ g: Guide | null }>(() => ({ g: null }));

export interface Recipe { id: string; title: string; blurb: string; apply: () => Guide }
const S = () => useSettings.getState();

export const RECIPES: Recipe[] = [
  {
    id: "char", title: "New character, ready to animate", blurb: "An anime character on a transparent layer, ready for any scene.",
    apply: () => { S().set("create", { style: "anime", make: "character", cutout: true, count: 4, characterId: null }); return { tab: "create", title: "New character", steps: ["Fill in hair, eyes, outfit and pose", "Pick a look (optional)", "Press Generate and keep the best one"] }; },
  },
  {
    id: "sheet", title: "Character turnaround sheet", blurb: "Front, back, sides, face and a cut-out of one character, all matching.",
    apply: () => ({ tab: "characters", title: "Turnaround sheet", steps: ["Pick or import a character on the left", "Open sheet maker", "Make the front, then the other views"] }),
  },
  {
    id: "pose", title: "Copy a pose", blurb: "Your character in the exact pose of a reference photo.",
    apply: () => { S().set("edit", { mode: "pose", instruction: TEMPLATES().pose }); return { tab: "edit", title: "Copy a pose", steps: ["Picture 1 = your character", "Picture 2 = the pose reference", "Press Make edit"] }; },
  },
  {
    id: "fix", title: "Fix one part of a picture", blurb: "Paint over a hand, the outfit or the background and say what it should be.",
    apply: () => { S().set("edit", { mode: "free", instruction: "" }); return { tab: "edit", title: "Fix one part", steps: ["Drop the picture in Picture 1", "Press Paint area to change and paint over it", "Say what it should become, then Make edit"] }; },
  },
  {
    id: "dance", title: "Dance like a clip", blurb: "Your character performs the moves from a reference video, with its music.",
    apply: () => {
      S().set("prompt", { mode: "references", cuts: 1, camera: "handheld", seconds: 8, idea: "<Picture 1> performs the dance from <Video 1> on the street from <Picture 2>, matching its rhythm and moves. The music from <Video 1> plays." });
      return { tab: "prompt", title: "Dance like a clip", steps: ["Add your character (and a background picture)", "Add the dance clip, trimmed to the best 2–8 s, with its sound", "Write the timeline, then Send to Animate"] };
    },
  },
  {
    id: "talk", title: "Talking close-up with your voice", blurb: "A close-up of your character saying a line in a recorded voice.",
    apply: () => {
      S().set("prompt", { mode: "references", cuts: 1, camera: "still", seconds: 6, idea: "Close-up of <Picture 1> looking into the camera. At about 1 second they say, in the voice of <Audio 1>: \"…\" Small natural head movements and blinks." });
      return { tab: "prompt", title: "Talking close-up", steps: ["Add your character's face picture", "Record or add the voice line", "Replace the … with the words, then Write"] };
    },
  },
  {
    id: "loop", title: "Cover-art loop", blurb: "A short video that ends exactly where it starts — loops forever.",
    apply: () => {
      S().set("animate", { mode: "loop", seconds: 6 });
      S().set("finish", { ending: "fade_start", fade: 0.8, format: "webm", audio: "fade" });
      return { tab: "animate", title: "Cover-art loop", steps: ["Drop the cover picture", "Describe a small, gentle motion (hair, light, particles)", "Make video, then Trim, loop & export → Loop WebM"] };
    },
  },
  {
    id: "film", title: "Short film: 3 shots", blurb: "A 15-second scene with three planned cuts and sound.",
    apply: () => { S().set("prompt", { mode: "references", cuts: 3, camera: "auto", seconds: 15 }); return { tab: "prompt", title: "Short film", steps: ["Add your characters and a location", "Describe the scene beat by beat", "Check the three cuts on the timeline, then Send to Animate"] }; },
  },
];

export function RecipesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="press btn-raised flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-ink"><Icon name="sparkle" size={14} className="text-accent" />Quick starts</button>
      {open && createPortal(
        <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={() => setOpen(false)} role="dialog" aria-label="Quick starts">
          <div className="zoom-in max-h-full w-[880px] overflow-y-auto rounded-2xl border border-line bg-panel p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center"><h2 className="display text-xl ">Quick starts</h2><span className="ml-3 text-[13px] text-muted">One click sets everything up and shows you the steps.</span>
              <button aria-label="Close" className="ml-auto text-muted hover:text-ink" onClick={() => setOpen(false)}><Icon name="x" /></button></div>
            <div className="grid grid-cols-3 gap-3">
              {RECIPES.map((r) => (
                <button key={r.id} onClick={() => { const g = r.apply(); useGuide.setState({ g }); useSettings.getState().setTab(g.tab); setOpen(false); }}
                  className="press card card-hover flex flex-col gap-1.5 rounded-xl border border-line p-4 text-left hover:border-accent/70">
                  <span className="text-[15px] font-semibold">{r.title}</span>
                  <span className="text-[13px] leading-relaxed text-muted">{r.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        </div>, document.body)}
    </>
  );
}

export function GuideBanner({ tab }: { tab: Tab }) {
  const g = useGuide((s) => s.g);
  if (!g || g.tab !== tab) return null;
  return (
    <div className="flex items-center gap-4 border-b border-accent/40 bg-accent/10 px-5 py-2 text-[13px]">
      <b className="shrink-0">Recipe: {g.title}</b>
      <ol className="flex flex-wrap gap-x-5 gap-y-1">{g.steps.map((s, i) => <li key={i}><span className="mr-1 font-mono text-accent">{i + 1}</span>{s}</li>)}</ol>
      <Btn small className="ml-auto shrink-0" onClick={() => useGuide.setState({ g: null })}>Got it</Btn>
    </div>
  );
}

export function applyRecipe(r: Recipe) { const g = r.apply(); useGuide.setState({ g }); useSettings.getState().setTab(g.tab); }
