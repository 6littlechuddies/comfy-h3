// Long video (past H3's 15 s): the parts are made one job at a time with H3 Relay's native continuation (buildLong) — each part
// starts from the last frames of the one before, inside the model, so the joins don't show. Relay keeps every finished part on
// disk, so the run can stop (crash, closed tab, Stop) and pick up at the next part: the same parts, prompts and seeds rebuild
// the same graph and Relay hands back what it already made. The run is remembered in this browser until it's joined.
import { create } from "zustand";
import type { LongShot, LoraPick } from "./graphs";

export interface LongRun {
  id: string;
  title: string;
  global: string;
  shots: LongShot[];
  images: string[];
  firstFrame?: string;
  width: number; height: number;
  overlap: 18 | 35 | 52 | 69;
  turbo: boolean; loras: LoraPick[]; anime: boolean; refImageSize: "match" | "max"; kitchen: boolean;
  /** parts finished (0…shots.length); shots.length + 1 once they're joined */
  done: number;
  status: "running" | "stopped" | "failed" | "done";
  error?: string;
  at: number;
}
const KEY = "h3.longRun";
const load = (): LongRun | null => { try { const r = JSON.parse(localStorage.getItem(KEY) || "null") as LongRun | null; return r ? { ...r, status: r.status === "running" ? "stopped" : r.status } : null; } catch { return null; } };
const save = (r: LongRun | null) => { try { if (r) localStorage.setItem(KEY, JSON.stringify(r)); else localStorage.removeItem(KEY); } catch { /* private mode */ } };

export const useLong = create<{ run: LongRun | null; stopAsked: boolean }>(() => ({ run: load(), stopAsked: false }));
const patch = (p: Partial<LongRun>) => { const r = useLong.getState().run; if (!r) return; const n = { ...r, ...p }; useLong.setState({ run: n }); save(n); };
export const stopLong = () => useLong.setState({ stopAsked: true });
export const forgetLong = () => { useLong.setState({ run: null }); save(null); };
/** seconds of finished video the parts add up to (the overlap is hidden context, not extra length) */
export const longSeconds = (shots: { seconds: number }[]) => shots.reduce((s, x) => s + x.seconds, 0);

/** make the parts from `run.done` on, then join them; resolves when it's joined, stopped or failed */
export async function runLong(r: LongRun) {
  const [{ buildLong }, { useJobs, waitForJob }] = await Promise.all([import("./graphs"), import("./jobs")]);
  useLong.setState({ run: { ...r, status: "running", error: undefined }, stopAsked: false }); save({ ...r, status: "running" });
  const n = r.shots.length;
  for (let k = Math.min(r.done, n); k <= n; k++) {
    if (useLong.getState().stopAsked) { patch({ status: "stopped" }); useJobs.getState().toast(`Long video stopped after part ${k} of ${n} — Continue picks up from part ${k + 1}`, "info", "animate"); return; }
    const joining = k === n;
    // the last job makes the last part (if it isn't made yet) and joins everything; earlier jobs make one new part each
    const g = buildLong({ run: `studio_long_${r.id}`, global: r.global, shots: r.shots, upTo: Math.min(k, n - 1), images: r.images, firstFrame: r.firstFrame,
      width: r.width, height: r.height, overlap: r.overlap, turbo: r.turbo, loras: r.loras, anime: r.anime, refImageSize: r.refImageSize, kitchen: r.kitchen,
      assemble: joining, prefix: `studio/animate/long_${r.id}` });
    const label = joining ? `Long video · joining ${n} parts (${longSeconds(r.shots)} s)` : `Long video · part ${k + 1} of ${n} (${r.shots[k].seconds} s)`;
    try {
      const job = await useJobs.getState().run("animate", label, g, `animate:long:${r.turbo ? "turbo" : "full"}:${joining ? "join" : `${r.shots[k].seconds}s`}`,
        { long: r.id, ...(joining ? {} : { longPart: k + 1 }) });
      const done = await waitForJob(job.id);
      if (done.status !== "done") throw new Error(done.error ?? "it didn't finish");
      // a part made by an earlier (joined) job comes straight from Relay's cache
      patch({ done: joining ? n + 1 : k + 1 });
    } catch (e) {
      patch({ status: "failed", error: (e as Error).message });
      useJobs.getState().toast(`Long video: ${joining ? "joining" : `part ${k + 1}`} failed (${(e as Error).message}). Press Continue to try again from there — finished parts aren't made again.`, "bad", "animate");
      return;
    }
  }
  patch({ status: "done" });
  useJobs.getState().toast(`Long video joined: ${n} parts, ${longSeconds(r.shots)} s`, "good", "animate");
}
