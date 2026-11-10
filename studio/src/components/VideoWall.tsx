// A wall of videos that play by themselves (muted, looping) — like the feeds on CivitAI or Grok: no "See all", no clicking
// in to watch. Only the ones on screen play (the rest wait, so a hundred tiles don't choke the browser). Each tile has its
// own Download; Download all sends one .zip straight from the rental. Click a tile for the full-size viewer with sound.
import { useEffect, useRef, useState } from "react";
import { viewUrl, type FileRef } from "../lib/api";
import { noteSeen, openViewer } from "./Viewer";
import { Icon, cx } from "./ui";

export interface WallItem { file: FileRef; label: string; sub?: string;
  /** Finalize: make this take again at full quality (only on quick drafts whose settings are still known) */
  full?: () => void }

/** the file name a video is saved as: "Mei · loop 3.mp4" rather than h3_00042_.mp4 */
export const saveName = (it: WallItem, i: number) => `${it.label}${it.sub ? ` - ${it.sub}` : ""} ${String(i + 1).padStart(2, "0")}${it.file.filename.match(/\.\w+$/)?.[0] ?? ".mp4"}`.replace(/[\\/:*?"<>|]+/g, "_");

/** one .zip of these videos, saved by the browser as it arrives (a form post: no waiting for the whole file first) */
export function downloadAll(items: WallItem[], name: string) {
  const f = document.createElement("form");
  f.method = "POST"; f.action = "/studio-api/files/zip"; f.target = "h3-dl"; f.style.display = "none";
  const inp = document.createElement("input");
  inp.type = "hidden"; inp.name = "payload";
  inp.value = JSON.stringify({ name, files: items.map((it, i) => ({ ...it.file, as: saveName(it, i) })) });
  f.appendChild(inp);
  let frame = document.querySelector<HTMLIFrameElement>("iframe[name=h3-dl]");
  if (!frame) { frame = document.createElement("iframe"); frame.name = "h3-dl"; frame.style.display = "none"; document.body.appendChild(frame); }
  document.body.appendChild(f); f.submit(); f.remove();
}

/** a video that plays while it's on screen, and loads only when it gets near */
export function AutoVideo({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setNear(true);
      if (e.intersectionRatio >= 0.35) v.play().catch(() => {}); else v.pause();
    }, { rootMargin: "300px 0px", threshold: [0, 0.35] });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return <video ref={ref} src={near ? src : undefined} muted loop playsInline autoPlay preload={near ? "auto" : "none"} className={className} />;
}

export function VideoWall({ items, min = 200, empty, pending }: {
  items: WallItem[]; min?: number; empty?: React.ReactNode;
  /** tiles for videos still rendering (progress bars) */
  pending?: React.ReactNode;
}) {
  const view = (i: number) => openViewer(items.map((it) => ({ url: viewUrl(it.file), kind: "video" as const, label: it.sub ? `${it.label} · ${it.sub}` : it.label })), i);
  if (!items.length && !pending) return <>{empty ?? null}</>;
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}>
      {items.map((it, i) => (
        <div key={it.file.subfolder + it.file.filename} className="group relative overflow-hidden rounded-md border border-line bg-black hover:border-accent">
          <button onClick={() => view(i)} className="block w-full" aria-label={`Open ${it.label} full size`}>
            <AutoVideo src={viewUrl(it.file)} className="aspect-[9/16] w-full object-cover" />
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-1 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6">
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{it.label}{it.sub && <span className="text-muted"> · {it.sub}</span>}</span>
            {it.full && <button onClick={(e) => { e.stopPropagation(); it.full!(); }} title="Finalize: make this take again at full quality — same plan, pictures and seed; Turbo off, at least 1 MP" aria-label={`Finalize ${it.label}`}
              className="pointer-events-auto flex h-7 items-center rounded-md bg-black/70 px-1.5 text-[11px] font-semibold text-ink opacity-0 hover:bg-accent hover:text-black focus:opacity-100 group-hover:opacity-100">Finalize</button>}
            <a href={viewUrl(it.file)} download={saveName(it, i)} onClick={(e) => { e.stopPropagation(); noteSeen([it.file], "dl"); }} title="Download this video" aria-label={`Download ${it.label}`}
              className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md bg-black/70 text-ink opacity-80 hover:bg-accent hover:text-black group-hover:opacity-100">
              <Icon name="down" size={14} />
            </a>
          </div>
        </div>
      ))}
      {pending}
    </div>
  );
}

/** "Download all (12)" */
export function DownloadAll({ items, name, className }: { items: WallItem[]; name: string; className?: string }) {
  if (!items.length) return null;
  return (
    <button onClick={() => downloadAll(items, name)} title="One .zip with every video here, named by character"
      className={cx("press flex items-center gap-1.5 text-accent hover:underline", className)}>
      <Icon name="down" size={13} /> Download all ({items.length})
    </button>
  );
}
