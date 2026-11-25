// The chat test: before a character goes to your site, she chats with a scripted "real user" the way the site would run
// her — the site's model and settings (deepseek-flash, DEV-PROMPT §1), its prompt (the "Chat test · her chat" prompt file:
// a stand-in until you drop in the site's system-prompt-v4.1.md), its per-turn notes and repeat guard (§3). Then the
// rule checks and a reviewer (the "Chat test · reviewer" prompt file) score it. "Test & fix" feeds what was found back
// into her chat lines (and her persona, when that's the cause), tests again, and keeps whichever version scored better.
import { create } from "zustand";
import { loadState, saveState } from "./api";
import { describe, useCharacters, type Character } from "./characters";
import { analyze, autoTag, COLD, guardHits, SCRIPT, scoreOf, serverNotes, splitReply, type Card, type Check, type JudgeScores, type SimState, type Turn } from "./chatScore";
import { looseJson } from "./looseJson";
import { activePack, fillTemplate, packText, usePacks } from "./packs";
import type { TestChat } from "./testChats";

/** the test setup, shared by every character: real users' chats to test with, how many per test, the cloud reviewer, a
 *  Candy reference, and how many fix rounds. Kept on the rental (and in backups) as state "chat_tests". */
export type JudgeProvider = "deepseek-pro" | "deepseek" | "openrouter";
type Setup = { chats: TestChat[]; perTest: number; judge: JudgeProvider; orModel: string; reference: string; rounds: number };
const DEFAULT_SETUP: Setup = { chats: [], perTest: 3, judge: "deepseek-pro", orModel: "", reference: "", rounds: 2 };
export const useChatTests = create<Setup & { loaded: boolean }>(() => ({ ...DEFAULT_SETUP, loaded: false }));
export async function loadChatTests() {
  if (useChatTests.getState().loaded) return;
  const d = await loadState<Partial<Setup>>("chat_tests").catch(() => null);
  useChatTests.setState({ ...DEFAULT_SETUP, ...(d ?? {}), loaded: true });
}
export function setChatTests(p: Partial<Setup>) {
  useChatTests.setState(p);
  const { loaded: _l, ...rest } = useChatTests.getState();
  void saveState("chat_tests", rest);
}

/** which uploaded chats she's tested with: the same ones every time for the same character (so a retest compares fairly),
 *  different characters get different ones, and the picks cover heat, other languages, "are you real" and kinks first */
export function extrasFor(id: string, chats: TestChat[], k: number): TestChat[] {
  if (!chats.length || k <= 0) return [];
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const order = chats.map((c, i) => ({ c, r: ((i + 1) * 2654435761 + h) >>> 0 })).sort((a, b) => a.r - b.r).map((x) => x.c);
  const out: TestChat[] = [];
  for (const want of ["heat", "other language", "are-you-real", "kink", "money", "rude", "photo"]) {
    if (out.length >= k) break;
    const c = order.find((x) => !out.includes(x) && x.tags.includes(want)); if (c) out.push(c);
  }
  for (const c of order) { if (out.length >= k) break; if (!out.includes(c)) out.push(c); }
  return out;
}

export type ChatTestResult = {
  at: number; score: number; pass: boolean; hardFails: string[]; checks: Check[]; stats: Record<string, number>;
  judge?: JudgeScores; worst?: { turn: number | string; quote: string; why: string }[]; fixes?: Partial<Record<"examples" | "hot" | "persona" | "greeting", string>>; verdict?: string;
  turns: Turn[]; cold: Turn[]; prompt: "site" | "stand-in"; rounds?: { score: number; kept: boolean }[]; note?: string;
  /** real users' chats she was tested with */ extras?: { title: string; tags: string[]; turns: Turn[] }[];
  /** the share of her replies the reviewer found realistic and in context */ realism?: number; reviewer?: string;
};

const HIS_NAME = "Ezra";
const cur = (id: string) => useCharacters.getState().list.find((x) => x.id === id);

/** her system prompt for the test: the active "Chat test · her chat" file with the site's {{placeholders}} filled from her card */
async function systemFor(c: Character): Promise<{ text: string; site: boolean }> {
  if (!usePacks.getState().loaded) await usePacks.getState().load();
  const pack = activePack("chatsim");
  if (!pack) throw new Error("No “Chat test · her chat” prompt file");
  const tpl = await packText(pack.id);
  const s = c.site ?? {}, fx = s.facts ?? {}, ch = s.chat ?? {};
  const persona = (s.persona ?? "").trim();
  const [manner, sound] = persona.includes("How you sound:") ? [persona.split("How you sound:")[0].trim(), persona.split("How you sound:")[1].trim()] : [persona, s.voice ?? ""];
  const sig = [...(s.signatureWords ?? []), ...(s.signatureEmojis ?? [])];
  const vars: Record<string, string> = {
    name: s.name || c.name, age: String(Math.max(21, c.age ?? 24)), who: [s.tagline, s.bio].filter(Boolean).join(" "), body: describe(c), looks: describe(c),
    personality: s.personality ?? "", tags: (s.tags ?? []).join(", "), manner, sound, life: [s.backstory, s.scenario].filter(Boolean).join("\n"),
    job: fx.job || s.occupation || "", city: fx.city || "", home: fx.home || "", wearing: fx.wearing || "", examples: ch.examples ?? "",
    signature_line: sig.length ? `Your own words and emoji, used naturally now and then: ${sig.join(", ")}.` : "",
    emoji_line: ch.emojiRate ? `Emoji: ${ch.emojiRate === "none" ? "none" : ch.emojiRate === "rare" ? "rarely, at most one" : ch.emojiRate === "often" ? "often, one or two" : "sometimes, one"}.` : "",
    casing_line: ch.casing === "proper" ? "You type with normal capitals and punctuation." : ch.casing === "custom" ? `How you type: ${ch.casingCustom ?? "your own way"}.` : "You type in lowercase.",
    memory_him: `His name is ${HIS_NAME} (his account name). Nothing else yet.`, right_now: s.scenario || s.statusLine || "texting from home",
    people: (s.people ?? []).map((p) => `${p.name} (${p.relation}${p.note ? `, ${p.note}` : ""})`).join("; ") || "none named yet",
  };
  const text = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "").replace(/\{\{user\}\}/g, HIS_NAME);
  return { text: text.replace(/\{\{user\}\}/g, HIS_NAME), site: !/stand-in for the site's own chat prompt/i.test(tpl) };
}

async function reply(messages: { role: string; content: string }[]): Promise<string> {
  const r = await fetch("/studio-api/chatsim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `The rental answered ${r.status}`);
  return String(d.text ?? "");
}

/** one scripted chat, turn by turn, with the site's notes and repeat guard (regenerated up to twice, fewest hits kept) */
async function runChat(sys: string, c: Character, script: typeof SCRIPT, card: Card, onTurn?: (n: number, of: number) => void, idPre = "#"): Promise<Turn[]> {
  const name = c.site?.name || c.name;
  const opener = (c.site?.greeting ?? "").replace(/\{\{user\}\}/g, HIS_NAME);
  const hist: { role: string; content: string }[] = opener ? [{ role: "assistant", content: opener }] : [];
  const prev: string[][] = opener ? [splitReply(opener, name)] : [];
  const st: SimState = { pushes: 0, maxHolds: card.holds, asleep: false };
  const turns: Turn[] = [];
  for (let i = 0; i < script.length; i++) {
    onTurn?.(i + 1, script.length);
    const { msg, tag } = script[i];
    const notes = serverNotes(st, msg, prev, i + 1, card);
    const base = [{ role: "system", content: sys }, ...hist, { role: "user", content: msg }];
    let best: string[] = [], bestHits: string[] = [], first: string[] | undefined, regen = 0;
    for (let a = 0; a < 3; a++) {
      const extra = a === 0 ? notes : [...notes, `(note: rewrite, and don't use any of these: ${bestHits.join("; ")})`];
      const out = splitReply(await reply(extra.length ? [...base, { role: "system", content: extra.join("\n") }] : base), name);
      const hits = guardHits(out, prev, tag === "premium" ? msg : "");
      if (a === 0) first = hits;
      if (a === 0 || hits.length < bestHits.length) { best = out; bestHits = hits; }
      if (!hits.length) break;
      regen++;
    }
    turns.push({ n: i + 1, id: `${idPre}${i + 1}`, him: msg, tag, her: best, regen, notes, firstHits: first?.length ? first : undefined });
    hist.push({ role: "user", content: msg }, { role: "assistant", content: best.join("\n") });
    prev.push(best);
  }
  return turns;
}

const cardOf = (c: Character): Card => {
  const ch = c.site?.chat ?? {};
  const holds = ch.heatHolds ?? (ch.holdProfile === "warm" ? 1 : ch.holdProfile === "tease" ? 3 : ch.holdProfile === "dom" ? 2 : 1);
  return { name: c.site?.name || c.name, city: c.site?.facts?.city, signature: [...(c.site?.signatureWords ?? [])].filter((w) => w.length > 2), holds };
};

/** test her once and save the result on her (site.chatTest) */
export async function testChat(c0: Character, o: { onStep?: (t: string) => void; save?: boolean } = {}): Promise<ChatTestResult> {
  const c = cur(c0.id) ?? c0;
  if (!c.site?.persona?.trim()) throw new Error("Write her profile first");
  const sys = await systemFor(c);
  const card = cardOf(c);
  await loadChatTests();
  const setup = useChatTests.getState();
  const turns = await runChat(sys.text, c, SCRIPT, card, (n, of) => o.onStep?.(`Chat test: message ${n} of ${of}…`));
  const cold = await runChat(sys.text, { ...c, site: { ...c.site, greeting: "" } }, COLD, card, (n, of) => o.onStep?.(`Chat test: cold open ${n} of ${of}…`), "c#");
  // real users' chats: each a new chat from her first message
  const picked = extrasFor(c.id, setup.chats, setup.perTest);
  const extras: NonNullable<ChatTestResult["extras"]> = [];
  for (let i = 0; i < picked.length; i++) {
    const x = picked[i];
    const t = await runChat(sys.text, c, x.msgs.map((m) => ({ msg: m, tag: autoTag(m) })), { ...card, holds: card.holds }, (n, of) => o.onStep?.(`Chat test: real chat ${i + 1} of ${picked.length}, message ${n} of ${of}…`), `u${i + 1}#`);
    extras.push({ title: x.title, tags: x.tags, turns: t });
  }
  const { checks, stats } = analyze(turns, cold, card, extras.map((x) => x.turns));
  o.onStep?.("Chat test: the cloud reviewer is reading every reply…");
  const s = c.site ?? {}, ch = s.chat ?? {};
  const cardText = [`${card.name}, ${Math.max(21, c.age ?? 24)}: ${s.tagline ?? ""}`, `Bio: ${s.bio ?? ""}`, `Personality: ${s.personality ?? ""}; tags: ${(s.tags ?? []).join(", ")}`, `Direction (her dynamic): ${s.direction ?? "-"}`,
    `Facts: job ${s.facts?.job ?? "?"}; city ${s.facts?.city ?? "?"}; home ${s.facts?.home ?? "?"}; wearing ${s.facts?.wearing ?? "?"}`,
    `People: ${(s.people ?? []).map((p) => `${p.name} (${p.relation}${p.note ? `, ${p.note}` : ""})`).join("; ") || "-"}`, `Her situation: ${s.scenario ?? s.statusLine ?? "-"}`, `Backstory: ${s.backstory ?? "-"}`,
    `Style: hold profile ${ch.holdProfile ?? "?"} (holds ${card.holds}); effort pushback ${ch.effortPushback ?? "?"}; casing ${ch.casing ?? "?"}${ch.casingCustom ? ` (${ch.casingCustom})` : ""}; languages ${ch.languages ?? "english"}`,
    `Signature words: ${(s.signatureWords ?? []).join(", ")}; emoji ${(s.signatureEmojis ?? []).join(" ")}`, `In bed: ${s.inBed ?? "-"}`, `First message: ${s.greeting ?? ""}`,
    `Her persona (what the site's model is given):\n${(s.persona ?? "").slice(0, 3000)}`].join("\n");
  const fmt = (ts: Turn[]) => ts.map((t) => `${t.id} him: ${t.him}\n   her: ${t.her.join(" / ")}`).join("\n");
  const transcript = [`CHAT 1 (her first message: ${s.greeting ?? ""})`, fmt(turns), "CHAT 2 (a cold open, no first message)", fmt(cold),
    ...extras.map((x, i) => `CHAT ${i + 3} (a real user's chat${x.tags.length ? `: ${x.tags.join(", ")}` : ""}; her first message as above)\n${fmt(x.turns)}`)].join("\n\n");
  const checksText = checks.map((k) => `${k.ok ? "ok" : "FAIL"}: ${k.label}${k.detail ? ` (${k.detail})` : ""}`).join("\n");
  let j: Record<string, any> = {}, note = "";
  const reviewer = setup.judge === "openrouter" ? (setup.orModel || "OpenRouter") : setup.judge === "deepseek-pro" ? "DeepSeek V4 Pro" : "DeepSeek V4 Flash";
  try {
    if (!usePacks.getState().loaded) await usePacks.getState().load();
    const pack = activePack("chatjudge");
    if (!pack) throw new Error("No “Chat test · reviewer” prompt file");
    const system = await packText(pack.id);
    const user = fillTemplate(pack.template || usePacks.getState().templates.chatjudge || "", { card: cardText, reference: setup.reference.trim() || "(none given)", transcript, checks: checksText });
    const r = await fetch("/studio-api/judge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: setup.judge, model: setup.orModel, max_tokens: 4000, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || `The rental answered ${r.status}`);
    j = looseJson<any>(String(d.text ?? "")) ?? {};
    if (!j.scores) throw new Error("its answer had no scores");
  } catch (e) { note = `The reviewer (${reviewer}) didn't run: ${(e as Error).message.slice(0, 160)} — scored on the checks alone`; }
  const sc = j.scores && typeof j.scores === "object" ? Object.fromEntries(["realism", "voice", "hooks", "heat", "consistency"].map((k) => [k, Math.max(1, Math.min(5, Number(j.scores[k]) || 0))])) as JudgeScores : undefined;
  // the reviewer's flags on each reply
  const every = [...turns, ...cold, ...extras.flatMap((x) => x.turns)];
  const LABELS = ["weird", "off_context", "out_of_character", "robotic", "repeat", "cold", "too_much"];
  for (const f of Array.isArray(j.flags) ? j.flags : []) {
    const id = String(f?.id ?? "").trim().replace(/^(?!#|c#|u\d+#)/, "#");
    const t = every.find((x) => x.id === id);
    if (t && LABELS.includes(String(f.label))) t.flag = { label: String(f.label), why: String(f.why ?? "").slice(0, 200) };
  }
  const realism = sc ? 1 - every.filter((t) => t.flag).length / Math.max(1, every.length) : undefined;
  const { score, pass, hardFails } = scoreOf(checks, sc, realism);
  const res: ChatTestResult = { at: Date.now(), score, pass, hardFails, checks, stats, judge: sc,
    worst: Array.isArray(j.worst) ? j.worst.slice(0, 4).map((w: any) => ({ turn: w.turn, quote: String(w.quote ?? ""), why: String(w.why ?? "") })) : undefined,
    fixes: j.fixes && typeof j.fixes === "object" ? Object.fromEntries(Object.entries(j.fixes).filter(([, v]) => typeof v === "string" && v.trim())) as ChatTestResult["fixes"] : undefined,
    verdict: typeof j.verdict === "string" ? j.verdict : undefined, turns, cold, extras, realism, reviewer, prompt: sys.site ? "site" : "stand-in", note: note || undefined };
  if (o.save !== false) { const now = cur(c.id); if (now) useCharacters.getState().save({ ...now, site: { ...now.site, chatTest: { ...res, rounds: now.site?.chatTest?.rounds } } }); }
  return res;
}

/** what the last test found, as one block for the writers */
function feedbackOf(r: ChatTestResult): string {
  const flagged = [...r.turns, ...r.cold, ...(r.extras ?? []).flatMap((x) => x.turns)].filter((t) => t.flag).slice(0, 12);
  return [...r.checks.filter((k) => !k.ok).map((k) => `- failed: ${k.label}${k.detail ? ` ${k.detail}` : ""}`),
    ...flagged.map((t) => `- ${t.flag!.label.replace(/_/g, " ")}: he said “${t.him}”, she said “${t.her.join(" / ")}” — ${t.flag!.why}`),
    ...(r.worst ?? []).map((w) => `- weak reply #${w.turn}: “${w.quote}” — ${w.why}`),
    ...Object.entries(r.fixes ?? {}).map(([k, v]) => `- fix (${k}): ${v}`)].join("\n").slice(0, 2500);
}

/** test → if it doesn't pass, rewrite what the test points at → test again (twice at most); the better version is kept */
export async function testAndFix(c0: Character, o: { onStep?: (t: string) => void; rounds?: number } = {}): Promise<ChatTestResult> {
  let best = await testChat(c0, { onStep: o.onStep });
  const rounds: { score: number; kept: boolean }[] = [{ score: best.score, kept: true }];
  await loadChatTests();
  for (let r = 0; r < (o.rounds ?? useChatTests.getState().rounds) && !best.pass; r++) {
    const before = cur(c0.id)!;
    const snap = { chat: before.site?.chat, persona: before.site?.persona, personaCore: before.site?.personaCore };
    const fb = feedbackOf(best);
    const flags = [...best.turns, ...best.cold, ...(best.extras ?? []).flatMap((x) => x.turns)].filter((t) => t.flag);
    const personaToo = !!best.fixes?.persona || (best.judge && (best.judge.realism < 3 || best.judge.consistency < 3)) || best.checks.some((k) => !k.ok && ["facts", "ai", "name"].includes(k.key))
      || flags.filter((t) => ["out_of_character", "weird"].includes(t.flag!.label)).length >= 3
      || !before.site?.deepAt; // a quick profile that failed gets its deep persona now
    try {
      if (personaToo) { o.onStep?.(`Fix ${r + 1}: rewriting her persona from the test…`); const { deepProfile } = await import("./siteAuto"); await deepProfile(before, { onStep: o.onStep, feedback: fb }); }
      o.onStep?.(`Fix ${r + 1}: rewriting her chat lines from the test…`);
      const { writeChatLines } = await import("./chatLines");
      await writeChatLines(cur(c0.id)!, { onStep: o.onStep, feedback: fb });
    } catch (e) { o.onStep?.(`Fix ${r + 1} stopped: ${(e as Error).message}`); break; }
    const next = await testChat(cur(c0.id)!, { onStep: (t) => o.onStep?.(`Retest ${r + 1} · ${t}`), save: false });
    const better = next.score > best.score || (next.pass && !best.pass);
    rounds.push({ score: next.score, kept: better });
    if (better) { best = next; rounds.forEach((x, i) => (x.kept = i === rounds.length - 1)); }
    else { const now = cur(c0.id)!; useCharacters.getState().save({ ...now, site: { ...now.site, ...snap } }); } // worse: her previous card back
  }
  const now = cur(c0.id);
  if (now) useCharacters.getState().save({ ...now, site: { ...now.site, chatTest: { ...best, rounds } } });
  return { ...best, rounds };
}
