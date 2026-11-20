// Browse PoseWear like its own site (posewear.pages.dev), in English: depth poses, poses, outfits, anime outfits and faces;
// its lines and categories as filters, angles per pose, a big preview with the English prompt, your stars and hidden ones.
// Tick as many as you like (each angle of a pose is its own pick), then send them to Batch (one picture per pose × outfit,
// or Cosplay's poses) — or, opened from Create or Edit, pick one.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { LIBS, loadLib, pickOf, usePoseWear, type PwItem, type PwLib, type PwPick } from "../lib/posewear";
import { useJobs } from "../lib/jobs";
import { copyText } from "../lib/copy";
import { Icon, cx } from "./ui";

/** many: tick and send to Batch · create: Create's depth pose · one: hand one pick to whoever opened it (Edit) */
type Mode = "many" | "create" | "one";
type OnPick = ((p: PwPick) => void) | null;
export const usePwBrowser = create<{ open: boolean; mode: Mode; lib: PwLib; onPick: OnPick }>(() => ({ open: false, mode: "many", lib: "depths", onPick: null }));
export const openPoseWear = (mode: Mode = "many", lib: PwLib = "depths", onPick: OnPick = null) => usePwBrowser.setState({ open: true, mode, lib, onPick });

const PAGE = 90;
type Show = "all" | "favs" | "hidden";

export function PoseWearBrowser() {
  const { open, mode, lib, onPick } = usePwBrowser();
  if (!open) return null;
  return <Body mode={mode} first={lib} onPick={onPick} />;
}

function Body({ mode, first, onPick }: { mode: Mode; first: PwLib; onPick: OnPick }) {
  const [lib, setLib] = useState<PwLib>(first);
  const [items, setItems] = useState<PwItem[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [cat, setCat] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [shown, setShown] = useState(PAGE);
  const [angle, setAngle] = useState<Record<string, number>>({});
  const [peek, setPeek] = useState<PwItem | null>(null);
  const pw = usePoseWear();
  const toast = useJobs((s) => s.toast);
  const close = () => usePwBrowser.setState({ open: false, onPick: null });
  useEffect(() => { setItems(null); setErr(""); setGroup(""); setCat(""); setShown(PAGE); loadLib(lib).then(setItems).catch((e) => setErr((e as Error).message)); }, [lib]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { if (peek) setPeek(null); else close(); } }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [peek]);
  const allowed = (i: PwItem) => pw.adult || !i.adult;
  const groups = useMemo(() => [...new Set((items ?? []).filter(allowed).map((i) => i.group).filter(Boolean))], [items, pw.adult]); // eslint-disable-line react-hooks/exhaustive-deps
  const cats = useMemo(() => [...new Set((items ?? []).filter((i) => allowed(i) && (!group || i.group === group)).map((i) => i.cat).filter(Boolean))], [items, pw.adult, group]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (items ?? []).filter((i) => allowed(i) && (!group || i.group === group) && (!cat || i.cat === cat)
      && (show === "favs" ? pw.favs[i.key] : show === "hidden" ? pw.hidden[i.key] : !pw.hidden[i.key])
      && words.every((w) => `${i.title} ${i.words} ${i.group} ${i.cat} ${i.no ?? ""}`.toLowerCase().includes(w)))
      .sort((a, b) => Number(!!pw.favs[b.key]) - Number(!!pw.favs[a.key]));
  }, [items, q, group, cat, show, pw.adult, pw.favs, pw.hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const picked = new Set(pw.picks.map((p) => p.key));
  const isPoseLib = (l: PwLib) => l === "poses" || l === "depths";
  const choose = async (p: PwPick) => {
    if (mode === "one") { if (!isPoseLib(p.lib)) { toast("Pick a pose or depth pose here", "info"); return; } close(); onPick?.(p); return; }
    if (mode === "create") {
      if (!isPoseLib(p.lib)) { toast("In Create, pick a pose or depth pose — outfits and faces go in through Batch", "info"); return; }
      usePoseWear.getState().set({ create: p }); close();
      // a character as the star is made from her own pictures: then the pose goes in as Picture 2 ("Copy the pose") as well
      const [{ useSettings }, { useMakeRefs }, { useTray }] = await Promise.all([import("../lib/settings"), import("../lib/make"), import("../lib/tray")]);
      if (useSettings.getState().s.create.characterId) {
        try { const m = await useTray.getState().addUrl(p.image); useMakeRefs.setState({ pic2: m, take: "pose" }); toast("Pose set — with your character it goes in as Picture 2 (Copy the pose); without one, Krea 2 copies its depth", "good"); }
        catch (e) { toast((e as Error).message, "bad"); }
      } else toast("Depth pose set — the next realistic picture copies that body position", "good");
      return;
    }
    pw.toggle(p);
  };
  const star = (it: PwItem) => { const f = { ...pw.favs }; if (f[it.key]) delete f[it.key]; else f[it.key] = true; pw.set({ favs: f }); };
  const hide = (it: PwItem) => {
    const h = { ...pw.hidden }; if (h[it.key]) delete h[it.key]; else h[it.key] = true;
    // hiding also takes its angles out of the picks
    pw.set({ hidden: h, picks: h[it.key] ? pw.picks.filter((p) => !p.key.startsWith(`${it.key}#`) && p.key !== it.key) : pw.picks });
  };
  const poses = pw.picks.filter((p) => isPoseLib(p.lib)).length;
  const wear = pw.picks.filter((p) => p.lib === "costumes" || p.lib === "anime").length;
  const send = async (to: "rows" | "cosplay") => {
    try {
      if (to === "cosplay") {
        const { useCosplay } = await import("../lib/cosplay");
        const o = useCosplay.getState().opts;
        useCosplay.getState().set({ opts: { ...o, poses: "posewear" } });
        close(); toast(`Cosplay now uses your ${poses} pose${poses === 1 ? "" : "s"} — Rewrite all (or Redo) to write prompts for them`, "good");
      } else {
        const { posesToBatch } = await import("../lib/posewear");
        const n = await posesToBatch((m) => toast(m, "info"));
        close(); toast(`Added ${n} row${n === 1 ? "" : "s"} to the batch — check them, then Queue`, "good");
      }
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  const visibleLibs = LIBS.filter((l) => mode === "many" || isPoseLib(l.id));

  return createPortal(
    <div className="fade-in fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={close} role="dialog" aria-modal aria-label="Browse PoseWear">
      <div className="zoom-in ticks frame relative flex h-full max-h-[960px] w-full max-w-[1360px] flex-col overflow-hidden border border-line bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-2.5 border-b border-line px-5 pb-3 pt-4">
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <div className="micro text-dim">LIB/POSEWEAR</div>
              <h2 className="display text-[24px] leading-none">{mode === "many" ? "Poses & outfits" : "Pick a pose"}</h2>
            </div>
            <label className="inset ml-auto flex h-11 w-full max-w-[420px] items-center gap-2.5 border border-line px-3.5 focus-within:border-accent">
              <Icon name="search" size={16} className="text-muted" />
              <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search: sitting, over the shoulder, kneeling, winter coat, P012…" aria-label="Search PoseWear"
                className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] placeholder:text-dim focus:outline-none" />
              {q && <button aria-label="Clear search" onClick={() => setQ("")} className="text-muted hover:text-ink"><Icon name="x" size={14} /></button>}
            </label>
            <button aria-label="Close" onClick={close} className="press btn-raised flex h-10 w-10 shrink-0 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={16} /></button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {visibleLibs.map((l) => <button key={l.id} onClick={() => setLib(l.id)} aria-pressed={lib === l.id} title={l.note} className={cx("press tag-btn", lib === l.id && "on")}>{l.label}</button>)}
            <span className="mx-1 h-5 w-px bg-line" />
            {(["all", "favs", "hidden"] as Show[]).map((v) => <button key={v} onClick={() => { setShow(v); setShown(PAGE); }} className={cx("press tag-btn !h-7 !text-[12px]", show === v && "on")}>
              {v === "all" ? "Everything" : v === "favs" ? `★ Starred${Object.keys(pw.favs).length ? ` ${Object.keys(pw.favs).length}` : ""}` : `Hidden${Object.keys(pw.hidden).length ? ` ${Object.keys(pw.hidden).length}` : ""}`}</button>)}
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12.5px] text-muted" title="PoseWear's adult poses and outfits, including two-person (a man and a woman) poses — everyone is an adult">
              <input type="checkbox" checked={pw.adult} onChange={(e) => pw.set({ adult: e.target.checked })} /> NSFW (18+, incl. couples)</label>
          </div>
          {groups.length > 1 && <div className="flex flex-wrap items-center gap-1">
            <span className="w-16 text-[11.5px] text-dim">{isPoseLib(lib) ? "Framing" : "Kind"}</span>
            <button onClick={() => { setGroup(""); setCat(""); }} className={cx("press tag-btn !h-7 !text-[12px]", !group && "on")}>All</button>
            {groups.map((g) => <button key={g} onClick={() => { setGroup(g === group ? "" : g); setCat(""); setShown(PAGE); }} className={cx("press tag-btn !h-7 !text-[12px]", group === g && "on")}>{g}</button>)}
          </div>}
          {cats.length > 1 && <div className="flex flex-wrap items-center gap-1">
            <span className="w-16 text-[11.5px] text-dim">Pose</span>
            <button onClick={() => setCat("")} className={cx("press tag-btn !h-7 !text-[12px]", !cat && "on")}>All</button>
            {cats.map((c) => <button key={c} onClick={() => { setCat(c === cat ? "" : c); setShown(PAGE); }} className={cx("press tag-btn !h-7 !text-[12px]", cat === c && "on")}>{c}</button>)}
          </div>}
          <p className="text-[12px] text-dim">{LIBS.find((l) => l.id === lib)?.note}. {mode === "many" ? "Click a picture to tick it (each angle is its own pick) · ⤢ for a big look · ★ to keep · ⊘ to hide the bad ones." : "Click one to use it."} {list.length} shown.</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {err && <p className="text-[13px] text-bad">{err}</p>}
          {!items && !err && <p className="text-[13px] text-muted">Loading PoseWear…</p>}
          {items && !list.length && <p className="text-[13px] text-muted">{show === "favs" ? "No stars here yet — ★ the ones you like." : show === "hidden" ? "Nothing hidden." : "Nothing matches."}</p>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {list.slice(0, shown).map((it) => {
              const ai = angle[it.key] ?? 0;
              const p = pickOf(it, ai);
              const on = picked.has(p.key) || (mode === "create" && pw.create?.key === p.key);
              const n = it.angles ? it.angles.filter((_, i) => picked.has(`${it.key}#${i}`)).length : 0;
              return (
                <div key={it.key} className={cx("group flex flex-col border bg-raised/40", on ? "border-accent" : "border-line hover:border-muted")}>
                  <div className="relative">
                    <button onClick={() => choose(p)} title={`${p.title}${it.cat ? ` — ${it.cat}` : ""}`} className="press relative block aspect-[3/4] w-full overflow-hidden bg-black/30">
                      <img src={p.thumb} alt={p.title} loading="lazy" referrerPolicy="no-referrer" className={cx("h-full w-full", it.lib === "depths" ? "object-contain" : "object-cover")} />
                      {on && <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accentink"><Icon name="check" size={14} /></span>}
                      {n > 1 && <span className="micro absolute left-1.5 top-1.5 bg-black/75 px-1 text-accent">{n} ANGLES</span>}
                      {it.couple && <span className="micro absolute bottom-1.5 left-1.5 bg-black/75 px-1 text-hot">COUPLE</span>}
                    </button>
                    <span className="absolute bottom-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => setPeek(it)} title="Look closer" className="press flex h-6 w-6 items-center justify-center bg-black/75 text-[12px] text-ink">⤢</button>
                      <button onClick={() => hide(it)} title={pw.hidden[it.key] ? "Show it again" : "Hide it (badly made)"} className="press flex h-6 w-6 items-center justify-center bg-black/75 text-[12px] text-ink">⊘</button>
                    </span>
                    <button onClick={() => star(it)} title={pw.favs[it.key] ? "Unstar" : "Star it"} className={cx("press absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center bg-black/60 text-[13px]", n > 1 && "top-7", pw.favs[it.key] ? "text-accent" : "text-ink opacity-0 group-hover:opacity-100")}>{pw.favs[it.key] ? "★" : "☆"}</button>
                  </div>
                  <div className="flex flex-col gap-1 p-1.5">
                    <span className="line-clamp-2 text-[11.5px] leading-snug" title={it.words}>{it.no ? <span className="font-mono text-dim">{it.no} </span> : null}{it.title}</span>
                    {it.cat && <span className="truncate text-[10.5px] text-dim">{it.cat}</span>}
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

        {peek && <Peek it={peek} ai={angle[peek.key] ?? 0} setAi={(i) => setAngle({ ...angle, [peek.key]: i })} picked={picked} onPick={choose} onClose={() => setPeek(null)} />}
      </div>
    </div>, document.body);
}

/** the big look (like the site's lightbox): the full picture, its angles, the English prompt to copy, pick it */
function Peek({ it, ai, setAi, picked, onPick, onClose }: { it: PwItem; ai: number; setAi: (i: number) => void; picked: Set<string>; onPick: (p: PwPick) => void; onClose: () => void }) {
  const p = pickOf(it, ai);
  return (
    <div className="absolute inset-0 z-10 flex bg-black/85 p-4" onMouseDown={onClose}>
      <div className="mx-auto flex h-full w-full max-w-[1100px] gap-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex min-w-0 flex-1 items-center justify-center"><img src={p.image || p.thumb} alt={p.title} referrerPolicy="no-referrer" className="max-h-full max-w-full object-contain" /></div>
        <div className="flex w-[320px] shrink-0 flex-col gap-3 overflow-y-auto border border-line bg-panel p-4 text-[13px]">
          <div className="flex items-start gap-2"><b className="flex-1">{it.no ? `${it.no} · ` : ""}{it.title}</b><button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink"><Icon name="x" size={15} /></button></div>
          <span className="text-[12px] text-muted">{[it.group, it.cat].filter(Boolean).join(" · ")}{it.couple ? " · two people" : ""}</span>
          {it.angles && <div className="flex flex-wrap gap-1">{it.angles.map((a, i) => <button key={i} onClick={() => setAi(i)} className={cx("press border px-1.5 py-0.5 text-[12px]", i === ai ? "border-accent text-accent" : "border-line text-muted hover:text-ink")}>{a.en}</button>)}</div>}
          <div className="flex flex-col gap-1"><span className="lbl">Prompt (English)</span><p className="rounded-sm border border-line bg-black/20 p-2 text-[12px] leading-relaxed">{p.words}</p>
            <button onClick={() => copyText(p.words, "Copied")} className="press self-start text-[12px] text-accent hover:underline">Copy</button></div>
          <button onClick={() => onPick(p)} className="press btn-primary mt-auto flex h-10 items-center justify-center text-[13px] font-semibold uppercase tracking-wide text-accentink">{picked.has(p.key) ? "Untick" : "Use this one"}</button>
        </div>
      </div>
    </div>);
}

const shortAngle = (en: string) => /front/.test(en) ? "Front" : /above/.test(en) ? "Above" : /below/.test(en) ? "Below" : /three-quarter/.test(en) ? "¾" : /side/.test(en) ? "Side" : en;
