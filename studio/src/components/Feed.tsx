import { useEffect, useState, type ReactNode } from "react";
import { openPictureMenu } from "./PictureMenu";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { viewUrl } from "../lib/api";
import { useJobs, type Job, type Output, type Tab } from "../lib/jobs";
import { isFav, toggleFav, useFavs } from "../lib/favs";
import { canRemix, editPicture, remix } from "../lib/remix";
import { DRAG_TYPE, trayIdOf, useTray } from "../lib/tray";
import { useSettings } from "../lib/settings";
import { useCharacters } from "../lib/characters";
import { sendTo } from "../App";
import { Icon, JobBar, MediaView, cx, fmtDur } from "./ui";
import { copyText } from "../lib/copy";
import { pickKey, useSelect, type Picked } from "../lib/select";

const NONE: Record<string, Picked> = {};

interface Item { o: Output; j: Job }
/** what a picture was made with, kept on its job: shown full screen under "How it was made" */
export interface SentInfo { prompt: string; words?: string; negative?: string; model: string; checkpoint?: string; loras: { name: string; strength: number }[]; size: string; seed: number;
  steps?: number; cfg?: number; sampler?: string; scheduler?: string; character?: string }
type Act = { label: string; icon: string; run: () => void; primary?: boolean; danger?: boolean };

/** Brush / painted edits happen in Edit: the picture goes in as Picture 1 with the LoRAs it was made with */
function toBrush(j: Job, o: Output) {
  const snap = j.meta?.snapshot as { section?: string; settings?: Record<string, unknown> } | undefined;
  if (snap?.section === "create" && snap.settings) {
    const s = snap.settings;
    const anime = s.style === "anime";
    const engine = !anime ? "krea" : s.animeModel === "noob" ? "noob" : "anima";
    const from = !anime ? "lorasKrea" : engine === "noob" ? "lorasAnime" : "lorasAnima";
    const to = engine === "krea" ? "lorasKrea" : engine === "noob" ? "lorasNoob" : "lorasAnima";
    useSettings.getState().set("edit", { engine, ...(Array.isArray(s[from]) ? { [to]: s[from] } : {}) } as never);
  }
  useTray.getState().addOutput(o, j.label);
  sendTo("edit", [trayIdOf(o)], "brush"); // Picture 1, and the paint window opens on it
}

function actionsFor({ o, j }: Item): Act[] {
  const id = trayIdOf(o);
  const a: Act[] = [];
  if (o.kind === "image") {
    a.push({ label: "Edit / remix", icon: "sparkle", run: () => { editPicture(j, o).catch((e) => useJobs.getState().toast((e as Error).message, "bad")); }, primary: true });
    a.push({ label: "Animate", icon: "play", run: () => { useTray.getState().addOutput(o, j.label); sendTo("animate", [id], "start"); } });
    a.push({ label: "Brush edit", icon: "brush", run: () => toBrush(j, o) });
  }
  if (o.kind === "video") {
    if (canRemix(j)) a.push({ label: "Remix", icon: "refresh", run: () => remix(j), primary: true });
    a.push({ label: "Trim, loop & export", icon: "film", run: () => { useTray.getState().addOutput(o, j.label); sendTo("finish", [id]); }, primary: !canRemix(j) });
  }
  a.push({ label: "Delete", icon: "trash", danger: true, run: () => useJobs.getState().removeOutputs([{ jobId: j.id, filename: o.filename, subfolder: o.subfolder }]) });
  return a;
}

/** newest-first results with live progress, hover actions and a full-screen viewer */
export function Feed({ tab, empty, kinds = ["image", "video"], extra }: {
  tab: Tab; empty: ReactNode; kinds?: string[]; extra?: (it: Item) => Act[];
}) {
  // each project (character on the left) has its own results; "All projects" shows everything
  const sel = useCharacters((s) => s.sel);
  const selName = useCharacters((s) => s.list.find((x) => x.id === s.sel)?.name);
  const [all, setAll] = useState(false);
  const allJobs = useJobs(useShallow((s) => s.jobs.filter((j) => j.tab === tab && !j.meta?.styleKey && !j.meta?.quiet && !j.meta?.selfcheck && j.meta?.kind !== "selfcheck")));
  const mine = (j: Job) => (typeof j.meta?.project === "string" ? j.meta.project : null) === sel;
  const jobs = all ? allJobs : allJobs.filter(mine);
  const elsewhere = allJobs.filter((j) => !mine(j) && j.status === "done").length;
  const favs = useFavs((s) => s.set);
  const [onlyFav, setOnlyFav] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const active = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const items: Item[] = jobs.filter((j) => j.status === "done").flatMap((j) => j.outputs.filter((o) => kinds.includes(o.kind) && o.type === "output").map((o) => ({ o, j })));
  const shown = onlyFav ? items.filter((it) => isFav(favs, it.o)) : items;
  // one press = one stack: a ×4 batch, or More like this / Remix variants on the picture they came from — arrows flip through
  const stacks: Item[][] = [];
  {
    const at = new Map<string, number>();
    for (const it of shown) {
      const own = trayIdOf(it.o);
      const st = it.j.meta?.stack;
      const key = typeof st === "string" ? st : `job:${it.j.id}`;
      const i = at.get(key) ?? at.get(own);
      if (i != null) { stacks[i].push(it); at.set(own, i); }
      else { at.set(key, stacks.length); at.set(own, stacks.length); stacks.push([it]); }
    }
    // the original first, then the rest in the order they were made
    const variant = (it: Item) => (typeof it.j.meta?.stack === "string" && !(it.j.meta.stack as string).startsWith("batch:") ? 1 : 0);
    for (const st of stacks) st.sort((a, b) => variant(a) - variant(b) || a.j.queuedAt - b.j.queuedAt || a.j.outputs.indexOf(a.o) - b.j.outputs.indexOf(b.o));
  }
  const [size, setSize] = useState<"s" | "m" | "l">(() => { try { return (localStorage.getItem("h3.feed.size") as "s" | "m" | "l") || "m"; } catch { return "m"; } });
  const pickSize = (v: "s" | "m" | "l") => { setSize(v); try { localStorage.setItem("h3.feed.size", v); } catch { /* */ } };
  const failed = jobs.find((j) => j.status === "error" && !j.meta?.quietFail); // a recipe's / picked pictures' failures get one summary instead
  const acts = (it: Item) => [...actionsFor(it), ...(extra?.(it) ?? [])];
  const picked = useSelect((s) => (s.tab === tab ? s.items : NONE));
  const selecting = useSelect((s) => s.tab === tab && (s.mode || Object.keys(s.items).length > 0));
  const nPicked = Object.keys(picked).length;
  const onPick = (it: Item, shift: boolean) => {
    const st = useSelect.getState();
    const a = st.tab === tab && st.anchor ? shown.findIndex((x) => pickKey(x.o) === st.anchor) : -1;
    const b = shown.indexOf(it);
    if (shift && a >= 0 && b >= 0) st.setMany(tab, shown.slice(Math.min(a, b), Math.max(a, b) + 1), true);
    else st.toggle(tab, it);
  };
  const pick = { picked, selecting, onPick };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 pt-1">
        <h2 className="display text-[17px] ">Results</h2>
        <span className="text-xs text-dim">{all ? "all projects" : selName ? `${selName}'s project` : "Free work"}{items.length ? ` · ${items.length}` : ""}</span>
        {(elsewhere > 0 || all) && <button onClick={() => setAll((v) => !v)} className="text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline">{all ? "Only this project" : `+ ${elsewhere} in other projects`}</button>}
        <button onClick={() => import("./Catalog").then((m) => m.openCatalog())} title="Every picture and video on this rental, including older ones" className="text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline">Catalog · all of them</button>
        {items.length > 0 && (selecting ? (
          <span className="ml-auto flex items-center gap-2 text-[12px]">
            <span className="text-ink">{nPicked} picked</span>
            <button onClick={() => useSelect.getState().setMany(tab, shown, nPicked < shown.length)} className="text-muted underline-offset-2 hover:text-ink hover:underline">{nPicked < shown.length ? `Select all ${shown.length}` : "Select none"}</button>
            <button onClick={() => useSelect.getState().clear()} className="text-muted underline-offset-2 hover:text-ink hover:underline">Done</button>
          </span>
        ) : (
          <button onClick={() => useSelect.getState().start(tab)} title="Pick several pictures, then upscale, sharpen, add to a set or run a recipe on all of them (or tick a picture's corner)"
            className="press chip-raised ml-auto flex h-7 items-center gap-1.5 rounded-sm px-3 text-xs text-muted hover:text-ink"><Icon name="check" size={12} /> Select</button>
        ))}
        {items.length > 0 && (
          <span className={cx("flex items-center gap-0.5", selecting && "ml-1")} role="group" aria-label="Picture size">
            {(["s", "m", "l"] as const).map((v) => (
              <button key={v} onClick={() => pickSize(v)} aria-pressed={size === v} title={{ s: "Small — many at once", m: "Medium", l: "Large" }[v]}
                className={cx("press flex h-7 w-7 items-center justify-center text-[11px] font-semibold", size === v ? "bg-hover text-ink" : "text-dim hover:text-ink")}>{v.toUpperCase()}</button>
            ))}
          </span>
        )}
        {items.length > 0 && (
          <button onClick={() => setOnlyFav((v) => !v)} className={cx("press chip-raised flex h-7 items-center gap-1.5 rounded-sm px-3 text-xs", onlyFav ? "!border-accent text-ink" : "text-muted hover:text-ink")}>
            <Star on={onlyFav} size={12} /> Favourites
          </button>
        )}
      </div>
      {active.map((j) => <RunningCard key={j.id} j={j} />)}
      {failed && !active.length && failed === jobs.find((j) => j.status !== "cancelled" && !j.meta?.quietFail) && (
        <div className="fade-up rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-[13px]"><b>{failed.label} failed.</b> <span className="text-ink/80">{failed.error}</span></div>
      )}
      {!shown.length && !active.length ? (
        <div className="fade-in flex min-h-64 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line px-8 py-14 text-center text-[13px] text-muted">
          {onlyFav ? "No favourites yet — tap the ★ on a result." : empty}
        </div>
      ) : (
        <div className={cx("gap-2 [&>*]:mb-2", { s: "columns-3 md:columns-4 xl:columns-5 2xl:columns-7", m: "columns-2 md:columns-3 2xl:columns-5", l: "columns-1 md:columns-2 2xl:columns-3" }[size])}>
          {stacks.map((st, i) => <Stack key={trayIdOf(st[0].o)} st={st} favs={favs} acts={acts} size={size} onOpen={(it) => setOpen(shown.indexOf(it))} delay={Math.min(i, 8) * 30} sel={pick} />)}
        </div>
      )}
      {open != null && shown[open] && createPortal(<Lightbox items={shown} index={open} setIndex={setOpen} acts={acts} />, document.body)}
    </div>
  );
}

function Star({ on, size = 16 }: { on: boolean; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? "#F0A845" : "none"} stroke={on ? "#F0A845" : "currentColor"} strokeWidth="2" aria-hidden><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>;
}

function RunningCard({ j }: { j: Job }) {
  return (
    <div className={cx("fade-up card overflow-hidden rounded-2xl border border-line", j.status === "running" && "run-border")}>
      <div className="relative flex h-72 items-center justify-center overflow-hidden bg-black/60">
        {j.preview ? <img src={j.preview} alt="Live preview" className="h-full w-full object-contain transition-opacity duration-300" />
          : <div className="shimmer absolute inset-0" />}
        <span className="glass absolute left-3 top-3 rounded-sm px-3 py-1 text-xs font-medium">{j.label}</span>
        {j.status === "queued" && <span className="glass absolute right-3 top-3 rounded-sm px-3 py-1 text-xs text-muted">waiting in line</span>}
      </div>
      <div className="px-4 py-3"><JobBar job={j} /></div>
    </div>
  );
}

/** one press of Generate (or a picture and its variants): hover to flip through with the arrows or the dots */
type Sel = { picked: Record<string, Picked>; selecting: boolean; onPick: (it: Item, shift: boolean) => void };
function Stack({ st, favs, acts, onOpen, delay, size, sel }: { st: Item[]; favs: ReturnType<typeof useFavs.getState>["set"]; acts: (it: Item) => Act[]; onOpen: (it: Item) => void; delay: number; size: "s" | "m" | "l"; sel: Sel }) {
  const [i, setI] = useState(0);
  const n = st.length;
  useEffect(() => { if (i >= n) setI(Math.max(0, n - 1)); }, [n, i]);
  const it = st[Math.min(i, n - 1)];
  if (n === 1) return <FeedCard it={it} fav={isFav(favs, it.o)} acts={acts(it)} onOpen={() => onOpen(it)} delay={delay} size={size} sel={sel} />;
  const go = (d: number) => setI((x) => (x + d + n) % n);
  const nav = "press absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/80 group-hover/stack:opacity-100";
  return (
    <div className="group/stack relative break-inside-avoid" onKeyDown={(e) => { if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); }}>
      <span aria-hidden className="absolute inset-x-2 -bottom-1 h-2 rounded-b-xl border border-line bg-raised2" />
      <FeedCard it={it} fav={isFav(favs, it.o)} acts={acts(it)} onOpen={() => onOpen(it)} delay={delay} size={size} sel={sel}
        onDeleteAll={() => useJobs.getState().removeOutputs(st.map((x) => ({ jobId: x.j.id, filename: x.o.filename, subfolder: x.o.subfolder })))} count={n} />
      <button className={cx(nav, "left-2")} onClick={() => go(-1)} aria-label="Previous picture"><Icon name="back" size={16} /></button>
      <button className={cx(nav, "right-2")} onClick={() => go(1)} aria-label="Next picture"><Icon name="arrow" size={16} /></button>
      <div className="pointer-events-none absolute inset-x-0 top-2.5 z-10 flex justify-center gap-1 [&>*]:pointer-events-auto" aria-hidden={false}>
        {st.map((_, k) => <button key={k} onClick={() => setI(k)} aria-label={`Picture ${k + 1} of ${n}`} className={cx("h-1.5 rounded-full transition-all", k === i ? "w-4 bg-white" : "w-1.5 bg-white/45 hover:bg-white/80")} />)}
      </div>
    </div>
  );
}

function FeedCard({ it, fav, acts, onOpen, delay, size, count = 1, onDeleteAll, sel }: { it: Item; fav: boolean; acts: Act[]; onOpen: () => void; delay: number; size: "s" | "m" | "l"; count?: number; onDeleteAll?: () => void; sel: Sel }) {
  const { o, j } = it;
  const on = !!sel.picked[pickKey(o)];
  const took = j.startedAt && j.endedAt ? fmtDur(j.endedAt - j.startedAt) : "";
  const primary = acts.find((a) => a.primary);
  const del = acts.find((a) => a.danger);
  const rest = acts.filter((a) => a !== primary && a !== del);
  const words = size === "l";
  const drag = (e: React.DragEvent) => {
    // drag a result anywhere: a slot, the Create box, Animate…
    const item = useTray.getState().addOutput(o, j.label);
    if (item) { e.dataTransfer.setData(DRAG_TYPE, item.id); e.dataTransfer.effectAllowed = "copy"; }
  };
  return (
    <div className={cx("fade-up card-hover group relative break-inside-avoid overflow-hidden rounded-xl border bg-black", on ? "border-accent ring-2 ring-accent" : "border-line")} style={{ animationDelay: `${delay}ms` }}>
      <button onClick={(e) => (sel.selecting || e.shiftKey ? sel.onPick(it, e.shiftKey) : onOpen())} draggable onDragStart={drag} className={cx("block min-h-[120px] w-full", o.filename.includes("cutout") && "checker")} aria-label="Open full screen">
        {o.kind === "video"
          ? <video src={viewUrl(o)} muted loop playsInline preload="metadata" className="block w-full" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
          : <img src={viewUrl(o)} alt="" loading="lazy" draggable={false} onContextMenu={(e) => openPictureMenu(e, { output: o, label: j.label })} className="block w-full transition-transform duration-500 group-hover:scale-[1.015]" />}
      </button>
      <button onClick={(e) => sel.onPick(it, e.shiftKey)} aria-label={on ? "Unselect" : "Select"} aria-pressed={on} title="Select (Shift+click: everything in between)"
        className={cx("press absolute left-2 top-2 z-30 flex h-7 w-7 items-center justify-center rounded-full border-2 transition-opacity", on ? "border-accent bg-accent text-accentink opacity-100" : "border-white/80 bg-black/40 text-transparent hover:text-white/80", on || sel.selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100")}>
        <Icon name="check" size={14} />
      </button>
      <button onClick={() => toggleFav(o)} aria-label={fav ? "Remove from favourites" : "Add to favourites"} aria-pressed={fav}
        className={cx("press glass-btn absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-sm", fav ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100")}>
        <Star on={fav} size={15} />
      </button>
      {o.kind === "video" && <span className="glass pointer-events-none absolute left-11 top-2.5 flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px]"><Icon name="play" size={10} /> video</span>}
      {count > 1 && <span className="micro pointer-events-none absolute left-11 top-2.5 z-10 bg-black/70 px-1.5 py-0.5 text-white">×{count}</span>}
      <div className={cx("pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-2 pb-2 pt-8 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100", sel.selecting && "hidden")}>
        <div className="pointer-events-auto flex flex-wrap items-center gap-1">
          {primary && <button onClick={primary.run} title={primary.label} className="press btn-primary flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-accentink"><Icon name={primary.icon} size={13} /><span className={cx("truncate", size === "s" && "hidden")}>{primary.label}</span></button>}
          {rest.map((a) => (
            <button key={a.label} onClick={a.run} title={a.label} className="press glass-btn flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] text-ink"><Icon name={a.icon} size={13} />{words && <span>{a.label}</span>}</button>
          ))}
          <span className="ml-auto flex items-center gap-1">
            <button onClick={(e) => openPictureMenu(e, { output: o, label: j.label })} title="More: More like this, copy, save…" aria-label="More" className="press glass-btn flex h-8 w-8 items-center justify-center rounded-lg text-ink"><Icon name="dots" size={14} /></button>
            <a href={viewUrl(o)} download={o.filename} title="Download" aria-label="Download" className="press glass-btn flex h-8 w-8 items-center justify-center rounded-lg text-ink"><Icon name="down" size={14} /></a>
            {del && <button onClick={(e) => (e.shiftKey && onDeleteAll ? onDeleteAll() : del.run())} title={onDeleteAll ? "Delete this picture (Shift+click: delete all " + count + ")" : "Delete"} aria-label="Delete" className="press glass-btn flex h-8 w-8 items-center justify-center rounded-lg text-ink hover:text-bad"><Icon name="trash" size={14} /></button>}
          </span>
        </div>
        {took && size !== "s" && <div className="pointer-events-none mt-1 truncate text-[11px] text-white/60">{j.label} · {took}</div>}
      </div>
    </div>
  );
}

function Lightbox({ items, index, setIndex, acts }: { items: Item[]; index: number; setIndex: (i: number | null) => void; acts: (it: Item) => Act[] }) {
  const it = items[index];
  const favs = useFavs((s) => s.set);
  const [info, setInfo] = useState(() => { try { return localStorage.getItem("h3.howmade") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("h3.howmade", info ? "1" : "0"); } catch { /* */ } }, [info]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIndex(null);
      if (e.key === "ArrowRight") setIndex(Math.min(items.length - 1, index + 1));
      if (e.key === "ArrowLeft") setIndex(Math.max(0, index - 1));
      if (e.key.toLowerCase() === "f" && !(e.target instanceof HTMLInputElement)) toggleFav(it.o);
      if (e.key.toLowerCase() === "i" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) setInfo((v) => !v);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, it, setIndex]);
  const nav = "press glass-btn absolute top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-sm text-ink hover:bg-white/10 disabled:opacity-30";
  return (
    <div className="fade-in fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-md" role="dialog" aria-label="Viewer" onClick={() => setIndex(null)}>
      <div className="flex items-center gap-3 px-6 py-4 text-[13px]" onClick={(e) => e.stopPropagation()}>
        <span className="font-medium">{it.j.label}</span><span className="text-white/50">{index + 1} / {items.length}</span>
        <button onClick={() => setInfo((v) => !v)} aria-pressed={info} className={cx("press ml-4 flex h-8 items-center gap-1.5 border px-3 text-[12.5px]", info ? "border-accent text-accent" : "border-white/20 text-white/80 hover:text-white")}><Icon name="search" size={13} />How it was made (I)</button>
        <button onClick={() => setIndex(null)} aria-label="Close" className="press ml-auto flex h-9 w-9 items-center justify-center rounded-sm hover:bg-white/10"><Icon name="x" /></button>
      </div>
      <div className="flex min-h-0 flex-1">
      <div className="relative min-h-0 flex-1 px-20" onClick={(e) => e.stopPropagation()}>
        <div key={index} className="zoom-in flex h-full items-center justify-center">
          <div className={cx("max-h-full max-w-full", it.o.filename.includes("cutout") && "checker")}>
            <MediaView m={{ url: viewUrl(it.o), kind: it.o.kind }} contain className="max-h-[calc(100vh-180px)] !h-auto !w-auto max-w-full" />
          </div>
        </div>
        <button className={cx(nav, "left-6")} disabled={index === 0} onClick={() => setIndex(index - 1)} aria-label="Previous"><Icon name="back" /></button>
        <button className={cx(nav, "right-6")} disabled={index === items.length - 1} onClick={() => setIndex(index + 1)} aria-label="Next"><Icon name="arrow" /></button>
      </div>
      {info && <HowMade it={it} onClose={() => setInfo(false)} done={() => setIndex(null)} />}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 px-6 py-5" onClick={(e) => e.stopPropagation()}>
        {acts(it).map((a) => (
          <button key={a.label} onClick={() => { a.run(); setIndex(null); }}
            className={cx("press flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-medium", a.primary ? "btn-primary text-accentink" : a.danger ? "glass-btn text-ink hover:text-bad" : "glass-btn text-ink")}>
            <Icon name={a.icon} size={14} /> {a.label}
          </button>
        ))}
        <button onClick={() => toggleFav(it.o)} className="press glass-btn flex h-10 items-center gap-2 rounded-xl px-4 text-[13px]"><Star on={isFav(favs, it.o)} size={14} /> {isFav(favs, it.o) ? "Favourite" : "Favourite (F)"}</button>
        <a href={viewUrl(it.o)} download={it.o.filename} className="press glass-btn flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] text-ink"><Icon name="down" size={14} /> Download</a>
      </div>
    </div>
  );
}

/** the prompt and settings a result was made with — and a button to use them again */
function HowMade({ it, onClose, done }: { it: Item; onClose: () => void; done: () => void }) {
  const sent = it.j.meta?.sent as SentInfo | undefined;
  const snap = it.j.meta?.snapshot as { section?: string; settings?: Record<string, unknown> } | undefined;
  const toast = useJobs((s) => s.toast);
  const copy = (t: string) => copyText(t);
  const usePrompt = () => {
    if (!sent) return;
    const s = snap?.settings ?? {};
    useSettings.getState().set("create", { ...(s.style ? { style: s.style, animeModel: s.animeModel, realModel: s.realModel } : {}), raw: true, extra: sent.prompt, negative: sent.negative ?? "" } as never);
    useSettings.getState().setTab("create");
    toast("In Create as an exact prompt — change it, or press Generate", "good");
    done();
  };
  const full = async () => {
    const item = useTray.getState().addOutput(it.o, it.j.label);
    if (!item) return;
    const m = await useTray.getState().asMedia(item.id);
    const { openFileMeta } = await import("./ImageImport");
    openFileMeta(m); done();
  };
  const row = (k: string, v: ReactNode) => v === undefined || v === "" ? null : <div className="flex gap-2 py-0.5"><dt className="w-20 shrink-0 text-white/45">{k}</dt><dd className="min-w-0 flex-1 break-words font-mono text-[11.5px] text-white/90">{v}</dd></div>;
  return (
    <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-white/10 bg-black/40 p-4 text-[12.5px]" onClick={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center"><span className="micro text-white/60">HOW IT WAS MADE</span><button onClick={onClose} aria-label="Close" className="ml-auto text-white/60 hover:text-white"><Icon name="x" size={14} /></button></div>
      {sent ? <>
        <div className="mb-1 flex items-center gap-2"><span className="micro text-white/45">PROMPT SENT</span><button className="micro ml-auto text-white/60 hover:text-white" onClick={() => copy(sent.prompt)}>COPY</button></div>
        <p className="max-h-60 overflow-y-auto whitespace-pre-wrap border border-white/10 bg-white/[.03] p-2 font-mono text-[11.5px] leading-relaxed text-white/90">{sent.prompt}</p>
        {sent.words && sent.words !== sent.prompt && <p className="mt-1.5 text-[11.5px] text-white/50">Your words: “{sent.words}”</p>}
        <dl className="mt-3">
          {row("Model", sent.model)}{row("Checkpoint", sent.checkpoint?.split("/").pop())}{row("Character", sent.character)}
          {row("LoRAs", sent.loras.length ? sent.loras.map((l) => `${l.name.split("/").pop()?.replace(/\.safetensors$/, "")} @ ${l.strength}`).join(", ") : "none")}
          {row("Negative", sent.negative)}{row("Size", sent.size)}{row("Seed", sent.seed)}
          {row("Sampler", [sent.sampler, sent.scheduler].filter(Boolean).join(" · "))}{row("Steps", sent.steps)}{row("CFG", sent.cfg)}
        </dl>
        <div className="mt-3 flex flex-col gap-1.5">
          <button onClick={usePrompt} className="press btn-primary h-9 text-[12.5px] font-semibold text-accentink">Use this prompt in Create</button>
          <button onClick={full} className="press glass-btn h-9 text-[12.5px] text-white">Everything inside the file (pieces, workflow)…</button>
        </div>
      </> : <>
        <p className="text-white/70">This one was made before the Studio kept its settings with it — the prompt and workflow are still inside the file.</p>
        <button onClick={full} className="press btn-primary mt-3 h-9 w-full text-[12.5px] font-semibold text-accentink">Read it from the file</button>
      </>}
    </aside>
  );
}
