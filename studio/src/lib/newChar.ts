// New characters from pictures — one, or many at once (pick results → New characters from these).
// Each picture is read (the writer looks at it and writes down hair, eyes, body, outfit, details — the character's
// description), its LoRAs come along, and how it was made (its prompt, the RECIPE) stays with the character.
// Cosplay results know whose cosplay they are: the character is named after them here, and gets a site name fans connect to it for your
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
/** the same from a picture's label, for results whose job record is gone (restored from a drive): "Batch 30 · Makima
 *  (Chainsaw Man) · 1/4" — a Batch row named like a cosplay (a series in brackets), or one on your Cosplay list */
export async function cosplayOfLabel(label?: string): Promise<{ name: string; series: string } | null> {
  const m = /^Batch \d+ · (.+?)(?: \(([^)]*)\))?(?: · \d+\/\d+)?$/.exec(label ?? "");
  if (!m) return null;
  const name = m[1].trim(), series = (m[2] ?? "").trim();
  if (series) return { name, series };
  const { useCosplay } = await import("./cosplay");
  const hit = useCosplay.getState().items.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return hit ? { name: hit.name, series: hit.series } : null;
}

/** her site name: one a fan would connect to the character without it being the character's name — a near-twin (Makima →
 *  Makina), the meaning translated (Sakura → Blossom) or a shortening (Makima → Maki). The writer picks; a letter swap if it
 *  can't, or if what it gave is the exact name. */
export async function siteAlias(names: string[]): Promise<string[]> {
  const { useCharacters } = await import("./characters");
  const taken = useCharacters.getState().list.flatMap((c) => [c.name, c.site?.name ?? ""]).filter(Boolean);
  const used = new Set(taken.map((t) => t.toLowerCase()));
  const ok = (n: string, a: string) => !!a && !used.has(a.toLowerCase()) && !exact(n, a);
  const pick = (n: string, a: string) => { const r = ok(n, a) ? a : twinFree(n, used); used.add(r.toLowerCase()); return r; };
  try {
    const { runWriter } = await import("./writer");
    // the writer can be stuck behind other work (or still starting): after 90 s a plain near-twin is used instead
    const out = await Promise.race([runWriter("alias", { names: names.join("\n"), taken: taken.join(", ") || "(none)" }, { tab: "characters", label: "Site names" }),
      new Promise<string>((_, no) => setTimeout(() => no(new Error("the writer didn't answer in 90 s")), 90_000))]);
    const lines = out.split(/\n+/).map((l) => l.split("=>")[1]?.trim()).filter((x): x is string => !!x);
    return names.map((n, i) => pick(n, (lines[i] || "").replace(/^["“]|["”]$/g, "").trim()));
  } catch { return names.map((n) => pick(n, "")); }
}
/** the character's own name, or its first name, as is ("Makima", "Tifa" for "Tifa Lockhart") */
export function exact(n: string, a: string): boolean {
  const full = n.toLowerCase().replace(/\s*\(.*$/, "").trim(), x = a.toLowerCase().trim();
  return x === full || x === full.split(/\s+/)[0] || x.split(/\s+/)[0] === full.split(/\s+/)[0];
}
/** a plain near-twin (the last vowel changed: Makima → Makimo), not one already taken */
function twinFree(n: string, used: Set<string>): string {
  const base = n.replace(/\s*\(.*$/, "").split(/\s+/)[0];
  for (const [a, b] of [["a", "e"], ["e", "a"], ["i", "y"], ["o", "a"], ["u", "o"], ["y", "i"]]) {
    const i = base.toLowerCase().lastIndexOf(a);
    if (i < 1) continue;
    const t = base.slice(0, i) + (base[i] === base[i].toUpperCase() ? b.toUpperCase() : b) + base.slice(i + 1);
    if (!used.has(t.toLowerCase())) return t;
  }
  return `${base}e`;
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
export async function charactersFromResults(its: { o: FileRef & { type: string }; label: string; idea?: unknown; jobId?: string }[], opts: { gallery: boolean; onStep?: (m: string) => void; aliases?: Record<string, string> }): Promise<{ made: Character[]; failed: string[] }> {
  const [{ useTray }, { fileGen }] = await Promise.all([import("./tray"), import("./api")]);
  const groups = new Map<string, typeof its>();
  // whose cosplay each one is: from its job record, else from its label (results restored from a drive have no job record)
  const cosOf = new Map<(typeof its)[number], { name: string; series: string } | null>();
  for (const it of its) cosOf.set(it, cosplayOf(it.idea) ?? await cosplayOfLabel(it.label));
  for (const it of its) {
    const cos = cosOf.get(it);
    const k = cos ? `cos:${cos.name.toLowerCase()}|${cos.series.toLowerCase()}` : `one:${it.o.subfolder}/${it.o.filename}`;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const keys = [...groups.keys()];
  const cosNames = keys.filter((k) => k.startsWith("cos:")).map((k) => cosOf.get(groups.get(k)![0])!.name);
  opts.onStep?.(cosNames.length ? "Thinking of site names…" : "Reading the pictures…");
  // site names given by the caller (Cosplays names them all in one call first), else asked for here
  const given = opts.aliases ?? {};
  const aliases = !cosNames.length ? [] : cosNames.every((n) => given[n.toLowerCase()]) ? cosNames.map((n) => given[n.toLowerCase()]) : await siteAlias(cosNames);
  const made: Character[] = [], failed: string[] = [];
  let ai = 0, n = 0;
  for (const k of keys) {
    const list = groups.get(k)!;
    const first = list[0];
    const cos = cosOf.get(first) ?? null;
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
      // her pictures move into her project (they show under her on the left, and in the catalog under her name)
      const { moveResults } = await import("./move");
      moveResults(list.filter((x) => x.jobId).map((x) => ({ jobId: x.jobId!, filename: x.o.filename, subfolder: x.o.subfolder })), c.id);
    } catch (e) { failed.push(`${cos?.name ?? first.label}: ${(e as Error).message}`); }
  }
  return { made, failed };
}
