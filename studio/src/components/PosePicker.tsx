// "Pose" in the prompt box: pick how bold, a camera angle and one pose — its limb-by-limb words go into the box as typed.
import { useEffect, useRef, useState } from "react";
import { CAMERAS, LEVELS, POSES, insertPose, poseWords, type Level } from "../lib/poses";
import { cx } from "./ui";

export function PosePicker({ value, onChange, mode }: { value: string; onChange: (v: string) => void; mode: "describe" | "instruct" }) {
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState(false); // near the top of the screen the list opens downward
  const [level, setLevel] = useState<Level>(() => { try { return (Number(localStorage.getItem("h3.pose.level")) || 0) as Level; } catch { return 0; } });
  const [cam, setCam] = useState(() => { try { return localStorage.getItem("h3.pose.cam") || "eye"; } catch { return "eye"; } });
  const last = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  const remember = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const bolder = CAMERAS.find((c) => c.id === cam)?.bolder ?? 0;
  const pick = (id: string) => {
    const p = POSES[level].find((x) => x.id === id)!;
    const w = poseWords(p, cam, mode);
    onChange(insertPose(value, last.current, w));
    last.current = w;
    setOpen(false);
  };
  return (
    <div ref={box} className="relative" data-esc-own>
      <button type="button" onClick={(e) => { setBelow(e.currentTarget.getBoundingClientRect().top < 460); setOpen((o) => !o); }} aria-expanded={open} title="Add a pose — one pose, written limb by limb, goes into the box as typed"
        className={cx("press inline-flex h-8 items-center gap-1 rounded-sm px-2 text-[12px]", open ? "text-accent" : "text-muted hover:text-ink")}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="4.5" r="2" /><path d="M12 7v7M7 10l5-2 5 2M9 21l3-7 3 7" /></svg>Pose
      </button>
      {open && (
        <div role="dialog" aria-label="Pick a pose" className={cx("absolute right-0 z-40 w-[min(560px,calc(100vw-32px))] border border-line bg-panel p-3 shadow-2xl", below ? "top-full mt-2" : "bottom-full mb-2")}>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="How bold">
            {LEVELS.map((l) => (
              <button key={l.level} role="tab" aria-selected={level === l.level} title={l.hint} onClick={() => { setLevel(l.level); remember("h3.pose.level", String(l.level)); }}
                className={cx("press h-7 border px-2.5 text-[12px]", level === l.level ? "border-accent text-accent" : "border-line text-muted hover:text-ink")}>{l.name}</button>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-dim">{LEVELS[level].hint}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11.5px] text-muted">Camera</span>
            {CAMERAS.map((c) => (
              <button key={c.id} onClick={() => { setCam(c.id); remember("h3.pose.cam", c.id); }} aria-pressed={cam === c.id}
                className={cx("press h-6 border px-2 text-[11.5px]", cam === c.id ? "border-accent text-accent" : "border-line2 text-muted hover:text-ink")}>{c.name}</button>
            ))}
            {bolder > 0 && <span className="ml-1 text-[11px] text-dim">reads one level bolder</span>}
          </div>
          <div className="mt-2.5 grid max-h-[300px] gap-1 overflow-y-auto pr-1">
            {POSES[level].map((p) => (
              <button key={p.id} onClick={() => pick(p.id)} className="press group border border-line2 px-2.5 py-2 text-left hover:border-accent">
                <span className="block text-[12.5px] font-medium text-ink group-hover:text-accent">{p.name}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-dim">{p.words}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-dim">One pose per picture — picking another replaces the one you added. How bold it reads = the pose × the camera × how much she's wearing (say that in your own words).</p>
        </div>
      )}
    </div>
  );
}
