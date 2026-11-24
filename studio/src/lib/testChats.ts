// Real users' chats as test scripts. Only HIS side is kept (her replies are what's being tested), with emails, phone
// numbers, links and @handles taken out. From a big export it keeps the chats that stress a character — heat and nude
// asks, kink words, other languages, "are you real", insults, odd words, long back-and-forths — and drops the ones that
// are only "hey / how are you", plus near-copies of a chat already kept.
//
// The file it writes (and reads back) is plain text:
//   # urgf test chats
//   === chat 1 · heat, photo · 12 messages
//   hey
//   send me something
//   …
// Pure functions (no stores) up top, so the same code parses a file on its own (tsx) or in the Studio.

export type TestChat = { id: string; title: string; tags: string[]; msgs: string[] };

const HIM = /^\s*(?:\[[^\]]*\]\s*)?(?:\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:am|pm)?\s*[-–|]?\s*)?(user|him|he|you|u|me|customer|human|guest|client|fan)\s*[:>]\s*/i;
const HER = /^\s*(?:\[[^\]]*\]\s*)?(?:\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:am|pm)?\s*[-–|]?\s*)?(assistant|ai|bot|her|she|char(?:acter)?|model|companion|[A-Z][a-z]{1,20})\s*[:>]\s*/;
const SPLIT = /^\s*(={3,}|-{3,}|#{2,}|\*{3,}|(?:chat|conversation|convo|session|thread)\b[^\n]{0,60}$)/i;

/** emails, phone numbers, links and @handles out of his messages */
export function anonymize(t: string): string {
  return t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]").replace(/https?:\/\/\S+|www\.\S+/gi, "[link]")
    .replace(/(?<!\w)@[A-Za-z0-9_]{2,}/g, "@someone").replace(/\+?\d[\d\s().-]{8,}\d/g, "[number]").trim();
}

/** a raw export → chats of his messages. Speaker labels (user:/him:/you: vs a name or assistant:) decide whose line it is;
 *  a file with no labels at all is read as one message per line, chats split at blank lines or ===/--- lines. */
export function parseRaw(raw: string): string[][] {
  const lines = raw.replace(/\r/g, "").split("\n");
  const labelled = lines.filter((l) => HIM.test(l)).length >= 2;
  const chats: string[][] = [];
  let cur: string[] = [], lastWasHim = false, blank = 0;
  const flush = () => { if (cur.length) chats.push(cur); cur = []; };
  for (const l of lines) {
    if (/^\s*#/.test(l) && !/^\s*#{2,}/.test(l)) continue; // a "# comment" line
    if (SPLIT.test(l)) { flush(); lastWasHim = false; continue; }
    if (!l.trim()) { blank++; if (!labelled && blank >= 1) { flush(); } continue; }
    const wasBlank = blank; blank = 0;
    if (labelled) {
      if (HIM.test(l)) { const m = anonymize(l.replace(HIM, "")); if (m) cur.push(m); lastWasHim = true; continue; }
      if (HER.test(l)) { lastWasHim = false; continue; }
      if (lastWasHim && cur.length && !wasBlank) cur[cur.length - 1] += ` ${anonymize(l)}`; // a wrapped line of his message
      continue;
    }
    const m = anonymize(l); if (m) cur.push(m);
  }
  flush();
  return chats;
}

const GENERIC = /^(h+i+|h+e+y+|hello+|yo+|sup|hii+|heyy+|good (morning|evening|afternoon)|how (are|r) (you|u)( doing)?|hbu|wbu|wyd|wbu\?|what'?s up|whats up|ok(ay)?|k|lol|lmao|haha+|nice|cool|yes|no|ya|yeah|sure|same|you\?|u\?|and you)\W*$/i;
const HEAT = /\b(nude|nudes|naked|sex|fuck|horny|cock|dick|pussy|tits|boobs|ass|cum|strip|spicy|send (me )?(a )?(pic|photo|something)|take (it|that|this) off|on your knees|ride|suck|wet|hard)\b/i;
const KINK = /\b(feet|foot|armpits?|stockings?|spank\w*|plug|toy|edging|goon\w*|cuck\w*|chastity|bbc|snowbunny|bnwo|dom\w*|sub\b|mistress|leash|collar|bondage|tied|degrad\w*|pegging|squirt\w*)\b/i;
const AI_Q = /\b(are|r) (you|u) (an? |even |actually )?(ai|a bot|bot|real|human|a real person|a person)\b/i;
const MONEY = /\b(premium|tokens?|credits?|coins?|pay|price|subscri\w*|free|unlock)\b/i;
const INSULT = /\b(bitch|slut|whore|stupid|dumb|idiot|fuck you|shut up|boring|ugly)\b/i;
const PHOTO = /\b(pic|pics|photo|picture|selfie|show me|let me see|video|vid|voice)\b/i;
const FOREIGN = /[^\x00-\x7F‘’“”…–—\p{Extended_Pictographic}‍️]/u;

/** what makes a chat useful for testing, and its tags */
export function stressOf(msgs: string[]): { score: number; tags: string[] } {
  const all = msgs.join("\n");
  const tags: string[] = [];
  let score = 0;
  const hit = (re: RegExp, tag: string, w: number) => { if (re.test(all)) { tags.push(tag); score += w; } };
  hit(HEAT, "heat", 3); hit(KINK, "kink", 3); hit(AI_Q, "are-you-real", 3); hit(FOREIGN, "other language", 3); hit(MONEY, "money", 2);
  hit(INSULT, "rude", 2); hit(PHOTO, "photo", 2);
  const real = msgs.filter((m) => !GENERIC.test(m));
  if (real.length >= 8) { tags.push("long"); score += 2; }
  if (msgs.some((m) => m.split(/\s+/).length >= 25)) { tags.push("long message"); score += 1; }
  if (msgs.filter((m) => GENERIC.test(m)).length >= 3 && real.length <= 2) score -= 3; // just hey / how are you
  if (msgs.length <= 1) score -= 2;
  return { score, tags };
}

const setOf = (msgs: string[]) => new Set(msgs.map((m) => m.toLowerCase().replace(/[^a-z0-9\u0080-￿ ]+/g, "").trim()).filter(Boolean));

/** the chats worth testing with: stressful ones first, near-copies dropped, each trimmed to `maxLen` messages */
export function pickStress(chats: string[][], o: { max?: number; maxLen?: number; min?: number } = {}): TestChat[] {
  const maxLen = o.maxLen ?? 20;
  const cleaned = chats.map((c) => {
    // repeated identical lines in a row once; leading greetings beyond the first one dropped
    const out: string[] = [];
    for (const m of c) { if (out.length && out[out.length - 1].toLowerCase() === m.toLowerCase()) continue; if (out.length >= 1 && GENERIC.test(m) && out.every((x) => GENERIC.test(x))) continue; out.push(m.slice(0, 400)); }
    return out.slice(0, maxLen);
  }).filter((c) => c.length);
  const scored = cleaned.map((msgs) => ({ msgs, ...stressOf(msgs) })).filter((x) => x.score >= (o.min ?? 2)).sort((a, b) => b.score - a.score || b.msgs.length - a.msgs.length);
  const kept: typeof scored = [];
  for (const x of scored) {
    const s = setOf(x.msgs);
    const dup = kept.some((k) => { const t = setOf(k.msgs); const inter = [...s].filter((w) => t.has(w)).length; return inter / Math.max(1, Math.min(s.size, t.size)) > 0.6; });
    if (!dup) kept.push(x);
    if (kept.length >= (o.max ?? 200)) break;
  }
  return kept.map((x, i) => ({ id: `u${i + 1}`, title: `chat ${i + 1}`, tags: x.tags, msgs: x.msgs }));
}

/** the uploadable file */
export function formatChats(chats: TestChat[]): string {
  return [`# urgf test chats · ${chats.length} chats · his side only, anonymized`, ...chats.map((c, i) =>
    `\n=== chat ${i + 1}${c.tags.length ? ` · ${c.tags.join(", ")}` : ""} · ${c.msgs.length} messages\n${c.msgs.map((m) => m.replace(/\n+/g, " ")).join("\n")}`)].join("\n") + "\n";
}

/** read a file: our own format back as-is; anything else parsed, anonymized and picked */
export function readChats(text: string): TestChat[] {
  if (/^\s*# urgf test chats/.test(text)) {
    return text.split(/\n(?==== )/).slice(1).map((block, i) => {
      const [head, ...rest] = block.split("\n");
      const tags = (head.match(/·\s*([^·]+?)\s*·\s*\d+ messages/)?.[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      return { id: `u${i + 1}`, title: `chat ${i + 1}`, tags, msgs: rest.map((x) => x.trim()).filter(Boolean) };
    }).filter((c) => c.msgs.length);
  }
  return pickStress(parseRaw(text));
}
