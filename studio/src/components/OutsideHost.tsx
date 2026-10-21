// The "Grok tab" panel: shows up (bottom right, doesn't block the page) when a prompt is waiting to be written by your
// Grok tab. With the H3 Grok helper installed and the Grok tab connected, it all happens by itself (the helper types the
// request into Grok and sends the reply back); otherwise copy → paste into Grok → copy the reply → back here.
import { useEffect, useRef, useState } from "react";
import { copyText } from "../lib/copy";
import { connectGrok, grokStatus, helperUrl, messageFor, relayAsk, settle, splitAnswer, useOutside, type OutsideReq } from "../lib/outside";
import { useJobs } from "../lib/jobs";
import { cx } from "./ui";

/** is a Grok tab with the helper connected to this rental? (checked every few seconds while shown) */
export function useGrokLink(on = true) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const look = async () => { const s = await grokStatus(); if (live) setOk(s.connected); };
    void look();
    const t = window.setInterval(look, 4000);
    return () => { live = false; window.clearInterval(t); };
  }, [on]);
  return ok;
}

/** "Connect your Grok tab" + "Install the helper (once)" */
export function GrokConnect({ connected }: { connected: boolean }) {
  const toast = useJobs.getState().toast;
  return connected
    ? <p className="text-[12px] text-good">Grok tab connected — prompts are written there by themselves.</p>
    : (
      <div className="flex flex-col gap-1 text-[12px] leading-relaxed text-muted">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => connectGrok().catch((e) => toast((e as Error).message, "bad"))} className="press btn-raised h-8 rounded-md px-3 text-[12.5px] font-medium">Connect Grok tab</button>
          <a href={helperUrl()} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-ink">Install the helper (once)</a>
        </div>
        <span className="text-dim">For hands-off: install Tampermonkey in your browser, then the helper; Connect opens Grok wired to this rental. Without it, copy &amp; paste works.</span>
      </div>
    );
}

/** a big Batch goes to Grok 10 prompts per message (longer replies get cut off) */
const PER_MESSAGE = 10;

export function OutsideHost() {
  const reqs = useOutside((s) => s.reqs);
  const connected = useGrokLink(reqs.length > 0);
  const [relaying, setRelaying] = useState(false);
  const stop = useRef({ cancelled: false });
  const [sent, setSent] = useState<number[]>([]);
  const [answer, setAnswer] = useState("");
  const [err, setErr] = useState("");
  const [small, setSmall] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const copied = useRef("");
  const seen = useRef("");
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem("h3.grokAuto") !== "off"; } catch { return true; } });
  const canRead = typeof window !== "undefined" && window.isSecureContext && !!navigator.clipboard?.readText;

  // the requests this answer is for: the ones you copied (or all waiting ones, if you haven't copied yet)
  const live = sent.filter((id) => reqs.some((r) => r.id === id));
  const forThis = live.length ? reqs.filter((r) => live.includes(r.id)) : reqs;
  const later = live.length ? reqs.length - live.length : 0;

  const connectedRef = useRef(false); connectedRef.current = connected;
  // the connected Grok tab writes them: one numbered message, one reply, split back into the requests
  const sendToGrok = async () => {
    const all = useOutside.getState().reqs;
    // a request with pictures goes on its own (the pictures are attached to that one message)
    const list = all[0]?.images?.length ? [all[0]] : all.filter((r) => !r.images?.length).slice(0, PER_MESSAGE);
    const images = list.length === 1 ? list[0].images : undefined;
    if (!list.length) return;
    setSent(list.map((r) => r.id)); setErr(""); setRelaying(true);
    const st = { cancelled: false }; stop.current = st;
    try {
      const text = await relayAsk(messageFor(list, true), st, images);
      if (st.cancelled) return;
      setRelaying(false);
      if (applyRef.current(text, list)) useJobs.getState().toast(list.length > 1 ? `Grok wrote ${list.length} prompts` : "Grok wrote it", "good");
      else setAnswer(text);
    } catch (e) {
      if (st.cancelled) return;
      setRelaying(false);
      // Grok couldn't look at the pictures (refused, upload failed): the local writer does that one quietly
      if (images?.length) { settle(list.map((r) => r.id), "local"); return; }
      setErr(`${(e as Error).message} — copied it for copy & paste instead.`);
      const msg = messageFor(list); copied.current = msg; seen.current = msg;
      await copyText(msg, "");
    }
  };
  const copy = async () => {
    stop.current.cancelled = true; setRelaying(false);
    if (!reqs.length) return;
    const part = reqs.slice(0, PER_MESSAGE);
    const ids = part.map((r) => r.id);
    setSent(ids); setErr("");
    const msg = messageFor(part);
    copied.current = msg; seen.current = msg;
    await copyText(msg, ids.length > 1 ? `Copied ${ids.length} requests as one message — paste it into Grok` : "Copied — paste it into Grok");
  };

  // copy by itself once requests stop arriving (a Batch adds them one after another)
  useEffect(() => {
    if (!reqs.length) { setSent([]); setAnswer(""); setErr(""); return; }
    if (live.length) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void grokStatus().then((g) => {
        if (g.connected || connectedRef.current) return sendToGrok();
        const pics = useOutside.getState().reqs.filter((r) => r.images?.length);
        if (pics.length) settle(pics.map((r) => r.id), "local");
        if (useOutside.getState().reqs.length) return copy();
      });
    }, 700);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqs.length]);

  const apply = (text: string, list: OutsideReq[] = forThis): boolean => {
    const parts = splitAnswer(text, list.length);
    if (typeof parts === "string") { setErr(parts); return false; }
    settle(list.map((r) => r.id), Object.fromEntries(list.map((r, i) => [r.id, parts[i]])));
    setAnswer(""); setErr(""); setSent([]);
    return true;
  };
  const applyRef = useRef(apply); applyRef.current = apply;
  const nRef = useRef(0); nRef.current = forThis.length;

  // automatic: press Grok's copy button under its reply, come back to this tab — the answer is read from the clipboard
  // and used by itself (needs the secure https link; the browser asks once to allow "see text copied to clipboard")
  useEffect(() => {
    if (!auto || !canRead || !reqs.length || !live.length || relaying) return;
    const look = async () => {
      if (document.visibilityState !== "visible") return;
      let t = "";
      try { t = (await navigator.clipboard.readText()).trim(); } catch { return; }
      if (!t || t === seen.current || t === copied.current.trim() || t.length < 20) return;
      seen.current = t;
      const multi = nRef.current > 1;
      // several requests: only take it when it really is Grok's numbered reply
      if (multi && !/answer\s*1\b/i.test(t)) return;
      if (applyRef.current(t)) useJobs.getState().toast(multi ? "Used Grok's answers — they're in the rows" : "Used Grok's answer", "good");
      else setAnswer(t);
    };
    const onVis = () => { void look(); };
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("focus", onVis); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, canRead, reqs.length, live.length, relaying]);

  if (!reqs.length) return null;
  const use = () => { apply(answer); };
  const pickAuto = (v: boolean) => { try { localStorage.setItem("h3.grokAuto", v ? "on" : "off"); } catch { /* private mode */ } setAuto(v); };
  const ids = forThis.map((r) => r.id);
  const n = forThis.length;

  return (
    <div className="fade-in fixed bottom-4 right-4 z-[55] w-[min(440px,calc(100vw-32px))]" role="dialog" aria-label="Waiting for your Grok answer">
      <div className="ticks frame card flex flex-col gap-3 border border-accent/60 p-4 shadow-2xl">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="display text-[15px] leading-tight">{n > 1 ? `${n} prompts waiting for Grok` : "Waiting for Grok"}</h2>
            <p className="truncate text-[12px] text-dim">{n > 1 ? `${forThis[0].label} and ${n - 1} more` : forThis[0].label}</p>
          </div>
          <button onClick={() => setSmall(!small)} className="press btn-raised h-7 rounded-md px-2 text-[12px]">{small ? "Open" : "Hide"}</button>
        </div>
        {!small && (
          <>
            {relaying && (
              <p className="shimmer text-[13px] text-ink">Your Grok tab is writing {n > 1 ? `all ${n}` : "it"}… <button onClick={copy} className="press ml-1 text-[12px] text-muted underline decoration-dotted hover:text-ink">Copy &amp; paste instead</button></p>
            )}
            {!relaying && <GrokConnect connected={connected} />}
            {!relaying && <ol className="flex flex-col gap-1 text-[12.5px] leading-relaxed text-muted">
              <li><b className="text-ink">1.</b> {live.length ? "Copied." : "Copying…"} Paste it into your Grok tab and send. <button onClick={copy} className="press ml-1 underline decoration-dotted hover:text-ink">Copy again</button></li>
              <li><b className="text-ink">2.</b> {auto && canRead ? "Press Grok's copy button under its reply and come back to this tab — it's used by itself." : "Copy Grok's whole reply and paste it below."}{n > 1 ? " It has one answer per request; they're split up by themselves." : ""}</li>
            </ol>}
            {!relaying && canRead
              ? <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted"><input type="checkbox" checked={auto} onChange={(e) => pickAuto(e.target.checked)} /> Use the copied reply by itself (the browser asks once to allow it)</label>
              : !relaying && <p className="text-[12px] text-dim">To have the reply used by itself, open the Studio on the secure link (⋯ → Secure link) — browsers only allow it there.</p>}
            <textarea value={answer} onChange={(e) => { setAnswer(e.target.value); setErr(""); }} rows={5} placeholder={auto && canRead ? "…or paste Grok's answer here" : "Paste Grok's answer here"}
              className="inset min-h-[110px] resize-y border px-2.5 py-2 font-mono text-[12px] leading-relaxed focus:border-accent focus:outline-none" />
            {err && <p className="text-[12.5px] text-bad">{err}</p>}
            {later > 0 && <p className="text-[12px] text-dim">{later} more arrived after you copied — they're next.</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => { stop.current.cancelled = true; setRelaying(false); settle(ids, "cancel"); }} className="press btn-raised h-9 rounded-lg px-3 text-[13px]">Cancel</button>
              <button onClick={() => { stop.current.cancelled = true; setRelaying(false); settle(ids, "local"); }} className="press btn-raised h-9 rounded-lg px-3 text-[13px]" title="Write these with the writer on the rental instead">Use the local writer</button>
              <button onClick={use} disabled={!answer.trim()} className={cx("press btn-primary chamfer-sm h-9 rounded-lg px-4 text-[13px] font-semibold", !answer.trim() && "opacity-50")}>Use this answer</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
