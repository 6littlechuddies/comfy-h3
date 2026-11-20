// Storage: what the rental's disk and your drive hold, a suggested clean-up (SmartClean.tsx: unused models, earlier tries
// of reworked prompts, never-opened results, temp files), which projects take the most room, and a by-age clean-up for
// old results (favourites are never touched), with a preview before anything is deleted.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { viewUrl, type FileRef } from "../lib/api";
import { useFavs, isFav } from "../lib/favs";
import { useJobs } from "../lib/jobs";
import { askConfirm } from "./Dialogs";
import { usageReport, type UsageReport } from "../lib/usage";
import { Icon, cx } from "./ui";
import { SmartClean } from "./SmartClean";

export const useStorage = create<{ open: boolean }>(() => ({ open: false }));
/** moved to another Google account: copy from the old account's "H3 Studio" folder (shared with this one) */
function MigrateButtons() {
  const [st, setSt] = useState<{ state: string; note: string } | null>(null);
  const poll = () => fetch("/studio-api/migrate").then((r) => r.json()).then((d) => { setSt(d); if (d.state === "copying") setTimeout(poll, 4000); }).catch(() => {});
  useEffect(() => { poll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async (results: boolean) => {
    const { askConfirm } = await import("./Dialogs");
    if (!await askConfirm(results ? "Copy everything from your old drive, results too?" : "Copy from your old drive?",
      "First share the old Google account's “H3 Studio” folder with this one (Google Drive → right-click the folder → Share → this account's email, Editor or Viewer). Then this copies the newest export (characters, names, profiles, settings), your LoRAs, the usage log and any Hugging Face key file" + (results ? ", and every result — the big part, it can take a while." : ". Results stay on the old drive."), "Copy", false)) return;
    await fetch("/studio-api/migrate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ results }) });
    setSt({ state: "copying", note: "Copying from your old drive…" }); setTimeout(poll, 3000);
  };
  return <>
    <button onClick={() => go(false)} disabled={st?.state === "copying"} title="From another Google account's “H3 Studio” folder shared with this one" className="press btn-raised h-8 rounded-lg px-3 text-[12.5px] text-ink disabled:opacity-40">Copy from my old drive</button>
    <button onClick={() => go(true)} disabled={st?.state === "copying"} className="press btn-raised h-8 rounded-lg px-3 text-[12.5px] text-muted disabled:opacity-40">…with results</button>
    {st?.note && st.state !== "" && <span className={cx("w-full text-[12px]", st.state === "error" ? "text-bad" : "text-muted")}>{st.note}</span>}
  </>;
}

/** a running rental's drive keys can't change from Vast — paste the new ones here (tested before they're kept) */
function DriveKeys({ open: start, onDone }: { open?: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(!!start);
  const [tok, setTok] = useState(""); const [cid, setCid] = useState(""); const [sec, setSec] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/studio-api/drive/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tok, client_id: cid, client_secret: sec }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ bad: true, text: d.error ?? `The rental answered ${r.status}` });
      else { setMsg({ bad: false, text: "Connected — saving to your drive now. Put the same three in your Vast template so new rentals use them too." }); setTok(""); setSec(""); onDone(); }
    } finally { setBusy(false); }
  };
  const inp = "h-8 w-full rounded-lg border border-line bg-black/30 px-2.5 text-[12.5px] text-ink outline-none focus:border-accent";
  if (!open) return <button onClick={() => setOpen(true)} className="press btn-raised h-8 rounded-lg px-3 text-[12.5px] text-ink">New drive keys…</button>;
  return (
    <div className="mt-3 w-full space-y-2 rounded-lg border border-line p-3">
      <p className="text-[12px] text-muted">For this rental, without starting a new one. The token is what <b>Connect Google Drive.bat</b> printed; the client ID and secret must be the exact ones you gave it (Google Cloud → Clients). Leave a box empty to keep this rental's current value. Tested before it's kept.</p>
      <textarea value={tok} onChange={(e) => setTok(e.target.value)} placeholder='Token: {"access_token":…} (or the base64 line)' className={cx(inp, "h-16 py-1.5 font-mono")} />
      <input value={cid} onChange={(e) => setCid(e.target.value)} placeholder="Client ID (…apps.googleusercontent.com)" className={inp} />
      <input value={sec} onChange={(e) => setSec(e.target.value)} type="password" placeholder="Client secret (GOCSPX-…)" className={inp} />
      <div className="flex items-center gap-2">
        <button disabled={busy || !tok.trim()} onClick={go} className="press btn-primary h-8 rounded-lg px-3 text-[12.5px] font-semibold text-accentink disabled:opacity-40">{busy ? "Testing…" : "Test & use"}</button>
        <button onClick={() => setOpen(false)} className="press h-8 px-2 text-[12.5px] text-muted">Cancel</button>
      </div>
      {msg && <p className={cx("text-[12.5px]", msg.bad ? "text-bad" : "text-good")}>{msg.text}</p>}
    </div>
  );
}

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
                : dr.error ? <><p className="mt-1 text-[12.5px] text-bad">Couldn't check it: {dr.error}</p><DriveKeys open={/token|client|sign-in|oauth/i.test(dr.error)} onDone={() => load()} /></>
                : dr.total == null && dr.used == null ? <><p className="mt-1 text-[12.5px] text-muted">Checking… (press Check again in a moment)</p><div className="mt-3"><DriveKeys onDone={() => load()} /></div></>
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
                    <MigrateButtons />
                    <DriveKeys onDone={() => load()} />
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

          {info && <SmartClean onDone={() => load()} />}

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

          <WhatYouUse />

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

const ago = (t: number | null) => {
  if (!t) return "never";
  const d = Math.floor((Date.now() / 1000 - t) / 86400);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

/** which downloads you actually use, across every rental (the usage log) — the ones you never use are the ones to drop */
/** LoRAs and checkpoints in your library that no picture used (every result's record is checked): re-downloaded on
 *  every rental for nothing */
function LibraryFat() {
  const [items, setItems] = useState<{ kind: string; name: string; title: string; gb: number; role?: string }[] | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const load = async () => { const d = await (await fetch("/studio-api/library/unused")).json(); setItems(d.items ?? []); setPick(Object.fromEntries((d.items ?? []).map((x: { name: string; role?: string }) => [x.name, x.role !== "character"]))); }; // character LoRAs may be waiting in a batch: unticked
  const drop = async () => {
    const names = (items ?? []).filter((x) => pick[x.name]);
    for (const x of names) await fetch(x.kind === "models" ? "/studio-api/models/forget" : "/studio-api/loras/forget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: x.name, delete: true }) });
    useJobs.getState().toast(`Removed ${names.length} from your library — they won't download on the next rentals`, "good"); setItems(null);
  };
  if (items === null) return <button onClick={() => void load()} className="mt-2 text-[12.5px] text-muted underline-offset-2 hover:text-ink hover:underline">LoRAs and checkpoints no picture has used…</button>;
  if (!items.length) return <p className="mt-2 text-[12.5px] text-dim">Every LoRA and checkpoint in your library has been used.</p>;
  const sel = items.filter((x) => pick[x.name]);
  return (
    <div className="mt-2 flex flex-col gap-1.5 border border-line p-2.5 text-[12.5px]">
      <p className="text-muted">{items.length} in your library that no picture you have used — they download again on every rental. Untick the ones to keep.</p>
      <ul className="max-h-56 overflow-auto">{items.map((x) => <li key={x.name}><label className="flex cursor-pointer items-center gap-2 py-0.5"><input type="checkbox" checked={!!pick[x.name]} onChange={(e) => setPick({ ...pick, [x.name]: e.target.checked })} /><span className="min-w-0 flex-1 truncate">{x.title}</span><span className="text-dim">{x.kind === "models" ? "checkpoint" : "LoRA"} · {x.gb.toFixed(2)} GB</span></label></li>)}</ul>
      <span className="flex gap-2"><button disabled={!sel.length} onClick={() => void drop()} className="press border border-bad/50 px-2 py-0.5 text-bad hover:bg-bad/10 disabled:opacity-40">Remove {sel.length} ({sel.reduce((n, x) => n + x.gb, 0).toFixed(1)} GB)</button><button onClick={() => setItems(null)} className="text-dim hover:text-ink">Close</button></span>
    </div>
  );
}

function WhatYouUse() {
  const [r, setR] = useState<UsageReport | null | undefined>(undefined);
  const [busy, setBusy] = useState("");
  const load = () => usageReport().then(setR);
  useEffect(() => { load(); }, []);
  const later = async (id: string, remove = false) => {
    setBusy(id);
    try {
      const res = await fetch("/studio-api/downloads/later", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group: id, later: true, ...(remove ? { remove: true } : {}) }) });
      if (!res.ok) throw new Error(`The rental answered ${res.status}`);
      useJobs.getState().toast(remove ? "Taken off this disk — and left out of the next rentals until you press Download now" : "Left out of this rental's downloads", "good");
      await load();
    } catch (e) { useJobs.getState().toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  if (r === undefined) return null;
  if (!r) return null;
  const groups = [...r.groups].sort((a, b) => a.uses - b.uses || b.gb - a.gb);
  return (
    <section className="card rounded-xl border border-line p-5 lg:col-span-2">
      <h3 className="text-[15px] font-semibold">What you use</h3>
      <p className="mt-0.5 text-[12.5px] text-muted">
        {r.on ? `How often each download was used, over ${r.rentals} rental${r.rentals === 1 ? "" : "s"}. Least used first — those are the ones worth leaving out.` : "The usage log is switched off (H3_USAGE=0 in the template)."}
      </p>
      {(() => { const fat = groups.filter((g) => !g.uses && g.state === "done" && g.gb > 0.05); const gb = fat.reduce((n, g) => n + g.gb, 0);
        return fat.length > 0 && r.rentals >= 2 ? <p className="mt-2 border border-hot/30 bg-hot/5 px-3 py-1.5 text-[12.5px] text-hot">{fat.length} download{fat.length > 1 ? "s" : ""} on this disk ({gb.toFixed(1)} GB) never used in {r.rentals} rentals — Remove takes them off and keeps them off.</p> : null; })()}
      <LibraryFat />
      <div className="mt-3 grid gap-1">
        {groups.map((g) => (
          <div key={g.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-b border-line2 py-1.5 text-[12.5px] last:border-0">
            <span className="truncate text-ink">{g.label}</span>
            <span className="tabular-nums text-muted">{g.gb} GB</span>
            <span className={cx("w-36 text-right tabular-nums", g.uses ? "text-muted" : "text-hot")}>{g.uses ? `${g.uses} use${g.uses === 1 ? "" : "s"} · ${ago(g.last)}` : "never used"}</span>
            {g.state !== "done" && g.state !== "later" && g.state !== "skipped"
              ? <button disabled={!!busy} onClick={() => later(g.id)} className="press h-7 rounded-md border border-line px-2 text-[12px] text-muted hover:text-ink disabled:opacity-40">{busy === g.id ? "…" : "Later"}</button>
              : g.state === "done" && !g.uses && g.gb > 0.05
                ? <button disabled={!!busy} onClick={() => later(g.id, true)} title="Never used: take its files off this disk and leave it out of the next rentals (Download now brings it back)" className="press h-7 rounded-md border border-hot/50 px-2 text-[12px] text-hot hover:bg-hot/10 disabled:opacity-40">{busy === g.id ? "…" : "Remove"}</button>
                : <span className="w-[52px] text-right text-[11.5px] text-dim">{g.state === "done" ? "on disk" : "waiting"}</span>}
          </div>
        ))}
      </div>
      {!!r.features.length && (
        <details className="mt-3 text-[12.5px]">
          <summary className="cursor-pointer text-muted hover:text-ink">Features you use ({r.features.length})</summary>
          <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto pr-2">
            {r.features.slice(0, 200).map((f) => <li key={f.name} className="flex gap-3"><span className="min-w-0 flex-1 truncate">{f.name}</span><span className="tabular-nums text-dim">{f.uses} · {ago(f.last)}</span></li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
