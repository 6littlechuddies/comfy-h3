// "Make a video" for a saved character: pick a preset, it sets up Animate with the reference sheet
// and an identity-locked prompt (or makes it straight away).
import { useState } from "react";
import { createPortal } from "react-dom";
import type { Character } from "../lib/characters";
import { PRESETS, buildCharacterVideo, type CharPreset } from "../lib/charVideo";
import { useJobs } from "../lib/jobs";
import { useSettings } from "../lib/settings";
import type { Media } from "../lib/tray";
import { useWork } from "../lib/work";
import { usePrimary } from "../App";
import { Icon, Slot, cx, DropSelect } from "./ui";

export function CharVideoDialog({ c, onClose }: { c: Character; onClose: () => void }) {
  const [p, setP] = useState<CharPreset>(PRESETS[0]);
  const [clip, setClip] = useState<Media | null>(null);
  const [words, setWords] = useState("");
  const [voice, setVoice] = useState("");
  const [place, setPlace] = useState("");
  const [whom, setWhom] = useState("");
  const [clipOutfit, setClipOutfit] = useState(false);
  const [secs, setSecs] = useState(PRESETS[0].seconds);
  const [aspect, setAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [busy, setBusy] = useState(false);
  const toast = useJobs((s) => s.toast);
  const need = p.needs?.includes("clip") && !clip ? "Add the clip whose moves to copy" : p.needs?.includes("words") && !words.trim() ? "Write what they say" : undefined;
  const clipSecs = clip?.duration ? Math.min(15, Math.max(2, Math.round(clip.duration))) : null;
  const followsClip = p.id === "dance" || !!p.clipLength;
  const length = followsClip && clipSecs ? clipSecs : secs;

  const setUp = async (thenRun: boolean) => {
    if (need) return;
    setBusy(true);
    try {
      const r = await buildCharacterVideo(c, p, { clip, words, voice, place, extra: whom, clipOutfit }, length);
      if (!r) return toast("Make the reference sheet first (at least the front view) — Open sheet maker.", "bad");
      if (p.mode === "loop") useWork.getState().set({ animateFrame: r.frames[0] ?? null });
      else useWork.getState().set({ animateRefs: r.refs });
      useSettings.getState().set("animate", { mode: p.mode, prompt: r.prompt, seconds: length, aspect, ...(p.refDetail ? { refImageSize: p.refDetail } : {}) });
      useSettings.getState().setTab("animate");
      if (r.missing.length) toast(`Tip: add the ${r.missing.join(", ")} view${r.missing.length > 1 ? "s" : ""} to the sheet for an even closer match.`, "info");
      if (thenRun) setTimeout(() => usePrimary.getState().fns.animate?.(), 400);
      else toast(`Set up in Animate: ${c.name}'s sheet as references and a prompt that keeps them the same in every cut.`, "good");
      onClose();
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fade-in fixed inset-0 z-[56] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]" onMouseDown={onClose} role="dialog" aria-modal aria-label="Make a video">
      <div className="zoom-in ticks frame flex max-h-full w-full max-w-[860px] flex-col overflow-hidden border border-line bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <div><div className="micro text-dim">CHARACTER → VIDEO</div><h2 className="display text-[22px] leading-tight">{c.name}: make a video</h2></div>
          <button aria-label="Close" onClick={onClose} className="press btn-raised ml-auto flex h-9 w-9 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={16} /></button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] overflow-y-auto">
          <div className="grid grid-cols-2 content-start gap-2 p-4">
            {PRESETS.map((x, i) => (
              <button key={x.id} onClick={() => { setP(x); setSecs(x.seconds); }} aria-pressed={p.id === x.id}
                className={cx("press flex flex-col gap-1 border p-3.5 text-left transition-colors", p.id === x.id ? "border-accent bg-accent/[.07]" : "border-line hover:border-[#3a3e46]")}>
                <span className="flex items-center gap-2"><span className={cx("micro", p.id === x.id ? "text-accent" : "text-dim")}>{String(i + 1).padStart(2, "0")}</span><span className="text-[14.5px] font-bold">{x.title}</span></span>
                <span className="text-[12.5px] leading-relaxed text-muted">{x.blurb}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-3 border-l border-line p-4">
            {p.needs?.includes("clip") && (
              <div><div className="lbl mb-1">{p.id === "swap" ? "The clip" : "Moves to copy"}</div><Slot className="h-40" value={clip} onChange={setClip} accept={["video"]} label={p.id === "swap" ? "Drop the video (2–15 s)" : "Drop a dance clip (2–15 s)"} /></div>
            )}
            {p.needs?.includes("words") && (
              <>
                <label className="flex flex-col gap-1"><span className="lbl">What they say</span>
                  <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={3} className="inset resize-none border px-2.5 py-2 text-[13.5px] focus:border-accent focus:outline-none" placeholder="Hey, it's me — did you miss me?" /></label>
                <label className="flex flex-col gap-1"><span className="lbl">Voice (optional)</span>
                  <input value={voice} onChange={(e) => setVoice(e.target.value)} className="inset h-9 border px-2.5 text-[13.5px] focus:border-accent focus:outline-none" placeholder="soft, playful, low…" /></label>
              </>
            )}
            {p.id === "swap" && (
              <>
                <label className="flex flex-col gap-1"><span className="lbl">Who to replace (if there are several)</span>
                  <input value={whom} onChange={(e) => setWhom(e.target.value)} className="inset h-9 border px-2.5 text-[13.5px] focus:border-accent focus:outline-none" placeholder="the girl in the red top" /></label>
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
                  <input type="checkbox" checked={clipOutfit} onChange={(e) => setClipOutfit(e.target.checked)} /> Wear the clothes from the clip (instead of {c.name}'s own)</label>
                <p className="text-[12px] leading-relaxed text-dim">References go in at full detail for the closest face (slower). Front, face and three-quarter views from {c.name}'s sheet are used.</p>
              </>
            )}
            {p.mode !== "loop" && p.id !== "turn" && p.id !== "swap" && (
              <label className="flex flex-col gap-1"><span className="lbl">Where (optional)</span>
                <input value={place} onChange={(e) => setPlace(e.target.value)} className="inset h-9 border px-2.5 text-[13.5px] focus:border-accent focus:outline-none" placeholder="a neon-lit rooftop at night" /></label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1"><span className="lbl">Length</span>
                <DropSelect value={length} disabled={followsClip && !!clipSecs} onChange={(e) => setSecs(Number(e.target.value))} className="inset h-9 border px-2 text-[13.5px]">
                  {Array.from({ length: 14 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} s</option>)}
                </DropSelect></label>
              <label className="flex flex-col gap-1"><span className="lbl">Shape</span>
                <DropSelect value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)} className="inset h-9 border px-2 text-[13.5px]">
                  <option value="9:16">9:16 vertical</option><option value="16:9">16:9 wide</option><option value="1:1">1:1 square</option>
                </DropSelect></label>
            </div>
            <p className="text-[12px] leading-relaxed text-dim">Uses {p.views.length > 1 ? `${p.views.length} views of the sheet` : "the front view"} so {c.name} stays the same person, and repeats their look in every cut of the prompt.</p>
            <div className="mt-auto flex flex-col gap-2 pt-2">
              <button disabled={!!need || busy} onClick={() => setUp(true)} title={need} className="press btn-primary chamfer h-11 text-[14px] uppercase tracking-wide">{busy ? "Setting up…" : "Make it now"}</button>
              <button disabled={!!need || busy} onClick={() => setUp(false)} className="press btn-raised h-9 text-[13px] font-medium">Set up in Animate (check first)</button>
              {need && <p className="text-center text-[12px] text-hot">{need}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>, document.body);
}
