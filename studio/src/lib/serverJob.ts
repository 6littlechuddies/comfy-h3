// Waiting for a job on the rental (a LoRA download, a training run, an export, a send to your site): one loop for all of
// them, with clear endings. It used to be written five times, and some copies polled forever when the job was gone
// (the rental restarted, so it forgot the job) or the rental stopped answering — a spinner that never ended.
//
// States of a rental job: "running" → "done" | "error" (| "cancelled"). This resolves with the final job, or throws:
//   JobGone  — the rental doesn't know the job any more (404): it restarted mid-way
//   Error    — the rental didn't answer for `giveUpAfterMs` (default 45 s)

export class JobGone extends Error {
  constructor(what: string) { super(`The rental restarted before ${what} finished — start it again`); this.name = "JobGone"; }
}

export interface ServerJob { status: string; error?: string; [k: string]: unknown }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function watchServerJob<T extends ServerJob>(url: string, opts: {
  /** in words, for the messages: "the LoRA download", "the export" */
  what: string;
  every?: number;
  giveUpAfterMs?: number;
  onUpdate?: (j: T) => void;
  /** stop early (the screen it belongs to closed) — resolves with the last known state */
  cancelled?: () => boolean;
}): Promise<T> {
  const every = opts.every ?? 1000;
  const limit = opts.giveUpAfterMs ?? 45_000;
  let lastOk = Date.now();
  let last: T | null = null;
  for (;;) {
    if (opts.cancelled?.()) return (last ?? { status: "running" }) as T;
    let r: Response | null = null;
    try { r = await fetch(url, { cache: "no-store" }); } catch { r = null; }
    if (r && r.status === 404) throw new JobGone(opts.what);
    if (r && r.ok) {
      const j = await r.json().catch(() => null) as T | null;
      if (j && typeof j.status === "string") {
        lastOk = Date.now(); last = j;
        opts.onUpdate?.(j);
        if (j.status !== "running") return j;
      }
    }
    if (Date.now() - lastOk > limit) throw new Error(`The rental stopped answering while ${opts.what} was running — check the rental, then try again`);
    await sleep(every);
  }
}
