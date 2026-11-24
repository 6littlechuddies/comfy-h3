// The catalog: every picture and video this rental has made, straight from its disk (output/studio), by project folder,
// newest first, searchable by the words it was made from. Nothing here is ever trimmed — the feeds and the tray only show
// the latest; this shows all of it. Click to view, right-click for the usual menu (use in Create / Edit, site, face…).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { viewUrl, type FileRef } from "../lib/api";
import { coverOf, useCharacters } from "../lib/characters";
import { isFav, toggleFav, useFavs } from "../lib/favs";
import { useJobs } from "../lib/jobs";
import { deleteFile } from "../lib/made";
import { moveResults } from "../lib/move";
import { askConfirm } from "./Dialogs";
import { useSettings } from "../lib/settings";
import { openPictureMenu } from "./PictureMenu";
import { openViewer } from "./Viewer";
import { DropSelect, Icon, cx } from "./ui";

interface CatItem extends FileRef { kind: "image" | "video"; mtime: number; folder: string; tab: string; meta?: { label?: string; prompt?: string; character?: string; project?: string } }
export const useCatalog = create<{ open: boolean; folder: string | null; q: string }>(() => ({ open: false, folder: null, q: "" }));
/** open the catalog, on a project's folder (null = the project you're in) */
export const openCatalog = (folder?: string | null, q = "") => useCatalog.setState({ open: true, folder: folder ?? null, q });
/** search every project's results by the words they were made from */
export const searchResults = (q: string) => openCatalog("", q);
const cleanFolder = (n: string) => n.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 60) || "Untitled";
const TAB_NAME: Record<string, string> = { create: "Create", edit: "Edit", animate: "Animate", characters: "Characters", finish: "Finish", batch: "Batch", scenes: "Scenes", prompt: "Prompt" };

export function CatalogHost() {
  const open = useCatalog((s) => s.open);
  return open ? <CatalogPanel /> : null;
}

type Folder = { name: string; count: number; thumb?: FileRef };
const fileKey = (it: { subfolder: string; filename: string }) => `${it.subfolder}/${it.filename}`;
const asRef = (it: CatItem): FileRef => ({ filename: it.filename, subfolder: it.subfolder, type: "output" });

function CatalogPanel() {
  const want = useCatalog((s) => s.folder);
  const sel = useCharacters((s) => s.list.find((c) => c.id === s.sel) ?? null);
  const chars = useCharacters((s) => s.list);
  /** a character's keys: their id (results made in or moved to their project) and every folder name they've had */
  const keysOf = (c: { id: string; name: string; names?: string[] }) => [`@${c.id}`, ...new Set([c.name, ...(c.names ?? [])].filter(Boolean).map(cleanFolder))].join("\n");
  const [folder, setFolder] = useState<string>(() => want ?? (sel ? keysOf(sel) : ""));
  const [kind, setKind] = useState<"" | "image" | "video">("");
  const [onlyFav, setOnlyFav] = useState(false);
  const [q, setQ] = useState(() => useCatalog.getState().q);
  const [items, setItems] = useState<CatItem[]>([]);
  const [total, setTotal] = useState(0);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState<Record<string, CatItem>>({});
  const anchor = useRef<number | null>(null);
  const favs = useFavs((s) => s.set);
  const toast = useJobs((s) => s.toast);
  const close = () => useCatalog.setState({ open: false });
  const req = useRef(0);
  const load = async (offset: number) => {
    const my = ++req.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ offset: String(offset), limit: "150", ...(folder ? { folder } : {}), ...(kind ? { kind } : {}), ...(q.trim() ? { q: q.trim() } : {}), ...(onlyFav ? { fav: "1" } : {}) });
      const r = await fetch(`/studio-api/catalog?${qs}`);
      if (!r.ok) throw new Error(`The rental answered ${r.status}`);
      const d = await r.json();
      if (my !== req.current) return;
      setItems((old) => (offset ? [...old, ...d.items] : d.items)); setTotal(d.total); setFolders(d.folders); setErr("");
      // the project's folder doesn't exist yet (nothing made there): show everything
      if (!offset && folder && !folder.split("\n").some((k) => d.folders.some((f: { name: string }) => f.name === k))) setFolder("");
    } catch (e) { if (my === req.current) setErr((e as Error).message); } finally { if (my === req.current) setLoading(false); }
  };
  useEffect(() => { const t = setTimeout(() => load(0), q ? 300 : 0); return () => clearTimeout(t); }, [folder, kind, q, onlyFav]); // eslint-disable-line react-hooks/exhaustive-deps
  // a menu action that takes you to a tab (Use in Edit, Animate it…): the catalog steps aside
  useEffect(() => useSettings.subscribe((st, prev) => { if (st.s.tab !== prev.s.tab) close(); }), []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[aria-label='Picture viewer']")) { if (Object.keys(picked).length) setPicked({}); else close(); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [picked]);
  const view = (i: number) => openViewer(items.map((it) => ({ url: viewUrl(it), kind: it.kind, label: it.meta?.label || it.filename, download: it.filename })), i);
  const all = folders.reduce((a, f) => a + f.count, 0);
  const nPicked = Object.keys(picked).length;
  const selecting = nPicked > 0;
  const click = (e: React.MouseEvent, i: number) => {
    const it = items[i];
    if (!(selecting || e.shiftKey || e.ctrlKey || e.metaKey)) { view(i); return; }
    const next = { ...picked };
    if (e.shiftKey && anchor.current != null) { for (let k = Math.min(anchor.current, i); k <= Math.max(anchor.current, i); k++) next[fileKey(items[k])] = items[k]; }
    else if (next[fileKey(it)]) delete next[fileKey(it)]; else next[fileKey(it)] = it;
    anchor.current = i; setPicked(next);
  };
  const tick = (i: number, shift: boolean) => {
    const it = items[i]; const next = { ...picked };
    if (shift && anchor.current != null) { for (let k = Math.min(anchor.current, i); k <= Math.max(anchor.current, i); k++) next[fileKey(items[k])] = items[k]; }
    else if (next[fileKey(it)]) delete next[fileKey(it)]; else next[fileKey(it)] = it;
    anchor.current = i; setPicked(next);
  };
  const removeLocal = (gone: CatItem[]) => {
    const g = new Set(gone.map(fileKey));
    setItems((old) => old.filter((x) => !g.has(fileKey(x)))); setTotal((t) => Math.max(0, t - gone.length));
    setPicked((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !g.has(k))));
  };
  const del = async (list: CatItem[]) => {
    if (!list.length) return;
    if (list.length > 1 && !(await askConfirm(`Delete ${list.length} ${list.length === 1 ? "picture" : "pictures and videos"}?`, "Their files are removed from this rental (and from your next backup). This can't be undone.", "Delete", true))) return;
    for (const it of list) deleteFile(asRef(it));
    removeLocal(list); toast(`Deleted ${list.length}`, "good");
  };
  const fav = (list: CatItem[]) => {
    const on = list.some((it) => !isFav(favs, asRef(it)));
    for (const it of list) if (isFav(useFavs.getState().set, asRef(it)) !== on) toggleFav(asRef(it));
    if (onlyFav && !on) removeLocal(list);
  };
  const move = (list: CatItem[], project: string | null) => {
    if (!list.length) return;
    moveResults(list.map((it) => ({ jobId: "", filename: it.filename, subfolder: it.subfolder })), project);
    const name = project ? chars.find((c) => c.id === project)?.name ?? "that project" : "Free work";
    toast(`Moved ${list.length} to ${project ? `${name}'s project` : "Free work"}`, "good");
    setPicked({}); setTimeout(() => load(0), 400);
  };
  // the project list: one row per character under their current name, by kind (realistic, cosplays, anime), with their face
  const count = new Map(folders.map((f) => [f.name, f.count]));
  const thumb = new Map(folders.map((f) => [f.name, f.thumb]));
  const used = new Set<string>();
  const rows = chars.map((c) => {
    const keys = keysOf(c).split("\n"); keys.forEach((k) => used.add(k));
    return { key: keys.join("\n"), id: c.id as string | null, name: c.name, n: keys.reduce((a, k) => a + (count.get(k) ?? 0), 0), face: coverOf(c) ?? keys.map((k) => thumb.get(k)).find(Boolean),
      group: c.style === "anime" ? "Anime" : /^Cosplay of /.test(c.source ?? "") ? "Realistic cosplays" : "Realistic" };
  });
  const rest = folders.filter((f) => !used.has(f.name) && !f.name.startsWith("@")).map((f) => ({ key: f.name, id: null as string | null, name: f.name || "Older (no project)", n: f.count, face: f.thumb, group: "Other folders" }));
  const goneKeys = folders.filter((f) => f.name.startsWith("@") && !used.has(f.name));
  const gone = goneKeys.reduce((a, f) => a + f.count, 0);
  const groups = ["Realistic", "Realistic cosplays", "Anime", "Other folders"].map((g) => ({ g, rows: [...rows, ...rest].filter((r) => r.group === g && (r.n > 0 || (r.id && g !== "Other folders"))).sort((a, b) => b.n - a.n) })).filter((x) => x.rows.length);
  // the character the site buttons are for: the project whose folder is open, else the one picked on the left
  const siteChar = chars.find((c) => folder.split("\n")[0] === `@${c.id}`) ?? sel;
  const [dropOn, setDropOn] = useState<string | null>(null);
  const dragList = (it: CatItem) => (picked[fileKey(it)] ? Object.values(picked) : [it]);
  const projectRow = (r: { key: string; id: string | null; name: string; n: number; face?: FileRef }) => (
    <button key={r.key} onClick={() => setFolder(r.key)}
      onDragOver={(e) => { if (!r.id || !e.dataTransfer.types.includes(CAT_DRAG)) return; e.preventDefault(); setDropOn(r.key); }}
      onDragLeave={() => setDropOn((d) => (d === r.key ? null : d))}
      onDrop={(e) => { setDropOn(null); if (!r.id) return; try { move(JSON.parse(e.dataTransfer.getData(CAT_DRAG)), r.id); } catch { /* */ } }}
      title={r.id ? `${r.name} — drop pictures here to move them into this project` : r.name}
      className={cx("press flex items-center gap-2 px-1.5 py-1 text-left text-[13px]", folder === r.key ? "bg-accent/10 text-ink" : "text-muted hover:bg-hover hover:text-ink", dropOn === r.key && "outline outline-2 outline-accent bg-accent/15")}>
      <span className="h-8 w-8 shrink-0 overflow-hidden border border-line bg-raised2">{r.face ? <img src={viewUrl(r.face)} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-[12px] font-semibold text-dim">{r.name.slice(0, 1).toUpperCase()}</span>}</span>
      <span className="min-w-0 flex-1 truncate">{r.name}</span><span className="shrink-0 text-[11px] text-dim">{r.n}</span>
    </button>);
  return createPortal(
    <div className="fade-in fixed inset-0 z-[80] flex flex-col bg-bg/95 backdrop-blur-[2px]" role="dialog" aria-modal aria-label="Catalog">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <b className="display text-[20px]">Catalog</b>
        <span className="text-[12.5px] text-muted">{total.toLocaleString()} {onlyFav ? "favourites" : "shown"}{folder ? ` in ${chars.find((c) => folder.split("\n").includes(`@${c.id}`))?.name ?? (folder.split("\n")[0] || "Older (no project)")}` : ""}</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the words they were made from" aria-label="Search the catalog"
          className="inset ml-auto h-9 w-72 border border-line px-2.5 text-[13px] focus:border-accent focus:outline-none" />
        <div className="flex gap-1">{([["", "All"], ["image", "Pictures"], ["video", "Videos"]] as const).map(([k, l]) => <button key={l} onClick={() => setKind(k)} className={cx("press tag-btn !h-8 !px-2.5 !text-[12px]", kind === k && "on")}>{l}</button>)}
          <button onClick={() => setOnlyFav((v) => !v)} aria-pressed={onlyFav} className={cx("press tag-btn !inline-flex !h-8 !flex-row items-center gap-1.5 !px-2.5 !text-[12px]", onlyFav && "on")}><StarIcon on={onlyFav} /> Favourites</button></div>
        <CatalogMore chars={chars} onDone={() => load(0)} />
        <button aria-label="Close" onClick={close} className="press btn-raised flex h-9 w-9 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={15} /></button>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line p-3">
          <button onClick={() => { setFolder(""); setOnlyFav(false); }} className={cx("press flex items-center justify-between px-2 py-1.5 text-left text-[13px]", !folder && !onlyFav ? "bg-accent/10 text-ink" : "text-muted hover:text-ink")}><span>Everything</span><span className="text-[11px] text-dim">{all}</span></button>
          <button onClick={() => { setFolder(""); setOnlyFav(true); }} className={cx("press flex items-center justify-between px-2 py-1.5 text-left text-[13px]", !folder && onlyFav ? "bg-accent/10 text-ink" : "text-muted hover:text-ink")}><span className="flex items-center gap-1.5"><StarIcon on /> Favourites</span><span className="text-[11px] text-dim">{Object.keys(favs).filter((k) => k.startsWith("output/")).length}</span></button>
          {groups.map(({ g, rows: rs }) => (
            <div key={g} className="mt-2 flex flex-col gap-0.5">
              <span className="px-1.5 pb-0.5 text-[11px] font-semibold text-dim">{g}</span>
              {rs.map(projectRow)}
            </div>
          ))}
          {gone > 0 && <div className="mt-2 flex flex-col">{projectRow({ key: goneKeys.map((f) => f.name).join("\n"), id: null, name: "Deleted characters", n: gone })}</div>}
          <p className="mt-3 px-1.5 text-[11.5px] leading-relaxed text-dim">Shift-click pictures to pick a run of them, then drag them onto a character here to move them into that project.</p>
        </aside>
        <div className="min-h-0 flex-1 overflow-y-auto p-4" onScroll={(e) => { const el = e.currentTarget; if (!loading && items.length < total && el.scrollTop + el.clientHeight > el.scrollHeight - 800) load(items.length); }}>
          {err && <p className="py-10 text-center text-[13px] text-bad">{err}</p>}
          {!err && !loading && !items.length && <p className="py-16 text-center text-[13px] text-muted">{q ? "Nothing made from those words." : onlyFav ? "No favourites here yet — hover a picture and press ★." : "Nothing here yet — everything you make shows up here, for good."}</p>}
          <div className="grid grid-cols-3 gap-2 md:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8">
            {items.map((it, i) => {
              const on = !!picked[fileKey(it)]; const star = isFav(favs, asRef(it));
              return (
                <div key={fileKey(it)} className={cx("group relative aspect-[3/4] overflow-hidden border bg-raised2", on ? "border-accent outline outline-2 outline-accent" : "border-line hover:border-accent")}
                  draggable onDragStart={(e) => { const l = dragList(it); e.dataTransfer.setData(CAT_DRAG, JSON.stringify(l)); e.dataTransfer.effectAllowed = "move"; }}>
                  <button onClick={(e) => click(e, i)} onContextMenu={(e) => openPictureMenu(e, { output: asRef(it), label: it.meta?.label })}
                    title={[it.meta?.label, it.meta?.prompt, `${new Date(it.mtime * 1000).toLocaleString()}`].filter(Boolean).join("\n")} className="block h-full w-full">
                    {it.kind === "video"
                      ? <video src={viewUrl(it)} muted loop preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} className="h-full w-full object-cover" />
                      : <img src={viewUrl(it)} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />}
                  </button>
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4 text-left text-[10.5px] leading-tight text-white/85 opacity-0 group-hover:opacity-100">
                    {!folder && <b className="block truncate font-medium">{it.meta?.project ? chars.find((c) => c.id === it.meta?.project)?.name ?? it.folder : it.folder}</b>}{TAB_NAME[it.tab] ?? it.tab} · {new Date(it.mtime * 1000).toLocaleDateString()}
                  </span>
                  <button onClick={(e) => tick(i, e.shiftKey)} aria-label={on ? "Unselect" : "Select"} aria-pressed={on} title="Select (Shift+click: everything in between)"
                    className={cx("absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-sm border", on ? "border-accent bg-accent text-accentink" : "border-white/50 bg-black/45 text-transparent opacity-0 hover:text-white group-hover:opacity-100", selecting && "opacity-100")}><Icon name="check" size={13} /></button>
                  <span className={cx("absolute right-1 top-1 flex gap-1", star ? "" : "opacity-0 group-hover:opacity-100")}>
                    <button onClick={() => fav([it])} aria-label={star ? "Unfavourite" : "Favourite"} title={star ? "Take off favourites" : "Favourite (★): kept at clean-up"} className="flex h-6 w-6 items-center justify-center rounded-sm bg-black/55 hover:bg-black/80"><StarIcon on={star} /></button>
                    <button onClick={() => void del([it])} aria-label="Delete" title="Delete" className="flex h-6 w-6 items-center justify-center rounded-sm bg-black/55 text-white/85 opacity-0 hover:bg-bad/80 hover:text-white group-hover:opacity-100"><Icon name="trash" size={12} /></button>
                  </span>
                  {it.kind === "video" && <span className="micro pointer-events-none absolute bottom-1 right-1 bg-black/75 px-1 text-cyan">VIDEO</span>}
                </div>);
            })}
            {loading && Array.from({ length: 14 }, (_, i) => <div key={`s${i}`} className="shimmer aspect-[3/4]" />)}
          </div>
        </div>
      </div>
      {selecting && (
        <div className="fade-up flex flex-wrap items-center gap-2 border-t border-line bg-panel px-5 py-2.5 text-[13px]">
          <b>{nPicked} picked</b>
          {siteChar && <SiteRoles c={siteChar} picked={Object.values(picked).map(asRef)} onDone={() => setPicked({})} />}
          <button onClick={() => setPicked(Object.fromEntries(items.map((x) => [fileKey(x), x])))} className="text-muted underline-offset-2 hover:text-ink hover:underline">All {items.length} loaded</button>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <button onClick={() => fav(Object.values(picked))} className="press chip-raised flex h-8 items-center gap-1.5 rounded-sm px-3"><StarIcon on /> Favourite</button>
            <DropSelect value="" aria-label="Move to a project" onChange={(e) => { const v = e.target.value; if (v) move(Object.values(picked), v === "@free" ? null : v); }} className="inset h-8 border border-line bg-raised px-2 text-[12.5px]">
              <option value="">Move to…</option><option value="@free">Free work</option>
              {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </DropSelect>
            <button onClick={() => void del(Object.values(picked))} className="press flex h-8 items-center gap-1.5 rounded-sm border border-bad/50 px-3 text-bad hover:bg-bad/10"><Icon name="trash" size={13} /> Delete</button>
            <button onClick={() => setPicked({})} className="text-muted hover:text-ink">Clear</button>
          </span>
        </div>
      )}
    </div>, document.body);
}

const CAT_DRAG = "application/x-h3-catalog";
function StarIcon({ on }: { on?: boolean }) {
  return <svg width={12} height={12} viewBox="0 0 24 24" fill={on ? "#F0A845" : "none"} stroke={on ? "#F0A845" : "currentColor"} strokeWidth="2" aria-hidden><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>;
}

/** Sort into characters (cosplay results go to the character made from that cosplay) and Bring back old pictures */
function CatalogMore({ chars, onDone }: { chars: { id: string; name: string; source?: string; style?: string }[]; onDone: () => void }) {
  const [busy, setBusy] = useState("");
  const zip = useRef<HTMLInputElement>(null);
  const toast = useJobs((s) => s.toast);
  const sort = async () => {
    setBusy("Looking…");
    try {
      // every result not in a project yet, with the words it was made from
      const all: CatItem[] = [];
      for (let off = 0; ; off += 500) {
        const d = await (await fetch(`/studio-api/catalog?offset=${off}&limit=500`)).json();
        all.push(...d.items); if (all.length >= d.total || !d.items.length) break;
      }
      const plan = sortPlan(all, chars);
      if (!plan.length) { toast("Nothing to sort — every cosplay picture with a matching character is already in its project", "info"); return; }
      const n = plan.reduce((a, p) => a + p.items.length, 0);
      if (!(await askConfirm(`Sort ${n} picture${n === 1 ? "" : "s"} into ${plan.length} character${plan.length === 1 ? "" : "s"}?`,
        plan.slice(0, 12).map((p) => `${p.name}: ${p.items.length}`).join(" · ") + (plan.length > 12 ? ` · and ${plan.length - 12} more` : "") + ". They're matched by the cosplay each was made from (or the character's name in its words). Pictures already in a project stay where they are.", "Sort them"))) return;
      for (const p of plan) moveResults(p.items.map((it) => ({ jobId: "", filename: it.filename, subfolder: it.subfolder })), p.id);
      toast(`Sorted ${n} into ${plan.length} project${plan.length === 1 ? "" : "s"}`, "good"); onDone();
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  return (
    <span className="flex gap-1">
      <button onClick={() => void sort()} disabled={!!busy} title="Cosplay pictures go to the character you made from that cosplay; pictures whose words name one of your characters go to that character. Ones already in a project stay." className="press tag-btn !h-8 !px-2.5 !text-[12px]">{busy || "Sort into characters"}</button>
      <button onClick={() => zip.current?.click()} title="Bring back the pictures and videos of an older Export all .zip — only those and how each was made (plus characters you don't have any more). Your settings, LoRAs and characters stay exactly as they are now." className="press tag-btn !inline-flex !h-8 !flex-row items-center gap-1.5 !px-2.5 !text-[12px]"><Icon name="up" size={12} /> Bring back old pictures</button>
      <input ref={zip} type="file" multiple accept=".zip,application/zip,application/x-zip-compressed" hidden onChange={async (e) => {
        const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (!fs.length) return;
        const { importCharacters } = await import("../lib/characters");
        for (const f of fs) { try { await importCharacters(f, "pictures"); } catch { /* the import card shows it */ } }
        onDone();
      }} />
    </span>
  );
}

/** which project each loose result belongs to: the cosplay it was made from ("Cosplay · Makima (Chainsaw Man)") matched to
 *  the character whose source is that cosplay, else a character named in its words */
export function sortPlan(all: CatItem[], chars: { id: string; name: string; source?: string }[]): { id: string; name: string; items: CatItem[] }[] {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const bySource = chars.map((c) => ({ c, key: norm((c.source ?? "").replace(/^Cosplay of /, "")), first: norm((c.source ?? "").replace(/^Cosplay of /, "").replace(/\s*\(.*$/, "")) })).filter((x) => x.key);
  const byName = chars.filter((c) => c.name.length >= 3).map((c) => ({ c, key: norm(c.name) }));
  const out = new Map<string, { id: string; name: string; items: CatItem[] }>();
  for (const it of all) {
    if (it.meta?.project) continue;
    const words = norm(`${it.meta?.label ?? ""} ${(it.meta as { idea?: string } | undefined)?.idea ?? ""}`);
    if (!words) continue;
    const hit = bySource.find((x) => words.includes(x.key))?.c ?? bySource.find((x) => x.first.length >= 3 && words.includes(x.first))?.c
      ?? byName.find((x) => new RegExp(`(^| )${x.key}( |$)`).test(words))?.c;
    if (!hit) continue;
    if (!out.has(hit.id)) out.set(hit.id, { id: hit.id, name: hit.name, items: [] });
    out.get(hit.id)!.items.push(it);
  }
  return [...out.values()].sort((a, b) => b.items.length - a.items.length);
}

/** the selection bar's "for her site" part: her card (+ its hover loop), banner and profile carousel, from the ticked pictures */
function SiteRoles({ c, picked, onDone }: { c: { id: string; name: string; site?: { galleryFiles?: FileRef[] } }; picked: FileRef[]; onDone: () => void }) {
  const [loop, setLoop] = useState(() => { try { return localStorage.getItem("h3.cat.cardLoop") !== "0"; } catch { return true; } });
  const pics = picked.filter((f) => !/\.(mp4|webm|mov|gif)$/i.test(f.filename));
  const one = pics.length === 1;
  const btn = "press chip-raised flex h-8 items-center gap-1.5 rounded-sm px-3 disabled:opacity-40";
  const run = async (f: () => Promise<unknown>) => { try { await f(); onDone(); } catch (e) { useJobs.getState().toast((e as Error).message, "bad"); } };
  return (
    <span className="flex flex-wrap items-center gap-2 border-l border-line pl-3">
      <span className="text-muted">For {c.name} on your site:</span>
      <button className={btn} disabled={!one} title={one ? "Her card: the picture on the grid and in chat (her cover photo)" : "Tick exactly one picture"}
        onClick={() => run(async () => (await import("../lib/siteMedia")).setCard(c.id, pics[0], { loop }))}>★ Card</button>
      <label className="flex items-center gap-1 text-[12px] text-muted" title="Animate the card into her hover loop (a 5 s seamless loop, made in the queue)">
        <input type="checkbox" checked={loop} onChange={(e) => { setLoop(e.target.checked); try { localStorage.setItem("h3.cat.cardLoop", e.target.checked ? "1" : "0"); } catch { /* */ } }} /> + hover loop</label>
      <button className={btn} disabled={!pics.length} title="Her profile carousel, after her card — up to 12, seen by everyone (no nudity)"
        onClick={() => run(async () => (await import("../lib/siteMedia")).addToCarousel(c.id, pics))}>Carousel +{pics.length} <span className="text-dim">({c.site?.galleryFiles?.length ?? 0}/12)</span></button>
      <button className={btn} disabled={!one} title={one ? "The wide banner at the top of the explore page" : "Tick exactly one picture"}
        onClick={() => run(async () => (await import("../lib/siteMedia")).setBanner(c.id, pics[0]))}>Banner</button>
    </span>
  );
}
