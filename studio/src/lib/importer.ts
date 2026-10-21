import { create } from "zustand";

/** One import on this rental: a .zip you dropped (sent in pieces) or your newest export coming back from Proton Drive. */
export type ImportRun = {
  id: string;
  name: string;
  source: "you" | "proton";
  /** uploading → unpacking → done | error. Proton: finding → fetching → unpacking → done | none | error */
  state: "uploading" | "finding" | "fetching" | "unpacking" | "done" | "none" | "error";
  size: number;
  got: number;        // bytes on the rental
  done: number;       // pictures unpacked
  total: number;
  mbps?: number;
  leftS?: number;
  error?: string;
  result?: ImportResult;
  /** which drive the backups use: "Google Drive" or "Proton Drive" */
  cloud?: string;
  results?: "copying" | "done" | "failed"; // Proton: your result files following in the background
};
export type ImportResult = { added: number; updated: number; kept_newer?: number; refused: string[]; aged?: string[]; extras?: Record<string, number | boolean> };

export const useImport = create<{ run: ImportRun | null; hidden: boolean; set: (p: Partial<ImportRun> | null) => void; hide: () => void }>((set) => ({
  run: null, hidden: false,
  set: (p) => set((s) => ({ run: p === null ? null : ({ ...(s.run ?? {}), ...p } as ImportRun), hidden: p === null ? s.hidden : false })),
  hide: () => set({ hidden: true }),
}));

const PARALLEL = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json(r: Response) {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || (r.status === 413 ? "That piece was too big for the link" : r.status === 401 ? "Signed out — reload the page" : `The rental answered ${r.status}`));
  return d;
}

/** send one piece; a dropped connection is tried again (secure links drop now and then) */
async function sendPiece(id: string, blob: Blob, offset: number, onBytes: (n: number) => void) {
  for (let tryN = 0; ; tryN++) {
    try {
      await new Promise<void>((ok, bad) => {
        const x = new XMLHttpRequest();
        let seen = 0;
        x.open("PUT", `/studio-api/import/${id}/chunk?offset=${offset}`);
        x.upload.onprogress = (e) => { onBytes(e.loaded - seen); seen = e.loaded; };
        x.onload = () => { if (x.status < 300) { onBytes(blob.size - seen); ok(); } else { onBytes(-seen); bad(new Error(x.status === 404 ? "The rental lost this import — start it again" : `piece refused (${x.status})`)); } };
        x.onerror = x.ontimeout = () => { onBytes(-seen); bad(new Error("connection dropped")); };
        x.timeout = 10 * 60_000;
        x.send(blob);
      });
      return;
    } catch (e) {
      if (tryN >= 4 || /lost this import/.test((e as Error).message)) throw e;
      await sleep(1000 * 2 ** tryN);
    }
  }
}

/** Upload a .zip from Export in pieces (several at once — faster, and never over Cloudflare's 100 MB limit), then wait for
 *  the rental to unpack it. Progress goes to useImport (the import card in the Studio, and the startup screen). */
export async function uploadImport(file: File): Promise<ImportResult> {
  const st = useImport.getState();
  if (st.run && ["uploading", "unpacking", "fetching"].includes(st.run.state) && st.run.source === "you") throw new Error("An import is already running — wait for it to finish");
  useImport.setState({ run: { id: "", name: file.name, source: "you", state: "uploading", size: file.size, got: 0, done: 0, total: 0 }, hidden: false });
  let start;
  try {
    if (!/\.zip$/i.test(file.name)) throw new Error("That isn't a .zip from Export");
    start = await json(await fetch("/studio-api/import/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, size: file.size }) }));
  } catch (e) {
    useImport.getState().set({ state: "error", error: (e as Error).message === "Failed to fetch" ? "Couldn't reach the rental — try again in a moment" : (e as Error).message });
    throw e;
  }
  const id: string = start.id, chunk: number = start.chunk || 16 * 1024 * 1024;
  useImport.setState({ run: { id, name: file.name, source: "you", state: "uploading", size: file.size, got: 0, done: 0, total: 0 }, hidden: false });
  const t0 = performance.now();
  let sent = 0, lastPaint = 0;
  const onBytes = (n: number) => {
    sent += n;
    const now = performance.now();
    if (now - lastPaint < 250 && sent < file.size) return;
    lastPaint = now;
    const s = (now - t0) / 1000, mbps = s > 1 ? sent / 1048576 / s : undefined;
    useImport.getState().set({ got: Math.max(0, Math.min(file.size, sent)), mbps: mbps && +mbps.toFixed(1), leftS: mbps ? (file.size - sent) / 1048576 / mbps : undefined });
  };
  const offsets: number[] = [];
  for (let o = 0; o < file.size; o += chunk) offsets.push(o);
  try {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLEL, offsets.length) }, async () => {
      while (next < offsets.length) {
        const o = offsets[next++];
        await sendPiece(id, file.slice(o, Math.min(file.size, o + chunk)), o, onBytes);
      }
    }));
    useImport.getState().set({ got: file.size, state: "unpacking", leftS: undefined });
    await json(await fetch(`/studio-api/import/${id}/finish`, { method: "POST" }));
    for (let fails = 0; ;) {
      await sleep(700);
      let d;
      try { d = await json(await fetch(`/studio-api/import/${id}`, { cache: "no-store" })); fails = 0; }
      catch (e) { if (++fails > 8) throw e; continue; }
      useImport.getState().set({ done: d.done, total: d.total });
      if (d.state === "done") { useImport.getState().set({ state: "done", result: d.result }); return d.result; }
      if (d.state === "error") throw new Error(d.error || "Couldn't import that file");
    }
  } catch (e) {
    useImport.getState().set({ state: "error", error: (e as Error).message });
    throw e;
  }
}

/** the rental may be bringing your work back from Proton Drive by itself (a fresh rental): show it like an import */
export async function watchRestore(onDone: (r: ImportResult | undefined) => void) {
  let seenRunning = false, sawUnpack = false;
  for (let i = 0; i < 4000; i++) {
    const cur = useImport.getState().run;
    if (cur?.source === "you" && cur.state !== "done" && cur.state !== "error") { await sleep(3000); continue; }
    let d: (ImportRun & { source?: string }) | null = null;
    try { const r = await fetch("/studio-api/import/latest", { cache: "no-store" }); d = r.ok ? await r.json() : null; } catch { /* rental busy */ }
    if (!d || d.source !== "proton") { if (seenRunning && useImport.getState().run?.source === "proton") useImport.getState().set(null); return; }
    const running = ["finding", "fetching", "unpacking"].includes(d.state);
    if (running || d.results === "copying") seenRunning = true;
    if (running) sawUnpack = true;
    if (!seenRunning) return; // it finished before this page opened: nothing to show
    if (d.state === "none") { useImport.getState().set(null); return; }
    if (cur?.source !== "you") useImport.getState().set({ ...d, source: "proton", name: d.name || "your newest export" });
    // only the page that watched it unpack picks it up (and only once per restore): a page opened while the result
    // pictures were still copying used to reload itself over and over — the startup screen and the Studio flip-flopping
    const key = `h3.restoreSeen.${d.id ?? d.name ?? ""}`;
    let done = false; try { done = !!sessionStorage.getItem(key); } catch { /* */ }
    if (d.state === "done" && cur?.state !== "done" && sawUnpack && !done) { try { sessionStorage.setItem(key, "1"); } catch { /* */ } onDone(d.result); }
    if (d.state === "error" || (d.state === "done" && d.results !== "copying")) return;
    await sleep(running ? 1200 : 5000);
  }
}
