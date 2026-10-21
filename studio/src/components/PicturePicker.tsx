// Under a picture slot: fill it from your own pictures (results, uploads — the tray) or from CivitAI, without dragging.
import { useEffect, useRef, useState } from "react";
import { viewUrl } from "../lib/api";
import { useTray, type Media } from "../lib/tray";
import { Icon, cx } from "./ui";

export function PicturePicker({ onPick, civitai, what = "picture" }: { onPick: (m: Media) => void; civitai?: () => void; what?: string }) {
  const [open, setOpen] = useState(false);
  const items = useTray((s) => s.items).filter((i) => i.kind === "image").slice(0, 60);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <div ref={box} className="relative mt-1 flex gap-1" data-esc-own>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        title="Your results and uploads" className={cx("press flex h-7 min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap border text-[11.5px]", open ? "border-accent text-accent" : "border-line text-muted hover:text-ink")}>
        <Icon name="image" size={12} />Pictures
      </button>
      {civitai && (
        <button type="button" onClick={civitai} title="Open your CivitAI collections (or paste a post link) and pick one for this slot"
          className="press flex h-7 min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap border border-line text-[11.5px] text-muted hover:text-ink">
          <Icon name="search" size={12} />CivitAI
        </button>
      )}
      {open && (
        <div role="dialog" aria-label={`Pick a ${what}`} className="absolute left-0 top-full z-40 mt-1 w-[min(420px,calc(100vw-32px))] border border-line bg-panel p-2 shadow-2xl">
          {items.length === 0 ? <p className="p-3 text-[12px] text-muted">No pictures yet — results and uploads show up here (and in the tray at the bottom).</p> : (
            <div className="grid max-h-[340px] grid-cols-4 gap-1 overflow-y-auto">
              {items.map((it) => (
                <button key={it.id} type="button" title={it.label} className="press aspect-[3/4] overflow-hidden border border-line2 hover:border-accent"
                  onClick={async () => { setOpen(false); onPick(await useTray.getState().asMedia(it.id)); }}>
                  <img src={viewUrl(it.src)} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
