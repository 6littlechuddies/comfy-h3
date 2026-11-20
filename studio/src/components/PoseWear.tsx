// Browse PoseWear like Browse LoRAs: its depth poses, poses, outfits and faces as cards. Tick as many as you like
// (each angle of a pose is its own pick), then send them to Batch (one picture per pose × outfit, or Cosplay's poses)
// or, opened from Create, pick one depth pose for the picture you're making.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { LIBS, loadLib, pickOf, usePoseWear, type PwItem, type PwLib, type PwPick } from "../lib/posewear";
import { useJobs } from "../lib/jobs";
import { Icon, cx } from "./ui";

type Mode = "many" | "create";
export const usePwBrowser = create<{ open: boolean; mode: Mode; lib: PwLib }>(() => ({ open: false, mode: "many", lib: "depths" }));
export const openPoseWear = (mode: Mode = "many", lib: PwLib = "depths") => usePwBrowser.setState({ open: true, mode, lib });

const PAGE = 90;

export function PoseWearBrowser() {
  const { open, mode, lib } = usePwBrowser();
  if (!open) return null;
  return <Body mode={mode} first={lib} />;
}

function Body({ mode, first }: { mode: Mode; first: PwLib }) {
  const [lib, setLib] = useState<PwLib>(first);
  const [items, setItems] = useState<PwItem[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [angle, setAngle] = useState<Record<string, number>>({});
  const pw = usePoseWear();
  const toast = useJobs((s) => s.toast);
  const close = () => usePwBrowser.setState({ open: false });
  useEffect(() => { setItems(null); setErr(""); setGroup(""); setShown(PAGE); loadLib(lib).then(setItems).catch((e) => setErr((e as Error).message)); }, [lib]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
  const groups = useMemo(() => [...new Set((items ?? []).filter((i) => pw.adult || !i.adult).map((i) => i.group).filter(Boolean))], [items, pw.adult]);
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (items ?? []).filter((i) => (pw.adult || !i.adult) && (!group || i.group === group) && words.every((w) => `${i.title} ${i.words} ${i.group}`.toLowerCase().includes(w)));
  }, [items, q, group, pw.adult]);
  const picked = new Set(pw.picks.map((p) => p.key));
  const choose = (p: PwPick) => {
    if (mode === "create") {
      if (p.lib !== "poses" && p.lib !== "depths") { toast("In Create, pick a pose or depth pose — outfits and faces go in through Batch", "info"); return; }
      usePoseWear.getState().set({ create: p }); close(); toast("Depth pose set — the next realistic picture copies that body position", "good"); return;
    }
    pw.toggle(p);
  };
  const poses = pw.picks.filter((p) => p.lib === "poses" || p.lib === "depths").length;
  const wear = pw.picks.length - poses;
  const send = async (to: "rows" | "cosplay") => {
    try {
      if (to === "cosplay") {
        const { useCosplay } = await import("../lib/cosplay");
        const o = useCosplay.getState().opts;
        useCosplay.getState().set({ opts: { ...o, poses: "posewear" } });
        close(); toast(`Cosplay now uses your ${poses} pose${poses === 1 ? "" : "s"} — Research (or Redo) to write prompts for them`, "good");
      } else {
        const { posesToBatch } = await import("../lib/posewear");
        const n = await posesToBatch((m) => toast(m, "info"));
        close(); toast(`Added ${n} row${n === 1 ? "" : "s"} to the batch — check them, then Queue`, "good");
      }
    } catch (e) { toast((e as Error).message, "bad"); }
  };

  return createPortal(
    <div className="fade-in fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={close} role="dialog" aria-modal aria-label="Browse PoseWear">
      <div className="zoom-in ticks frame relative flex h-full max-h-[960px] w-full max-w-[1360px] flex-col overflow-hidden border border-line bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-3 border-b border-line px-5 pb-3.5 pt-4">
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <div className="micro text-dim">LIB/POSEWEAR</div>
              <h2 className="display text-[24px] leading-none">{mode === "create" ? "Pick a pose" : "Poses & outfits"}</h2>
            </div>
            <label className="inset ml-auto flex h-11 w-full max-w-[420px] items-center gap-2.5 border border-line px-3.5 focus-within:border-accent">
              <Icon name="search" size={16} className="text-muted" />
              <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search: sitting, over the shoulder, kneeling, winter coat…" aria-label="Search PoseWear"
                className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] placeholder:text-dim focus:outline-none" />
              {q && <button aria-label="Clear search" onClick={() => setQ("")} className="text-muted hover:text-ink"><Icon name="x" size={14} /></button>}
            </label>
            <button aria-label="Close" onClick={close} className="press btn-raised flex h-10 w-10 shrink-0 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={16} /></button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {LIBS.filter((l) => mode !== "create" || l.id === "poses" || l.id === "depths").map((l) => (
              <button key={l.id} onClick={() => setLib(l.id)} aria-pressed={lib === l.id} title={l.note} className={cx("press tag-btn", lib === l.id && "on")}>{l.label}</button>))}
            <span className="mx-1 h-5 w-px bg-line" />
            {groups.length > 1 && <>
              <button onClick={() => setGroup("")} className={cx("press tag-btn !h-7 !text-[12px]", !group && "on")}>All</button>
              {groups.map((g) => <button key={g} onClick={() => { setGroup(g === group ? "" : g); setShown(PAGE); }} className={cx("press tag-btn !h-7 !text-[12px]", group === g && "on")}>{g}</button>)}
            </>}
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12.5px] text-muted" title="Show PoseWear's adult-marked poses and outfits (two-person poses stay hidden in Batch: every picture here is one person)">
              <input type="checkbox" checked={pw.adult} onChange={(e) => pw.set({ adult: e.target.checked })} /> 18+ poses and outfits</label>
          </div>
          <p className="-mt-1 text-[12px] text-dim">{LIBS.find((l) => l.id === lib)?.note}. {mode === "many" ? "Click to tick; tick as many as you like — each angle of a pose is its own pick." : "Click one to use it."}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {err && <p className="text-[13px] text-bad">{err}</p>}
          {!items && !err && <p className="text-[13px] text-muted">Loading PoseWear…</p>}
          {items && !list.length && <p className="text-[13px] text-muted">Nothing matches.</p>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {list.slice(0, shown).map((it) => {
              const ai = angle[it.key] ?? 0;
              const p = pickOf(it, ai);
              const on = picked.has(p.key) || (mode === "create" && pw.create?.key === p.key);
              const n = it.angles ? it.angles.filter((_, i) => picked.has(`${it.key}#${i}`)).length : 0;
              return (
                <div key={it.key} className={cx("flex flex-col border bg-raised/40", on ? "border-accent" : "border-line hover:border-muted")}>
                  <button onClick={() => choose(p)} title={p.title} className="press relative block aspect-[3/4] overflow-hidden bg-black/30">
                    <img src={p.thumb} alt={p.title} loading="lazy" referrerPolicy="no-referrer" className={cx("h-full w-full", it.lib === "depths" ? "object-contain" : "object-cover")} />
                    {on && <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accentink"><Icon name="check" size={14} /></span>}
                    {n > 1 && <span className="micro absolute left-1.5 top-1.5 bg-black/75 px-1 text-accent">{n} ANGLES</span>}
                  </button>
                  <div className="flex flex-col gap-1 p-1.5">
                    <span className="line-clamp-2 text-[11.5px] leading-snug" title={it.words}>{it.title}</span>
                    {it.angles && it.angles.length > 1 && <div className="flex flex-wrap gap-0.5">
                      {it.angles.map((a, i) => <button key={i} onClick={() => setAngle({ ...angle, [it.key]: i })} title={a.en}
                        className={cx("press border px-1 text-[10.5px]", i === ai ? "border-accent text-accent" : picked.has(`${it.key}#${i}`) ? "border-accent/50 text-ink" : "border-line text-dim hover:text-ink")}>{shortAngle(a.en)}</button>)}
                    </div>}
                  </div>
                </div>);
            })}
          </div>
          {list.length > shown && <button onClick={() => setShown(shown + PAGE)} className="press btn-raised mx-auto mt-4 flex h-10 items-center px-5 text-[13px]">Show more ({list.length - shown} left)</button>}
          <p className="mt-6 text-[11px] leading-relaxed text-dim">From <a className="underline" href="https://posewear.pages.dev/" target="_blank" rel="noreferrer">PoseWear</a> (MIT) — poses and outfits from @giaaibusi's AI galleries, faces CC0. Pictures load from their sites; a pose is saved on the rental only when used.</p>
        </div>

        {mode === "many" && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {!pw.picks.length && <span className="text-[12.5px] text-dim">Nothing picked yet.</span>}
              {pw.picks.map((p) => (
                <button key={p.key} onClick={() => pw.toggle(p)} title={`${p.title} — click to remove`} className="press relative h-12 w-9 shrink-0 overflow-hidden border border-line hover:border-bad">
                  <img src={p.thumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" /></button>))}
            </div>
            <label className="flex items-center gap-2 text-[12px] text-muted" title="How strictly Krea 2 follows the pose's depth: lower leaves more room for the costume and prompt">Pose strength
              <input type="range" min={0.4} max={1} step={0.05} value={pw.strength} onChange={(e) => pw.set({ strength: Number(e.target.value) })} className="w-24" /><span className="w-8 font-mono">{pw.strength.toFixed(2)}</span></label>
            {pw.picks.length > 0 && <button onClick={() => pw.set({ picks: [] })} className="text-[12px] text-dim hover:text-ink">Clear</button>}
            <button onClick={() => send("cosplay")} disabled={!poses} className="press btn-raised flex h-10 items-center gap-1.5 px-3 text-[13px] disabled:opacity-40" title="Cosplay pictures use these poses (each picture the next one)">Use for Cosplay</button>
            <button onClick={() => send("rows")} disabled={!poses} className="press btn-primary flex h-10 items-center gap-2 px-4 text-[13px] font-semibold uppercase tracking-wide text-accentink disabled:opacity-40">
              Add {poses * Math.max(1, wear) || ""} to batch</button>
          </div>)}
      </div>
    </div>, document.body);
}

const shortAngle = (en: string) => /front/.test(en) ? "Front" : /above/.test(en) ? "Above" : /below/.test(en) ? "Below" : /three-quarter/.test(en) ? "¾" : /side/.test(en) ? "Side" : en;
