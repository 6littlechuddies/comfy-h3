import { useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { addGroups, clearWaiting, removeDuplicates, undoGroup, DEFAULT_REC, FRAMES, picturesToWrite, postCharacter, queueAll, rowProblem, useBatch, writePicturePrompts, writePrompts, type RecreatePrefs, type Row } from "../lib/batch";
import { writerOutside } from "../lib/outside";
import { WriterChoice } from "../components/WriterChoice";
import { isAdult, useCharacters } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { useGroup } from "../lib/downloads";
import { h3Size } from "../lib/models";
import { randomTopic, testAlert, useNotify } from "../lib/notify";
import { droppedUrl, useTray } from "../lib/tray";
import { useHandoffInto, usePrimaryAction } from "../App";
import { modelOf, useSettings } from "../lib/settings";
import { Btn, Icon, Label, Seg, Slot, TextIn, cx, DropSelect } from "../components/ui";
import { PromptPieces, useRewriteMenu } from "../components/PromptPieces";
import { Workspace } from "../components/Workspace";
import { Feed } from "../components/Feed";
import { openViewer } from "../components/Viewer";
import { ContentPlan } from "../components/ContentPlan";
import { PhotoSet } from "../components/PhotoSet";
import { RecipePanel } from "../components/MyRecipes";
import "../lib/faceDetail";
import { copyText } from "../lib/copy";
import { CheckpointPicker } from "../components/Checkpoint";
import { CosplayList, CosplayOptions } from "../components/CosplayPanel";
import { usePoseWear } from "../lib/posewear";

export default function BatchTab() {
  const b = useBatch();
  const chars = useCharacters(useShallow((s) => s.list.filter(isAdult)));
  const toast = useJobs((s) => s.toast);
  const jobs = useJobs(useShallow((s) => s.jobs.filter((j) => j.tab === "batch")));
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"" | "write" | "queue">("");
  const [compact, setCompactS] = useState(() => { try { return localStorage.getItem("h3.batch.compact") === "1"; } catch { return false; } });
  const setCompact = (v: boolean) => { setCompactS(v); try { localStorage.setItem("h3.batch.compact", v ? "1" : "0"); } catch { /* */ } };
  const video = b.target === "video";
  // Pictures: one way at a time, so the sidebar only shows what that way uses
  const [way, setWay] = useState<"recreate" | "swap" | "plan" | "recipes" | "cosplay" | "poses">(() => { try { return (localStorage.getItem("h3.batch.way") as "recreate") || "recreate"; } catch { return "recreate"; } });
  const pickWay = (v: typeof way) => { setWay(v); try { localStorage.setItem("h3.batch.way", v); } catch { /* */ } if (v === "swap") useBatch.getState().set({ take: useBatch.getState().take === "face" || useBatch.getState().take === "person" ? useBatch.getState().take : "swap" }); };

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
    const swapsToo = b.target === "image" && (useBatch.getState().take ?? "swap") === "swap" && b.rows.some((r) => r.status !== "queued" && r.imitate?.kind === "image" && !rowProblem(r));
    try {
      const n = await queueAll();
      const alert = useNotify.getState().topic;
      if (swapsToo) { toast(`Swapping into ${n} picture${n > 1 ? "s" : ""}, one after another — keep this page open until it's done (progress on the left).`, "good"); return; }
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
        {!video && <Seg wrap label="How" value={way} onChange={pickWay} options={[{ value: "recreate", label: "Recreate" }, { value: "swap", label: "Swap in" }, { value: "plan", label: "Plan" }, { value: "recipes", label: "Recipes" }, { value: "cosplay", label: "Cosplay" }, { value: "poses", label: "Poses" }]} />}
        {/* only what the chosen way uses: the prompt writer and the Star belong to videos and planned sets */}
        {(video || way === "plan" || way === "cosplay") && <WriterChoice />}
        {!video && <BatchCheckpoint />}
        {!video && way === "cosplay" && <CosplayOptions />}
        {(video || way === "plan") && <label className="flex flex-col gap-1.5"><span className="lbl">Star (optional)</span>
          <DropSelect value={b.characterId ?? ""} onChange={(e) => b.set({ characterId: e.target.value || null })} className="inset h-10 border px-2.5 text-[13.5px] focus:border-accent focus:outline-none">
            <option value="">No character</option>
            {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </DropSelect>
          <span className="text-[12px] leading-relaxed text-dim">{b.characterId ? "Their reference sheet goes into every row, and the prompts name them in every cut so they stay the same person." : "Pick a saved character to put them in every row."}</span>
        </label>}
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
        {!video && way === "recreate" && <RecreatePanel />}
        {!video && way === "swap" && <PhotoSet chars={chars} />}
        {!video && way === "recipes" && <RecipePanel />}
        {!video && way === "poses" && <PosesPanel />}
        {!video && way === "plan" && <ContentPlan />}
        {!video && way === "plan" && <p className="text-[12px] leading-relaxed text-dim">Rows with just words are made in Create's style with its LoRAs.</p>}
        <details className="border-t border-line pt-3 text-[13px]"><summary className="cursor-pointer text-muted hover:text-ink">Phone alerts</summary><div className="mt-2"><PhoneAlerts /></div></details>
      </>}>
      <div className="flex flex-col gap-2.5 pt-1">
        {!video && way === "cosplay" && <CosplayList />}
        <RowTools />
        <ChangeAll />
        {b.rows.length > 3 && <div className="flex items-center gap-2 text-[12px] text-muted">
          <button onClick={() => setCompact(!compact)} className="press flex items-center gap-1 hover:text-ink"><Icon name="chev" size={13} className={cx("transition-transform", compact && "-rotate-90")} />{compact ? "Show rows in full" : "Fold rows to one line each"}</button>
          <span className="text-dim">{b.rows.length} rows</span></div>}
        {b.rows.map((r, i) => (!video && (way === "recreate" || way === "cosplay" || way === "poses") && !r.civit && !r.imitate && !r.idea.trim() && !r.prompt.trim() ? null : compact ? <RowLine key={r.id} r={r} n={i} /> : <RowCard key={r.id} r={r} n={i} video={video} />))}
        {!video && way === "recreate" && !b.rows.some((r) => r.civit || r.imitate || r.idea.trim() || r.prompt.trim()) && (
          <button onClick={async () => { const { openRecreatePicker } = await import("../components/ImageImport"); openRecreatePicker(); }} className="hatch flex h-28 flex-col items-center justify-center gap-1 border border-dashed border-line text-[13.5px] text-muted hover:border-accent hover:text-ink">
            <span className="font-semibold text-ink">Pick CivitAI posts to recreate</span><span className="text-[12px]">Their words and LoRAs, made with your Create settings</span></button>)}
        <button onClick={() => file.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); else addLink(e.dataTransfer); }}
          className="hatch flex h-20 items-center justify-center gap-2 border border-dashed border-line text-[13px] text-muted hover:border-accent hover:text-ink">
          <Icon name="up" size={16} /> Drop clips or pictures here — files, or straight from a Pinterest / web tab — one row each
        </button>
        {b.rows.some((r) => r.status === "queued") && <button onClick={b.clearDone} className="self-start text-[12px] text-muted hover:text-ink">Clear queued rows</button>}
        <div className="mt-4"><Feed tab="batch" allProjects empty={<span>Nothing made from the batch yet — press Queue above.</span>} /></div>
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
  const tone = status === "READY" || status === "DONE" ? "border-good/40 text-good" : status === "ERROR" ? "border-bad/50 text-bad" : status === "NEEDS INPUT" ? "border-line text-dim" : "border-accent/50 text-accent";
  const locked = r.status === "queued" || r.status === "writing";
  const who = r.charId ? useCharacters.getState().list.find((x) => x.id === r.charId)?.name ?? "?" : "";
  const title = r.civit ? `Recreate post ${r.civit.id}` : r.idea.trim() || (r.imitate ? (video ? "Imitate this" : "Copy this picture") : `Row ${n + 1}`);
  // what this row carries, as small labels
  const tags = [who && `★ ${who}`, r.pose && `pose: ${r.pose.title.slice(0, 30)}`, r.control && !r.pose && "depth pose", r.loras?.length && `${r.loras.length} LoRA${r.loras.length > 1 ? "s" : ""}`,
    r.checkpoint && `checkpoint: ${r.checkpoint === "official" ? "official" : r.checkpoint.split("/").pop()!.replace(/\.safetensors$/, "").slice(0, 22)}`,
    r.toSet && `→ “${r.toSet.title}” ${r.toSet.tier}`, r.faceFix && "face pass", r.inspo && "saved scene", r.expression && r.expression.split(",")[0]].filter(Boolean) as string[];
  return (
    <div className={cx("card group flex gap-4 border p-3 transition-colors", r.status === "error" ? "border-bad/50" : "border-line hover:border-[#3a3e46]")}>
      {r.civit ? (
        <button onClick={() => openViewer([{ url: r.civit!.url, kind: "image" as const, label: `CivitAI ${r.civit!.id}` }], 0)} className="press relative h-[160px] w-[120px] shrink-0 overflow-hidden border border-line bg-raised2 hover:border-accent" title="The post being recreated">
          <img src={r.civit.thumb || r.civit.url} alt="" className="h-full w-full object-cover" />
          <span className="micro absolute bottom-1 left-1 bg-black/75 px-1 text-accent">CIVITAI</span>
        </button>
      ) : r.pose && !r.imitate ? (
        <span className="relative h-[160px] w-[120px] shrink-0 overflow-hidden border border-line bg-black/40" title={r.pose.title}>
          <img src={r.pose.thumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
          <span className="micro absolute bottom-1 left-1 bg-black/75 px-1 text-cyan">POSE</span>
        </span>
      ) : <Slot className="h-[160px] w-[120px] shrink-0" value={r.imitate} onChange={(m) => update(r.id, { imitate: m, prompt: m === r.imitate ? r.prompt : "", status: "new" })} accept={["image", "video"]} label={video ? "Clip or picture to imitate" : "Picture to copy"} />}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start gap-2">
          <span className="micro mt-1 shrink-0 text-dim">#{String(n + 1).padStart(2, "0")}</span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink" title={title}>{title}</span>
          <span className={cx("micro shrink-0 rounded-full border px-2 py-[3px]", tone)}>{status}</span>
          <button aria-label={`Remove row ${n + 1}`} onClick={() => remove(r.id)} className="-mr-1 shrink-0 text-dim opacity-60 hover:text-bad group-hover:opacity-100"><Icon name="x" size={15} /></button>
        </div>
        {tags.length > 0 && <div className="flex flex-wrap gap-1">{tags.map((t) => <span key={t} className="inline-flex h-5 items-center rounded-full border border-line px-2 text-[11px] text-muted">{t}</span>)}</div>}
        {r.civit && <span className="text-[11.5px] text-muted"><a href={r.civit.page} target="_blank" rel="noreferrer" className="underline hover:text-ink">post {r.civit.id}</a> · {recreateLine(r.civit)}</span>}
        {!r.civit && (!r.prompt.trim() || video || r.imitate) && <input value={r.idea} disabled={locked} onChange={(e) => update(r.id, { idea: e.target.value })}
          placeholder={video ? (r.imitate ? "Anything to change? e.g. on a beach at sunset (optional)" : "The idea, e.g. she twirls in the rain and laughs") : (r.imitate ? (swap ? "Which person if there are several (“the woman on the left”), or a change — optional" : "What to change (optional)") : "Describe the picture")}
          className="inset h-9 border px-2.5 text-[13.5px] focus:border-accent focus:outline-none disabled:opacity-60" />}
        {r.civit && <RecreateRow r={r} locked={locked} />}
        {(video || (!r.civit && !r.imitate && (r.prompt.trim() || r.status === "writing"))) && (
          <textarea value={r.prompt} disabled={locked} onChange={(e) => update(r.id, { prompt: e.target.value, status: e.target.value.trim() ? "ready" : "new" })} rows={3}
            placeholder={r.status === "writing" ? (writerOutside() ? "Waiting for your Grok answer…" : "The writer is on it…") : !video ? "The Krea 2 prompt" : "The H3 prompt — press Write prompts to have it written from the clip/picture and idea, or type your own"}
            className={cx("inset min-h-[76px] flex-1 resize-y border px-2.5 py-2 font-mono text-[12px] leading-relaxed focus:border-accent focus:outline-none disabled:opacity-70", r.status === "writing" && "shimmer")} />
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 text-[12px]">
          <label className="flex items-center gap-1.5 text-muted">Takes
            <DropSelect value={r.takes} disabled={locked} onChange={(e) => update(r.id, { takes: Number(e.target.value) })} className="inset h-7 border px-1.5 text-[12.5px]">
              {(r.civit ? [1, 2, 3, 4, 6, 8] : [1, 2, 3, 4]).map((k) => <option key={k} value={k}>×{k}</option>)}
            </DropSelect></label>
          {r.step && <span className="truncate text-accent">{r.step}</span>}
          {r.note && !r.error && <span className="truncate text-muted" title={r.note}>{r.note}</span>}
          {(r.error || (problem && r.status !== "queued")) && <span className="truncate text-muted" title={r.error ?? problem}>{r.error ?? problem}</span>}
          <span className="ml-auto flex items-center gap-2">
            {jobs.length > 0 && <span className="flex gap-1">{jobs.map((j) => <span key={j.id} title={`${j.label}: ${j.status}`} className={cx("h-1.5 w-6", j.status === "done" ? "bg-good" : j.status === "running" ? "stripes" : j.status === "error" ? "bg-bad" : "bg-raised2")} />)}</span>}
            {!!r.results?.length && <span className="flex gap-1">{r.results.map((u, i) => <button key={u} title={r.idea || `Row ${n + 1}`} onClick={() => openViewer(r.results!.map((x) => ({ url: x, kind: "image" as const, label: r.idea || `Row ${n + 1}` })), i)} className="press h-12 w-9 overflow-hidden border border-line hover:border-accent"><img src={u} alt="" className="h-full w-full object-cover" /></button>)}</span>}
            {r.debug && <button onClick={() => copyText(debugText([r]), "Debug copied — paste it to Claude")} title="What this row sent (path, pose, depth, LoRAs, likeness reference) — to paste to Claude" className="text-dim hover:text-ink">Copy debug</button>}
            {r.status === "queued" && !r.step && <button onClick={() => update(r.id, { status: r.prompt ? "ready" : "new", jobIds: [], results: undefined })} className="text-muted hover:text-ink">Run again</button>}
          </span>
        </div>
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
    <div className="flex flex-col gap-2">
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

/** "Krea 2 · 2 LoRAs · euler/simple · 8 steps" */
function recreateLine(g: NonNullable<Row["civit"]>) {
  const loras = g.resources.filter((x) => x.kind === "lora").length;
  const model = { anima: "Anima", sdxl: "Illustrious", krea2: "Krea 2", qwen: "Krea 2" }[g.family as string] ?? "Create's model";
  const post = (useBatch.getState().rec?.settings ?? "mine") === "post";
  return [model, `${loras} LoRA${loras === 1 ? "" : "s"}`, post && g.sampler && `${g.sampler}${g.scheduler ? `/${g.scheduler}` : ""}`, post && g.steps && `${g.steps} steps`, !post && "your Create settings"].filter(Boolean).join(" · ");
}

/** Recreate CivitAI posts: pick several saved posts → each one made again with its own prompt, settings and LoRAs */
function RecreatePanel() {
  const n = useBatch((s) => s.rows.filter((r) => r.civit && r.status !== "queued").length);
  const rec = useBatch((s) => s.rec) ?? DEFAULT_REC;
  const chars = useCharacters(useShallow((s) => s.list.filter(isAdult)));
  const set = (p: Partial<RecreatePrefs>) => useBatch.getState().set({ rec: { ...rec, ...p } });
  // what "My Create settings" means right now (realistic: Krea 2 and your checkpoint, shape, size, sampler, steps)
  const cs = useSettings((st) => st.s.create);
  const createLine = (() => {
    const mi = modelOf(cs, "realistic");
    const ck = cs.checkpoint?.[mi.model]?.split("/").pop()?.replace(/\.safetensors$/, "");
    const SZ = { portrait: [1088, 1920], tall: [1152, 1728], square: [1440, 1440], wide: [1920, 1088] } as const;
    const [w, h] = SZ[cs.shape ?? "portrait"] ?? SZ.portrait;
    const k = cs.draft ? 0.72 : 1; const up = cs.upscale ?? 1;
    return [ck || mi.label, `${Math.round(w * k / 16) * 16}×${Math.round(h * k / 16) * 16}${up > 1.01 ? ` → ×${up}` : ""}`, `${mi.adv.sampler}/${mi.adv.scheduler}`, `${mi.adv.steps} steps`, cs.balance !== false ? "LoRAs balanced" : "LoRAs as posted"].join(" · ");
  })();
  const change = (k: keyof RecreatePrefs["change"], v: string) => set({ change: { ...rec.change, [k]: v } });
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-raised/40 p-3 text-[12.5px]">
      <b className="font-medium">Recreate CivitAI posts</b>
      <span className="-mt-1.5 text-[11.5px] leading-relaxed text-dim">Tick saved posts → each is made again with its own prompt, settings and LoRAs (missing ones download first). The look stays as posted; the framing can rotate so the set is a mix of shots.</span>
      <Btn onClick={async () => { const { openRecreatePicker } = await import("../components/ImageImport"); openRecreatePicker(); }}><Icon name="link" size={14} /> Pick posts from CivitAI</Btn>
      <Seg label="Settings" value={rec.settings ?? "mine"} onChange={(v) => set({ settings: v })} options={[{ value: "mine", label: "My Create settings" }, { value: "post", label: "The post's" }]} />
      <span className="-mt-1.5 text-[11.5px] leading-relaxed text-dim">{(rec.settings ?? "mine") === "mine"
        ? <>Only each post's words and LoRAs come over. Made with: <b className="font-medium text-muted">{createLine}</b>. Change these in 03 Create.</>
        : "Each post's own sampler, steps, CFG and shape (its size picked for Krea 2). Posts made for other models often look worse this way."}</span>
      <Seg label="Framing" value={rec.frame} onChange={(v) => set({ frame: v })} options={[{ value: "mix", label: "Mix of shots" }, { value: "posted", label: "As posted" }]} />
      {rec.frame === "mix" && <div className="-mt-1 flex flex-wrap gap-1">
        {FRAMES.map((f) => { const on = rec.frames.includes(f.id); return (
          <button key={f.id} aria-pressed={on} onClick={() => set({ frames: on ? rec.frames.filter((x) => x !== f.id) : [...rec.frames, f.id] })} title={f.sentence}
            className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", on && "on")}>{f.label}</button>); })}
      </div>}
      {rec.frame === "mix" && <span className="-mt-1 text-[11.5px] text-dim">Each take gets the next shot in turn, across all posts. Only the framing words change; pose, look and outfit stay as posted unless you type otherwise.</span>}
      <span className="lbl mt-1">Change in every post (optional)</span>
      <TextIn value={rec.change.setting ?? ""} onChange={(v) => change("setting", v)} placeholder="Background, e.g. a sunlit bedroom with white sheets" />
      <TextIn value={rec.change.outfit ?? ""} onChange={(v) => change("outfit", v)} placeholder="Outfit, e.g. an oversized grey hoodie" />
      <TextIn value={rec.change.lighting ?? ""} onChange={(v) => change("lighting", v)} placeholder="Light, e.g. soft window light" />
      <label className="flex flex-col gap-1.5"><span className="lbl">Results go to</span>
        <DropSelect value={rec.project} onChange={(e) => set({ project: e.target.value })} className="inset h-9 border px-2 text-[13px]">
          <option value="">Free work</option>
          {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </DropSelect>
        <span className="text-[11.5px] text-dim">A post you've made a character from goes to that character by itself.</span>
      </label>
      {n > 0 && <span className="text-[11.5px] text-muted">{n} post{n === 1 ? "" : "s"} waiting below — set takes per row, then Queue.</span>}
    </div>
  );
}

/** one post's prompt, as pieces (Who · Looks · Outfit · Pose · Setting · Light · Camera — click one, change it in words) or
 *  as text; where its results go; and New character from it */
function RecreateRow({ r, locked }: { r: Row; locked: boolean }) {
  const { update } = useBatch();
  const [view, setView] = useState<"pieces" | "text">(() => { try { return (localStorage.getItem("h3.batch.recView") as "pieces" | "text") || "pieces"; } catch { return "pieces"; } });
  const chars = useCharacters(useShallow((s) => s.list.filter(isAdult)));
  const linked = postCharacter(r.civit!.id);
  const toast = useJobs((s) => s.toast);
  const pick = (v: "pieces" | "text") => { setView(v); try { localStorage.setItem("h3.batch.recView", v); } catch { /* */ } };
  // highlight + right-click in the Text view: rewrite that part (Local or Grok), like Create's prompt box
  const rw = useRewriteMenu("batch", r.prompt, (v) => update(r.id, { prompt: v, status: v.trim() ? "ready" : "new" }));
  const newChar = async () => {
    try {
      const [{ genMedia }, { useNewFromPicture }, { useSettings }] = await Promise.all([import("../lib/civitUse"), import("./Characters"), import("../lib/settings")]);
      const m = await genMedia(r.civit!);
      useCharacters.getState().select(null);
      useNewFromPicture.setState({ pic: m, gen: r.civit! });
      useSettings.getState().setTab("characters");
      toast("Name them and press Read the picture. Pictures recreated from this post move into their project.", "good");
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
        <span className="flex gap-0.5">{(["pieces", "text"] as const).map((v) => <button key={v} onClick={() => pick(v)} aria-pressed={view === v} className={cx("press border px-1.5 py-0.5", view === v ? "border-accent text-accent" : "border-line text-muted hover:text-ink")}>{v === "pieces" ? "Pieces" : "Text"}</button>)}</span>
        <span className="text-dim">{view === "pieces" ? "click a piece (the background, say) → change it in plain words" : ""}</span>
        <span className="ml-auto flex items-center gap-1.5 text-muted">Goes to
          <DropSelect value={r.charId ?? linked ?? ""} disabled={locked} onChange={(e) => update(r.id, { charId: e.target.value || undefined })} className="inset h-7 border px-1.5 text-[12px]">
            <option value="">{useBatch.getState().rec?.project ? "the batch's pick" : "Free work"}</option>
            {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </DropSelect>
          {!linked && <button onClick={newChar} className="text-accent hover:underline" title="A new character (own project) from this post's picture — its LoRAs come along, and every picture recreated from it moves there">New character from it</button>}
        </span>
      </div>
      {view === "pieces" && !locked
        ? <PromptPieces value={r.prompt} onChange={(v) => update(r.id, { prompt: v, status: v.trim() ? "ready" : "new" })} tab="batch" />
        : <><textarea value={r.prompt} disabled={locked} onChange={(e) => update(r.id, { prompt: e.target.value, status: e.target.value.trim() ? "ready" : "new" })} rows={4}
            onContextMenu={rw.onContextMenu} title="Highlight words and right-click to have Local or Grok rewrite just that part"
            placeholder="Its prompt — change any of it, or leave it as posted"
            className="inset min-h-[92px] resize-y border px-2.5 py-2 font-mono text-[12px] leading-relaxed focus:border-accent focus:outline-none disabled:opacity-70" />{rw.menu}</>}
    </div>
  );
}

/** one line per row (Fold rows): name, status, takes, remove — for long cosplay / pose batches */
function RowLine({ r, n }: { r: Row; n: number }) {
  const { update, remove } = useBatch();
  const problem = rowProblem(r);
  const st = r.status === "queued" ? "QUEUED" : r.status === "writing" ? "WRITING" : r.status === "error" ? "ERROR" : problem ? "NEEDS INPUT" : "READY";
  return (
    <div className="flex items-center gap-2 border border-line px-3 py-1.5 text-[12.5px]" title={r.prompt || r.idea}>
      <span className="micro w-7 text-dim">#{String(n + 1).padStart(2, "0")}</span>
      {r.imitate && <img src={r.imitate.url} alt="" className="h-7 w-5 object-cover" />}
      <span className="min-w-0 flex-1 truncate">{r.idea || r.prompt || "(empty)"}</span>
      {r.control && <span className="micro text-accent" title="Pose copied from its depth">POSE</span>}
      <span className={cx("micro", st === "READY" ? "text-good" : st === "ERROR" ? "text-bad" : "text-dim")} title={r.error ?? problem}>{st}</span>
      <DropSelect value={r.takes} disabled={r.status === "queued"} onChange={(e) => update(r.id, { takes: Number(e.target.value) })} className="inset h-7 border px-1 text-[12px]">
        {[1, 2, 3, 4].map((k) => <option key={k} value={k}>×{k}</option>)}</DropSelect>
      <button aria-label={`Remove row ${n + 1}`} onClick={() => remove(r.id)} className="text-muted hover:text-bad"><Icon name="x" size={14} /></button>
    </div>);
}

/** one instruction for every waiting row: the writer (DeepSeek) works it into each prompt, side by side */
function ChangeAll() {
  const rows = useBatch(useShallow((s) => s.rows.filter((r) => r.status !== "queued" && r.status !== "writing" && r.prompt.trim())));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const toast = useJobs((s) => s.toast);
  if (rows.length < 2) return null;
  const go = async () => {
    const change = text.trim();
    if (!change) return;
    const ids = rows.map((r) => r.id);
    const { runWriter } = await import("../lib/writer");
    let done = 0, bad = 0, next = 0;
    setBusy(`0/${ids.length}`);
    const one = async (id: string) => {
      const r = useBatch.getState().rows.find((x) => x.id === id);
      if (!r) return;
      useBatch.getState().update(id, { status: "writing" });
      try {
        const out = (await runWriter("remix", { prompt: r.prompt, change }, { tab: "batch", label: `Changing row ${useBatch.getState().rows.indexOf(r) + 1}`, big: true })).trim();
        useBatch.getState().update(id, { prompt: out || r.prompt, status: "ready" });
      } catch (e) { bad++; useBatch.getState().update(id, { status: "ready", note: `Not changed: ${(e as Error).message.slice(0, 80)}` }); }
      setBusy(`${++done}/${ids.length}`);
    };
    const { writerOutside } = await import("../lib/outside");
    await Promise.all(Array.from({ length: Math.min(writerOutside() ? 1 : 4, ids.length) }, async () => { while (next < ids.length) await one(ids[next++]); }));
    setBusy("");
    toast(bad ? `Changed ${done - bad} of ${ids.length} prompts — ${bad} kept as they were` : `Changed all ${ids.length} prompts`, bad ? "info" : "good");
    if (!bad) setText("");
  };
  return (
    <div className="flex items-center gap-2 border border-line bg-raised/40 px-3 py-2">
      <Icon name="script" size={14} className="shrink-0 text-muted" />
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !busy) void go(); }} disabled={!!busy}
        placeholder={`Change all ${rows.length} prompts at once — e.g. "make it night with neon light", "add a black choker", "less smiling"`}
        className="h-8 min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-dim focus:outline-none" />
      <Btn small onClick={go} disabled={!text.trim() || !!busy} why={busy ? "Working…" : "Type a change"}>{busy ? `Changing ${busy}` : `Change ${rows.length}`}</Btn>
    </div>);
}

/** Poses: PoseWear picks → one picture per pose (× each picked outfit), the pose copied through its depth */
function PosesPanel() {
  const pw = usePoseWear();
  const poses = pw.picks.filter((p) => p.lib === "poses" || p.lib === "depths");
  const wear = pw.picks.filter((p) => p.lib === "costumes" || p.lib === "anime");
  const face = pw.picks.find((p) => p.lib === "portraits");
  const toast = useJobs((s) => s.toast);
  const [busy, setBusy] = useState("");
  const add = async () => {
    try { setBusy("…"); const { posesToBatch } = await import("../lib/posewear"); const n = await posesToBatch((m) => setBusy(m)); toast(`Added ${n} row${n === 1 ? "" : "s"} — check them, then Queue`, "good"); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-raised/40 p-3 text-[12.5px]">
      <b className="font-medium">Poses from PoseWear</b>
      <span className="-mt-1.5 text-[11.5px] leading-relaxed text-dim">Tick depth poses, poses and outfits in the browser. Each pose becomes a picture (× each outfit): Krea 2 copies its body position from its depth, and its words go in the prompt.</span>
      <Btn onClick={() => import("../components/PoseWear").then(({ openPoseWear }) => openPoseWear("many", "depths"))}><Icon name="user" size={14} /> Browse poses &amp; outfits</Btn>
      <span className="text-muted">{poses.length} pose{poses.length === 1 ? "" : "s"} · {wear.length} outfit{wear.length === 1 ? "" : "s"}{face ? " · a face" : ""} picked</span>
      {pw.picks.length > 0 && <div className="flex flex-wrap gap-1">{pw.picks.map((p) => <button key={p.key} title={`${p.title} — click to remove`} onClick={() => pw.toggle(p)} className="press h-12 w-9 overflow-hidden border border-line hover:border-bad"><img src={p.thumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" /></button>)}</div>}
      <TextIn value={pw.who} onChange={(v) => pw.set({ who: v })} placeholder="Who's in them, e.g. an adult woman in her late twenties with auburn hair (blank: the face pick, or a woman in her twenties)" />
      <label className="flex items-center gap-2 text-muted">Pose strength<input type="range" min={0.4} max={1} step={0.05} value={pw.strength} onChange={(e) => pw.set({ strength: Number(e.target.value) })} className="flex-1" /><span className="w-8 font-mono">{pw.strength.toFixed(2)}</span></label>
      <Btn onClick={add} disabled={!poses.length || !!busy} why={busy || "Pick poses first"}><Icon name="plus" size={14} /> Add {poses.length * Math.max(1, wear.length) || ""} to batch</Btn>
      <span className="text-[11.5px] leading-relaxed text-dim">Realistic (Krea 2) pictures only. With a Star picked, her picture is made from her sheet and the pose goes in as words — the depth copy works on pictures made from words.</span>
    </div>);
}

/** take back an "Add to batch" press, drop copies, or clear everything that's still waiting */
function RowTools() {
  const rows = useBatch((s) => s.rows);
  const toast = useJobs((s) => s.toast);
  const [sure, setSure] = useState(false);
  const waiting = rows.filter((r) => r.status !== "queued" && (r.prompt.trim() || r.idea.trim() || r.imitate || r.civit));
  if (waiting.length < 2) return null;
  const groups = addGroups();
  const dupes = (() => { const seen = new Set<string>(); let n = 0; for (const r of waiting) { const k = `${r.idea}\n${r.prompt}\n${r.imitate?.url ?? ""}\n${r.civit?.id ?? ""}`; if (seen.has(k)) n++; else seen.add(k); } return n; })();
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      {groups.slice(-3).map((g) => (
        <button key={g.id} onClick={() => { undoGroup(g.id); toast(`Took back ${g.n} ${g.label.toLowerCase()} row${g.n === 1 ? "" : "s"}`, "info"); }} title="Remove the rows this press added (ones already queued stay)"
          className="press btn-raised flex h-8 items-center gap-1.5 px-2.5"><Icon name="back" size={13} className="text-muted" />Undo “{g.label}” · {g.n}</button>))}
      {dupes > 0 && <button onClick={() => { const n = removeDuplicates(); toast(`Removed ${n} duplicate row${n === 1 ? "" : "s"}`, "good"); }} className="press btn-raised flex h-8 items-center gap-1.5 px-2.5 text-hot"><Icon name="trash" size={13} />Remove {dupes} duplicate{dupes === 1 ? "" : "s"}</button>}
      {rows.some((r) => r.debug) && <button onClick={() => copyText(debugText(useBatch.getState().rows.filter((r) => r.debug)), "Debug report copied — paste it to Claude")} title="What every queued row sent, with its jobs' results — to paste to Claude"
        className="press btn-raised flex h-8 items-center gap-1.5 px-2.5"><Icon name="script" size={13} className="text-muted" />Copy debug report</button>}
      {sure
        ? <span className="flex items-center gap-1.5">Remove all {waiting.length} waiting rows?<button onClick={() => { clearWaiting(); setSure(false); toast("Cleared the waiting rows", "info"); }} className="press text-bad hover:underline">Yes, clear</button><button onClick={() => setSure(false)} className="press text-muted hover:text-ink">No</button></span>
        : <button onClick={() => setSure(true)} className="press ml-auto text-dim hover:text-bad">Clear {waiting.length} waiting rows</button>}
    </div>);
}

/** what rows sent and how their jobs went, as text to paste to Claude */
function debugText(rows: Row[]): string {
  const jobs = useJobs.getState().jobs;
  return [`H3 Studio batch debug · ${new Date().toISOString()} · ${rows.length} row${rows.length === 1 ? "" : "s"}`,
    ...rows.map((r, i) => {
      const js = jobs.filter((j) => r.jobIds.includes(j.id));
      return [`--- row ${i + 1}: ${r.idea || "(no title)"}`, ...Object.entries(r.debug ?? {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v ?? "—"}`),
        ...js.map((j) => `job ${j.id}: ${j.status}${j.error ? ` — ${String(j.error).slice(0, 300)}` : ""}${j.outputs?.length ? ` · ${j.outputs.map((o) => o.filename).join(", ")}` : ""}`)].join("\n");
    })].join("\n\n");
}

/** realistic pictures' checkpoint for the batch: 03 Create's, or one picked here (with + Add from a CivitAI link); locked = every
 *  row uses it (Cosplay's DeepSeek then doesn't pick one), unlocked = rows that picked their own keep theirs */
function BatchCheckpoint() {
  const ck = useBatch((s) => s.ck) ?? { mode: "create" as const, name: "", locked: false };
  const set = (p: Partial<typeof ck>) => useBatch.getState().set({ ck: { ...ck, ...p } });
  const value = ck.mode === "create" ? "@create" : ck.name;
  return (
    <CheckpointPicker model="krea2" models={["krea2"]} follow="Same as 03 Create" value={value}
      onChange={(v) => set(v === "@create" ? { mode: "create", locked: false } : { mode: "pick", name: v })}
      right={ck.mode === "pick" && <button onClick={() => set({ locked: !ck.locked })} aria-pressed={ck.locked}
        title={ck.locked ? "Locked: every row uses it, and Cosplay's DeepSeek won't pick another. Click to unlock" : "Not locked: rows without their own use it, and DeepSeek may still pick one per cosplay character. Click to lock"}
        className={cx("press flex h-5 items-center gap-1 rounded-sm border px-1.5 text-[10.5px]", ck.locked ? "border-accent/60 bg-accent/15 text-accent" : "border-line text-dim hover:text-ink")}>
        <Icon name={ck.locked ? "lock" : "unlock"} size={10} />{ck.locked ? "Locked" : "Auto"}</button>} />
  );
}
