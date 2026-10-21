// Full-screen viewer: wheel zooms at the cursor, drag pans, double-click toggles fit / 100 %, ←/→ flips through,
// Esc closes. Used by the tray (click a thumbnail) and Compose's "Preview export".
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Icon, cx } from "./ui";

export interface ViewItem { url: string; kind: "image" | "video" | "audio" | string; label?: string; trayId?: string; download?: string }
interface ViewerState { items: ViewItem[]; index: number; actions?: (it: ViewItem) => { label: string; run: () => void }[] }
const useViewer = create<ViewerState & { open: boolean }>(() => ({ open: false, items: [], index: 0 }));
export const openViewer = (items: ViewItem[], index = 0, actions?: ViewerState["actions"]) => useViewer.setState({ open: true, items, index, actions });
const close = () => useViewer.setState({ open: false });

export function Viewer() {
  const { open, items, index, actions } = useViewer();
  const it = items[index];
  const [z, setZ] = useState({ s: 1, x: 0, y: 0, fit: true });
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
      if (e.key === "0") fit();
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
        {actions?.(it).map((a) => <button key={a.label} className="press btn-raised h-8 px-3 text-[13px]" onClick={() => { a.run(); close(); }}>{a.label}</button>)}
        <a className="press btn-raised flex h-8 items-center px-3 text-[13px] text-ink" href={it.url} download={it.download ?? true}>Download</a>
        <button className="press btn-raised flex h-8 w-8 items-center justify-center" aria-label="Close" onClick={close}><Icon name="x" size={15} /></button>
      </div>
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
        {it.kind === "image" && <p className="micro pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-white/40">WHEEL ZOOMS · DRAG MOVES · DOUBLE-CLICK 100% · ← → NEXT</p>}
      </div>
    </div>, document.body);
}
