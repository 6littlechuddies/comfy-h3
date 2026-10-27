// Storage: what the rental's disk and your drive hold, which projects take the most room, and a clean-up for old results
// (favourites are never touched), with a preview before anything is deleted.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { viewUrl, type FileRef } from "../lib/api";
import { useFavs, isFav } from "../lib/favs";
import { useJobs } from "../lib/jobs";
import { askConfirm } from "./Dialogs";
import { Icon, cx } from "./ui";

export const useStorage = create<{ open: boolean }>(() => ({ open: false }));
export const openStorage = () => useStorage.setState({ open: true });

interface Drive { name?: string; folder?: string; total?: number; used?: number; trashed?: number; free?: number; studio_bytes?: number; studio_files?: number;
  exports?: { name: string; size: number; when: string }[]; error?: string }
interface Info {
  disk: { total: number; used: number; free: number }; models: number; results: number; results_files: number; inputs: number;
  projects: { name: string; bytes: number; count: number }[]; drive: Drive | null; drive_checked: number;
}
interface CatItem extends FileRef { kind: "image" | "video"; mtime: number; size: number; folder: string }

export const fmtBytes = (b?: number | null) => {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
};

export function StorageHost() {
  return useStorage((s) => s.open) ? <StoragePanel /> : null;
}

function Bar({ parts, total }: { parts: { label: string; bytes: number; cls: string }[]; total: number }) {
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/[.06]" role="img" aria-label={parts.map((p) => `${p.label} ${fmtBytes(p.bytes)}`).join(", ")}>
        {parts.map((p) => <span key={p.label} className={p.cls} style={{ width: `${Math.max(0, Math.min(100, (p.bytes / Math.max(1, total)) * 100))}%` }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
        {parts.map((p) => <span key={p.label} className="flex items-center gap-1.5"><span className={cx("h-2.5 w-2.5 rounded-full", p.cls)} />{p.label} <b className="font-medium text-ink">{fmtBytes(p.bytes)}</b></span>)}
      </div>
    </div>
  );
}

function StoragePanel() {
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const toast = useJobs((s) => s.toast);
  const close = () => useStorage.setState({ open: false });
  const load = async (refresh = false) => {
    try {
      const r = await fetch(`/studio-api/storage${refresh ? "?refresh=1" : ""}`);
      if (!r.ok) throw new Error(`The rental answered ${r.status}`);
      setInfo(await r.json()); setErr("");
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[role=alertdialog]")) close(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  const act = async (what: string, body: object) => {
    setBusy(what);
    try {
      const r = await fetch("/studio-api/storage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.text()) || `The rental answered ${r.status}`);
      toast((await r.json()).message, "good");
      await load(true);
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };

  const d = info?.disk;
  const dr = info?.drive;
  const other = d && info ? Math.max(0, d.used - info.models - info.results - info.inputs) : 0;
  const maxProj = Math.max(1, ...(info?.projects ?? []).map((p) => p.bytes));
  const oldExports = (dr?.exports ?? []).slice(3);

  return createPortal(
    <div className="fade-in fixed inset-0 z-[80] flex flex-col bg-bg/95 backdrop-blur-[2px]" role="dialog" aria-modal aria-label="Storage">
      <div className="flex items-center gap-3 border-b border-line2 px-6 py-3">
        <h2 className="display text-[18px]">Storage</h2>
        <span className="text-[12.5px] text-muted">What's using space, and a clean-up for old results</span>
        <button onClick={() => load(true)} className="press ml-auto flex h-8 items-center gap-1.5 border border-line px-3 text-[12.5px] text-muted hover:text-ink"><Icon name="refresh" size={13} />Check again</button>
        <button onClick={close} aria-label="Close" className="press flex h-8 w-8 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-5 px-6 py-6 lg:grid-cols-2">
          {err && <p className="text-[13px] text-bad lg:col-span-2">{err}</p>}
          {!info && !err && <p className="text-[13px] text-muted">Measuring…</p>}

          {info && d && (
            <section className="card rounded-xl border border-line p-5">
              <h3 className="text-[15px] font-semibold">This rental's disk</h3>
              <p className="mb-4 mt-0.5 text-[12.5px] text-muted">{fmtBytes(d.used)} of {fmtBytes(d.total)} used · {fmtBytes(d.free)} free. Wiped when the rental is destroyed — your results are on your drive.</p>
              <Bar total={d.total} parts={[
                { label: "AI models", bytes: info.models, cls: "bg-[#6b8afd]" },
                { label: `Results (${info.results_files})`, bytes: info.results, cls: "bg-accent" },
                { label: "Uploads", bytes: info.inputs, cls: "bg-[#f0a845]" },
                { label: "System", bytes: other, cls: "bg-white/25" },
              ]} />
            </section>
          )}

          {info && (
            <section className="card rounded-xl border border-line p-5">
              <h3 className="text-[15px] font-semibold">{dr?.name ?? "Your drive"}</h3>
              {!dr ? <p className="mt-1 text-[12.5px] text-muted">No drive is set up in the template, so nothing is backed up.</p>
                : dr.error ? <p className="mt-1 text-[12.5px] text-bad">Couldn't check it: {dr.error}</p>
                : dr.total == null && dr.used == null ? <p className="mt-1 text-[12.5px] text-muted">Checking… (press Check again in a moment)</p>
                : (<>
                  <p className="mb-4 mt-0.5 text-[12.5px] text-muted">{fmtBytes(dr.used)} of {fmtBytes(dr.total)} used · “{dr.folder}” holds {fmtBytes(dr.studio_bytes)}{dr.studio_files != null ? ` in ${dr.studio_files} files` : ""}</p>
                  <Bar total={dr.total ?? (dr.used ?? 0) + (dr.free ?? 0)} parts={[
                    { label: dr.folder ?? "H3 Studio", bytes: dr.studio_bytes ?? 0, cls: "bg-accent" },
                    { label: "Everything else", bytes: Math.max(0, (dr.used ?? 0) - (dr.studio_bytes ?? 0) - (dr.trashed ?? 0)), cls: "bg-white/25" },
                    { label: "Trash", bytes: dr.trashed ?? 0, cls: "bg-bad/80" },
                  ]} />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button disabled={!!busy || !dr.trashed} onClick={async () => { if (await askConfirm("Empty your drive's trash?", "Everything in the trash is deleted for good — including things that weren't from the Studio.", "Empty trash", true)) act("trash", { do: "empty-trash" }); }}
                      className="press btn-raised h-8 rounded-lg px-3 text-[12.5px] text-ink disabled:opacity-40">{busy === "trash" ? "Emptying…" : `Empty trash${dr.trashed ? ` · ${fmtBytes(dr.trashed)}` : ""}`}</button>
                    <button disabled={!!busy || !oldExports.length} onClick={async () => { if (await askConfirm(`Delete ${oldExports.length} older export${oldExports.length > 1 ? "s" : ""}?`, "The newest 3 Export all .zip files are kept. Older ones are deleted for good.", "Delete", true)) act("exports", { do: "prune-exports", keep: 3 }); }}
                      title={oldExports.length ? "" : "Only the newest 3 exports are there"}
                      className="press btn-raised h-8 rounded-lg px-3 text-[12.5px] text-ink disabled:opacity-40">{busy === "exports" ? "Deleting…" : `Delete older exports${oldExports.length ? ` · ${fmtBytes(oldExports.reduce((a, f) => a + f.size, 0))}` : ""}`}</button>
                  </div>
                  {!!dr.exports?.length && (
                    <ul className="mt-3 space-y-0.5 text-[12px] text-muted">
                      {dr.exports.slice(0, 6).map((f, i) => <li key={f.name} className="flex gap-2"><span className={cx("min-w-0 flex-1 truncate", i >= 3 && "text-dim line-through")}>{f.name}</span><span>{fmtBytes(f.size)}</span></li>)}
                      {dr.exports.length > 6 && <li className="text-dim">and {dr.exports.length - 6} more</li>}
                    </ul>
                  )}
                </>)}
            </section>
          )}

          {info && !!info.projects.length && (
            <section className="card rounded-xl border border-line p-5 lg:col-span-2">
              <h3 className="text-[15px] font-semibold">Results by project</h3>
              <div className="mt-3 grid gap-1.5">
                {info.projects.map((p) => (
                  <div key={p.name} className="grid grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-3 text-[12.5px]">
                    <span className="truncate text-ink">{p.name}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-white/[.06]"><span className="block h-full bg-accent/80" style={{ width: `${(p.bytes / maxProj) * 100}%` }} /></span>
                    <span className="tabular-nums text-muted">{fmtBytes(p.bytes)} · {p.count}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {info && <Cleanup folders={info.projects.map((p) => p.name)} onDone={() => load()} />}
        </div>
      </div>
    </div>, document.body);
}

const AGES = [{ d: 7, l: "a week" }, { d: 30, l: "a month" }, { d: 90, l: "3 months" }, { d: 0, l: "any age" }];

function Cleanup({ folders, onDone }: { folders: string[]; onDone: () => void }) {
  const favs = useFavs((s) => s.set);
  const [folder, setFolder] = useState(folders.includes("Free work") ? "Free work" : "");
  const [days, setDays] = useState(30);
  const [kind, setKind] = useState<"" | "image" | "video">("");
  const [found, setFound] = useState<CatItem[] | null>(null);
  const [skip, setSkip] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState(false);
  const key = (it: FileRef) => `${it.subfolder}/${it.filename}`;
  useEffect(() => { setFound(null); setSkip({}); }, [folder, days, kind]);

  const find = async () => {
    setBusy(true);
    try {
      const all: CatItem[] = [];
      for (let off = 0; off < 20000; off += 500) {
        const qs = new URLSearchParams({ offset: String(off), limit: "500", ...(folder && folder !== "Older results" ? { folder } : {}), ...(kind ? { kind } : {}) });
        const r = await fetch(`/studio-api/catalog?${qs}`);
        if (!r.ok) throw new Error(`The rental answered ${r.status}`);
        const d = await r.json();
        all.push(...d.items);
        if (all.length >= d.total || !d.items.length) break;
      }
      const before = Date.now() / 1000 - days * 86400;
      // favourites are never cleaned up; "Older results" are files from before projects had folders
      setFound(all.filter((it) => (days === 0 || it.mtime < before) && !isFav(favs, it) && (folder !== "Older results" || it.folder === "")));
      setSkip({});
    } catch (e) { useJobs.getState().toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  const doomed = useMemo(() => (found ?? []).filter((it) => !skip[key(it)]), [found, skip]);
  const bytes = doomed.reduce((a, it) => a + (it.size || 0), 0);
  const del = async () => {
    if (!doomed.length) return;
    if (!(await askConfirm(`Delete ${doomed.length} result${doomed.length > 1 ? "s" : ""} (${fmtBytes(bytes)})?`, "They're deleted from this rental and from your drive's backup, for good. Favourites aren't included.", "Delete", true))) return;
    setBusy(true);
    try {
      const files = doomed.map((it) => ({ subfolder: it.subfolder, filename: it.filename }));
      for (let i = 0; i < files.length; i += 500) {
        const r = await fetch("/studio-api/output/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: files.slice(i, i + 500) }) });
        if (!r.ok) throw new Error(`The rental answered ${r.status}`);
      }
      useJobs.getState().forgetOutputs(files);
      useJobs.getState().toast(`Deleted ${doomed.length} result${doomed.length > 1 ? "s" : ""} · ${fmtBytes(bytes)} freed`, "good");
      setFound(null); onDone();
    } catch (e) { useJobs.getState().toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };

  const sel = "inset h-9 border border-line bg-transparent px-2 text-[13px] text-ink focus:border-accent focus:outline-none";
  return (
    <section className="card rounded-xl border border-line p-5 lg:col-span-2">
      <h3 className="text-[15px] font-semibold">Clean up old results</h3>
      <p className="mt-0.5 text-[12.5px] text-muted">Favourites (★) are always kept. You'll see everything before it's deleted, and can click any picture to keep it.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted">From</span>
        <select aria-label="Project" value={folder} onChange={(e) => setFolder(e.target.value)} className={sel}>
          <option value="">every project</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <span className="text-muted">older than</span>
        <select aria-label="Older than" value={days} onChange={(e) => setDays(Number(e.target.value))} className={sel}>
          {AGES.map((a) => <option key={a.d} value={a.d}>{a.l}</option>)}
        </select>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={sel}>
          <option value="">pictures and videos</option><option value="image">pictures only</option><option value="video">videos only</option>
        </select>
        <button onClick={find} disabled={busy} className="press btn-raised h-9 rounded-lg px-4 text-[13px] text-ink disabled:opacity-50">{busy && !found ? "Looking…" : "Show what would go"}</button>
      </div>
      {found && (
        <div className="mt-4">
          {!found.length ? <p className="text-[13px] text-muted">Nothing matches — no non-favourite results that old here.</p> : (<>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="text-[13px] text-ink"><b>{doomed.length}</b> of {found.length} to delete · <b>{fmtBytes(bytes)}</b></span>
              {Object.keys(skip).length > 0 && <button onClick={() => setSkip({})} className="text-[12px] text-muted underline">Include the ones I kept</button>}
              <button onClick={del} disabled={busy || !doomed.length} className="press ml-auto h-9 rounded-lg bg-bad px-4 text-[13px] font-semibold text-white disabled:opacity-50">{busy ? "Deleting…" : `Delete ${doomed.length}`}</button>
            </div>
            <div className="grid max-h-[46vh] grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6 lg:grid-cols-8">
              {found.slice(0, 400).map((it) => {
                const kept = !!skip[key(it)];
                return (
                  <button key={key(it)} onClick={() => setSkip((s) => { const n = { ...s }; if (n[key(it)]) delete n[key(it)]; else n[key(it)] = true; return n; })}
                    title={kept ? "Kept — click to delete it after all" : "Click to keep this one"} aria-pressed={!kept}
                    className={cx("relative aspect-[3/4] overflow-hidden rounded-md border bg-black", kept ? "border-good opacity-100" : "border-line opacity-80 hover:opacity-100")}>
                    {it.kind === "video" ? <video src={viewUrl(it)} muted preload="metadata" className="h-full w-full object-cover" /> : <img src={viewUrl(it)} alt="" loading="lazy" className="h-full w-full object-cover" />}
                    {kept && <span className="absolute inset-x-0 bottom-0 bg-good/90 py-0.5 text-center text-[11px] font-semibold text-black">Keep</span>}
                  </button>
                );
              })}
            </div>
            {found.length > 400 && <p className="mt-2 text-[12px] text-dim">Showing the first 400 of {found.length}; all {doomed.length} are deleted.</p>}
          </>)}
        </div>
      )}
    </section>
  );
}
