// Job tracking: queues graphs, follows ComfyUI's websocket (progress, live previews), collects results.
import { create } from "zustand";
import { clientId, history, kindOf, queuePrompt, deleteQueued, interrupt, loadState, saveState, setSubmitAs, type FileRef, type Kind } from "./api";
import type { ApiGraph } from "./graphs";
import { useTray } from "./tray";

export type Tab = "characters" | "scenes" | "create" | "compose" | "edit" | "prompt" | "animate" | "finish" | "batch";
export interface Output extends FileRef { kind: Kind; title: string }
export interface Job {
  id: string;
  tab: Tab;
  label: string;
  etaKey: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  value: number;
  max: number;
  nodeTitle?: string;
  preview?: string;
  outputs: Output[];
  texts: Record<string, string>;
  error?: string;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  etaMs?: number;
  meta?: Record<string, unknown>;
  titles: Record<string, string>;
  classes: Record<string, string>;
  doneNodes: number;
  totalNodes: number;
  /** when the current sampler started stepping (for a time-left from the real step speed) */
  stepStart?: number;
}
export interface Toast { id: number; text: string; tone: "good" | "bad" | "info"; tab?: Tab; at: number }

interface JobState {
  jobs: Job[];
  toasts: Toast[];
  timings: Record<string, number[]>;
  connected: boolean;
  run: (tab: Tab, label: string, graph: ApiGraph, etaKey: string, meta?: Record<string, unknown>) => Promise<Job>;
  cancel: (id: string) => void;
  /** move a waiting job to the front of the line */
  runNext: (id: string) => Promise<void>;
  toast: (text: string, tone?: Toast["tone"], tab?: Tab) => void;
  /** delete results: the files go too (a job with nothing left disappears) */
  removeOutputs: (items: { jobId: string; filename: string; subfolder: string }[]) => void;
  dismiss: (id: number) => void;
  eta: (key: string) => number | undefined;
}

const DEFAULT_ETA: Record<string, number> = { create: 25_000, edit: 45_000, prompt: 60_000, animate: 180_000, characters: 45_000, compose: 45_000, batch: 120_000, styles: 15_000, extract: 40_000 };
let toastId = 0;
/** which project (character) a new job belongs to — set by the app; results stay with their project */
let projectOf: () => string | null = () => null;
export const setProjectSource = (fn: () => string | null) => { projectOf = fn; };
/** the folder name a project's files are saved under (output/studio/<name>/…) — set by the app */
let folderOf: (project: string | null) => string = (p) => (p === TESTING ? "Testing" : p ? p : "Free work");
export const setProjectFolder = (fn: (project: string | null) => string) => { folderOf = fn; };
/** the pseudo-project "Check everything" files its test pictures under, so they never mix into your work */
export const TESTING = "testing";
const cleanFolder = (n: string) => n.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 60) || "Untitled";
/** studio/create/realistic → studio/Maki/create/realistic: every save node writes into its project's folder */
function intoProjectFolder(graph: ApiGraph, project: string | null) {
  const folder = cleanFolder(folderOf(project));
  for (const n of Object.values(graph)) {
    const p = (n.inputs as Record<string, unknown> | undefined)?.filename_prefix;
    if (typeof p === "string" && p.startsWith("studio/") && !p.startsWith(`studio/${folder}/`)) (n.inputs as Record<string, unknown>).filename_prefix = `studio/${folder}/${p.slice(7)}`;
  }
}

export const useJobs = create<JobState>((set, get) => ({
  jobs: [],
  toasts: [],
  timings: {},
  connected: false,
  eta: (key) => {
    const t = get().timings[key];
    if (t?.length) return t.reduce((a, b) => a + b, 0) / t.length;
    const base = key.split(":")[0];
    // scale a related measurement (same tab) by the length in seconds when we have one
    const related = Object.entries(get().timings).find(([k]) => k.startsWith(base + ":"));
    const secs = Number(key.match(/:(\d+)s/)?.[1]);
    const rsecs = related && Number(related[0].match(/:(\d+)s/)?.[1]);
    if (related && secs && rsecs) return (related[1].reduce((a, b) => a + b, 0) / related[1].length) * (secs / rsecs);
    return DEFAULT_ETA[base];
  },
  run: async (tab, label, graph, etaKey, meta) => {
    // quick text jobs (the prompt writer) go to the front of the line, so a waiting video doesn't hold up your Generate
    if (!meta || !("project" in meta)) meta = { ...meta, project: projectOf() };
    intoProjectFolder(graph, typeof meta.project === "string" ? meta.project : null);
    await ensureInputs(graph);
    await dropMissingLoras(graph, tab);
    const id = await queuePrompt(graph, !!meta?.front);
    GRAPHS.set(id, graph);
    const titles: Record<string, string> = {};
    const classes: Record<string, string> = {};
    for (const [nid, n] of Object.entries(graph)) { if (n._meta?.title) titles[nid] = n._meta.title; classes[nid] = n.class_type; }
    const job: Job = {
      id, tab, label, etaKey, status: "queued", value: 0, max: 0, outputs: [], texts: {}, queuedAt: Date.now(),
      etaMs: get().eta(etaKey), meta, titles, classes, doneNodes: 0, totalNodes: Object.keys(graph).length,
    };
    set((s) => ({ jobs: trimJobs([job, ...s.jobs]) }));
    if (tab === "animate") import("./notify").then(({ useNotify, watchJobs }) => { if (useNotify.getState().every) watchJobs([id], `Video ready: ${label}`); });
    return job;
  },
  removeOutputs: (items) => {
    const gone = new Set(items.map((x) => `${x.jobId}|${x.subfolder}|${x.filename}`));
    set((s) => ({
      jobs: s.jobs.map((j) => ({ ...j, outputs: j.outputs.filter((o) => !gone.has(`${j.id}|${o.subfolder}|${o.filename}`)) }))
        .filter((j) => j.status !== "done" || j.outputs.length > 0 || Object.keys(j.texts).length > 0),
    }));
    // out of the tray too (it kept showing deleted pictures)
    import("./tray").then(({ useTray }) => useTray.setState((t) => ({ items: t.items.filter((i) => !(i.src.type === "output" && items.some((x) => x.filename === i.src.filename && x.subfolder === i.src.subfolder))) }))).catch(() => {});
    for (const x of items) fetch("/studio-api/output/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subfolder: x.subfolder, filename: x.filename }) }).catch(() => {});
  },
  cancel: (id) => {
    const job = get().jobs.find((j) => j.id === id);
    if (!job) return;
    if (job.status === "running") interrupt();
    else deleteQueued([id]);
    patch(id, { status: "cancelled", endedAt: Date.now() });
  },
  runNext: async (id) => {
    const job = get().jobs.find((j) => j.id === id);
    const graph = GRAPHS.get(id);
    if (!job || job.status !== "queued" || !graph) return;
    await deleteQueued([id]);
    const nid = await queuePrompt(graph, true);
    GRAPHS.set(nid, graph); GRAPHS.delete(id);
    const first = Math.min(...get().jobs.filter((j) => j.status === "queued").map((j) => j.queuedAt));
    useJobs.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, id: nid, queuedAt: Math.min(j.queuedAt, first - 1) } : j)) }));
  },
  toast: (text, tone = "info", tab) => {
    const t: Toast = { id: ++toastId, text, tone, tab, at: Date.now() };
    set((s) => ({ toasts: [...s.toasts, t].slice(-4) }));
    setTimeout(() => get().dismiss(t.id), tone === "bad" ? 12000 : 7000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** each job's graph, so a waiting one can be moved to the front */
const GRAPHS = new Map<string, ApiGraph>();
function patch(id: string, p: Partial<Job> | ((j: Job) => Partial<Job>)) {
  useJobs.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...(typeof p === "function" ? p(j) : p) } : j)) }));
}
const find = (id?: string | null) => (id ? useJobs.getState().jobs.find((j) => j.id === id) : undefined);

// ------------------------------------------------------------------ timings (ETA), remembered across rentals
loadState<Record<string, number[]>>("timings").then((t) => t && useJobs.setState({ timings: t }));
function recordTiming(key: string, ms: number) {
  const timings = { ...useJobs.getState().timings };
  timings[key] = [...(timings[key] ?? []), ms].slice(-5);
  useJobs.setState({ timings });
  saveState("timings", timings).catch(() => {});
}

// ------------------------------------------------------------------ results
/** what's kept: up to 1200 results (jobs that made pictures or videos, in every project) and only the latest 60 helper
 *  jobs (the writer, face checks, drafts) — before, 120 jobs of ANY kind were kept, so a busy session with one character
 *  pushed every other character's results out of the feeds and the tray (the files were always still on disk; see Catalog) */
export function trimJobs(jobs: Job[]): Job[] {
  let results = 0, helpers = 0;
  return jobs.filter((j) => {
    if (j.status === "running" || j.status === "queued") return true;
    const made = !j.meta?.quiet && !j.meta?.noTray && j.outputs?.some((o) => o.type === "output" && (o.kind === "image" || o.kind === "video"));
    return made ? ++results <= 1200 : ++helpers <= 60;
  });
}

const collected = new Set<string>();
async function collect(id: string) {
  const job = find(id);
  if (!job || job.status === "cancelled" || collected.has(id)) return;
  collected.add(id);
  let h = null;
  for (let i = 0; i < 5 && !h; i++) {
    h = await history(id).catch(() => null);
    if (!h) await new Promise((r) => setTimeout(r, 400));
  }
  const outputs: Output[] = [];
  const texts: Record<string, string> = {};
  for (const [nid, out] of Object.entries(h?.outputs ?? {})) {
    const title = job.titles[nid] ?? job.classes[nid] ?? nid;
    for (const f of [...(out.images ?? []), ...(out.gifs ?? []), ...(out.audio ?? [])]) {
      if (f.type === "temp" && job.classes[nid] !== "SaveImage") continue; // skip temp previews
      const kind = kindOf(f.filename);
      if (kind) outputs.push({ ...f, kind, title });
    }
    if (out.text?.length) texts[title] = out.text.join("\n");
  }
  const errMsg = h?.status?.messages?.find((m) => m[0] === "execution_error")?.[1]?.exception_message as string | undefined;
  const failed = h?.status?.status_str === "error";
  const endedAt = Date.now();
  patch(id, { status: failed ? "error" : "done", outputs, texts, endedAt, error: failed ? cleanError(errMsg) : undefined, preview: undefined });
  if (job.preview) URL.revokeObjectURL(job.preview);
  const st = useJobs.getState();
  if (failed) {
    // training-set pictures show "failed" on their own tile; one message at the end instead of one per picture
    if (!job.meta?.buildFor && !job.meta?.quietFail) st.toast(`${job.label} failed: ${cleanError(errMsg)}`, "bad", job.tab);
    if (!job.meta?.buildFor && !job.meta?.quietFail && !job.meta?.selfcheck) notifyDesktop(`${job.label} failed`, true);
  } else {
    if (job.startedAt) recordTiming(job.etaKey, endedAt - job.startedAt);
    // test pictures from Check everything stay out of the tray and the feeds (they're in output/studio/Testing)
    if (!job.meta?.selfcheck && !job.meta?.buildFor && !job.meta?.noTray) outputs.filter((o) => o.type === "output").forEach((o) => useTray.getState().addOutput(o, job.label));
    // the catalog notes what each result was made from (its words, its project), so it can be found again later
    const files = outputs.filter((o) => o.type === "output" && (o.kind === "image" || o.kind === "video"));
    if (files.length && !job.meta?.selfcheck && !job.meta?.quiet) {
      const sent = job.meta?.sent as { prompt?: string; words?: string; character?: string } | undefined;
      fetch("/studio-api/catalog/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        files: files.map((o) => ({ subfolder: o.subfolder, filename: o.filename })), label: job.label, tab: job.tab,
        prompt: sent?.words || sent?.prompt || "", character: sent?.character || "", project: typeof job.meta?.project === "string" ? job.meta.project : "" }) }).catch(() => {});
    }
    // the feed already shows it when you're on that tab — only nudge when you're elsewhere
    const here = (await import("./settings")).useSettings.getState().s.tab === job.tab;
    if (!here && !job.meta?.selfcheck && !job.meta?.buildFor && !job.meta?.noTray) st.toast(`${job.label} is ready`, "good", job.tab);
    if (!job.meta?.selfcheck && !job.meta?.quiet) notifyDesktop(`${job.label} is ready`);
  }
}

export function cleanError(msg?: string): string {
  if (!msg) return "something went wrong (see ComfyUI's log)";
  if (/out of memory|OutOfMemory|CUDA error: out of memory|Allocation on device/i.test(msg))
    return "the GPU ran out of memory. Try a shorter length, a smaller size, fewer/shorter reference videos, or turn on Low-memory decode.";
  return friendlyError(msg.split("\n")[0].slice(0, 300));
}

/** technical errors in plain words, with what to do (the original stays at the end, for the debug report) */
export function friendlyError(msg: string): string {
  const m = msg || "";
  const rules: [RegExp, string][] = [
    [/deserializing header|header too small|invalid load key|unexpected EOF|SafetensorError|incomplete metadata/i, "A model file is damaged or only half downloaded — status menu → Retry on that group re-downloads it."],
    [/No such file|not found in|value not in list|Value not in list/i, "A model or file it needs isn't on the rental (still downloading, or deleted) — check the status menu."],
    [/No space left|Errno 28/i, "The rental's disk is full — delete old downloads or rent a bigger disk."],
    [/timed out/i, "It took too long and was stopped — usually the GPU was busy or full. Try again."],
    [/Connection|ECONNRESET|fetch failed|Failed to fetch/i, "Lost the connection to the rental for a moment — try again."],
  ];
  for (const [re, plain] of rules) if (re.test(m)) return m.length > 0 && plain !== m ? `${plain} (${m.slice(0, 120)})` : plain;
  return m;
}

/** "done" alerts while you're in another window or tab: a Windows pop-up (needs the secure link and your OK) and a chime.
 *  ⋯ menu → Alerts when done. */
export const ALERTS_KEY = "h3.alerts"; // "off" = no pop-up, no sound
export const alertsOn = () => { try { return localStorage.getItem(ALERTS_KEY) !== "off"; } catch { return true; } };
export function chime(bad = false) {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const notes = bad ? [440, 330] : [660, 880, 1320];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.14;
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch { /* no sound */ }
}
function notifyDesktop(text: string, bad = false) {
  if (!alertsOn() || (!document.hidden && document.hasFocus())) return;
  chime(bad);
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(bad ? "H3 Studio — failed" : "H3 Studio", { body: text, tag: "h3-done", renotify: true } as NotificationOptions);
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch { /* not allowed */ }
}

// ------------------------------------------------------------------ websocket
let running: string | null = null;
let triedRelay = false;
let relayOk = false;
/** live progress: the Studio server's relay (every tab sees every job), or ComfyUI's own socket for this tab if the relay
 *  isn't there (an older image) */
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const relay = !triedRelay || relayOk;
  const ws = new WebSocket(relay ? `${proto}://${location.host}/studio-api/ws` : `${proto}://${location.host}/ws?clientId=${clientId}`);
  ws.binaryType = "arraybuffer";
  let opened = false;
  ws.onopen = () => { opened = true; useJobs.setState({ connected: true }); };
  ws.onclose = () => {
    useJobs.setState({ connected: false });
    if (relay && !opened && !relayOk) { triedRelay = true; setSubmitAs(null); }
    setTimeout(connect, opened ? 2000 : 500);
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") return onBinary(ev.data as ArrayBuffer);
    let m: { type: string; data: any };
    try { m = JSON.parse(ev.data); } catch { return; }
    const d = m.data ?? {};
    const pid: string | undefined = d.prompt_id;
    switch (m.type) {
      case "h3relay":
        relayOk = true; triedRelay = true; setSubmitAs(d.client_id);
        break;
      case "execution_start":
        running = pid ?? null;
        if (find(pid)) patch(pid!, { status: "running", startedAt: Date.now() });
        break;
      case "execution_cached":
        if (find(pid)) patch(pid!, (j) => ({ doneNodes: j.doneNodes + (d.nodes?.length ?? 0) }));
        break;
      case "executing":
        if (!find(pid)) break;
        if (d.node == null) { running = null; collect(pid!); }
        else patch(pid!, (j) => ({ nodeTitle: friendlyNode(j.classes[d.node]), doneNodes: j.doneNodes + 1, value: 0, max: 0, stepStart: undefined,
          status: j.status === "queued" ? "running" : j.status, startedAt: j.startedAt ?? Date.now() }));
        break;
      case "progress":
        if (find(pid)) patch(pid!, (j) => ({ value: d.value, max: d.max, status: j.status === "queued" ? "running" : j.status, startedAt: j.startedAt ?? Date.now(),
          stepStart: d.value <= 1 || !j.stepStart || d.max !== j.max ? Date.now() : j.stepStart }));
        break;
      case "execution_error":
        if (find(pid)) { patch(pid!, { error: cleanError(d.exception_message) }); running = null; setTimeout(() => collect(pid!), 300); }
        break;
      case "execution_interrupted":
        if (find(pid)) patch(pid!, { status: "cancelled", endedAt: Date.now() });
        break;
      case "execution_success":
        if (find(pid)) { running = null; collect(pid!); }
        break;
    }
  };
}

function onBinary(buf: ArrayBuffer) {
  const view = new DataView(buf);
  const event = view.getUint32(0);
  let pid = running;
  let offset = 8;
  let mime = view.getUint32(4) === 2 ? "image/png" : "image/jpeg";
  if (event === 4) { // preview with metadata: [type][len][json][image]
    const len = view.getUint32(4);
    try {
      const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, len)));
      pid = meta.prompt_id ?? pid;
      mime = meta.image_type ?? mime;
    } catch { /* ignore */ }
    offset = 8 + len;
  } else if (event !== 1) return;
  const job = find(pid);
  if (!job) return;
  const url = URL.createObjectURL(new Blob([buf.slice(offset)], { type: mime }));
  if (job.preview) URL.revokeObjectURL(job.preview);
  patch(job.id, { preview: url });
}

const NODE_NAMES: Record<string, string> = {
  CheckpointLoaderSimple: "Loading the anime model", UNETLoader: "Loading the model", CLIPLoader: "Loading the text model",
  LoraLoader: "Adding LoRAs", LoraLoaderModelOnly: "Adding LoRAs", KSampler: "Drawing", SamplerCustomAdvanced: "Generating video",
  VAEDecode: "Finishing frames", VAEDecodeTiled: "Finishing frames", VAEDecodeAudio: "Making the sound", RMBG: "Cutting out the background",
  TextGenerate: "Polishing your instruction", TextEncodeQwenImage21: "Reading the pictures", MiniMaxH3ReferenceToVideo: "Reading your references",
  MiniMaxH3ImageToVideo: "Reading your picture", VHS_LoadVideo: "Loading your clip", AILab_QwenVL_GGUF: "Watching your clip",
  LLMTextProcessor: "Local model thinking", SaveVideo: "Saving", SaveImage: "Saving", CreateVideo: "Putting video and sound together",
};
const friendlyNode = (cls?: string) => (cls && NODE_NAMES[cls]) || "Working";

// ------------------------------------------------------------------ results survive a refresh AND a change of address
// (kept on the rental itself, so the secure https link and the plain IP link show the same results; this browser keeps a copy too)
const KEEP_KEY = `h3.jobs.${location.host}`;
let keepT: ReturnType<typeof setTimeout> | undefined;
let keepReady = false; // don't overwrite what's saved before it has been read back
const keepable = () => trimJobs(useJobs.getState().jobs).map(({ preview: _p, ...j }, i) => ({ ...j, titles: {}, classes: j.status === "done" || j.status === "error" || j.status === "cancelled" ? {} : j.classes,
  // the settings snapshot (for Remix) only on the newer ones — it's the bulk of what's saved
  ...(i > 250 && j.meta?.snapshot ? { meta: { ...j.meta, snapshot: undefined } } : {}) }));
// a restore that finishes while this page is open: its results join in within a minute
setInterval(() => { if (keepReady) syncJobs({ save: false }).catch(() => {}); }, 60_000);
// jobs this page removed on purpose (deleted, trimmed): the saved list on the rental mustn't bring them back
const removedIds = new Set<string>();
useJobs.subscribe((s, prev) => {
  if (s.jobs === prev.jobs || !keepReady) return;
  const now = new Set(s.jobs.map((j) => j.id));
  for (const j of prev.jobs) if (!now.has(j.id)) removedIds.add(j.id);
  clearTimeout(keepT);
  keepT = setTimeout(() => { syncJobs().catch(() => {}); }, 800);
});
/** save the results list — merged with what's saved on the rental, never over it. A fresh rental's page opens before Proton
 *  Drive has brought your old results back; saving its empty list used to wipe them from every tab's results (the files
 *  stayed, so the tray and the catalog still had them). Also run after an import or restore finishes. */
export async function syncJobs(o: { save?: boolean } = {}) {
  const remote = (await loadState<Job[]>("jobs").catch(() => null)) ?? [];
  const have = new Set(useJobs.getState().jobs.map((j) => j.id));
  const extra = (Array.isArray(remote) ? remote : []).filter((j) => j && j.id && !have.has(j.id) && !removedIds.has(j.id) && (j.status === "done" || j.status === "error" || j.status === "cancelled"));
  if (extra.length) {
    for (const j of extra) collected.add(j.id);
    useJobs.setState((st) => ({ jobs: trimJobs([...st.jobs, ...extra].sort((x, y) => (y.queuedAt ?? 0) - (x.queuedAt ?? 0))) }));
    return; // that change saves the merged list
  }
  if (o.save === false) return;
  const keep = keepable();
  try { localStorage.setItem(KEEP_KEY, JSON.stringify(keep)); } catch { /* full or private mode */ }
  await saveState("jobs", keep);
}
(async () => {
  let local: Job[] = [];
  try { local = JSON.parse(localStorage.getItem(KEEP_KEY) || "[]"); } catch { /* */ }
  const remote = (await loadState<Job[]>("jobs").catch(() => null)) ?? [];
  const byId = new Map<string, Job>();
  for (const j of [...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])]) if (j && j.id && !byId.has(j.id)) byId.set(j.id, j);
  const saved = [...byId.values()].sort((a, b) => (b.queuedAt ?? 0) - (a.queuedAt ?? 0));
  keepReady = true;
  if (!saved.length) return;
  for (const j of saved) if (j.status === "done" || j.status === "error" || j.status === "cancelled") collected.add(j.id);
  useJobs.setState((s) => ({ jobs: trimJobs([...s.jobs, ...saved.filter((j) => !s.jobs.some((x) => x.id === j.id))]) }));
  // jobs that were still going when the page closed: finished meanwhile → collect them; else they keep reporting in
  for (const j of saved.filter((x) => x.status === "running" || x.status === "queued")) {
    history(j.id).then((h) => { if (h) collect(j.id); }).catch(() => {});
  }
})();

connect();

// safety net: every few seconds, ask ComfyUI what it's doing — a job it's making shows as running, and one that finished
// while no message reached this tab (another tab queued it, the connection dropped) is collected
setInterval(async () => {
  const open = useJobs.getState().jobs.filter((j) => j.status === "queued" || j.status === "running");
  if (!open.length) return;
  let q: { queue_running?: unknown[][]; queue_pending?: unknown[][] } | null = null;
  try { q = await (await fetch("/queue", { cache: "no-store" })).json(); } catch { return; }
  const runningIds = new Set((q?.queue_running ?? []).map((x) => String(x[1])));
  const pendingIds = new Set((q?.queue_pending ?? []).map((x) => String(x[1])));
  for (const j of open) {
    if (runningIds.has(j.id)) { if (j.status !== "running") patch(j.id, { status: "running", startedAt: j.startedAt ?? Date.now() }); running = running ?? j.id; }
    else if (!pendingIds.has(j.id) && Date.now() - j.queuedAt > 4000) collect(j.id);
  }
}, 3000);

/** resolves when a job finishes (rejects if it fails or is cancelled) */
export function waitForJob(id: string): Promise<Job> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const j = useJobs.getState().jobs.find((x) => x.id === id);
      if (!j) return false;
      if (j.status === "done") { resolve(j); return true; }
      if (j.status === "error" || j.status === "cancelled") { reject(new Error(j.error || "Cancelled")); return true; }
      return false;
    };
    if (check()) return;
    const unsub = useJobs.subscribe(() => { if (check()) unsub(); });
  });
}

/** time left for a running job: from the real step speed while a sampler runs (plus a little for decoding), else the
 *  remembered average for this kind of job */
export function timeLeft(j: Job, now = Date.now()): number | undefined {
  if (j.status !== "running") return undefined;
  if (j.max > 1 && j.value > 1 && j.stepStart) {
    const per = (now - j.stepStart) / (j.value - 1);
    const rest = per * (j.max - j.value);
    const sinceStart = j.startedAt ? now - j.startedAt : 0;
    const tail = j.etaMs ? Math.max(0, j.etaMs - sinceStart - rest) * 0.25 : 0; // decoding / saving after the last step
    return rest + Math.min(tail, 90_000);
  }
  return j.etaMs && j.startedAt ? Math.max(0, j.etaMs - (now - j.startedAt)) : undefined;
}

/** a LoRA that isn't on this rental (your library still downloading, CivitAI refused it, a setting from an older rental) is left
 *  out of the picture with a note, instead of ComfyUI refusing the whole job ("Value not in list: lora_name") */
async function dropMissingLoras(graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>, tab: Tab) {
  const loraNodes = Object.entries(graph).filter(([, n]) => n.class_type === "LoraLoaderModelOnly" || n.class_type === "LoraLoader");
  if (!loraNodes.length) return;
  let have: string[] = [];
  try { const { comboOptions } = await import("./api"); have = await comboOptions("LoraLoaderModelOnly", "lora_name"); } catch { return; }
  if (!have.length) return; // couldn't ask: let ComfyUI say
  const norm = (x: string) => x.replace(/\\/g, "/");
  const haveSet = new Set(have.map(norm));
  const gone: string[] = [];
  for (const [id, n] of loraNodes) {
    const name = String(n.inputs.lora_name ?? "");
    if (haveSet.has(norm(name))) continue;
    // whatever used this node's model (0) / clip (1) now uses what went into it
    const into: Record<number, unknown> = { 0: n.inputs.model, 1: n.inputs.clip };
    for (const other of Object.values(graph)) for (const [k, v] of Object.entries(other.inputs))
      if (Array.isArray(v) && v[0] === id && into[v[1] as number] !== undefined) other.inputs[k] = into[v[1] as number];
    delete graph[id];
    gone.push(name.split("/").pop()!.replace(/\.safetensors$/, ""));
  }
  if (!gone.length) return;
  // once per set of missing LoRAs (a ×4 press used to say it four times), and ask for them to be downloaded right away
  const key = gone.slice().sort().join("|");
  if (Date.now() - (lastMissing.get(key) ?? 0) < 120_000) return;
  lastMissing.set(key, Date.now());
  const names = loraNodes.map(([, n]) => String(n.inputs.lora_name ?? "")).filter((x) => !haveSet.has(norm(x)));
  let note = "Your LoRA library may still be downloading (status menu), or CivitAI refused it — check your CivitAI key.";
  try {
    const r = await fetch("/studio-api/loras/fetch-missing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names }) });
    if (r.ok) {
      const d = await r.json() as { downloading: string[]; unknown: string[]; key: boolean };
      note = [d.downloading.length ? `Downloading ${d.downloading.length} now — they're used from the next picture on.` : "",
        d.unknown.length ? `${d.unknown.length} aren't in your LoRA library (${d.unknown.slice(0, 3).join(", ")}${d.unknown.length > 3 ? "…" : ""}) — add them again from CivitAI (⋯ → LoRAs) or remove them from the list.` : "",
        !d.key && d.downloading.length ? "No CivitAI key set: ⋯ menu → CivitAI key." : ""].filter(Boolean).join(" ") || note;
    }
  } catch { /* keep the plain note */ }
  useJobs.getState().toast(`Left out ${gone.length > 1 ? `${gone.length} LoRAs that aren't` : "a LoRA that isn't"} here yet: ${gone.join(", ")}. ${note}`, "info", tab);
}
const lastMissing = new Map<string, number>();

/** every picture a graph loads must be in ComfyUI's input folder: one an earlier rental made (a restored chat, a remix, an old
 *  setting) is made again from where it came from; when it can't be, say which in plain words instead of ComfyUI's
 *  "Invalid image file" */
const INPUT_KEYS: Record<string, string> = { LoadImage: "image", LoadImageMask: "image", VHS_LoadVideo: "video", LoadAudio: "audio" };
async function ensureInputs(graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>) {
  const names = [...new Set(Object.values(graph).map((n) => { const k = INPUT_KEYS[n.class_type]; const v = k ? n.inputs[k] : null; return typeof v === "string" ? v : null; }).filter((x): x is string => !!x && !x.includes("/")))];
  if (!names.length) return;
  let missing: string[] = [];
  try {
    const r = await fetch("/studio-api/inputs/ensure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names }) });
    if (r.ok) missing = ((await r.json()) as { missing?: string[] }).missing ?? [];
  } catch { return; } // can't check: let ComfyUI say
  if (missing.length) throw new Error(`${missing.length > 1 ? `${missing.length} pictures it uses aren't` : "A picture it uses isn't"} on this rental any more (${missing.slice(0, 2).join(", ")}) — ${missing.length > 1 ? "they were" : "it was"} put in on an earlier rental. Put the picture in again (drop it, or pick it from Your pictures / the catalog), or start a new chat.`);
}
