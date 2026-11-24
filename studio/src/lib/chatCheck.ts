// Checks for urgf.ai Chat v4.1 material (sample exchanges, voice examples, hot lines): the site's hard limits, its banned
// stock lines and product talk, and no 4-word phrase shared with another character. Pure functions (no stores), so they
// can be tested on their own.
import { minorWords } from "./adult";

/** the site's §3.9 stock lines, fix pack v4.2's bans (Candy's shared lines, the old shared bank) — never in any field.
 *  "earn it" is allowed only on a dom card (EARN, checked separately) */
export const STOCK = /\b(not tonight|maybe later|pull(s|ed)? you in by the collar|what pulled you away|you still owe me|tell me (something|one)|one true thing|make me laugh first|buy me a drink first|one line from|that'?s the (trade|deal|price)|my price|owe me|work for it|not there yet|use your imagination|let me find a decent one|hey yourself|i'?ve been called worse|wedding or me|i never do that|(can'?t|cannot|won'?t|don'?t|do not) (do|send) voice( notes?| messages?)?|real girl|not a bot|flesh and blood|are you a bot|are you broken|not yet you|you haven'?t earned|i'?ll give you that|and maybe i'?ll|you'?d have to|you'?re not getting|i'?m not giving|what'?s the first thing|straight to it,? huh|bold of you|keeping you up|at this hour|text at 2 ?am)\b|\bhey\.? you look like/i;
export const EARN = /\bearn(ed)? it\b/i;
/** the site as a product: she doesn't know a paywall exists (his profile, feed, bio and their DMs are fine: it's a dating
 *  site's DMs). In the premium / tokens examples she may echo HIS word to shrug it off */
export const PRODUCT = /\b(pixel(s|ated)?|virtual|digital (girl|me|person|companion|world|body)|tokens?|credits?|coins?|unlock(ed|s|ing)?|subscri\w*|paywall|premium|locked (photo|pic|picture|content|card|set)|(next|your|my|relationship|account|friendship) level|buy (premium|credits|tokens|coins|a plan|more)|pay(ing)? for (it|this|premium|more)|for free|my avatar|this (app|site|platform))\b/i;
/** low-effort pushback that insults him or breaks the world */
export const PUSHBACK = /\b(bot\b\??|broken|glitch\w*|npc)\b/i;
/** she never asks his name: the site gives her his account name */
export const NAME_ASK = /\b(what'?s|what is|whats) your (real |actual )?name\b|\bwhat (do|should|can) i call you\b|\btell me your (real )?name\b|\byour name\?/i;
/** distress is the server's, never a scene: no comfort-drinking beats */
export const DISTRESS = /\b(drink with me|come sit with me|i'?ve been there too|pass(ing)? (me )?the bottle|share (a|the|my) bottle)\b/i;
/** school, youth, family and authority roles, non-consent, the throat */
export const HARD = /\b(teen\w*|school\w*|classroom|student|freshman|sophomore|youth|step[- ]?(sis|sister|bro|brother|mom|dad|daughter|son|family)|stepmom|stepdad|daddy|mommy|teacher|professor|babysit\w*|nanny|asleep|passed out|unconscious|blackout drunk|forc(e|ed|ing)|rape|non-?con\w*|chok\w*|throat|neck|strangl\w*|breath ?play)\b/i;
/** family words — fine in an ordinary exchange ("my sister Mara"), never in a hot line */
export const FAMILY = /\b(sister|brother|mom|mum|mother|dad|father|aunt|uncle|cousin|niece|nephew)\b/i;
export const CLOCK = /\b(\d{1,2}(:\d{2})?\s?(am|pm|a\.m\.|p\.m\.)|\d{1,2}:\d{2}|midnight)\b/i;
/** a tease that sets a condition or a price */
export const CONDITION = /\b(if you|until|earn\w*|owe\w*|later|not tonight|first you|you have to|prove)\b/i;
export const TAG = /\[(photo|voice note)\s*:/i;

export const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const norm = (t: string) => t.toLowerCase().replace(/\[(photo|voice note)\s*:[^\]]*\]/g, " ").replace(/[^a-z0-9' ]+/g, " ").replace(/'/g, "").split(/\s+/).filter(Boolean);
/** every run of four words */
export function grams4(...texts: (string | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) { if (!t) continue; const w = norm(t); for (let i = 0; i + 3 < w.length; i++) out.add(w.slice(i, i + 4).join(" ")); }
  return out;
}
/** the 4-word runs this text shares with `taken` */
export const sharedWith = (t: string, taken: Set<string>) => [...grams4(t)].filter((g) => taken.has(g));

/** why a line can't be used ("" = fine). kind: "example" (an ordinary exchange) or a hot-line stage */
export function lineProblem(t: string, kind: "example" | "tease" | "explicit" | "after", o: { dom?: boolean; echo?: string } = {}): string {
  if (/\*|asterisk/i.test(t)) return "an asterisk";
  if (minorWords(t).length || HARD.test(t)) return `a hard limit (${(minorWords(t)[0] ?? t.match(HARD)?.[0] ?? "").toLowerCase()})`;
  if (STOCK.test(t)) return `a banned line (${t.match(STOCK)?.[0]})`;
  if (EARN.test(t) && !(o.dom && kind === "example")) return "a banned line (earn it)";
  // his own word, echoed to shrug it off ("premium for what?"), is fine; anything else about the app isn't
  const own = (o.echo ?? "").toLowerCase().match(/[a-z]+/g) ?? [];
  const pm = t.match(new RegExp(PRODUCT.source, "gi"))?.find((m) => !own.some((w) => w.length > 3 && m.toLowerCase().includes(w)));
  if (pm) return `app or money talk (${pm})`;
  if (NAME_ASK.test(t)) return "asks his name";
  if (DISTRESS.test(t)) return `a comfort-drinking beat (${t.match(DISTRESS)?.[0]})`;
  if (CLOCK.test(t)) return "a clock time";
  if (kind !== "example") {
    if (FAMILY.test(t)) return `a family word (${t.match(FAMILY)?.[0]})`;
    if (TAG.test(t)) return "a photo / voice-note tag";
    if (words(t) > 14) return "over 14 words";
    if (kind === "tease" && CONDITION.test(t)) return `a condition (${t.match(CONDITION)?.[0]})`;
  }
  return "";
}

/** her casing, for "lower": everything lowercase except words she shouts in CAPS (two letters or more) */
export function inCasing(t: string, casing?: string): string {
  if (casing !== "lower") return t;
  return t.replace(/\[(photo|voice note)\s*:[^\]]*\]|[A-Za-z']+/g, (w) => (w.startsWith("[") || (w.length > 1 && w === w.toUpperCase() && /[A-Z]{2}/.test(w)) ? w : w.toLowerCase()));
}

export type Turn = { him: string; her: string[] };
/** one mini-chat: his message and her bubbles, and for "hm" his second message and her answer (`more`) */
export type Exchange = Turn & { scenario?: string; more?: Turn[] };
/** fix pack v4.2's required examples (plus "real", kept as it was). Each key is one mini-chat */
export const SCENARIOS = ["hey", "compliment", "badday", "lives", "now", "talk", "coldpush", "photo", "photocant", "photolead", "unprompted",
  "foreign", "hm", "unknown", "nickname", "premium", "tokens", "real"] as const;

/** the site's format (fix pack v4.2): "<START>", "him: …", then each of her bubbles as its own "Name: …", blank lines between */
export function formatExchanges(name: string, ex: Exchange[]): string {
  const turn = (t: Turn) => [`him: ${t.him.trim()}`, ...t.her.map((b) => b.trim()).filter(Boolean).map((b) => `${name}: ${b}`)].join("\n\n");
  return ex.map((e) => `<START>\n${[e, ...(e.more ?? [])].map(turn).join("\n\n")}`).join("\n\n");
}

/** an exchange's problem ("" = fine), by its scenario's own rule */
export function exchangeProblem(e: Exchange, o: { dom?: boolean; sassy?: boolean } = {}): string {
  if (!e.him?.trim() || !e.her?.length) return "empty";
  const turns = [e, ...(e.more ?? [])];
  for (const t of turns) for (const b of t.her) { const p = lineProblem(b, "example", { dom: o.dom, echo: ["premium", "tokens"].includes(e.scenario ?? "") ? t.him : "" }); if (p) return p; }
  const all = turns.flatMap((t) => t.her).join(" ");
  const photo = /\[photo\s*:[^\]]+\]/i.test(all);
  if (e.scenario === "photo" && !photo) return "no [photo: …] sent";
  if ((e.scenario === "photocant" || e.scenario === "photolead") && photo) return "sends a photo where she can't (the site attaches the card)";
  if (e.scenario === "hm" && !e.more?.length) return "needs his second message (ok / Hm) and her answer";
  if (e.scenario === "hm" && PUSHBACK.test(all)) return `pushback that breaks the world (${all.match(PUSHBACK)?.[0]})`;
  if (e.scenario === "hm" && !o.sassy && /\b(one word\??|is that it|that'?s all i get)\b/i.test(all)) return "sassy pushback on a sweet card";
  if (e.scenario === "foreign" && !/[^\x00-\x7F]/.test(e.him)) return "his line isn't in another language";
  if (e.scenario === "foreign" && /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0600-\u06ff]{3,}/.test(all)) return "she answers in his language (she stays in English)";
  if (e.scenario === "real" && (!/\b(ai|a\.i\.|artificial)\b/i.test(all) || /\b(i'?m|im|i am) (a )?(human|real person)\b/i.test(all))) return "doesn't say plainly she's an AI";
  if (/\[voice note\s*:/i.test(all)) return "a voice note outside the voice examples";
  return "";
}

/** the paid voice example: one [voice note: …] of 30 words or fewer. The free one: none, and no "can't do voice" */
export function voiceProblem(e: Exchange, paid: boolean): string {
  if (!e?.him?.trim() || !e.her?.length) return "empty";
  const all = e.her.join(" ");
  for (const b of e.her) { const p = lineProblem(b.replace(/\[voice note\s*:[^\]]*\]/gi, ""), "example"); if (p) return p; }
  const vn = [...all.matchAll(/\[voice note\s*:\s*([^\]]*)\]/gi)];
  if (paid) return vn.length !== 1 ? "needs exactly one [voice note: …]" : words(vn[0][1]) > 30 ? "voice note over 30 words" : !words(vn[0][1]) ? "empty voice note" : "";
  return vn.length ? "the free example has a voice note" : "";
}

/** what makes these lines usable: each line checked, same-start and 4-word repeats inside the bank and with `taken` dropped */
export function cleanLines(lines: string[], kind: "tease" | "explicit" | "after", taken: Set<string>, casing?: string): { keep: string[]; dropped: string[] } {
  const keep: string[] = [], dropped: string[] = [];
  const mine = new Set<string>();
  for (const raw of lines) {
    const t = inCasing(String(raw ?? "").replace(/^\s*[-•\d.)]+\s*/, "").replace(/^["']|["']$/g, "").trim(), casing);
    if (!t) continue;
    const why = lineProblem(t, kind) || (sharedWith(t, taken).length ? `shares "${sharedWith(t, taken)[0]}" with another character` : "") || (sharedWith(t, mine).length ? "repeats a phrase" : "");
    if (why) { dropped.push(`${t} — ${why}`); continue; }
    keep.push(t);
    for (const g of grams4(t)) mine.add(g);
  }
  return { keep: keep.slice(0, 15), dropped };
}

/** short lines outside the hot bank (dangle lines, unprompted-send captions): the example rules, no tags, `max` words */
export function cleanShort(lines: unknown, taken: Set<string>, casing: string | undefined, max: number, dom?: boolean): { keep: string[]; dropped: string[] } {
  const keep: string[] = [], dropped: string[] = [];
  const mine = new Set<string>();
  for (const raw of Array.isArray(lines) ? lines : []) {
    const t = inCasing(String(raw ?? "").replace(/^\s*[-•\d.)]+\s*/, "").replace(/^["']|["']$/g, "").trim(), casing);
    if (!t) continue;
    const why = lineProblem(t, "example", { dom }) || (TAG.test(t) ? "a photo / voice-note tag" : "") || (words(t) > max ? `over ${max} words` : "")
      || (sharedWith(t, taken)[0] ? `shares "${sharedWith(t, taken)[0]}" with another character` : "") || (sharedWith(t, mine).length ? "repeats a phrase" : "");
    if (why) { dropped.push(`${t} — ${why}`); continue; }
    keep.push(t);
    for (const g of grams4(t)) mine.add(g);
  }
  return { keep, dropped };
}

export type Kink = { term: string; stance: "go" | "tease" | "soft_no"; line: string };
/** hard limits are never a stance (they're refused by the site, not her taste); "bnwo" stays the owner's decision */
const KINK_HARD = /\b(teen|young|minor|school|student|family|incest|step\w*|daddy|mommy|sister|brother|animal|bestial\w*|dog|pee|piss|golden ?shower|scat|poop|choking|choke|strangl\w*|throat|rape|non-?con\w*|forced|asleep|drunk|bnwo|period|vomit|blood)\b/i;
export function cleanKinks(list: unknown, casing?: string): { keep: Kink[]; dropped: string[] } {
  const keep: Kink[] = [], dropped: string[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const term = String(o.term ?? "").trim().toLowerCase(), stance = String(o.stance ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const line = inCasing(String(o.line ?? "").trim(), casing);
    if (!term || !line) continue;
    if (KINK_HARD.test(term) || KINK_HARD.test(line) || minorWords(`${term} ${line}`).length) { dropped.push(`${term} — a hard limit or the owner's call`); continue; }
    if (!["go", "tease", "soft_no"].includes(stance)) { dropped.push(`${term} — stance "${stance}"`); continue; }
    const why = lineProblem(line, "example");
    if (why) { dropped.push(`${term} — ${why}`); continue; }
    if (!keep.some((k) => k.term === term)) keep.push({ term, stance: stance as Kink["stance"], line });
  }
  return { keep: keep.slice(0, 10), dropped };
}
export const formatKinks = (k: Kink[]) => k.map((x) => `${x.term}: ${x.stance} — ${x.line}`).join("\n");
/** back from the editor's text ("spanking: go — line") */
export function parseKinks(t: string): Kink[] {
  return t.split("\n").map((l) => /^\s*([^:]+):\s*(go|tease|soft_no)\s*(?:[—–-]+\s*(.*))?$/i.exec(l)).filter(Boolean)
    .map((m) => ({ term: m![1].trim().toLowerCase(), stance: m![2].toLowerCase() as Kink["stance"], line: (m![3] ?? "").trim() }));
}
