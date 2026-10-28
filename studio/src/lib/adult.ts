// Adults only. Your own words are checked for words that clearly mean a child; the local writer also stops (UNDERAGE_STOP)
// when it thinks something would describe someone under 18. That second check can misfire on harmless words, so a stop
// is retried once with "everyone is an adult" and, if it stops again, the message says which of your words may have read as young.

const EXPLICIT = /\b(loli|lolis|lolicon|shota|shotacon|toddler|toddlers|child|children|kid|kids|underage|preteen|pre-teen|young girl|young boy|little girl|little boy|elementary school|middle school|grade school|infant)\b/gi;
const AGE = /\b(\d{1,2})\s?(?:yo|y\/o|-?years?[- ]old|-?year-old)\b/gi;
const SOUNDS_YOUNG = /\b(girl|girls|petite|tiny|small|cute|young|youthful|teen|teens|teenage|teenager|schoolgirl|school uniform|student|baby|little|flat chest|short stature|childlike|innocent)\b/gi;

/** the part that describes the picture: a pasted "Negative prompt:" lists what to avoid (often "child, kids, loli" to keep
 *  everyone adult), and an earlier stop message quoted in a chat isn't a description either. The writer is given only
 *  this part too (writer.ts / frame.ts), so nothing it reads goes unchecked. */
const STOPPED = /Stopped: “[^”]*”(?:, “[^”]*”)* describes someone under 18\.(?: Everyone must be an adult\.)?/g;
export const described = (t: string) => t.split(/\bnegative prompt\s*:/i)[0].replace(STOPPED, "");

/** words in the text that clearly mean someone under 18 */
export function minorWords(...texts: (string | undefined | null)[]): string[] {
  const out = new Set<string>();
  for (let t of texts) {
    if (!t) continue;
    t = described(t);
    for (const m of t.matchAll(EXPLICIT)) out.add(m[0].toLowerCase());
    for (const m of t.matchAll(AGE)) if (Number(m[1]) < 18) out.add(m[0]);
  }
  return [...out];
}

/** harmless words that sometimes make the writer think someone is young (shown when it stops) */
export function youngSounding(...texts: (string | undefined | null)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) if (t) for (const m of t.matchAll(SOUNDS_YOUNG)) out.add(m[0].toLowerCase());
  return [...out].slice(0, 8);
}

export const ADULT_NOTE = "\n\nEveryone described here is an adult, 18 or older.";

export function stopMessage(texts: string[]): string {
  const y = youngSounding(...texts);
  return `Stopped: the writer read this as someone under 18${y.length ? ` — words that can read as young: “${y.join("”, “")}”` : ""}. Say their adult age (e.g. “a 25-year-old woman”) or change those words, then try again.`;
}

export function explicitStop(hits: string[]): string {
  return `Stopped: “${hits.join("”, “")}” describes someone under 18. Everyone must be an adult.`;
}
