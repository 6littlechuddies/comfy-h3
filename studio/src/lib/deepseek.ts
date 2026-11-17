// DeepSeek writes instead of a local model: its key in the Vast template (DEEPSEEK_API_KEY) or pasted in the Studio.
// While it's on, every writer job (an LLM graph) goes to the rental's /studio-api/deepseek/graph instead of ComfyUI, and
// the local writer isn't downloaded.
import { create } from "zustand";

export const useDeepseek = create<{ on: boolean; known: boolean; model: string; source: string | null }>(() => ({ on: false, known: false, model: "", source: null }));
export const deepseekOn = () => useDeepseek.getState().on;

export async function loadDeepseek() {
  try {
    const d = await (await fetch("/studio-api/deepseek", { cache: "no-store" })).json();
    useDeepseek.setState({ on: !!d.on, known: true, model: d.model ?? "", source: d.source ?? null });
  } catch { useDeepseek.setState({ known: true }); }
}

/** try a key and keep it on this rental ("" removes it); throws with DeepSeek's reason when it doesn't work */
export async function setDeepseekKey(key: string) {
  const r = await fetch("/studio-api/deepseek", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `The rental answered ${r.status}`);
  useDeepseek.setState({ on: !!d.on, known: true, model: d.model ?? "", source: d.source ?? null });
  import("./downloads").then((m) => m.refreshDownloads()).catch(() => {});
  // DeepSeek writes now: the local writer's files come off this disk and it isn't downloaded again (new rentals with the
  // key in the template never download it)
  // (key removed: the local writer downloads again)
  for (const group of d.on ? ["writer", "writer_xl"] : ["writer"]) await fetch("/studio-api/downloads/later", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d.on ? { group, remove: true } : { group, later: false }) }).catch(() => null);
}

/** what the model name means, for people */
export const modelName = (m: string) => (m === "deepseek-flash" ? "V4.1 Flash 1017" : m);

let loading: Promise<void> | null = null;
/** the first look is shared: everyone asking at start waits for the same answer */
export function ensureDeepseek(): Promise<void> { return useDeepseek.getState().known ? Promise.resolve() : (loading ??= loadDeepseek()); }
if (typeof window !== "undefined") void ensureDeepseek();
