import { looseJson } from "./looseJson";
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

/** ages written into a profile ("25-year-old", "aged 25", "25 y/o"): the site sets the age itself and refuses text with one */
export const hasAge = (t?: string) => !!t && /\b\d{2}\s*-?\s*(year|yr)s?[- ]?old\b|\baged? \d{2}\b|\b\d{2} ?y\/?o\b/i.test(t);
export function stripAges(t: string): string {
  return t
    .replace(/\b(is|she's|he's|was|being)\s+\d{2}\s*(?:years?|yrs?)[- ]?old\b/gi, (_m, v: string) => `${v} an adult`)
    .replace(/\b(an?)\s+\d{2}\s*-?\s*(?:years?|yrs?)[- ]?old\b\s*/gi, (_m, art: string) => (art[0] === "A" ? "A " : "a "))
    .replace(/\b\d{2}\s*-?\s*(?:years?|yrs?)[- ]?old\b/gi, "adult")
    .replace(/\s*,?\s*\baged?\s+\d{2}\b/gi, "")
    .replace(/\s*,?\s*\b\d{2}\s?y\/?o\b/gi, "")
    .replace(/\b([Aa]) ([aeiouAEIOU])/g, (_m, a: string, v: string) => (a === "A" ? "An " : "an ") + v)
    .replace(/ {2,}/g, " ").replace(/ ([,.!?])/g, "$1").replace(/,,/g, ",").trim();
}

/** every picture of this character: what's in their site folders, every result made as them in this browser (Batch, Create,
 *  Edit, face pass), and every file on the rental in their project folder or noted as theirs — also from earlier rentals */
export async function charPictures(c: Character): Promise<{ file: FileRef; label?: string }[]> {
  const out = new Map<string, { file: FileRef; label?: string }>();
  // the rental's own list of results: their project folder (Create, Edit, Batch… made while they were picked) + files noted as theirs
  type Item = { filename: string; subfolder: string; type: string; tab?: string; folder?: string; meta?: { character?: string; project?: string; label?: string } };
  const page = async (q: string) => {
    const all: Item[] = [];
    for (let off = 0; off < 3000; off += 500) {
      const r = await fetch(`/studio-api/catalog?${q}&limit=500&offset=${off}`).then((x) => (x.ok ? x.json() : null)).catch(() => null) as { items?: Item[]; total?: number } | null;
      if (!r?.items?.length) break;
      all.push(...r.items);
      if (all.length >= (r.total ?? 0)) break;
    }
    return all;
  };
  // every name they've had (their name follows their look until you name them) — and their id, which never changes
  const folderName = (n: string) => n.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 60);
  const names = [...new Set([c.name, ...(c.names ?? [])].map((n) => (n || "").trim()).filter(Boolean))];
  const folders = new Set(names.map(folderName));
  const found: Item[] = [];
  found.push(...await page(`folder=${encodeURIComponent([`@${c.id}`, ...folders].join("\n"))}`));
  found.push(...await page(`q=${encodeURIComponent(c.id.toLowerCase())}`));
  for (const n of names) found.push(...await page(`q=${encodeURIComponent(n.toLowerCase())}`));
  for (const it of found) {
    if (it.tab === "characters" || /(^|\/)(_work|face|refs)(\/|$)/.test(it.subfolder) && it.tab !== "create" && it.tab !== "edit" && it.tab !== "batch") continue; // sheet views and helper files aren't content
    const lab = it.meta?.label ?? "";
    const theirs = folders.has(it.folder ?? "") || it.meta?.project === c.id || names.includes((it.meta?.character ?? "").trim())
      || names.some((n) => lab.includes(` · ${n}`) || lab.startsWith(`${n} `));
    if (!theirs || !(isPic(it.filename) || isVid(it.filename))) continue;
    out.set(keyOf(it as FileRef), { file: { filename: it.filename, subfolder: it.subfolder, type: "output" }, label: it.meta?.label });
  }
  for (const s of c.site?.sets ?? []) for (const it of s.items) out.set(keyOf(it), { file: { filename: it.filename, subfolder: it.subfolder, type: it.type } });
  for (const j of useJobs.getState().jobs) {
    const m = (j.meta ?? {}) as Record<string, unknown>;
    const mine = m.charId === c.id || m.project === c.id || (m.toSet as { charId?: string } | undefined)?.charId === c.id || (m.faceFix as { character?: string } | undefined)?.character === c.id
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (raw: string) => looseJson<any>(raw);

// ------------------------------------------------------------------ 1. the whole profile
const FIELDS = ["bio", "greeting", "backstory", "personality", "persona", "voice", "quirks", "opinions", "flaw", "summary",
  "tagline", "occupation", "statusLine", "voiceLine", "hobbies", "ethnicity", "language", "likes", "setting", "relationship", "scenario", "inBed"] as const;
/** the site's limits on its short cells (longer is refused or cut) */
const CAP: Partial<Record<(typeof FIELDS)[number], number>> = { tagline: 120, occupation: 40, statusLine: 40, hobbies: 80, ethnicity: 40, language: 40 };
const TEXTING: Record<string, string[]> = { texts: ["one", "one_or_two", "two", "two_or_three"], length: ["short", "medium", "long"], emoji: ["none", "rare", "some", "often"],
  casing: ["lowercase", "lowercase_names", "sentence"], slang: ["none", "some", "lots"], swearing: ["none", "light", "heavy"], exclaim: ["rare", "bubbly"],
  questions: ["rarely", "sometimes", "most"], tone: ["sweet", "playful", "bratty"], forward: ["waits", "steers"], goodbye: ["lets_go", "resists_once"], useName: ["never", "sometimes"] };
const VOICES = ["matilda", "jessica", "lily", "sarah", "laura", "bella", "alice"];
/** clock times ("2am", "at midnight", "11:30") — the site tells her his real time on every message, so a fixed hour reads wrong */
const CLOCK = /\b(\d{1,2}(:\d{2})?\s?(am|pm|a\.m\.|p\.m\.)|\d{1,2}:\d{2}|midnight|noon)\b/i;

// The writer kept giving everyone the same hometown (Seattle / "the Pacific Northwest" / "the west coast"). Each profile now
// gets a few places drawn at random from all over — places other characters already use left out — to pick from, plus a
// couple of typing styles and inner details to choose from. It picks what fits her pictures; the rest is ignored.
const PLACES = [
  "Tucson, Arizona", "Savannah, Georgia", "Duluth, Minnesota", "El Paso, Texas", "New Orleans", "Pittsburgh", "Albuquerque", "Detroit", "Miami (Little Havana)",
  "Nashville", "Baltimore", "Boise, Idaho", "Las Vegas", "Chicago's South Side", "rural Kentucky", "Queens, New York", "Salt Lake City", "Honolulu",
  "Anchorage", "Charleston, South Carolina", "Kansas City", "Milwaukee", "San Antonio", "Atlanta", "Oklahoma City", "Providence, Rhode Island",
  "Montreal", "Toronto", "Winnipeg", "Halifax", "Mexico City", "Guadalajara", "San Juan, Puerto Rico", "Havana", "Bogota", "Medellin", "Buenos Aires",
  "Sao Paulo", "Rio de Janeiro", "Santiago, Chile", "Lima", "Manchester", "Glasgow", "Dublin", "Cardiff", "Lyon", "Marseille", "Barcelona", "Seville",
  "Lisbon", "Naples", "Milan", "Berlin", "Hamburg", "Vienna", "Prague", "Krakow", "Budapest", "Bucharest", "Kyiv", "Riga", "Stockholm", "Copenhagen",
  "Amsterdam", "Athens", "Istanbul", "Tel Aviv", "Beirut", "Dubai", "Cairo", "Casablanca", "Lagos", "Nairobi", "Cape Town", "Johannesburg", "Mumbai",
  "Bangalore", "Kolkata", "Colombo", "Bangkok", "Chiang Mai", "Ho Chi Minh City", "Manila", "Cebu", "Jakarta", "Bali", "Kuala Lumpur", "Singapore",
  "Seoul", "Busan", "Osaka", "Tokyo (Shimokitazawa)", "Sapporo", "Taipei", "Hong Kong", "Shanghai", "Melbourne", "Perth", "Brisbane", "Auckland",
  "a military family that moved every two years", "a truck-stop town in Nevada", "a ski town in Colorado", "a farm outside Des Moines", "a Gulf Coast oil town",
];
const TYPING = [
  "all lowercase, barely any punctuation, 'lol' and 'lmao' used as commas",
  "proper grammar and full stops, dry one-liners, almost never uses emoji",
  "stretches words when she's excited ('stoppp', 'sooo'), one emoji at most",
  "sends short bursts of two or three messages instead of one long one",
  "trails off with '...' and a lot of 'hmm', thinks out loud",
  "CAPS for emphasis on single words, otherwise calm",
  "old-school emoticons like :) and :P instead of emoji",
  "chatty and long, run-on sentences, tangents in brackets",
  "terse and teasing, answers questions with questions",
  "drops in words from her first language (only if she grew up with one)",
  "lots of emoji, but always the same three favourites",
  "British/Australian spelling and slang (only if she's from there)",
  "types like she talks, 'ok so', 'wait', 'literally'",
  "formal and polite at first, gets messier the more comfortable she gets",
];
const INNER = [
  "a contradiction (tough outside, sentimental about one specific thing)", "a small thing she's oddly good at", "a pet peeve she brings up",
  "a comfort habit at 2am", "a goal she's embarrassed to say out loud", "a very specific taste (a band, a snack, a show) she'll defend",
  "how she shows she likes someone", "what makes her go quiet", "a running joke she starts with people", "a thing she collects",
];
const pick = <T,>(a: T[], n: number) => [...a].sort(() => Math.random() - 0.5).slice(0, n);
/** hometowns that are worn out (or already used by your other characters) — kept out of new profiles */
const STALE = /\b(seattle|portland|tacoma|olympia|spokane|bellingham|pacific northwest|pnw|west coast|oregon|washington state|puget sound)\b/i;

const LENGTH_RULE = /\b(keep (it|things|messages|replies|your (replies|messages|answers))? ?(brief|short|concise)|short (replies|messages|answers|texts)|(one|two|1|2|a few|1-2|one or two|one to (two|three)) (short )?(sentences?|lines?)( (max|at most|long))?|match (their|his|the other person's|the user's) (length|energy and length)|(reply|replies|messages?|answers?|texts?) (are|stay|should be|kept) (short|brief|concise)|under \d+ words|concise)\b/i;
/** sentences that set how long her messages are — the site refuses them in a persona */
export const stripLength = (t: string) => (LENGTH_RULE.test(t) ? t.split("\n").map((line) => line.split(/(?<=[.!?])[ \t]+/).filter((x) => !LENGTH_RULE.test(x)).join(" ")).join("\n").trim() : t);

/** the random starting points for one profile: places (not ones your other characters use), typing styles, inner details */
function sparkNote(othersText: string): string {
  const free = PLACES.filter((p) => !othersText.toLowerCase().includes(p.split(/[,(]/)[0].trim().toLowerCase()));
  return [
    `PLACES to choose her background from (pick the one that fits her look and pictures best, or another specific place that fits better — never the Pacific Northwest, Seattle, Portland or "the west coast"; where she grew up and where she lives now can differ): ${pick(free, 5).join(" | ")}`,
    `TYPING STYLES to consider for how she texts (use one only if it fits who she is — otherwise write her own): ${pick(TYPING, 3).join(" | ")}`,
    `INNER DETAILS to give her (choose two, make them specific to her): ${pick(INNER, 4).join(" | ")}`,
  ].join("\n");
}

/** fill the profile from their look + their pictures' prompts + set titles; what you already wrote stays unless `all` */
/** a character still named after her look ("Black Bangs Hair · Black Lace") gets a real first name before anything is
 *  written about her — otherwise the profile and persona say "You are Black Bangs Hair · Black Lace" */
export async function ensureName(c: Character, onStep?: (t: string) => void): Promise<Character> {
  const { autoNamed, suggestNames } = await import("../components/SiteLink");
  if (!autoNamed(c)) return c;
  onStep?.("Giving her a name first…");
  try {
    const [x] = await suggestNames([c]);
    const cur = useCharacters.getState().list.find((y) => y.id === c.id) ?? c;
    if (x?.name) {
      // anything already written with the old name takes the new one
      const site = { ...(cur.site ?? {}) } as Record<string, unknown>;
      for (const [k, v] of Object.entries(site)) if (typeof v === "string" && v.includes(cur.name)) site[k] = v.split(cur.name).join(x.name);
      const next = { ...cur, name: x.name, site: site as typeof cur.site };
      useCharacters.getState().save(next); return next;
    }
  } catch { /* writes with the old name rather than not at all */ }
  return useCharacters.getState().list.find((y) => y.id === c.id) ?? c;
}

export async function fillProfile(c: Character, o: { all?: boolean; onStep?: (t: string) => void; again?: boolean; deep?: boolean } = {}): Promise<{ pictures: number; filled: number }> {
  o.onStep?.("Reading their pictures…");
  const pics = (await charPictures(c)).slice(-60);
  const prompts = (await pool(pics, 6, (p) => promptOf(p.file, false))).filter(Boolean);
  const seen = new Set<string>();
  const uniq = prompts.map((p) => p.slice(0, 260)).filter((p) => { const k = p.slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
  const site = c.site ?? {};
  const filled = o.all ? [] : FIELDS.filter((k) => (site[k] ?? "").trim());
  // the other characters' profiles: this one has to be clearly different (they kept coming out alike)
  const others = useCharacters.getState().list.filter((x) => x.id !== c.id && (x.site?.bio || x.site?.backstory))
    .slice(0, 12).map((x) => `- ${x.name}: ${stripAges(`${x.site?.bio ?? ""} ${(x.site?.backstory ?? "").split(/(?<=\.)\s/)[0] ?? ""}`).slice(0, 220)}`);
  const notes = [
    site.direction?.trim() && `OWNER'S DIRECTION (build the whole profile on this; it wins over guesses): ${site.direction.trim()}`,
    stripAges(describe(c)), canonNote(c.source) || (c.source && `Where she comes from: ${c.source} (inspired by it — never named after it or claiming to be that character)`), c.block && `Full look: ${stripAges(c.block)}`, c.frame?.prompt && `The prompt their look was made from: ${stripAges(c.frame.prompt).slice(0, 600)}`, c.personality && `Personality notes: ${c.personality}`, c.details && `Details: ${c.details}`, `Style: ${c.style}`,
    uniq.length && `PICTURES MADE OF THEM (${uniq.length}):\n${uniq.map((p) => `- ${stripAges(p)}`).join("\n")}`,
    site.sets?.length && `SITE SETS: ${site.sets.map((s) => `${s.title} (${s.tier})`).join(", ")}`,
    sparkNote(others.join(" ")),
    others.length && `OTHER CHARACTERS ON THE SITE (make this one clearly different from them — another hometown, job, voice and story):\n${others.join("\n")}`,
    filled.length && `ALREADY FILLED (keep exactly):\n${filled.map((k) => `${k}: ${k === "persona" && site.personaCore ? site.personaCore : site[k]}`).join("\n")}${!o.all && site.tags?.length ? `\ntags: ${site.tags.join(", ")}` : ""}`,
  ].filter(Boolean).join("\n\n");
  // a few of their pictures for the writer to look at (their front view, and some of their photos): when the connected
  // Grok tab sees pictures, or with the local writer — text only when Grok writes but doesn't see pictures
  const { grokSees, writerOutside } = await import("./outside");
  let images: string[] | undefined;
  if (!writerOutside() || grokSees()) {
  c = await ensureName(c, o.onStep);
    o.onStep?.("Picking pictures to look at…");
    const picks: FileRef[] = [c.views.front, c.views.face].filter(Boolean) as FileRef[];
    const step = Math.max(1, Math.floor(pics.length / 3));
    for (let i = 0; i < pics.length && picks.length < 5; i += step) if (isPic(pics[i].file.filename)) picks.push(pics[i].file);
    images = (await Promise.all(picks.map((f) => toInput(f).then((x) => x.name).catch(() => "")))).filter(Boolean);
  }
  o.onStep?.("Writing the profile…");
  const raw = await runWriter("site", { character: `${c.name}, adult, ${c.gender}`, notes: notes + (images?.length ? `\n\nPICTURES ATTACHED: ${images.length} photos of ${c.name} (the first is their reference look). Read them closely — style, setting, mood, clothes, the vibe of their photo feed — and let the profile match what fans will see. Name the aesthetics you can see and build on them: an outfit that is a recognisable thing (a maid dress, a school-style blazer worn as an adult, a cosplay, gym wear, office wear), a makeup style (e-girl: heavy blush across the nose, winged liner, drawn-on hearts or freckles; clean girl; goth; gyaru), hair (dyed split, wolf cut), and the scene they belong to (alt, cosplay, gamer, fitness, soft girl). Her job, hobbies and the people around her should fit that world.` : "") },
    { tab: "characters", label: `${c.name}: writing the site profile`, meta: { charId: c.id }, ...(images?.length ? { images } : {}) });
  let d: Record<string, unknown>;
  try { d = json(raw) as Record<string, unknown>; } catch (e) { if (o.again) throw e; d = {}; } // cut off / not JSON: written again below
  // still the Pacific Northwest (and the owner didn't ask for it): written once more with that said plainly
  const stale = (x: Record<string, unknown>) => FIELDS.some((k) => typeof x[k] === "string" && STALE.test(x[k] as string) && !STALE.test(site.direction ?? "") && !(filled as readonly string[]).includes(k));
  if (Object.keys(d).length && stale(d)) {
    o.onStep?.("Writing the profile again (another hometown)…");
    const again = await runWriter("site", { character: `${c.name}, adult, ${c.gender}`, notes: `${notes}\n\nNOT the Pacific Northwest: no Seattle, Portland, Oregon, Washington state or "west coast" anywhere. Use one of the PLACES above.` },
      { tab: "characters", label: `${c.name}: writing the site profile`, meta: { charId: c.id }, ...(images?.length ? { images } : {}) }).catch(() => "");
    try { const d2 = json(again) as Record<string, unknown>; if (!stale(d2)) d = d2; } catch { /* keep the first */ }
  }
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string).trim() : "");
  const cur = useCharacters.getState().list.find((x) => x.id === c.id) ?? c;
  const s0 = cur.site ?? {};
  const next = { ...s0 };
  for (const k of FIELDS) if (o.all || !(s0[k] ?? "").trim()) next[k] = str(k) || s0[k];
  // the site refuses any stated age (it sets the age itself): taken out of everything, whoever wrote it
  for (const k of FIELDS) if (next[k]) next[k] = stripAges(next[k]!);
  // …and a persona that sets her message length ("keep it brief"): the site sets length from her texting style
  if (next.persona) next.persona = stripLength(next.persona);
  // the deep profile runs when this pass wrote her persona — or her persona is there but was never made deep (older ones)
  const wrotePersona = (!!next.persona && next.persona !== s0.persona) || (!!next.persona && s0.deepAt === undefined);
  if (next.persona !== s0.persona) { next.personaCore = next.persona; next.deepAt = undefined; }
  for (const k of FIELDS) { const cap = CAP[k]; if (cap && next[k] && next[k]!.length > cap) next[k] = next[k]!.slice(0, cap).replace(/\s+\S*$/, ""); }
  const strs = (v: unknown, max: number, len = 60) => Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter(Boolean).map((x) => x.slice(0, len)).slice(0, max) : [];
  const keep = <T,>(cur: T | undefined, got: T | undefined, has: (x: T) => boolean) => (o.all || !cur || !has(cur)) && got && has(got) ? got : cur;
  next.people = keep(s0.people, Array.isArray(d.people) ? (d.people as Record<string, unknown>[]).filter((x) => x && typeof x === "object" && x.name)
    .map((x) => ({ name: String(x.name).slice(0, 40), relation: String(x.relation ?? "").slice(0, 40), note: stripAges(String(x.note ?? "")).slice(0, 160) })).slice(0, 3) : undefined, (x) => x.length > 0);
  const lv = strs(d.levels, 7, 24);
  next.levels = keep(s0.levels, lv.length === 7 && !lv.some((x) => AGE.test(x)) ? lv : undefined, (x) => x.length === 7);
  next.signatureWords = keep(s0.signatureWords, strs(d.signatureWords, 6, 30), (x) => x.length > 0);
  next.signatureEmojis = keep(s0.signatureEmojis, strs(d.signatureEmojis, 3, 8), (x) => x.length > 0);
  const tx = d.texting && typeof d.texting === "object" ? Object.fromEntries(Object.entries(d.texting as Record<string, unknown>).map(([k, v]) => [k, String(v).trim()]).filter(([k, v]) => TEXTING[k]?.includes(v))) : {};
  next.texting = keep(s0.texting, Object.keys(tx).length ? tx : undefined, (x) => Object.keys(x).length > 0);
  const sv = String(d.speechVoice ?? "").trim().toLowerCase();
  next.speechVoice = keep(s0.speechVoice, VOICES.includes(sv) ? sv : undefined, (x) => !!x);
  // a fixed hour in what she says reads wrong when he opens the chat at noon: written once more without it
  const clockIn = (["greeting", "statusLine", "scenario"] as const).filter((k) => next[k] && CLOCK.test(next[k]!) && next[k] !== s0[k]);
  if (clockIn.length && !o.again) o.onStep?.(`Note: ${clockIn.join(", ")} mention${clockIn.length > 1 ? "" : "s"} a clock time — the site reads it as his real time; edit it if it matters`);
  if (o.all || !s0.tags?.length) next.tags = Array.isArray(d.tags) ? (d.tags as unknown[]).map(String).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10) : s0.tags;
  useCharacters.getState().save({ ...cur, site: next });
  // the site won't take her without a bio and a persona: an answer that missed them (cut off, or not JSON) is written once more
  const missing = (["bio", "persona", "greeting"] as const).filter((k) => !(next[k] ?? "").trim());
  if (missing.length) {
    if (o.again) throw new Error(`The writer left her ${missing.join(", ")} empty twice — write it in her profile, or try again`);
    o.onStep?.(`Writing again (the ${missing.join(", ")} came back empty)…`);
    // (the deep profile waits until the retry has filled the rest)
    const r = await fillProfile(useCharacters.getState().list.find((x) => x.id === c.id) ?? c, { ...o, all: false, again: true, deep: false });
    if (wrotePersona && (o.deep ?? deepOn())) await deepProfile(useCharacters.getState().list.find((x) => x.id === c.id) ?? c, { onStep: o.onStep }).catch((e) => o.onStep?.(`Deep profile skipped: ${(e as Error).message}`));
    return r;
  }
  // the deep profile (on by default): when this pass wrote her persona
  if (wrotePersona && (o.deep ?? deepOn())) {
    try { await deepProfile(useCharacters.getState().list.find((x) => x.id === c.id) ?? c, { onStep: o.onStep }); }
    catch (e) { o.onStep?.(`Deep profile skipped: ${(e as Error).message}`); }
  }
  return { pictures: uniq.length, filled: FIELDS.filter((k) => next[k] !== s0[k]).length };
}

// ------------------------------------------------------------------ 1b. the deep profile
/** on by default: after the profile, her life, reactions, sample texts and a critic pass (2–3 min per character) */
export const deepOn = () => { try { return localStorage.getItem("h3.site.deep") !== "0"; } catch { return true; } };
export const setDeepOn = (v: boolean) => { try { localStorage.setItem("h3.site.deep", v ? "1" : "0"); } catch { /* */ } };

const TAIL = "\n\nOutput only the section(s), starting with the heading. Plain text, no preamble, no notes. No ages or numbers for age. Never state how long her messages are.";
const REACT_A = ['Bare "hey" opener:', "Crude opener:", "Compliment on her looks:", "He returns after a week of silence:", "He goes quiet mid-chat:", "He is needy or wants constant reassurance:", "He brags:",
  "He sincerely asks if she is real or an AI: (she never claims to be human; she admits it plainly in her own voice, without a speech, and stays herself)"];
const REACT_B = ["He had a bad day: (she reacts as a friend, not a counsellor; no advice lists)", "He has good news:", "Disagreement he won't drop: (she holds her view, or changes the subject on her terms; never sulks to punish)",
  "He mentions another girl: (a flicker of jealousy as humour at most; never guilt, never asking him to choose)", "He texts while she's busy with her day:",
  "He asks for pictures or a voice note: (she likes sending him what she's up to and does, in her own way and mood; never prices or trades anything, and never mentions a site, page, profile or app)", "He wants to meet or move to another app: (playful deflection, no promises, no lies)"];
const reactTask = (labels: string[], first: boolean) => `Write ${first ? 'the section "HOW YOU REACT"' : 'more lines for the section "HOW YOU REACT" (no heading this time)'}. For each label below write ONE line, 15-22 words, second person, describing her attitude and move in that moment - specific to HER temperament, not what any nice girl would do. No quoted example lines. No two lines may share the same move. At least ${first ? "three" : "two"} must involve teasing, pushback or having her own opinion. Keep the labels exactly:\n${labels.map((l) => `- ${l}`).join("\n")}\nHer warmth never depends on him spending, staying or proving anything.`;
/** HOW YOU SOUND as a description of her register — never written-out example messages: a worked example gets copied
 *  almost word for word in chats (the site refuses personas with "You: …" lines for that reason) */
export const SOUND_TASK = `Write the section "HOW YOU SOUND": a description of her texting register, 180-230 words, as 8-10 bullets in second person ("You…"). Describe, never demonstrate: NO example messages, NO quoted lines, NO "Him:" or "You:" lines, nothing she could copy word for word.
Cover, specific to HER (casing, punctuation, emoji habits, typos, abbreviations from WHO SHE IS):
- the rhythm: when she sends one message and when a burst of short ones, and how a burst hangs together;
- how she pushes back when she disagrees and doesn't back down;
- how tiredness or irritation about her own life leaks into her texts;
- how she double-texts after a silence — light, never reproachful;
- how she teases;
- how a rare sincere moment looks and how she covers it right after;
- the kind of questions she asks (curious, about his life, never an interview);
- which parts of her life she drifts back to (from her life section), and how she brings them up.
No phrase of three or more words used twice. Never mention her avatar, profile, pictures, an app or a site, or anything digital.`;
/** the passes after the first one (planned by the advisor): life, reactions in two halves (a small writer drops items past ~10), sample texts */
export const DEEP_PASSES: { key: string; label: string; task: string }[] = [
  { key: "life", label: "Writing her life between chats…", task: `Write the section "HER LIFE RIGHT NOW" in second person ("You..."), 180-220 words, as four short labelled paragraphs:
Week: what an ordinary week looks like - work or study as an adult, hours, where she is when she texts, one routine she loves and one she dreads.
People: three named people (e.g. a friend, a relative, a coworker or flatmate), each with one specific trait and one current friction or running joke.
Storylines: three unfinished things going on now - one small and funny, one mildly stressful, one she is quietly excited about. Leave each open-ended so it can develop over weeks; no dates.
Moods: what makes her chatty, what makes her quiet or snappy, and how each shows in her texting (she never announces a mood, it leaks).
Everything must fit her hometown, backstory and job. Use concrete nouns (a named street food, a specific app, a broken object), not generalities. Do not mention the user here.` },
  { key: "react1", label: "Writing how she reacts (1/2)…", task: reactTask(REACT_A, true) },
  { key: "react2", label: "Writing how she reacts (2/2)…", task: reactTask(REACT_B, false) },
  { key: "samples", label: "Describing how she texts…", task: SOUND_TASK },
];
export const DEEP_CRITIC = `You are the editor. Return the FINAL persona, complete, 900-1100 words, with exactly these headings in this order: WHO YOU ARE / HER LIFE RIGHT NOW / HOW YOU REACT / HOW YOU SOUND / NEVER SAY. Keep everything that is specific; do not summarise or shorten sections that are already good. Fix only these:
1. Assistant-speak or therapist tone (offering help, validating, "I understand", tidy advice) - rewrite as a person texting.
2. Generic lines any character could say - replace with a detail from her life.
3. Sameness with OTHER CHARACTERS (same job, hobby, quirk, opening move, verbal tic) - change hers.
4. Any statement about how long or short her messages are - delete it.
5. Any age, number implying age, school-age wording - delete or reword as an adult.
6. Contradictions with her hometown, backstory, people or typing style - make consistent.
7. Anything tying her warmth to him paying, subscribing, buying, staying, or proving he cares; guilt, threats to leave, discouraging his other relationships - delete.
8. HOW YOU SOUND must DESCRIBE her register in bullets, never demonstrate it: delete any example message, quoted line, or "Him:" / "You:" line and describe what it showed instead. Vary repeated phrases.
9. Anything that points at the medium (avatar, profile, pictures on a page, pixels, the app or site, being digital) - rewrite it as something from her real life. Only the real-or-AI line may say she isn't human.
10. Random poetic lines - rewrite them as how a real woman texts.
11. Stock lines every character ends up saying - "earn it", "not tonight", "maybe later", "you still owe me", "tell me something real", "what's on your mind", "talk to me", "hey yourself" - and any clock time ("2am", "midnight") - rewrite in her own words, as a situation not an hour.
Then write NEVER SAY: 6-8 bullets, 40-60 words, kinds of things she would never say (assistant phrases, claiming to be human when sincerely asked, pressure about money or loyalty) plus 2-3 cliches specific to HER that she would find cringe. Nothing about message length.`;
const NEVER_DEFAULT = "NEVER SAY\n- Anything about an avatar, profile, pictures on a page, the app or site, or being digital.\n- Help-desk or therapist phrases (offering assistance, \"I understand how you feel\").\n- Claiming to be human when he sincerely asks.\n- Anything about him paying, subscribing or proving he cares.\n- Pet names on repeat.\n- Summaries of what he just said.";

// checks on the result (advisor's list): assistant-speak and length rules are cut out; age or money pressure means "do it again"
const ASSIST = /as an ai|language model|how (can|may) i (help|assist)|i'?m here (to help|for you)|feel free to|i understand (that|how)|i apologi[sz]e|great question|happy to help|let me know if|is there anything else|it'?s important to|certainly[!,]|i'?d be (happy|glad) to/i;
const AGE = /\b(1\d|[2-9]\d)\b(?![:%.,]?\d)(?= ?(y\/?o|years?|yrs?)\b)|years?[- ]old|\by\/?o\b|\bteen|school ?girl|high[- ]?school|barely legal|underage|freshman|sophomore|\bminor\b/i;
/** words that give away the medium (she's a person, not a profile): redo the part when they turn up outside the real-or-AI line */
const META = /\b(avatar|pfp|profile (pic|picture|photo)|my (bio|profile|page)|on (here|this app|the site|my page)|this (app|site|platform)|pixel(ated|s)?|subscriber|digital (girl|person|me)|virtual (girl|girlfriend)|generated)\b/i;
const MONEY = /subscri|unlock|\btips?\b|tipping|\bbuy\b|purchase|\bpay\b|ppv|\$\d|if you (really )?(cared|loved|liked)|prove (it to me|you care|that you)|you'?ll lose me|i'?ll (leave|disappear|hurt myself)|don'?t talk to (her|them|other)/i;
const cutSentences = (t: string, re: RegExp) => t.split("\n").map((line) => line.split(/(?<=[.!?])\s+/).filter((x) => !re.test(x)).join(" ")).join("\n");
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
/** a phrase of three or more words used twice in the sample texts = a catchphrase she'd repeat forever */
const repeats3 = (t: string) => { const w = t.toLowerCase().replace(/^(him|you):/gm, "").match(/[a-z']+/g) ?? []; const seen = new Set<string>(); for (let i = 0; i + 2 < w.length; i++) { const k = w.slice(i, i + 3).join(" "); if (seen.has(k) && !/^(i don't|you know|i'm not|it's a|i was|in the|of the)/.test(k)) return true; seen.add(k); } return false; };

/** a cosplay character ("Cosplay of Makima (Chainsaw Man)"): her PERSONALITY is that character's — temperament, how she
 *  talks, quirks, what she wants, how she treats people — but she is a real woman who cosplays her: her life, places, job,
 *  people and history are her own and real-world, with nothing from the source (no place, organisation, event, item, power or
 *  person from it), and the character's and series' names never appear on the site. */
export function canonNote(source?: string): string {
  const m = /^Cosplay of (.+)$/.exec(source ?? "");
  if (!m) return "";
  return `HER PERSONALITY IS ${m[1].toUpperCase()}'S — think it through from the source material first (the anime, manga, game or comics: how she acts across the story, what she says and how, what she wants, fears and loves, how she treats people she likes and people she doesn't). Give her that character's temperament, way of talking (sentence length, formality, teasing or bluntness, verbal habits — paraphrased into her own texting, never quoting lines from the show), quirks, tastes, values, pet peeves and contradictions, and the same way she flirts or holds people at arm's length.
HER LIFE IS HER OWN: she is a real adult woman who loves cosplaying that character — she is NOT the character and never claims to be. Her job, home, city, hobbies, friends and backstory are ordinary real-world ones that suit her temperament. Nothing from the source in them: no place, city, school, organisation, team, rank, event, item, power, creature or other character from that story, not even renamed. Never write the character's or the series' name, or a near-copy of either, in her bio, tagline, greeting, persona, level names or anything else.`;
}

/** the deep profile: her life, how she reacts (two halves), sample texts, then the editor. Each is a separate small call.
 *  When the editor's answer is cut short or loses a section, the parts are put together as they are (with its NEVER SAY). */
export async function deepProfile(c: Character, o: { onStep?: (t: string) => void } = {}): Promise<void> {
  c = await ensureName(c, o.onStep);
  const cur0 = useCharacters.getState().list.find((x) => x.id === c.id) ?? c;
  const site = cur0.site ?? {};
  const core = site.personaCore?.trim() || site.persona?.trim() || "";
  if (!core) return;
  const who = [`Name: ${cur0.name}. Adult woman.`, stripAges(describe(cur0)), canonNote(cur0.source), site.direction && `Owner's direction: ${site.direction}`, site.bio && `Bio: ${site.bio}`,
    site.backstory && `Backstory: ${site.backstory}`, site.personality && `Traits: ${site.personality}`, site.voice && `How she texts: ${site.voice}`, site.quirks && `Texting habits: ${site.quirks}`,
    site.opinions && `Opinions: ${site.opinions}`, site.flaw && `Flaw: ${site.flaw}`, site.greeting && `Her first message: ${site.greeting}`].filter(Boolean).join("\n");
  const call = (task: string, draft: string, label: string) => runWriter("deep", { task: task + TAIL, character: who, draft: draft || "(nothing yet)" }, { tab: "characters", label: `${cur0.name}: ${label}`, meta: { charId: c.id } }).catch(() => "");
  const got: Record<string, string> = {};
  const draftNow = () => [`WHO YOU ARE\n${core}`, got.life, [got.react1, got.react2].filter(Boolean).join("\n")].filter(Boolean).join("\n\n");
  for (const p of DEEP_PASSES) {
    o.onStep?.(p.label);
    let out = (await call(p.task, draftNow(), p.label.replace(/…$/, "").toLowerCase())).trim();
    // a catchphrase in the samples, or age / money talk anywhere: written once more
    if (out && (AGE.test(out) || MONEY.test(out) || META.test(out) || (p.key === "samples" && repeats3(out)))) {
      o.onStep?.(`${p.label.replace(/…$/, "")} again (fixing a repeat or a rule)…`);
      const again = (await call(p.task, draftNow(), p.label.replace(/…$/, "").toLowerCase())).trim();
      if (again && !AGE.test(again) && !MONEY.test(again) && !META.test(again)) out = again;
    }
    if (words(out) > 40) got[p.key] = out;
  }
  const react = [got.react1, got.react2].filter(Boolean).join("\n").replace(/\n(?=HOW YOU REACT)/g, "");
  const parts = [`WHO YOU ARE\n${core}`, got.life, react, got.samples].filter(Boolean) as string[];
  const joined = parts.join("\n\n");
  const others = useCharacters.getState().list.filter((x) => x.id !== c.id && (x.site?.summary || x.site?.bio)).slice(0, 3)
    .map((x) => `- ${x.name}: ${stripAges(x.site?.summary || x.site?.bio || "").split(/\s+/).slice(0, 25).join(" ")}`).join("\n");
  const draft = joined + (others ? `\n\nOTHER CHARACTERS (she must not resemble them):\n${others}` : "");
  // the editor, checked: long enough, every heading there, the "real or AI" line kept, no age or money talk — else once more cooler, else the parts as they are
  const good = (t: string) => words(t) >= words(joined) * 0.8 && !hasExamples(t) && ["WHO YOU ARE", "HER LIFE", "HOW YOU REACT", "HOW YOU SOUND", "NEVER SAY"].every((h) => t.includes(h))
    && /real or an ai|real or ai|\bai\b/i.test(t) && !AGE.test(t) && !MONEY.test(t.split("NEVER SAY")[0]) && !META.test(t.split("NEVER SAY")[0]);
  o.onStep?.("Editing it (the critic)…");
  let fin = (await call(DEEP_CRITIC, draft, "editing the deep profile")).trim();
  if (!good(fin)) { o.onStep?.("Editing it again…"); fin = (await call(DEEP_CRITIC + "\nBe careful to keep every section complete.", draft, "editing the deep profile")).trim(); }
  let persona: string;
  if (good(fin)) persona = fin;
  else {
    const never = fin.includes("NEVER SAY") ? fin.slice(fin.indexOf("NEVER SAY")).trim() : NEVER_DEFAULT;
    persona = `${joined}\n\n${never}`;
  }
  // last checks: help-desk phrases and length rules cut (not in NEVER SAY, where they're listed on purpose)
  const at = persona.indexOf("NEVER SAY");
  const body = at >= 0 ? persona.slice(0, at) : persona, tail = at >= 0 ? persona.slice(at) : "";
  persona = stripLength(stripAges(cutSentences(body, ASSIST))).trim() + (tail ? `\n\n${tail.trim()}` : "");
  const cur = useCharacters.getState().list.find((x) => x.id === c.id) ?? cur0;
  useCharacters.getState().save({ ...cur, site: { ...cur.site, personaCore: core, persona, deepAt: Date.now() } });
}

/** written-out example messages ("You: …", "Him: …") — the site refuses them (they get copied word for word) */
export const hasExamples = (t: string) => /^\s*(?:-\s*)?(?:you|him|her|me|he|she)\s*:/im.test(t);
/** a persona with example messages: its HOW YOU SOUND rewritten as a description of her register (the rest kept) */
export async function describeNotDemonstrate(c: Character, onStep?: (t: string) => void): Promise<boolean> {
  const p = c.site?.persona ?? "";
  if (!hasExamples(p)) return false;
  onStep?.("Rewriting how she sounds as a description (the site won't take example messages)…");
  const at = p.indexOf("HOW YOU SOUND"), end = p.indexOf("NEVER SAY");
  const before = at >= 0 ? p.slice(0, at) : p.replace(/^\s*(?:-\s*)?(?:you|him)\s*:.*$/gim, "").trim() + "\n\n";
  const after = end > at && at >= 0 ? p.slice(end) : at >= 0 ? "" : "";
  const examples = at >= 0 ? p.slice(at, end > at ? end : undefined) : "";
  const who = `Name: ${c.name}. Adult woman.\n${stripAges(describe(c))}`;
  let sound = (await runWriter("deep", { task: SOUND_TASK + TAIL + "\nThe draft's HOW YOU SOUND has example messages — turn what they show into the description.", character: who, draft: `${before}\n${examples}` },
    { tab: "characters", label: `${c.name}: how she sounds`, meta: { charId: c.id } }).catch(() => "")).trim();
  if (!sound || hasExamples(sound)) sound = examples.split("\n").filter((l) => !/^\s*(?:-\s*)?(?:you|him|her|me|he|she)\s*:/i.test(l) && !/These show rhythm/i.test(l)).join("\n").trim();
  if (!/^HOW YOU SOUND/.test(sound)) sound = `HOW YOU SOUND\n${sound.replace(/^HOW YOU SOUND\s*/i, "")}`;
  // nothing left once the examples are out: what's known about how she texts
  if (sound.replace(/^HOW YOU SOUND\s*/i, "").trim().length < 20) sound = `HOW YOU SOUND\n${[c.site?.voice && `- ${c.site.voice}`, c.site?.quirks && `- ${c.site.quirks}`].filter(Boolean).join("\n") || "- Short, natural texts in your own style; you never repeat a line you've sent before."}`;
  const persona = `${before.trim()}\n\n${sound.trim()}${after ? `\n\n${after.trim()}` : ""}`.replace(/^\s*(?:-\s*)?(?:you|him)\s*:.*$/gim, "").replace(/\n{3,}/g, "\n\n").trim();
  const cur = useCharacters.getState().list.find((x) => x.id === c.id) ?? c;
  useCharacters.getState().save({ ...cur, site: { ...cur.site, persona } });
  return true;
}

// ------------------------------------------------------------------ 2. sort into sets
const RANK = { sfw: 0, suggestive: 1, explicit: 2 } as const;
type Rating = keyof typeof RANK;
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "set";

/** group every picture of theirs into themed sets: sfw → a free set, suggestive / explicit → the premium set of that theme */
export async function sortIntoSets(c: Character, o: { look?: boolean; onStep?: (t: string) => void } = {}): Promise<{ pictures: number; sets: number; skipped: number }> {
  const pics = await charPictures(c);
  if (!pics.length) throw new Error(`No pictures of ${c.name} found — pictures count when they were made with ${c.name} picked (Create, Edit, Batch) or are in their project folder`);
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
