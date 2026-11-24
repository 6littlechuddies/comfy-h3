// urgf.ai Chat v4.1: her typing settings, 12 sample exchanges (the 11 core situations), the paid and free voice examples,
// and her hot lines bank (tease / explicit / after). Written by the "lines" writer in two calls, then checked line by
// line (chatCheck.ts): anything breaking a hard limit, a stock line, product talk, a clock time — or sharing a 4-word
// phrase with another character — is dropped, and missing pieces are asked for again.
import { describe, useCharacters, type Character, type SiteChat } from "./characters";
import { cleanLines, exchangeProblem, formatExchanges, grams4, inCasing, SCENARIOS, sharedWith, voiceProblem, type Exchange } from "./chatCheck";
import { looseJson } from "./looseJson";
import { canonNote, dynamicNote, stripAges } from "./siteAuto";
import { runWriter } from "./writer";

const STAGES = ["tease", "explicit", "after"] as const;
const isEmoji = (s: string) => /\p{Extended_Pictographic}/u.test(s) && !/[A-Za-z0-9]/.test(s);

/** her lines are hers: every 4-word run in the other characters' examples, voice examples, hot lines and first messages */
export function takenGrams(id: string): Set<string> {
  const out = new Set<string>();
  for (const x of useCharacters.getState().list) {
    if (x.id === id) continue;
    const ch = x.site?.chat;
    const her = (t?: string) => (t ?? "").split("\n").filter((l) => !/^\s*(<START>|him:)/i.test(l)).join(" ");
    for (const g of grams4(x.site?.greeting, her(ch?.examples), her(ch?.voicePaid), her(ch?.voiceFree), ...(ch?.hot ? [...ch.hot.tease, ...ch.hot.explicit, ...ch.hot.after] : []))) out.add(g);
  }
  return out;
}

function whoShe(c: Character): string {
  const s = c.site ?? {};
  const fx = s.facts ?? {};
  return [`Name: ${s.name || c.name}. Adult woman.`, stripAges(describe(c)), canonNote(c.source),
    s.direction && `Owner's direction (sets her dynamic): ${s.direction}`, dynamicNote(s.direction, s.personality, s.tags),
    `FACTS (fixed): job: ${fx.job || s.occupation || "?"}; city: ${fx.city || "?"}; home: ${fx.home || "?"}; wearing now: ${fx.wearing || "?"}${fx.room ? `; where she is now: ${fx.room}` : ""}`,
    s.people?.length && `People (exactly these): ${s.people.map((p) => `${p.name} (${p.relation}${p.note ? ` - ${p.note}` : ""})`).join("; ")}`,
    s.personality && `Traits: ${s.personality}`, s.tags?.length && `Tags: ${s.tags.join(", ")}`, s.voice && `How she texts: ${s.voice}`, s.quirks && `Texting habits: ${s.quirks}`,
    s.texting?.casing && `Casing: ${s.texting.casing.replace(/_/g, " ")}`, s.signatureWords?.length && `Signature words: ${s.signatureWords.join(", ")}`,
    s.signatureEmojis?.length && `Signature emoji: ${s.signatureEmojis.join(" ")}`, s.statusLine && `Right now: ${s.statusLine}`, s.scenario && `Her situation: ${s.scenario}`,
    s.inBed && `In bed: ${s.inBed}`, s.greeting && `Her first message: ${s.greeting}`, s.levels?.length === 7 && `Her levels: ${s.levels.join(", ")}`].filter(Boolean).join("\n");
}

const asEx = (v: unknown): Exchange | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const her = Array.isArray(o.her) ? o.her.map(String) : typeof o.her === "string" ? String(o.her).split(/\n\s*\n/) : [];
  return o.him ? { scenario: o.scenario ? String(o.scenario).trim().toLowerCase() : undefined, him: String(o.him), her: her.map((x) => x.trim()).filter(Boolean) } : null;
};

/** writes her Chat v4.1 material and saves it as site.chat. Returns notes on what was dropped or is still missing. */
export async function writeChatLines(c: Character, o: { onStep?: (t: string) => void } = {}): Promise<string[]> {
  const cur0 = useCharacters.getState().list.find((x) => x.id === c.id) ?? c;
  const s = cur0.site ?? {};
  if (!s.persona?.trim()) throw new Error("Write her profile first — the chat lines are built from it");
  const name = (s.name || cur0.name).trim();
  const who = whoShe(cur0);
  const taken = takenGrams(cur0.id);
  const soft = /^DYNAMIC: soft/.test(dynamicNote(s.direction, s.personality, s.tags));
  const notes: string[] = [];
  const others = useCharacters.getState().list.filter((x) => x.id !== cur0.id);
  const avoidOf = (extra: string[] = []) => [...extra, ...others.flatMap((x) => [x.site?.greeting, ...(x.site?.chat?.hot?.tease ?? []).slice(0, 2), ...(x.site?.chat?.hot?.explicit ?? []).slice(0, 2)]).filter(Boolean)].slice(0, 60).join("\n") || "(none yet)";
  const call = (task: string, avoid: string, label: string) => runWriter("lines", { task, character: who, avoid }, { tab: "characters", label: `${cur0.name}: ${label}`, meta: { charId: c.id } })
    .then((r) => looseJson<any>(r) ?? {}).catch((e) => { notes.push(`The writer failed (${(e as Error).message})`); return {}; });

  // 1. her typing settings, the exchanges and the voice examples
  o.onStep?.("Writing her sample chats and voice examples…");
  const d = await call("examples", avoidOf(), "chat examples");
  const casing = ["lower", "proper", "custom"].includes(d.casing) ? d.casing as SiteChat["casing"] : s.texting?.casing === "sentence" ? "proper" : s.texting?.casing ? "lower" : undefined;
  const fixEx = (e: Exchange): Exchange => ({ ...e, her: e.her.map((b) => inCasing(b, casing)) });
  const good = new Map<string, Exchange>(), extra: Exchange[] = [];
  const take = (list: unknown) => {
    for (const raw of Array.isArray(list) ? list : []) {
      const e0 = asEx(raw); if (!e0) continue;
      const e = fixEx(e0);
      const why = exchangeProblem(e) || (sharedWith(e.her.join(" "), taken)[0] ? `shares "${sharedWith(e.her.join(" "), taken)[0]}" with another character` : "");
      if (why) { notes.push(`Dropped a "${e.scenario ?? "?"}" example: ${why}`); continue; }
      if (e.scenario && (SCENARIOS as readonly string[]).includes(e.scenario) && !good.has(e.scenario)) good.set(e.scenario, e); else extra.push(e);
    }
  };
  take(d.examples);
  let paid = asEx(d.voicePaid), free = asEx(d.voiceFree);
  if (paid) paid = fixEx(paid);
  if (free) free = fixEx(free);
  const missing = () => SCENARIOS.filter((k) => !good.has(k));
  const badVoice = () => [paid && !voiceProblem(paid, true) ? "" : "voicePaid", free && !voiceProblem(free, false) ? "" : "voiceFree"].filter(Boolean);
  if (missing().length || badVoice().length) {
    const want = [missing().length && `the exchanges for these scenario keys only: ${missing().join(", ")}`, badVoice().length && `and ${badVoice().join(" and ")}`].filter(Boolean).join(" ");
    o.onStep?.(`Writing again: ${[...missing(), ...badVoice()].join(", ")}…`);
    const d2 = await call(`examples — write ${want}. Leave the other fields out.`, avoidOf(notes.map((n) => n.match(/shares "([^"]+)"/)?.[1] ?? "").filter(Boolean)), "chat examples (again)");
    take(d2.examples);
    if (badVoice().includes("voicePaid") && asEx(d2.voicePaid)) paid = fixEx(asEx(d2.voicePaid)!);
    if (badVoice().includes("voiceFree") && asEx(d2.voiceFree)) free = fixEx(asEx(d2.voiceFree)!);
  }
  const ex = [...SCENARIOS.filter((k) => good.has(k)).map((k) => good.get(k)!), ...extra].slice(0, 14);
  if (missing().length) notes.push(`Still no example for: ${missing().join(", ")} — write those by hand`);
  for (const [k, v, p] of [["paid", paid, true], ["free", free, false]] as const) { const why = v ? voiceProblem(v, p) : "missing"; if (why) notes.push(`Voice example (${k}): ${why} — left blank`); }

  // 2. the hot lines bank: each stage checked; under 8 good lines → asked for more (twice at most)
  o.onStep?.("Writing her hot lines…");
  const h = await call("hot", avoidOf(), "hot lines");
  const hot = { tease: [] as string[], explicit: [] as string[], after: [] as string[] };
  const bankTaken = new Set(taken);
  for (const st of STAGES) {
    let pool = Array.isArray(h[st]) ? (h[st] as unknown[]).map(String) : [];
    const dropped: string[] = [];
    for (let round = 0; round < 3; round++) {
      const r = cleanLines([...hot[st], ...pool], st, bankTaken, casing);
      hot[st] = r.keep; dropped.push(...r.dropped);
      if (hot[st].length >= 8 || round === 2) break;
      o.onStep?.(`More ${st} lines (${hot[st].length} passed the checks)…`);
      const avoid = [...hot[st], ...r.dropped.map((x) => x.split(" — ")[0])];
      const m = await call(`more — ${12 - hot[st].length} new "${st}" lines`, avoidOf(avoid), `more ${st} lines`);
      pool = Array.isArray(m.lines) ? m.lines.map(String) : [];
    }
    for (const g of grams4(...hot[st])) bankTaken.add(g);
    if (dropped.length) notes.push(`${st}: dropped ${dropped.length} line${dropped.length === 1 ? "" : "s"} (${[...new Set(dropped.map((x) => x.split(" — ")[1]))].slice(0, 3).join("; ")})`);
    if (hot[st].length < 8) notes.push(`${st}: only ${hot[st].length} good lines (the site wants 8–15) — add a few by hand`);
  }

  const lvl = Array.isArray(d.levelEmojis) ? d.levelEmojis.map(String).map((x: string) => x.trim()).filter(isEmoji) : [];
  const holds = Number(d.heatHolds);
  const chat: SiteChat = {
    casing, casingCustom: casing === "custom" ? String(d.casingCustom ?? "").trim().slice(0, 120) || undefined : undefined,
    emojiRate: ["none", "rare", "some", "often"].includes(d.emojiRate) ? d.emojiRate : (s.texting?.emoji as SiteChat["emojiRate"]) ?? undefined,
    // a soft, eager girl never holds back: the site's default; a guarded one 1–2
    heatHolds: !soft && (holds === 1 || holds === 2) ? holds : null,
    levelEmojis: lvl.length === 7 ? lvl : s.chat?.levelEmojis,
    examples: ex.length ? formatExchanges(name, ex) : s.chat?.examples,
    voicePaid: paid && !voiceProblem(paid, true) ? formatExchanges(name, [paid]) : s.chat?.voicePaid,
    voiceFree: free && !voiceProblem(free, false) ? formatExchanges(name, [free]) : s.chat?.voiceFree,
    hot, at: Date.now(), notes,
  };
  const cur = useCharacters.getState().list.find((x) => x.id === c.id) ?? cur0;
  useCharacters.getState().save({ ...cur, site: { ...cur.site, chat } });
  return notes;
}
