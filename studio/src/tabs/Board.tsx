// 05 Animate → Video board: a box per character — her pictures next to her own words — under one shared prompt.
// Tick the boxes to run, set the takes, press Make videos: each box is planned by the video writer and its takes are
// lined up, no copying between Plan a video and Animate. Results fold into their box; click to see every take.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { addCharacter, addPic, addPicsBox, boxProblem, charOfFolder, MIX_KINDS, mixLabel, mixOf, removeBox, runBox, runTicked, setBoard, setBox, takesOf, useBoard, type Box, type BoardRun, type Mix } from "../lib/board";
import { coverOf, isAdult, useCharacters } from "../lib/characters";
import { useJobs, type Job } from "../lib/jobs";
import { useGroup } from "../lib/downloads";
import { useSettings } from "../lib/settings";
import { viewUrl, type FileRef } from "../lib/api";
import { DRAG_TYPE, useTray, type Media } from "../lib/tray";
import { CHAR_DRAG } from "../components/ProjectRail";
import { usePrimaryAction, useHandoffInto } from "../App";
import { Advanced, Btn, Icon, JobBar, LoraList, cx } from "../components/ui";
import { Chip, GoButton, Workspace } from "../components/Workspace";
import { AvoidLine, MUSIC_OPTS } from "../components/AvoidLine";
import { WriterSetup } from "./Prompt";
import { openViewer } from "../components/Viewer";
import { copyText } from "../lib/copy";

/** 2 seamless loops + 2 image → video: a − n + per video type */
function MixEditor({ mix, onChange }: { mix: Mix; onChange: (m: Mix) => void }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {MIX_KINDS.map((x) => (
        <span key={x.k} title={x.hint} className={cx("flex h-8 items-center border bg-black/20 text-[12.5px]", mix[x.k] ? "border-accent/60 text-ink" : "border-line text-muted")}>
          <button aria-label={`Fewer ${x.label}`} onClick={() => onChange({ ...mix, [x.k]: Math.max(0, mix[x.k] - 1) })} className="press h-full px-2 hover:text-ink">−</button>
          <span className="min-w-[1.2em] text-center tabular-nums">{mix[x.k]}</span>
          <button aria-label={`More ${x.label}`} onClick={() => onChange({ ...mix, [x.k]: Math.min(8, mix[x.k] + 1) })} className="press h-full px-2 hover:text-ink">+</button>
          <span className="pr-2">{x.short}</span>
        </span>
      ))}
    </span>
  );
}

/** a dropped tray item → the picture, and the character whose project it came from */
async function fromTray(id: string): Promise<{ m: Media; charId: string | null }> {
  const t = useTray.getState();
  const item = t.items.find((x) => x.id === id);
  const m = await t.asMedia(id);
  return { m, charId: charOfFolder(item?.src.subfolder)?.id ?? null };
}

export default function BoardTab() {
  const s = useBoard();
  const a = useSettings((st) => st.s.animate);
  const setA = (p: Partial<typeof a>) => useSettings.getState().set("animate", p);
  const toast = useJobs((st) => st.toast);
  const dl = useGroup("video");
  const [choosing, setChoosing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  // finished takes are copied into their box, so it still shows them after the job list moves on
  const jobs = useJobs((st) => st.jobs);
  useEffect(() => {
    const byId = new Map(jobs.map((j) => [j.id, j]));
    for (const b of useBoard.getState().boxes) for (const r of b.runs) {
      const outs = r.jobIds.flatMap((id) => (byId.get(id)?.status === "done" ? byId.get(id)!.outputs.filter((o) => o.kind === "video" && o.type === "output") : []));
      const fresh = outs.filter((o) => !r.outputs.some((x) => x.filename === o.filename && x.subfolder === o.subfolder));
      if (fresh.length) setRunOutputs(b.id, r.id, [...r.outputs, ...fresh.map(({ filename, subfolder, type }) => ({ filename, subfolder, type }))]);
    }
  }, [jobs]);

  const ready = s.boxes.filter((b) => b.on && !boxProblem(b));
  const videos = ready.reduce((n, b) => n + takesOf(b), 0);
  const why = !dl.ready ? dl.why : !s.boxes.length ? "Add characters first" : !ready.length ? (s.boxes.some((b) => b.on) ? "The ticked boxes need a picture and words" : "Tick at least one box") : undefined;
  const go = async () => {
    if (why) return;
    const r = await runTicked();
    toast(`Planning ${r.boxes} video${r.boxes > 1 ? "s" : ""} — ${r.videos} take${r.videos > 1 ? "s" : ""} in line. Each box fills in as they finish.`, "good");
  };
  usePrimaryAction("board", go);
  useHandoffInto("board", (items) => { items.forEach(({ media }) => placePic(media, null)); });

  /** a picture onto the board: into its character's box (made if needed), else a box of its own */
  const placePic = async (m: Media, charId: string | null) => {
    const c = charId ? useCharacters.getState().list.find((x) => x.id === charId) : undefined;
    if (c) { const id = await addCharacter(c); addPic(id, m); return; }
    addPicsBox([m]);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const charId = e.dataTransfer.getData(CHAR_DRAG);
    const c = charId ? useCharacters.getState().list.find((x) => x.id === charId) : undefined;
    if (c) { if (!isAdult(c)) { toast(`${c.name} needs an adult age first`, "bad"); return; } await addCharacter(c); return; }
    const tid = e.dataTransfer.getData(DRAG_TYPE);
    try {
      if (tid) { const { m, charId: who } = await fromTray(tid); await placePic(m, who); return; }
      for (const f of Array.from(e.dataTransfer.files ?? [])) addPicsBox([await useTray.getState().addUpload(f)]);
    } catch (err) { toast((err as Error).message, "bad"); }
  };

  const bar = (
    <div className="glow ticks card flex flex-col gap-3 border border-line px-4 py-3">
      <div className="flex items-start gap-3">
        <textarea value={s.words} onChange={(e) => setBoard({ words: e.target.value })} rows={2} aria-label="Shared prompt"
          placeholder="What happens — for every box (e.g. “she turns to the camera, smiles and twirls once”). Each box can add its own words."
          className="min-h-[56px] flex-1 resize-y bg-transparent text-[15px] leading-relaxed text-ink placeholder:text-dim focus:outline-none" />
        <GoButton onClick={go} disabled={!!why} why={why}>{videos ? `Make ${videos} video${videos > 1 ? "s" : ""}` : "Make videos"}</GoButton>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <MixEditor mix={s.mix} onChange={(m) => setBoard({ mix: m })} />
        <Chip title="Length" value={s.seconds} onChange={(v) => setBoard({ seconds: v })} options={Array.from({ length: 14 }, (_, i) => i + 2).map((n) => ({ value: n, label: `${n} s` }))} />
        <Chip title="Shape" value={s.shape} onChange={(v) => setBoard({ shape: v })} options={[{ value: "auto", label: "Match each picture" }, { value: "9:16", label: "9:16 tall" }, { value: "16:9", label: "16:9 wide" }, { value: "1:1", label: "1:1 square" }]} />
        <Chip title="Size" value={s.mp} onChange={(v) => setBoard({ mp: v })} options={[{ value: 0.4, label: "Draft 0.4 MP" }, { value: 0.6, label: "Good 0.6 MP" }, { value: 0.98, label: "Full 1 MP", hint: "sharper — about 1.8× the time of 0.6" }, { value: 1.2, label: "1.2 MP" }, { value: 1.5, label: "1.5 MP", hint: "the most detail — about 3× the time of 0.6" }]} />
        <Chip title="Speed" value={s.turbo ? 1 : 0} onChange={(v) => setBoard({ turbo: v === 1 })} options={[{ value: 1, label: "Turbo" }, { value: 0, label: "Full quality" }]} />
        <Chip title="Music" value={s.music} onChange={(v) => setBoard({ music: v })} options={MUSIC_OPTS} />
        <label className="flex h-8 cursor-pointer items-center gap-1.5 border border-line bg-black/20 px-2 text-[12.5px] text-muted hover:text-ink" title="The planner also reads how each box's first picture was made (its Create prompt) and keeps her outfit, accessories, props and setting — she interacts with her own things. Off: only the prompt and her look.">
          <input type="checkbox" checked={s.useMade} onChange={(e) => setBoard({ useMade: e.target.checked })} className="accent-[var(--color-accent)]" />Use how her picture was made
        </label>
        <Chip title="A box's own words" value={s.ownWords} onChange={(v) => setBoard({ ownWords: v })} options={[{ value: "add", label: "Box words: added", hint: "shared prompt + the box's words" }, { value: "own", label: "Box words: replace", hint: "a box with words uses only its own" }]} />
      </div>
      <AvoidLine value={s.avoid} onChange={(v) => setBoard({ avoid: v })} />
    </div>
  );

  return (
    <Workspace tab="board" title="Video board" sub="Many characters, one press" needs="video" bar={bar}
      drawer={<>
        <p className="text-[12.5px] leading-relaxed text-muted">Shared with Animate: these LoRAs and Advanced settings go into every box — unless a box picks its own LoRAs.</p>
        <LoraList family="h3" label="H3 LoRAs (every box)" value={a.loras} onChange={(v) => setA({ loras: v })} />
        <Advanced a={a.adv} set={(p) => setA({ adv: { ...a.adv, ...p } })} hideCfg>
          <WriterSetup />
        </Advanced>
      </>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Btn kind="primary" onClick={() => setChoosing(true)}><Icon name="plus" size={14} /> Add characters</Btn>
        <span className="text-[12.5px] text-dim">or drag them in from the left — or drop pictures from their projects (they go to that character's box)</span>
        {s.boxes.length > 0 && <span className="ml-auto flex gap-2 text-[12.5px]">
          <button className="text-accent hover:underline" onClick={() => s.boxes.forEach((b) => setBox(b.id, { on: true }))}>Tick all</button>
          <button className="text-muted hover:text-ink" onClick={() => s.boxes.forEach((b) => setBox(b.id, { on: false }))}>Tick none</button>
        </span>}
      </div>
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }} onDrop={onDrop}
        className={cx("min-h-[300px] rounded-xl transition-colors", over && "bg-accent/[.04] ring-2 ring-accent/40")}>
        {!s.boxes.length ? (
          <div className="flex h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-center">
            <b className="display text-[19px] text-ink">One box per character</b>
            <span className="max-w-[460px] text-[13px] text-muted">Add the characters you want videos of. Each box holds her pictures and a few words of her own; the prompt on top goes to every box. Tick the ones to run, then Make videos.</span>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
            {s.boxes.map((b) => <BoxCard key={b.id} b={b} onOpen={() => setOpen(b.id)} />)}
          </div>
        )}
      </div>
      {choosing && <ChooseCharacters onClose={() => setChoosing(false)} />}
      {open && <BoxResults id={open} onClose={() => setOpen(null)} />}
    </Workspace>
  );
}

function setRunOutputs(boxId: string, runId: string, outputs: FileRef[]) {
  setBox(boxId, (b) => ({ runs: b.runs.map((r) => (r.id === runId ? { ...r, outputs } : r)) }));
}

/** what a run is doing, from its jobs */
function useRunState(r?: BoardRun) {
  const js = useJobs(useShallow((st) => (r ? st.jobs.filter((j) => r.jobIds.includes(j.id)) : [])));
  if (!r) return null;
  const going = js.filter((j) => j.status === "running" || j.status === "queued").length;
  const failed = js.filter((j) => j.status === "error").length;
  return { going, failed, ready: r.outputs.length, jobs: js };
}

function BoxCard({ b, onOpen }: { b: Box; onOpen: () => void }) {
  const c = useCharacters((st) => (b.charId ? st.list.find((x) => x.id === b.charId) : undefined));
  useBoard((st) => st.mix); // the count follows the board's mix
  const [mixOpen, setMixOpen] = useState(false);
  useBoard((st) => st.words + st.ownWords); // the problem line follows the shared prompt
  const toast = useJobs((st) => st.toast);
  const [over, setOver] = useState(false);
  const [loras, setLoras] = useState(false);
  const last = b.runs[0];
  const st = useRunState(last);
  const problem = boxProblem(b);
  const allOut = b.runs.reduce((n, r) => n + r.outputs.length, 0);
  const cover = c ? coverOf(c) : undefined;
  const firstVid = last?.outputs[0];

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setOver(false);
    const charId = e.dataTransfer.getData(CHAR_DRAG);
    if (charId && !b.charId) { setBox(b.id, { charId }); return; }
    const tid = e.dataTransfer.getData(DRAG_TYPE);
    try {
      if (tid) { const { m } = await fromTray(tid); addPic(b.id, m); return; }
      for (const f of Array.from(e.dataTransfer.files ?? [])) addPic(b.id, await useTray.getState().addUpload(f));
    } catch (err) { toast((err as Error).message, "bad"); }
  };

  return (
    <div onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
      className={cx("card flex flex-col rounded-xl border bg-panel/80 transition-colors", b.on ? "border-line" : "border-line2 opacity-60", over && "!border-accent ring-2 ring-accent/30")}>
      <div className="flex items-center gap-2.5 border-b border-line2 px-3 py-2">
        <input type="checkbox" checked={b.on} onChange={(e) => setBox(b.id, { on: e.target.checked })} aria-label={`Run ${c?.name ?? "this box"}`} className="h-4 w-4 accent-[var(--color-accent)]" />
        <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-line bg-black">{cover && <img src={viewUrl(cover)} alt="" className="h-full w-full object-cover" />}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{c?.name ?? "Pictures"}{!c && <span className="ml-1.5 text-[11.5px] font-normal text-dim">no character — drop one here</span>}</span>
        <button onClick={() => setMixOpen((v) => !v)} title="What this box makes — the board's mix, or its own" aria-expanded={mixOpen}
          className={cx("press h-7 border px-1.5 text-[11.5px]", b.mix ? "border-accent text-accent" : "border-line text-muted hover:text-ink")}>×{takesOf(b)}{b.mix ? " own" : ""}</button>
        <button onClick={() => setLoras((v) => !v)} title="This box's own LoRAs" className={cx("press h-7 border px-1.5 text-[11.5px]", b.loras ? "border-accent text-accent" : "border-line text-muted hover:text-ink")}>LoRAs{b.loras ? ` ·${b.loras.length}` : ""}</button>
        <button onClick={() => removeBox(b.id)} aria-label="Remove box" title="Take this box off the board (its videos stay in the project)" className="press text-dim hover:text-bad"><Icon name="x" size={14} /></button>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-3 p-3">
        <div className="flex w-[148px] flex-wrap content-start gap-1.5">
          {b.pics.slice(0, 6).map((p, i) => (
            <span key={p.name} className="group relative h-[70px] w-[70px] overflow-hidden rounded-md border border-line bg-black">
              <img src={p.url} alt={p.label} className="h-full w-full object-cover" />
              {i === 0 && <span className="absolute left-0.5 top-0.5 rounded-sm bg-black/70 px-1 text-[10px] text-ink">1</span>}
              <button onClick={() => setBox(b.id, { pics: b.pics.filter((x) => x.name !== p.name) })} aria-label="Remove picture"
                className="absolute right-0.5 top-0.5 hidden rounded-sm bg-black/80 p-0.5 text-ink group-hover:block"><Icon name="x" size={11} /></button>
            </span>
          ))}
          {b.pics.length > 6 && <span className="flex h-[70px] w-[70px] items-center justify-center rounded-md border border-line text-[12px] text-muted">+{b.pics.length - 6}</span>}
          {b.pics.length < 9 && <span className="flex h-[70px] w-[70px] items-center justify-center rounded-md border border-dashed border-line text-center text-[10.5px] leading-tight text-dim">drop a picture</span>}
        </div>
        <textarea value={b.words} onChange={(e) => setBox(b.id, { words: e.target.value })} rows={5} aria-label={`${c?.name ?? "Box"} words`}
          placeholder={`${c?.name ?? "This box"}'s own words — added to the prompt on top (e.g. “in her red dress on the beach at sunset”)`}
          className="min-h-[148px] resize-y rounded-md border border-line bg-black/20 p-2 text-[13px] leading-relaxed text-ink placeholder:text-dim focus:border-accent focus:outline-none" />
      </div>

      {mixOpen && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line2 px-3 py-2">
          {b.mix ? <>
            <MixEditor mix={b.mix} onChange={(m) => setBox(b.id, { mix: m })} />
            <button className="text-[12px] text-muted hover:text-ink" onClick={() => setBox(b.id, { mix: null })}>Use the board's mix</button>
          </> : <button className="text-[12.5px] text-accent hover:underline" onClick={() => setBox(b.id, { mix: { ...mixOf(b) } })}>Give this box its own mix (now: {mixLabel(mixOf(b))})</button>}
        </div>
      )}
      {loras && (
        <div className="border-t border-line2 px-3 py-2">
          {b.loras ? <>
            <LoraList family="h3" label={`${c?.name ?? "This box"}'s LoRAs`} value={b.loras} onChange={(v) => setBox(b.id, { loras: v })} />
            <button className="mt-1 text-[12px] text-muted hover:text-ink" onClick={() => setBox(b.id, { loras: null })}>Use the shared LoRAs instead</button>
          </> : <button className="text-[12.5px] text-accent hover:underline" onClick={() => setBox(b.id, { loras: [...useSettings.getState().s.animate.loras] })}>Give this box its own LoRAs (starts from the shared ones)</button>}
        </div>
      )}

      <div className="mt-auto flex items-center gap-3 border-t border-line2 px-3 py-2.5">
        {firstVid ? (
          <button onClick={onOpen} className="press group relative h-[84px] w-[66px] shrink-0 overflow-hidden rounded-md border border-line bg-black" title="See every take">
            <video src={viewUrl(firstVid)} muted loop playsInline preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} className="h-full w-full object-cover" />
            {allOut > 1 && <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/80 px-1 text-[10.5px] text-ink">{allOut}</span>}
          </button>
        ) : <span className="h-[84px] w-[66px] shrink-0 rounded-md border border-dashed border-line2" />}
        <div className="min-w-0 flex-1 text-[12.5px]">
          {problem ? <span className="text-hot">{problem[0].toUpperCase() + problem.slice(1)}</span>
            : !last ? <span className="text-dim">Ready — {mixLabel(mixOf(b))} on the next Make videos</span>
            : last.status === "planning" ? <span className="text-muted">Planning the video…</span>
            : last.status === "error" ? <span className="text-bad">{last.error}</span>
            : <span className="text-muted">{st?.ready ?? 0} of {last.takes} ready{st?.going ? ` · ${st.going} rendering or in line` : ""}{st?.failed ? ` · ${st.failed} failed` : ""}</span>}
          <span className="mt-1 flex gap-3">
            {b.runs.length > 0 && <button className="text-accent hover:underline" onClick={onOpen}>See all{allOut ? ` (${allOut})` : ""}</button>}
            <button className="text-muted hover:text-ink disabled:opacity-40" disabled={!!problem} title={problem} onClick={() => { void runBox(b.id); }}>Run just this one</button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** a box opened up: every run, newest first — its plan and each take */
function BoxResults({ id, onClose }: { id: string; onClose: () => void }) {
  const b = useBoard((st) => st.boxes.find((x) => x.id === id));
  const c = useCharacters((st) => (b?.charId ? st.list.find((x) => x.id === b.charId) : undefined));
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  if (!b) return null;
  const all = b.runs.flatMap((r) => r.outputs);
  const view = (f: FileRef) => openViewer(all.map((o) => ({ url: viewUrl(o), kind: "video", label: c?.name ?? "take" })), Math.max(0, all.findIndex((o) => o.filename === f.filename)));
  return createPortal(
    <div className="fade-in fixed inset-0 z-[80] flex flex-col bg-bg/95 backdrop-blur-[2px]" role="dialog" aria-modal aria-label={`${c?.name ?? "Box"} videos`}>
      <div className="flex items-center gap-3 border-b border-line2 px-6 py-3">
        <h2 className="display text-[18px]">{c?.name ?? "Pictures"}</h2>
        <span className="text-[12.5px] text-muted">{all.length} video{all.length === 1 ? "" : "s"} from the board · also in 05 Animate under {c ? `${c.name}'s project` : "Free work"}</span>
        <button onClick={onClose} aria-label="Close" className="press ml-auto flex h-8 w-8 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
          {b.runs.map((r) => <RunBlock key={r.id} r={r} onView={view} />)}
        </div>
      </div>
    </div>, document.body);
}

function RunBlock({ r, onView }: { r: BoardRun; onView: (f: FileRef) => void }) {
  const st = useRunState(r);
  const waiting: Job[] = (st?.jobs ?? []).filter((j) => j.status === "running" || j.status === "queued");
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
        <b className="text-[13.5px] text-ink">{new Date(r.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</b>
        <span className="text-muted">{r.takes} {MIX_KINDS.find((x) => x.k === r.mode)?.label.toLowerCase() ?? "video"}{r.takes > 1 ? "s" : ""} · “{r.words.length > 90 ? r.words.slice(0, 90) + "…" : r.words}”</span>
        {r.status === "planning" && <span className="text-accent">planning…</span>}
        {r.status === "error" && <span className="text-bad">{r.error}</span>}
      </div>
      {r.plan && (
        <details className="text-[12.5px]">
          <summary className="cursor-pointer text-muted hover:text-ink">The plan the writer made</summary>
          <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap border border-line2 bg-black/20 p-2 text-muted">{r.plan}</p>
          <button className="mt-1 text-accent hover:underline" onClick={() => copyText(r.plan!, "Plan copied")}>Copy the plan</button>
        </details>
      )}
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {r.outputs.map((o) => (
          <button key={o.subfolder + o.filename} onClick={() => onView(o)} className="press group overflow-hidden rounded-md border border-line bg-black hover:border-accent">
            <video src={viewUrl(o)} muted loop playsInline preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} className="aspect-[9/16] w-full object-contain" />
          </button>
        ))}
        {waiting.map((j) => <div key={j.id} className="flex aspect-[9/16] flex-col justify-end rounded-md border border-dashed border-line p-2"><JobBar job={j} compact /></div>)}
      </div>
    </section>
  );
}

/** pick who goes on the board: tick characters (the ones already there are marked) */
function ChooseCharacters({ onClose }: { onClose: () => void }) {
  const chars = useCharacters(useShallow((st) => st.list.filter(isAdult)));
  const onBoard = useBoard(useShallow((st) => st.boxes.map((b) => b.charId)));
  const [pick, setPick] = useState<Record<string, true>>({});
  const [q, setQ] = useState("");
  const list = useMemo(() => chars.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase())), [chars, q]);
  const n = Object.keys(pick).length;
  const add = async () => { for (const c of chars) if (pick[c.id]) await addCharacter(c); onClose(); };
  return createPortal(
    <div className="fade-in fixed inset-0 z-[90] flex items-start justify-center bg-black/60 px-4 pt-[10vh]" onMouseDown={onClose}>
      <div className="card flex max-h-[76vh] w-full max-w-[760px] flex-col border border-line bg-panel" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Add characters">
        <div className="flex items-center gap-3 border-b border-line2 px-4 py-3">
          <b className="text-[14px]">Add characters to the board</b>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search characters" className="ml-auto h-8 w-48 border border-line bg-transparent px-2 text-[12.5px] text-ink focus:border-accent focus:outline-none" />
        </div>
        <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto p-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
          {list.map((c) => {
            const there = onBoard.includes(c.id);
            const on = !!pick[c.id];
            const f = coverOf(c);
            return (
              <button key={c.id} disabled={there} onClick={() => setPick((p) => { const x = { ...p }; if (x[c.id]) delete x[c.id]; else x[c.id] = true; return x; })} aria-pressed={on}
                className={cx("press flex flex-col overflow-hidden rounded-md border text-left", on ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-muted", there && "opacity-40")}>
                <span className="aspect-[3/4] w-full bg-black">{f && <img src={viewUrl(f)} alt="" className="h-full w-full object-cover" />}</span>
                <span className="truncate px-1.5 py-1 text-[12px] text-ink">{c.name}{there ? " · on board" : ""}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 border-t border-line2 px-4 py-3">
          <button className="text-[12.5px] text-muted hover:text-ink" onClick={() => setPick(Object.fromEntries(list.filter((c) => !onBoard.includes(c.id)).map((c) => [c.id, true as const])))}>Select all</button>
          <Btn kind="primary" className="ml-auto" disabled={!n} onClick={add}>Add {n || ""} {n === 1 ? "character" : "characters"}</Btn>
        </div>
      </div>
    </div>, document.body);
}

