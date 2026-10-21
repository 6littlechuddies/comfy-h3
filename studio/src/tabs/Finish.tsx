import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { finishStatus, startFinish, viewUrl, type FileRef } from "../lib/api";
import { useJobs } from "../lib/jobs";
import { useSection } from "../lib/settings";
import { DRAG_TYPE, useTray, type Media } from "../lib/tray";
import { usePrimaryAction, useHandoffInto } from "../App";
import { Btn, H1, Icon, Label, Panel, PresetBar, Select, Seg, Slider, TextIn, cx, DropSelect } from "../components/ui";

interface Clip { id: string; media: Media; start: number; end: number }
const useClips = create<{ clips: Clip[]; sel: string | null; result: (FileRef & { duration: number }) | null }>(() => ({ clips: [], sel: null, result: null }));
let n = 0;

const ENDINGS = [
  { v: "once", t: "Play once", s: "no loop" },
  { v: "boomerang", t: "Boomerang", s: "forward, then reverse" },
  { v: "fade_start", t: "Fade to start", s: "back to frame 1" },
  { v: "fade_black", t: "Fade to black", s: "then restarts" },
] as const;
const SIZES = [
  { value: "same", label: "Same as the clip" }, { value: "1920x1080", label: "1920 × 1080 · Full HD" }, { value: "1080x1920", label: "1080 × 1920 · vertical HD" },
  { value: "1280x720", label: "1280 × 720 · HD" }, { value: "1080x1080", label: "1080 × 1080 · square" }, { value: "3840x2160", label: "3840 × 2160 · 4K (upscaled)" },
  { value: "custom", label: "Custom…" },
];

export default function FinishTab() {
  const [f, set] = useSection("finish");
  const { clips, sel, result } = useClips();
  const toast = useJobs((s) => s.toast);
  const [job, setJob] = useState<{ id: string; progress: number } | null>(null);
  const [over, setOver] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const setClips = (c: Clip[]) => useClips.setState({ clips: c });
  const add = (ms: Media[]) => {
    const vids = ms.filter((m) => m.kind === "video");
    if (vids.length < ms.length) toast("Only video clips can go on the Finish timeline", "bad");
    const next = [...useClips.getState().clips, ...vids.map((m) => ({ id: `k${n++}`, media: m, start: 0, end: m.duration ?? 5 }))];
    useClips.setState({ clips: next, sel: useClips.getState().sel ?? next[0]?.id ?? null });
  };
  useHandoffInto("finish", (items) => add(items.map((i) => i.media)));

  const total = clips.reduce((a, c) => a + (c.end - c.start), 0) - (f.transition !== "cut" ? f.transitionDur * Math.max(0, clips.length - 1) : 0);
  const why = !clips.length ? "Add at least one clip" : job ? "Exporting…" : undefined;
  const [W, H] = f.size === "same" ? [undefined, undefined] : f.size === "custom" ? [f.customW, f.customH] : f.size.split("x").map(Number);
  const exportIt = async () => {
    if (why) return;
    try {
      const id = await startFinish({
        clips: clips.map((c) => ({ filename: c.media.name, subfolder: "", type: "input", start: c.start, end: c.end })),
        transition: { type: f.transition, duration: f.transitionDur }, ending: f.ending, fade: f.fade, audio: f.audio, speed: f.speed,
        format: f.format, width: W, height: H,
      });
      setJob({ id, progress: 0 });
    } catch (e) { toast(`Export failed to start: ${(e as Error).message}`, "bad"); }
  };
  usePrimaryAction("finish", exportIt);
  useEffect(() => {
    if (!job) return;
    const t = setInterval(async () => {
      try {
        const s = await finishStatus(job.id);
        if (s.status === "running") setJob({ id: job.id, progress: s.progress });
        else {
          clearInterval(t); setJob(null);
          if (s.status === "done" && s.output) {
            useClips.setState({ result: s.output });
            useTray.getState().addOutput(s.output, "Export");
            toast("Export ready — saved to Outputs and backed up.", "good", "finish");
          } else toast(`Export failed: ${s.error?.split("\n").slice(-3).join(" ") ?? "unknown error"}`, "bad", "finish");
        }
      } catch { /* keep polling */ }
    }, 700);
    return () => clearInterval(t);
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = clips.find((c) => c.id === sel) ?? clips[0];
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const tid = e.dataTransfer.getData(DRAG_TYPE);
    try {
      if (tid) add([await useTray.getState().asMedia(tid)]);
      else if (e.dataTransfer.files?.length) add(await Promise.all(Array.from(e.dataTransfer.files).map((x) => useTray.getState().addUpload(x))));
    } catch (err) { toast((err as Error).message, "bad"); }
  };

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto p-5">
        <div className="flex items-center gap-3">
          <H1>Finish</H1><span className="text-[13px] text-muted">Trim, join clips, loop and export</span>
          <div className="ml-auto flex gap-2">
            {clips.length > 0 && <Btn onClick={() => useClips.setState({ clips: [], sel: null })}>Clear</Btn>}
            <Btn onClick={() => file.current?.click()}><Icon name="plus" size={14} /> Add clip</Btn>
            <input ref={file} type="file" accept="video/*" multiple hidden onChange={async (e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; try { add(await Promise.all(fs.map((x) => useTray.getState().addUpload(x)))); } catch (err) { toast((err as Error).message, "bad"); } }} />
          </div>
        </div>
        <Player clip={selected} />
        <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
          className={cx("rounded-[10px] border bg-raised/60 p-3.5", over ? "border-accent ring-2 ring-accent/40" : "border-line")}>
          {clips.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted">Drag videos here from the tray (or press “Trim, loop &amp; export” under any video).</p>
          ) : (
            <div className="flex items-stretch gap-0">
              {clips.map((c, i) => (
                <div key={c.id} className="flex min-w-0 items-stretch" style={{ flex: `${Math.max(1, c.end - c.start)} 1 0` }}>
                  {i > 0 && (
                    <div className="mx-2 flex w-24 shrink-0 flex-col justify-center">
                      <DropSelect aria-label="Transition" value={f.transition} onChange={(e) => set({ transition: e.target.value as typeof f.transition })}
                        className="h-8 rounded-md border border-purple/60 bg-raised px-1 text-[11px]">
                        {["cut", "crossfade", "black", "white", "slide", "wipe"].map((t) => <option key={t} value={t}>{t === "black" ? "dip to black" : t === "white" ? "dip to white" : t}</option>)}
                      </DropSelect>
                      {f.transition !== "cut" && <span className="mt-1 text-center text-[10px] text-muted">{f.transitionDur}s</span>}
                    </div>
                  )}
                  <ClipBlock c={c} selected={selected?.id === c.id} onSelect={() => useClips.setState({ sel: c.id })}
                    onChange={(p) => setClips(clips.map((x) => (x.id === c.id ? { ...x, ...p } : x)))}
                    onRemove={() => setClips(clips.filter((x) => x.id !== c.id))}
                    onMove={(d) => { const j = i + d; if (j < 0 || j >= clips.length) return; const nn = [...clips]; [nn[i], nn[j]] = [nn[j], nn[i]]; setClips(nn); }} />
                </div>
              ))}
            </div>
          )}
          {clips.length > 0 && <p className="mt-2 text-xs text-muted">Total {total.toFixed(1)} s before ending &amp; speed · drag the handles to cut the start or end</p>}
        </div>
        {result && (
          <div className="rounded-[10px] border border-good/40 bg-raised/60 p-3.5">
            <div className="mb-2 flex items-center gap-2 text-[13px]"><b>Exported</b><span className="text-muted">{result.filename} · {result.duration}s</span>
              <a className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-3 text-ink hover:bg-hover" href={viewUrl(result)} download={result.filename}><Icon name="down" size={14} /> Download</a></div>
            {result.filename.endsWith(".gif")
              ? <img src={viewUrl(result)} alt="Export" className="mx-auto max-h-80" />
              : <video src={viewUrl(result)} controls loop autoPlay muted className="mx-auto max-h-80 rounded-lg bg-black" />}
          </div>
        )}
      </main>
      <Panel w="w-[330px]" className="border-l">
        <PresetBar section="finish" />
        <div>
          <Label help="ending">Ending</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {ENDINGS.map((e) => (
              <button key={e.v} onClick={() => set({ ending: e.v })} aria-pressed={f.ending === e.v}
                className={cx("flex h-[58px] flex-col items-center justify-center gap-0.5 rounded-lg border text-[13px] font-medium", f.ending === e.v ? "border-accent bg-hover" : "border-line bg-raised hover:bg-hover")}>
                {e.t}<span className="text-[11px] font-normal text-muted">{e.s}</span>
              </button>
            ))}
          </div>
        </div>
        {f.ending !== "once" && f.ending !== "boomerang" && <Slider label="Fade length" help="fade" min={0.2} max={3} step={0.1} value={f.fade} show={`${f.fade.toFixed(1)} s`} onChange={(v) => set({ fade: v })} />}
        {clips.length > 1 && f.transition !== "cut" && <Slider label="Transition length" help="transition" min={0.2} max={2} step={0.1} value={f.transitionDur} show={`${f.transitionDur.toFixed(1)} s`} onChange={(v) => set({ transitionDur: v })} />}
        <Seg label="Sound at the end" value={f.audio} onChange={(v) => set({ audio: v })} options={[{ value: "keep", label: "Keep" }, { value: "fade", label: "Fade out" }, { value: "mute", label: "Mute all" }]} />
        <Seg label="Speed" value={f.speed} onChange={(v) => set({ speed: v })} options={[{ value: 0.5, label: "0.5×" }, { value: 1, label: "1×" }, { value: 1.5, label: "1.5×" }, { value: 2, label: "2×" }]} />
        <Select label="Size" help="exportSize" value={f.size} options={SIZES} onChange={(v) => set({ size: v })} />
        {f.size === "custom" && (
          <div className="-mt-2 flex items-center gap-2">
            <TextIn className="flex-1" mono value={f.customW} onChange={(v) => set({ customW: Number(v) || 0 })} />×<TextIn className="flex-1" mono value={f.customH} onChange={(v) => set({ customH: Number(v) || 0 })} />
          </div>
        )}
        <Seg label="Export as" value={f.format} onChange={(v) => set({ format: v })} options={[{ value: "mp4", label: "MP4" }, { value: "webm", label: "Loop WebM" }, { value: "gif", label: "GIF" }]} />
        <div className="mt-auto">
          {job && (
            <div className="mb-2.5">
              <div className="mb-1 flex justify-between text-[13px]"><span>Exporting…</span><span className="text-muted">{Math.round(job.progress * 100)}%</span></div>
              <div className="h-2 overflow-hidden rounded-sm bg-raised2"><div className="stripes h-full transition-[width]" style={{ width: `${job.progress * 100}%` }} /></div>
            </div>
          )}
          <Btn kind="primary" className="w-full" onClick={exportIt} disabled={!!why} why={why}>Export</Btn>
          <p className="mt-1.5 text-center text-xs text-muted">Saved to Outputs and backed up to B2</p>
        </div>
      </Panel>
    </>
  );
}

function Player({ clip }: { clip?: Clip }) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = v.current;
    if (!el || !clip) return;
    const onTime = () => { if (el.currentTime >= clip.end - 0.03 || el.currentTime < clip.start - 0.1) el.currentTime = clip.start; };
    el.currentTime = clip.start;
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [clip?.id, clip?.start, clip?.end]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!clip) return <div className="hatch flex h-[360px] items-center justify-center rounded-[10px] border border-line text-[13px] text-muted">The preview plays here</div>;
  return (
    <div className="relative flex h-[360px] justify-center overflow-hidden rounded-[10px] border border-line bg-black">
      <video ref={v} src={clip.media.url} controls autoPlay muted loop className="h-full" />
      <span className="absolute left-3 top-2.5 rounded bg-black/70 px-2 py-0.5 text-xs">plays your trimmed part · {clip.start.toFixed(1)}–{clip.end.toFixed(1)} s</span>
    </div>
  );
}

function ClipBlock({ c, selected, onSelect, onChange, onRemove, onMove }: {
  c: Clip; selected: boolean; onSelect: () => void; onChange: (p: Partial<Clip>) => void; onRemove: () => void; onMove: (d: number) => void;
}) {
  const dur = c.media.duration ?? Math.max(c.end, 5);
  return (
    <div className={cx("flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border p-1.5", selected ? "border-accent" : "border-line")}>
      <button onClick={onSelect} className="relative h-14 overflow-hidden rounded-md bg-black">
        <video src={`${c.media.url}#t=${c.start + 0.1}`} muted preload="metadata" className="h-full w-full object-cover opacity-80" />
        <span className="absolute left-1.5 top-1 max-w-[90%] truncate rounded bg-black/75 px-1.5 text-[11px]">{c.media.label || c.media.name}</span>
      </button>
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-2 h-1 rounded bg-raised2" />
        <div className="absolute top-2 h-1 rounded bg-accent" style={{ left: `${(c.start / dur) * 100}%`, right: `${100 - (c.end / dur) * 100}%` }} />
        <input type="range" className="dual absolute inset-0 w-full" min={0} max={dur} step={0.05} value={c.start} aria-label="Cut the start" onChange={(e) => onChange({ start: Math.min(Number(e.target.value), c.end - 0.3) })} />
        <input type="range" className="dual absolute inset-0 w-full" min={0} max={dur} step={0.05} value={c.end} aria-label="Cut the end" onChange={(e) => onChange({ end: Math.max(Number(e.target.value), c.start + 0.3) })} />
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span className="font-mono">{c.start.toFixed(1)}–{c.end.toFixed(1)}s</span>
        <span className="flex gap-1.5">
          <button aria-label="Move left" className="hover:text-ink" onClick={() => onMove(-1)}>‹</button>
          <button aria-label="Move right" className="hover:text-ink" onClick={() => onMove(1)}>›</button>
          <button aria-label="Remove clip" className="hover:text-bad" onClick={onRemove}><Icon name="x" size={12} /></button>
        </span>
      </div>
    </div>
  );
}
