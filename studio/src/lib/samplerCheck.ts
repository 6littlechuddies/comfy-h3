// A sampler or scheduler ComfyUI doesn't have (CivitAI posts made with custom node packs: "bong_tangent", "res_2s"…) used
// to fail the whole job with "Value not in list". Before a job is queued, any it doesn't know is swapped for a close one
// it does, and you're told once.
import type { ApiGraph } from "./graphs";

let lists: { samplers: string[]; schedulers: string[] } | null = null;
async function load() {
  if (lists) return lists;
  try {
    const r = await fetch("/object_info/KSampler");
    const b = await r.json();
    const req = b?.KSampler?.input?.required ?? {};
    lists = { samplers: (req.sampler_name?.[0] ?? []) as string[], schedulers: (req.scheduler?.[0] ?? []) as string[] };
  } catch { lists = { samplers: [], schedulers: [] }; }
  return lists;
}
const nearSampler = (s: string, have: string[]) =>
  (/res|bong|dpmpp_2m|2s/i.test(s) && have.includes("dpmpp_2m") ? "dpmpp_2m" : /ancestral|_a$/i.test(s) && have.includes("euler_ancestral") ? "euler_ancestral" : have.includes("euler") ? "euler" : have[0]);
const nearScheduler = (s: string, have: string[]) =>
  (/karras/i.test(s) && have.includes("karras") ? "karras" : /beta/i.test(s) && have.includes("beta") ? "beta" : have.includes("simple") ? "simple" : have[0]);

/** fixes the graph in place; returns what was swapped (empty when nothing was) */
export async function fixSamplers(graph: ApiGraph): Promise<string[]> {
  const { samplers, schedulers } = await load();
  if (!samplers.length && !schedulers.length) return [];
  const out: string[] = [];
  for (const n of Object.values(graph)) {
    const i = n.inputs as Record<string, unknown>;
    if (typeof i.sampler_name === "string" && samplers.length && !samplers.includes(i.sampler_name)) {
      const to = nearSampler(i.sampler_name, samplers); out.push(`sampler ${i.sampler_name} → ${to}`); i.sampler_name = to;
    }
    if (typeof i.scheduler === "string" && schedulers.length && !schedulers.includes(i.scheduler) && /KSampler|Scheduler|Sampler/.test(n.class_type)) {
      const to = nearScheduler(i.scheduler, schedulers); out.push(`scheduler ${i.scheduler} → ${to}`); i.scheduler = to;
    }
  }
  return [...new Set(out)];
}
