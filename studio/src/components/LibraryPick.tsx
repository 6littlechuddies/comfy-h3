// Pick a saved pose or background (yours, the built-in poses, or ones pulled out of CivitAI posts) — it goes into the
// prompt in place of the old one. Opened from right-click on a prompt (a highlighted part, or a piece), or Create's buttons.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { useInspo, type InspoKind, type InspoItem } from "../lib/inspo";
import { Icon, cx } from "./ui";

export const useLibPick = create<{ kind: InspoKind | null; onPick: ((text: string) => void) | null; onPicture: ((i: InspoItem) => Promise<void>) | null }>(() => ({ kind: null, onPick: null, onPicture: null }));
/** open the picker; the chosen text goes to onPick — or, with onPicture, a post's picture can be used as the exact pose / place */
export const pickFromLibrary = (kind: InspoKind, onPick: (text: string) => void, onPicture?: (i: InspoItem) => Promise<void>) => useLibPick.setState({ kind, onPick, onPicture: onPicture ?? null });

export function LibraryPick() {
  const { kind, onPick, onPicture } = useLibPick();
  // with a picture (CivitAI posts): copy it exactly from the picture (default), or only its words
  const [how, setHow] = useState<"picture" | "words">(() => { try { return (localStorage.getItem("h3.libpick.how") as "picture" | "words") || "picture"; } catch { return "picture"; } });
  const pickHow = (v: "picture" | "words") => { setHow(v); try { localStorage.setItem("h3.libpick.how", v); } catch { /* */ } };
  const [busy, setBusy] = useState<string | null>(null);
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
  const close = () => useLibPick.setState({ kind: null, onPick: null, onPicture: null });
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const items: (InspoItem & { from: string })[] = (cur === "all" ? mine : mine.filter((x) => x.id === cur))
    .flatMap((s) => s.items.map((i) => ({ ...i, from: s.name })))
    .filter((i) => words.every((w) => i.text.toLowerCase().includes(w)))
    .sort((a, b) => Number(!!b.thumb) - Number(!!a.thumb));
  const pick = async (i: InspoItem) => {
    if (onPicture && how === "picture" && (i.url || i.thumb)) {
      setBusy(i.id);
      try { await onPicture(i); close(); } catch (e) { import("../lib/jobs").then(({ useJobs }) => useJobs.getState().toast((e as Error).message, "bad")); } finally { setBusy(null); }
      return;
    }
    onPick?.(i.text); close();
  };
  const noun = kind === "pose" ? "pose" : "background";
  return createPortal(
    <div className="fade-in fixed inset-0 z-[96] flex items-center justify-center bg-black/70 p-4 sm:p-8" onMouseDown={close} role="dialog" aria-modal aria-label={`Pick a ${noun}`}>
      <div className="flex h-full max-h-[820px] w-full max-w-[1100px] flex-col border border-line bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <b className="text-[15px]">Pick a {noun}</b>
          {onPicture ? <span className="flex gap-1">{([["picture", kind === "pose" ? "Copy the pose from the picture (no background)" : "Use the place from the picture (no people)"], ["words", "Use its words"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => pickHow(v)} aria-pressed={how === v} className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", how === v && "on")}>{l}</button>))}</span>
            : <span className="text-[12px] text-muted">replaces the {noun} in the prompt — everything else stays</span>}
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "pose" ? "Search, e.g. sitting, kneeling, mirror" : "Search, e.g. bedroom, beach, neon"} aria-label="Search"
            className="inset ml-auto h-8 w-64 border border-line px-2 text-[12.5px] focus:border-accent focus:outline-none" />
          <button aria-label="Close" onClick={close} className="text-muted hover:text-ink"><Icon name="x" size={16} /></button>
        </div>
        <div className="flex flex-wrap gap-1 border-b border-line px-4 py-2">
          <button onClick={() => setCur("all")} aria-pressed={cur === "all"} className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", cur === "all" && "on")}>All ({mine.reduce((n, s) => n + s.items.length, 0)})</button>
          {mine.map((s) => <button key={s.id} onClick={() => setCur(s.id)} aria-pressed={cur === s.id} className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", cur === s.id && "on")}>{s.name} ({s.items.length})</button>)}
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-2.5 overflow-y-auto p-4 md:grid-cols-4 xl:grid-cols-6">
          {items.map((i) => (
            <button key={`${i.from}:${i.id}`} onClick={() => pick(i)} disabled={!!busy} title={i.text}
              className={cx("press group flex flex-col overflow-hidden border bg-raised/40 text-left hover:border-accent disabled:opacity-60", busy === i.id ? "border-accent" : "border-line")}>
              {i.thumb ? <span className="relative block aspect-[3/4] w-full bg-black">
                <img src={i.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                {busy === i.id && <span className="absolute inset-0 flex items-center justify-center bg-black/70 text-[12px]"><span className="pulse text-accent">●</span>&nbsp;Preparing…</span>}
              </span> : null}
              <span className={cx("px-2 pt-1.5 text-[11px] leading-snug text-ink/85", i.thumb ? "line-clamp-2 h-[34px]" : "line-clamp-6 min-h-[84px]")}>{i.text}</span>
              <span className="micro truncate px-2 pb-1.5 text-dim">{i.from.toUpperCase()}</span>
            </button>
          ))}
          {!items.length && <p className="col-span-full py-10 text-center text-[13px] text-muted">{q ? "Nothing matches." : <>No saved {noun}s yet. In your CivitAI collections press <b>Pick several → Batch</b>, tick posts, then <b>Poses &amp; backgrounds</b> to pull them out.</>}</p>}
        </div>
      </div>
    </div>, document.body);
}
