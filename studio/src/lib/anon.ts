// Anonymous mode (⋯ menu): every picture or video made while it's on is deleted 10 minutes after it finishes — unless
// you do something with it first: star it, download it, use it (Edit / Animate slot, a character's picture, your site).
// Turning it off keeps whatever is still there.
import { create } from "zustand";
import { useJobs, type Output } from "./jobs";

const KEY = "h3.anon", LIST = "h3.anon.pending", KEEP = "h3.anon.kept";
export const ANON_MINUTES = 10;
const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const fk = (o: { subfolder?: string; filename: string }) => `${o.subfolder ?? ""}/${o.filename}`;

export const useAnon = create<{ on: boolean }>(() => ({ on: load(KEY, false) }));
export function setAnon(on: boolean) { useAnon.setState({ on }); save(KEY, on); if (!on) save(LIST, []); }
/** you did something with it: it stays */
export function keepAnon(f: { subfolder?: string; filename: string }) { const k = load<string[]>(KEEP, []); if (!k.includes(fk(f))) { k.push(fk(f)); save(KEEP, k.slice(-2000)); } }

type Pending = { jobId: string; subfolder: string; filename: string; at: number };
// new results while anonymous: noted with the time they finished
useJobs.subscribe((s, prev) => {
  if (!useAnon.getState().on) return;
  const add: Pending[] = [];
  for (const j of s.jobs) {
    if (j.status !== "done" || prev.jobs.find((x) => x.id === j.id)?.status === "done") continue;
    for (const o of j.outputs as Output[]) if (o.type === "output") add.push({ jobId: j.id, subfolder: o.subfolder, filename: o.filename, at: Date.now() });
  }
  if (add.length) save(LIST, [...load<Pending[]>(LIST, []), ...add]);
});

/** used = starred, downloaded, in the tray as an input (a slot), a character's picture, or sent to your site */
async function used(p: Pending): Promise<boolean> {
  if (load<string[]>(KEEP, []).includes(fk(p))) return true;
  const [{ isFav, useFavs }, { useTray }] = await Promise.all([import("./favs"), import("./tray")]);
  if (isFav(useFavs.getState().set, { filename: p.filename, subfolder: p.subfolder, type: "output" })) return true;
  if (useTray.getState().items.some((i) => i.input && i.src.filename === p.filename && i.src.subfolder === p.subfolder)) return true;
  const origins = load<Record<string, string>>("h3.origins", {});
  if (Object.values(origins).includes(fk(p))) return true;
  return false;
}

async function sweep() {
  if (!useAnon.getState().on) return;
  const list = load<Pending[]>(LIST, []);
  const due = list.filter((p) => Date.now() - p.at >= ANON_MINUTES * 60_000);
  if (!due.length) return;
  const gone: Pending[] = [];
  for (const p of due) if (!(await used(p))) gone.push(p);
  if (gone.length) useJobs.getState().removeOutputs(gone.map((p) => ({ jobId: p.jobId, filename: p.filename, subfolder: p.subfolder })));
  save(LIST, list.filter((p) => !due.includes(p)));
}
setInterval(() => { sweep().catch(() => {}); }, 30_000);
