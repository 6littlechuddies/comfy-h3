import { useRef } from "react";
import { fmt, moveBoundary, normalise, parseTime, uid, type Timeline } from "../lib/timeline";
import { Btn, Icon, cx } from "./ui";

const CUT_COLORS = ["#F0A845", "#5B8DEF", "#4CC38A", "#E07BB0", "#9AA4FF", "#E0B85B"];

/** visual timeline: cut lanes with draggable boundaries, speech markers, sound lanes */
export function TimelineBar({ t, seconds, onChange }: { t: Timeline; seconds: number; onChange: (t: Timeline) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = box.current!;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      onChange(moveBoundary(t, i, ((ev.clientX - r.left) / r.width) * seconds));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const pct = (v: number) => `${(v / seconds) * 100}%`;
  const ticks = Array.from({ length: Math.floor(seconds) + 1 }, (_, i) => i).filter((i) => seconds <= 10 || i % 2 === 0);
  return (
    <div className="rounded-[10px] border border-line bg-raised/60 px-4 py-3.5">
      <div className="relative mb-1 h-4">{ticks.map((i) => <span key={i} className="absolute -translate-x-1/2 font-mono text-[10px] text-dim" style={{ left: pct(i) }}>{i}s</span>)}</div>
      <div ref={box} className="relative">
        <div className="relative h-9">
          {t.cuts.map((c, i) => (
            <div key={c.id} className="absolute inset-y-0 flex items-center overflow-hidden rounded-md border px-2.5 text-xs"
              style={{ left: pct(c.start), width: `calc(${pct(c.end - c.start)} - 3px)`, borderColor: CUT_COLORS[i % 6], background: `${CUT_COLORS[i % 6]}22` }}>
              <span className="truncate">Cut {i + 1}{c.shot ? ` · ${c.shot}` : ""}</span>
            </div>
          ))}
          {t.cuts.slice(0, -1).map((c, i) => (
            <div key={c.id + "b"} role="slider" aria-label={`Move the change between cut ${i + 1} and ${i + 2}`} aria-valuenow={c.end} tabIndex={0}
              onPointerDown={drag(i)}
              onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") onChange(moveBoundary(t, i, c.end + (e.key === "ArrowLeft" ? -0.1 : 0.1))); }}
              className="absolute inset-y-[-4px] z-10 w-3 -translate-x-1/2 cursor-ew-resize rounded bg-ink/80 hover:bg-white" style={{ left: `calc(${pct(c.end)} - 1.5px)` }} />
          ))}
        </div>
        <div className="relative mt-1.5 h-7">
          {t.sounds.map((s) => (
            <div key={s.id} className="absolute top-0 flex h-6 items-center overflow-hidden rounded-md border border-[#3E7A55] bg-[#1F2A22] px-2 text-[11px]"
              style={{ left: pct(s.start), width: pct(Math.max(0.3, s.end - s.start)) }}><span className="truncate">{s.text}</span></div>
          ))}
        </div>
        {t.says.map((s) => (
          <div key={s.id} className="absolute top-0 z-20 h-[72px] w-0.5 bg-purple" style={{ left: pct(s.at) }} title={`${fmt(s.at)} · "${s.words}"`}>
            <span className="absolute -top-1 left-1 whitespace-nowrap rounded bg-[#3B2440] px-1.5 text-[10px]">“{s.words.slice(0, 18)}{s.words.length > 18 ? "…" : ""}”</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">Drag the white handles to change when each cut starts. Everything below updates.</p>
    </div>
  );
}

function TimeIn({ v, onChange, label }: { v: number; onChange: (v: number) => void; label: string }) {
  return (
    <input aria-label={label} defaultValue={fmt(v)} key={v}
      onBlur={(e) => { const p = parseTime(e.target.value); if (p != null) onChange(p); else e.target.value = fmt(v); }}
      className="h-7 w-14 rounded border border-line bg-panel px-1 text-center font-mono text-xs focus:border-accent focus:outline-none" />
  );
}

/** the editable list of moments */
export function Moments({ t, seconds, onChange }: { t: Timeline; seconds: number; onChange: (t: Timeline) => void }) {
  const up = (p: Partial<Timeline>) => onChange(normalise({ ...t, ...p }, seconds));
  const area = "min-h-[28px] w-full resize-none rounded border border-transparent bg-transparent px-1.5 py-1 text-[13px] leading-relaxed text-ink hover:border-line focus:border-accent focus:outline-none";
  return (
    <div className="flex flex-col gap-2">
      {t.cuts.map((c, i) => (
        <div key={c.id} className="flex items-start gap-2 rounded-lg border border-line bg-raised px-2.5 py-2">
          <div className="flex w-[84px] shrink-0 flex-col gap-1 pt-0.5">
            <span className="font-mono text-xs" style={{ color: CUT_COLORS[i % 6] }}>{fmt(c.start)}–{fmt(c.end)}</span>
            <span className="text-[11px] text-muted">Cut {i + 1}</span>
          </div>
          <div className="min-w-0 flex-1">
            <input value={c.shot} placeholder="shot & camera (e.g. close-up, slow push in)" aria-label="Shot"
              onChange={(e) => onChange({ ...t, cuts: t.cuts.map((x) => (x.id === c.id ? { ...x, shot: e.target.value } : x)) })}
              className="h-7 w-full rounded border border-transparent bg-transparent px-1.5 text-xs text-muted hover:border-line focus:border-accent focus:outline-none" />
            <textarea rows={2} value={c.text} aria-label="What happens" onChange={(e) => onChange({ ...t, cuts: t.cuts.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) })} className={area} />
          </div>
          <div className="flex flex-col gap-1">
            <button title="Split this cut in two" className="text-muted hover:text-ink" onClick={() => {
              const mid = Math.round(((c.start + c.end) / 2) * 10) / 10;
              const cuts = t.cuts.flatMap((x) => (x.id === c.id ? [{ ...x, end: mid }, { id: uid(), start: mid, end: x.end, shot: "", text: "" }] : [x]));
              up({ cuts });
            }}><Icon name="plus" size={14} /></button>
            {t.cuts.length > 1 && <button title="Remove this cut" className="text-muted hover:text-bad" onClick={() => up({ cuts: t.cuts.filter((x) => x.id !== c.id) })}><Icon name="x" size={14} /></button>}
          </div>
        </div>
      ))}
      {t.says.map((s) => (
        <div key={s.id} className="flex items-start gap-2 rounded-lg border border-purple/40 bg-raised px-2.5 py-2">
          <div className="flex w-[84px] shrink-0 flex-col gap-1"><TimeIn label="Time" v={s.at} onChange={(v) => up({ says: t.says.map((x) => (x.id === s.id ? { ...x, at: v } : x)) })} /><span className="text-[11px] text-purple">speech</span></div>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
            <input value={s.who} placeholder="who (e.g. <Picture 1>)" aria-label="Who speaks" onChange={(e) => onChange({ ...t, says: t.says.map((x) => (x.id === s.id ? { ...x, who: e.target.value } : x)) })} className="h-7 rounded border border-line bg-panel px-1.5 text-xs" />
            <input value={s.voice} placeholder="voice (e.g. <Audio 1>) — optional" aria-label="Voice" onChange={(e) => onChange({ ...t, says: t.says.map((x) => (x.id === s.id ? { ...x, voice: e.target.value } : x)) })} className="h-7 rounded border border-line bg-panel px-1.5 text-xs" />
            <textarea rows={1} value={s.words} placeholder="the exact words" aria-label="Words" onChange={(e) => onChange({ ...t, says: t.says.map((x) => (x.id === s.id ? { ...x, words: e.target.value } : x)) })} className={cx(area, "col-span-2")} />
          </div>
          <button title="Remove" className="text-muted hover:text-bad" onClick={() => up({ says: t.says.filter((x) => x.id !== s.id) })}><Icon name="x" size={14} /></button>
        </div>
      ))}
      {t.sounds.map((s) => (
        <div key={s.id} className="flex items-start gap-2 rounded-lg border border-good/30 bg-raised px-2.5 py-2">
          <div className="flex w-[84px] shrink-0 flex-col gap-1">
            <div className="flex items-center gap-0.5"><TimeIn label="Start" v={s.start} onChange={(v) => up({ sounds: t.sounds.map((x) => (x.id === s.id ? { ...x, start: v } : x)) })} /></div>
            <div className="flex items-center gap-0.5"><TimeIn label="End" v={s.end} onChange={(v) => up({ sounds: t.sounds.map((x) => (x.id === s.id ? { ...x, end: v } : x)) })} /></div>
          </div>
          <textarea rows={2} value={s.text} aria-label="Sound" placeholder="music, effects, ambience" onChange={(e) => onChange({ ...t, sounds: t.sounds.map((x) => (x.id === s.id ? { ...x, text: e.target.value } : x)) })} className={area} />
          <button title="Remove" className="text-muted hover:text-bad" onClick={() => up({ sounds: t.sounds.filter((x) => x.id !== s.id) })}><Icon name="x" size={14} /></button>
        </div>
      ))}
      <div className="grid grid-cols-3 gap-1.5">
        <Btn className="w-full border-dashed" onClick={() => { const last = t.cuts[t.cuts.length - 1]; const mid = Math.round(((last.start + last.end) / 2) * 10) / 10; up({ cuts: [...t.cuts.slice(0, -1), { ...last, end: mid }, { id: uid(), start: mid, end: last.end, shot: "", text: "" }] }); }}>+ Cut</Btn>
        <Btn className="w-full border-dashed" onClick={() => up({ says: [...t.says, { id: uid(), at: Math.min(seconds, 1), who: "", voice: "", words: "" }] })}>+ Speech</Btn>
        <Btn className="w-full border-dashed" onClick={() => up({ sounds: [...t.sounds, { id: uid(), start: 0, end: seconds, text: "" }] })}>+ Sound</Btn>
      </div>
    </div>
  );
}
