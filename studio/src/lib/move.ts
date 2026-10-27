// Moving results to another project (a character on the left, or Free work): drag picked pictures onto the project, or
// "Move to…" on the picked-results bar. The files stay where they are; the results just show under the other project.
import { create } from "zustand";
import { useJobs, type Job } from "./jobs";

export const MOVE_DRAG = "application/x-h3-results";
export interface MoveItem { jobId: string; filename: string; subfolder: string }
/** how many results are being dragged right now (the project list lights up its drop targets while > 0) */
export const useMoveDrag = create<{ n: number }>(() => ({ n: 0 }));

let seq = 0;
const projOf = (j: Job) => (typeof j.meta?.project === "string" ? j.meta.project : null);

/** returns how many results actually changed project */
export function moveResults(items: MoveItem[], project: string | null): number {
  const want = new Map<string, Set<string>>();
  for (const x of items) {
    if (!want.has(x.jobId)) want.set(x.jobId, new Set());
    want.get(x.jobId)!.add(`${x.subfolder}|${x.filename}`);
  }
  let moved = 0;
  useJobs.setState((s) => {
    const out: Job[] = [];
    for (const j of s.jobs) {
      const m = want.get(j.id);
      if (!m || projOf(j) === project) { out.push(j); continue; }
      const go = j.outputs.filter((o) => m.has(`${o.subfolder}|${o.filename}`));
      const stay = j.outputs.filter((o) => !m.has(`${o.subfolder}|${o.filename}`));
      if (!go.length) { out.push(j); continue; }
      moved += go.length;
      const meta = { ...j.meta, project };
      // the whole press moves: the result just changes project. Only some of a ×4: those few become their own result
      if (!stay.some((o) => o.type === "output" && (o.kind === "image" || o.kind === "video"))) out.push({ ...j, meta });
      else {
        out.push({ ...j, outputs: stay });
        out.push({ ...j, id: `${j.id}-mv${Date.now().toString(36)}${seq++}`, outputs: go, texts: {}, meta });
      }
    }
    return { jobs: out };
  });
  return moved;
}

/** what a dragged-or-picked set reads as on a drop: "5 pictures" */
export const countLabel = (n: number) => `${n} result${n === 1 ? "" : "s"}`;
