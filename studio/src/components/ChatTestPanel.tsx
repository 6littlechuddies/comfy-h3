// Her chat test on the site page: the verdict up top (passed / failed / not tested, the score, when), the two buttons, then
// what it found — the reviewer's five scores, the checks (failures first), the rhythm numbers, the weakest replies and what
// the fix changes — and the whole test chat as bubbles.
import { useState } from "react";
import type { Character } from "../lib/characters";
import type { ChatTestResult } from "../lib/chatTest";
import { useJobs } from "../lib/jobs";
import { Icon, cx } from "./ui";

const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const DIMS: [keyof NonNullable<ChatTestResult["judge"]>, string][] = [["realism", "Real"], ["voice", "Her voice"], ["hooks", "Hooks"], ["heat", "Heat"], ["consistency", "Consistent"]];

export function ChatTestPanel({ c, busy, setBusy }: { c: Character; busy: string | undefined; setBusy: (t: string | null) => void }) {
  const t = c.site?.chatTest;
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState(false);
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
        {t && <button onClick={() => setOpen(!open)} aria-expanded={open} className="press flex h-9 w-9 items-center justify-center text-muted hover:text-ink" title={open ? "Hide" : "Show what it found"}>
          <Icon name={open ? "up" : "down"} size={14} /></button>}
      </div>

      {t && open && (
        <div className="flex flex-col gap-4 border-t border-line p-3 text-[12.5px]">
          {t.prompt === "stand-in" && <p className="border-l-2 border-accent/60 pl-2 text-muted">Tested with the stand-in chat prompt. For an exact test, add the site's <span className="font-mono">system-prompt-v4.1.md</span> as the “Chat test · her chat” prompt file.</p>}
          {t.note && <p className="text-muted">{t.note}</p>}

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
              <li key={i} className="border-l-2 border-bad/50 pl-2"><span className="text-ink">“{w.quote}”</span> <span className="font-mono text-[11px] text-dim">#{w.turn}</span><span className="block text-muted">{w.why}</span></li>))}</ul>
          </div>}

          {t.fixes && !!Object.keys(t.fixes).length && <div>
            <p className="mb-1.5 text-muted">{t.pass ? "Could still be better" : "What Test & fix changes"}</p>
            <ul className="flex flex-col gap-1">{Object.entries(t.fixes).map(([k, v]) => <li key={k}><span className="micro mr-2 text-accent">{k}</span><span className="text-ink">{v}</span></li>)}</ul>
          </div>}

          {!!t.rounds && t.rounds.length > 1 && <p className="text-muted">Rounds: {t.rounds.map((r, i) => <span key={i} className={cx("font-mono", r.kept ? "text-good" : "text-dim")}>{i ? " → " : ""}{r.score}{r.kept ? " (kept)" : ""}</span>)}</p>}

          <button onClick={() => setChat(!chat)} className="press self-start text-accent hover:underline">{chat ? "Hide the test chat" : `Read the test chat (${t.turns.length + t.cold.length} messages)`}</button>
          {chat && <Transcript t={t} greeting={c.site?.greeting} />}
        </div>)}
    </section>
  );
}

function Transcript({ t, greeting }: { t: ChatTestResult; greeting?: string }) {
  const Him = ({ m }: { m: string }) => <div className="ml-auto max-w-[70%] bg-hover px-2.5 py-1.5 text-ink">{m}</div>;
  const Her = ({ b, flag }: { b: string; flag?: boolean }) => <div className={cx("max-w-[75%] border px-2.5 py-1.5", flag ? "border-bad/50" : "border-line", /^\[(photo|voice note)/i.test(b) ? "italic text-muted" : "text-ink")}>{b}</div>;
  const bad = (n: number) => t.worst?.some((w) => w.turn === n);
  const block = (turns: ChatTestResult["turns"]) => turns.map((x) => (
    <div key={x.n} className="flex flex-col gap-1">
      <Him m={x.him} />
      {x.her.map((b, i) => <Her key={i} b={b} flag={bad(x.n)} />)}
      {!!x.regen && <span className="font-mono text-[10.5px] text-dim">rewritten {x.regen}× by the guard{x.firstHits ? ` (${x.firstHits.slice(0, 2).join("; ")})` : ""}</span>}
    </div>));
  return (
    <div className="inset flex max-h-[520px] flex-col gap-2.5 overflow-y-auto border p-3">
      {greeting && <div className="flex flex-col gap-1">{greeting.split(/\n+/).filter(Boolean).map((b, i) => <Her key={i} b={b} />)}</div>}
      {block(t.turns)}
      <p className="micro my-1 text-center text-dim">A new chat · cold open</p>
      {block(t.cold)}
    </div>
  );
}
