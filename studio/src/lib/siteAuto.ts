// Your site, hands-off: (1) fill a character's whole profile from everything made of them — their look, the prompts of
// their pictures, their set titles — keeping what you already wrote; (2) sort all their pictures into themed sets by
// what each picture shows, rated sfw (free) / suggestive / explicit (behind the paywall). Both go through the prompt
// writer you picked (27B, 9B or your Grok tab).
import { toInput, type FileRef } from "./api";
import { describe, useCharacters, type Character, type SiteItem, type SiteSet } from "./characters";
import { useJobs } from "./jobs";
import { runWriter } from "./writer";

const keyOf = (f: FileRef) => `${f.type}/${f.subfolder}/${f.filename}`;
const isPic = (name: string) => /\.(png|jpe?g|webp)$/i.test(name);
const isVid = (name: string) => /\.(mp4|webm|mov)$/i.test(name);

/** every picture of this character: what's in their site folders + every result made as them (Batch, Create, face pass) */
export function charPictures(c: Character): { file: FileRef; label?: string }[] {
  const out = new Map<string, { file: FileRef; label?: string }>();
  for (const s of c.site?.sets ?? []) for (const it of s.items) out.set(keyOf(it), { file: { filename: it.filename, subfolder: it.subfolder, type: it.type } });
  for (const j of useJobs.getState().jobs) {
    const m = (j.meta ?? {}) as Record<string, unknown>;
    const mine = m.charId === c.id || (m.toSet as { charId?: string } | undefined)?.charId === c.id || (m.faceFix as { character?: string } | undefined)?.character === c.id
      || (typeof j.label === "string" && c.name && j.label.includes(` · ${c.name}`));
    if (!mine || j.status !== "done") continue;
    // the face-passed copy replaces the raw one: only the job's final file
    for (const o of j.outputs) if (o.type === "output" && (isPic(o.filename) || isVid(o.filename))) out.set(keyOf(o), { file: { filename: o.filename, subfolder: o.subfolder, type: o.type }, label: j.label });
  }
  return [...out.values()];
}

/** the prompt a picture was made from (it's written inside the file), else a short look at it by the local writer */
async function promptOf(f: FileRef, look: boolean): Promise<string> {
  try {
    const r = await fetch("/studio-api/media-meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: f.filename, subfolder: f.subfolder, type: f.type }) });
    const d = await r.json() as { found?: boolean; prompt?: string };
    if (d.found && d.prompt?.trim()) return d.prompt.replace(/<lora:[^>]+>/gi, "").replace(/\s+/g, " ").trim();
  } catch { /* fall through */ }
  if (!look || !isPic(f.filename)) return "";
  try {
    const inp = await toInput(f);
    return await runWriter("read", { model: "krea2", focus: "all", people: "one person", detail: "short" }, { tab: "characters", label: "Looking at a picture to sort it", images: [inp.name], big: false });
  } catch { return ""; }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (k < items.length) { const i = k++; out[i] = await fn(items[i], i); } }));
  return out;
}

const json = (raw: string) => { const m = raw.match(/\{[\s\S]*\}/); if (!m) throw new Error("The writer didn't answer in the expected format — try again"); return JSON.parse(m[0]); };

// ------------------------------------------------------------------ 1. the whole profile
const FIELDS = ["bio", "greeting", "backstory", "personality", "persona"] as const;

/** fill the profile from their look + their pictures' prompts + set titles; what you already wrote stays unless `all` */
export async function fillProfile(c: Character, o: { all?: boolean; onStep?: (t: string) => void } = {}) {
  o.onStep?.("Reading their pictures…");
  const pics = charPictures(c).slice(-60);
  const prompts = (await pool(pics, 6, (p) => promptOf(p.file, false))).filter(Boolean);
  const seen = new Set<string>();
  const uniq = prompts.map((p) => p.slice(0, 260)).filter((p) => { const k = p.slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
  const site = c.site ?? {};
  const filled = o.all ? [] : FIELDS.filter((k) => (site[k] ?? "").trim());
  const notes = [
    describe(c), c.block && `Full look: ${c.block}`, c.personality && `Personality notes: ${c.personality}`, c.details && `Details: ${c.details}`, `Style: ${c.style}`,
    uniq.length && `PICTURES MADE OF THEM (${uniq.length}):\n${uniq.map((p) => `- ${p}`).join("\n")}`,
    site.sets?.length && `SITE SETS: ${site.sets.map((s) => `${s.title} (${s.tier})`).join(", ")}`,
    filled.length && `ALREADY FILLED (keep exactly):\n${filled.map((k) => `${k}: ${site[k]}`).join("\n")}${!o.all && site.tags?.length ? `\ntags: ${site.tags.join(", ")}` : ""}`,
  ].filter(Boolean).join("\n\n");
  o.onStep?.("Writing the profile…");
  const raw = await runWriter("site", { character: `${c.name}, ${c.age}, ${c.gender}`, notes }, { tab: "characters", label: `${c.name}: writing the site profile`, meta: { charId: c.id } });
  const d = json(raw) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string).trim() : "");
  const cur = useCharacters.getState().list.find((x) => x.id === c.id) ?? c;
  const s0 = cur.site ?? {};
  const next = { ...s0 };
  for (const k of FIELDS) if (o.all || !(s0[k] ?? "").trim()) next[k] = str(k) || s0[k];
  if (o.all || !s0.tags?.length) next.tags = Array.isArray(d.tags) ? (d.tags as unknown[]).map(String).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10) : s0.tags;
  useCharacters.getState().save({ ...cur, site: next });
  return { pictures: uniq.length, filled: FIELDS.filter((k) => next[k] !== s0[k]).length };
}

// ------------------------------------------------------------------ 2. sort into sets
const RANK = { sfw: 0, suggestive: 1, explicit: 2 } as const;
type Rating = keyof typeof RANK;
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "set";

/** group every picture of theirs into themed sets: sfw → a free set, suggestive / explicit → the premium set of that theme */
export async function sortIntoSets(c: Character, o: { look?: boolean; onStep?: (t: string) => void } = {}): Promise<{ pictures: number; sets: number; skipped: number }> {
  const pics = charPictures(c);
  if (!pics.length) throw new Error(`No pictures of ${c.name} yet — make some (Batch → Content plan), or add them to a folder`);
  let n = 0;
  const prompts = await pool(pics, 6, async (p) => { const t = await promptOf(p.file, o.look ?? true); o.onStep?.(`Reading pictures… ${++n}/${pics.length}`); return t; });
  const known = pics.map((p, i) => ({ ...p, prompt: prompts[i] })).filter((p) => p.prompt);
  const skipped = pics.length - known.length;
  const label: Record<number, { set: string; rating: Rating }> = {};
  const blurbs: Record<string, string> = {};
  const CHUNK = 30;
  for (let start = 0; start < known.length; start += CHUNK) {
    const part = known.slice(start, start + CHUNK);
    o.onStep?.(`Sorting ${start + 1}–${start + part.length} of ${known.length}…`);
    const titles = [...new Set(Object.values(label).map((x) => x.set))];
    const raw = await runWriter("sort", {
      character: `${c.name} — ${describe(c)}`, existing: titles.join(" | ") || "(none yet)",
      pictures: part.map((p, i) => `#${i + 1}: ${p.prompt.slice(0, 420)}`).join("\n"),
    }, { tab: "characters", label: `${c.name}: sorting pictures into sets (${start + 1}–${start + part.length})`, big: true, meta: { charId: c.id } });
    const d = json(raw) as { pictures?: { n: number; set: string; rating: string }[]; sets?: Record<string, string> };
    for (const x of d.pictures ?? []) {
      const i = Number(x.n) - 1;
      if (i < 0 || i >= part.length || !x.set) continue;
      label[start + i] = { set: String(x.set).trim().slice(0, 60), rating: (x.rating in RANK ? x.rating : "suggestive") as Rating };
    }
    Object.assign(blurbs, d.sets ?? {});
  }
  // build the sets: one free + one premium per theme, keeping your prices and descriptions on sets that already existed
  const cur = useCharacters.getState().list.find((x) => x.id === c.id) ?? c;
  const old = cur.site?.sets ?? [];
  const sets = new Map<string, SiteSet>();
  known.forEach((p, i) => {
    const l = label[i];
    if (!l) return;
    const tier = l.rating === "sfw" ? "free" : "premium";
    const k = `${tier}|${l.set.toLowerCase()}`;
    const was = old.find((s) => s.tier === tier && s.title.toLowerCase() === l.set.toLowerCase());
    const s = sets.get(k) ?? { set_key: was?.set_key ?? `${tier}-${slug(l.set)}-${Date.now().toString(36)}`, title: l.set, description: was?.description || blurbs[l.set] || "", tier, price: was?.price, rating: "sfw" as Rating, items: [] as SiteItem[] };
    s.items.push({ ...p.file, rating: l.rating });
    if (RANK[l.rating] > RANK[s.rating]) s.rating = l.rating;
    sets.set(k, s);
  });
  // pictures it couldn't read stay where they were
  const placed = new Set(known.filter((_, i) => label[i]).map((p) => keyOf(p.file)));
  const leftovers: SiteSet[] = [];
  for (const s of old) {
    const items = s.items.filter((it) => !placed.has(keyOf(it)));
    if (!items.length) continue;
    const same = sets.get(`${s.tier}|${s.title.toLowerCase()}`);
    if (same) same.items.push(...items); else leftovers.push({ ...s, items });
  }
  const all = [...[...sets.values()].sort((a, b) => (a.tier === b.tier ? b.items.length - a.items.length : a.tier === "free" ? -1 : 1)), ...leftovers];
  useCharacters.getState().save({ ...cur, site: { ...cur.site, sets: all } });
  return { pictures: placed.size, sets: sets.size, skipped };
}
