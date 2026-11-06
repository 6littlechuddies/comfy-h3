// "Avoid": what to keep out of a video. H3 has no true negative prompt (it's CFG-distilled: one guided pass, no
// unconditional one to push away from), so the planner writes around these and H3 gets a plain "Avoid: …" line.
import { Icon } from "./ui";

/** the planner is told what to keep out, and to write what's there instead (H3 has no negative prompt) */
export function withAvoidNote(idea: string, avoid?: string): string {
  const a = (avoid ?? "").trim();
  return a ? `${idea}\n\nKeep these out of the video: ${a}. Don't mention them at all — describe what is there instead (a clean wall, not "no text").` : idea;
}

/** Avoid: what to keep out of the video. Not a true negative prompt — H3 doesn't have one */
export function AvoidLine({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="mt-1 flex items-center gap-2 border-t border-line2 px-1 pt-2 text-[12.5px]">
      <span className="shrink-0 text-muted" title="H3 has no true negative prompt (its videos are made in one guided pass). The planner writes around these, and H3 gets a plain “Avoid: …” line, which its text model reads. Works best for things like text, watermarks, extra people, a camera move.">Avoid</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} aria-label="Avoid"
        placeholder="optional — e.g. text, watermark, extra people, camera shake"
        className="h-8 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 text-[12.5px] text-ink placeholder:text-dim focus:border-accent focus:outline-none" />
      {value && <button onClick={() => onChange("")} aria-label="Clear avoid" className="text-dim hover:text-ink"><Icon name="x" size={13} /></button>}
    </label>
  );
}
