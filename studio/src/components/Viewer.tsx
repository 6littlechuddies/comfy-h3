// Full-screen viewer: wheel zooms at the cursor, drag pans, double-click toggles fit / 100 %, ←/→ flips through,
// F stars what you're looking at (a favourite: kept at clean-up, findable under ★), Esc closes. Used by the tray (click a thumbnail) and Compose's "Preview export".
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Icon, cx } from "./ui";
import { isFav, toggleFav, useFavs } from "../lib/favs";
import type { FileRef } from "../lib/api";
import { deleteFile, madeBy } from "../lib/made";
import { HowMade } from "./Feed";

/** tell the rental you opened ("open") or downloaded ("dl") these results — clean-up never suggests downloaded ones */
export function noteSeen(files: FileRef[], how: "open" | "dl") {
  if (how === "dl") import("../lib/anon").then(({ keepAnon }) => files.forEach(keepAnon)).catch(() => {});
  if (how === "dl") import("../lib/promptBank").then(({ signal }) => files.forEach((f) => signal(f, "download"))).catch(() => {});
  const out = files.filter((f) => f.type === "output").map((f) => ({ subfolder: f.subfolder, filename: f.filename }));
  if (out.length) fetch("/studio-api/catalog/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: out, how }), keepalive: true }).catch(() => {});
}

/** the file behind a viewer item (a /view?… link), so it can be starred from here — null for anything else */
export function refOfUrl(url: string): FileRef | null {
  try {
    const u = new URL(url, location.origin);
    if (u.pathname !== "/view" && u.pathname !== "/api/view") return null;
    const filename = u.searchParams.get("filename");
    return filename ? { filename, subfolder: u.searchParams.get("subfolder") ?? "", type: (u.searchParams.get("type") ?? "output") as FileRef["type"] } : null;
  } catch { return null; }
}

/** a character's picture made from a CivitAI post: open that post's prompt, settings and LoRAs */
function CharSource({ url }: { url: string }) {
  const [page, setPage] = useState<string | null>(null);
  useEffect(() => { import("../lib/made").then(({ charSourceOf }) => charSourceOf(url)).then(setPage).catch(() => setPage(null)); }, [url]);
  if (!page) return null;
  return <button className="press btn-primary mt-3 h-9 w-full text-[12.5px] font-semibold text-accentink" onClick={() => { import("./ImageImport").then(({ openImageImport }) => openImageImport(page, "link")); close(); }}>The CivitAI post they were made from</button>;
}

export interface ViewItem { url: string; kind: "image" | "video" | "audio" | string; label?: string; trayId?: string; download?: string }
interface ViewerState { items: ViewItem[]; index: number; actions?: (it: ViewItem) => { label: string; run: () => void }[] }
const useViewer = create<ViewerState & { open: boolean }>(() => ({ open: false, items: [], index: 0 }));
export const openViewer = (items: ViewItem[], index = 0, actions?: ViewerState["actions"]) => useViewer.setState({ open: true, items, index, actions });
const close = () => useViewer.setState({ open: false });

export function Viewer() {
  const { open, items, index, actions } = useViewer();
  const it = items[index];
  const favs = useFavs((s) => s.set);
  const ref = it ? refOfUrl(it.url) : null;
  const fav = !!ref && isFav(favs, ref);
  // opened full-size = not "never opened" at clean-up
  useEffect(() => { if (open && ref && ref.type === "output") noteSeen([ref], "open"); }, [open, it?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const [z, setZ] = useState({ s: 1, x: 0, y: 0, fit: true });
  // "How it was made" — the same panel as in Create / Edit, for tray pictures and character pictures too
  const [info, setInfo] = useState(() => { try { return localStorage.getItem("h3.howmade") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("h3.howmade", info ? "1" : "0"); } catch { /* */ } }, [info]);
  const made = ref ? madeBy(ref) : null;
  const canDelete = !!ref && ref.type === "output" && !/^characters\b|\/characters\//.test(ref.subfolder ?? "");
  const del = () => {
    const st = useViewer.getState(); const cur = st.items[st.index]; const r = cur ? refOfUrl(cur.url) : null;
    if (!r || r.type !== "output" || /^characters\b|\/characters\//.test(r.subfolder ?? "")) return;
    deleteFile(r);
    if (cur.trayId) import("../lib/tray").then(({ useTray }) => useTray.getState().remove(cur.trayId!)).catch(() => {});
    const left = st.items.filter((_, i) => i !== st.index);
    if (!left.length) return close();
    useViewer.setState({ items: left, index: Math.min(st.index, left.length - 1) });
  };
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const fitScale = () => {
    const el = box.current; if (!el || !nat.w) return 1;
    return Math.min(el.clientWidth / nat.w, el.clientHeight / nat.h, 1);
  };
  const fit = () => setZ({ s: fitScale(), x: 0, y: 0, fit: true });
  useEffect(() => { if (nat.w) fit(); }, [nat.w, nat.h, index]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setNat({ w: 0, h: 0 }); }, [index, open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      if (e.key === "ArrowRight") useViewer.setState((s) => ({ index: Math.min(s.items.length - 1, s.index + 1) }));
      if (e.key === "ArrowLeft") useViewer.setState((s) => ({ index: Math.max(0, s.index - 1) }));
      if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const cur = useViewer.getState(); const r = cur.items[cur.index] ? refOfUrl(cur.items[cur.index].url) : null;
        if (r) { e.preventDefault(); e.stopPropagation(); toggleFav(r); }
      }
      if (e.key === "0") fit();
      if ((e.key === "i" || e.key === "I") && !e.ctrlKey && !e.metaKey) setInfo((v) => !v);
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); del(); }
      if (e.key === "1") setZ({ s: 1, x: 0, y: 0, fit: false });
    };
    window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
  }, [open, nat.w]); // eslint-disable-line react-hooks/exhaustive-deps
  // wheel zoom around the cursor (non-passive so the page doesn't scroll)
  useEffect(() => {
    const el = box.current; if (!el || !open) return;
    const w = (e: WheelEvent) => {
      if (it?.kind !== "image") return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
      setZ((p) => {
        const s = Math.max(0.05, Math.min(8, p.s * Math.exp(-e.deltaY * 0.0015)));
        const k = s / p.s;
        return { s, x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k, fit: false };
      });
    };
    el.addEventListener("wheel", w, { passive: false }); return () => el.removeEventListener("wheel", w);
  }, [open, it?.kind]);
  if (!open || !it) return null;

  const pct = Math.round(z.s * 100);
  return createPortal(
    <div className="fade-in fixed inset-0 z-[80] flex flex-col bg-black/95" role="dialog" aria-modal aria-label="Viewer">
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <span className="micro text-dim">{String(index + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}</span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{it.label}{nat.w ? <span className="ml-2 font-mono text-[12px] text-dim">{nat.w}×{nat.h}</span> : null}</span>
        {it.kind === "image" && (
          <div className="flex items-center gap-1">
            <button className="press btn-raised h-8 w-8" aria-label="Zoom out" onClick={() => setZ((p) => ({ ...p, s: Math.max(0.05, p.s / 1.25), fit: false }))}>−</button>
            <button className="press btn-raised h-8 px-2.5 font-mono text-[12px]" onClick={fit} title="Fit (0)">{z.fit ? "Fit" : `${pct}%`}</button>
            <button className="press btn-raised h-8 w-8" aria-label="Zoom in" onClick={() => setZ((p) => ({ ...p, s: Math.min(8, p.s * 1.25), fit: false }))}>+</button>
            <button className="press btn-raised h-8 px-2.5 font-mono text-[12px]" onClick={() => setZ({ s: 1, x: 0, y: 0, fit: false })} title="Actual pixels (1)">100%</button>
          </div>
        )}
        {it.kind !== "audio" && <button onClick={() => setInfo((v) => !v)} aria-pressed={info} className={cx("press btn-raised flex h-8 items-center gap-1.5 px-3 text-[13px]", info ? "text-accent" : "text-ink")} title="How it was made (I)"><Icon name="search" size={13} /> How it was made</button>}
        {actions?.(it).map((a) => <button key={a.label} className="press btn-raised h-8 px-3 text-[13px]" onClick={() => { a.run(); close(); }}>{a.label}</button>)}
        {ref && <button className={cx("press btn-raised flex h-8 items-center gap-1.5 px-3 text-[13px]", fav ? "text-accent" : "text-ink")} aria-pressed={fav} onClick={() => toggleFav(ref)}
          title={fav ? "Starred — press F to un-star" : "Star it (F): kept at clean-up, and under ★ in your results"}>{fav ? "★" : "☆"} <span className="font-mono text-[11px] text-dim">F</span></button>}
        <a className="press btn-raised flex h-8 items-center px-3 text-[13px] text-ink" href={it.url} download={it.download ?? true} onClick={() => { if (ref) noteSeen([ref], "dl"); }}>Download</a>
        {canDelete && <button className="press btn-raised flex h-8 w-8 items-center justify-center hover:text-bad" aria-label="Delete" title="Delete this file (Delete key)" onClick={del}><Icon name="trash" size={14} /></button>}
        <button className="press btn-raised flex h-8 w-8 items-center justify-center" aria-label="Close" onClick={close}><Icon name="x" size={15} /></button>
      </div>
      <div className="flex min-h-0 flex-1">
      <div ref={box} className={cx("relative min-h-0 flex-1 overflow-hidden", it.kind === "image" && (z.s > fitScale() + 0.001 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"))}
        onPointerDown={(e) => { if (it.kind !== "image") return; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: z.x, oy: z.y }; }}
        onPointerMove={(e) => { const d = drag.current; if (d) setZ((p) => ({ ...p, x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y, fit: false })); }}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={() => (z.fit ? setZ({ s: 1, x: 0, y: 0, fit: false }) : fit())}
        onClick={(e) => { if (e.target === e.currentTarget && z.fit) close(); }}>
        {it.kind === "image" ? (
          <img src={it.url} alt={it.label ?? ""} draggable={false} onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
            style={{ width: nat.w || undefined, height: nat.h || undefined, transform: `translate(-50%, -50%) translate(${z.x}px, ${z.y}px) scale(${z.s})`, transition: drag.current ? "none" : "transform .12s ease-out", imageRendering: z.s >= 2 ? "pixelated" : "auto" }} />
        ) : it.kind === "video" ? (
          <video src={it.url} controls autoPlay loop className="absolute inset-0 m-auto max-h-full max-w-full" />
        ) : <audio src={it.url} controls autoPlay className="absolute inset-x-0 top-1/2 mx-auto w-[min(600px,90%)]" />}
        {items.length > 1 && <>
          <button aria-label="Previous" disabled={index === 0} onClick={() => useViewer.setState({ index: index - 1 })} className="press glass-btn absolute left-4 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center disabled:opacity-25"><Icon name="back" size={18} /></button>
          <button aria-label="Next" disabled={index >= items.length - 1} onClick={() => useViewer.setState({ index: index + 1 })} className="press glass-btn absolute right-4 top-1/2 flex h-12 w-12 -translate-y-1/2 rotate-180 items-center justify-center disabled:opacity-25"><Icon name="back" size={18} /></button>
        </>}
        {it.kind === "image" && <p className="micro pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-white/40">WHEEL ZOOMS · DRAG MOVES · DOUBLE-CLICK 100% · ← → NEXT · I HOW IT WAS MADE</p>}
      </div>
      {info && (made ? <HowMade it={made} onClose={() => setInfo(false)} done={close} />
        : <aside className="w-[340px] shrink-0 border-l border-white/10 bg-black/40 p-4 text-[12.5px]">
            <div className="mb-2 flex items-center"><span className="micro text-white/60">HOW IT WAS MADE</span><button onClick={() => setInfo(false)} aria-label="Close" className="ml-auto text-white/60 hover:text-white"><Icon name="x" size={14} /></button></div>
            <p className="text-white/70">Not one of this browser's results (an upload, or made on another rental) — whatever's inside the file can still be read.</p>
            <CharSource url={it.url} />
            <button className="press btn-primary mt-3 h-9 w-full text-[12.5px] font-semibold text-accentink" onClick={async () => {
              const { readFromFile } = await import("./ImageImport");
              if (await readFromFile(ref ?? null, it.url, it.label ?? ref?.filename ?? "result", it.kind === "video")) close();
            }}>Read it from the file</button>
          </aside>)}
      </div>
    </div>, document.body);
}
