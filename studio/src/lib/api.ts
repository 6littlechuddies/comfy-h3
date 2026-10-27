// Thin client for ComfyUI's HTTP API + the Studio helper API. Same origin (Caddy), so the
// browser's saved login is reused automatically.
import type { ApiGraph } from "./graphs";

export type Kind = "image" | "video" | "audio";
/** a file ComfyUI knows about (output/input/temp folder) */
export interface FileRef { filename: string; subfolder: string; type: "output" | "input" | "temp" | "kept"; v?: number }
/** a file sitting in ComfyUI's input folder, ready to be used by a graph */
export interface InputFile { name: string; kind: Kind; duration?: number; width?: number; height?: number; has_audio?: boolean }

/** kept for this browser tab across refreshes, so ComfyUI keeps sending this tab the progress of jobs it started */
export const clientId = (() => {
  try { const k = sessionStorage.getItem("h3.client"); if (k) return k; } catch { /* private mode */ }
  const id = (globalThis.crypto?.randomUUID?.() ?? `c${Date.now()}${Math.random()}`).replace(/-/g, "");
  try { sessionStorage.setItem("h3.client", id); } catch { /* private mode */ }
  return id;
})();

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const b = await r.json(); msg = (typeof b?.error === "string" ? b.error : b?.error?.message) || b?.message || JSON.stringify(b).slice(0, 400); } catch { /* not json */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export function viewUrl(f: FileRef): string {
  if (f.type === "kept") return `/studio-api/kept/${f.subfolder ? f.subfolder + "/" : ""}${f.filename}${f.v ? `?v=${f.v}` : ""}`;
  const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || "", type: f.type });
  return `/view?${q}`;
}
export const inputUrl = (name: string) => viewUrl({ filename: name, subfolder: "", type: "input" });

export function kindOf(name: string): Kind | null {
  const n = name.toLowerCase();
  if (/\.(png|jpe?g|webp|bmp|gif)$/.test(n)) return "image";
  if (/\.(mp4|mov|webm|mkv|m4v|avi)$/.test(n)) return "video";
  if (/\.(wav|mp3|flac|ogg|m4a|aac|opus)$/.test(n)) return "audio";
  return null;
}

// ------------------------------------------------------------------ ComfyUI
export interface NodeError { class_type: string; errors: { message: string; details: string }[] }
export class PromptError extends Error {
  constructor(message: string, public nodeErrors?: Record<string, NodeError>) { super(message); }
}

/** the id jobs are queued under: the Studio server's relay (so every open tab sees live progress) when it's there,
 *  else this tab's own id */
let submitAs = clientId;
export const setSubmitAs = (id: string | null) => { submitAs = id || clientId; };
export async function queuePrompt(graph: ApiGraph, front = false): Promise<string> {
  const r = await fetch("/prompt", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: submitAs, ...(front ? { front: true } : {}) }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.prompt_id) {
    const ne = b?.node_errors as Record<string, NodeError> | undefined;
    const first = ne && Object.values(ne)[0];
    const detail = first ? `${first.class_type}: ${first.errors.map((e) => `${e.message} ${e.details}`).join("; ")}` : b?.error?.message;
    throw new PromptError(detail || `ComfyUI refused the job (${r.status})`, ne);
  }
  return b.prompt_id;
}

export interface HistoryEntry {
  outputs: Record<string, { images?: FileRef[]; gifs?: FileRef[]; audio?: FileRef[]; text?: string[]; animated?: boolean[] }>;
  status?: { status_str: string; completed: boolean; messages?: [string, Record<string, unknown>][] };
}
export async function history(id: string): Promise<HistoryEntry | null> {
  const b = await j<Record<string, HistoryEntry>>(await fetch(`/history/${id}`));
  return b[id] ?? null;
}
export const interrupt = () => fetch("/interrupt", { method: "POST" });
export const deleteQueued = (ids: string[]) =>
  fetch("/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: ids }) });

const infoCache: Record<string, Promise<any>> = {};
export function objectInfo(node: string): Promise<any> {
  return (infoCache[node] ??= fetch(`/object_info/${node}`).then((r) => j<any>(r)).then((b) => b[node]));
}
export async function comboOptions(node: string, input: string): Promise<string[]> {
  try {
    const n = await objectInfo(node);
    const spec = n?.input?.required?.[input] ?? n?.input?.optional?.[input];
    if (Array.isArray(spec?.[0])) return spec[0];
    if (spec?.[1]?.options) return spec[1].options;
  } catch { /* offline */ }
  return [];
}
export const listLoras = () => comboOptions("LoraLoaderModelOnly", "lora_name");
export const forgetObjectInfo = () => { for (const k of Object.keys(infoCache)) delete infoCache[k]; };
/** what a LoRA's creator recommends in its description (read when it's added) */
export interface LoraTips { weight?: number; weight_range?: string; sampler?: string; scheduler?: string; cfg?: number; cfg_range?: string; steps?: number; steps_range?: string; negative?: string; prompt?: string }
export interface LoraInfo { name: string; title: string; base: string; family: "sdxl" | "anima" | "qwen" | "krea2" | "h3" | "video" | "other" | "unknown"; remembered: boolean; size_mb: number; trigger?: string; tips?: LoraTips;
  /** what it does (from CivitAI's tags and its name): slider, character, style, detail or concept */
  role?: "slider" | "character" | "style" | "detail" | "concept" }
export async function loraLibrary(): Promise<LoraInfo[]> { try { return await j(await fetch("/studio-api/loras")); } catch { return []; } }
export async function addLoraFromLink(url: string): Promise<string> {
  return (await j<{ id: string }>(await fetch("/studio-api/loras/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }))).id;
}
export interface LoraJob { status: "running" | "done" | "error"; progress: number; title?: string; base?: string; name?: string; family?: string; trigger?: string; tips?: LoraTips; error?: string; total_mb?: number; kind?: "model"; folder?: string }
/** one of your own checkpoints (a Krea 2 / Anima / Illustrious fine-tune from CivitAI) */
export interface MyModel { name: string; title: string; version: string; family: string; folder: string; base: string; here: boolean; model_id?: number; version_id?: number }
export const myModels = async () => j<{ items: MyModel[] }>(await fetch("/studio-api/models"));
export const forgetModel = async (name: string, del = false) => j(await fetch("/studio-api/models/forget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, delete: del }) }));
export const loraJob = async (id: string) => j<LoraJob>(await fetch(`/studio-api/loras/job/${id}`));
export const listSamplers = () => comboOptions("KSamplerSelect", "sampler_name");
export const listSchedulers = () => comboOptions("BasicScheduler", "scheduler");

// ------------------------------------------------------------------ Studio helper
export async function uploadFile(file: File | Blob, name?: string, convertWav = false): Promise<InputFile> {
  const fd = new FormData();
  fd.append("file", file, name ?? (file as File).name ?? "upload.png");
  return j<InputFile>(await fetch(`/studio-api/upload${convertWav ? "?convert=wav" : ""}`, { method: "POST", body: fd }));
}
/** copy a file somewhere it survives new rentals (backed up with your settings) */
export async function keepFile(from: FileRef, path: string): Promise<FileRef> {
  return j<FileRef>(await fetch("/studio-api/keep", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, path }) }));
}
export const deleteKept = (path: string) => fetch(`/studio-api/kept/${path}`, { method: "DELETE" });
export async function getHttpsLink(): Promise<string | null> { try { return (await j<{ url: string | null }>(await fetch("/studio-api/https"))).url; } catch { return null; } }
/** several pictures side by side as one input picture (a character's angles, for the edit model to see at once) */
export async function makeBoard(files: FileRef[]): Promise<InputFile> {
  return j<InputFile>(await fetch("/studio-api/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) }));
}
export async function toInput(f: FileRef): Promise<InputFile> {
  return j<InputFile>(await fetch("/studio-api/to-input", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }));
}
export async function recentOutputs(limit = 60): Promise<(FileRef & { kind: Kind; mtime: number })[]> {
  try { return await j(await fetch(`/studio-api/recent?limit=${limit}`)); } catch { return []; }
}
export async function loadState<T>(name: string): Promise<T | null> {
  try { return await j<T | null>(await fetch(`/studio-api/state/${name}`)); } catch { return null; }
}
export async function saveState(name: string, data: unknown): Promise<void> {
  await fetch(`/studio-api/state/${name}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}
export interface FinishJob { id: string; status: "running" | "done" | "error"; progress: number; output?: FileRef & { duration: number }; error?: string }
export async function startFinish(body: unknown): Promise<string> {
  return (await j<{ id: string }>(await fetch("/studio-api/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))).id;
}
export const finishStatus = async (id: string) => j<FinishJob>(await fetch(`/studio-api/finish/${id}`));
export interface Cost { dph: number; hours: number | null; total: number | null }
export async function getCost(): Promise<Cost | null> { try { return await j(await fetch("/studio-api/cost")); } catch { return null; } }
export interface InstanceStatus {
  phase: string; message: string; busy?: boolean; browser_open?: boolean; auto_shutdown_in_s?: number | null;
  all_outputs_backed_up?: boolean | null; backup?: string | null; percent?: number;
}
export async function getStatus(): Promise<InstanceStatus | null> { try { return await j(await fetch("/h3-status", { cache: "no-store" })); } catch { return null; } }

// ------------------------------------------------------------------ CivitAI browser
export interface CivitLora {
  model_id: number; version_id: number; name: string; version: string; creator: string; base: string; family: LoraInfo["family"];
  trigger: string; size_mb: number; downloads: number; likes: number; installed: boolean;
  images: { url: string; explicit: boolean; video: boolean }[];
  tags?: string[]; versions?: { id: number; name: string; base: string }[];
}
export interface CivitVersion { id: number; name: string; base: string; family: LoraInfo["family"]; trigger: string; size_mb: number; installed: boolean; created: string }
export interface CivitModel { model_id: number; name: string; creator: string; description: string; tags: string[]; downloads: number; likes: number; versions: CivitVersion[] }
export interface CivitImage {
  id: number; url: string; thumb: string; explicit: boolean; video: boolean; width?: number; height?: number;
  prompt: string; negative: string; sampler: string; scheduler: string; steps?: number; cfg?: number; seed?: number; size: string; weight: number | null; reactions: number;
  workflow?: boolean;
}
/** CivitAI is often busy for a moment (503 / 429 / 502): wait and ask again (up to 3 times) before showing an error */
async function civFetch(url: string, init?: RequestInit): Promise<Response> {
  let r = await fetch(url, init);
  for (let i = 1; i <= 3 && [429, 500, 502, 503, 504].includes(r.status) && !init?.signal?.aborted; i++) {
    await new Promise((ok) => setTimeout(ok, 1200 * i));
    r = await fetch(url, init);
  }
  return r;
}
export const civitModel = async (id: number) => j<CivitModel>(await civFetch(`/studio-api/civitai/model/${id}`));
export async function civitImages(version: number, name: string, cursor?: string | null) {
  const qs = new URLSearchParams({ version: String(version), name });
  if (cursor) qs.set("cursor", cursor);
  return j<{ items: CivitImage[]; next: string | null }>(await civFetch(`/studio-api/civitai/images?${qs}`));
}
export async function searchCivitai(p: { q?: string; base?: string[]; sort?: string; period?: string; tag?: string; cursor?: string | null; liked?: boolean }, signal?: AbortSignal) {
  const qs = new URLSearchParams();
  if (p.liked) qs.set("liked", "1");
  if (p.q) qs.set("q", p.q);
  if (p.tag) qs.set("tag", p.tag);
  if (p.base?.length) qs.set("base", p.base.join(","));
  if (p.sort) qs.set("sort", p.sort);
  if (p.period) qs.set("period", p.period);
  if (p.cursor) qs.set("cursor", String(p.cursor));
  return j<{ items: CivitLora[]; next: string | null }>(await civFetch(`/studio-api/civitai/search?${qs}`, { signal }));
}
/** one resource (checkpoint, LoRA, embedding) used to make a CivitAI image */
export interface CivitResource {
  kind: "checkpoint" | "lora" | "embedding" | string; model_id: number | null; version_id: number | null; name: string; version: string;
  base: string; family: LoraInfo["family"]; weight: number | null; trigger: string; installed: string | null;
}
/** everything CivitAI knows about how an image or video was made */
export interface CivitGen {
  id: number; page: string; url: string; thumb: string; video: boolean; width?: number; height?: number; explicit: boolean; username: string;
  prompt: string; negative: string; sampler: string; scheduler: string; steps?: number | null; cfg?: number | null; seed?: number | null; size: string;
  base: string; family: LoraInfo["family"]; process: string; comfy: boolean; more: Record<string, string | number>; resources: CivitResource[];
  /** what's inside its ComfyUI workflow, when it has one */
  workflow?: WorkflowSummary | null;
  /** to save that workflow into ComfyUI's Workflows list */
  workflow_key?: string | null;
  /** a file of yours (not from CivitAI): already on this rental */
  local?: InputFile;
}
export interface WorkflowSummary {
  nodes: { id: string; type: string; title: string; values: Record<string, string | number | boolean> }[];
  loras: { name: string; weight?: number | null }[]; models: { kind: string; name: string }[];
  prompt: string; negative: string; settings: Record<string, string | number>; has_ui: boolean; has_api: boolean;
}
export interface CivitCollection { id: number; name: string; type: string; description: string }
export interface CollectionItem { id: number; thumb: string; url: string; video: boolean; explicit: boolean; width?: number; height?: number; has_prompt: boolean | null; has_meta: boolean | null; has_workflow?: boolean | null }
/** which CivitAI pictures carry a ComfyUI workflow: {id: true/false/null (couldn't tell)} */
export const civitWorkflows = async (ids: number[]) => j<Record<string, boolean | null>>(await fetch(`/studio-api/civitai/workflows?ids=${ids.join(",")}`));
export const civitCollections = async () => j<{ items: CivitCollection[] }>(await civFetch("/studio-api/civitai/collections"));
export async function civitCollection(id: string, cursor?: string | null) {
  const qs = new URLSearchParams({ id }); if (cursor) qs.set("cursor", cursor);
  return j<{ items: CollectionItem[]; next: string | null }>(await civFetch(`/studio-api/civitai/collection?${qs}`));
}
/** the LoRAs saved in one of your model collections, as Browse LoRAs cards */
export async function civitCollectionModels(id: number, cursor?: string | null) {
  const qs = new URLSearchParams({ id: String(id) }); if (cursor) qs.set("cursor", cursor);
  return j<{ items: CivitLora[]; next: string | null; skipped: number }>(await civFetch(`/studio-api/civitai/collection-models?${qs}`));
}
export const COLLECTION_LINK = /civitai\.(?:com|green|red)\/collections\/(\d+)/i;
/** the prompt, settings and workflow a file of yours carries, shaped like a CivitAI image */
export async function fileGen(f: InputFile): Promise<CivitGen & { found: boolean; source: string | null }> {
  const r = await fetch("/studio-api/media-meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: f.name, subfolder: "", type: "input" }) });
  const d = await j<{ found: boolean; source: string | null; error?: string; prompt: string; negative: string; sampler: string; scheduler: string; steps?: number; cfg?: number; seed?: number; size: string;
    resources: CivitResource[]; workflow: WorkflowSummary | null; workflow_key?: string; more: Record<string, string> }>(r);
  if (d.error) throw new Error(d.error);
  // a file only has file names: guess what each model was made for from its name
  const resources = d.resources.map((r) => ({ ...r, family: r.family && r.family !== "unknown" && r.family !== "other" ? r.family : guessFamily(r.name) }));
  const model = resources.find((r) => r.kind === "checkpoint");
  const family = model?.family ?? "unknown";
  return {
    ...d, resources, id: 0, page: "", url: inputUrl(f.name), thumb: inputUrl(f.name), video: f.kind === "video", width: f.width, height: f.height, explicit: false, username: "",
    base: FAMILY_BASE[family] ?? "", family, process: d.source ?? "", comfy: !!d.workflow, local: f,
  };
}
const FAMILY_BASE: Record<string, string> = { anima: "Anima", sdxl: "Illustrious", krea2: "Krea 2", qwen: "Qwen", h3: "H3" };
function guessFamily(name: string): CivitResource["family"] {
  const n = name.toLowerCase();
  if (/anima/.test(n)) return "anima";
  if (/krea/.test(n)) return "krea2";
  if (/qwen/.test(n)) return "qwen";
  if (/minimax|\bh3\b|_h3/.test(n)) return "h3";
  if (/noob|illustrious|ilxl|\bil\b|_il_|sdxl|pony|xl\b/.test(n)) return "sdxl";
  return "unknown";
}
export async function saveWorkflow(p: { key?: string | null; civitai_id?: number; name: string }): Promise<{ name: string; format: string }> {
  return j(await fetch("/studio-api/workflow/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }));
}
const GEN_CACHE = new Map<string, Promise<CivitGen>>();
/** where CivitAI links open (civitai.red shows everything your account can see) */
export const CIVITAI_SITE = "https://civitai.red";

/** read a civitai.com/images/<id> link (or an id): prompt, settings and resources */
export function civitImage(link: string): Promise<CivitGen> {
  const k = link.trim();
  if (!GEN_CACHE.has(k)) {
    const p = civFetch(`/studio-api/civitai/image?url=${encodeURIComponent(k)}`).then((r) => j<CivitGen>(r));
    p.catch(() => GEN_CACHE.delete(k));
    GEN_CACHE.set(k, p);
  }
  return GEN_CACHE.get(k)!;
}
export const CIVIT_IMAGE_LINK = /civitai\.(?:com|green|red)\/images\/(\d+)/i;
/** copy a CivitAI picture/clip into this rental's inputs, to use as a reference */
export async function civitFetchMedia(url: string, id: number): Promise<InputFile> {
  return j<InputFile>(await fetch("/studio-api/civitai/fetch-media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, id }) }));
}

/** download a LoRA from a CivitAI link and wait for it, reporting progress */
export async function installLora(url: string, onProgress?: (j: LoraJob) => void): Promise<LoraJob> {
  const id = await addLoraFromLink(url);
  for (;;) {
    await new Promise((r) => setTimeout(r, 700));
    const st = await loraJob(id).catch(() => null);
    if (!st) continue;
    onProgress?.(st);
    if (st.status !== "running") { if (st.status === "done") forgetObjectInfo(); return st; }
  }
}

// ------------------------------------------------------------------ your own LoRA files
export interface UploadedLora { name: string; title: string; base: string; family: LoraInfo["family"]; trigger: string; backed_up: boolean; size_mb: number }
/** upload a .safetensors LoRA: kept on this rental and in your cloud backup, so it's there on every rental */
export function uploadLora(file: File, onProgress?: (frac: number) => void): Promise<UploadedLora> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/studio-api/loras/upload");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) { forgetObjectInfo(); resolve(JSON.parse(x.responseText)); }
      else reject(new Error(x.status === 413 ? "That file is over 4 GB" : x.responseText || `Upload failed (${x.status})`));
    };
    x.onerror = () => reject(new Error("Upload failed — check your connection"));
    const fd = new FormData(); fd.append("file", file, file.name);
    x.send(fd);
  });
}
/** upload with a progress toast; returns the library name */
export async function uploadLoraWithToast(file: File): Promise<UploadedLora | null> {
  const { useJobs } = await import("./jobs");
  const toast = useJobs.getState().toast;
  toast(`Uploading ${file.name} (${Math.round(file.size / 1e6)} MB)…`, "info");
  try {
    const r = await uploadLora(file);
    toast(`Added your LoRA “${r.title}”${r.backed_up ? " — backed up, so it's on every rental" : ""}${r.trigger ? `. Trigger words: ${r.trigger}` : ""}.`, "good");
    return r;
  } catch (e) { toast(`${file.name}: ${(e as Error).message}`, "bad"); return null; }
}

/** cut a turnaround sheet into its separate figures (left to right) */
export async function splitSheet(from: FileRef, n = 4): Promise<FileRef[]> {
  return (await j<{ parts: FileRef[] }>(await fetch("/studio-api/sheet/split", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, n }) }))).parts;
}

// ------------------------------------------------------------------ CivitAI key (pasted in the Studio, kept with your settings)
export async function civitKeyStatus(): Promise<{ set: boolean; source: "template" | "studio" | "drive" | null; count?: number }> {
  try { return await j(await fetch("/studio-api/civitai/key")); } catch { return { set: false, source: null }; }
}
export async function saveCivitKey(key: string) {
  const r = await fetch("/studio-api/civitai/key", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
  if (!r.ok) throw new Error((await r.text()) || "Couldn't save the key");
}
/** ask for the key and save it; returns true when saved */
export async function askCivitKey(): Promise<boolean> {
  const { askText } = await import("../components/Dialogs");
  const { useJobs } = await import("./jobs");
  const k = await askText("Paste your CivitAI API key (civitai.com → Settings → API Keys). Several? Separate them with commas — when CivitAI refuses one, the next is tried.", "", "Save key");
  if (!k) return false;
  try { await saveCivitKey(k); useJobs.getState().toast("CivitAI key saved — kept with your settings, so it works on every rental.", "good"); return true; }
  catch (e) { useJobs.getState().toast((e as Error).message, "bad"); return false; }
}
