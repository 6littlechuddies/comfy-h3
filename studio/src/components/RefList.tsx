import { Fragment, useRef, useState } from "react";
import { openViewer } from "./Viewer";
import { useJobs } from "../lib/jobs";
import { DRAG_TYPE, useTray, type Media } from "../lib/tray";
import { inputUrl, uploadFile } from "../lib/api";
import { LIMITS, makeRef, tagsFor, type Ref } from "../lib/work";
import { Btn, Help, Icon, MediaView, cx } from "./ui";

/** the reference list used by Prompt and Animate: pictures, clips (trim + sound), audio — drag to reorder */
export function RefList({ refs, onChange, allow = ["image", "video", "audio"], compact }: {
  refs: Ref[]; onChange: (r: Ref[]) => void; allow?: ("image" | "video" | "audio")[]; compact?: boolean;
}) {
  const tags = tagsFor(refs);
  const [over, setOver] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const file = useRef<HTMLInputElement>(null);
  const toast = useJobs((s) => s.toast);
  const counts = (k: string) => refs.filter((r) => r.media.kind === k).length;

  const add = (ms: Media[]) => {
    const next = [...refs];
    for (const m of ms) {
      if (!allow.includes(m.kind as any)) { toast(`${m.kind} files can't be used here`, "bad"); continue; }
      if (next.filter((r) => r.media.kind === m.kind).length >= LIMITS[m.kind]) { toast(`H3 takes at most ${LIMITS[m.kind]} ${m.kind === "image" ? "pictures" : m.kind === "video" ? "clips" : "audio files"}`, "bad"); continue; }
      next.push(makeRef(m));
    }
    onChange(next);
  };
  const fromFiles = async (files: FileList | File[]) => {
    try { add(await Promise.all(Array.from(files).map((f) => useTray.getState().addUpload(f)))); } catch (e) { toast((e as Error).message, "bad"); }
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const tid = e.dataTransfer.getData(DRAG_TYPE);
    if (tid) { try { add([await useTray.getState().asMedia(tid)]); } catch (err) { toast((err as Error).message, "bad"); } return; }
    if (e.dataTransfer.files?.length) fromFiles(e.dataTransfer.files);
  };
  const patch = (id: string, p: Partial<Ref>) => onChange(refs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const moveTo = (fromId: string, toId: string) => {
    const a = refs.findIndex((r) => r.id === fromId), b = refs.findIndex((r) => r.id === toId);
    if (a < 0 || b < 0 || a === b) return;
    const n = [...refs]; const [x] = n.splice(a, 1); n.splice(b, 0, x); onChange(n);
  };

  // a character's pictures sit together as one row you can open (their sheet can be 6–9 pictures)
  const groups: { key: string; charId?: string; items: Ref[] }[] = [];
  for (const r of refs) {
    const last = groups[groups.length - 1];
    if (r.charId && last?.charId === r.charId) last.items.push(r);
    else groups.push({ key: r.charId ? `c:${r.charId}:${r.id}` : r.id, charId: r.charId, items: [r] });
  }
  const pics = refs.filter((r) => r.media.kind !== "audio");
  const view = (r: Ref) => openViewer(pics.map((x) => ({ url: x.media.url, kind: x.media.kind === "video" ? "video" : "image", label: `${tags[x.id]} · ${x.label || x.media.label}` })), Math.max(0, pics.indexOf(r)));
  const endDrag = () => { setDragId(null); setOver(false); };

  return (
    <div onDragOver={(e) => { if (!dragId) { e.preventDefault(); setOver(true); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }} onDrop={(e) => { if (dragId) { e.preventDefault(); endDrag(); return; } onDrop(e); }}
      className={cx("flex flex-col gap-2 rounded-[10px]", over && !dragId && "ring-2 ring-accent/50")}>
      {groups.map((g) => g.items.length > 1 && !openGroups.has(g.charId!) ? (
        <div key={g.key} className="rounded-lg border border-line bg-raised p-2">
          <div className="flex items-center gap-2">
            <button onClick={() => setOpenGroups((s) => new Set([...s, g.charId!]))} className="text-[12px] text-muted hover:text-ink" aria-label="Show each picture">▸</button>
            <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
              {g.items.slice(0, 7).map((r) => (
                <button key={r.id} onClick={() => view(r)} title={`${r.label} — click to see it full size`} className="checker h-10 w-8 shrink-0 overflow-hidden rounded-sm border border-line hover:border-accent">
                  <img src={r.media.url} alt="" draggable={false} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
            <span className="shrink-0 text-right text-[11.5px] leading-tight"><span className="block text-ink">{(g.items[0].label || "").split(" — ")[0]}</span><span className="font-mono text-[10.5px] text-accent">{tags[g.items[0].id]}–{tags[g.items[g.items.length - 1].id]?.replace(/\D/g, "")}</span></span>
            <button aria-label="Remove this character" title="Take all their pictures out" className="text-muted hover:text-ink" onClick={() => onChange(refs.filter((x) => !g.items.includes(x)))}><Icon name="x" size={14} /></button>
          </div>
        </div>
      ) : (<Fragment key={g.key}>
      {g.items.length > 1 && <button onClick={() => setOpenGroups((s) => { const n = new Set(s); n.delete(g.charId!); return n; })} className="-mb-1 self-start text-[11.5px] text-muted hover:text-ink">▾ {(g.items[0].label || "").split(" — ")[0]} · {g.items.length} pictures</button>}
      {g.items.map((r) => (
        <div key={r.id} draggable onDragStart={(e) => { setDragId(r.id); e.dataTransfer.clearData(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("application/x-h3-ref", r.id); }}
          onDragEnd={endDrag} onDragOver={(e) => { if (dragId) { e.preventDefault(); e.stopPropagation(); } }}
          onDrop={(e) => { if (dragId) { e.preventDefault(); e.stopPropagation(); moveTo(dragId, r.id); endDrag(); } }}
          className={cx("rounded-lg border bg-raised p-2", dragId === r.id ? "border-accent opacity-60" : "border-line")}>
          <div className="flex items-center gap-2.5">
            <span className="cursor-grab text-dim" title="Drag to reorder"><Icon name="grip" size={14} /></span>
            <button onClick={() => view(r)} title="See it full size" className={cx("h-11 w-11 shrink-0 cursor-zoom-in overflow-hidden rounded-md", r.media.kind === "image" && "checker")}><MediaView m={r.media} controls={false} /></button>
            <div className="min-w-0 flex-1">
              <input value={r.label} onDrop={(e) => { if (dragId) e.preventDefault(); }} placeholder={r.media.kind === "image" ? "who or what is this?" : r.media.kind === "video" ? "what's in this clip?" : "what is this? (e.g. my voice line)"}
                onChange={(e) => patch(r.id, { label: e.target.value })} aria-label="Describe this reference"
                className="h-7 w-full rounded border border-transparent bg-transparent px-1 text-[13px] text-ink placeholder:text-dim hover:border-line focus:border-accent focus:outline-none" />
              <div className="px-1 text-[11px] text-muted">{r.media.kind}{r.media.duration ? ` · ${r.media.duration.toFixed(1)} s` : ""}</div>
            </div>
            <span className="shrink-0 rounded bg-bg px-1.5 py-0.5 font-mono text-[11px] text-accent">{tags[r.id]}</span>
            <button aria-label="Remove" className="text-muted hover:text-ink" onClick={() => onChange(refs.filter((x) => x.id !== r.id))}><Icon name="x" size={14} /></button>
          </div>
          {r.media.kind === "video" && !compact && (
            <div className="mt-2 flex flex-col gap-1.5 pl-7 text-xs">
              <Trim r={r} onChange={(p) => patch(r.id, p)} />
              <label className="flex items-center gap-2"><input type="checkbox" checked={r.useSound} onChange={(e) => patch(r.id, { useSound: e.target.checked })} disabled={r.media.has_audio === false} />
                Use its sound too {r.media.has_audio === false && <span className="text-dim">(this clip has no sound)</span>}<Help k="useSound" /></label>
            </div>
          )}
        </div>
      ))}
      </Fragment>))}
      <div className="flex flex-col gap-1">
        <div className="flex gap-1.5">
          <Btn className="flex-1 border-dashed" onClick={() => file.current?.click()}><Icon name="plus" size={14} /> Add files or drag in</Btn>
          {allow.includes("audio") && <VoiceRecorder onClip={(m) => add([m])} />}
        </div>
        <span className="text-center text-[11px] text-dim">
          {allow.map((k) => `${counts(k)}/${LIMITS[k]} ${k === "image" ? "pictures" : k === "video" ? "clips" : "audio"}`).join(" · ")}
        </span>
      </div>
      <input ref={file} type="file" multiple hidden accept={allow.map((k) => `${k}/*`).join(",")} onChange={(e) => { if (e.target.files) fromFiles(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

function Trim({ r, onChange }: { r: Ref; onChange: (p: Partial<Ref>) => void }) {
  const dur = r.media.duration ?? 15;
  const len = r.end - r.start;
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-muted"><span>Use {r.start.toFixed(1)}–{r.end.toFixed(1)} s</span><span className={len > 15 ? "text-bad" : ""}>{len.toFixed(1)} s{len > 15 ? " (max 15)" : len < 2 ? " (min 2)" : ""}</span></div>
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-2 h-1 rounded bg-raised2" />
        <div className="absolute top-2 h-1 rounded bg-accent" style={{ left: `${(r.start / dur) * 100}%`, right: `${100 - (r.end / dur) * 100}%` }} />
        <input type="range" min={0} max={dur} step={0.1} value={r.start} aria-label="Clip start" onChange={(e) => onChange({ start: Math.min(Number(e.target.value), r.end - 0.5) })}
          className="dual absolute inset-0 w-full" />
        <input type="range" min={0} max={dur} step={0.1} value={r.end} aria-label="Clip end" onChange={(e) => onChange({ end: Math.max(Number(e.target.value), r.start + 0.5) })}
          className="dual absolute inset-0 w-full" />
      </div>
    </div>
  );
}

/** record a voice line in the browser (needs the https link), saved as a wav reference */
function VoiceRecorder({ onClip }: { onClip: (m: Media) => void }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const toast = useJobs((s) => s.toast);
  const ok = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRec(null);
        const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        try {
          const f = await uploadFile(blob, `voice.${(r.mimeType || "audio/webm").includes("ogg") ? "ogg" : "webm"}`, true);
          const m: Media = { ...f, url: inputUrl(f.name), label: "my voice" };
          useTray.getState().addOutput({ filename: f.name, subfolder: "", type: "input" }, "my voice");
          onClip(m);
        } catch (e) { toast(`Couldn't save the recording: ${(e as Error).message}`, "bad"); }
      };
      r.start(); setRec(r); setSecs(0);
      const t0 = Date.now();
      const tick = setInterval(() => { if (r.state !== "recording") return clearInterval(tick); setSecs(Math.round((Date.now() - t0) / 1000)); if (Date.now() - t0 > 30000) r.stop(); }, 250);
    } catch (e) { toast(`Microphone not available: ${(e as Error).message}`, "bad"); }
  };
  return rec
    ? <Btn className="!border-bad !text-bad" onClick={() => rec.stop()}><Icon name="stop" size={14} /> Stop · {secs}s</Btn>
    : <Btn onClick={start} disabled={!ok} why="Recording needs the secure https link (button in the top bar)"><Icon name="mic" size={14} /> Record</Btn>;
}
