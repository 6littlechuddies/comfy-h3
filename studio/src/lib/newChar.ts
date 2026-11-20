// New characters from pictures — one, or many at once (pick results → New characters from these).
// Each picture is read (the writer looks at it and writes down hair, eyes, body, outfit, details — the character's
// description), its LoRAs come along, and how it was made (its prompt, the RECIPE) stays with the character.
// Cosplay results know whose cosplay they are: the character is named after them, and gets a near-twin name for your
// site (Makima → Makina). Several pictures of the same cosplay become ONE character; the others go into a free
// "Gallery" set for the site (unless you say not to).
import type { FileRef, CivitGen } from "./api";
import type { Media } from "./tray";
import type { Character } from "./characters";

/** "Cosplay · Makima (Chainsaw Man) · 2/3" → { name: "Makima", series: "Chainsaw Man" } */
export function cosplayOf(idea?: unknown): { name: string; series: string } | null {
  const m = typeof idea === "string" ? /^Cosplay · (.+?)(?: \(([^)]*)\))?(?: · \d+\/\d+)?$/.exec(idea) : null;
  return m ? { name: m[1].trim(), series: (m[2] ?? "").trim() } : null;
}

/** near-twin names for the site (the writer; a letter swap if it can't) */
export async function siteAlias(names: string[]): Promise<string[]> {
  const { useCharacters } = await import("./characters");
  const taken = useCharacters.getState().list.flatMap((c) => [c.name, c.site?.name ?? ""]).filter(Boolean);
  try {
    const { runWriter } = await import("./writer");
    const out = await runWriter("alias", { names: names.join("\n"), taken: taken.join(", ") || "(none)" }, { tab: "characters", label: "Site names" });
    const lines = out.split(/\n+/).map((l) => l.split("=>")[1]?.trim()).filter((x): x is string => !!x);
    return names.map((n, i) => { const a = (lines[i] || "").replace(/^["“]|["”]$/g, "").trim(); return a && a.toLowerCase() !== n.toLowerCase() ? a : twin(n); });
  } catch { return names.map(twin); }
}
/** a plain near-twin: the last vowel changed to its neighbour (Makima → Makimo, Power → Powar) */
function twin(n: string): string {
  const swap: Record<string, string> = { a: "e", e: "a", i: "y", o: "a", u: "o", y: "i" };
  const i = Math.max(...[...n.toLowerCase()].map((ch, k) => (swap[ch] ? k : -1)));
  if (i < 1) return `${n}e`;
  const rep = swap[n[i].toLowerCase()];
  return n.slice(0, i) + (n[i] === n[i].toUpperCase() ? rep.toUpperCase() : rep) + n.slice(i + 1);
}

/** read a picture: the writer describes the person in it. Refuses anyone who reads as under 18 */
export async function readPicture(pic: Media, tab: "characters" | "batch" = "characters"): Promise<Partial<Character>> {
  const [{ buildDescribeCharacter }, { useJobs, waitForJob }, { newSeed }, { parseExtracted }] = await Promise.all([import("./graphs"), import("./jobs"), import("./settings"), import("./characters")]);
  const job = await useJobs.getState().run(tab, "Reading the picture", buildDescribeCharacter(pic.name, newSeed()), "extract");
  const j = await waitForJob(job.id);
  const p = j.status === "done" ? parseExtracted(j.texts.character ?? "") : null;
  if (!p) throw new Error(j.error ?? "Couldn't read the picture — fill the details in by hand");
  if (p.age && p.age < 18) throw new Error("This picture may show someone under 18 — not imported");
  return p.age ? p : { ...p, age: 25 };
}

/** make the character: their picture as the front view, the picture's LoRAs, how it was made, a cosplay's names */
export async function createFromPicture(o: { pic: Media; gen: CivitGen | null; read: Partial<Character>; name?: string; siteName?: string; source?: string;
  gallery?: FileRef[]; onStep?: (m: string) => void }): Promise<Character> {
  const [{ useCharacters, newCharacter, charModel, familyOfModel, addToSiteSet }, { ensureLoras, lorasFor }] = await Promise.all([import("./characters"), import("./civitUse")]);
  const c = newCharacter({ ...o.read, name: o.name?.trim() || (o.read.name && o.read.name !== "Unnamed" ? o.read.name : "New character") });
  if (o.gen) {
    const fam = c.style === "realistic" ? "krea2" : familyOfModel(charModel(c));
    const want = lorasFor(o.gen, fam);
    if (want.length) { const { picks } = await ensureLoras(want, (m) => o.onStep?.(m)).catch(() => ({ picks: [] as never[] })); if (picks.length) c.loras = picks; }
    // how their picture was made stays with them (How it was made / RECIPE on their front picture)
    if (o.gen.page || o.gen.prompt) c.from = { page: o.gen.page, prompt: o.gen.prompt };
  }
  if (o.source) c.source = o.source;
  if (o.siteName) c.site = { ...c.site, name: o.siteName };
  useCharacters.getState().save(c);
  await useCharacters.getState().setView(c.id, "front", { filename: o.pic.name, subfolder: "", type: "input" }, { yours: true });
  for (const f of o.gallery ?? []) addToSiteSet(c.id, "Gallery", "free", f);
  return useCharacters.getState().list.find((x) => x.id === c.id) ?? c;
}

/** many results → characters: grouped by whose cosplay they are (the rest one each), read, named, recipe kept */
export async function charactersFromResults(its: { o: FileRef & { type: string }; label: string; idea?: unknown }[], opts: { gallery: boolean; onStep?: (m: string) => void }): Promise<{ made: Character[]; failed: string[] }> {
  const [{ useTray }, { fileGen }] = await Promise.all([import("./tray"), import("./api")]);
  const groups = new Map<string, typeof its>();
  for (const it of its) {
    const cos = cosplayOf(it.idea);
    const k = cos ? `cos:${cos.name.toLowerCase()}|${cos.series.toLowerCase()}` : `one:${it.o.subfolder}/${it.o.filename}`;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const keys = [...groups.keys()];
  const cosNames = keys.filter((k) => k.startsWith("cos:")).map((k) => cosplayOf(groups.get(k)![0].idea)!.name);
  opts.onStep?.(cosNames.length ? "Thinking of site names…" : "Reading the pictures…");
  const aliases = cosNames.length ? await siteAlias(cosNames) : [];
  const made: Character[] = [], failed: string[] = [];
  let ai = 0, n = 0;
  for (const k of keys) {
    const list = groups.get(k)!;
    const first = list[0];
    const cos = cosplayOf(first.idea);
    const alias = cos ? aliases[ai++] : undefined;
    try {
      opts.onStep?.(`Reading picture ${++n} of ${keys.length}${cos ? ` (${cos.name})` : ""}…`);
      const item = useTray.getState().addOutput(first.o as FileRef, first.label);
      if (!item) throw new Error("can't use that file");
      const pic = await useTray.getState().asMedia(item.id);
      const [read, gen] = await Promise.all([readPicture(pic), fileGen(pic).then((g) => (g.found ? g : null)).catch(() => null)]);
      const c = await createFromPicture({ pic, gen, read, name: cos?.name, siteName: alias, source: cos ? `Cosplay of ${cos.name}${cos.series ? ` (${cos.series})` : ""}` : undefined,
        gallery: opts.gallery ? list.slice(1).map((x) => ({ filename: x.o.filename, subfolder: x.o.subfolder, type: x.o.type as FileRef["type"] })) : [], onStep: opts.onStep });
      made.push(c);
    } catch (e) { failed.push(`${cos?.name ?? first.label}: ${(e as Error).message}`); }
  }
  return { made, failed };
}
