// The idle shutdown, from the Studio's side: using the page (click, type, scroll) tells the rental you're here, and
// 5 minutes before it would shut itself down a bar says so, with "Keep it on".
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getStatus, markUsed } from "../lib/api";
import { useJobs } from "../lib/jobs";

const WARN_S = 300;

export function IdleGuard() {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const sent = useRef(0);

  // using the page counts as being here — at most once a minute
  useEffect(() => {
    const used = () => { if (Date.now() - sent.current > 60_000) { sent.current = Date.now(); markUsed(); } };
    const evs = ["pointerdown", "keydown", "wheel"] as const;
    evs.forEach((e) => window.addEventListener(e, used, { passive: true, capture: true }));
    used();
    return () => evs.forEach((e) => window.removeEventListener(e, used, { capture: true }));
  }, []);

  useEffect(() => {
    const poll = () => getStatus().then((st) => {
      const s = st?.auto_shutdown_in_s;
      setDeadline(s != null && s <= WARN_S + 30 ? Date.now() + s * 1000 : null);
    });
    poll();
    const t = setInterval(poll, 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (deadline == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  // the tab's title shows it too, for when the Studio is behind other windows
  const left = deadline == null ? null : Math.max(0, Math.round((deadline - now) / 1000));
  useEffect(() => {
    if (left == null || left > WARN_S) return;
    const old = document.title;
    document.title = `⏻ Shuts down in ${Math.ceil(left / 60)} min — H3 Studio`;
    return () => { document.title = old; };
  }, [left == null || left > WARN_S ? null : Math.ceil(left / 60)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (left == null || left > WARN_S) return null;
  const keep = async (hours: number) => {
    sent.current = Date.now();
    await markUsed(hours);
    setDeadline(null);
    useJobs.getState().toast(hours ? `Kept on for ${hours} hours — it won't shut down before then` : "Kept on — the countdown starts over", "good");
  };
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return createPortal(
    <div role="alert" className="fade-in fixed inset-x-0 top-[68px] z-[90] mx-auto flex w-fit max-w-[calc(100vw-24px)] flex-wrap items-center gap-3 rounded-xl border border-accent/70 bg-raised2/95 px-4 py-2.5 shadow-2xl backdrop-blur">
      <span className="text-[13px] text-ink">
        Nobody's used this rental for a while — it shuts down in <b className="tabular-nums">{mm}</b>
        <span className="text-muted"> (your work is saved to your drive first)</span>
      </span>
      <button onClick={() => keep(0)} className="press btn-primary h-8 rounded-lg px-3 text-[12.5px] font-semibold text-accentink">Keep it on</button>
      <button onClick={() => keep(2)} className="press btn-raised h-8 rounded-lg px-3 text-[12.5px] text-ink">Keep on for 2 hours</button>
    </div>, document.body);
}
