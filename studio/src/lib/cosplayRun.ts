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
  /** the run's progress: how many characters are through, of how many, and which one is being worked on */ done: number; total: number; now: string | null }>(() => ({
  open: false, groups: [], status: {}, running: false, scanned: 0, stop: false, done: 0, total: 0, now: null,
}));
export const openCosplays = () => useCosplays.setState({ open: true });
const say = (key: string, t: string | null) => useCosplays.setState((s) => { const st = { ...s.status }; if (t) st[key] = t; else delete st[key]; return { status: st }; });

export const keyOf = (name: string, series: string) => `${name.toLowerCase()}|${series.toLowerCase()}`;
/** the character already made for this cosplay: "Cosplay of Makima (Chainsaw Man)" on her, or her name */
export function charFor(g: { name: string; series: string }, list = useCharacters.getState().list): Character | undefined {
  const n = g.name.toLowerCase();
  return list.find((c) => { const m = /^Cosplay of (.+?)(?: \((.*)\))?$/.exec(c.source ?? ""); return m ? m[1].toLowerCase() === n && (!g.series || !m[2] || m[2].toLowerCase() === g.series.toLowerCase()) : false; })
    ?? list.find((c) => c.name.toLowerCase() === n && /cosplay/i.test(c.source ?? ""));
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
export async function runCosplays(o: { again?: boolean } = {}) {
  if (useCosplays.getState().running) return;
  useCosplays.setState({ running: true, stop: false, status: {}, done: 0, total: 0, now: null });
  try {
    say("_", "Looking through your results for cosplay pictures…");
    const groups = await scanCosplays();
    useCosplays.setState({ groups });
    say("_", groups.length ? `${groups.length} cosplay characters found` : null);
    if (!groups.length) return;
    groups.forEach((g) => say(g.key, "Waiting…"));
    useCosplays.setState({ total: groups.length });
    const { charactersFromResults } = await import("./newChar");
    const { doItAll } = await import("../components/SiteLink");
    for (const g of groups) {
      if (useCosplays.getState().stop) { say(g.key, "Stopped"); continue; }
      useCosplays.setState({ now: g.key });
      try {
        let c = charFor(g);
        if (!c) {
          say(g.key, `Making her from her newest picture (reading it, about half a minute)…`);
          const r = await charactersFromResults([{ o: g.pics[0], label: g.pics[0].label }], { gallery: false, onStep: (m) => say(g.key, m) });
          if (!r.made[0]) throw new Error(r.failed[0]?.replace(/^[^:]*:\s*/, "") || "couldn't make her");
          c = r.made[0];
        }
        if (!c.site?.mainFrom && !c.cover) { say(g.key, "Her main picture: the newest one (click another to change)…"); await setMain(c.id, g.pics[0], true); }
        const now = useCharacters.getState().list.find((x) => x.id === c!.id)!;
        if (o.again || !now.site?.persona) await doItAll(now, false, (t) => say(g.key, t));
        else if (!now.site?.chat?.at) { const { writeChatLines } = await import("./chatLines"); await writeChatLines(now, { onStep: (t) => say(g.key, t) }); }
        say(g.key, null);
      } catch (e) { say(g.key, `Didn't go: ${(e as Error).message}`); }
      useCosplays.setState((s) => ({ done: s.done + 1 }));
    }
    say("_", useCosplays.getState().stop ? "Stopped — press the button again to carry on where it left off" : "Done — click each one's main picture, then Send");
  } catch (e) { say("_", `Didn't go: ${(e as Error).message}`); }
  finally { useCosplays.setState({ running: false, now: null }); }
}
