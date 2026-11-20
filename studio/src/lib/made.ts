// Which job made a file — so every viewer (results, tray, characters) can show "How it was made" the same way, and
// delete the same way. Character pictures are copies kept under characters/<id>/…: where each copy came from is noted
// when it's kept, so it still leads back to the picture (and the settings) it was made from.
import type { FileRef } from "./api";
import { useJobs, type Job, type Output } from "./jobs";

const KEY = "h3.origins";
const key = (f: { subfolder?: string; filename: string }) => `${f.subfolder ?? ""}/${f.filename}`;
const read = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
/** a kept copy (to) came from this file (from) */
export function noteOrigin(to: FileRef, from: FileRef) {
  if (from.type !== "output" || key(to) === key(from)) return;
  try { const m = read(); m[key(to)] = m[key(from)] ?? key(from); localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode */ }
  // kept as a character's picture: the strongest "this one's good"
  import("./promptBank").then(({ signal }) => signal(from, "character")).catch(() => {});
}
/** the job and output behind a file (following kept copies back to the original) — null when it isn't one of this browser's results */
export function madeBy(f: FileRef | null): { j: Job; o: Output } | null {
  if (!f) return null;
  const want = new Set([key(f)]);
  const o = read()[key(f)]; if (o) want.add(o);
  for (const j of useJobs.getState().jobs) for (const x of j.outputs) if (want.has(key(x))) return { j, o: x };
  return null;
}
/** delete a result's file (and take it off the lists) */
export function deleteFile(f: FileRef) {
  const m = madeBy(f);
  useJobs.getState().removeOutputs([{ jobId: m?.j.id ?? "", filename: f.filename, subfolder: f.subfolder ?? "" }]);
}

/** a character's own picture (front / face…) whose character was made from a CivitAI post: that post's page */
export async function charSourceOf(url: string): Promise<string | null> {
  const m = /characters(?:%2F|\/)([^/&%]+)(?:%2F|\/)(?:prev_)?(\w+)\.png/i.exec(url);
  if (!m) return null;
  const { useCharacters } = await import("./characters");
  const c = useCharacters.getState().list.find((x) => x.id === m[1]);
  return c?.from?.page ?? null;
}
