// What every graphics card is doing right now, and what's waiting — the router's own view (/h3-router), refreshed every
// few seconds while it's on screen. One tile per card: planning / video / other, with the job's name on hover; then the
// line, in the order it will be handed out (plans first, then the rest). Only shown when the rental has several cards.
import { useEffect, useState } from "react";
import { useJobs } from "../lib/jobs";
import { cx } from "./ui";

interface RouterInfo {
  cards: number; writer_card: number | null; card_jobs: string[][]; card_pids?: string[][]; line: string[]; line_pids?: string[];
  up: boolean[]; warm?: (string | null)[]; raylight_running?: string | null;
}
const WORD: Record<string, string> = { writer: "planning", video: "video", other: "picture" };

export function CardStrip() {
  const [info, setInfo] = useState<RouterInfo | null>(null);
  const jobs = useJobs((s) => s.jobs);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try { const r = await fetch("/h3-router", { cache: "no-store" }); if (r.ok && live) setInfo(await r.json()); } catch { /* one card: no router */ }
    };
    tick(); const t = setInterval(tick, 3000);
    return () => { live = false; clearInterval(t); };
  }, []);
  if (!info || info.cards < 2) return null;
  const label = (pid?: string) => (pid && jobs.find((j) => j.id === pid)?.label) || "";
  const count = (k: string) => info.line.filter((x) => x.startsWith(k)).length;
  const plans = count("writer"), videos = count("video"), others = info.line.length - plans - videos;
  const parts = [plans && `${plans} plan${plans === 1 ? "" : "s"}`, videos && `${videos} video${videos === 1 ? "" : "s"}`, others && `${others} other`].filter(Boolean);
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-1.5 text-[12px]" aria-label="What each card is doing">
      <span className="mr-1 text-muted">Cards</span>
      {Array.from({ length: info.cards }, (_, i) => {
        const kind = info.card_jobs[i]?.[0];
        const name = label(info.card_pids?.[i]?.[0]);
        const down = info.up[i] === false;
        return (
          <span key={i} title={down ? `Card ${i + 1} isn't answering` : kind ? `Card ${i + 1}: ${name || WORD[kind] || kind}` : `Card ${i + 1}: free${i === info.writer_card ? " (kept ready for planning while you're planning)" : ""}`}
            className={cx("flex h-6 items-center gap-1 rounded border px-1.5 tabular-nums",
              down ? "border-bad/60 text-bad" : kind === "writer" ? "border-accent/60 text-accent" : kind ? "border-good/50 text-good" : "border-line text-dim")}>
            {i + 1}<span className="text-[11px]">{down ? "down" : kind ? WORD[kind] ?? kind : "free"}</span>
          </span>
        );
      })}
      <span className={cx("ml-1", info.line.length ? "text-ink" : "text-dim")}>
        {info.line.length ? `In line: ${parts.join(", ")} — plans go first` : "Nothing waiting"}
      </span>
    </div>
  );
}
