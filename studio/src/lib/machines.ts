// Every state machine that lives in the browser, read out in one shape — the same one the rental uses for its own
// (scripts/studio_server.py, "state machines, in one place"): {machine, id, state, label, since, error}.
// The Studio sends this to the rental every minute and when the tab is hidden, so GET /studio-api/machines and the
// debug report show what the page was doing too. In ?debug: window.studio.machines() prints it.
// What each machine's states mean, and how each recovers after a reload: docs/STATE_MACHINES.md.
import { useJobs } from "./jobs";
import { useBoard } from "./board";
import { useCharacters } from "./characters";
import { useEditChat } from "./editchat";
import { useBatch } from "./batch";
import { useImport } from "./importer";

export interface MachineRow { machine: string; id: string; state: string; label: string; since: number | null; error: string | null }

/** finished things only travel while they're recent (an error from this afternoon, not one from last week) */
const RECENT_MS = 30 * 60_000;
const secs = (ms?: number) => (ms ? Math.round(ms / 1000) : null);

export function machineRows(now = Date.now()): MachineRow[] {
  const rows: MachineRow[] = [];
  const recent = (t?: number) => !!t && now - t < RECENT_MS;

  // ComfyUI jobs: queued → running → done | error | cancelled
  for (const j of useJobs.getState().jobs) {
    const open = j.status === "queued" || j.status === "running";
    if (!open && !(j.status === "error" && recent(j.endedAt))) continue;
    rows.push({ machine: "job", id: j.id, state: j.status, label: `${j.tab}: ${j.label}`.slice(0, 120), since: secs(j.startedAt ?? j.queuedAt), error: j.error ?? null });
  }
  // Video board runs: planning → queued | error
  for (const b of useBoard.getState().boxes) for (const r of b.runs) {
    const short = r.status === "queued" && r.jobIds.length < r.takes;
    if (r.status !== "planning" && !short && !(r.status === "error" && recent(r.at))) continue;
    rows.push({ machine: "board_run", id: r.id, state: short ? "lining up" : r.status, label: `${r.cfg?.name ?? "box"} · ${r.mode ?? "?"} · ${r.jobIds.length}/${r.takes} takes${r.planJob ? ` · plan ${r.planJob}` : ""}`, since: secs(r.at), error: r.error ?? null });
  }
  // training-set pictures: making → checking → done | failed
  for (const c of useCharacters.getState().list) for (const it of c.trainset?.items ?? []) {
    if (it.status === "done") continue;
    rows.push({ machine: "train_picture", id: `${c.id}:${it.id}`, state: it.status, label: `${c.name} · ${it.shot}`, since: null, error: it.status === "failed" ? it.why ?? null : null });
  }
  // Edit chat turns: running → done | failed
  for (const ch of useEditChat.getState().chats) for (const t of ch.turns) {
    if (t.status === "done" || (t.status === "failed" && !recent(t.at))) continue;
    rows.push({ machine: "edit_turn", id: t.id, state: t.status, label: `${ch.title} · ${t.step ?? t.text}`.slice(0, 120), since: secs(t.at), error: t.error ?? null });
  }
  // Batch rows (this page only, not saved): new → writing → ready → queued | error
  for (const r of useBatch.getState().rows) {
    if (r.status === "new" || r.status === "ready" || r.status === "queued") continue;
    rows.push({ machine: "batch_row", id: r.id, state: r.status, label: (r.idea || r.prompt).slice(0, 80), since: null, error: r.error ?? null });
  }
  // the import this page is showing: uploading | finding → fetching → unpacking → done | none | error
  const imp = useImport.getState().run;
  if (imp && imp.state !== "done" && imp.state !== "none") rows.push({ machine: "import", id: imp.id, state: imp.state, label: imp.name, since: null, error: imp.error ?? null });
  return rows.slice(0, 300);
}

let started = false;
export function startMachineReports() {
  if (started) return; started = true;
  let last = "";
  const send = (beacon = false) => {
    let body: string;
    try { body = JSON.stringify({ items: machineRows() }); } catch { return; }
    if (body === last && !beacon) return; // nothing changed since the last report
    last = body;
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon("/studio-api/machines", new Blob([body], { type: "application/json" })); return; }
    fetch("/studio-api/machines", { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => { last = ""; });
  };
  setTimeout(() => send(), 5000);
  setInterval(() => send(), 60_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") send(true); });
}
