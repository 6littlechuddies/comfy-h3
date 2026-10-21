// The line: the GPU makes one thing at a time. This shows what it's making now (with a live preview), what's waiting
// behind it in order, roughly how long each wait is, and lets you move one to the front or cancel it.
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { timeLeft, useJobs, type Job, type Tab } from "../lib/jobs";
import { useSettings } from "../lib/settings";
import { Icon, cx } from "./ui";

const TAB_NAME: Record<Tab, string> = { characters: "Characters", scenes: "Scenes", create: "Create", edit: "Edit", compose: "Compose", prompt: "Prompt", animate: "Animate", finish: "Finish", batch: "Batch" } as Record<Tab, string>;
const mins = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);

/** the line, inside the left rail (it never covers the page): what's making now, and what waits behind it */
export function QueuePanel({ narrow }: { narrow?: boolean }) {
  const jobs = useJobs(useShallow((s) => s.jobs.filter((j) => j.status === "running" || j.status === "queued")));
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("h3.queue.open") !== "0"; } catch { return true; } });
  const [, tick] = useState(0);
  useEffect(() => { if (!jobs.length) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [jobs.length]);
  if (!jobs.length) return null;
  const running = jobs.find((j) => j.status === "running");
  const waiting = jobs.filter((j) => j.status === "queued").sort((a, b) => a.queuedAt - b.queuedAt);
  const left = (j: Job) => timeLeft(j) ?? Math.max(0, (j.etaMs ?? 30_000) - (j.startedAt ? Date.now() - j.startedAt : 0));
  let acc = running ? left(running) : 0;
  const starts = waiting.map((j) => { const t = acc; acc += j.etaMs ?? 30_000; return t; });
  const toggle = () => setOpen((o) => { try { localStorage.setItem("h3.queue.open", o ? "0" : "1"); } catch { /* */ } return !o; });
  if (narrow) return (
    <div title={`${running ? "Making 1" : "Starting"}${waiting.length ? ` · ${waiting.length} waiting` : ""}`} className="flex flex-col items-center gap-1 py-1">
      <span className="h-2 w-2 rounded-full bg-accent pulse" /><span className="micro text-muted">{jobs.length}</span>
    </div>
  );
  return (
    <div className="border-t border-line2">
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent pulse" />
        <span className="flex-1 text-[12.5px] text-ink">{running ? "Making 1" : "Waiting for the GPU"}{waiting.length ? ` · ${waiting.length} waiting` : ""}</span>
        <span className="micro text-dim">{waiting.length ? `~${mins(acc)}` : running ? `~${mins(left(running))}` : ""}</span>
        <Icon name="chev" size={12} className={cx("text-dim transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <div className="max-h-[38vh] overflow-y-auto pb-1">
          {running && <Row j={running} n={0} note={`${running.nodeTitle ?? "working"}${running.max > 1 ? ` · step ${running.value}/${running.max}` : ""}`} sub={`~${mins(left(running))} left`} />}
          {waiting.map((j, i) => <Row key={j.id} j={j} n={i + 1} note={i === 0 ? "next" : `#${i + 1}`} sub={`in ~${mins(starts[i])}`} />)}
          <p className="px-3 pb-1 pt-0.5 text-[10.5px] leading-snug text-dim">One GPU makes one thing at a time. ↑ makes one go next.</p>
        </div>
      )}
    </div>
  );
}

function Row({ j, n, note, sub }: { j: Job; n: number; note: string; sub: string }) {
  const { cancel, runNext, toast } = useJobs.getState();
  const before = typeof j.meta?.before === "string" ? (j.meta.before as string) : undefined;
  const pic = n === 0 ? j.preview ?? before : before;
  const pct = n === 0 && j.max ? (j.value / j.max) * 100 : null;
  return (
    <div className={cx("flex items-center gap-2 px-2.5 py-1.5", n === 0 && "bg-accent/5")}>
      <div className="h-9 w-7 shrink-0 overflow-hidden border border-line bg-raised2">{pic ? <img src={pic} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center"><Icon name={j.tab === "animate" || j.tab === "scenes" ? "film" : "image"} size={13} className="text-dim" /></span>}</div>
      <div className="min-w-0 flex-1">
        <button onClick={() => useSettings.getState().setTab(j.tab)} className="block w-full truncate text-left text-[12px] text-ink hover:underline" title={`${j.label} — ${TAB_NAME[j.tab] ?? j.tab}`}>{j.label}</button>
        <div className="truncate text-[10.5px] text-dim">{TAB_NAME[j.tab] ?? j.tab} · {note} · {sub}</div>
        {pct != null && <div className="mt-1 h-1 bg-raised2"><div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} /></div>}
      </div>
      {n > 1 && <button onClick={() => runNext(j.id).then(() => toast(`“${j.label}” goes next`, "good")).catch((e) => toast((e as Error).message, "bad"))} title="Make this one go next"
        className="press flex h-6 w-6 shrink-0 items-center justify-center border border-line text-muted hover:border-accent hover:text-ink"><Icon name="up" size={11} /></button>}
      <button onClick={() => cancel(j.id)} title={n === 0 ? "Stop this one" : "Take it out of the line"} className="press flex h-6 w-6 shrink-0 items-center justify-center text-dim hover:text-bad"><Icon name="x" size={12} /></button>
    </div>
  );
}
