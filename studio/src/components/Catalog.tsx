// The catalog: every picture and video this rental has made, straight from its disk (output/studio), by project folder,
// newest first, searchable by the words it was made from. Nothing here is ever trimmed — the feeds and the tray only show
// the latest; this shows all of it. Click to view, right-click for the usual menu (use in Create / Edit, site, face…).
import { Thumb } from "./Thumb";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { toInput, viewUrl, type FileRef } from "../lib/api";
import { coverOf, useCharacters, type Character } from "../lib/characters";
import { isFav, toggleFav, useFavs } from "../lib/favs";
import { buildEdit, type ApiGraph } from "../lib/graphs";
import { useJobs } from "../lib/jobs";
import { deleteFile } from "../lib/made";
import { moveResults } from "../lib/move";
import { askConfirm } from "./Dialogs";
import { editArgs, newSeed, useSettings } from "../lib/settings";
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
  const [remaking, setRemaking] = useState<Record<string, { pct: number; step?: string }>>({});
  const remakeUnsubs = useRef<(() => void)[]>([]);
  const anchor = useRef<number | null>(null);
  const favs = useFavs((s) => s.set);
  const toast = useJobs((s) => s.toast);
  const close = () => useCatalog.setState({ open: false });
  useEffect(() => () => { remakeUnsubs.current.forEach((u) => u()); remakeUnsubs.current = []; }, []);
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
  // ticked pictures → characters (cosplay ones grouped and named by their Batch label, as from the results feed)
  const newChars = async (list: CatItem[]) => {
    const pics = list.filter((it) => it.kind === "image");
    if (!pics.length) { toast("Tick pictures (not videos)", "info"); return; }
    toast(`Making characters from ${pics.length} picture${pics.length > 1 ? "s" : ""} — reading each one takes about half a minute`, "info");
    try {
      const { charactersFromResults } = await import("../lib/newChar");
      const r = await charactersFromResults(pics.map((it) => ({ o: { ...asRef(it), type: "output" }, label: it.meta?.label ?? it.filename })), { gallery: true, onStep: (m) => toast(m, "info") });
      toast(`Made ${r.made.length}: ${r.made.map((c) => c.site?.name ? `${c.name} (site: ${c.site.name})` : c.name).join(", ")}${r.failed.length ? ` · didn't go: ${r.failed.join("; ").slice(0, 200)}` : ""}`, r.made.length ? "good" : "bad");
      setPicked({}); setTimeout(() => load(0), 400);
    } catch (e) { toast((e as Error).message, "bad"); }
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
    // a cosplay shows under her site name ("Maki"), with the character's own name kept in the hover
    const cos = /^Cosplay of /.test(c.source ?? "") && c.site?.name?.trim() ? c.site.name.trim() : "";
    return { key: keys.join("\n"), id: c.id as string | null, name: cos || c.name, also: cos && cos !== c.name ? c.name : "", n: keys.reduce((a, k) => a + (count.get(k) ?? 0), 0), face: coverOf(c) ?? keys.map((k) => thumb.get(k)).find(Boolean),
      group: c.style === "anime" ? "Anime" : /^Cosplay of /.test(c.source ?? "") ? "Realistic cosplays" : "Realistic" };
  });
  const rest = folders.filter((f) => !used.has(f.name) && !f.name.startsWith("@")).map((f) => ({ key: f.name, id: null as string | null, name: f.name || "Older (no project)", n: f.count, face: f.thumb, group: "Other folders" }));
  const goneKeys = folders.filter((f) => f.name.startsWith("@") && !used.has(f.name));
  const gone = goneKeys.reduce((a, f) => a + f.count, 0);
  const groups = ["Realistic", "Realistic cosplays", "Anime", "Other folders"].map((g) => ({ g, rows: [...rows, ...rest].filter((r) => r.group === g && (r.n > 0 || (r.id && g !== "Other folders"))).sort((a, b) => b.n - a.n) })).filter((x) => x.rows.length);
  // the character the site buttons are for: the project whose folder is open, else the one picked on the left
  const siteChar = chars.find((c) => folder.split("\n")[0] === `@${c.id}`) ?? sel;
  const remakeItem = async (it: CatItem) => {
    const oldKey = fileKey(it);
    if (remaking[oldKey]) return;
    const oldRef = asRef(it);
    setRemaking((r) => ({ ...r, [oldKey]: { pct: 0, step: "Reading prompt…" } }));
    const clear = () => setRemaking((r) => { const n = { ...r }; delete n[oldKey]; return n; });
    try {
      const res = await fetch("/studio-api/catalog/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: it.filename, subfolder: it.subfolder, type: "output" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) throw new Error(d.error || `Couldn't read prompt (${res.status})`);

      // Match the character behind this picture so missing LoadImage refs (e.g. after a rental move) auto-heal
      const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const packSlug = it.subfolder.match(/packs\/([^/]+)/i)?.[1] ?? "";
      const ch =
        (it.meta?.project ? chars.find((c) => c.id === it.meta?.project) : undefined)
        ?? (it.meta?.character ? chars.find((c) => norm(c.name) === norm(it.meta!.character!)) : undefined)
        ?? (packSlug ? chars.find((c) => norm(c.name) === norm(packSlug)) : undefined)
        ?? siteChar
        ?? undefined;

      let graph: ApiGraph | null = d.graph && typeof d.graph === "object" ? (JSON.parse(JSON.stringify(d.graph)) as ApiGraph) : null;
      if (graph) {
        const missing = new Set<string>(Array.isArray(d.missing_inputs) ? d.missing_inputs : []);
        let freshInput: string | null = null;
        if (missing.size > 0 && ch) {
          const refFile = ch.views.face ?? ch.views.front;
          if (refFile) freshInput = (await toInput(refFile)).name;
        }
        for (const node of Object.values(graph)) {
          const inp = node?.inputs as Record<string, unknown> | undefined;
          if (!inp) continue;
          if (typeof inp.seed === "number") inp.seed = newSeed();
          if (typeof inp.noise_seed === "number") inp.noise_seed = newSeed();
          if (node.class_type === "LoadImage" && typeof inp.image === "string" && missing.has(inp.image) && freshInput) {
            inp.image = freshInput;
          }
          if (typeof inp.filename_prefix === "string") {
            inp.filename_prefix = inp.filename_prefix.replace(/_[a-z0-9]{8}$/, "");
          }
        }
      } else {
        const prompt = (String(d.prompt || it.meta?.prompt || "")).trim();
        if (!ch || !prompt) throw new Error("No embedded workflow or prompt found in this picture");
        const { characterShot } = await import("../lib/make");
        const { ref, instruction, loras, canvas } = await characterShot(ch, prompt, prompt, "tall", [], null);
        const e = useSettings.getState().s.edit;
        graph = buildEdit({ ...editArgs(e, "krea"), loras, enhance: false, seed: newSeed(), images: [ref.name], blank: canvas, instruction, negative: "", resolution: 1024, refBoost: 2.8, prefix: "studio/create/remake" });
      }

      setRemaking((r) => ({ ...r, [oldKey]: { pct: 5, step: "Queued…" } }));
      const job = await useJobs.getState().run("create", `Remake · ${it.meta?.label || it.filename}`, graph, "edit:krea:1:raw", {
        project: it.meta?.project ?? ch?.id ?? null,
        no4k: true,
        front: true,
      });

      const unsub = useJobs.subscribe((st) => {
        const j = st.jobs.find((x) => x.id === job.id);
        if (!j) return;
        if (j.status === "queued" || j.status === "running") {
          const pct = j.max > 0 ? Math.min(99, Math.round((j.value / j.max) * 100)) : (j.status === "running" ? 15 : 5);
          setRemaking((r) => (r[oldKey] ? { ...r, [oldKey]: { pct, step: j.nodeTitle || (j.status === "queued" ? "Queued…" : "Remaking…") } } : r));
          return;
        }
        unsub();
        remakeUnsubs.current = remakeUnsubs.current.filter((u) => u !== unsub);
        if (j.status === "done" && j.outputs[0]) {
          const out = j.outputs[0];
          const newRef: FileRef = { filename: out.filename, subfolder: out.subfolder, type: "output" };
          // Swap in-place at the exact same grid slot
          setItems((old) => old.map((x) => (fileKey(x) === oldKey ? { ...x, filename: out.filename, subfolder: out.subfolder, type: "output", mtime: Math.floor(Date.now() / 1000) } : x)));
          // Update any character pack/gallery referencing the old file so site packs stay in sync
          const cst = useCharacters.getState();
          const sameRef = (f: FileRef) => f.filename === oldRef.filename && (f.subfolder ?? "") === (oldRef.subfolder ?? "");
          for (const c of cst.list) {
            let changed = false;
            const sets = c.site?.sets?.map((s) => {
              const items2 = s.items?.map((f) => (sameRef(f) ? ((changed = true), newRef) : f));
              return items2 ? { ...s, items: items2 } : s;
            });
            const galleryFiles = c.site?.galleryFiles?.map((f) => (sameRef(f) ? ((changed = true), newRef) : f));
            if (changed) cst.save({ ...c, site: { ...c.site, ...(sets ? { sets } : {}), ...(galleryFiles ? { galleryFiles } : {}) } });
          }
          deleteFile(oldRef);
          clear();
          toast("Remade in place", "good");
        } else {
          clear();
          toast(j.error || "Remake failed — original kept", "bad");
        }
      });
      remakeUnsubs.current.push(unsub);
    } catch (e) {
      clear();
      throw e;
    }
  };
  const [dropOn, setDropOn] = useState<string | null>(null);
  const dragList = (it: CatItem) => (picked[fileKey(it)] ? Object.values(picked) : [it]);
  const projectRow = (r: { key: string; id: string | null; name: string; also?: string; n: number; face?: FileRef }) => (
    <button key={r.key} onClick={() => setFolder(r.key)}
      onDragOver={(e) => { if (!r.id || !e.dataTransfer.types.includes(CAT_DRAG)) return; e.preventDefault(); setDropOn(r.key); }}
      onDragLeave={() => setDropOn((d) => (d === r.key ? null : d))}
      onDrop={(e) => { setDropOn(null); if (!r.id) return; try { move(JSON.parse(e.dataTransfer.getData(CAT_DRAG)), r.id); } catch { /* */ } }}
      title={r.id ? `${r.name}${r.also ? ` (in the Studio: ${r.also})` : ""} — drop pictures here to move them into this project` : r.name}
      className={cx("press flex items-center gap-2 px-1.5 py-1 text-left text-[13px]", folder === r.key ? "bg-accent/10 text-ink" : "text-muted hover:bg-hover hover:text-ink", dropOn === r.key && "outline outline-2 outline-accent bg-accent/15")}>
      <span className="h-8 w-8 shrink-0 overflow-hidden border border-line bg-raised2">{r.face ? <Thumb f={r.face} w={192} className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-[12px] font-semibold text-dim">{r.name.slice(0, 1).toUpperCase()}</span>}</span>
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
        <button onClick={() => void import("../lib/cosplayRun").then((m) => m.openCosplays())} title="Every cosplay in your results: made, named and written with one button, then pick each one's main picture"
          className="press chip-raised flex h-9 items-center gap-1.5 rounded-sm px-3 text-[12.5px]"><Icon name="sparkle" size={13} /> Cosplays</button>
        <CatalogMore chars={chars} onDone={() => load(0)} />
        <button aria-label="Close" onClick={close} className="press btn-raised flex h-9 w-9 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={15} /></button>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line p-3">
          <button onClick={() => { setFolder(""); setOnlyFav(false); }} className={cx("press flex items-center justify-between px-2 py-1.5 text-left text-[13px]", !folder && !onlyFav ? "bg-accent/10 text-ink" : "text-muted hover:text-ink")}><span>Everything</span><span className="text-[11px] text-dim">{all}</span></button>
          <button onClick={() => { setFolder(""); setOnlyFav(true); }} className={cx("press flex items-center justify-between px-2 py-1.5 text-left text-[13px]", !folder && onlyFav ? "bg-accent/10 text-ink" : "text-muted hover:text-ink")}><span className="flex items-center gap-1.5"><StarIcon on /> Favourites</span><span className="text-[11px] text-dim">{Object.keys(favs).filter((k) => k.startsWith("output/")).length}</span></button>
          {groups.map(({ g, rows: rs }) => (
            <div key={g} className="mt-2 flex flex-col gap-0.5">
              <span className="flex items-center px-1.5 pb-0.5 text-[11px] font-semibold text-dim">{g}
                {g === "Realistic cosplays" && <RenameCosplays chars={chars} />}</span>
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
              const key = fileKey(it);
              const on = !!picked[key]; const star = isFav(favs, asRef(it)); const rm = remaking[key];
              return (
                <div key={key} className={cx("group relative aspect-[3/4] overflow-hidden border bg-raised2", on ? "border-accent outline outline-2 outline-accent" : rm ? "border-accent/80" : "border-line hover:border-accent")}
                  draggable={!rm} onDragStart={(e) => { const l = dragList(it); e.dataTransfer.setData(CAT_DRAG, JSON.stringify(l)); e.dataTransfer.effectAllowed = "move"; }}>
                  <button onClick={(e) => { if (!rm) click(e, i); }} onContextMenu={(e) => openPictureMenu(e, { output: asRef(it), label: it.meta?.label, onRemake: it.kind === "image" && !rm ? () => remakeItem(it) : undefined })}
                    title={[it.meta?.label, it.meta?.prompt, `${new Date(it.mtime * 1000).toLocaleString()}`].filter(Boolean).join("\n")} className="block h-full w-full">
                    <Thumb f={asRef(it)} video={it.kind === "video"} className={cx("h-full w-full object-cover transition-opacity", rm && "opacity-45")} />
                  </button>
                  {rm && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/55 px-2 backdrop-blur-[2px]">
                      <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-accent" />
                      <span className="text-center text-[11.5px] font-medium leading-tight text-white">
                        {rm.pct > 0 ? `Remaking ${rm.pct}%` : (rm.step || "Remaking…")}
                      </span>
                      <div className="h-1 w-20 overflow-hidden rounded-full bg-white/20">
                        <div className="h-full bg-accent transition-all duration-200" style={{ width: `${Math.max(12, rm.pct)}%` }} />
                      </div>
                    </div>
                  )}
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
            <button onClick={() => void newChars(Object.values(picked))} title="Each picture becomes a character with its own project; pictures of the same cosplay (by their Batch label) become one character, the rest go in her free Gallery set"
              className="press chip-raised flex h-8 items-center gap-1.5 rounded-sm px-3"><Icon name="user" size={13} /> New characters</button>
            <button onClick={() => fav(Object.values(picked))} className="press chip-raised flex h-8 items-center gap-1.5 rounded-sm px-3"><StarIcon on /> Favourite</button>
            <DropSelect value="" aria-label="Move to a project" onChange={(e) => { const v = e.target.value; if (v) move(Object.values(picked), v === "@free" ? null : v); }} className="inset h-8 border border-line bg-raised px-2 text-[12.5px]">
              <option value="">Move to…</option><option value="@free">Free work</option>
              {chars.map((c) => <option key={c.id} value={c.id}>{/^Cosplay of /.test(c.source ?? "") && c.site?.name ? c.site.name : c.name}</option>)}
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
function SiteRoles({ c, picked, onDone }: { c: { id: string; name: string; source?: string; site?: { galleryFiles?: FileRef[]; name?: string } }; picked: FileRef[]; onDone: () => void }) {
  const [loop, setLoop] = useState(() => { try { return localStorage.getItem("h3.cat.cardLoop") !== "0"; } catch { return true; } });
  const pics = picked.filter((f) => !/\.(mp4|webm|mov|gif)$/i.test(f.filename));
  const one = pics.length === 1;
  const btn = "press chip-raised flex h-8 items-center gap-1.5 rounded-sm px-3 disabled:opacity-40";
  const run = async (f: () => Promise<unknown>) => { try { await f(); onDone(); } catch (e) { useJobs.getState().toast((e as Error).message, "bad"); } };
  return (
    <span className="flex flex-wrap items-center gap-2 border-l border-line pl-3">
      <span className="text-muted">For {/^Cosplay of /.test(c.source ?? "") && c.site?.name ? c.site.name : c.name} on your site:</span>
      <button className={btn} disabled={!one} title={one ? "Her card: the picture on the grid and in chat (her cover photo)" : "Tick exactly one picture"}
        onClick={() => run(async () => (await import("../lib/siteMedia")).setCard(c.id, pics[0], { pin: loop }))}>★ Card</button>
      <label className="flex items-center gap-1 text-[12px] text-muted" title="Pin her for an animated cover (the video her card plays on hover) made from this picture later — Your site → Animated covers → Make the pinned ones">
        <input type="checkbox" checked={loop} onChange={(e) => { setLoop(e.target.checked); try { localStorage.setItem("h3.cat.cardLoop", e.target.checked ? "1" : "0"); } catch { /* */ } }} /> + pin animated cover</label>
      <button className={btn} disabled={!pics.length} title="Her profile carousel, after her card — up to 12, seen by everyone (no nudity)"
        onClick={() => run(async () => (await import("../lib/siteMedia")).addToCarousel(c.id, pics))}>Carousel +{pics.length} <span className="text-dim">({c.site?.galleryFiles?.length ?? 0}/12)</span></button>
      <button className={btn} disabled={!one} title={one ? "The wide banner at the top of the explore page" : "Tick exactly one picture"}
        onClick={() => run(async () => (await import("../lib/siteMedia")).setBanner(c.id, pics[0]))}>Banner</button>
    </span>
  );
}

/** cosplays still under the character's own name ("Makima"): one click gives them all site names ("Maki") */
function RenameCosplays({ chars }: { chars: Character[] }) {
  const [busy, setBusy] = useState(false);
  const canon = (c: Character) => (c.source ?? "").replace(/^Cosplay of /, "").replace(/\s*\(.*$/, "").trim().toLowerCase();
  const left = chars.filter((c) => /^Cosplay of /.test(c.source ?? "") && (!c.site?.name?.trim() || c.site.name.trim().toLowerCase() === canon(c) || c.site.name.trim().toLowerCase() === canon(c).split(/\s+/)[0])).length;
  if (!left) return null;
  const go = async () => {
    setBusy(true);
    try {
      const { nameCosplays } = await import("../lib/cosplayRun");
      const r = await nameCosplays();
      useJobs.getState().toast(r.renamed.length ? `Renamed ${r.renamed.length}: ${r.renamed.slice(0, 5).map((x) => `${x.from} → ${x.to}`).join(", ")}${r.renamed.length > 5 ? "…" : ""} — send them again to update the site` : "Nothing to rename", "good");
    } catch (e) { useJobs.getState().toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  return <button disabled={busy} onClick={() => void go()} title="Give every cosplay still under the character's own name a site name: a near-twin, a translation or a shortening (Makima → Maki), never the exact name"
    className="press ml-auto font-normal text-accent hover:underline disabled:opacity-50">{busy ? "Naming…" : `Rename ${left}`}</button>;
}
