// The import in progress — a .zip you dropped (sent in pieces, then unpacked on the rental) or your newest export coming
// back from Proton Drive on a fresh rental — with a real progress bar. Bottom left, out of the way of toasts.
import { useEffect } from "react";
import { afterImport, importNote } from "../lib/characters";
import { useImport, watchRestore, type ImportRun } from "../lib/importer";
import { Icon, cx } from "./ui";

const mb = (b: number) => (b >= 1 << 30 ? `${(b / 2 ** 30).toFixed(2)} GB` : `${Math.round(b / 2 ** 20)} MB`);
const left = (s?: number) => (s == null || !isFinite(s) ? "" : s < 60 ? "under a minute left" : `about ${Math.ceil(s / 60)} min left`);

/** 0–100 over the whole import: sending/fetching counts for 70%, unpacking the pictures for 30% */
export function importPct(r: ImportRun): number | null {
  if (r.state === "done") return 100;
  if (r.state === "finding") return null;
  const up = r.size ? r.got / r.size : 0;
  if (r.state === "uploading" || r.state === "fetching") return Math.round(up * 70);
  if (r.state === "unpacking") return 70 + Math.round((r.total ? r.done / r.total : 0) * 30);
  return null;
}

function line(r: ImportRun): string {
  const from = r.source === "proton" ? "Getting it from Proton Drive" : "Sending";
  switch (r.state) {
    case "finding": return "Looking for your newest export in Proton Drive…";
    case "uploading": case "fetching":
      return [`${from} · ${mb(r.got)} of ${mb(r.size)}`, r.mbps && `${r.mbps} MB/s`, left(r.leftS)].filter(Boolean).join(" · ");
    case "unpacking": return r.total ? `Unpacking pictures · ${r.done} of ${r.total}` : "Unpacking…";
    case "done":
      return (r.result ? importNote(r.result) : "Done") + (r.results === "copying" ? " · your results are still coming from Proton Drive" : r.results === "failed" ? " · some results didn't come back from Proton Drive" : "");
    case "error": return r.error || "Couldn't import that file";
    default: return "";
  }
}

export function ImportCard() {
  const r = useImport((s) => s.run);
  const hidden = useImport((s) => s.hidden);
  const hide = useImport((s) => s.hide);
  // a fresh rental may be restoring your work from Proton Drive by itself: show that here too
  useEffect(() => { watchRestore(afterImport); }, []);
  // closing the tab mid-upload loses it: ask first
  useEffect(() => {
    if (r?.state !== "uploading") return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [r?.state]);
  // a finished one fades out by itself after a while (an error stays until closed)
  useEffect(() => {
    if (r?.state !== "done" || r.results === "copying") return;
    const t = setTimeout(hide, 12000);
    return () => clearTimeout(t);
  }, [r?.state, r?.results, hide]);
  if (!r || hidden || r.state === "none") return null;
  const pct = importPct(r);
  const busy = !["done", "error"].includes(r.state) || r.results === "copying";
  const title = r.state === "error" ? "Import stopped" : r.state === "done" ? (r.source === "proton" ? "Your work is back" : "Imported") : r.source === "proton" ? "Bringing back your work" : "Importing";
  return (
    <div className="fixed bottom-16 left-5 z-[85] w-[min(380px,calc(100vw-40px))] border border-line bg-panel p-3.5 shadow-2xl fade-in" role="status" aria-live="polite">
      <div className="flex items-start gap-2.5">
        <span className={cx("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center", r.state === "error" ? "bg-hot/15 text-hot" : r.state === "done" ? "bg-good/15 text-good" : "bg-accent/15 text-accent")}>
          <Icon name={r.state === "error" ? "x" : r.state === "done" ? "check" : r.source === "proton" ? "down" : "up"} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <b className="text-[13.5px] text-ink">{title}</b>
            {pct != null && r.state !== "done" && r.state !== "error" && <span className="ml-auto font-mono text-[12px] text-muted">{pct}%</span>}
          </div>
          <div className="truncate text-[11.5px] text-dim" title={r.name}>{r.name}</div>
        </div>
        {(!busy || r.state === "done") && <button onClick={hide} className="press -mr-1 -mt-1 p-1 text-dim hover:text-ink" aria-label="Close"><Icon name="x" size={13} /></button>}
      </div>
      {r.state !== "error" && (
        <div className="mt-3 h-2 overflow-hidden border border-line2 bg-bg" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
          <div className={cx("h-full transition-[width] duration-500", r.state === "done" ? "bg-good" : "bg-accent", pct == null && "w-1/3 animate-pulse")} style={pct != null ? { width: `${Math.max(2, pct)}%` } : undefined} />
        </div>
      )}
      <p className={cx("mt-2 text-[12px] leading-snug", r.state === "error" ? "text-hot" : "text-muted")}>{line(r)}</p>
      {r.state === "error" && r.source === "proton" && (
        <button className="press mt-2 border border-accent px-2.5 py-1 text-[12px] text-accent" onClick={async () => {
          const set = useImport.getState().set;
          try {
            const res = await fetch("/studio-api/import/restore", { method: "POST" });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't start it");
            set({ state: "finding", error: undefined, got: 0, done: 0, total: 0 });
            setTimeout(() => watchRestore(afterImport), 800);
          } catch (e) { set({ error: (e as Error).message }); }
        }}>Try again</button>
      )}
      {r.state === "uploading" && <p className="mt-1 text-[11px] text-dim">Keep this tab open until it says Unpacking — then it carries on by itself.</p>}
    </div>
  );
}
