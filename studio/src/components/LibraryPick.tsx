// Pick a saved pose or background (yours, the built-in poses, or ones pulled out of CivitAI posts) — it goes into the
// prompt in place of the old one. Opened from right-click on a prompt (a highlighted part, or a piece), or Create's buttons.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { useInspo, type InspoKind, type InspoItem } from "../lib/inspo";
import { Icon, cx } from "./ui";

export const useLibPick = create<{ kind: InspoKind | null; onPick: ((text: string) => void) | null }>(() => ({ kind: null, onPick: null }));
/** open the picker; the chosen text goes to onPick */
export const pickFromLibrary = (kind: InspoKind, onPick: (text: string) => void) => useLibPick.setState({ kind, onPick });

export function LibraryPick() {
  const { kind, onPick } = useLibPick();
  const sets = useInspo((s) => s.sets);
  const mine = useMemo(() => sets.filter((x) => x.kind === kind), [sets, kind]);
  const [cur, setCur] = useState<string>("all");
  const [q, setQ] = useState("");
  useEffect(() => { setCur("all"); setQ(""); }, [kind]);
  useEffect(() => {
    if (!kind) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", esc, true); return () => window.removeEventListener("keydown", esc, true);
  }, [kind]);
  if (!kind) return null;
  const close = () => useLibPick.setState({ kind: null, onPick: null });
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const items: (InspoItem & { from: string })[] = (cur === "all" ? mine : mine.filter((x) => x.id === cur))
    .flatMap((s) => s.items.map((i) => ({ ...i, from: s.name })))
    .filter((i) => words.every((w) => i.text.toLowerCase().includes(w)));
  const pick = (t: string) => { onPick?.(t); close(); };
  const noun = kind === "pose" ? "pose" : "background";
  return createPortal(
    <div className="fade-in fixed inset-0 z-[96] flex items-center justify-center bg-black/70 p-4 sm:p-8" onMouseDown={close} role="dialog" aria-modal aria-label={`Pick a ${noun}`}>
      <div className="flex h-full max-h-[820px] w-full max-w-[1100px] flex-col border border-line bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <b className="text-[15px]">Pick a {noun}</b>
          <span className="text-[12px] text-muted">replaces the {noun} in the prompt — everything else stays</span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "pose" ? "Search, e.g. sitting, kneeling, mirror" : "Search, e.g. bedroom, beach, neon"} aria-label="Search"
            className="inset ml-auto h-8 w-64 border border-line px-2 text-[12.5px] focus:border-accent focus:outline-none" />
          <button aria-label="Close" onClick={close} className="text-muted hover:text-ink"><Icon name="x" size={16} /></button>
        </div>
        <div className="flex flex-wrap gap-1 border-b border-line px-4 py-2">
          <button onClick={() => setCur("all")} aria-pressed={cur === "all"} className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", cur === "all" && "on")}>All ({mine.reduce((n, s) => n + s.items.length, 0)})</button>
          {mine.map((s) => <button key={s.id} onClick={() => setCur(s.id)} aria-pressed={cur === s.id} className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", cur === s.id && "on")}>{s.name} ({s.items.length})</button>)}
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-4 md:grid-cols-3 xl:grid-cols-4">
          {items.map((i) => (
            <button key={`${i.from}:${i.id}`} onClick={() => pick(i.text)} className="press group flex min-h-[84px] overflow-hidden border border-line bg-raised/40 text-left hover:border-accent">
              {i.thumb && <img src={i.thumb} alt="" loading="lazy" className="h-auto w-20 shrink-0 object-cover" />}
              <span className="flex min-w-0 flex-col gap-1 p-2">
                <span className="line-clamp-4 font-mono text-[11.5px] leading-snug text-ink/90">{i.text}</span>
                <span className="micro mt-auto truncate text-dim">{i.from.toUpperCase()}</span>
              </span>
            </button>
          ))}
          {!items.length && <p className="col-span-full py-10 text-center text-[13px] text-muted">{q ? "Nothing matches." : <>No saved {noun}s yet. In your CivitAI collections press <b>Pick several → Batch</b>, tick posts, then <b>Poses &amp; backgrounds</b> to pull them out.</>}</p>}
        </div>
      </div>
    </div>, document.body);
}
