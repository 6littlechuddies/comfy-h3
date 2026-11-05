// Usage log: what you actually use, so downloads nobody uses can be dropped. Sent in small batches to the Studio server
// (which merges every rental's log on your drive). Records only:
//   - jobs: tab + mode ("job animate:i2v:turbo:#s:#") — never prompts, names or labels
//   - model files each job loaded ("krea2_turbo_fp8_scaled.safetensors")
//   - buttons, tabs and menu items you press, by their label ("click edit · Copy appearance")
//   - keyboard shortcuts held with Ctrl/Cmd/Alt ("key Ctrl+Enter") — never what you type
import type { ApiGraph } from "./graphs";

type Ev = { k: "f" | "m"; n: string; c: number };
const q = new Map<string, Ev>();
let timer: ReturnType<typeof setTimeout> | null = null;
let off = false;

const MODEL = /\.(safetensors|sft|gguf|ckpt|pt|pth|bin|onnx)$/i;
/** numbers vary run to run (seconds, counts, sizes): "#" groups them */
const norm = (s: string) => s.replace(/\s+/g, " ").replace(/\d+(\.\d+)?/g, "#").trim().slice(0, 90);

function flush(beacon = false) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!q.size || off) return;
  const body = JSON.stringify({ events: [...q.values()] });
  q.clear();
  try {
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon("/studio-api/usage", new Blob([body], { type: "application/json" })); return; }
    fetch("/studio-api/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })
      .then((r) => r.json()).then((b) => { if (b?.off) off = true; }).catch(() => {});
  } catch { /* never let logging break anything */ }
}

export function logUse(k: "f" | "m", name: string) {
  if (off) return;
  const n = k === "m" ? name.slice(0, 90) : norm(name);
  if (!n) return;
  const key = k + "|" + n;
  const e = q.get(key);
  if (e) e.c++; else q.set(key, { k, n, c: 1 });
  if (!timer) timer = setTimeout(() => flush(), 15_000);
}

/** a job: its tab + mode (the timing key, numbers removed) and every model file it loads */
export function logJob(tab: string, etaKey: string, graph: ApiGraph) {
  try {
    logUse("f", `job ${etaKey || tab}`);
    const files = new Set<string>();
    for (const n of Object.values(graph)) {
      for (const v of Object.values((n.inputs ?? {}) as Record<string, unknown>)) {
        if (typeof v === "string" && MODEL.test(v)) files.add(v.split(/[\\/]/).pop()!);
      }
    }
    files.forEach((f) => logUse("m", f));
  } catch { /* ignore */ }
}

function labelOf(el: Element): string {
  const a = el.getAttribute("aria-label") || el.getAttribute("title") || (el as HTMLElement).innerText || el.textContent || "";
  return a.split("\n")[0].trim().slice(0, 50);
}

let started = false;
/** called once at start-up */
export function startUsageLog() {
  if (started) return; started = true;
  document.addEventListener("click", (e) => {
    try {
      const t = e.target as Element | null;
      const el = t?.closest?.("button, [role=button], [role=tab], [role=menuitem], a, summary, label, select");
      if (!el || el.closest("[data-usage-skip]")) return;
      const label = labelOf(el);
      if (!label) return;
      const where = el.closest("[data-tab]")?.getAttribute("data-tab");
      logUse("f", `click ${where ? where + " · " : ""}${label}`);
    } catch { /* ignore */ }
  }, true);
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey || e.altKey) || ["Control", "Meta", "Alt", "Shift"].includes(e.key)) return;
    const k = (e.ctrlKey ? "Ctrl+" : "") + (e.metaKey ? "Cmd+" : "") + (e.altKey ? "Alt+" : "") + (e.shiftKey ? "Shift+" : "") + (e.key.length === 1 ? e.key.toUpperCase() : e.key);
    logUse("f", `key ${k}`);
  }, true);
  addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
}

export interface UsageReport {
  on: boolean; rentals: number; since: number; this_rental: string;
  groups: { id: string; label: string; gb: number; state: string; uses: number; last: number | null; rentals: number; files: number }[];
  features: { name: string; uses: number; last: number; rentals: number }[];
}
export async function usageReport(): Promise<UsageReport | null> {
  try { const r = await fetch("/studio-api/usage"); return r.ok ? await r.json() : null; } catch { return null; }
}
