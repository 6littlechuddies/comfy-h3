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

export const useCosplays = create<{ open: boolean; groups: CosGroup[]; status: Record<string, string>; running: boolean; scanned: number; stop: boolean }>(() => ({
  open: false, groups: [], status: {}, running: false, scanned: 0, stop: false,
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
  for (let off = 0; ; off += 500) {
    const r = await fetch(`/studio-api/catalog?${new URLSearchParams({ offset: String(off), limit: "500", kind: "image" })}`);
    if (!r.ok) throw new Error(`The rental answered ${r.status}`);
    const d = await r.json();
    for (const it of d.items as { filename: string; subfolder: string; mtime: number; meta?: { label?: string } }[]) {
      const label = it.meta?.label ?? "";
      if (!seen.has(label)) seen.set(label, label ? await cosplayOfLabel(label) : null);
      const cos = seen.get(label);
      if (!cos) continue;
      const k = keyOf(cos.name, cos.series);
      const g = groups.get(k) ?? { key: k, name: cos.name, series: cos.series, pics: [] };
      g.pics.push({ filename: it.filename, subfolder: it.subfolder, type: "output", label, mtime: it.mtime });
      groups.set(k, g);
    }
    useCosplays.setState({ scanned: off + d.items.length });
    if (d.items.length < 500 || off + 500 >= d.total) break;
  }
  const out = [...groups.values()];
  for (const g of out) g.pics.sort((a, b) => b.mtime - a.mtime);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** her main picture: her card (a kept copy), pinned for an animated cover made from it later */
export async function setMain(id: string, pic: FileRef) {
  const { setCard } = await import("./siteMedia");
  await setCard(id, pic, { pin: true });
  const c = useCharacters.getState().list.find((x) => x.id === id);
  if (c) useCharacters.getState().save({ ...c, site: { ...c.site, mainFrom: { filename: pic.filename, subfolder: pic.subfolder, type: pic.type } } });
}

/** the one button: find → make → write → main picture, for every cosplay (skipping what's already done unless `again`) */
export async function runCosplays(o: { again?: boolean } = {}) {
  if (useCosplays.getState().running) return;
  useCosplays.setState({ running: true, stop: false, status: {} });
  try {
    say("_", "Looking through your results for cosplay pictures…");
    const groups = await scanCosplays();
    useCosplays.setState({ groups });
    say("_", groups.length ? `${groups.length} cosplay characters found` : null);
    if (!groups.length) return;
    groups.forEach((g) => say(g.key, "Waiting…"));
    const { charactersFromResults } = await import("./newChar");
    const { doItAll } = await import("../components/SiteLink");
    for (const g of groups) {
      if (useCosplays.getState().stop) { say(g.key, "Stopped"); continue; }
      try {
        let c = charFor(g);
        if (!c) {
          say(g.key, `Making her from her newest picture (reading it, about half a minute)…`);
          const r = await charactersFromResults([{ o: g.pics[0], label: g.pics[0].label }], { gallery: false, onStep: (m) => say(g.key, m) });
          if (!r.made[0]) throw new Error(r.failed[0]?.replace(/^[^:]*:\s*/, "") || "couldn't make her");
          c = r.made[0];
        }
        if (!c.site?.mainFrom && !c.cover) { say(g.key, "Her main picture: the newest one (click another to change)…"); await setMain(c.id, g.pics[0]); }
        const now = useCharacters.getState().list.find((x) => x.id === c!.id)!;
        if (o.again || !now.site?.persona) await doItAll(now, false, (t) => say(g.key, t));
        else if (!now.site?.chat?.at) { const { writeChatLines } = await import("./chatLines"); await writeChatLines(now, { onStep: (t) => say(g.key, t) }); }
        say(g.key, null);
      } catch (e) { say(g.key, `Didn't go: ${(e as Error).message}`); }
    }
    say("_", useCosplays.getState().stop ? "Stopped — press the button again to carry on where it left off" : "Done — click each one's main picture, then Send");
  } catch (e) { say("_", `Didn't go: ${(e as Error).message}`); }
  finally { useCosplays.setState({ running: false }); }
}
