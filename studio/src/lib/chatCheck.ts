// Checks for urgf.ai Chat v4.1 material (sample exchanges, voice examples, hot lines): the site's hard limits, its banned
// stock lines and product talk, and no 4-word phrase shared with another character. Pure functions (no stores), so they
// can be tested on their own.
import { minorWords } from "./adult";

/** the site's §3.9 stock lines and its other bans — never in any field */
export const STOCK = /\b(earn(ed)? it|not tonight|maybe later|pull(s|ed)? you in by the collar|what pulled you away|you still owe me|tell me something real|hey yourself|i'?ve been called worse|wedding or me|i never do that|(can'?t|cannot|won'?t|don'?t|do not) (do|send) voice( notes?| messages?)?|real girl|not a bot|flesh and blood)\b|\bhey\.? you look like/i;
/** the site as a product (his profile, feed, bio and their DMs are fine: it's a dating site's DMs) */
export const PRODUCT = /\b(pixel(s|ated)?|virtual|digital (girl|me|person|companion|world|body)|tokens?|credits?|unlock(ed|s)?|subscri\w*|paywall|premium set|my avatar|this (app|site|platform))\b/i;
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
export function lineProblem(t: string, kind: "example" | "tease" | "explicit" | "after"): string {
  if (/\*|asterisk/i.test(t)) return "an asterisk";
  if (minorWords(t).length || HARD.test(t)) return `a hard limit (${(minorWords(t)[0] ?? t.match(HARD)?.[0] ?? "").toLowerCase()})`;
  if (STOCK.test(t)) return `a banned stock line (${t.match(STOCK)?.[0]})`;
  if (PRODUCT.test(t)) return `product talk (${t.match(PRODUCT)?.[0]})`;
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

export type Exchange = { scenario?: string; him: string; her: string[] };
export const SCENARIOS = ["hey", "compliment", "lazy", "badday", "lives", "now", "heat", "send", "talk", "photo", "real"] as const;

/** the site's format: "<START>", "him: …", then "Name: …" with a blank line between her bubbles */
export function formatExchanges(name: string, ex: Exchange[]): string {
  return ex.map((e) => `<START>\nhim: ${e.him.trim()}\n${name}: ${e.her.map((b) => b.trim()).filter(Boolean).join("\n\n")}`).join("\n\n");
}

/** an exchange's problem ("" = fine), by its scenario's own rule */
export function exchangeProblem(e: Exchange): string {
  if (!e.him?.trim() || !e.her?.length) return "empty";
  for (const b of e.her) { const p = lineProblem(b, "example"); if (p) return p; }
  const all = e.her.join(" ");
  if (e.scenario === "photo" && !/\[photo\s*:[^\]]+\]/i.test(all)) return "no [photo: …] sent";
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
