import { useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { picturesToWrite, queueAll, rowProblem, useBatch, writePicturePrompts, writePrompts, type Row } from "../lib/batch";
import { writerOutside } from "../lib/outside";
import { WriterChoice } from "../components/WriterChoice";
import { isAdult, useCharacters } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { useGroup } from "../lib/downloads";
import { h3Size } from "../lib/models";
import { randomTopic, testAlert, useNotify } from "../lib/notify";
import { droppedUrl, useTray } from "../lib/tray";
import { useHandoffInto, usePrimaryAction } from "../App";
import { Btn, Icon, Label, Seg, Slot, cx, DropSelect } from "../components/ui";
import { Workspace } from "../components/Workspace";
import { Feed } from "../components/Feed";
import { openViewer } from "../components/Viewer";
import { ContentPlan } from "../components/ContentPlan";
import { PhotoSet } from "../components/PhotoSet";
import { RecipePanel } from "../components/MyRecipes";
import "../lib/faceDetail";

export default function BatchTab() {
  const b = useBatch();
  const chars = useCharacters(useShallow((s) => s.list.filter(isAdult)));
  const toast = useJobs((s) => s.toast);
  const jobs = useJobs(useShallow((s) => s.jobs.filter((j) => j.tab === "batch")));
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"" | "write" | "queue">("");
  const video = b.target === "video";

  useHandoffInto("batch", (items) => items.forEach(({ media }) => useBatch.getState().add({ imitate: media })));
  const addFiles = async (fs: FileList | null) => {
    for (const f of Array.from(fs ?? [])) {
      try { const m = await useTray.getState().addUpload(f); useBatch.getState().add({ imitate: m }); } catch (e) { toast((e as Error).message, "bad"); }
    }
    // drop the empty starter row once real ones exist
    const rows = useBatch.getState().rows;
    if (rows.length > 1 && !rows[0].imitate && !rows[0].idea && !rows[0].prompt) useBatch.getState().remove(rows[0].id);
  };

  // dragged from another tab (Pinterest, any site): one row per picture
  const addLink = async (dt: DataTransfer) => {
    const url = droppedUrl(dt);
    if (!url) return;
    try { const m = await useTray.getState().addUrl(url); useBatch.getState().add({ imitate: m }); } catch (e) { toast((e as Error).message, "bad"); }
    const rows = useBatch.getState().rows;
    if (rows.length > 1 && !rows[0].imitate && !rows[0].idea && !rows[0].prompt) useBatch.getState().remove(rows[0].id);
  };
  const needWrite = video ? b.rows.filter((r) => !r.prompt.trim() && (r.idea.trim() || r.imitate) && r.status !== "writing").length : picturesToWrite().length;
  const ready = b.rows.filter((r) => r.status !== "queued" && !rowProblem(r));
  const totalJobs = ready.reduce((n, r) => n + r.takes, 0);
  const dlMake = useGroup(video ? "video" : "edit");
  const dlWrite = useGroup("writer");
  const write = async () => { setBusy("write"); try { const n = video ? await writePrompts() : await writePicturePrompts(); toast(n ? `Writing ${n} prompt${n > 1 ? "s" : ""} — check them before queueing.` : "Every row already has a prompt.", "info"); } finally { setBusy(""); } };
  const queue = async () => {
    if (!totalJobs) return;
    setBusy("queue");
    try {
      const n = await queueAll();
      const alert = useNotify.getState().topic;
      if (b.target === "image" && (useBatch.getState().take ?? "swap") === "swap") { toast(`Swapping into ${n} picture${n > 1 ? "s" : ""}, one after another — keep this page open until it's done (progress on the left).`, "good"); return; }
      toast(`Queued ${n} job${n > 1 ? "s" : ""} on the instance — ${alert ? "your phone gets an alert when they're all done. You can close this page." : "they keep running with this page closed."}`, "good");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  usePrimaryAction("batch", () => (video && needWrite ? write() : queue()));
  const running = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  const { width, height } = h3Size(b.aspect, b.mp);

  const bar = (
    <div className="glow ticks card flex flex-wrap items-center gap-3 border border-line px-4 py-3">
      <div className="min-w-0">
        <div className="micro text-dim">QUEUE · {String(b.rows.length).padStart(2, "0")} ROWS{running ? ` · ${running} RUNNING` : ""}</div>
        <div className="text-[13.5px] text-muted">{video ? "1. Add clips or pictures to imitate (or just ideas)  2. Write prompts  3. Queue all" : "Add pictures to copy or ideas  ·  Write prompts turns ideas into full prompts (optional)  ·  Queue all"}</div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Btn onClick={() => file.current?.click()}><Icon name="up" size={14} /> Add files</Btn>
        <Btn onClick={() => useBatch.getState().add()}><Icon name="plus" size={14} /> Add row</Btn>
        {(video || needWrite > 0) && <Btn onClick={write} disabled={!needWrite || !!busy || (!dlWrite.ready && (video || !writerOutside()))} why={!dlWrite.ready && (video || !writerOutside()) ? dlWrite.why : busy ? "Working…" : "Every row has a prompt"}><Icon name="script" size={14} /> Write {needWrite || ""} prompt{needWrite === 1 ? "" : "s"}</Btn>}
        <button onClick={queue} disabled={!totalJobs || !!busy || !dlMake.ready} title={!dlMake.ready ? dlMake.why : !totalJobs ? "Nothing ready to queue" : "Ctrl+Enter"}
          className="press btn-primary chamfer flex h-11 items-center gap-2 px-6 text-[14px] uppercase tracking-wide disabled:text-dim">Queue {totalJobs || ""} {video ? "video" : "picture"}{totalJobs === 1 ? "" : "s"}</button>
      </div>
      <input ref={file} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
    </div>
  );

  return (
    <Workspace needs={video ? "video" : "edit"} tab="batch" title="Batch" sub="many at once, runs while you're away" bar={bar}
      drawer={<>
        <Seg label="Make" value={b.target} onChange={(v) => b.set({ target: v })} options={[{ value: "video", label: "Videos" }, { value: "image", label: "Pictures" }]} />
        <WriterChoice />
        <label className="flex flex-col gap-1.5"><span className="lbl">Star (optional)</span>
          <DropSelect value={b.characterId ?? ""} onChange={(e) => b.set({ characterId: e.target.value || null })} className="inset h-10 border px-2.5 text-[13.5px] focus:border-accent focus:outline-none">
            <option value="">No character</option>
            {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </DropSelect>
          <span className="text-[12px] leading-relaxed text-dim">{b.characterId ? "Their reference sheet goes into every row, and the prompts name them in every cut so they stay the same person." : "Pick a saved character to put them in every row."}</span>
        </label>
        {video && (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex flex-col gap-1"><span className="lbl">Length</span>
                <DropSelect value={b.seconds} onChange={(e) => b.set({ seconds: Number(e.target.value) })} className="inset h-9 border px-2 text-[13.5px]">
                  {Array.from({ length: 14 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} s</option>)}
                </DropSelect></label>
              <label className="flex flex-col gap-1"><span className="lbl">Shape</span>
                <DropSelect value={b.aspect} onChange={(e) => b.set({ aspect: e.target.value as typeof b.aspect })} className="inset h-9 border px-2 text-[13.5px]">
                  <option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option>
                </DropSelect></label>
            </div>
            <Seg label="Size" value={b.mp} onChange={(v) => b.set({ mp: v })} options={[{ value: 0.4, label: "Draft" }, { value: 0.6, label: "Good" }, { value: 0.98, label: "Full" }]} />
            <p className="-mt-2 font-mono text-[11px] text-dim">{width}×{height} · rows with a clip use the clip's length (max 15 s)</p>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" checked={b.useClipSound} onChange={(e) => b.set({ useClipSound: e.target.checked })} />Use each clip's sound too</label>
            <p className="text-[12px] leading-relaxed text-dim">LoRAs and sampler settings come from the Animate tab.</p>
          </>
        )}
        {!video && <PhotoSet chars={chars} />}
        {!video && <RecipePanel />}
        {!video && <ContentPlan />}
        {!video && <p className="text-[12px] leading-relaxed text-dim">A picture to copy + a star → the star in that pose and scene (Krea 2 Edit). Just words → made in Create's style with its LoRAs.</p>}
        <PhoneAlerts />
      </>}>
      <div className="flex flex-col gap-2.5 pt-1">
        {b.rows.map((r, i) => <RowCard key={r.id} r={r} n={i} video={video} />)}
        <button onClick={() => file.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); else addLink(e.dataTransfer); }}
          className="hatch flex h-20 items-center justify-center gap-2 border border-dashed border-line text-[13px] text-muted hover:border-accent hover:text-ink">
          <Icon name="up" size={16} /> Drop clips or pictures here — files, or straight from a Pinterest / web tab — one row each
        </button>
        {b.rows.some((r) => r.status === "queued") && <button onClick={b.clearDone} className="self-start text-[12px] text-muted hover:text-ink">Clear queued rows</button>}
        <div className="mt-4"><Feed tab="batch" empty={<span>Results from the batch show up here.</span>} /></div>
      </div>
    </Workspace>
  );
}

function RowCard({ r, n, video }: { r: Row; n: number; video: boolean }) {
  const { update, remove } = useBatch();
  const jobs = useJobs(useShallow((s) => s.jobs.filter((j) => r.jobIds.includes(j.id) && j.meta?.kind === "make")));
  const problem = rowProblem(r);
  const swap = !video && (useBatch.getState().take ?? "swap") === "swap";
  const status = r.status === "writing" ? "WRITING" : r.status === "queued" && (r.step || r.results) ? (r.step ? (r.step.startsWith("Waiting") ? "IN LINE" : "SWAPPING") : "DONE") : r.status === "queued" ? (jobs.every((j) => j.status === "done") && jobs.length ? "DONE" : jobs.some((j) => j.status === "running") ? "RUNNING" : "QUEUED") : r.status === "error" ? "ERROR" : problem ? "NEEDS INPUT" : "READY";
  const tone = status === "READY" || status === "DONE" ? "text-good" : status === "ERROR" ? "text-bad" : status === "NEEDS INPUT" ? "text-dim" : "text-accent";
  const locked = r.status === "queued" || r.status === "writing";
  return (
    <div className={cx("card grid grid-cols-[36px_150px_1fr_auto] gap-3 border p-3", r.status === "error" ? "border-bad/50" : "border-line")}>
      <div className="flex flex-col items-center gap-1 pt-1"><span className="micro text-dim">#{String(n + 1).padStart(2, "0")}</span></div>
      <Slot className="h-[150px]" value={r.imitate} onChange={(m) => update(r.id, { imitate: m, prompt: m === r.imitate ? r.prompt : "", status: "new" })} accept={["image", "video"]} label={video ? "Clip or picture to imitate" : "Picture to copy"} />
      <div className="flex min-w-0 flex-col gap-2">
        {(r.charId || r.toSet || r.inspo) && <span className="text-[11.5px] text-muted">{r.charId ? useCharacters.getState().list.find((x) => x.id === r.charId)?.name ?? "?" : ""}{r.toSet ? ` → “${r.toSet.title}” ${r.toSet.tier} set` : ""}{r.faceFix ? " · face pass" : ""}{r.inspo ? " · from a saved scene" : ""}{r.expression ? ` · ${r.expression.split(",")[0]}` : ""}</span>}
        <input value={r.idea} disabled={locked} onChange={(e) => update(r.id, { idea: e.target.value })}
          placeholder={video ? (r.imitate ? "Anything to change? e.g. on a beach at sunset (optional)" : "The idea, e.g. she twirls in the rain and laughs") : (r.imitate ? (swap ? "Which person if there are several (“the woman on the left”), or a change — optional" : "What to change (optional)") : "Describe the picture")}
          className="inset h-9 border px-2.5 text-[13.5px] focus:border-accent focus:outline-none disabled:opacity-60" />
        {(video || (!r.imitate && (r.prompt.trim() || r.status === "writing"))) && (
          <textarea value={r.prompt} disabled={locked} onChange={(e) => update(r.id, { prompt: e.target.value, status: e.target.value.trim() ? "ready" : "new" })} rows={4}
            placeholder={r.status === "writing" ? (writerOutside() ? "Waiting for your Grok answer…" : "The writer is on it…") : !video ? "The Krea 2 prompt" : "The H3 prompt — press Write prompts to have it written from the clip/picture and idea, or type your own"}
            className={cx("inset min-h-[92px] flex-1 resize-y border px-2.5 py-2 font-mono text-[12px] leading-relaxed focus:border-accent focus:outline-none disabled:opacity-70", r.status === "writing" && "shimmer")} />
        )}
        <div className="flex items-center gap-2 text-[12px]">
          <span className={cx("micro", tone)}>{status}</span>
          {r.step && <span className="truncate text-accent">{r.step}</span>}
          {(r.error || (problem && r.status !== "queued")) && <span className="truncate text-muted">{r.error ?? problem}</span>}
          {!!r.results?.length && <span className="ml-auto flex gap-1">{r.results.map((u, i) => <button key={u} onClick={() => openViewer(r.results!.map((x) => ({ url: x, kind: "image" as const, label: `Row ${n + 1}` })), i)} className="press h-12 w-9 overflow-hidden border border-line hover:border-accent"><img src={u} alt="" className="h-full w-full object-cover" /></button>)}</span>}
          {jobs.length > 0 && <span className="ml-auto flex gap-1">{jobs.map((j) => <span key={j.id} title={`${j.label}: ${j.status}`} className={cx("h-1.5 w-6", j.status === "done" ? "bg-good" : j.status === "running" ? "stripes" : j.status === "error" ? "bg-bad" : "bg-raised2")} />)}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <button aria-label={`Remove row ${n + 1}`} onClick={() => remove(r.id)} className="text-muted hover:text-bad"><Icon name="x" size={15} /></button>
        <label className="flex flex-col items-end gap-1"><span className="micro text-dim">TAKES</span>
          <DropSelect value={r.takes} disabled={locked} onChange={(e) => update(r.id, { takes: Number(e.target.value) })} className="inset h-8 border px-1.5 text-[13px]">
            {[1, 2, 3, 4].map((k) => <option key={k} value={k}>×{k}</option>)}
          </DropSelect></label>
        {r.status === "queued" && !r.step && <button onClick={() => update(r.id, { status: r.prompt ? "ready" : "new", jobIds: [], results: undefined })} className="mt-auto text-[12px] text-muted hover:text-ink">Run again</button>}
      </div>
    </div>
  );
}

function PhoneAlerts() {
  const { topic, every, set } = useNotify();
  const [draft, setDraft] = useState(topic);
  const [msg, setMsg] = useState<string | null>(null);
  const toast = useJobs((s) => s.toast);
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <Label>Phone alerts</Label>
      <p className="-mt-1 text-[12px] leading-relaxed text-muted">Install the free <b className="text-ink">ntfy</b> app, tap + and subscribe to the name below. Your phone buzzes when a batch finishes — even with this page closed.</p>
      <div className="flex gap-1.5">
        <input value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} placeholder="h3-yourname" aria-label="Alert name"
          className="inset h-9 min-w-0 flex-1 border px-2.5 font-mono text-[12.5px] focus:border-accent focus:outline-none" />
        {!draft && <Btn small onClick={() => setDraft(randomTopic())}>Make one</Btn>}
      </div>
      <div className="flex gap-1.5">
        <Btn small className="flex-1" disabled={!draft || draft === topic} why={draft ? "Saved" : "Type a name"} onClick={() => { set({ topic: draft }); toast("Alert name saved", "good"); }}>Save</Btn>
        <Btn small className="flex-1" disabled={!draft} why="Type a name" onClick={async () => { setMsg("Sending…"); const e = await testAlert(draft); setMsg(e ? `Failed: ${e}` : "Sent — check your phone"); }}>Send test</Btn>
      </div>
      {msg && <p className="text-[12px] text-muted">{msg}</p>}
      <label className="flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" checked={every} disabled={!topic} onChange={(e) => set({ every: e.target.checked })} />Also alert me for every Animate video</label>
      <p className="text-[11.5px] leading-relaxed text-dim">Anyone who knows the name can read the alerts, so make it hard to guess. Alerts only say a job finished — no pictures.</p>
    </div>
  );
}
