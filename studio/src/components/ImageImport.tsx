// CivitAI picks: your saved collections, a pasted civitai.com/images/… link, or one of your own files.
// Each one opens with how it was made (prompt as pieces, settings, resources, ComfyUI workflow) and
// one-click Send to Animate / Create / Copy style / put your character in it.
import { useEffect, useRef, useState } from "react";
import { openPictureMenu } from "./PictureMenu";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { CIVIT_IMAGE_LINK, COLLECTION_LINK, civitCollection, civitCollections, civitWorkflows, civitImage, fileGen, type CivitCollection, type CivitGen, type CollectionItem, type InputFile } from "../lib/api";
import { useTray } from "../lib/tray";
import { useJobs } from "../lib/jobs";
import { useLoraBrowser } from "./LoraBrowser";
import { GenData, openTab, usePickPurpose, type PickPurpose } from "./GenData";
import { Icon, cx } from "./ui";
import { copyText } from "../lib/copy";

type Mode = "collections" | "link" | "file";
/** what you were looking at when you closed it — opening it again brings you back there */
let lastView: { mode: Mode; gen: CivitGen | null; link: string } | null = null;
let collMem: { cur: string; items: CollectionItem[]; next: string | null; scroll: number } | null = null;
export const useImport = create<{ open: boolean; link: string; mode: Mode; file: InputFile | null }>(() => ({ open: false, link: "", mode: "link", file: null }));
/** pick a CivitAI picture for a character: the picture's panel then shows "Use for the new character" / "Use as X's picture" */
export const pickFromCivitai = (p: PickPurpose) => { usePickPurpose.setState({ p }); openImageImport("", lastView?.mode === "link" ? "link" : "collections", true); };
export const openImageImport = (link = "", mode?: Mode, picking = false) => (picking || usePickPurpose.setState({ p: null }), useImport.setState({ open: true, link, file: null, mode: mode ?? (link ? (COLLECTION_LINK.test(link) ? "collections" : "link") : lastView?.mode === "link" ? "link" : "collections") }));
/** "How was this made?" for one of your files */
export const openFileMeta = (file: InputFile) => useImport.setState({ open: true, link: "", mode: "file", file });
const close = () => useImport.setState({ open: false });
const pref = (k: string, d: string) => { try { return localStorage.getItem(`h3.lorabrowser.${k}`) ?? d; } catch { return d; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem(`h3.lorabrowser.${k}`, v); } catch { /* */ } };

export function ImageImport() {
  const { open, link, mode, file } = useImport();
  if (!open) return null;
  return <Body key={`${mode}:${link}:${file?.name ?? ""}`} initial={link} mode={mode} file={file} />;
}

function Body({ initial, mode: startMode, file }: { initial: string; mode: Mode; file: InputFile | null }) {
  const mem = useRef(!initial && startMode !== "file" && lastView?.mode === startMode ? lastView : null).current;
  const [mode, setMode] = useState<Mode>(startMode);
  const [gen, setGen] = useState<CivitGen | null>(mem?.gen ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [peek, setPeek] = useState(pref("reveal2", "1") === "1");
  const lastLink = useRef(mem?.link ?? "");
  const view = useRef({ mode, gen }); view.current = { mode, gen };
  useEffect(() => () => { if (view.current.mode !== "file") lastView = { ...view.current, link: lastLink.current }; }, []);
  const [dbg, setDbg] = useState(false);
  const copyDebug = async (link: string) => {
    setDbg(true);
    try {
      const [a, b] = await Promise.all([fetch("/studio-api/civitai/debug").then((r) => r.text()), link ? fetch(`/studio-api/civitai/debug?link=${encodeURIComponent(link)}`).then((r) => r.text()) : Promise.resolve("")]);
      const text = `CivitAI debug ${new Date().toISOString()}\n${a}${b ? `\nlink: ${b}` : ""}`;
      try { await copyText(text, "Debug info copied — paste it to Claude"); }
      catch { window.prompt("Copy this and paste it to Claude:", text); }
    } catch (e) { useJobs.getState().toast((e as Error).message, "bad"); } finally { setDbg(false); }
  };
  const readLink = async (t: string) => {
    if (!t.trim()) return;
    lastLink.current = t.trim();
    setLoading(true); setErr(null); setGen(null);
    try { setGen(await civitImage(t)); } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  };
  const readFile = async (f: InputFile) => {
    setLoading(true); setErr(null); setGen(null);
    try {
      const g = await fileGen(f);
      if (!g.found) setErr("No prompt or workflow inside this file. Pictures from ComfyUI, A1111/Forge and many CivitAI downloads carry one; screenshots and re-saved pictures usually don't.");
      setGen(g);
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => {
    if (startMode === "link" && initial) readLink(initial);
    if (startMode === "file" && file) readFile(file);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); if (gen && mode === "collections") setGen(null); else close(); } };
    window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
  }, [gen, mode]);
  const hidden = gen?.explicit && !peek;
  const done = (tab: Parameters<typeof openTab>[0]) => { close(); useLoraBrowser.setState({ open: false }); openTab(tab); };

  return createPortal(
    <div className="fade-in fixed inset-0 z-[56] flex items-center justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={close} role="dialog" aria-modal aria-label="CivitAI picks">
      <div className="zoom-in ticks frame relative flex h-full max-h-[920px] w-full max-w-[1300px] flex-col overflow-hidden border border-line bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-4 border-b border-line px-5 pb-3 pt-4">
          <div className="shrink-0">
            <div className="micro text-dim">LIB/CIVITAI · PICKS</div>
            <h2 className="display glitch-once text-[24px] leading-none" data-text="How it was made">How it was made</h2>
          </div>
          <div className="ml-4 flex gap-1" role="tablist">
            {([["collections", "My collections"], ["link", "Paste a link"], ["file", "From a file"]] as const).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={mode === v} onClick={() => { setMode(v); setGen(null); setErr(null); }} className={cx("press tag-btn", mode === v && "on")}>{l}</button>
            ))}
          </div>
          <button onClick={() => copyDebug(lastLink.current)} title="Copies what CivitAI answered (no keys) — paste it to Claude when something here doesn't work"
            className="press ml-auto h-9 border border-line px-3 text-[12px] text-muted hover:text-ink">{dbg ? "Checking…" : "Copy debug info"}</button>
          <button aria-label="Close" onClick={close} className="press btn-raised flex h-10 w-10 shrink-0 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={16} /></button>
        </div>

        {mode === "link" && <LinkBar initial={initial || mem?.link || ""} loading={loading} onRead={readLink} />}
        {mode === "collections" && !gen && <Collections initial={initial} onPick={(it) => readLink(String(it.id))} reveal={peek} />}
        {mode === "file" && !gen && !loading && <FileDrop onFile={readFile} err={err} />}

        {(gen || loading || (err && mode !== "file") || (mode === "link" && !gen)) && (
          <div className="flex min-h-0 flex-1">
            <div className="relative min-w-0 flex-1 bg-black/40">
              {mode === "collections" && <button onClick={() => setGen(null)} className="press glass-btn absolute left-3 top-3 z-10 flex h-9 items-center gap-1.5 px-3 text-[13px]"><Icon name="back" size={14} />Back to the collection</button>}
              {gen ? (gen.video
                ? <video key={gen.url} src={gen.url} controls autoPlay muted loop playsInline className={cx("absolute inset-0 h-full w-full object-contain", hidden && "blur-3xl")} />
                : <img key={gen.url} src={gen.url} alt="" onContextMenu={(e) => openPictureMenu(e, { gen })} title="Right-click: use in Edit, copy its look, save…" className={cx("fade-in absolute inset-0 h-full w-full object-contain", hidden && "blur-3xl")} />)
                : (
                  <div className="grid-bg absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center">
                    {loading ? <div className="shimmer h-3/4 w-1/2" /> : err ? (
                      <><p className="display text-[20px]">Couldn't read that one</p><p className="max-w-md text-[13px] text-muted">{err}</p></>
                    ) : (
                      <><p className="display text-[20px]">Paste a CivitAI image or video link</p>
                        <p className="max-w-md text-[13px] leading-relaxed text-muted">You'll get its prompt (in pieces you can change), settings, every model and LoRA it used and its ComfyUI workflow — then send it to Animate, copy its style, or put your character into it. Pasting a link anywhere in the Studio opens this too.</p></>
                    )}
                  </div>
                )}
              {hidden && <button onClick={() => { setPeek(true); setPref("reveal2", "1"); }} className="micro absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/75 px-4 py-2 text-hot">EXPLICIT · SHOW</button>}
              {gen && <span className="micro absolute bottom-3 left-3 bg-black/70 px-2 py-1 text-ink">{gen.video ? "VIDEO" : "IMAGE"} · {gen.size || "?"}{gen.id ? ` · #${gen.id}` : ""}</span>}
            </div>
            <aside className="w-[440px] shrink-0 overflow-y-auto border-l border-line p-4">
              {gen ? <>
                {err && <p className="mb-3 border border-hot/50 bg-hot/10 px-2.5 py-2 text-[12px] text-ink">{err}</p>}
                <GenData gen={gen} onDone={done} />
              </> : <div className="flex flex-col gap-2">{Array.from({ length: 5 }, (_, i) => <div key={i} className={cx("h-10", loading ? "shimmer" : "border border-dashed border-line")} />)}</div>}
            </aside>
          </div>
        )}
      </div>
    </div>, document.body);
}

/** many CivitAI picture links → one .zip with each one's ComfyUI workflow, settings and resources (to study, or send to Claude) */
export async function downloadWorkflows(links: string[], onState?: (s: string) => void) {
  onState?.(`Reading ${links.length} picture${links.length === 1 ? "" : "s"}…`);
  try {
    const r = await fetch("/studio-api/civitai/workflows/zip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ links }) });
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `The rental answered ${r.status}`);
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `civitai-workflows-${links.length}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  } finally { onState?.(""); }
}
const ALL_LINKS = /civitai\.(?:com|green|red)\/images\/(\d+)/gi;

function LinkBar({ initial, loading, onRead }: { initial: string; loading: boolean; onRead: (t: string) => void }) {
  const [text, setText] = useState(initial);
  const [zipping, setZipping] = useState("");
  const many = [...new Set(Array.from(text.matchAll(ALL_LINKS)).map((m) => m[1]))];
  const valid = CIVIT_IMAGE_LINK.test(text) || /civitai\.(?:com|green|red)\/posts\/\d+/i.test(text) || /^\s*\d{3,}\s*$/.test(text);
  return (
    <form className="flex items-center gap-2.5 border-b border-line px-5 py-3" onSubmit={(e) => { e.preventDefault(); onRead(text); }}>
      <label className="inset flex h-11 flex-1 items-center gap-2.5 border border-line pl-3.5 focus-within:border-accent">
        <Icon name="link" size={16} className="text-muted" />
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onPaste={(e) => { const t = e.clipboardData.getData("text"); const n = new Set(Array.from(t.matchAll(ALL_LINKS)).map((m) => m[1])).size; if (n > 1) { e.preventDefault(); setText(t.replace(/\s+/g, " ").trim()); return; } if (CIVIT_IMAGE_LINK.test(t)) { e.preventDefault(); setText(t); onRead(t); } }}
          placeholder="Paste a link like https://civitai.com/images/12345678" aria-label="CivitAI image link" className="h-full min-w-0 flex-1 bg-transparent text-[14px] placeholder:text-dim focus:outline-none" />
        {many.length > 1
          ? <button type="button" disabled={!!zipping} onClick={() => downloadWorkflows(many, setZipping).catch((er) => alert((er as Error).message))} className="press btn-primary h-full px-4 text-[13px] font-bold disabled:opacity-60" title="One .zip: each picture's ComfyUI workflow, settings and resources, plus a summary">{zipping || `Download ${many.length} workflows (.zip)`}</button>
          : <button type="submit" disabled={!valid || loading} className="press btn-primary h-full px-5 text-[13px] font-bold disabled:opacity-40">{loading ? "Reading…" : "Read"}</button>}
      </label>
    </form>
  );
}

function Collections({ initial, onPick, reveal }: { initial: string; onPick: (it: CollectionItem) => void; reveal: boolean }) {
  const [list, setList] = useState<CivitCollection[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cur, setCur] = useState<string>(() => (COLLECTION_LINK.exec(initial)?.[1] ?? pref("collection", "")));
  const mem = useRef(collMem && collMem.cur === cur ? collMem : null).current;
  const [items, setItems] = useState<CollectionItem[]>(mem?.items ?? []);
  const [next, setNext] = useState<string | null>(mem?.next ?? null);
  const [loading, setLoading] = useState(false);
  // which pictures to show: all, ones with a prompt, or ones made in ComfyUI (their whole workflow comes along)
  const [show, setShow] = useState<"all" | "prompt" | "workflow">(() => (pref("collectionOnly", "prompt") as "all" | "prompt" | "workflow"));
  const [wf, setWf] = useState<Record<number, boolean | null>>({});
  const [paste, setPaste] = useState("");
  // pick several → Batch (each one becomes a row; Swap in puts your character in all of them)
  const [picking, setPicking] = useState(false);
  const [sel, setSel] = useState<number[]>([]);
  const [sending, setSending] = useState("");
  const toBatch = async () => {
    const chosen = items.filter((i) => sel.includes(i.id) && !i.video);
    const [{ useBatch }, { useTray }, { useSettings }, { useJobs }] = await Promise.all([import("../lib/batch"), import("../lib/tray"), import("../lib/settings"), import("../lib/jobs")]);
    let ok = 0;
    for (const [k, it] of chosen.entries()) {
      setSending(`Copying ${k + 1} of ${chosen.length}…`);
      try {
        // the same copy as picking one picture (CivitAI's own download, with its prompt remembered)
        const { civitFetchMedia, inputUrl } = await import("../lib/api");
        const f = await civitFetchMedia(it.url, it.id);
        const label = `CivitAI ${it.id}`;
        useTray.getState().addOutput({ filename: f.name, subfolder: "", type: "input" }, label);
        useBatch.getState().add({ imitate: { ...f, url: inputUrl(f.name), label } }); ok++;
      } catch { /* skip that one */ }
    }
    if (!ok) { setSending(""); useJobs.getState().toast("Couldn't copy those pictures from CivitAI — try again, or open one and check its link.", "bad"); return; }
    const b = useBatch.getState();
    const first = b.rows[0];
    if (b.rows.length > ok && first && !first.imitate && !first.idea && !first.prompt) b.remove(first.id);
    b.set({ target: "image", ...(b.take ? {} : { take: "swap" }) });
    setSending(""); setSel([]); setPicking(false);
    useJobs.getState().toast(`${ok} picture${ok === 1 ? "" : "s"} added to Batch — pick your character there and press Queue.`, "good");
    close();
    useSettings.getState().setTab("batch");
  };
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { civitCollections().then((r) => { setList(r.items); if (!cur && r.items[0]) setCur(String(r.items.find((c) => c.type !== "Model")?.id ?? r.items[0].id)); }).catch((e) => setErr((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const load = async (cursor: string | null) => {
    if (!cur) return;
    setLoading(true);
    try { const r = await civitCollection(cur, cursor); setItems((old) => (cursor ? [...old, ...r.items] : r.items)); setNext(r.next); setErr(null); }
    catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  };
  const skipFirst = useRef(!!mem?.items.length);
  const scrollPos = useRef(mem?.scroll ?? 0);
  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; requestAnimationFrame(() => scroller.current?.scrollTo({ top: scrollPos.current })); return; }
    setItems([]); setNext(null); scrollPos.current = 0; if (cur) { setPref("collection", cur); load(null); }
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = useRef({ cur, items, next }); keep.current = { cur, items, next };
  useEffect(() => () => { collMem = { ...keep.current, scroll: scrollPos.current }; }, []);
  const wfOf = (i: CollectionItem) => (i.has_workflow != null ? i.has_workflow : wf[i.id]);
  const shown = show === "prompt" ? items.filter((i) => i.has_prompt !== false) : show === "workflow" ? items.filter((i) => wfOf(i) === true) : items;
  // "with a workflow": ask CivitAI about the loaded pictures it didn't say about yet (a few dozen at a time)
  const asking = useRef(false);
  useEffect(() => {
    if (show !== "workflow" || asking.current) return;
    const todo = items.filter((i) => !i.video && i.has_meta !== false && i.has_workflow == null && !(i.id in wf)).slice(0, 48).map((i) => i.id);
    if (!todo.length) return;
    asking.current = true;
    civitWorkflows(todo).then((r) => setWf((o) => ({ ...o, ...Object.fromEntries(todo.map((id) => [id, r[String(id)] ?? false])) }))).catch(() => setWf((o) => ({ ...o, ...Object.fromEntries(todo.map((id) => [id, null])) }))).finally(() => { asking.current = false; });
  }, [show, items, wf]); // eslint-disable-line react-hooks/exhaustive-deps
  const checking = show === "workflow" && items.some((i) => !i.video && i.has_meta !== false && i.has_workflow == null && !(i.id in wf));
  // the filter can leave a page nearly empty: keep fetching until there's enough to look at
  useEffect(() => { if (show !== "all" && next && !loading && !checking && shown.length < 18) load(next); }, [items, show, checking]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[250px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-line p-3">
        <span className="micro mb-1 text-dim">YOUR COLLECTIONS</span>
        {!list && !err && Array.from({ length: 4 }, (_, i) => <div key={i} className="shimmer h-9" />)}
        {list?.length === 0 && <p className="text-[12px] text-muted">No collections yet — save posts into a collection on CivitAI.</p>}
        {list?.map((c) => (
          <button key={c.id} onClick={() => setCur(String(c.id))} disabled={c.type === "Model" || c.type === "Article"} title={c.type === "Model" ? "A collection of models — find them under ♥ Liked in Browse LoRAs" : c.description}
            className={cx("press flex items-center gap-2 border px-2.5 py-2 text-left text-[13px] disabled:opacity-40", cur === String(c.id) ? "border-accent bg-accent/10" : "border-transparent hover:border-line")}>
            <Icon name={c.type === "Model" ? "layers" : c.type === "Post" ? "film" : "image"} size={14} className="shrink-0 text-muted" /><span className="truncate">{c.name}</span>
          </button>
        ))}
        <form className="mt-3 flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); const m = COLLECTION_LINK.exec(paste) ?? /^\s*(\d+)\s*$/.exec(paste); if (m) { setCur(m[1]); setPaste(""); } }}>
          <span className="micro text-dim">OR SOMEONE ELSE'S</span>
          <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="civitai.com/collections/…" aria-label="Collection link"
            className="inset h-8 border border-line px-2 text-[12px] focus:border-accent focus:outline-none" />
        </form>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-[12.5px] text-muted">
          <div className="flex gap-1" role="group" aria-label="Show">
            {([["all", "All"], ["prompt", "With a prompt"], ["workflow", "With a workflow"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => { setShow(v); setPref("collectionOnly", v); }} aria-pressed={show === v} title={v === "workflow" ? "Made in ComfyUI — the whole workflow comes along (open one → How it was made)" : undefined}
                className={cx("press border px-2 py-1 text-[12px]", show === v ? "border-accent text-accent" : "border-line text-muted hover:text-ink")}>{l}</button>
            ))}
          </div>
          {checking && <span className="text-[11.5px] text-dim">checking which have a workflow…</span>}
          <button onClick={() => { setPicking((v) => !v); setSel([]); }} className={cx("press border px-2 py-1 text-[12px]", picking ? "border-accent text-accent" : "border-line text-muted hover:text-ink")} title="Tick several pictures and swap your character into all of them in Batch">{picking ? "Cancel picking" : "Pick several → Batch"}</button>
          {picking && <>
            <button className="text-[12px] text-muted hover:text-ink" onClick={() => setSel(shown.filter((i) => !i.video).map((i) => i.id))}>All {shown.filter((i) => !i.video).length}</button>
            <button disabled={!sel.length || !!sending} onClick={toBatch} className="press btn-primary px-3 py-1 text-[12px] font-bold disabled:opacity-50">{sending || `Add ${sel.length} to Batch`}</button>
            <button disabled={!sel.length} onClick={async () => { const { copyText } = await import("../lib/copy"); await copyText(sel.map((id) => `https://civitai.com/images/${id}`).join("\n")); const { useJobs } = await import("../lib/jobs"); useJobs.getState().toast(`${sel.length} link${sel.length === 1 ? "" : "s"} copied`, "good"); }}
              className="press border border-line px-2 py-1 text-[12px] text-muted hover:text-ink disabled:opacity-40" title="Copy the links of the ticked pictures (to share them, or to send them to Claude)">Copy links</button>
            <button disabled={!sel.length || !!sending} onClick={() => downloadWorkflows(sel.map((id) => `https://civitai.com/images/${id}`), setSending).catch((er) => alert((er as Error).message))}
              className="press border border-line px-2 py-1 text-[12px] text-muted hover:text-ink disabled:opacity-40" title="One .zip with each ticked picture's ComfyUI workflow, settings and resources">Workflows (.zip)</button>
          </>}
          <span className="micro ml-auto text-dim">{items.filter((i) => i.has_prompt !== false).length}/{items.length} WITH PROMPTS{next ? " SO FAR" : ""}</span>
        </div>
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto p-4" onScroll={(e) => { const el = e.currentTarget; scrollPos.current = el.scrollTop; if (next && !loading && el.scrollTop + el.clientHeight > el.scrollHeight - 600) load(next); }}>
          {err ? <div className="flex h-full flex-col items-center justify-center gap-2 text-center"><p className="display text-[20px]">Couldn't open your collections</p><p className="max-w-md text-[13px] text-muted">{err}</p></div> : (
            <div className="grid grid-cols-3 gap-2 md:grid-cols-4 xl:grid-cols-6">
              {shown.map((it) => (
                <button key={it.id} onClick={() => (picking ? !it.video && setSel((x) => (x.includes(it.id) ? x.filter((y) => y !== it.id) : [...x, it.id])) : onPick(it))} onContextMenu={(e) => openPictureMenu(e, { civitId: it.id, url: it.url, video: it.video })} className="lb-card group relative aspect-[3/4] overflow-hidden border border-line bg-raised2" aria-label={`Open picture ${it.id}`}>
                  <img src={it.thumb} alt="" loading="lazy" className={cx("h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]", it.explicit && !reveal && "scale-110 blur-xl")} />
                  {it.video && <span className="micro absolute left-1.5 top-1.5 bg-black/75 px-1 text-cyan">VIDEO</span>}
                  {picking && !it.video && <span className={cx("absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center border text-[13px] font-bold", sel.includes(it.id) ? "border-accent bg-accent text-black" : "border-white/60 bg-black/50 text-transparent")}>✓</span>}
                  {it.has_prompt === false && <span className="absolute inset-x-0 bottom-0 bg-black/70 py-0.5 text-center text-[10px] text-white/70">no prompt</span>}
                  {wfOf(it) === true && <span className="micro absolute bottom-1.5 left-1.5 bg-black/75 px-1 text-accent">WORKFLOW</span>}
                </button>
              ))}
              {loading && Array.from({ length: 12 }, (_, i) => <div key={`s${i}`} className="shimmer aspect-[3/4]" />)}
            </div>
          )}
          {!loading && !err && cur && shown.length === 0 && <p className="py-10 text-center text-[13px] text-muted">{items.length ? (checking ? "Checking which have a workflow…" : show === "workflow" ? "None of these were made in ComfyUI (no workflow attached) — press All to see them all." : "None of these have a prompt — press All to see them all.") : "This collection is empty."}</p>}
        </div>
      </div>
    </div>
  );
}

function FileDrop({ onFile, err }: { onFile: (f: InputFile) => void; err: string | null }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const take = async (f: File) => { const m = await useTray.getState().addUpload(f); onFile(m); };
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) take(f); }}
        onClick={() => input.current?.click()} role="button" tabIndex={0}
        className={cx("hatch flex w-full max-w-2xl cursor-pointer flex-col items-center gap-2 border border-dashed px-8 py-14 text-center", over ? "border-accent bg-accent/10" : "border-line hover:border-muted")}>
        <Icon name="up" size={24} className="text-muted" />
        <p className="display text-[20px]">Drop a picture or video to see how it was made</p>
        <p className="max-w-lg text-[13px] leading-relaxed text-muted">Reads what's saved inside it: A1111 / Forge parameters, ComfyUI prompts and workflows (also from your own Studio outputs). Right-click anything in the tray → <b>How was this made?</b> does the same.</p>
        {err && <p className="mt-2 text-[12.5px] text-hot">{err}</p>}
      </div>
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp,video/mp4,video/webm" onChange={(e) => { const f = e.target.files?.[0]; if (f) take(f); e.target.value = ""; }} />
    </div>
  );
}
