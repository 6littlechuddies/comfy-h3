// Batch → Cosplay: a list of characters (name + series) becomes realistic cosplay photos.
//   1. look the character up (AniList: age, description, the official picture)
//   2. adult check — skipped for good when a character is, or is drawn as, under 18 (the writer checks too)
//   3. find Krea 2 LoRAs for the character on CivitAI with your key, most collected first; you approve one (or it picks)
//   4. DeepSeek (the writer) describes the costume piece by piece and writes the Krea 2 prompt
//   5. "Add to batch" makes one Batch row per character
import { create } from "zustand";
import { pickFreshBlueprints, type BlueprintBankId } from "./blueprints";
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
  prompt?: string;             // the first shot's prompt (older lists had only one)
  shots?: Shot[];              // one prompt per picture, each its own pose, angle and setting
  loras?: Candidate[];         // CivitAI candidates, most collected first
  picks?: Candidate[];         // the approved CivitAI LoRAs — several allowed ([] = none, undefined = not decided yet)
  extra?: LoraPick[];          // your own LoRAs for this character (library, a link, Browse)
  ai?: LoraPick[];             // LoRAs from your library the writer picked and weighted for this character (you can change them)
  aiWhy?: Record<string, string>; // why it picked each one
  aiCheckpoint?: { name: string; why: string }; // the checkpoint it picked ("official" = Krea 2 as released); you can change it
  aiLocked?: Record<string, true>; // LoRAs you locked: kept at your strength on every rewrite, never changed or balanced away
  ckLocked?: boolean;          // the checkpoint is yours: a rewrite keeps it
  build?: string;              // its read of her build and figure (from the design, the LoRA's pictures and posts)
  files?: Record<number, LoraPick>; // approved LoRAs once on the rental, by version
  /** @deprecated one approved LoRA (older lists) — read through picksOf */
  lora?: Candidate | null;
  loraFile?: LoraPick | null;
}
export type CosplayVibe = "bold" | "selfie" | "glamour" | "editorial";
export const COSPLAY_VIBES: { id: CosplayVibe; label: string; hint: string; directive: string; banks: BlueprintBankId[] }[] = [
  {
    id: "bold",
    label: "3-Style Mix (Recommended)",
    hint: "Automatically rotates Upfront Magnetic Portraits, Amateur Bedroom/Mirror Selfies, and Creative CivitAI Pinups (zero repetitive template!)",
    directive: "VARIED COVER-ART MIX: Rotate freely across upfront waist-up magnetic portraits, lived-in amateur bedroom mirror/handheld selfies, and expressive dynamic candids — warm practical lighting, clean dry matte natural skin, natural relaxed arms, zero repetitive seated-leg or stiff standing templates.",
    banks: ["upfront_portrait", "raw_selfie", "mirror_choreo", "sexy_cosplay", "camera_glamour"],
  },
  {
    id: "selfie",
    label: "Candid Selfie & Mirror",
    hint: "Raw lived-in bedroom mirror phone selfies, arm's-length snaps, and late-night digicam flash candids in cosplay",
    directive: "CANDID SELFIE & MIRROR COSPLAY: Shoot like authentic lived-in bedroom mirror phone selfies, arm's-length smartphone snaps, and late-night compact digicam flash photos she took herself in full cosplay — warm bedroom lamp light, clean dry natural skin, subtle phone grain, zero stiff studio posing.",
    banks: ["raw_selfie", "mirror_choreo", "upfront_portrait"],
  },
  {
    id: "glamour",
    label: "Upfront Glamour Portrait",
    hint: "Close-in waist-up men's-magazine warmth, arms-up arches, bar/table leans, zipper/collar tease, and magnetic gaze",
    directive: "UPFRONT MAGNETIC GLAMOUR COSPLAY: Close-in waist-up / chest-up men's-magazine warmth — leaning across a bar or table, arms raised behind head, zipper/collar tease, clean dry matte natural skin with warm directional tungsten key light, rich costume texture, direct sultry eye contact.",
    banks: ["upfront_portrait", "camera_glamour", "sexy_cosplay"],
  },
  {
    id: "editorial",
    label: "Editorial World",
    hint: "Cinematic real-world locations evoking her canon story with varied camera geometry",
    directive: "EDITORIAL WORLD COSPLAY: Grounded cinematic location photography evoking her world — dramatic camera height changes, environmental depth, authentic practical/natural weather lighting, clean natural skin, varied candid expression.",
    banks: ["camera_glamour", "sexy_cosplay", "upfront_portrait"],
  },
];

export interface Shot { brief: string; pose: string; prompt: string; ref?: import("./posewear").PwPick }
export interface CosOpts { cosplayer: "one" | "each"; charId: string | null; auto: boolean; minCollected: number; takes: number;
  /** LoRAs on every cosplay picture (a realism or skin LoRA, say) */
  loras: LoraPick[];
  /** where the poses come from: the writer's mix, or your PoseWear picks (copied through their depth) */
  poses: "mix" | "posewear" | "library";
  /** cosplay photography & pose vibe (bold default fixes stiff convention photos) */
  vibe?: CosplayVibe;
  /** read the character LoRA's own Krea 2 posts for its costume wording */
  posts: boolean;
  collapsed: boolean;
  /** how the cosplayers look when "A new woman each" (e.g. "East Asian — Japanese, Korean or Chinese") */
  look: string;
  /** the writer picks LoRAs from your library for each character and sets their strength (the locked ones stay as they are) */
  director: boolean;
  /** which of the every-picture LoRAs you locked (kept at your strength, never balanced down); the rest can be turned down */
  lockedAll?: Record<string, true>;
}
/** the approved LoRAs, whichever way they were stored */
export const picksOf = (it: CosItem): Candidate[] | undefined => it.picks ?? (it.lora === undefined ? undefined : it.lora ? [it.lora] : []);

const KEY = "h3.cosplay";
const MEM = "h3.cosplay.loras"; // character key → the approved LoRA (or "none"), kept for next time
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } };
const keyOf = (name: string, series: string) => `${name}|${series}`.toLowerCase().replace(/\s+/g, " ").trim();

export const useCosplay = create<{ items: CosItem[]; opts: CosOpts; workers?: number; set: (p: Partial<{ items: CosItem[]; opts: CosOpts }>) => void; update: (key: string, p: Partial<CosItem>) => void }>((set, get) => ({
  items: load<{ items: CosItem[] }>(KEY, { items: [] }).items,
  opts: (() => {
    const saved = load<Partial<CosOpts> & { v?: number }>(KEY + ".opts", {});
    // v2: the PoseWear library is the default pose source (older saved settings had "words only")
    if ((saved.v ?? 1) < 2) { if (saved.poses === "mix") saved.poses = "library"; saved.v = 2; }
    return { cosplayer: "each", charId: null, auto: false, minCollected: 50, takes: 3, loras: [], poses: "library", vibe: "bold", posts: true, collapsed: false, look: "", director: false, ...saved } as CosOpts;
  })(),
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
  const mem = load<Record<string, Candidate | Candidate[] | "none">>(MEM, {});
  const add = parseList(text).filter((x) => !have.has(keyOf(x.name, x.series))).map((x): CosItem => {
    const k = keyOf(x.name, x.series); const m = mem[k];
    return { key: k, name: x.name, series: x.series, status: "new", picks: m === undefined ? undefined : m === "none" ? [] : Array.isArray(m) ? m : [m] };
  });
  st.set({ items: [...st.items, ...add] });
  return add.length;
}

/** every stated age is under 18 ("17", "16-17"); a canon adult version ("15 (Part 1), 19") counts as adult — the writer then
 *  plans that adult version. No age stated: not young (the writer judges from the story and design) */
const youngAge = (age: string) => { const ns = (age.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0 && n < 2000); return ns.length > 0 && ns.every((n) => n < 18); };

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

/** the same look-up for a character marked "Cosplay of …" on its own (her site profile): your Cosplay list's research when
 *  it has it, else AniList now. Throws when the source makes her under 18 — the same adult check as Batch → Cosplay. */
const canonCache = new Map<string, string>();
export async function canonFacts(source: string): Promise<string> {
  const m = /^Cosplay of (.+?)(?: \(([^)]*)\))?$/.exec(source.trim());
  if (!m) return "";
  const name = m[1].trim(), series = (m[2] ?? "").trim(), k = keyOf(name, series);
  if (canonCache.has(k)) return canonCache.get(k)!;
  const known = useCosplay.getState().items.find((x) => x.key === k || x.name.toLowerCase() === name.toLowerCase());
  if (known?.status === "skipped") throw new Error(`Stopped: ${name} ${known.why ? `— ${known.why.toLowerCase()}` : "is under 18 in the source"}. Only characters who are adults can be cosplayed here.`);
  const got = known?.notes ? { notes: known.notes, age: known.age } : await lookUp({ key: k, name, series, status: "new" });
  if (got.status === "skipped") throw new Error(`Stopped: ${name} — ${String(got.why ?? "under 18 in the source").toLowerCase()}. Only characters who are adults can be cosplayed here.`);
  const notes = (got.notes ?? "").trim();
  canonCache.set(k, notes);
  return notes;
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

// ---- variety: every picture in a batch gets its own camera angle, pose and place (none repeated until the lists run out) ----
const ANGLES = ["eye-level full-body shot, straight on", "three-quarter view from slightly below, full body", "side profile, medium shot", "from behind, she looks back over her shoulder",
  "low angle looking up at her, dramatic", "high angle from above, she looks up at the lens", "close-up portrait, head and shoulders, 85 mm", "waist-up medium shot", "wide environmental shot, she is small in the frame",
  "tilted dutch-angle action shot", "candid moment mid-movement, 35 mm", "seated, camera at her eye level", "knee-up shot, slightly off-centre"];
const POSES = ["standing confidently, one hand on her hip", "walking toward the camera mid-stride", "sitting on steps, leaning forward on her knees", "leaning back against a wall, arms crossed",
  "the character's signature action pose with her prop", "kneeling on one knee", "turning, the costume and wig in motion", "reaching one hand toward the lens", "crouching low, ready to spring",
  "sitting sideways on a chair, legs crossed", "laughing, playing with a strand of her wig", "arms raised, stretching", "resting her chin on her hand, thoughtful", "back to a railing, elbows on it"];
const PLACES = ["a convention hall, other cosplayers blurred behind", "a seamless studio backdrop in a colour from her costume", "a city street at night under neon signs",
  "a rooftop at golden hour", "an abandoned industrial building with broken windows", "a forest path in dappled sunlight", "a shrine with red torii gates", "a train platform at dusk", "a rainy alley with reflections",
  "a sunlit beach boardwalk", "a library with tall wooden shelves", "a cosy apartment by a big window", "a park under cherry blossoms", "a bare concrete stairwell in hard light", "a neon-lit arcade", "a desert road at sunset",
  "a snowy mountain trail", "a greenhouse full of plants", "an old European street with cobblestones", "a hotel corridor with warm lamps", "a subway car at night", "a field of tall grass at dawn", "a gothic church interior",
  "a harbour with boats and fog", "a karaoke room with coloured lights", "a ruined castle wall", "a misty bamboo grove", "a car park rooftop under sodium lights", "a laundromat at night", "a lakeside dock at sunrise",
  "a cluttered artist's studio", "a stadium tunnel", "a sunflower field", "a dim jazz bar", "a hospital-white minimalist room", "a carnival with lights at dusk", "a waterfall pool", "a rooftop garden in the city"];
/** half the shots are a place from the character's own world (named by the writer, a different spot each time) */
const WORLD = "a specific place from the character's own world — name it, and make it a different spot from the other shots (a room, street, landmark or landscape from their story), recreated as a real location";
const CLOSE = "close-up portrait, head and shoulders, 85 mm, the wig, makeup and lenses in sharp detail";
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
/** a dealer of shots for one run: angle, pose and place each walk their own shuffled list, so neighbours never match.
 *  Each character's first shot is a close-up; every other shot is set in the character's own world */
type PwPick = import("./posewear").PwPick;
export interface Brief { brief: string; ref?: PwPick; options?: PwPick[] }
/** a dealer of shots for one run. Angles and generic poses walk their own shuffled lists; every place is from the
 *  character's own world (the writer names them). With the PoseWear library, each character gets 8 poses no other
 *  character in the run gets, and the writer picks the ones that suit her — so no pose repeats across the batch */
function dealer(posePicks: PwPick[], library: PwPick[], vibeId: CosplayVibe = "bold") {
  const vibe = COSPLAY_VIBES.find((v) => v.id === vibeId) ?? COSPLAY_VIBES[0];
  const R = shuffle(posePicks);
  // Pre-deal distinct non-repeating CivitAI blueprints across Upfront Portrait, Amateur Mirror/Selfie, and Creative Candid!
  const upfrontPool = pickFreshBlueprints(["upfront_portrait"], 24, `cosplay:${vibe.id}:upfront`, 1);
  const selfiePool = pickFreshBlueprints(["raw_selfie", "mirror_choreo"], 24, `cosplay:${vibe.id}:selfie`, 1);
  const creativePool = pickFreshBlueprints(vibe.banks, 48, `cosplay:${vibe.id}:creative`, 1);
  let i = 0;
  return (k: number, shared?: PwPick[]): Brief => {
    const n = i++;
    const setting = vibe.id === "selfie"
      ? "a cozy lived-in bedroom, messy mirror dresser, or warm personal room (varied spot per shot)"
      : WORLD;
    if (k === 0) {
      const lead = upfrontPool[n % upfrontPool.length] ?? creativePool[n % creativePool.length];
      return { brief: `VIBE: ${vibe.directive} · STYLE: Upfront Magnetic Portrait · CAMERA & POSE: ${lead?.words ?? CLOSE} · SETTING: ${setting}` };
    }
    if (k === 1 && vibe.id === "bold") {
      const sf = selfiePool[n % selfiePool.length] ?? creativePool[n % creativePool.length];
      return { brief: `VIBE: ${vibe.directive} · STYLE: Authentic Amateur Mirror / Bedroom Selfie · CAMERA & POSE: ${sf?.words ?? CLOSE} · SETTING: a real lived-in bedroom mirror or cozy warm personal room` };
    }
    if (R.length) { const ref = R[n % R.length]; return { brief: `VIBE: ${vibe.directive} · POSE (copy exactly): ${ref.words} · SETTING: ${setting}`, ref }; }
    if (library.length && shared) return { brief: `VIBE: ${vibe.directive} · POSE: one of HER POSE OPTIONS, a different one from her other shots — answer its number as pose_id · SETTING: ${setting}`, options: shared };
    const bp = creativePool[n % creativePool.length];
    return { brief: `VIBE: ${vibe.directive} · CAMERA & POSE (follow this exact camera height, angle, and body choreography): ${bp?.words ?? ANGLES[n % ANGLES.length]} · SETTING: ${setting}` };
  };
}
/** the next poses from the library for one character (none of them dealt to anyone else in this run) */
function poseOptions(library: PwPick[], at: { i: number }, n: number): PwPick[] {
  // the next n in the shuffled library; it only comes round again once every pose has been handed out
  const out: PwPick[] = [];
  for (let j = 0; j < Math.min(n, library.length); j++) out.push(library[(at.i + j) % library.length]);
  at.i += out.length;
  return out;
}

/** wig words get drawn literally (a bald cap, a lace edge showing): her hair is just her hair */
export function cleanHair(p: string): string {
  return p.replace(/\s*(?:lace[- ]front(?:ed)?|wig cap|hairnet)\b/gi, "")
    .replace(/,?\s*(?:and\s+|with\s+)?(?:a\s+)?natural\s+(?:lace\s+)?hairline\b/gi, "")
    .replace(/\b(a|an|her|the)\s+((?:[\w-]+\s+){0,6})wig\b/gi, "$1 $2hair").replace(/\bwig\b/gi, "hair")
    .replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/,\s*,/g, ",");
}

/** the writer sometimes drops the shot's setting (or blurs it into "a soft background"): when none of the place's words
 *  made it into the prompt, the place is added plainly */
const STOP = new Set(["with", "from", "under", "behind", "other", "their", "colour", "costume", "blurred", "light", "lights", "pick", "one", "the", "and"]);
function withSetting(prompt: string, brief: string): string {
  const place = /SETTING: ([^·]+)/.exec(brief)?.[1]?.trim();
  if (!place || place.startsWith("a specific place")) return prompt;
  const words = place.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) ?? [];
  const low = prompt.toLowerCase();
  return words.some((w) => low.includes(w)) ? prompt : `${prompt.replace(/\s*$/, "")} Set in ${place}, the place clearly visible behind her.`;
}

/** how people prompt this character's LoRA on Krea 2: the most-liked example posts' words (costume and trigger wording) */
async function lorasPosts(it: CosItem): Promise<{ text: string; pics: string[] }> {
  const top = picksOf(it)?.[0] ?? it.loras?.[0];
  if (!top) return { text: "(no LoRA for this character)", pics: [] };
  try {
    const { civitImages } = await import("./api");
    const r = await civitImages(top.version_id, top.name);
    const good = r.items.filter((x) => !x.video && x.prompt && !minorWords(x.prompt).length).sort((a, b) => b.reactions - a.reactions);
    const seen = new Set<string>();
    const uniq = good.filter((x) => { const k = x.prompt.slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
    // what people pair this LoRA with (other LoRAs, checkpoints), counted over its most-liked posts
    const count = new Map<string, number>();
    for (const x of good.slice(0, 30)) for (const u of x.uses ?? []) { const k = u.replace(/ @[\d.]+$/, ""); count.set(k, (count.get(k) ?? 0) + 1); }
    const pairs = [...count.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} (in ${n} posts)`);
    const text = [uniq.length ? uniq.map((x, i) => `${i + 1}. ${x.prompt.replace(/\s+/g, " ").slice(0, 600)}${x.weight != null ? ` [this LoRA at ${x.weight}]` : ""}`).join("\n") : "(its posts have no prompts)",
      pairs.length ? `WHAT PEOPLE PAIR IT WITH: ${pairs.join("; ")}` : ""].filter(Boolean).join("\n");
    // two of its most-liked pictures for the writer to look at (her build as the LoRA makes her)
    return { text, pics: uniq.filter((x) => !x.explicit).slice(0, 2).map((x) => x.url) };
  } catch { return { text: "(couldn't read its posts)", pics: [] }; }
}

/** reference notes without the sentences that would stop the writer outright ("she lost her child", "at 12 years old she…"):
 *  backstory, not what's photographed. The writer still judges the character's own age from the rest and the picture */
const usableNotes = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).filter((x) => !minorWords(x).length).join(" ").trim();

/** step 4: the writer's adult check, costume and one prompt per shot */
async function writePrompt(it: CosItem, cosplayer: string, taste: string, briefs: Brief[], posts: string, library: string, locked: string, libNames: Set<string>, refPics: string[] = [], ckNames: Set<string> = new Set()): Promise<Partial<CosItem>> {
  const charT = (picksOf(it) ?? []).map((l) => l.trigger).filter(Boolean).join(", ");
  const otherT = (it.extra ?? []).map((l) => l.trigger ?? "").filter(Boolean).join(", ");
  const triggers = [charT && `CHARACTER (start of the prompt): ${charT}`, otherT && `OTHER (woven into her body / the photo's look): ${otherT}`].filter(Boolean).join(" · ");
  const opts = briefs.find((b) => b.options?.length)?.options ?? [];
  const shotsText = (opts.length ? `HER POSE OPTIONS (real pose references: the picture copies the chosen one's body position exactly — pick the ones that suit her personality and the place; never two shots with the same number):\n${opts.map((p, i) => `  ${i + 1}. ${p.words}${p.cat ? ` [${p.cat}]` : ""}`).join("\n")}\n\n` : "")
    + briefs.map((b, i) => `${i + 1}. ${b.brief}`).join("\n");
  const ask = () => runWriter("cosplay", { taste, posts, library, locked, shots: shotsText, character: it.name, series: it.series || "(not given)",
    cosplayer: cosplayer || `(none given: an adult woman, about 25 years old${useCosplay.getState().opts.look?.trim() ? `, ${useCosplay.getState().opts.look.trim()} — vary her face, hair and build from shot to shot within that` : ""})`, triggers: triggers || "(none)", notes: (it.notes && usableNotes(it.notes)) || "(nothing found — use what you know of the character)" },
    { tab: "batch", label: `Cosplay · ${it.name}`, images: [it.picture, ...refPics].filter((x): x is string => !!x).length ? [it.picture, ...refPics].filter((x): x is string => !!x) : undefined, big: true });
  const { looseJson } = await import("./looseJson");
  // an answer that can't be read even leniently (rare): ask once more before giving up on her
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let d: any;
  try { d = looseJson(await ask()); } catch { d = looseJson(await ask()); }
  if (!d.allowed) return { status: "skipped", age: d.age || it.age, why: d.why || "Not an adult character" };
  // older prompt files answer with one "prompt": treat it as the only shot
  const got: { pose?: string; prompt?: string; pose_id?: unknown }[] = Array.isArray(d.shots) ? d.shots : d.prompt ? [{ pose: d.pose, prompt: d.prompt }] : [];
  // the poses it chose from her options (a number it didn't give, or one already taken: the next unused option)
  const taken = new Set<number>();
  const refFor = (b: Brief | undefined, id: unknown): PwPick | undefined => {
    if (b?.ref) return b.ref;
    if (!b?.options?.length) return undefined;
    let n = Number(id) - 1;
    if (!(n >= 0 && n < b.options.length) || taken.has(n)) n = b.options.findIndex((_, j) => !taken.has(j));
    if (n < 0) return undefined;
    taken.add(n); return b.options[n];
  };
  const shots: Shot[] = got.filter((x) => x?.prompt).map((x, i) => { const g = x as { pose?: string; prompt?: string; pose_id?: unknown };
    const ref = refFor(briefs[i], g.pose_id);
    return { brief: ref && briefs[i]?.options ? `POSE: ${ref.title} · SETTING: her world` : briefs[i]?.brief ?? "", pose: String(g.pose ?? ""), prompt: cleanHair(withSetting(String(g.prompt), briefs[i]?.brief ?? "")), ref }; });
  if (!shots.length) throw new Error("The writer answered without prompts — try again");
  if (shots.some((x) => minorWords(x.prompt).length)) return { status: "skipped", why: "A prompt came back with under-18 words — not used" };
  // the writer's LoRA picks: only names from your library, strengths kept sensible
  type Pick = { name: string; strength?: number; why?: string };
  const chosen: Pick[] = libNames.size ? (Array.isArray(d.loras) ? d.loras : []).filter((l: Pick) => l?.name && libNames.has(l.name)).slice(0, 5) : [];
  const ai: LoraPick[] | undefined = libNames.size ? chosen.map((l) => ({ name: l.name, strength: Math.round(Math.min(1.5, Math.max(-1.5, Number(l.strength) || 0.6)) * 100) / 100 })) : undefined;
  const aiWhy = libNames.size ? Object.fromEntries(chosen.map((l) => [l.name, String(l.why ?? "")])) : undefined;
  const ck = d.checkpoint && typeof d.checkpoint === "object" ? d.checkpoint as { name?: string; why?: string } : null;
  const aiCheckpoint = ckNames.size && ck?.name && (ckNames.has(ck.name) || ck.name === "official") ? { name: ck.name, why: String(ck.why ?? "") } : undefined;
  return { status: "ready", age: d.age || it.age, outfit: d.outfit, wig: d.wig, eyes: d.eyes, props: d.props, pose: shots[0].pose, prompt: shots[0].prompt, shots,
    build: typeof d.build === "string" ? d.build : undefined, ...(ai ? { ai, aiWhy } : {}), ...(aiCheckpoint ? { aiCheckpoint } : {}) };
}

/** the writers working side by side: starts at WORKERS and adapts — one more each time a character comes back quickly
 *  and cleanly (up to MAX_WORKERS), half as many when DeepSeek or CivitAI push back (busy, rate limit, timeouts).
 *  DeepSeek bills per word, not per call, so more at once costs the same in total — it only finishes sooner. */
export const WORKERS = 6;
export const MAX_WORKERS = 16;
const pushback = (msg: string) => /\b(429|503|502|504)\b|rate|busy|timeout|Timeout|Couldn't reach/i.test(msg);

/** steps 1–4 for every character that isn't done — several at once, each its own writer job ("sub-agents"), all reading
 *  the same learned taste (worked out once, before they start) and dealt different shots */
export async function researchAll(cosplayer: string, only?: string) {
  const st = useCosplay.getState();
  const todo = st.items.filter((it) => (only ? it.key === only : it.status !== "ready" && it.status !== "skipped")).map((it) => it.key);
  if (!todo.length) return;
  const { tasteBlock } = await import("./promptBank");
  const who = st.opts.cosplayer === "one" ? st.opts.charId : null;
  const taste = await tasteBlock(who).catch(() => "(nothing learned yet)");
  const { posePicks } = await import("./posewear");
  const picksNow = st.opts.poses === "posewear" ? posePicks() : [];
  if (st.opts.poses === "posewear" && !picksNow.length) throw new Error("Poses are set to your PoseWear picks, but none are picked — Browse PoseWear first");
  // the PoseWear library (depth poses: Krea 2 copies them exactly): one person, your NSFW switch, never your hidden ones,
  // your starred ones first, the rest shuffled — and the kind of framing a cosplay photo uses
  let poseLib: PwPick[] = [];
  if (st.opts.poses === "library") {
    const pw = await import("./posewear");
    try {
      const ps = pw.usePoseWear.getState();
      const items = (await pw.loadLib("depths")).filter((x) => !x.couple && (ps.adult || !x.adult) && !ps.hidden[x.key]);
      const pick = (x: (typeof items)[number]) => pw.pickOf(x, Math.floor(Math.random() * Math.max(1, x.angles?.length ?? 1)));
      poseLib = [...shuffle(items.filter((x) => ps.favs[x.key])).map(pick), ...shuffle(items.filter((x) => !ps.favs[x.key])).map(pick)];
    } catch (e) { (await import("./jobs")).useJobs.getState().toast(`PoseWear library didn't load (${(e as Error).message}) — poses are written in words this time`, "bad", "batch"); }
  }
  const deal = dealer(picksNow, poseLib, st.opts.vibe ?? "bold");
  const libAt = { i: 0 };
  // your Krea 2 LoRAs the writer may choose from (not the locked ones, not other characters' LoRAs)
  let library = "(not used)", libNames = new Set<string>(), ckNames = new Set<string>();
  const locked = st.opts.loras?.length ? st.opts.loras.map((l) => `${l.name} @${l.strength}${st.opts.lockedAll?.[l.name] ? " (locked)" : " (on, strength may be lowered)"}`).join(", ") : "(none)";
  if (st.opts.director) {
    const { loraLibrary } = await import("./api");
    const lib = (await loraLibrary()).filter((l) => l.family === "krea2" && l.role !== "character" && !st.opts.loras?.some((x) => x.name === l.name));
    libNames = new Set(lib.map((l) => l.name));
    library = lib.length ? lib.map((l) => `- ${l.name} | ${l.title}${l.role ? ` | ${l.role}` : ""}${l.trigger ? ` | trigger: ${l.trigger}` : ""}${l.tips?.weight != null ? ` | creator's strength ${l.tips.weight_range ?? l.tips.weight}` : ""}`).join("\n") : "(no Krea 2 LoRAs downloaded)";
    // your Krea 2 checkpoints (fine-tunes) too: one per character, or the official model
    const { myModels } = await import("./api");
    const cks = (await myModels().catch(() => ({ items: [] as import("./api").MyModel[] }))).items.filter((m) => m.family === "krea2" && m.here);
    ckNames = new Set(cks.map((m) => m.name));
    if (cks.length) library += `\nCHECKPOINTS (pick one, or "official"):\n- official | Krea 2 as released\n${cks.map((m) => `- ${m.name} | ${m.title}${m.version ? ` (${m.version})` : ""}`).join("\n")}`;
  }
  const one = async (k: string) => {
    const up = (p: Partial<CosItem>) => useCosplay.getState().update(k, p);
    up({ status: "looking", why: undefined });
    try {
      const a = await lookUp(useCosplay.getState().items.find((x) => x.key === k)!);
      up(a);
      if (a.status === "skipped") return;
      let cur = useCosplay.getState().items.find((x) => x.key === k)!;
      if (picksOf(cur) === undefined || !cur.loras?.length) {
        const loras = await findLoras(cur);
        const o = useCosplay.getState().opts;
        up({ loras, ...(picksOf(cur) === undefined && o.auto ? { picks: loras.filter((l) => l.collected >= o.minCollected).slice(0, 1) } : {}) });
        cur = useCosplay.getState().items.find((x) => x.key === k)!;
      }
      const o = useCosplay.getState().opts;
      const lp = o.posts || o.director ? await lorasPosts(cur) : { text: "(not used)", pics: [] as string[] };
      const posts = o.posts ? lp.text : "(not used)";
      const refPics = (await Promise.all(lp.pics.map((u) => fetch("/studio-api/fetch-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u }) })
        .then((r) => (r.ok ? r.json() : null)).then((d) => d?.name as string | undefined).catch(() => undefined)))).filter((x): x is string => !!x);
      const shared = poseLib.length ? poseOptions(poseLib, libAt, 8) : undefined;
      const briefs = Array.from({ length: Math.max(1, o.takes) }, (_, k) => deal(k, shared));
      // your locked LoRAs for her (and every picture): the writer works around them and keeps their strength
      const mine = [...(cur.extra ?? []), ...(cur.ai ?? []).filter((l) => cur.aiLocked?.[l.name])];
      const lockedHere = [locked !== "(none)" ? locked : "", ...mine.map((l) => `${l.name} @${l.strength}${cur.aiLocked?.[l.name] ? " (locked)" : " (on, strength may be lowered)"}`)].filter(Boolean).join(", ") || "(none)";
      const bck = (await import("./batch")).useBatch.getState().ck;
      const ckFixed = cur.ckLocked || bck?.mode !== "auto"; // only "DeepSeek picks one for each character" lets it choose
      const ckHere = ckFixed ? new Set<string>() : ckNames;
      const lib = ckFixed ? library.split("\nCHECKPOINTS")[0] : library;
      const w = await writePrompt(cur, cosplayer, taste, briefs, posts, lib, lockedHere, libNames, refPics, ckHere);
      // a rewrite keeps what you locked: locked LoRAs first (your strength), then its new picks; your checkpoint stays
      const keep = (cur.ai ?? []).filter((l) => cur.aiLocked?.[l.name]);
      if (w.ai) w.ai = [...keep, ...w.ai.filter((l) => !keep.some((k) => k.name === l.name) && !(cur.extra ?? []).some((k) => k.name === l.name))];
      else if (keep.length) w.ai = keep;
      if (cur.ckLocked) delete w.aiCheckpoint;
      up(w);
    } catch (e) {
      const msg = (e as Error).message;
      // the writer's own age stop counts as a skip, not an error
      up(/^Stopped:/.test(msg) ? { status: "skipped", why: msg.slice(0, 160) } : { status: "error", why: msg.slice(0, 200) });
    }
  };
  let next = 0;
  const { writerOutside } = await import("./outside");
  if (writerOutside()) { for (const k of todo) await one(k); return; } // the Grok tab answers one message at a time
  // an adaptive pool: `want` workers at a time, raised on clean fast answers, halved on push-back
  let want = Math.min(WORKERS, todo.length), running = 0, slowest = 0;
  await new Promise<void>((done) => {
    const fill = () => {
      if (next >= todo.length && running === 0) { done(); return; }
      while (running < want && next < todo.length) {
        const k = todo[next++]; running++;
        const t0 = Date.now();
        void one(k).finally(() => {
          running--;
          const it = useCosplay.getState().items.find((x) => x.key === k);
          const secs = (Date.now() - t0) / 1000;
          if (it?.status === "error" && pushback(it.why ?? "")) want = Math.max(2, Math.floor(want / 2));
          else if (it?.status === "ready" && (slowest === 0 || secs < slowest * 1.5)) want = Math.min(MAX_WORKERS, want + 1);
          slowest = Math.max(slowest * 0.9, secs);
          useCosplay.setState({ workers: want });
          fill();
        });
      }
      useCosplay.setState({ workers: want });
    };
    fill();
  });
  useCosplay.setState({ workers: 0 });
}

/** turn one CivitAI LoRA on or off for a character (several can be on); null = none at all. Remembered for next time */
export function approve(key: string, lora: Candidate | null) {
  const it = useCosplay.getState().items.find((x) => x.key === key);
  if (!it) return;
  const cur = picksOf(it) ?? [];
  const picks = lora === null ? [] : cur.some((l) => l.version_id === lora.version_id) ? cur.filter((l) => l.version_id !== lora.version_id) : [...cur, lora];
  useCosplay.getState().update(key, { picks, lora: undefined, loraFile: undefined });
  const mem = load<Record<string, Candidate[] | Candidate | "none">>(MEM, {});
  mem[key] = picks.length ? picks : "none";
  try { localStorage.setItem(MEM, JSON.stringify(mem)); } catch { /* */ }
}

/** the approved LoRAs on this rental (each downloaded once, then reused) */
async function lorasFor(it: CosItem): Promise<LoraPick[]> {
  const out: LoraPick[] = [];
  for (const l of picksOf(it) ?? []) {
    const have = it.files?.[l.version_id] ?? (it.loraFile && it.lora?.version_id === l.version_id ? it.loraFile : null);
    if (have) { out.push(have); continue; }
    const r = await installLora(`https://civitai.com/models/${l.model_id}?modelVersionId=${l.version_id}`);
    if (r.status !== "done" || !r.name) throw new Error(`${it.name}: the LoRA "${l.name}" didn't download (${r.error ?? "unknown error"})`);
    const pick: LoraPick = { name: r.name, strength: 0.6, trigger: r.trigger || l.trigger || undefined };
    const now = useCosplay.getState().items.find((x) => x.key === it.key);
    useCosplay.getState().update(it.key, { files: { ...(now?.files ?? {}), [l.version_id]: pick } });
    out.push(pick);
  }
  return out;
}

/** step 5: one Batch row per shot of every ready character — its LoRAs, yours, the batch-wide ones, and the pose's depth */
export async function toBatch(onStep?: (m: string) => void): Promise<number> {
  const { useBatch, newGroup } = await import("./batch");
  const { controlFor } = await import("./posewear");
  const st = useCosplay.getState();
  const group = newGroup("Cosplay");
  // pressing Add twice doesn't double the batch: a shot already waiting in the batch isn't added again
  const waiting = new Set(useBatch.getState().rows.filter((r) => r.status !== "queued").map((r) => r.idea));
  let n = 0;
  for (const it of st.items.filter((x) => x.status === "ready" && (x.shots?.length || x.prompt))) {
    onStep?.(picksOf(it)?.length ? `Getting ${it.name}'s LoRAs…` : `Adding ${it.name}…`);
    const civ = await lorasFor(it);
    const seen = new Set<string>();
    const ai = st.opts.director ? it.ai ?? [] : (it.ai ?? []).filter((l) => it.aiLocked?.[l.name]);
    const loras = [...civ, ...(it.extra ?? []), ...ai, ...st.opts.loras].filter((l) => !seen.has(l.name) && !!seen.add(l.name));
    // never balanced away: everything you chose yourself (locked for every picture, your LoRAs for her, the picks you locked)
    // only what you locked keeps its strength; everything else may be turned down to fit
    const lockedNames = [...st.opts.loras.filter((l) => st.opts.lockedAll?.[l.name]), ...[...(it.extra ?? []), ...ai].filter((l) => it.aiLocked?.[l.name])].map((l) => l.name);
    const trig = loras.map((l) => l.trigger).filter((t): t is string => !!t);
    const civTrig = civ.map((l) => l.trigger).filter((t): t is string => !!t);
    const shots: Shot[] = it.shots?.length ? it.shots : [{ brief: "", pose: it.pose ?? "", prompt: it.prompt! }];
    for (const [i, sh] of shots.entries()) {
      // trigger words the prompt doesn't have yet (LoRAs picked after it was written): her character LoRA's lead the
      // prompt; body, realism and style ones go in after the first sentence, as a phrase — not a pile at the front
      const has = (t: string) => cleanHair(sh.prompt).toLowerCase().includes(t.toLowerCase());
      const lead = [...new Set(civTrig.filter((t) => !has(t)))];
      const rest = [...new Set(trig.filter((t) => !civTrig.includes(t) && !has(t)))];
      let prompt = cleanHair(sh.prompt);
      if (rest.length) { const m = /^(.+?[.!?])\s+(.*)$/s.exec(prompt); prompt = m ? `${m[1]} Her figure and look: ${rest.join(", ")}. ${m[2]}` : `${prompt} ${rest.join(", ")}.`; }
      if (lead.length) prompt = `${lead.join(", ")}, ${prompt}`;
      const control = sh.ref ? await controlFor(sh.ref).catch(() => undefined) : undefined;
      const idea = `Cosplay · ${it.name}${it.series ? ` (${it.series})` : ""}${shots.length > 1 ? ` · ${i + 1}/${shots.length}` : ""}`;
      if (waiting.has(idea)) continue;
      // your own pick for her (locked) always; DeepSeek's only when the batch's Checkpoint says it may pick
      const ckName = it.ckLocked || (st.opts.director && useBatch.getState().ck?.mode === "auto") ? it.aiCheckpoint?.name : undefined;
      useBatch.getState().add({ prompt, idea, takes: 1, status: "ready", group, pose: sh.ref, locked: lockedNames, ...(ckName ? { checkpoint: ckName, ckMine: !!it.ckLocked } : {}),
        charId: st.opts.cosplayer === "one" && st.opts.charId ? st.opts.charId : undefined, noStar: st.opts.cosplayer !== "one", realistic: true, loras, control });
      n++;
    }
  }
  return n;
}
