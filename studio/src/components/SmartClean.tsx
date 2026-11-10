// Storage → Suggested clean-up. The way phone cleaners do it: what's probably not worth its disk, grouped by reason with
// sizes; nothing goes until you've looked and pressed. Keepers are never suggested — starred (F in the viewer, or ★),
// downloaded, or used by a character or scene. The reasons (scripts/studio_server.py, "smart clean-up"):
//   models   — model downloads no job of yours has loaded, on any rental (the usage log)
//   early    — earlier tries of a prompt you kept changing; the last version is where you ended up, so it stays
//   unopened — made a week or more ago and never opened full-size
//   scratch  — temp and work files
// Click a thumbnail to keep it; shift-click keeps (or un-keeps) everything between two clicks.
import { useEffect, useMemo, useRef, useState } from "react";
import { viewUrl, type FileRef } from "../lib/api";
import { useJobs } from "../lib/jobs";
import { usageReport, type UsageReport } from "../lib/usage";
import { askConfirm } from "./Dialogs";
import { fmtBytes } from "./Storage";
import { cx } from "./ui";

interface Item extends FileRef { kind: "image" | "video"; size: number; mtime: number; keep?: string; family?: string; version?: number }
interface Version { n: number; prompt: string; loras: string; at: number; added: string[]; removed: string[]; loras_changed: boolean; final: boolean; files: Item[] }
interface Family { id: string; folder: string; kind: string; title: string; versions: Version[] }
interface Scan {
  disk: { total: number; free: number }; since: number; keepers: number; results: number;
  early: { count: number; bytes: number; items: Item[] }; unopened: { count: number; bytes: number; items: Item[] };
  scratch: { count: number; bytes: number }; families: Family[];
}
const keyOf = (it: FileRef) => `${it.subfolder}/${it.filename}`;

async function deleteFiles(items: Item[]): Promise<void> {
  const files = items.map((it) => ({ subfolder: it.subfolder, filename: it.filename }));
  for (let i = 0; i < files.length; i += 500) {
    const r = await fetch("/studio-api/output/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: files.slice(i, i + 500) }) });
    if (!r.ok) throw new Error(`The rental answered ${r.status}`);
  }
  useJobs.getState().forgetOutputs(files);
}

/** thumbnails you can keep one by one, or a range with shift-click */
function PickGrid({ items, skip, setSkip }: { items: Item[]; skip: Record<string, true>; setSkip: (f: (s: Record<string, true>) => Record<string, true>) => void }) {
  const last = useRef<number | null>(null);
  const click = (i: number, shift: boolean) => {
    const range = shift && last.current != null ? items.slice(Math.min(last.current, i), Math.max(last.current, i) + 1) : [items[i]];
    const makeKept = !skip[keyOf(items[i])];
    setSkip((s) => { const n = { ...s }; for (const it of range) { if (makeKept) n[keyOf(it)] = true; else delete n[keyOf(it)]; } return n; });
    last.current = i;
  };
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-10">
      {items.map((it, i) => {
        const kept = !!skip[keyOf(it)];
        return (
          <button key={keyOf(it)} onClick={(e) => click(i, e.shiftKey)} aria-pressed={!kept} title={kept ? "Kept — click to let it go after all" : "Click to keep this one (shift-click: everything up to here)"}
            className={cx("relative aspect-[3/4] overflow-hidden rounded-md border bg-black", kept ? "border-good" : "border-line opacity-80 hover:opacity-100")}>
            {it.kind === "video" ? <video src={viewUrl(it)} muted preload="metadata" className="h-full w-full object-cover" /> : <img src={viewUrl(it)} alt="" loading="lazy" className="h-full w-full object-cover" />}
            {kept && <span className="absolute inset-x-0 bottom-0 bg-good/90 py-0.5 text-center text-[11px] font-semibold text-black">Keep</span>}
          </button>
        );
      })}
    </div>
  );
}

function Row({ title, why, size, action, children, open, onToggle, quiet }: {
  title: string; why: string; size: string; action?: React.ReactNode; children?: React.ReactNode; open?: boolean; onToggle?: () => void; quiet?: boolean;
}) {
  return (
    <div className="border-b border-line2 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className={cx("text-[13.5px] font-semibold", quiet ? "text-muted" : "text-ink")}>{title} <span className="ml-1 font-normal tabular-nums text-accent">{size}</span></p>
          <p className="mt-0.5 text-[12.5px] text-muted">{why}</p>
        </div>
        {onToggle && <button onClick={onToggle} className="press h-8 rounded-lg border border-line px-3 text-[12.5px] text-muted hover:text-ink">{open ? "Hide" : "Review"}</button>}
        {action}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function SmartClean({ onDone }: { onDone: () => void }) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [open, setOpen] = useState("");
  const [skip, setSkip] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const toast = useJobs((s) => s.toast);
  const load = async () => {
    try {
      const r = await fetch("/studio-api/cleanup");
      if (!r.ok) throw new Error(`The rental answered ${r.status}`);
      setScan(await r.json()); setErr("");
    } catch (e) { setErr((e as Error).message); }
    usageReport().then((u) => setUsage(u ?? null));
  };
  useEffect(() => { load(); }, []);

  const early = useMemo(() => (scan?.early.items ?? []).filter((it) => !skip[keyOf(it)]), [scan, skip]);
  const unopened = useMemo(() => (scan?.unopened.items ?? []).filter((it) => !skip[keyOf(it)]), [scan, skip]);
  const sum = (a: Item[]) => a.reduce((n, it) => n + it.size, 0);
  // model groups on this disk that no job has loaded, on any rental (needs a couple of rentals of log to judge)
  const idle = usage && usage.on && usage.rentals >= 2 ? usage.groups.filter((g) => g.uses === 0 && g.state === "done" && g.gb >= 0.5) : [];

  const del = async (what: string, items: Item[], label: string) => {
    if (!items.length) return;
    if (!(await askConfirm(`Delete ${items.length} ${label} (${fmtBytes(sum(items))})?`,
      "They go from this rental right away (the space is free at once) and from your drive's backup. Starred and downloaded ones aren't included.", "Delete", true))) return;
    setBusy(what);
    try { await deleteFiles(items); toast(`Deleted ${items.length} · ${fmtBytes(sum(items))} freed`, "good"); await load(); onDone(); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  const removeModels = async (id: string, label: string, gb: number) => {
    if (!(await askConfirm(`Remove “${label}” from this disk (${gb} GB)?`, "Its model files are deleted from this rental and it waits as “Later”. Download now (status menu, or the tab that needs it) brings it back.", "Remove", true))) return;
    setBusy(id);
    try {
      const r = await fetch("/studio-api/downloads/later", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group: id, remove: true }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `The rental answered ${r.status}`);
      toast(`${label}: being removed — the space frees up in a few seconds`, "good");
      setTimeout(() => { load(); onDone(); }, 6000);
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  const scratch = async () => {
    setBusy("scratch");
    try {
      const r = await fetch("/studio-api/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ do: "scratch" }) });
      if (!r.ok) throw new Error(`The rental answered ${r.status}`);
      toast((await r.json()).message, "good"); await load(); onDone();
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };

  const total = sum(early) + sum(unopened) + (scan?.scratch.bytes ?? 0) + idle.reduce((n, g) => n + g.gb * 2 ** 30, 0);
  const danger = "press h-8 rounded-lg bg-bad px-3 text-[12.5px] font-semibold text-white disabled:opacity-50";
  return (
    <section className="card rounded-xl border border-accent/40 p-5 lg:col-span-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-[15px] font-semibold">Suggested clean-up</h3>
        {scan && <span className="text-[12.5px] text-muted">up to <b className="text-accent">{fmtBytes(total)}</b> · {fmtBytes(scan.disk.free)} free now · {scan.keepers} keeper{scan.keepers === 1 ? "" : "s"} left alone</span>}
      </div>
      <p className="mt-0.5 text-[12.5px] text-muted">Nothing is deleted until you press. Never suggested: starred (press F while looking at one, or ★), downloaded, or used by a character or scene.</p>
      {err && <p className="mt-2 text-[13px] text-bad">{err}</p>}
      {!scan && !err && <p className="mt-3 text-[13px] text-muted">Looking through your results…</p>}
      {scan && (
        <div className="mt-2">
          {idle.map((g) => (
            <Row key={g.id} title={g.label} size={`${g.gb} GB`} why={`A model download no job of yours has loaded, on any of your last ${usage!.rentals} rentals. New rentals already leave it for later.`}
              action={<button disabled={!!busy} onClick={() => removeModels(g.id, g.label, g.gb)} className={danger}>{busy === g.id ? "Removing…" : "Remove from this disk"}</button>} />
          ))}
          <Row title="Earlier tries of prompts you kept changing" size={fmtBytes(sum(early))} quiet={!scan.early.count}
            why={scan.early.count ? `${early.length} result${early.length === 1 ? "" : "s"} in ${scan.families.length} prompt famil${scan.families.length === 1 ? "y" : "ies"}: the same project, nearly the same words, one after another. The last version of each is where you ended up — its takes stay.` : "None found — when you rework a prompt a few times, the tries before the last one show up here."}
            open={open === "early"} onToggle={scan.early.count ? () => setOpen(open === "early" ? "" : "early") : undefined}
            action={scan.early.count ? <button disabled={!!busy || !early.length} onClick={() => del("early", early, "earlier tries")} className={danger}>{busy === "early" ? "Deleting…" : `Delete ${early.length}`}</button> : undefined}>
            <div className="flex max-h-[52vh] flex-col gap-4 overflow-y-auto pr-1">
              {scan.families.map((f) => <FamilyView key={f.id} f={f} skip={skip} setSkip={setSkip} />)}
            </div>
          </Row>
          <Row title="Never opened" size={fmtBytes(sum(unopened))} quiet={!scan.unopened.count}
            why={scan.unopened.count ? `${unopened.length} result${unopened.length === 1 ? "" : "s"} made a week or more ago that you never opened full-size.` : `Nothing yet. Opening is noted since ${new Date(scan.since * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}; results made after that and left unopened for a week show up here.`}
            open={open === "unopened"} onToggle={scan.unopened.count ? () => setOpen(open === "unopened" ? "" : "unopened") : undefined}
            action={scan.unopened.count ? <button disabled={!!busy || !unopened.length} onClick={() => del("unopened", unopened, "unopened results")} className={danger}>{busy === "unopened" ? "Deleting…" : `Delete ${unopened.length}`}</button> : undefined}>
            <div className="max-h-[46vh] overflow-y-auto pr-1"><PickGrid items={scan.unopened.items.slice(0, 600)} skip={skip} setSkip={setSkip} /></div>
          </Row>
          <Row title="Temp and work files" size={fmtBytes(scan.scratch.bytes)} quiet={!scan.scratch.count}
            why={scan.scratch.count ? `${scan.scratch.count} leftover file${scan.scratch.count === 1 ? "" : "s"} from previews, masks and imports, more than an hour old. Safe to remove.` : "Nothing to remove."}
            action={scan.scratch.count ? <button disabled={!!busy} onClick={scratch} className={danger}>{busy === "scratch" ? "Removing…" : "Remove"}</button> : undefined} />
        </div>
      )}
    </section>
  );
}

/** one prompt family: its versions in order, what changed at each, and which results would go */
function FamilyView({ f, skip, setSkip }: { f: Family; skip: Record<string, true>; setSkip: (fn: (s: Record<string, true>) => Record<string, true>) => void }) {
  const going = f.versions.filter((v) => !v.final).flatMap((v) => v.files.filter((x) => !x.keep));
  const allKept = going.length > 0 && going.every((it) => skip[keyOf(it)]);
  const toggleAll = () => setSkip((s) => { const n = { ...s }; for (const it of going) { if (allKept) delete n[keyOf(it)]; else n[keyOf(it)] = true; } return n; });
  return (
    <div className="rounded-lg border border-line2 p-3">
      <div className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
        <b className="text-ink">{f.folder}</b>
        <span className="min-w-0 flex-1 truncate text-muted">“{f.title}”</span>
        <span className="text-dim">{f.versions.length} versions</span>
        {going.length > 0 && <button onClick={toggleAll} className="text-accent hover:underline">{allKept ? "Let the earlier tries go" : "Keep this whole family"}</button>}
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {f.versions.map((v) => {
          const drop = v.files.filter((x) => !x.keep);
          return (
            <div key={v.n} className="grid grid-cols-[70px_minmax(0,1fr)] gap-2">
              <div className="text-[11.5px] text-dim">
                <p className={cx("font-mono", v.final && "text-good")}>v{v.n}{v.final ? " · kept" : ""}</p>
                <p>{v.files.length} take{v.files.length === 1 ? "" : "s"}</p>
              </div>
              <div className="min-w-0">
                {v.n > 1 && (v.added.length > 0 || v.removed.length > 0 || v.loras_changed) && (
                  <p className="mb-1 flex flex-wrap gap-1 text-[11.5px]">
                    {v.added.map((w) => <span key={"a" + w} className="rounded bg-good/15 px-1 text-good">+{w}</span>)}
                    {v.removed.map((w) => <span key={"r" + w} className="rounded bg-bad/15 px-1 text-bad">−{w}</span>)}
                    {v.loras_changed && <span className="rounded bg-white/10 px-1 text-muted">LoRAs: {v.loras || "none"}</span>}
                  </p>
                )}
                {v.final || !drop.length
                  ? <div className="flex flex-wrap gap-1.5">{v.files.slice(0, 12).map((it) => (
                      <span key={keyOf(it)} title={it.keep || ""} className="relative h-16 w-12 overflow-hidden rounded border border-good/60 bg-black">
                        {it.kind === "video" ? <video src={viewUrl(it)} muted preload="metadata" className="h-full w-full object-cover" /> : <img src={viewUrl(it)} alt="" loading="lazy" className="h-full w-full object-cover" />}
                      </span>))}{v.files.length > 12 && <span className="self-center text-[11.5px] text-dim">+{v.files.length - 12}</span>}</div>
                  : <PickGrid items={drop} skip={skip} setSkip={setSkip} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
