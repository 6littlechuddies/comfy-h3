// Batch → Cosplay: a list of characters (name + series) becomes realistic cosplay photos.
//   1. look the character up (AniList: age, description, the official picture)
//   2. adult check — skipped for good when a character is, or is drawn as, under 18 (the writer checks too)
//   3. find Krea 2 LoRAs for the character on CivitAI with your key, most collected first; you approve one (or it picks)
//   4. DeepSeek (the writer) describes the costume piece by piece and writes the Krea 2 prompt
//   5. "Add to batch" makes one Batch row per character
import { create } from "zustand";
import { runWriter } from "./writer";
import { searchCivitai, installLora, type CivitLora } from "./api";
import { minorWords } from "./adult";
import type { LoraPick } from "./graphs";

export interface Candidate { model_id: number; version_id: number; name: string; creator: string; trigger: string; collected: number; downloads: number; images: CivitLora["images"]; installed: boolean }
export interface CosItem {
  key: string;                 // name|series, lower case
  name: string; series: string;
  status: "new" | "looking" | "skipped" | "ready" | "error";
  why?: string;                // skipped / error: the reason
  age?: string;
  picture?: string;            // the official picture (input file name), shown and given to the writer
  notes?: string;              // what AniList says
  outfit?: string; wig?: string; eyes?: string; props?: string; pose?: string;
  prompt?: string;
  loras?: Candidate[];         // CivitAI candidates, most collected first
  lora?: Candidate | null;     // approved (null = none: prompt only)
  loraFile?: LoraPick | null;  // once downloaded
}
export interface CosOpts { cosplayer: "one" | "each"; charId: string | null; auto: boolean; minCollected: number; takes: number }

const KEY = "h3.cosplay";
const MEM = "h3.cosplay.loras"; // character key → the approved LoRA (or "none"), kept for next time
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } };
const keyOf = (name: string, series: string) => `${name}|${series}`.toLowerCase().replace(/\s+/g, " ").trim();

export const useCosplay = create<{ items: CosItem[]; opts: CosOpts; set: (p: Partial<{ items: CosItem[]; opts: CosOpts }>) => void; update: (key: string, p: Partial<CosItem>) => void }>((set, get) => ({
  items: load<{ items: CosItem[] }>(KEY, { items: [] }).items,
  opts: { cosplayer: "each", charId: null, auto: false, minCollected: 50, takes: 2, ...load<Partial<CosOpts>>(KEY + ".opts", {}) },
  set: (p) => { set(p); save(); },
  update: (key, p) => { set({ items: get().items.map((x) => (x.key === key ? { ...x, ...p } : x)) }); save(); },
}));
function save() { try { const s = useCosplay.getState(); localStorage.setItem(KEY, JSON.stringify({ items: s.items })); localStorage.setItem(KEY + ".opts", JSON.stringify(s.opts)); } catch { /* full or private */ } }

/** "Reze	Chainsaw Man	5 (2 reposts)", "Makima — Chainsaw Man", "2B (NieR: Automata)" → name + series (counts and notes dropped) */
export function parseList(text: string): { name: string; series: string }[] {
  const out: { name: string; series: string }[] = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (!line || /^__|^#|^files|^coverage/i.test(line)) continue;
    let name = "", series = "";
    if (line.includes("\t")) { [name, series] = line.split("\t").map((x) => x.trim()); }
    else if (/\s[—–-]\s|,\s/.test(line)) { [name, series] = line.split(/\s[—–-]\s|,\s/).map((x) => x.trim()); }
    else { const m = line.match(/^(.+?)\s*\(([^)]+)\)\s*$/); if (m) { name = m[1]; series = m[2]; } else name = line; }
    // "Chloe (von Einzbern)" → Chloe von Einzbern · "Illya (Illyasviel von Einzbern)" → Illyasviel von Einzbern
    const par = name.match(/^(.*?)\s*\((.*?)\)\s*$/);
    if (par) name = /^[a-z]/.test(par[2]) ? `${par[1]} ${par[2]}` : par[2].includes(" ") ? par[2] : par[1];
    name = name.replace(/\s+/g, " ").trim();
    series = (series || "").replace(/\s*·.*$/, "").replace(/\s+\d.*$/, "").trim();
    if (name && !out.some((o) => keyOf(o.name, o.series) === keyOf(name, series))) out.push({ name, series });
  }
  return out;
}

export function addList(text: string): number {
  const st = useCosplay.getState();
  const have = new Set(st.items.map((i) => i.key));
  const mem = load<Record<string, Candidate | "none">>(MEM, {});
  const add = parseList(text).filter((x) => !have.has(keyOf(x.name, x.series))).map((x): CosItem => {
    const k = keyOf(x.name, x.series); const m = mem[k];
    return { key: k, name: x.name, series: x.series, status: "new", lora: m === "none" ? null : m };
  });
  st.set({ items: [...st.items, ...add] });
  return add.length;
}

/** any stated age under 18 ("17", "16-17", "15 (Part 1), 19") — conservative: one young number is enough */
const youngAge = (age: string) => (age.match(/\d+/g) ?? []).map(Number).some((n) => n < 18);

/** steps 1–2 for one character: AniList, the adult check, the official picture */
async function lookUp(it: CosItem): Promise<Partial<CosItem>> {
  const r = await fetch(`/studio-api/cosplay/lookup?name=${encodeURIComponent(it.name)}&series=${encodeURIComponent(it.series)}`).then((x) => x.json()).catch(() => ({ found: false }));
  if (!r.found) return { notes: "" };
  const age = String(r.age || "");
  if (age && youngAge(age)) return { status: "skipped", age, why: `Under 18 in the source (age: ${age})` };
  const notes = [r.name && `Name: ${r.name}`, age && `Age: ${age}`, r.gender && `Gender: ${r.gender}`, r.series?.length && `Appears in: ${r.series.join(", ")}`, r.description].filter(Boolean).join("\n");
  let picture: string | undefined;
  if (r.image) {
    try { const d = await fetch("/studio-api/fetch-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: r.image }) }).then((x) => x.json()); picture = d.name; } catch { /* no picture: words only */ }
  }
  return { age, notes, picture };
}

/** step 3: CivitAI LoRAs for Krea 2 whose title or tags name the character, most collected first */
export async function findLoras(it: CosItem): Promise<Candidate[]> {
  const first = it.name.split(/\s+/)[0].toLowerCase();
  const words = it.name.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const hit = (l: CivitLora) => { const t = `${l.name} ${(l.tags ?? []).join(" ")}`.toLowerCase(); return words.every((w) => t.includes(w)) || (t.includes(first) && !!it.series && it.series.toLowerCase().split(/\W+/).some((s) => s.length > 3 && t.includes(s))); };
  const seen = new Map<number, Candidate>();
  for (const q of [it.name, `${it.name} ${it.series}`.trim()]) {
    let res: { items: CivitLora[] } = { items: [] };
    try { res = await searchCivitai({ q, base: ["Krea 2"], sort: "Most Collected", period: "AllTime" }); }
    catch { try { res = await searchCivitai({ q, base: ["Krea 2"], sort: "Most Downloaded", period: "AllTime" }); } catch { /* CivitAI down: none */ } }
    for (const l of res.items) if (hit(l) && !seen.has(l.version_id)) seen.set(l.version_id, { model_id: l.model_id, version_id: l.version_id, name: l.name, creator: l.creator, trigger: l.trigger, collected: (l as CivitLora & { collected?: number }).collected ?? 0, downloads: l.downloads, images: l.images, installed: l.installed });
    if (seen.size >= 3) break;
  }
  return [...seen.values()].sort((a, b) => b.collected - a.collected || b.downloads - a.downloads).slice(0, 3);
}

/** step 4: the writer's adult check, costume and prompt */
async function writePrompt(it: CosItem, cosplayer: string, taste: string): Promise<Partial<CosItem>> {
  const raw = await runWriter("cosplay", { taste, character: it.name, series: it.series || "(not given)", cosplayer: cosplayer || "(none given: an adult woman in her twenties)", triggers: it.lora?.trigger || "(none)", notes: it.notes || "(nothing found — use what you know; if unsure about the age, it is NOT allowed)" },
    { tab: "batch", label: `Cosplay · ${it.name}`, images: it.picture ? [it.picture] : undefined, big: true });
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("The writer didn't answer in the expected format — try again");
  const d = JSON.parse(m[0]);
  if (!d.allowed) return { status: "skipped", age: d.age || it.age, why: d.why || "Not an adult character" };
  const prompt = String(d.prompt || "");
  if (minorWords(prompt).length) return { status: "skipped", why: "The prompt came back with under-18 words — not used" };
  return { status: "ready", age: d.age || it.age, outfit: d.outfit, wig: d.wig, eyes: d.eyes, props: d.props, pose: d.pose, prompt };
}

/** steps 1–4 for every character that isn't done; one at a time (CivitAI and the writer both like that better) */
/** the writers working side by side (CivitAI and AniList are fine with this many) */
export const WORKERS = 4;

/** steps 1–4 for every character that isn't done — several at once, each its own writer job ("sub-agents"), all reading
 *  the same learned taste (worked out once, before they start) */
export async function researchAll(cosplayer: string, only?: string) {
  const st = useCosplay.getState();
  const todo = st.items.filter((it) => (only ? it.key === only : it.status !== "ready" && it.status !== "skipped")).map((it) => it.key);
  if (!todo.length) return;
  const { tasteBlock } = await import("./promptBank");
  const who = st.opts.cosplayer === "one" ? st.opts.charId : null;
  const taste = await tasteBlock(who).catch(() => "(nothing learned yet)");
  const one = async (k: string) => {
    const up = (p: Partial<CosItem>) => useCosplay.getState().update(k, p);
    up({ status: "looking", why: undefined });
    try {
      const a = await lookUp(useCosplay.getState().items.find((x) => x.key === k)!);
      up(a);
      if (a.status === "skipped") return;
      let cur = useCosplay.getState().items.find((x) => x.key === k)!;
      if (cur.lora === undefined) {
        const loras = await findLoras(cur);
        const o = useCosplay.getState().opts;
        up({ loras, lora: o.auto ? (loras.find((l) => l.collected >= o.minCollected) ?? null) : undefined });
        cur = useCosplay.getState().items.find((x) => x.key === k)!;
      }
      up(await writePrompt(cur, cosplayer, taste));
    } catch (e) {
      const msg = (e as Error).message;
      // the writer's own age stop counts as a skip, not an error
      up(/under 18|minor|adult/i.test(msg) ? { status: "skipped", why: msg.slice(0, 160) } : { status: "error", why: msg.slice(0, 200) });
    }
  };
  let next = 0;
  const { writerOutside } = await import("./outside");
  const n = writerOutside() ? 1 : WORKERS; // the Grok tab answers one message at a time
  await Promise.all(Array.from({ length: Math.min(n, todo.length) }, async () => { while (next < todo.length) await one(todo[next++]); }));
}

/** approve a LoRA for a character (or none); remembered for next time */
export function approve(key: string, lora: Candidate | null) {
  useCosplay.getState().update(key, { lora, loraFile: undefined });
  const mem = load<Record<string, Candidate | "none">>(MEM, {});
  mem[key] = lora ?? "none";
  try { localStorage.setItem(MEM, JSON.stringify(mem)); } catch { /* */ }
}

/** the approved LoRA on this rental (downloaded once, then reused) */
async function loraFor(it: CosItem): Promise<LoraPick | null> {
  if (!it.lora) return null;
  if (it.loraFile) return it.loraFile;
  const r = await installLora(`https://civitai.com/models/${it.lora.model_id}?modelVersionId=${it.lora.version_id}`);
  if (r.status !== "done" || !r.name) throw new Error(`${it.name}: the LoRA didn't download (${r.error ?? "unknown error"})`);
  const pick: LoraPick = { name: r.name, strength: 0.9, trigger: r.trigger || it.lora.trigger || undefined };
  useCosplay.getState().update(it.key, { loraFile: pick });
  return pick;
}

/** step 5: one Batch row per ready character (with its LoRA and the chosen cosplayer) */
export async function toBatch(onStep?: (m: string) => void): Promise<number> {
  const { useBatch } = await import("./batch");
  const st = useCosplay.getState();
  let n = 0;
  for (const it of st.items.filter((x) => x.status === "ready" && x.prompt)) {
    onStep?.(it.lora ? `Getting ${it.name}'s LoRA…` : `Adding ${it.name}…`);
    const lp = await loraFor(it);
    // the LoRA's trigger words lead the prompt (when it was approved after the prompt was written)
    const prompt = lp?.trigger && !it.prompt!.toLowerCase().includes(lp.trigger.toLowerCase()) ? `${lp.trigger}, ${it.prompt}` : it.prompt!;
    useBatch.getState().add({ prompt, idea: `Cosplay · ${it.name}${it.series ? ` (${it.series})` : ""}`, takes: st.opts.takes, charId: st.opts.cosplayer === "one" && st.opts.charId ? st.opts.charId : undefined, noStar: st.opts.cosplayer !== "one", realistic: true, loras: lp ? [lp] : [] });
    n++;
  }
  return n;
}
