// Browse CivitAI LoRAs without leaving the Studio: search, scroll, open one to see its example
// pictures and the prompts behind them, press Add or "Use this prompt".
// Added LoRAs go into your library (re-downloaded on every rental) and, when opened from a
// LoRA list, straight into the picture or video you're working on.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { askCivitKey, CIVIT_IMAGE_LINK, COLLECTION_LINK, civitCollectionModels, civitCollections, civitImage, civitKeyStatus, type CivitCollection, civitImages, civitModel, installLora, searchCivitai, type CivitGen, type CivitImage, type CivitLora, type CivitModel, type CivitVersion, type LoraJob } from "../lib/api";
import { genFromExample } from "../lib/civitUse";
import { GenData, openTab } from "./GenData";
import { openImageImport } from "./ImageImport";
import { openPictureMenu } from "./PictureMenu";
import { useJobs } from "../lib/jobs";
import { useSettings } from "../lib/settings";
import { Icon, Seg, cx, DropSelect } from "./ui";
import { copyText } from "../lib/copy";

type Fam = "anima" | "sdxl" | "krea2" | "h3" | "any";
type OnPick = ((name: string, trigger: string) => void) | null;
export const useLoraBrowser = create<{ open: boolean; family: Fam; onPick: OnPick }>(() => ({ open: false, family: "any", onPick: null }));
export const openLoraBrowser = (family: Fam = "any", onPick: OnPick = null) => useLoraBrowser.setState({ open: true, family, onPick });

const MADE_FOR: { value: Fam; label: string; bases: string[]; note?: string }[] = [
  { value: "anima", label: "Anime · Anima", bases: ["Anima"] },
  { value: "sdxl", label: "Anime · Illustrious/NoobAI", bases: ["Illustrious", "NoobAI", "Pony", "SDXL 1.0"] },
  { value: "krea2", label: "Realistic · Krea 2", bases: ["Krea 2"] },
  { value: "h3", label: "Video", bases: ["MiniMax H3", "Wan Video 2.2 T2V-A14B", "Wan Video 2.2 I2V-A14B", "Wan Video 2.2 TI2V-5B", "Wan Video 14B t2v", "Wan Video 14B i2v 720p", "Wan Video 14B i2v 480p", "Wan Video 1.3B t2v", "Hunyuan Video", "LTXV"],
    note: "Every video model, for their example clips and prompts: open a card and press Send to Animate. Only LoRAs marked H3 run in Animate — the others are labelled with their model." },
  { value: "any", label: "Any model", bases: [] },
];
const CATEGORIES = [
  { value: "", label: "Everything" }, { value: "character", label: "Characters" }, { value: "style", label: "Styles" },
  { value: "concept", label: "Concepts" }, { value: "clothing", label: "Clothing" }, { value: "poses", label: "Poses" },
  { value: "background", label: "Backgrounds" }, { value: "objects", label: "Objects" },
];
const SORTS = [{ value: "Most Downloaded", label: "Popular" }, { value: "Highest Rated", label: "Top rated" }, { value: "Newest", label: "Newest" }];
const PERIODS = [{ value: "AllTime", label: "All time" }, { value: "Month", label: "Month" }, { value: "Week", label: "Week" }];
const FAMILY_TAG: Record<string, string> = { sdxl: "ILLUSTRIOUS", anima: "ANIMA", krea2: "KREA 2", qwen: "QWEN", h3: "H3", other: "OTHER", unknown: "?" };
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `${n}`);
const famOf = (base: string): CivitVersion["family"] => {
  const b = base.toLowerCase();
  return /anima/.test(b) ? "anima" : /illustrious|noob|pony|sdxl/.test(b) ? "sdxl" : /krea\s*2/.test(b) ? "krea2" : /qwen/.test(b) ? "qwen" : /h3|minimax/.test(b) ? "h3" : "other";
};

const pref = (k: string, d: string) => { try { return localStorage.getItem(`h3.lorabrowser.${k}`) ?? d; } catch { return d; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem(`h3.lorabrowser.${k}`, v); } catch { /* private mode */ } };

export function LoraBrowser() {
  const { open, family, onPick } = useLoraBrowser();
  if (!open) return null;
  return <BrowserBody key={family} family={family} onPick={onPick} />;
}

interface Target { model_id: number; version_id: number; name: string; trigger: string }

/** where you were when you closed it (search, filters, results, scroll, the open card) — reopening brings you back there */
interface Memory { family: Fam; made: Fam; cat: string; q: string; sort: string; period: string; liked: boolean; showColls: boolean; coll: CivitCollection | null;
  colls: CivitCollection[] | null; items: CivitLora[]; next: string | null; open: CivitLora | null; scroll: number }
let memory: Memory | null = null;

function BrowserBody({ family, onPick }: { family: Fam; onPick: OnPick }) {
  const close = () => useLoraBrowser.setState({ open: false, onPick: null });
  const mem = useRef(memory && memory.family === family ? memory : null).current;
  const [made, setMade] = useState<Fam>(mem?.made ?? family);
  const [cat, setCat] = useState(mem?.cat ?? "");
  const [q, setQ] = useState(mem?.q ?? "");
  const [query, setQuery] = useState(mem?.q.trim() ?? "");
  const [sort, setSort] = useState(() => mem?.sort ?? pref("sort", "Most Downloaded"));
  const [period, setPeriod] = useState(() => mem?.period ?? pref("period", "Month"));
  const [reveal, setReveal] = useState(() => pref("reveal2", "1") === "1");
  const [liked, setLiked] = useState(mem?.liked ?? false);
  // your CivitAI collections: saved LoRAs fill this grid; saved pictures and videos open in "How was this made?"
  const [showColls, setShowColls] = useState(mem?.showColls ?? false);
  const [colls, setColls] = useState<CivitCollection[] | null>(mem?.colls ?? null);
  const [collErr, setCollErr] = useState<string | null>(null);
  const [coll, setColl] = useState<CivitCollection | null>(mem?.coll ?? null);
  useEffect(() => {
    if (!showColls || colls) return;
    civitCollections().then((r) => { setColls(r.items); setCollErr(null); const first = r.items.find((c) => c.type === "Model"); if (first) setColl(first); })
      .catch((e) => setCollErr((e as Error).message));
  }, [showColls]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickColl = (c: CivitCollection) => {
    if (c.type === "Model") { setColl(c); return; }
    openImageImport(`https://civitai.com/collections/${c.id}`); // pictures, videos and posts: their prompts and how they were made
  };
  const inColl = showColls && !!coll;
  const [items, setItems] = useState<CivitLora[]>(mem?.items ?? []);
  const [next, setNext] = useState<string | null>(mem?.next ?? null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<number, LoraJob>>({});
  const [installed, setInstalled] = useState<Record<number, string>>({});
  const [added, setAdded] = useState(0);
  const [open, setOpen] = useState<CivitLora | null>(mem?.open ?? null);
  const [hasKey, setHasKey] = useState(true);
  useEffect(() => { civitKeyStatus().then((k) => setHasKey(k.set)); }, []);
  const sentinel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);
  const toast = useJobs((s) => s.toast);
  const bases = MADE_FOR.find((m) => m.value === made)!;
  const openRef = useRef(open); openRef.current = open;

  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); if (openRef.current) setOpen(null); else close(); } };
    window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (cursor: string | null) => {
    const id = ++reqId.current;
    setLoading(true); setErr(null);
    try {
      const r = inColl ? await civitCollectionModels(coll!.id, cursor)
        : await searchCivitai({ q: query, base: bases.bases, sort, tag: cat, period: query || liked ? "AllTime" : period, cursor, liked });
      if (id !== reqId.current) return;
      setItems((old) => {
        const seen = new Set(cursor ? old.map((x) => x.version_id) : []);
        return [...(cursor ? old : []), ...r.items.filter((x) => !seen.has(x.version_id))];
      });
      setNext(r.next);
    } catch (e) { if (id === reqId.current) setErr((e as Error).message); }
    finally { if (id === reqId.current) setLoading(false); }
  };
  const skipFirst = useRef(!!mem?.items.length);
  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; requestAnimationFrame(() => scroller.current?.scrollTo({ top: mem?.scroll ?? 0 })); return; }
    setItems([]); setNext(null); scroller.current?.scrollTo({ top: 0 }); load(null);
  }, [query, made, sort, period, cat, liked, inColl, coll?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // remember everything for next time
  const snap = useRef<Memory | null>(null);
  snap.current = { family, made, cat, q, sort, period, liked, showColls, coll, colls, items, next, open, scroll: 0 };
  const scrollPos = useRef(mem?.scroll ?? 0);
  useEffect(() => () => { if (snap.current) memory = { ...snap.current, scroll: scrollPos.current }; }, []);
  useEffect(() => {
    const el = sentinel.current; if (!el) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting && next && !loading && !err) load(next); }, { root: scroller.current, rootMargin: "900px" });
    io.observe(el); return () => io.disconnect();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  /** download a version; resolves to its library name */
  const add = async (t: Target, pick = true): Promise<string | null> => {
    if (installed[t.version_id]) return installed[t.version_id];
    setJobs((j) => ({ ...j, [t.version_id]: { status: "running", progress: 0 } }));
    try {
      const r = await installLora(`https://civitai.com/models/${t.model_id}?modelVersionId=${t.version_id}`, (st) => setJobs((j) => ({ ...j, [t.version_id]: st })));
      setJobs((j) => ({ ...j, [t.version_id]: r }));
      if (r.status === "done" && r.name) {
        setInstalled((m) => ({ ...m, [t.version_id]: r.name! }));
        setItems((xs) => xs.map((x) => (x.version_id === t.version_id ? { ...x, installed: true } : x)));
        if (pick) onPick?.(r.name, r.trigger || t.trigger);
        setAdded((n) => n + 1);
        if (pick) toast(`Added “${t.name}”${onPick ? " to this one" : ""}${(r.trigger || t.trigger) ? ` — its trigger words (${r.trigger || t.trigger}) are added to your prompt for you` : ""}`, "good");
        return r.name;
      }
      toast(`Couldn't add “${t.name}”: ${r.error}`, "bad");
    } catch (e) {
      setJobs((j) => ({ ...j, [t.version_id]: { status: "error", progress: 0, error: (e as Error).message } }));
      toast((e as Error).message, "bad");
    }
    return null;
  };
  const target = (m: CivitLora): Target => ({ model_id: m.model_id, version_id: m.version_id, name: m.name, trigger: m.trigger });

  return createPortal(
    <div className="fade-in fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={close} role="dialog" aria-modal aria-label="Browse LoRAs">
      <div className="zoom-in ticks frame relative flex h-full max-h-[960px] w-full max-w-[1360px] flex-col overflow-hidden border border-line bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        {/* grid view stays mounted under the detail view so its scroll position survives */}
        <div className={cx("flex min-h-0 flex-1 flex-col", open && "hidden")}>
          <div className="flex flex-col gap-3 border-b border-line px-5 pb-3.5 pt-4">
            <div className="flex items-center gap-4">
              <div className="shrink-0">
                <div className="micro text-dim">LIB/CIVITAI · LORA</div>
                <h2 className="display glitch-once text-[24px] leading-none" data-text="Browse LoRAs">Browse LoRAs</h2>
              </div>
              <label className="inset ml-auto flex h-11 w-full max-w-[480px] items-center gap-2.5 border border-line px-3.5 focus-within:border-accent">
                <Icon name="search" size={16} className="text-muted" />
                <input autoFocus value={q} onChange={(e) => { const t = e.target.value; if (CIVIT_IMAGE_LINK.test(t) || COLLECTION_LINK.test(t)) { setQ(""); openImageImport(t); } else setQ(t); }} placeholder="Search styles, characters, poses… or paste a civitai.com/images link" aria-label="Search LoRAs"
                  className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] placeholder:text-dim focus:outline-none" />
                {q && <button aria-label="Clear search" onClick={() => setQ("")} className="text-muted hover:text-ink"><Icon name="x" size={14} /></button>}
              </label>
              <button aria-label="Close" onClick={close} className="press btn-raised flex h-10 w-10 shrink-0 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={16} /></button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1" role="group" aria-label="Made for">
                {MADE_FOR.map((m) => (
                  <button key={m.value} onClick={() => setMade(m.value)} aria-pressed={made === m.value} className={cx("press tag-btn", made === m.value && "on")}>{m.label}</button>
                ))}
              </div>
              <button onClick={() => { setLiked((l) => !l); setShowColls(false); }} aria-pressed={liked} title="Only the LoRAs you liked on CivitAI (needs your CivitAI key)" className={cx("press tag-btn", liked && !showColls && "on")}>♥ Liked</button>
              <button onClick={() => { setShowColls((v) => !v); setLiked(false); }} aria-pressed={showColls} title="Your collections on CivitAI (needs your CivitAI key)" className={cx("press tag-btn", showColls && "on")}>My collections</button>
              <span className="mx-1 h-5 w-px bg-line" />
              <Seg value={sort} onChange={(v) => { setSort(v); setPref("sort", v); }} options={SORTS} />
              {!query && <Seg value={period} onChange={(v) => { setPeriod(v); setPref("period", v); }} options={PERIODS} />}
              <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12.5px] text-muted hover:text-ink">
                <input type="checkbox" checked={reveal} onChange={(e) => { setReveal(e.target.checked); setPref("reveal2", e.target.checked ? "1" : "0"); }} />
                Explicit previews
              </label>
            </div>
            <div className="-mb-1 flex gap-1 overflow-x-auto pb-1" role="group" aria-label="Category">
              {CATEGORIES.map((c) => (
                <button key={c.value} onClick={() => setCat(c.value)} aria-pressed={cat === c.value}
                  className={cx("press shrink-0 border-b-2 px-2.5 pb-1.5 pt-1 text-[13px] font-medium transition-colors", cat === c.value ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>{c.label}</button>
              ))}
            </div>
            {showColls && (
              <div className="-mt-1 flex flex-wrap items-center gap-1.5" role="group" aria-label="Your collections">
                {collErr ? <span className="text-[12.5px] text-bad">{collErr}</span>
                  : !colls ? <span className="text-[12.5px] text-dim">Loading your collections…</span>
                  : !colls.length ? <span className="text-[12.5px] text-dim">No collections on your CivitAI account yet.</span>
                  : colls.map((c) => (
                    <button key={c.id} onClick={() => pickColl(c)} aria-pressed={coll?.id === c.id}
                      title={c.type === "Model" ? "Saved LoRAs — shown here" : "Saved pictures and videos — opens them with their prompts"}
                      className={cx("press flex items-center gap-1.5 border px-2 py-1 text-[12.5px]", coll?.id === c.id ? "border-accent text-ink" : "border-line text-muted hover:text-ink")}>
                      <Icon name={c.type === "Model" ? "layers" : "image"} size={12} />{c.name}
                      {c.type !== "Model" && <Icon name="external" size={11} className="text-dim" />}
                    </button>
                  ))}
              </div>
            )}
            {inColl ? <p className="-mt-1 text-[12.5px] text-dim">The LoRAs in “{coll!.name}”, newest first. Cards marked in pink are made for a model this Studio doesn't run.</p>
              : bases.note && <p className="-mt-1 text-[12.5px] text-dim">{bases.note}</p>}
          </div>

          <div ref={scroller} onScroll={(e) => { scrollPos.current = e.currentTarget.scrollTop; }} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {err && items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="display text-[20px]">Couldn't load CivitAI</p>
                <p className="max-w-sm text-[13px] text-muted">{err}. You can still paste a CivitAI link into Add LoRA.</p>
                <button onClick={() => load(null)} className="press btn-raised h-9 px-4 text-[13px] font-medium">Try again</button>
              </div>
            ) : !loading && items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <p className="display text-[20px]">Nothing found</p>
                <p className="text-[13px] text-muted">Try fewer words{cat ? ", Everything" : ""}{made !== "any" ? ", or Any model" : ""}.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {items.map((m, i) => <Card key={m.version_id} m={m} n={i} reveal={reveal} job={jobs[m.version_id]} onAdd={() => add(target(m))} onOpen={() => setOpen(m)} fits={inColl ? ["anima", "sdxl", "krea2", "h3"].includes(m.family) : made === "any" || m.family === made} />)}
                {loading && Array.from({ length: items.length ? 5 : 15 }, (_, i) => <div key={`s${i}`} className="shimmer aspect-[3/4]" />)}
              </div>
            )}
            <div ref={sentinel} className="h-px" />
            {!loading && !next && items.length > 0 && <p className="micro py-6 text-center text-dim">END OF RESULTS · {items.length}</p>}
            {err && items.length > 0 && <p className="py-4 text-center text-[12.5px] text-bad">{err} · <button className="underline" onClick={() => load(next)}>retry</button></p>}
          </div>

          <div className="flex items-center gap-3 border-t border-line px-5 py-3 text-[12.5px] text-muted">
            <span className="micro text-dim">{String(items.length).padStart(3, "0")} LOADED</span>
            {!hasKey && <button onClick={() => askCivitKey().then((ok) => ok && setHasKey(true))} className="shrink-0 border border-hot/60 px-2 py-1 text-[12px] text-hot hover:bg-hot/10">Add your CivitAI key</button>}
            <span>{added ? `${added} added — they're in every LoRA list now.` : "Click a card for its examples and prompts. Add puts it in your library for every rental."}</span>
            <button onClick={close} className="press btn-primary chamfer ml-auto h-9 px-5 text-[13px]">Done</button>
          </div>
        </div>

        {open && <Detail m={open} reveal={reveal} jobs={jobs} installed={installed} onBack={() => setOpen(null)} onClose={close}
          add={add} onUsed={(tab) => { close(); openTab(tab); }} />}
      </div>
    </div>, document.body);
}

// ------------------------------------------------------------------ grid card
function Card({ m, n, reveal, job, onAdd, onOpen, fits }: { m: CivitLora; n: number; reveal: boolean; job?: LoraJob; onAdd: () => void; onOpen: () => void; fits: boolean }) {
  const [idx, setIdx] = useState(0);
  const [peek, setPeek] = useState(false);
  const img = m.images[idx] ?? m.images[0];
  const hide = img?.explicit && !reveal && !peek;
  const running = job?.status === "running";
  const done = m.installed || job?.status === "done";
  return (
    <div className="lb-card group relative aspect-[3/4] cursor-pointer overflow-hidden border border-line bg-raised2" onClick={onOpen}
      onMouseMove={(e) => { if (m.images.length < 2) return; const r = e.currentTarget.getBoundingClientRect(); setIdx(Math.min(m.images.length - 1, Math.floor(((e.clientX - r.left) / r.width) * m.images.length))); }}
      onMouseLeave={() => setIdx(0)} role="button" tabIndex={0} aria-label={`Open ${m.name}`} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      {img ? (img.video
        ? <video src={img.url} muted loop autoPlay playsInline className={cx("h-full w-full object-cover transition-[filter,transform] duration-300 group-hover:scale-[1.03]", hide && "scale-110 blur-2xl")} />
        : <img src={img.url} alt="" loading="lazy" decoding="async" className={cx("h-full w-full object-cover transition-[filter,transform] duration-300 group-hover:scale-[1.03]", hide && "scale-110 blur-2xl")} />)
        : <div className="flex h-full items-center justify-center text-dim"><Icon name="image" size={28} /></div>}
      {hide && <button onClick={(e) => { e.stopPropagation(); setPeek(true); }} className="micro absolute inset-x-0 top-1/2 mx-auto w-max -translate-y-1/2 bg-black/70 px-3 py-1.5 text-hot hover:bg-black/85">EXPLICIT · SHOW</button>}
      {m.images.length > 1 && (
        <div className="pointer-events-none absolute inset-x-2 top-2 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {m.images.map((_, i) => <span key={i} className={cx("h-[3px] flex-1", i === idx ? "bg-accent" : "bg-white/30")} />)}
        </div>
      )}
      <span className={cx("micro absolute left-2 top-3 px-1.5 py-0.5", fits ? "bg-black/70 text-ink" : "bg-hot text-black")} title={m.base}>{FAMILY_TAG[m.family] ?? m.base}</span>
      <span className="micro absolute right-2 top-3 text-white/45 group-hover:opacity-0">#{String(n + 1).padStart(3, "0")}</span>
      <button onClick={(e) => { e.stopPropagation(); onAdd(); }} disabled={running || done} aria-label={done ? `${m.name} is in your library` : `Add ${m.name}`}
        className={cx("press absolute right-2 top-3 flex h-8 items-center gap-1 px-2.5 text-[12.5px] font-bold shadow-lg transition",
          done ? "bg-good text-black" : running ? "bg-black/80 text-accent" : "btn-primary chamfer-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100")}>
        {done ? <><Icon name="check" size={13} />In library</> : running ? "Adding" : <><Icon name="plus" size={13} />Add</>}
      </button>
      {running && <div className="absolute inset-x-0 bottom-0 z-10 h-1 bg-black/60"><div className="h-full bg-good transition-[width] duration-300" style={{ width: `${Math.max(3, (job?.progress ?? 0) * 100)}%` }} /></div>}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-3 pb-2.5 pt-12">
        <p className="line-clamp-2 text-[14px] font-bold leading-tight text-white" title={m.name}>{m.name}</p>
        <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-white/60">
          <span className="truncate">{m.creator}</span>
          <span className="micro ml-auto flex shrink-0 items-center gap-0.5 text-white/70"><Icon name="down" size={10} />{fmt(m.downloads)}</span>
        </div>
        {m.trigger && <p className="mt-1 truncate font-mono text-[10.5px] text-accent" title={`Trigger words: ${m.trigger}`}>› {m.trigger}</p>}
        {job?.status === "error" && <p className="mt-1 line-clamp-2 text-[11px] text-bad">{job.error}</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ detail view
function Detail({ m, reveal, jobs, installed, onBack, onClose, add, onUsed }: {
  m: CivitLora; reveal: boolean; jobs: Record<number, LoraJob>; installed: Record<number, string>; onBack: () => void; onClose: () => void;
  add: (t: Target, pick?: boolean) => Promise<string | null>; onUsed: (tab: "create" | "animate" | "prompt" | "edit" | "characters") => void;
}) {
  const [model, setModel] = useState<CivitModel | null>(null);
  const [vid, setVid] = useState(m.version_id);
  const [imgs, setImgs] = useState<CivitImage[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(0);
  const [peek, setPeek] = useState<Record<number, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [full, setFull] = useState<Record<number, CivitGen | null>>({});
  const [only, setOnlyRaw] = useState<"all" | "prompt" | "workflow">(() => pref("only", "all") as "all");
  const setOnly = (v: typeof only) => { setOnlyRaw(v); setPref("only", v); setSel(0); };
  const [showAbout, setShowAbout] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const [hi, setHi] = useState<number | null>(null);
  // like the tray: the wheel scrolls the strip sideways, smoothly
  useEffect(() => {
    const el = strip.current; if (!el) return;
    let target = el.scrollLeft, raf = 0;
    const step = () => { const d = target - el.scrollLeft; if (Math.abs(d) < 0.5) { el.scrollLeft = target; raf = 0; return; } el.scrollLeft += d * 0.2; raf = requestAnimationFrame(step); };
    const w = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!dx) return;
      e.preventDefault();
      if (!raf) target = el.scrollLeft;
      target = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, target + dx * 1.3));
      if (!raf) raf = requestAnimationFrame(step);
    };
    el.addEventListener("wheel", w, { passive: false });
    return () => { el.removeEventListener("wheel", w); cancelAnimationFrame(raf); };
  });
  const toast = useJobs((s) => s.toast);

  useEffect(() => { civitModel(m.model_id).then(setModel).catch(() => setModel(null)); }, [m.model_id]);
  const v: CivitVersion = model?.versions.find((x) => x.id === vid)
    ?? { id: m.version_id, name: m.version, base: m.base, family: famOf(m.base), trigger: m.trigger, size_mb: m.size_mb, installed: m.installed, created: "" };
  const loadImgs = async (cursor: string | null) => {
    setLoading(true); setErr(null);
    try {
      const r = await civitImages(vid, m.name, cursor);
      setImgs((old) => (cursor ? [...old, ...r.items] : r.items)); setNext(r.next);
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { setImgs([]); setSel(0); loadImgs(null); }, [vid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if (e.key === "ArrowRight") setSel((s) => Math.min(shownLen.current - 1, s + 1));
      if (e.key === "ArrowLeft") setSel((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => { strip.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); if (next && !loading && sel > shownLen.current - 6) loadImgs(next); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = only === "prompt" ? imgs.filter((x) => x.prompt) : only === "workflow" ? imgs.filter((x) => x.workflow) : imgs;
  const img = shown[sel];
  const shownLen = useRef(0); shownLen.current = shown.length;
  const hidden = img?.explicit && !reveal && !peek[img.id];
  const job = jobs[v.id];
  const have = v.installed || !!installed[v.id] || job?.status === "done";
  const running = job?.status === "running";
  const fits = v.family === "h3" ? "Animate" : v.family === "anima" ? "Create · Anima" : v.family === "sdxl" ? "Create · Illustrious" : v.family === "krea2" ? "Create · Krea 2" : "";
  const t: Target = { model_id: m.model_id, version_id: v.id, name: m.name, trigger: v.trigger };
  const copy = (text: string, what: string) => copyText(text, `${what} copied`);

  // the full generation data (every resource used) loads in the background; the example's own data shows meanwhile
  useEffect(() => {
    if (!img || img.id in full) return;
    civitImage(String(img.id)).then((g) => setFull((f) => ({ ...f, [img.id]: g }))).catch(() => setFull((f) => ({ ...f, [img.id]: null })));
  }, [img?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = img ? genFromExample(img, v, m, installed[v.id]) : null;
  const got = img ? full[img.id] : undefined;
  const gen: CivitGen | null = !base ? null : !got ? base : {
    ...got, prompt: got.prompt || base.prompt, negative: got.negative || base.negative,
    // make sure this LoRA is in the list, with the weight the example used
    resources: got.resources.some((r) => r.version_id === v.id) ? got.resources : [...base.resources, ...got.resources],
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button onClick={onBack} className="press btn-raised flex h-9 items-center gap-1.5 px-3 text-[13px] font-medium"><Icon name="back" size={14} />All LoRAs</button>
        <div className="min-w-0">
          <div className="micro text-dim">MODEL {m.model_id} · VER {v.id}</div>
          <h2 className="display truncate text-[22px] leading-tight">{m.name}</h2>
        </div>
        <a href={`https://civitai.com/models/${m.model_id}?modelVersionId=${v.id}`} target="_blank" rel="noreferrer" className="press btn-raised ml-auto flex h-9 items-center gap-1.5 px-3 text-[13px] text-muted hover:text-ink">CivitAI<Icon name="external" size={13} /></a>
        <button aria-label="Close" onClick={onClose} className="press btn-raised flex h-9 w-9 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={16} /></button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* viewer + strip */}
        <div className="flex min-w-0 flex-1 flex-col bg-black/40">
          <div className="relative min-h-0 flex-1">
            {img ? (img.video
              ? <video key={img.id} src={img.url} controls autoPlay muted loop playsInline className={cx("absolute inset-0 h-full w-full object-contain", hidden && "blur-3xl")} />
              : <img key={img.id} src={img.url} alt="" onContextMenu={(e) => openPictureMenu(e, { civitId: img.id, url: img.url, gen: gen ?? undefined })} title="Right-click: use in Edit, copy its look, save…" className={cx("fade-in absolute inset-0 h-full w-full object-contain", hidden && "blur-3xl")} />)
              : <div className="absolute inset-0 flex items-center justify-center">{loading ? <div className="shimmer h-3/4 w-1/2" /> : <p className="text-[13px] text-muted">{err ?? "No example pictures for this version."}</p>}</div>}
            {hidden && <button onClick={() => setPeek((p) => ({ ...p, [img.id]: true }))} className="micro absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/75 px-4 py-2 text-hot">EXPLICIT · SHOW</button>}
            {shown.length > 1 && <>
              <button aria-label="Previous example" disabled={sel === 0} onClick={() => setSel((s) => s - 1)} className="press glass-btn absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center disabled:opacity-30"><Icon name="back" size={18} /></button>
              <button aria-label="Next example" disabled={sel >= shown.length - 1} onClick={() => setSel((s) => s + 1)} className="press glass-btn absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 rotate-180 items-center justify-center disabled:opacity-30"><Icon name="back" size={18} /></button>
            </>}
            <span className="micro absolute bottom-3 left-3 bg-black/70 px-2 py-1 text-ink">{shown.length ? `${String(sel + 1).padStart(2, "0")} / ${String(shown.length).padStart(2, "0")}${next ? "+" : ""}` : "--"}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1 border-t border-line bg-panel px-2 pt-1.5">
            <span className="micro mr-1 text-dim">SHOW</span>
            {([["all", "All"], ["prompt", "With a prompt"], ["workflow", "With a workflow"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setOnly(v)} aria-pressed={only === v} className={cx("press tag-btn !h-6 !px-2 !text-[11.5px]", only === v && "on")}>{l}</button>
            ))}
            <span className="micro ml-auto text-dim">{imgs.filter((x) => x.prompt).length} WITH PROMPTS · {imgs.filter((x) => x.workflow).length} WITH WORKFLOWS{next ? " SO FAR" : ""}</span>
          </div>
          <div ref={strip} onMouseLeave={() => setHi(null)} className="flex h-[112px] shrink-0 items-end gap-1.5 overflow-x-auto overflow-y-hidden bg-panel px-2 pb-2 pt-1"
            onScroll={(e) => { const el = e.currentTarget; if (next && !loading && el.scrollLeft + el.clientWidth > el.scrollWidth - 300) loadImgs(next); }}>
            {shown.map((x, i) => (
              <button key={x.id} data-i={i} onClick={() => setSel(i)} onMouseEnter={() => setHi(i)} aria-label={`Example ${i + 1}`} onContextMenu={(e) => openPictureMenu(e, { civitId: x.id, url: x.url, video: x.video })}
                style={{ transform: `scale(${hi == null ? 1 : [1.45, 1.22, 1.08][Math.abs(i - hi)] ?? 1})`, transformOrigin: "bottom center", zIndex: hi === i ? 2 : 1 }}
                className={cx("relative h-[72px] w-[54px] shrink-0 overflow-hidden border-2 transition-[transform,opacity] duration-150 ease-out", i === sel ? "border-accent" : "border-transparent opacity-70 hover:opacity-100")}>
                {x.video ? <video src={x.thumb} muted className="h-full w-full object-cover" /> : <img src={x.thumb} alt="" loading="lazy" className={cx("h-full w-full object-cover", x.explicit && !reveal && !peek[x.id] && "blur-md")} />}
                {!x.prompt && <span className="absolute inset-x-0 bottom-0 bg-black/70 text-center text-[9px] text-white/70">no prompt</span>}
                {x.workflow && <span className="micro absolute right-0.5 top-0.5 bg-black/75 px-0.5 text-[8.5px] text-cyan">WF</span>}
              </button>
            ))}
            {loading && Array.from({ length: 6 }, (_, i) => <div key={i} className="shimmer h-full w-[60px] shrink-0" />)}
          </div>
        </div>

        {/* side panel */}
        <aside className="flex w-[400px] shrink-0 flex-col overflow-y-auto border-l border-line">
          <div className="flex flex-col gap-3 border-b border-line p-4">
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
              <span>by <b className="font-semibold text-ink">{model?.creator ?? m.creator}</b></span>
              <span className="micro ml-auto flex items-center gap-1"><Icon name="down" size={10} />{fmt(model?.downloads ?? m.downloads)}</span>
            </div>
            {(model?.versions.length ?? 0) > 1 && (
              <label className="flex flex-col gap-1"><span className="lbl">Version</span>
                <DropSelect value={vid} onChange={(e) => setVid(Number(e.target.value))} className="inset h-10 border border-line px-2.5 text-[13.5px] focus:border-accent focus:outline-none">
                  {model!.versions.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.base}{x.installed || installed[x.id] ? " (in library)" : ""}</option>)}
                </DropSelect>
              </label>
            )}
            <div className="grid grid-cols-3 gap-px border border-line bg-line text-[12px]">
              {([["MODEL", v.base || "?"], ["SIZE", v.size_mb ? `${v.size_mb} MB` : "?"], ["FITS", fits || "Not here"]] as const).map(([k, val]) => (
                <div key={k} className="bg-panel px-2.5 py-2"><div className="micro text-dim">{k}</div><div className={cx("mt-0.5 truncate font-medium", k === "FITS" && !fits ? "text-hot" : "text-ink")}>{val}</div></div>
              ))}
            </div>
            {v.trigger && (
              <div>
                <div className="lbl mb-1 flex items-center">Trigger words<button className="ml-auto text-[12px] font-medium text-accent hover:underline" onClick={() => copy(v.trigger, "Trigger words")}>Copy</button></div>
                <div className="flex flex-wrap gap-1">{v.trigger.split(/,\s*/).filter(Boolean).map((w) => <code key={w} className="border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[11.5px] text-accent">{w}</code>)}</div>
              </div>
            )}
            <button onClick={() => add(t)} disabled={have || running}
              className={cx("press chamfer flex h-11 items-center justify-center gap-2 text-[14px] font-bold", have ? "bg-good/15 text-good" : "btn-primary")}>
              {have ? <><Icon name="check" size={15} />In your library</> : running ? <span className="micro">ADDING…</span> : <><Icon name="plus" size={15} />Add to library</>}
            </button>
            {running && <div className="h-1 bg-raised2"><div className="h-full bg-good transition-[width] duration-300" style={{ width: `${Math.max(3, (job?.progress ?? 0) * 100)}%` }} /></div>}
          </div>

          <div className="flex flex-col gap-3 border-b border-line p-4">
            <div className="flex items-center"><span className="micro text-dim">EXAMPLE {shown.length ? String(sel + 1).padStart(2, "0") : "--"} · HOW IT WAS MADE</span>
              {img?.reactions ? <span className="micro ml-auto text-dim">♥ {fmt(img.reactions)}</span> : null}</div>
            {gen ? <GenData key={gen.id} gen={gen} loading={!!img && !(img.id in full)} onDone={onUsed} />
              : <p className="text-[12.5px] text-muted">{loading ? "Loading examples…" : "No examples for this version."}</p>}
          </div>

          {model?.description && (
            <div className="p-4">
              <button className="lbl flex w-full items-center hover:text-ink" onClick={() => setShowAbout((s) => !s)}>About this LoRA<span className="ml-auto">{showAbout ? "−" : "+"}</span></button>
              <p className={cx("mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted", !showAbout && "line-clamp-4")}>{model.description}</p>
              {model.tags.length > 0 && <div className="mt-2.5 flex flex-wrap gap-1">{model.tags.slice(0, 10).map((tg) => <span key={tg} className="micro border border-line px-1.5 py-0.5 text-dim">{tg}</span>)}</div>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
