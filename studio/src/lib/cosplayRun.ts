// Cosplays, all in one go: every cosplay picture in your results (found by its Batch label, "Batch 30 · Makima (Chainsaw
// Man) · 1/4"), grouped by whose cosplay it is → one character each (made from her first picture if she doesn't exist yet,
// named for your site), her profile + deep persona + chat lines written, her newest picture as her main picture (card,
// pinned for an animated cover). Nothing is sent: you look them over in Cosplays, click each one's main picture, then Send.
import { create } from "zustand";
import type { FileRef } from "./api";
import { useCharacters, type Character } from "./characters";
import { cosplayOfLabel } from "./newChar";

export type CosPic = FileRef & { label: string; mtime: number };
export type CosGroup = { key: string; name: string; series: string; pics: CosPic[] };

export const useCosplays = create<{ open: boolean; groups: CosGroup[]; status: Record<string, string>; running: boolean; scanned: number; stop: boolean;
  /** the run's progress: how many characters are through, of how many, and which one is being worked on */ done: number; total: number; now: string | null;
  /** every character being worked on right now (several run at once) */ working: string[];
  /** how many characters run at once (the writing and testing is DeepSeek calls, so several at a time is fine) */ atOnce: number;
  /** when the current step started (shown as a timer, so a long step visibly isn't frozen) */ since: number }>(() => ({
  open: false, groups: [], status: {}, running: false, scanned: 0, stop: false, done: 0, total: 0, now: null, since: 0, working: [],
  atOnce: (() => { try { return Math.max(1, Math.min(8, Number(localStorage.getItem("h3.cos.atOnce")) || 4)); } catch { return 4; } })(),
}));
export function setAtOnce(n: number) { useCosplays.setState({ atOnce: n }); try { localStorage.setItem("h3.cos.atOnce", String(n)); } catch { /* */ } }
export const openCosplays = () => useCosplays.setState({ open: true });
const say = (key: string, t: string | null) => useCosplays.setState((s) => { const st = { ...s.status }; if (t) st[key] = t; else delete st[key]; return { status: st, since: t && t !== s.status[key] ? Date.now() : s.since }; });
/** waits for a step, but gives up the moment Stop is pressed (the step itself may still finish in the background) */
function untilStop<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((ok, no) => {
    const t = setInterval(() => { if (useCosplays.getState().stop) { clearInterval(t); no(new Error("Stopped")); } }, 300);
    p.then((v) => { clearInterval(t); ok(v); }, (e) => { clearInterval(t); no(e); });
  });
}

export const keyOf = (name: string, series: string) => `${name.toLowerCase()}|${series.toLowerCase()}`;
/** the character already made for this cosplay: "Cosplay of Makima (Chainsaw Man)" on her, or her name */
export function charFor(g: { name: string; series: string }, list = useCharacters.getState().list): Character | undefined {
  const n = g.name.toLowerCase();
  return list.find((c) => { const m = /^Cosplay of (.+?)(?: \((.*)\))?$/.exec(c.source ?? ""); return m ? m[1].toLowerCase() === n && (!g.series || !m[2] || m[2].toLowerCase() === g.series.toLowerCase()) : false; })
    ?? list.find((c) => c.name.toLowerCase() === n && /cosplay/i.test(c.source ?? ""));
}

/** the name a character goes by: a cosplay's site name ("Maki"), else her own */
export const shownName = (c: Character) => (/^Cosplay of /.test(c.source ?? "") && c.site?.name ? c.site.name : c.name);

/** every cosplay still showing the character's own name ("Makima", or "Tifa" for Tifa Lockhart) gets a site name in one
 *  writer call (a near-twin, a translation or a shortening, never the exact name); what's already written with the old
 *  name in her profile takes the new one. Her Studio name stays (her folders and pictures are filed under it). */
export async function nameCosplays(onStep?: (t: string) => void): Promise<{ renamed: { from: string; to: string }[] }> {
  const { exact, siteAlias } = await import("./newChar");
  const list = useCharacters.getState().list.filter((c) => /^Cosplay of /.test(c.source ?? ""));
  const canon = (c: Character) => c.source!.replace(/^Cosplay of /, "").replace(/\s*\(.*$/, "").trim();
  const todo = list.filter((c) => !c.site?.name?.trim() || exact(canon(c), c.site.name) || exact(canon(c), shownName(c)));
  if (!todo.length) return { renamed: [] };
  onStep?.(`Thinking of site names for ${todo.length} cosplay${todo.length === 1 ? "" : "s"}…`);
  const names = await siteAlias(todo.map(canon));
  const renamed: { from: string; to: string }[] = [];
  todo.forEach((c0, i) => {
    const to = names[i]?.trim();
    const cur = useCharacters.getState().list.find((x) => x.id === c0.id);
    if (!to || !cur) return;
    const from = shownName(cur), old = cur.site?.name?.trim();
    const site = { ...(cur.site ?? {}) } as Record<string, unknown>;
    // her profile text written under the old site name follows the new one (the character's own name too, when it's exact)
    for (const bad of [old, exact(canon(cur), cur.name) ? cur.name : ""].filter((x): x is string => !!x && x.length >= 3))
      for (const [k, v] of Object.entries(site)) if (typeof v === "string" && v.includes(bad)) site[k] = v.split(bad).join(to);
    useCharacters.getState().save({ ...cur, site: { ...(site as NonNullable<Character["site"]>), name: to } });
    renamed.push({ from, to });
  });
  return { renamed };
}

/** every cosplay picture in the catalog, grouped by character (newest first in each) */
export async function scanCosplays(): Promise<CosGroup[]> {
  const groups = new Map<string, CosGroup>();
  const seen = new Map<string, { name: string; series: string } | null>();
  // names to look for in prompts: your Cosplay list and the cosplay characters you already have
  const { useCosplay } = await import("./cosplay");
  const known = [...useCosplay.getState().items.map((x) => ({ name: x.name, series: x.series })),
    ...useCharacters.getState().list.map((c) => /^Cosplay of (.+?)(?: \((.*)\))?$/.exec(c.source ?? "")).filter(Boolean).map((m) => ({ name: m![1], series: m![2] ?? "" }))]
    .filter((k) => k.name.trim().length >= 4);
  const COS = /cosplay(?:ing|s|ed)?\s+(?:as\s+)?([A-Z][\w'’.\- ]{1,40}?)\s+from\s+([A-Z0-9][\w'’:!.\- ]{1,50}?)(?=[,.;)]|\s+(?:in|with|wearing|at|on|she|her|and)\b)/;
  /** whose cosplay a result is: its Batch label, "cosplaying X from Y" in how it was made, or a known name in it */
  const fromText = (t: string) => {
    const m = COS.exec(t);
    if (m) { const k = known.find((x) => x.name.toLowerCase() === m[1].trim().toLowerCase()); return k ?? { name: m[1].trim(), series: m[2].trim().replace(/[.,;:]+$/, "") }; }
    const low = t.toLowerCase();
    return known.find((k) => new RegExp(`(?<![a-z])${k.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`).test(low)) ?? null;
  };
  for (let off = 0; ; off += 500) {
    const r = await fetch(`/studio-api/catalog?${new URLSearchParams({ offset: String(off), limit: "500", kind: "image" })}`);
    if (!r.ok) throw new Error(`The rental answered ${r.status}`);
    const d = await r.json();
    for (const it of d.items as { filename: string; subfolder: string; mtime: number; meta?: { label?: string; prompt?: string; idea?: string } }[]) {
      const label = it.meta?.label ?? "";
      if (!seen.has(label)) seen.set(label, label ? await cosplayOfLabel(label) : null);
      const cos = seen.get(label) ?? fromText(`${label} ${it.meta?.idea ?? ""} ${it.meta?.prompt ?? ""}`);
      if (!cos) continue;
      const k = keyOf(cos.name, cos.series);
      const g = groups.get(k) ?? { key: k, name: cos.name, series: cos.series, pics: [] };
      g.pics.push({ filename: it.filename, subfolder: it.subfolder, type: "output", label, mtime: it.mtime });
      groups.set(k, g);
    }
    useCosplays.setState({ scanned: off + d.items.length });
    if (d.items.length < 500 || off + 500 >= d.total) break;
  }
  // "Makima" and "Makima (Chainsaw Man)" are the same one: merged under the one with the series
  for (const g of [...groups.values()]) {
    if (g.series) continue;
    const twin = [...groups.values()].find((x) => x !== g && x.series && x.name.toLowerCase() === g.name.toLowerCase());
    if (twin) { twin.pics.push(...g.pics); groups.delete(g.key); }
  }
  const out = [...groups.values()];
  for (const g of out) g.pics.sort((a, b) => b.mtime - a.mtime);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** her main picture: her card (a kept copy), pinned for an animated cover made from it later */
export async function setMain(id: string, pic: FileRef, auto = false) {
  const { setCard } = await import("./siteMedia");
  await setCard(id, pic, { pin: true });
  const c = useCharacters.getState().list.find((x) => x.id === id);
  if (c) useCharacters.getState().save({ ...c, site: { ...c.site, mainFrom: { filename: pic.filename, subfolder: pic.subfolder, type: pic.type }, mainAuto: auto } });
}

/** the one button: find → make → write → main picture, for every cosplay (skipping what's already done unless `again`) */
/** one cosplay, start to finish: made (if she isn't yet), main picture, written, chat-tested and fixed */
async function doGroup(g: CosGroup, o: { again?: boolean }, aliases: Record<string, string>) {
  const { charactersFromResults } = await import("./newChar");
  const { doItAll } = await import("../components/SiteLink");
  useCosplays.setState((s) => ({ now: g.key, working: [...s.working.filter((k) => k !== g.key), g.key] }));
  try {
    let c = charFor(g);
    if (!c) {
      say(g.key, "Making her from her newest picture (reading it, about half a minute)…");
      const r = await untilStop(charactersFromResults([{ o: g.pics[0], label: g.pics[0].label }], { gallery: false, aliases, onStep: (m) => say(g.key, m) }));
      if (!r.made[0]) throw new Error(r.failed[0]?.replace(/^[^:]*:\s*/, "") || "couldn't make her");
      c = r.made[0];
    }
    if (!c.site?.mainFrom && !c.cover) { say(g.key, "Her main picture: the newest one (click another to change)…"); await untilStop(setMain(c.id, g.pics[0], true)); }
    const now = useCharacters.getState().list.find((x) => x.id === c!.id)!;
    if (o.again || !now.site?.persona) await untilStop(doItAll(now, false, (t) => say(g.key, t))); // writes, then chat-tests and fixes
    else {
      if (!now.site?.chat?.at) { const { writeChatLines } = await import("./chatLines"); await untilStop(writeChatLines(now, { onStep: (t) => say(g.key, t) })); }
      const fresh = useCharacters.getState().list.find((x) => x.id === c!.id)!;
      if (!fresh.site?.chatTest?.pass) { const { testAndFix } = await import("./chatTest"); await untilStop(testAndFix(fresh, { onStep: (t) => say(g.key, t) })); }
    }
    const t = useCharacters.getState().list.find((x) => x.id === c!.id)?.site?.chatTest;
    say(g.key, t && !t.pass ? `Failed the chat test (${t.score}/100) — open her to see why, or Write all again` : null);
  } catch (e) { say(g.key, (e as Error).message === "Stopped" ? "Stopped" : `Didn't go: ${(e as Error).message}`); }
  finally { useCosplays.setState((s) => ({ working: s.working.filter((k) => k !== g.key) })); }
}

/** site names for every cosplay that isn't made yet, in one writer call (90 s at most, then plain near-twins) */
async function aliasesFor(groups: CosGroup[]): Promise<Record<string, string>> {
  const missing = groups.filter((g) => !charFor(g));
  if (!missing.length) return {};
  say("_", `Thinking of site names for ${missing.length} new cosplay${missing.length === 1 ? "" : "s"} (one call)…`);
  const { siteAlias } = await import("./newChar");
  const names = await untilStop(siteAlias(missing.map((g) => g.name)));
  return Object.fromEntries(missing.map((g, i) => [g.name.toLowerCase(), names[i]]).filter(([, v]) => v));
}

/** the one button: find → name → make → write → test, for every cosplay (skipping what's already done unless `again`) */
export async function runCosplays(o: { again?: boolean; only?: string } = {}) {
  if (useCosplays.getState().running) return;
  useCosplays.setState({ running: true, stop: false, done: 0, total: 0, now: null, since: Date.now(), working: [] });
  try {
    let groups = useCosplays.getState().groups;
    if (!o.only || !groups.length) {
      // cosplays already made but still under the character's own name get their site names first (one writer call)
      const nm = await untilStop(nameCosplays((t) => say("_", t))).catch((e) => { if ((e as Error).message === "Stopped") throw e; return { renamed: [] as { from: string; to: string }[] }; });
      if (nm.renamed.length) say("_", `Renamed ${nm.renamed.length}: ${nm.renamed.slice(0, 6).map((r) => `${r.from} → ${r.to}`).join(", ")}${nm.renamed.length > 6 ? "…" : ""}`);
      say("_", "Looking through your results for cosplay pictures…");
      groups = await untilStop(scanCosplays());
      useCosplays.setState({ groups });
    }
    const todo = o.only ? groups.filter((g) => g.key === o.only) : groups;
    if (!todo.length) { say("_", "No cosplay pictures found"); return; }
    const aliases = await aliasesFor(todo);
    say("_", o.only ? null : `${todo.length} cosplay characters`);
    if (!o.only) todo.forEach((g) => say(g.key, "Waiting…"));
    useCosplays.setState({ total: todo.length });
    // several at once: each worker takes the next character until none are left
    const queue = [...todo];
    const worker = async () => {
      for (let g = queue.shift(); g; g = queue.shift()) {
        if (useCosplays.getState().stop) { say(g.key, "Stopped"); continue; }
        await doGroup(g, o, aliases);
        useCosplays.setState((s) => ({ done: s.done + 1 }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(useCosplays.getState().atOnce, todo.length) }, worker));
    say("_", useCosplays.getState().stop ? "Stopped — press Make them all again to carry on where it left off" : o.only ? null : "Done — click each one's main picture, then Send");
  } catch (e) { say("_", (e as Error).message === "Stopped" ? "Stopped — press Make them all again to carry on where it left off" : `Didn't go: ${(e as Error).message}`); }
  finally {
    // anything still marked as waiting didn't start
    useCosplays.setState((s) => ({ running: false, now: null, working: [], status: Object.fromEntries(Object.entries(s.status).filter(([, v]) => v !== "Waiting…")) }));
  }
}
