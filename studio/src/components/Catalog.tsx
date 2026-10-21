// The catalog: every picture and video this rental has made, straight from its disk (output/studio), by project folder,
// newest first, searchable by the words it was made from. Nothing here is ever trimmed — the feeds and the tray only show
// the latest; this shows all of it. Click to view, right-click for the usual menu (use in Create / Edit, site, face…).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { viewUrl, type FileRef } from "../lib/api";
import { useCharacters } from "../lib/characters";
import { useSettings } from "../lib/settings";
import { openPictureMenu } from "./PictureMenu";
import { openViewer } from "./Viewer";
import { Icon, cx } from "./ui";

interface CatItem extends FileRef { kind: "image" | "video"; mtime: number; folder: string; tab: string; meta?: { label?: string; prompt?: string; character?: string } }
export const useCatalog = create<{ open: boolean; folder: string | null }>(() => ({ open: false, folder: null }));
/** open the catalog, on a project's folder (null = the project you're in) */
export const openCatalog = (folder?: string | null) => useCatalog.setState({ open: true, folder: folder ?? null });
const cleanFolder = (n: string) => n.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 60) || "Untitled";
const TAB_NAME: Record<string, string> = { create: "Create", edit: "Edit", animate: "Animate", characters: "Characters", finish: "Finish", batch: "Batch", scenes: "Scenes", prompt: "Prompt" };

export function CatalogHost() {
  const open = useCatalog((s) => s.open);
  return open ? <CatalogPanel /> : null;
}

function CatalogPanel() {
  const want = useCatalog((s) => s.folder);
  const sel = useCharacters((s) => s.list.find((c) => c.id === s.sel) ?? null);
  const [folder, setFolder] = useState<string>(() => want ?? (sel ? cleanFolder(sel.name) : ""));
  const [kind, setKind] = useState<"" | "image" | "video">("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CatItem[]>([]);
  const [total, setTotal] = useState(0);
  const [folders, setFolders] = useState<{ name: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const close = () => useCatalog.setState({ open: false });
  const req = useRef(0);
  const load = async (offset: number) => {
    const my = ++req.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ offset: String(offset), limit: "150", ...(folder ? { folder } : {}), ...(kind ? { kind } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
      const r = await fetch(`/studio-api/catalog?${qs}`);
      if (!r.ok) throw new Error(`The rental answered ${r.status}`);
      const d = await r.json();
      if (my !== req.current) return;
      setItems((old) => (offset ? [...old, ...d.items] : d.items)); setTotal(d.total); setFolders(d.folders); setErr("");
      // the project's folder doesn't exist yet (nothing made there): show everything
      if (!offset && folder && !d.folders.some((f: { name: string }) => f.name === folder)) setFolder("");
    } catch (e) { if (my === req.current) setErr((e as Error).message); } finally { if (my === req.current) setLoading(false); }
  };
  useEffect(() => { const t = setTimeout(() => load(0), q ? 300 : 0); return () => clearTimeout(t); }, [folder, kind, q]); // eslint-disable-line react-hooks/exhaustive-deps
  // a menu action that takes you to a tab (Use in Edit, Animate it…): the catalog steps aside
  useEffect(() => useSettings.subscribe((st, prev) => { if (st.s.tab !== prev.s.tab) close(); }), []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[aria-label='Picture viewer']")) close(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  const view = (i: number) => openViewer(items.map((it) => ({ url: viewUrl(it), kind: it.kind, label: it.meta?.label || it.filename, download: it.filename })), i);
  const all = folders.reduce((a, f) => a + f.count, 0);
  return createPortal(
    <div className="fade-in fixed inset-0 z-[80] flex flex-col bg-bg/95 backdrop-blur-[2px]" role="dialog" aria-modal aria-label="Catalog">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <b className="display text-[20px]">Catalog</b>
        <span className="text-[12.5px] text-muted">every picture and video on this rental — {total.toLocaleString()} shown{folder ? ` in ${folder}` : ""}</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the words they were made from" aria-label="Search the catalog"
          className="inset ml-auto h-9 w-72 border border-line px-2.5 text-[13px] focus:border-accent focus:outline-none" />
        <div className="flex gap-1">{([["", "All"], ["image", "Pictures"], ["video", "Videos"]] as const).map(([k, l]) => <button key={l} onClick={() => setKind(k)} className={cx("press tag-btn !h-8 !px-2.5 !text-[12px]", kind === k && "on")}>{l}</button>)}</div>
        <button aria-label="Close" onClick={close} className="press btn-raised flex h-9 w-9 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={15} /></button>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line p-3">
          <span className="micro mb-1 text-dim">PROJECTS</span>
          <button onClick={() => setFolder("")} className={cx("press flex items-center justify-between px-2 py-1.5 text-left text-[13px]", !folder ? "bg-accent/10 text-ink" : "text-muted hover:text-ink")}><span>Everything</span><span className="text-[11px] text-dim">{all}</span></button>
          {folders.map((f) => (
            <button key={f.name} onClick={() => setFolder(f.name)} className={cx("press flex items-center justify-between gap-2 px-2 py-1.5 text-left text-[13px]", folder === f.name ? "bg-accent/10 text-ink" : "text-muted hover:text-ink")}>
              <span className="truncate">{f.name || "Older (no project)"}</span><span className="shrink-0 text-[11px] text-dim">{f.count}</span>
            </button>
          ))}
        </aside>
        <div className="min-h-0 flex-1 overflow-y-auto p-4" onScroll={(e) => { const el = e.currentTarget; if (!loading && items.length < total && el.scrollTop + el.clientHeight > el.scrollHeight - 800) load(items.length); }}>
          {err && <p className="py-10 text-center text-[13px] text-bad">{err}</p>}
          {!err && !loading && !items.length && <p className="py-16 text-center text-[13px] text-muted">{q ? "Nothing made from those words." : "Nothing here yet — everything you make shows up here, for good."}</p>}
          <div className="grid grid-cols-3 gap-2 md:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8">
            {items.map((it, i) => (
              <button key={`${it.subfolder}/${it.filename}`} onClick={() => view(i)} onContextMenu={(e) => openPictureMenu(e, { output: { filename: it.filename, subfolder: it.subfolder, type: "output" }, label: it.meta?.label })}
                title={[it.meta?.label, it.meta?.prompt, `${new Date(it.mtime * 1000).toLocaleString()}`].filter(Boolean).join("\n")}
                draggable={false} className="press group relative aspect-[3/4] overflow-hidden border border-line bg-raised2 hover:border-accent">
                {it.kind === "video"
                  ? <video src={viewUrl(it)} muted loop preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} className="h-full w-full object-cover" />
                  : <img src={viewUrl(it)} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4 text-left text-[10.5px] leading-tight text-white/85 opacity-0 group-hover:opacity-100">
                  {!folder && <b className="block truncate font-medium">{it.folder}</b>}{TAB_NAME[it.tab] ?? it.tab} · {new Date(it.mtime * 1000).toLocaleDateString()}
                </span>
                {it.kind === "video" && <span className="micro absolute left-1 top-1 bg-black/75 px-1 text-cyan">VIDEO</span>}
              </button>
            ))}
            {loading && Array.from({ length: 14 }, (_, i) => <div key={`s${i}`} className="shimmer aspect-[3/4]" />)}
          </div>
        </div>
      </div>
    </div>, document.body);
}
