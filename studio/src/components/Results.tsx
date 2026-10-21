import { useState, type ReactNode } from "react";
import { viewUrl } from "../lib/api";
import { useShallow } from "zustand/react/shallow";
import { useJobs, type Job, type Output, type Tab } from "../lib/jobs";
import { trayIdOf } from "../lib/tray";
import { sendTo } from "../App";
import { Btn, Icon, JobBar, MediaView, cx } from "./ui";

/** live progress + results for one tab */
export function Results({ tab, empty, cols = 2, actions, kinds = ["image", "video"], tall }: {
  tab: Tab; empty: ReactNode; cols?: number; actions?: (o: Output, job: Job) => ReactNode; kinds?: string[]; tall?: number;
}) {
  const jobs = useJobs(useShallow((s) => s.jobs.filter((j) => j.tab === tab && !j.meta?.styleKey)));
  const active = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const finished = jobs.filter((j) => !active.includes(j));
  const outputs = finished.flatMap((j) => j.outputs.filter((o) => kinds.includes(o.kind)).map((o) => ({ o, j })));
  const [sel, setSel] = useState<string | null>(null);
  const lastErr = finished[0]?.status === "error" ? finished[0] : null;
  return (
    <div className="flex min-h-0 flex-col gap-3.5">
      {active.map((j) => (
        <div key={j.id} className="rounded-xl border border-line bg-raised/60 p-3">
          <div className="mb-2 flex items-center justify-between text-[13px]"><span className="font-medium">{j.label}</span></div>
          {j.preview && (
            <div className="mb-2.5 flex justify-center overflow-hidden rounded-lg bg-black" style={{ maxHeight: 360 }}>
              <img src={j.preview} alt="Live preview" className="max-h-[360px] object-contain opacity-90" />
            </div>
          )}
          <JobBar job={j} />
        </div>
      ))}
      {lastErr && !active.length && (
        <div className="rounded-xl border border-bad/50 bg-bad/10 p-3 text-[13px]"><b>{lastErr.label} failed.</b> {lastErr.error}</div>
      )}
      {outputs.length === 0 && !active.length ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-line p-10 text-center text-[13px] text-muted">{empty}</div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {outputs.slice(0, 24).map(({ o, j }) => {
            const id = trayIdOf(o);
            return (
              <div key={id} className="flex flex-col gap-1.5">
                <button onClick={() => setSel(sel === id ? null : id)} className={cx("overflow-hidden rounded-[10px] border bg-black", o.filename.includes("cutout") && "checker", sel === id ? "border-accent" : "border-line")}
                  style={{ height: tall ?? 260 }}>
                  <MediaView m={{ url: viewUrl(o), kind: o.kind }} contain controls={o.kind !== "image"} />
                </button>
                <div className="flex gap-1.5">
                  {actions ? actions(o, j) : <DefaultActions o={o} />}
                  <a className="inline-flex h-8 items-center rounded-lg border border-line bg-raised px-2 text-ink hover:bg-hover" href={viewUrl(o)} download={o.filename} aria-label="Download"><Icon name="down" size={15} /></a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DefaultActions({ o }: { o: Output }) {
  const id = trayIdOf(o);
  return (
    <>
      {o.kind === "image" && <Btn small className="flex-1" onClick={() => sendTo("edit", [id])}>Edit</Btn>}
      {o.kind === "image" && <Btn small className="flex-1" onClick={() => sendTo("prompt", [id])}>Prompt</Btn>}
      {o.kind === "image" && <Btn small className="flex-1" onClick={() => sendTo("animate", [id], "start")}>Animate</Btn>}
      {o.kind === "video" && <Btn small className="flex-1" onClick={() => sendTo("finish", [id])}>Trim, loop &amp; export</Btn>}
    </>
  );
}
