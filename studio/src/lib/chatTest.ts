// The chat test: before a character goes to your site, she chats with a scripted "real user" the way the site would run
// her — the site's model and settings (deepseek-flash, DEV-PROMPT §1), its prompt (the "Chat test · her chat" prompt file:
// a stand-in until you drop in the site's system-prompt-v4.1.md), its per-turn notes and repeat guard (§3). Then the
// rule checks and a reviewer (the "Chat test · reviewer" prompt file) score it. "Test & fix" feeds what was found back
// into her chat lines (and her persona, when that's the cause), tests again, and keeps whichever version scored better.
import { describe, useCharacters, type Character } from "./characters";
import { analyze, COLD, guardHits, SCRIPT, scoreOf, serverNotes, splitReply, type Card, type Check, type JudgeScores, type SimState, type Turn } from "./chatScore";
import { looseJson } from "./looseJson";
import { activePack, packText, usePacks } from "./packs";
import { runWriter } from "./writer";

export type ChatTestResult = {
  at: number; score: number; pass: boolean; hardFails: string[]; checks: Check[]; stats: Record<string, number>;
  judge?: JudgeScores; worst?: { turn: number; quote: string; why: string }[]; fixes?: Partial<Record<"examples" | "hot" | "persona" | "greeting", string>>; verdict?: string;
  turns: Turn[]; cold: Turn[]; prompt: "site" | "stand-in"; rounds?: { score: number; kept: boolean }[]; note?: string;
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
async function runChat(sys: string, c: Character, script: typeof SCRIPT, card: Card, onTurn?: (n: number, of: number) => void): Promise<Turn[]> {
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
    turns.push({ n: i + 1, him: msg, tag, her: best, regen, notes, firstHits: first?.length ? first : undefined });
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
  const turns = await runChat(sys.text, c, SCRIPT, card, (n, of) => o.onStep?.(`Chat test: message ${n} of ${of}…`));
  const cold = await runChat(sys.text, { ...c, site: { ...c.site, greeting: "" } }, COLD, card, (n, of) => o.onStep?.(`Chat test: cold open ${n} of ${of}…`));
  const { checks, stats } = analyze(turns, cold, card);
  o.onStep?.("Chat test: reviewing the chat…");
  const s = c.site ?? {}, ch = s.chat ?? {};
  const cardText = [`${card.name}: ${s.tagline ?? ""}`, `Personality: ${s.personality ?? ""}; tags: ${(s.tags ?? []).join(", ")}`, `Direction: ${s.direction ?? "-"}`,
    `Hold profile: ${ch.holdProfile ?? "?"} (holds ${card.holds}); effort pushback: ${ch.effortPushback ?? "?"}; casing: ${ch.casing ?? "?"}`,
    `Facts: job ${s.facts?.job ?? "?"}; city ${s.facts?.city ?? "?"}; home ${s.facts?.home ?? "?"}; wearing ${s.facts?.wearing ?? "?"}`,
    `People: ${(s.people ?? []).map((p) => `${p.name} (${p.relation})`).join(", ") || "-"}`, `Signature words: ${(s.signatureWords ?? []).join(", ")}`, `First message: ${s.greeting ?? ""}`].join("\n");
  const transcript = [`(her first message) ${s.greeting ?? ""}`, ...turns.map((t) => `#${t.n} him: ${t.him}\n   her: ${t.her.join(" / ")}`), "— a new chat, cold open —",
    ...cold.map((t) => `#${t.n} him: ${t.him}\n   her: ${t.her.join(" / ")}`)].join("\n");
  const checksText = checks.map((k) => `${k.ok ? "ok" : "FAIL"}: ${k.label}${k.detail ? ` (${k.detail})` : ""}`).join("\n");
  let j: Record<string, any> = {}, note = "";
  try { j = looseJson<any>(await runWriter("chatjudge", { card: cardText, transcript, checks: checksText }, { tab: "characters", label: `${c.name}: chat review`, meta: { charId: c.id } })) ?? {}; }
  catch (e) { note = `The reviewer didn't run (${(e as Error).message.slice(0, 120)}) — scored on the checks alone`; }
  const sc = j.scores && typeof j.scores === "object" ? Object.fromEntries(["realism", "voice", "hooks", "heat", "consistency"].map((k) => [k, Math.max(1, Math.min(5, Number(j.scores[k]) || 0))])) as JudgeScores : undefined;
  const { score, pass, hardFails } = scoreOf(checks, sc);
  const res: ChatTestResult = { at: Date.now(), score, pass, hardFails, checks, stats, judge: sc, worst: Array.isArray(j.worst) ? j.worst.slice(0, 4) : undefined,
    fixes: j.fixes && typeof j.fixes === "object" ? Object.fromEntries(Object.entries(j.fixes).filter(([, v]) => typeof v === "string" && v.trim())) as ChatTestResult["fixes"] : undefined,
    verdict: typeof j.verdict === "string" ? j.verdict : undefined, turns, cold, prompt: sys.site ? "site" : "stand-in", note: note || undefined };
  if (o.save !== false) { const now = cur(c.id); if (now) useCharacters.getState().save({ ...now, site: { ...now.site, chatTest: { ...res, rounds: now.site?.chatTest?.rounds } } }); }
  return res;
}

/** what the last test found, as one block for the writers */
function feedbackOf(r: ChatTestResult): string {
  return [...r.checks.filter((k) => !k.ok).map((k) => `- failed: ${k.label}${k.detail ? ` ${k.detail}` : ""}`),
    ...(r.worst ?? []).map((w) => `- weak reply #${w.turn}: “${w.quote}” — ${w.why}`),
    ...Object.entries(r.fixes ?? {}).map(([k, v]) => `- fix (${k}): ${v}`)].join("\n").slice(0, 2500);
}

/** test → if it doesn't pass, rewrite what the test points at → test again (twice at most); the better version is kept */
export async function testAndFix(c0: Character, o: { onStep?: (t: string) => void; rounds?: number } = {}): Promise<ChatTestResult> {
  let best = await testChat(c0, { onStep: o.onStep });
  const rounds: { score: number; kept: boolean }[] = [{ score: best.score, kept: true }];
  for (let r = 0; r < (o.rounds ?? 2) && !best.pass; r++) {
    const before = cur(c0.id)!;
    const snap = { chat: before.site?.chat, persona: before.site?.persona, personaCore: before.site?.personaCore };
    const fb = feedbackOf(best);
    const personaToo = !!best.fixes?.persona || (best.judge && (best.judge.realism < 3 || best.judge.consistency < 3)) || best.checks.some((k) => !k.ok && ["facts", "ai", "name"].includes(k.key));
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
