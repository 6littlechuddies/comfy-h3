import { useState } from "react";
import { useGroup } from "../lib/downloads";
import { useJobs } from "../lib/jobs";
import type { InputFile } from "../lib/api";
import type { Media } from "../lib/tray";

type Mask = InputFile & { url: string; box?: { x: number; y: number; width: number; height: number; W: number; H: number } };

/** Edit's prompt bar: "Select by words" — SAM 3 outlines what you name in picture 1; only that part is then redrawn */
export function SelectWords({ pic, onMask, onOpen }: { pic: Media; onMask: (m: Mask, note: string) => void; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useJobs((s) => s.toast);
  const sam = useGroup("sam");
  const find = async () => {
    if (!words.trim()) return;
    setBusy(true);
    try {
      const { selectByWords } = await import("../lib/faceDetail");
      const r = await selectByWords(pic.name, words.trim(), 16);
      if (!r) { toast(`SAM 3 couldn't find “${words.trim()}” in picture 1 — try other words (“hand”, “left arm”, “the cup”) or paint it`, "bad"); return; }
      onMask({ ...r.mask, box: r.box }, `Selected “${words.trim()}” — found ${r.found}, ${Math.round(r.best * 100)}% sure`);
      setOpen(false);
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  if (!open) return (
    <button onClick={() => { setOpen(true); onOpen?.(); }} disabled={!sam.ready} title={sam.ready ? "Name a part of picture 1 — only that part changes" : sam.why}
      className="press inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-raised2/70 px-3 text-[12.5px] font-medium text-ink hover:bg-hover disabled:opacity-50">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>Select by words</button>
  );
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-sm border border-accent/60 bg-raised2/70 pl-2 pr-1">
      <input autoFocus value={words} onChange={(e) => setWords(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") find(); if (e.key === "Escape") setOpen(false); }}
        placeholder="her right hand, the cup…" aria-label="What to select" className="h-full w-44 bg-transparent text-[12.5px] placeholder:text-dim focus:outline-none" />
      <button onClick={find} disabled={busy || !words.trim()} className="press h-6 rounded-sm bg-accent px-2 text-[12px] font-bold text-accentink disabled:opacity-50">{busy ? "Finding…" : "Find"}</button>
      <button onClick={() => setOpen(false)} className="px-1 text-[12px] text-muted hover:text-ink" aria-label="Close">✕</button>
    </span>
  );
}
