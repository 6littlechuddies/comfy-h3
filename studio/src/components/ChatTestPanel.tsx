// Her chat test on the site page: the verdict up top (passed / failed / not tested, the score, when), the two buttons, then
// what it found — the reviewer's five scores, the checks (failures first), the rhythm numbers, the weakest replies and what
// the fix changes — and the whole test chat as bubbles.
import { useEffect, useRef, useState } from "react";
import type { Character } from "../lib/characters";
import { loadChatTests, setChatTests, useChatTests, type ChatTestResult, type JudgeProvider } from "../lib/chatTest";
import type { Turn } from "../lib/chatScore";
import { useJobs } from "../lib/jobs";
import { Icon, TextArea, TextIn, cx } from "./ui";

const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const DIMS: [keyof NonNullable<ChatTestResult["judge"]>, string][] = [["realism", "Real"], ["voice", "Her voice"], ["hooks", "Hooks"], ["heat", "Heat"], ["consistency", "Consistent"]];

export function ChatTestPanel({ c, busy, setBusy }: { c: Character; busy: string | undefined; setBusy: (t: string | null) => void }) {
  const t = c.site?.chatTest;
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const setup = useChatTests();
  useEffect(() => { void loadChatTests(); }, []);
  const run = async (fix: boolean) => {
    setBusy(fix ? "Chat test & fix…" : "Chat test…"); setOpen(true);
    try {
      const m = await import("../lib/chatTest");
      const r = fix ? await m.testAndFix(c, { onStep: setBusy }) : await m.testChat(c, { onStep: setBusy });
      useJobs.getState().toast(r.pass ? `${c.site?.name || c.name} passed her chat test · ${r.score}/100` : `${c.site?.name || c.name} failed her chat test · ${r.score}/100${fix ? "" : " — Test & fix rewrites what it found"}`, r.pass ? "good" : "info");
    } catch (e) { useJobs.getState().toast((e as Error).message, "bad"); } finally { setBusy(null); }
  };
  const state = !t ? "none" : t.pass ? "pass" : "fail";
  const fails = t ? t.checks.filter((k) => !k.ok) : [];
  return (
    <section className={cx("card border", state === "pass" ? "border-good/40" : state === "fail" ? "border-bad/40" : "border-line")}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className={cx("flex h-12 w-[72px] shrink-0 flex-col items-center justify-center border", state === "pass" ? "border-good/60 text-good" : state === "fail" ? "border-bad/60 text-bad" : "border-line text-dim")}>
          <b className="font-mono text-[17px] leading-none">{t ? t.score : "—"}</b><span className="micro mt-1 opacity-80">{state === "pass" ? "Pass" : state === "fail" ? "Fail" : "Untested"}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-ink">Chat test</p>
          <p className="truncate text-[12.5px] text-muted">
            {busy ? <span className="text-accent">{busy}</span>
              : !t ? "A scripted chat the way your site runs her, checked and reviewed — she needs a pass before she's sent"
              : t.pass ? `Passed ${ago(t.at)}${t.verdict ? ` · ${t.verdict}` : ""}`
              : `${t.hardFails.length ? `Hard fail: ${t.hardFails.join(", ")}` : `${fails.length} check${fails.length === 1 ? "" : "s"} failed`} · ${ago(t.at)}`}
          </p>
        </div>
        <button disabled={!!busy || !c.site?.persona} onClick={() => void run(false)} title="Run the test chat and score it (about 1–2 minutes)"
          className="press chip-raised flex h-9 items-center gap-1.5 px-3 text-[12.5px] disabled:opacity-40"><Icon name="chat" size={13} /> Test</button>
        <button disabled={!!busy || !c.site?.persona} onClick={() => void run(true)} title="Test; if she doesn't pass, rewrite her chat lines (and persona, if that's the cause) from what it found and test again — twice at most, keeping whichever scored better"
          className={cx("press flex h-9 items-center gap-1.5 px-3.5 text-[12.5px] font-semibold disabled:opacity-40", state === "pass" ? "btn-raised" : "btn-primary")}><Icon name="sparkle" size={13} /> Test & fix</button>
        <button onClick={() => setSetupOpen(!setupOpen)} aria-expanded={setupOpen} title="What she's tested with and who reviews it — shared by every character"
          className={cx("press flex h-9 items-center gap-1.5 px-2.5 text-[12px]", setupOpen ? "text-ink" : "text-muted hover:text-ink")}><Icon name="layers" size={13} /> Setup · {setup.chats.length} real chats</button>
        {t && <button onClick={() => setOpen(!open)} aria-expanded={open} className="press flex h-9 w-9 items-center justify-center text-muted hover:text-ink" title={open ? "Hide" : "Show what it found"}>
          <Icon name={open ? "up" : "down"} size={14} /></button>}
      </div>

      {setupOpen && <TestSetup />}
      {t && open && (
        <div className="flex flex-col gap-4 border-t border-line p-3 text-[12.5px]">
          {t.prompt === "stand-in" && <p className="border-l-2 border-accent/60 pl-2 text-muted">Tested with the stand-in chat prompt. For an exact test, add the site's <span className="font-mono">system-prompt-v4.1.md</span> as the “Chat test · her chat” prompt file.</p>}
          {t.note && <p className="text-muted">{t.note}</p>}
          {t.realism !== undefined && <p className="text-muted"><b className={cx("font-mono", t.realism >= 0.85 ? "text-good" : t.realism >= 0.75 ? "text-ink" : "text-bad")}>{Math.round(t.realism * 100)}%</b> of her {[...t.turns, ...t.cold, ...(t.extras ?? []).flatMap((x) => x.turns)].length} replies read as real and in context to {t.reviewer ?? "the reviewer"}{t.extras?.length ? ` · ${t.extras.length} real user chat${t.extras.length === 1 ? "" : "s"} included` : ""}</p>}

          {/* the reviewer's scores */}
          {t.judge && <div className="grid grid-cols-5 gap-2">
            {DIMS.map(([k, l]) => { const v = t.judge![k]; return (
              <div key={k}>
                <div className="flex items-baseline justify-between"><span className="text-muted">{l}</span><b className={cx("font-mono", v >= 4 ? "text-good" : v >= 3 ? "text-ink" : "text-bad")}>{v}</b></div>
                <div className="mt-1 h-[3px] bg-line"><div className={cx("h-full", v >= 4 ? "bg-good" : v >= 3 ? "bg-ink/60" : "bg-bad")} style={{ width: `${(v / 5) * 100}%` }} /></div>
              </div>); })}
          </div>}

          {/* the checks, failures first */}
          <ul className="grid gap-x-6 gap-y-1.5 md:grid-cols-2">
            {[...t.checks].sort((a, b) => Number(a.ok) - Number(b.ok)).map((k) => (
              <li key={k.key} className="flex min-w-0 items-start gap-2">
                <span className={cx("mt-[2px] flex h-3.5 w-3.5 shrink-0 items-center justify-center border", k.ok ? "border-good/60 text-good" : k.hard ? "border-bad bg-bad/20 text-bad" : "border-bad/60 text-bad")}>
                  <Icon name={k.ok ? "check" : "x"} size={9} /></span>
                <span className="min-w-0"><span className={k.ok ? "text-muted" : "text-ink"}>{k.label}</span>{k.detail && <span className={cx("block truncate", k.ok ? "text-dim" : "text-bad/90")} title={k.detail}>{k.detail}</span>}</span>
              </li>))}
          </ul>

          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-dim">
            <span>{t.stats.wordsPerText} words/text</span><span>{t.stats.questionTail}% end on ?</span><span>{t.stats.singleText}% single text</span>
            <span>{t.stats.loops} loops</span><span>{t.stats.signatureRate}% her words</span><span>{t.stats.regens} rewrites by the guard</span>
          </div>

          {!!t.worst?.length && <div>
            <p className="mb-1.5 text-muted">Weakest replies</p>
            <ul className="flex flex-col gap-1.5">{t.worst.map((w, i) => (
              <li key={i} className="border-l-2 border-bad/50 pl-2"><span className="text-ink">“{w.quote}”</span> <span className="font-mono text-[11px] text-dim">{String(w.turn).startsWith("#") || String(w.turn).includes("#") ? w.turn : `#${w.turn}`}</span><span className="block text-muted">{w.why}</span></li>))}</ul>
          </div>}

          {t.fixes && !!Object.keys(t.fixes).length && <div>
            <p className="mb-1.5 text-muted">{t.pass ? "Could still be better" : "What Test & fix changes"}</p>
            <ul className="flex flex-col gap-1">{Object.entries(t.fixes).map(([k, v]) => <li key={k}><span className="micro mr-2 text-accent">{k}</span><span className="text-ink">{v}</span></li>)}</ul>
          </div>}

          {!!t.rounds && t.rounds.length > 1 && <p className="text-muted">Rounds: {t.rounds.map((r, i) => <span key={i} className={cx("font-mono", r.kept ? "text-good" : "text-dim")}>{i ? " → " : ""}{r.score}{r.kept ? " (kept)" : ""}</span>)}</p>}

          <button onClick={() => setChat(!chat)} className="press self-start text-accent hover:underline">{chat ? "Hide the test chats" : `Read the test chats (${t.turns.length + t.cold.length + (t.extras ?? []).reduce((a, x) => a + x.turns.length, 0)} messages)`}</button>
          {chat && <Transcript t={t} greeting={c.site?.greeting} />}
        </div>)}
    </section>
  );
}

function Transcript({ t, greeting }: { t: ChatTestResult; greeting?: string }) {
  const [onlyFlags, setOnlyFlags] = useState(false);
  const Him = ({ m }: { m: string }) => <div className="ml-auto max-w-[70%] bg-hover px-2.5 py-1.5 text-ink">{m}</div>;
  const Her = ({ b, flag }: { b: string; flag?: boolean }) => <div className={cx("max-w-[75%] border px-2.5 py-1.5", flag ? "border-bad/60" : "border-line", /^\[(photo|voice note)/i.test(b) ? "italic text-muted" : "text-ink")}>{b}</div>;
  const block = (turns: Turn[]) => turns.filter((x) => !onlyFlags || x.flag).map((x) => (
    <div key={x.id ?? x.n} className="flex flex-col gap-1">
      <Him m={x.him} />
      {x.her.map((b, i) => <Her key={i} b={b} flag={!!x.flag} />)}
      {x.flag && <span className="text-[11.5px] text-bad"><span className="micro mr-1.5">{x.flag.label.replace(/_/g, " ")}</span>{x.flag.why}</span>}
      {!!x.regen && <span className="font-mono text-[10.5px] text-dim">rewritten {x.regen}× by the guard{x.firstHits ? ` (${x.firstHits.slice(0, 2).join("; ")})` : ""}</span>}
    </div>));
  const Sep = ({ children }: { children: string }) => <p className="micro my-1 text-center text-dim">{children}</p>;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-[12px] text-muted"><input type="checkbox" checked={onlyFlags} onChange={(e) => setOnlyFlags(e.target.checked)} className="accent-[var(--color-accent)]" /> Only the replies the reviewer flagged</label>
      <div className="inset flex max-h-[560px] flex-col gap-2.5 overflow-y-auto border p-3">
        {greeting && !onlyFlags && <div className="flex flex-col gap-1">{greeting.split(/\n+/).filter(Boolean).map((b, i) => <Her key={i} b={b} />)}</div>}
        {block(t.turns)}
        {(!onlyFlags || t.cold.some((x) => x.flag)) && <><Sep>A new chat · cold open</Sep>{block(t.cold)}</>}
        {(t.extras ?? []).filter((x) => !onlyFlags || x.turns.some((y) => y.flag)).map((x, i) => <div key={i} className="flex flex-col gap-2.5"><Sep>{`A real user's chat${x.tags.length ? ` · ${x.tags.join(", ")}` : ""}`}</Sep>{block(x.turns)}</div>)}
      </div>
    </div>
  );
}

/** shared by every character: the real users' chats she's tested with, the cloud reviewer, the Candy reference, the rounds */
function TestSetup() {
  const st = useChatTests();
  const toast = useJobs((s) => s.toast);
  const file = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState("");
  const [orOn, setOrOn] = useState<boolean | null>(null);
  useEffect(() => { void fetch("/studio-api/judge").then((r) => r.json()).then((d) => setOrOn(!!d.openrouter)).catch(() => setOrOn(null)); }, []);
  const load = async (f: File) => {
    const { readChats } = await import("../lib/testChats");
    const chats = readChats(await f.text());
    if (!chats.length) { toast("No usable chats in that file — it needs his messages (one per line, or lines starting user: / him:)", "bad"); return; }
    setChatTests({ chats });
    toast(`${chats.length} real chats ready for testing (his side only, emails, numbers and links taken out)`, "good");
  };
  const download = async () => {
    const { formatChats } = await import("../lib/testChats");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([formatChats(st.chats)], { type: "text/plain" }));
    a.download = "urgf-test-chats.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const tagCount = st.chats.reduce<Record<string, number>>((m, c) => { c.tags.forEach((g) => (m[g] = (m[g] ?? 0) + 1)); return m; }, {});
  const saveKey = async () => {
    const r = await fetch("/studio-api/judge/key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error ?? "That key didn't work", "bad"); return; }
    setOrOn(!!d.openrouter); setKey(""); toast(d.openrouter ? "OpenRouter key kept on this rental" : "OpenRouter key removed", "good");
  };
  return (
    <div className="flex flex-col gap-4 border-t border-line bg-panel2 p-3 text-[12.5px]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-[13px] font-semibold text-ink">Real users' chats</p>
          <input ref={file} type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} />
          <button onClick={() => file.current?.click()} className="press chip-raised flex h-8 items-center gap-1.5 px-3 text-[12.5px]"><Icon name="up" size={12} /> Upload .txt</button>
          {!!st.chats.length && <button onClick={() => void download()} className="press chip-raised flex h-8 items-center gap-1.5 px-3 text-[12.5px]"><Icon name="down" size={12} /> Download cleaned</button>}
          {!!st.chats.length && <button onClick={() => setChatTests({ chats: [] })} className="press flex h-8 items-center px-2 text-[12px] text-muted hover:text-bad">Clear</button>}
        </div>
        <p className="mt-1.5 text-muted">{st.chats.length
          ? `${st.chats.length} chats · ${Object.entries(tagCount).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${n} ${g}`).join(" · ")}`
          : "Upload an export of real chats: only his messages are kept, emails, numbers, links and @names are taken out, and only the chats that stress her (heat, kinks, other languages, “are you real”, money, rude, long) are kept — near-copies and plain “hey / how are you” chats are dropped."}</p>
        <label className="mt-2 flex items-center gap-2 text-muted">Real chats per test
          <input type="number" min={0} max={8} value={st.perTest} onChange={(e) => setChatTests({ perTest: Math.max(0, Math.min(8, Number(e.target.value) || 0)) })} className="inset h-7 w-14 border px-2 text-ink" />
          <span className="text-dim">each about 1 minute more; the same ones every time for the same character, so retests compare fairly</span></label>
      </div>
      <div>
        <p className="mb-1.5 text-[13px] font-semibold text-ink">Who reviews the chats</p>
        <div className="flex flex-wrap gap-1.5">
          {([["deepseek-pro", "DeepSeek V4 Pro"], ["deepseek", "DeepSeek V4 Flash"], ["openrouter", "Any model on OpenRouter"]] as [JudgeProvider, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setChatTests({ judge: v })} className={cx("press tag-btn !h-8 !px-3 !text-[12.5px]", st.judge === v && "on")}>{l}</button>))}
        </div>
        {st.judge === "openrouter" && <div className="mt-2 flex flex-wrap items-end gap-2">
          <TextIn className="min-w-[220px] flex-1" label="Model id on OpenRouter" value={st.orModel} onChange={(v) => setChatTests({ orModel: v.trim() })} placeholder="the model's id, as OpenRouter lists it" />
          <TextIn className="min-w-[220px] flex-1" label={orOn ? "OpenRouter key · kept on this rental (paste a new one to replace)" : "OpenRouter key"} value={key} onChange={setKey} placeholder="sk-or-…" />
          <button disabled={!key.trim() && !orOn} onClick={() => void saveKey()} className="press chip-raised h-9 px-3 text-[12.5px] disabled:opacity-40">{key.trim() ? "Keep key" : "Remove key"}</button>
        </div>}
        <p className="mt-1.5 text-dim">It reads every one of her replies against her background and flags the weird, off-context, out-of-character, robotic, repeated, cold or overlong ones. Some models refuse to read adult chats — DeepSeek doesn't.</p>
      </div>
      <TextArea label="Candy reference (optional) · paste a few Candy.ai chats that show the level to match" rows={4} value={st.reference} onChange={(v) => setChatTests({ reference: v.slice(0, 12000) })} />
      <label className="flex items-center gap-2 text-muted">Fix rounds when she fails
        <input type="number" min={0} max={4} value={st.rounds} onChange={(e) => setChatTests({ rounds: Math.max(0, Math.min(4, Number(e.target.value) || 0)) })} className="inset h-7 w-14 border px-2 text-ink" />
        <span className="text-dim">each rewrites from what the reviewer flagged and tests again; the better version is kept</span></label>
    </div>
  );
}
