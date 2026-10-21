// Scenes: build multi-shot videos with consistent original characters.
//   Cast (look blocks) → per shot: starting frame (Krea 2) → shot description → blueprint → H3 prompt → video (FL2VA).
// Each arrow is one local-LLM step with its own system prompt — drop your own .json/.txt prompt files on the
// "Prompt files" panel (or anywhere in the Studio) and they take over that step.
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { sendTo, usePrimaryAction } from "../App";
import { Modal, askConfirm, askText } from "../components/Dialogs";
import { Chip, Workspace } from "../components/Workspace";
import { openViewer } from "../components/Viewer";
import { Btn, Icon, LoraList, Seg, Select, Slider, Slot, TextArea, cx, DropSelect } from "../components/ui";
import { inputUrl, toInput, viewUrl, type FileRef } from "../lib/api";
import { isAdult, useCharacters, type Character } from "../lib/characters";
import { useDownloads } from "../lib/downloads";
import { useJobs } from "../lib/jobs";
import { activatePack, deletePack, dropPacks, packText, savePackCopy, STAGE_INFO, STAGE_ORDER, updatePack, usePacks, type Pack, type Stage } from "../lib/packs";
import {
  animeCast, frameModelLabel, applyFixes, bigWriter, standIn, castOf, continueFromPrevious, parseShotPrefix, undoStep, writerWhy, type TextStep, lookBlock, MODE_INFO, newScene, newShot, runAll, runStep, setFrame, useScenes, videoMp, writeLook,
  type Scene, type Shot, type ShotMode, type Step,
} from "../lib/scenes";
import { useSettings } from "../lib/settings";
import { DRAG_TYPE, useTray, type Media } from "../lib/tray";
import { useWork } from "../lib/work";
import { copyText } from "../lib/copy";

const SECONDS = [4, 5, 6, 8, 10, 12, 15];
const fmtSecs = (n: number) => `${n} s`;

export default function ScenesTab() {
  const { list, sel, loaded } = useScenes(useShallow((s) => ({ list: s.list, sel: s.sel, loaded: s.loaded })));
  const scene = list.find((s) => s.id === sel) ?? null;
  const loadPacks = usePacks((s) => s.load);
  const active = useSettings((s) => s.s.tab === "scenes");
  useEffect(() => { if (active) loadPacks(); }, [active, loadPacks]);
  useEffect(() => { if (loaded && !list.length) useScenes.getState().add(newScene("My first scene")); }, [loaded, list.length]);

  return (
    <Workspace tab="scenes" title="Scenes" sub="frame → blueprint → H3 prompt → video" needs="video" drawerWidth={380}
      bar={scene ? <NewShot scene={scene} /> : undefined}
      drawer={scene ? <SceneDrawer scene={scene} /> : <p className="text-muted">Loading…</p>}>
      {scene ? <ShotList scene={scene} /> : null}
    </Workspace>
  );
}

// ------------------------------------------------------------------ top bar: write the next shot
function NewShot({ scene }: { scene: Scene }) {
  const [text, setText] = useState("");
  const [secs, setSecs] = useState(8);
  const [mode, setMode] = useState<ShotMode>("i2v");
  const [pic, setPic] = useState<Media | null>(null);
  const patch = useScenes((s) => s.patch);
  const add = async (run: boolean) => {
    if (!text.trim()) return;
    // "12 second i2v. …" at the start sets the length and type, like you'd write it for LM Studio
    const p = parseShotPrefix(text);
    const shot = newShot({ description: p.rest, seconds: p.seconds ?? secs, mode: pic ? "i2v" : p.mode ?? mode });
    patch(scene.id, { shots: [...scene.shots, shot] });
    setText("");
    // your starting picture goes in first, so the writer sees it while planning
    if (pic) { await setFrame(scene.id, shot.id, { filename: pic.name, subfolder: "", type: "input" }).catch(() => {}); setPic(null); }
    if (run) setTimeout(() => runAll(scene.id, shot.id), 50);
  };
  usePrimaryAction("scenes", () => add(true));
  return (
    <div className="ticks frame card flex gap-3 border border-line p-3.5">
      <div className="w-24 shrink-0">
        <Slot className="h-28" value={pic} onChange={setPic} label="Starting picture" hint="optional" />
      </div>
      <div className="min-w-0 flex-1">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Describe the next shot"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(true); } }}
        placeholder={"Describe the next shot precisely — actions in order, camera moves, exact dialogue in quotes, timing.\ne.g. The girl turns to her screen, puts her left hand on the mic and says, \"Never pick blue team.\" The camera slowly pushes in…"}
        className="w-full resize-y bg-transparent text-[14.5px] leading-relaxed placeholder:text-dim focus:outline-none" />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Chip title="Length" value={secs} onChange={setSecs} options={SECONDS.map((n) => ({ value: n, label: fmtSecs(n) }))} />
        <Chip title="Type" value={mode} onChange={setMode} options={(Object.keys(MODE_INFO) as ShotMode[]).map((k) => ({ value: k, label: MODE_INFO[k].label }))} />
        <span className="micro ml-1 text-dim">{(() => { const p = parseShotPrefix(text); return p.seconds || p.mode ? `READ FROM YOUR TEXT: ${p.seconds ? `${p.seconds} S` : ""} ${p.mode ? p.mode.toUpperCase() : ""}` : MODE_INFO[mode].sub; })()}</span>
        <div className="ml-auto flex gap-1.5">
          <Btn onClick={() => add(false)} disabled={!text.trim()} why="Write the shot first">Add shot</Btn>
          <button onClick={() => add(true)} disabled={!text.trim()} className="press chamfer btn-primary flex h-10 items-center gap-2 px-5 text-[13.5px] font-bold uppercase tracking-wide disabled:opacity-40"
            title={`Add it and write the plan: ${scene.autoFrames ? "starting frame, " : ""}blueprint and H3 prompt — nothing is rendered until you press Make video (Ctrl+Enter)`}>
            Add &amp; write the plan <Icon name="arrow" size={15} />
          </button>
        </div>
      </div>
      <p className="mt-1.5 text-[11.5px] text-dim">{pic ? "The writer looks at your starting picture while it plans, and the video starts on it." : "Drop a starting picture on the left so the writer can see who's in it and where."} Writing the plan never makes a video — press Make video on the shot when it reads right.</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ left drawer
function SceneDrawer({ scene }: { scene: Scene }) {
  const { list, patch, add, remove, select } = useScenes(useShallow((s) => ({ list: s.list, patch: s.patch, add: s.add, remove: s.remove, select: s.select })));
  const groups = useDownloads((s) => s.groups);
  const xl = groups.find((g) => g.id === "writer_xl");
  const big = bigWriter(scene);
  return (
    <>
      <div className="flex items-end gap-1.5">
        <div className="min-w-0 flex-1"><Select label="Scene" value={scene.id} onChange={select} options={list.map((s) => ({ value: s.id, label: `${s.name} · ${s.shots.length} shot${s.shots.length === 1 ? "" : "s"}` }))} /></div>
        <Btn small onClick={async () => { const n = await askText("Name the new scene", "New scene", "Create"); if (n) add(newScene(n)); }} title="New scene"><Icon name="plus" size={14} /></Btn>
        <Btn small onClick={async () => { const n = await askText("Rename scene", scene.name); if (n) patch(scene.id, { name: n }); }} title="Rename"><Icon name="script" size={14} /></Btn>
        <Btn small onClick={async () => { if (await askConfirm(`Delete “${scene.name}”?`, "Its shots and prompts go too. Videos stay in your outputs.", "Delete", true)) remove(scene.id); }} title="Delete scene"><Icon name="trash" size={14} /></Btn>
      </div>

      <Cast scene={scene} />

      <Seg label="Shape" value={scene.aspect} onChange={(v) => patch(scene.id, { aspect: v })} options={[{ value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }, { value: "1:1", label: "1:1" }]} />

      <div>
        <span className="lbl">Writer model · Qwen3.8 27B</span>
        <p className="mt-1 text-[11.5px] text-dim">
          {standIn(scene) ? `Fable 9B is writing for now — the 27B ${xl?.state === "later" ? "is set to download later" : `is still downloading (${xl?.state === "downloading" ? `${xl.pct}%` : "in line"})`} and takes over once it's in.`
            : big && xl && xl.state !== "done" ? `27B is downloading (${xl.pct}%) — the steps unlock when it's in.`
            : !xl ? "This rental's image predates the 27B download — use Fable 9B or rent again." : "The model your prompt files were written for."}
        </p>
      </div>
      <div>
        <Seg label="Starting frames come from" value={scene.autoFrames ? "auto" : "mine"} onChange={(v) => patch(scene.id, { autoFrames: v === "auto" })}
          options={[{ value: "mine", label: "My own pictures" }, { value: "auto", label: `${frameModelLabel(castOf(scene))} makes them` }]} />
        <p className="mt-1 text-[11.5px] text-dim">{scene.autoFrames ? `Write the plan also makes a missing starting frame with ${frameModelLabel(castOf(scene))} (follows the cast: anime characters → their anime model, checkpoint and LoRAs; realistic → Krea 2).`
          : `Make them in Create (your checkpoint, LoRAs and prompt), then drag the picture onto a shot's frame. “Make with ${frameModelLabel(castOf(scene))}” on a shot still works if you want one.`}</p>
      </div>
      <div>
        {!animeCast(castOf(scene)) && <><Seg label="Krea 2 frames" value={scene.lockFace === false ? "off" : "on"} onChange={(v) => patch(scene.id, { lockFace: v === "on" })}
          options={[{ value: "on", label: "Lock the face to their sheet" }, { value: "off", label: "From words only" }]} />
        <p className="mt-1 text-[11.5px] text-dim">{scene.lockFace === false ? "Frames come from the look block alone — faster, but the face can drift from shot to shot."
          : "One-character shots: each frame is redone by Krea 2 Edit with their front picture, so the face, hair and body match the sheet. Reference-mode videos get their whole sheet (front, face, 3/4, back, sides)."}</p></>}
      </div>

      <PromptFiles />

      <details className="border border-line px-3 py-2 text-[13px]">
        <summary className="cursor-pointer font-medium">Video settings <span className="text-dim">· {scene.video.steps} steps · {scene.video.sampler} · {scene.video.scheduler}</span></summary>
        <div className="mt-3 flex flex-col gap-3">
          <Slider label="Steps" value={scene.video.steps} min={8} max={60} onChange={(v) => patch(scene.id, { video: { ...scene.video, steps: v } })} />
          <Seg label="Sampler" value={scene.video.sampler} onChange={(v) => patch(scene.id, { video: { ...scene.video, sampler: v } })} options={[{ value: "res_multistep", label: "res_multistep" }, { value: "er_sde", label: "er_sde" }, { value: "euler", label: "euler" }]} />
          <Seg label="Scheduler" value={scene.video.scheduler} onChange={(v) => patch(scene.id, { video: { ...scene.video, scheduler: v } })} options={[{ value: "simple", label: "simple" }, { value: "beta", label: "beta" }, { value: "normal", label: "normal" }]} />
          <Seg label="Resolution" value={String(scene.video.quality)} onChange={(v) => patch(scene.id, { video: { ...scene.video, quality: v === "auto" ? "auto" : Number(v) } })}
            options={[{ value: "auto", label: "Auto" }, { value: "0.55", label: "Low" }, { value: "0.7", label: "Mid" }, { value: "0.9", label: "High" }]} />
          <p className="-mt-1.5 text-[11.5px] text-dim">Auto: high up to 8 s, lower for longer shots (up to 15 s).</p>
          <LoraList family="h3" label="H3 LoRAs (video)" value={scene.video.loras} onChange={(v) => patch(scene.id, { video: { ...scene.video, loras: v } })} />
          {!animeCast(castOf(scene)) && <LoraList family="krea2" label="Krea 2 LoRAs (starting frames)" value={scene.video.frameLoras} onChange={(v) => patch(scene.id, { video: { ...scene.video, frameLoras: v } })} />}
        </div>
      </details>
    </>
  );
}

function Cast({ scene }: { scene: Scene }) {
  const chars = useCharacters((s) => s.list).filter((c) => isAdult(c));
  const patch = useScenes((s) => s.patch);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (c: Character) => patch(scene.id, { cast: scene.cast.includes(c.id) ? scene.cast.filter((x) => x !== c.id) : [...scene.cast, c.id] });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center"><span className="lbl">Cast</span><span className="micro ml-auto text-dim">LOOK BLOCKS STAY WORD-FOR-WORD</span></div>
      {!chars.length && <p className="text-[12.5px] text-muted">No saved characters yet. <button className="text-accent hover:underline" onClick={() => useSettings.getState().setTab("characters")}>Make one in Characters</button>.</p>}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {chars.map((c) => {
          const on = scene.cast.includes(c.id);
          const pic = c.views.face || c.views.front;
          return (
            <button key={c.id} onClick={() => toggle(c)} aria-pressed={on} title={on ? `Remove ${c.name} from this scene` : `Add ${c.name} to this scene`}
              className={cx("press relative flex w-[66px] shrink-0 flex-col gap-1 border p-1 text-left", on ? "border-accent bg-accent/10" : "border-line hover:border-muted")}>
              <span className="checker block h-[70px] overflow-hidden">{pic ? <img src={viewUrl(pic)} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-dim"><Icon name="user" size={18} /></span>}</span>
              <span className="truncate px-0.5 text-[11px]">{c.name}</span>
              {on && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center bg-accent text-accentink"><Icon name="check" size={11} /></span>}
            </button>
          );
        })}
      </div>
      {castOf(scene).map((c) => <LookBlock key={c.id} scene={scene} c={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />)}
    </div>
  );
}

function LookBlock({ scene, c, open, onToggle }: { scene: Scene; c: Character; open: boolean; onToggle: () => void }) {
  const save = useCharacters((s) => s.save);
  const busy = useJobs((s) => s.jobs.some((j) => j.meta?.lookChar === c.id && (j.status === "running" || j.status === "queued")));
  const block = lookBlock(c);
  return (
    <div className="border border-line bg-raised/40">
      <button onClick={onToggle} className="flex w-full items-center gap-2 px-2.5 py-2 text-left">
        <span className="text-[12.5px] font-semibold">{c.name}</span>
        <span className={cx("micro", c.block ? "text-good" : "text-dim")}>{c.block ? "LOOK BLOCK" : "AUTO FROM DETAILS"}</span>
        <span className="ml-auto text-dim">{open ? "−" : "+"}</span>
      </button>
      {!open && <p className="line-clamp-2 px-2.5 pb-2 text-[11.5px] leading-relaxed text-muted">{block}</p>}
      {open && (
        <div className="flex flex-col gap-2 px-2.5 pb-2.5">
          <TextArea rows={6} value={block} onChange={(v) => save({ ...c, block: v })} />
          <div className="flex gap-1.5">
            <Btn small onClick={() => writeLook(scene.id, c)} disabled={busy} why="Writing…"><Icon name="sparkle" size={13} />{busy ? "Writing…" : "Write it for me"}</Btn>
            {c.block && <Btn small onClick={() => save({ ...c, block: undefined })}>Use their details</Btn>}
          </div>
          <p className="text-[11px] leading-relaxed text-dim">Pasted word-for-word into every starting frame and given to the blueprint and compiler steps. Only pose, setting and action change between shots.</p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ prompt files (drop-in system prompts)
export function PromptFiles({ only }: { only?: Stage } = {}) {
  const { packs, active, loaded, error } = usePacks(useShallow((s) => ({ packs: s.packs, active: s.active, loaded: s.loaded, error: s.error })));
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Pack | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const toast = useJobs((s) => s.toast);
  const take = async (files: File[]) => {
    const ok = files.filter((f) => /\.(json|txt|md)$/i.test(f.name));
    if (!ok.length) { toast("Prompt files are .json, .txt or .md", "bad"); return; }
    setBusy(true);
    try {
      const added = await dropPacks(ok);
      toast(added.map((p) => `${p.name} → ${p.stage ? STAGE_INFO[p.stage].short : "pick a step"}`).join(" · "), "good");
      const unsure = added.find((p) => !p.stage);
      if (unsure) setEdit(unsure);
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  useEffect(() => { if (!loaded) usePacks.getState().load(); }, [loaded]);
  if (only) {
    // one step's file, inline (e.g. the Plan-a-video writer in Animate / Plan a video): same files as the full list in Scenes
    const cur = packs.find((p) => p.id === active[only]);
    const mine = packs.filter((p) => p.stage === only);
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <DropSelect value={active[only]} onChange={(e) => activatePack(only, e.target.value)} aria-label={`Prompt file for ${STAGE_INFO[only].title}`}
            className="inset h-8 min-w-0 flex-1 border border-line px-2 text-[12.5px] focus:border-accent focus:outline-none">
            {mine.map((p) => <option key={p.id} value={p.id}>{p.builtin ? "Built-in" : `${p.name}${p.file && p.file !== p.name ? ` (${p.file})` : ""}`}</option>)}
          </DropSelect>
          <button onClick={() => cur && setEdit(cur)} className="press btn-raised h-8 px-2.5 text-[12px]" disabled={!cur}>{cur?.builtin ? "View / copy" : "Edit"}</button>
        </div>
        <p className="text-[11px] leading-relaxed text-dim">The same file as “{STAGE_INFO[only].title}” in Scenes → Prompt files — change it in either place and it's used everywhere.</p>
        {edit && <PackEditor pack={edit} onClose={() => setEdit(null)} />}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center"><span className="lbl">Prompt files</span><span className="micro ml-auto text-dim">{packs.filter((p) => !p.builtin).length} YOURS</span></div>
      <div onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); setOver(true); } }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { if (!e.dataTransfer.files?.length) return; e.preventDefault(); e.stopPropagation(); setOver(false); take(Array.from(e.dataTransfer.files)); }}
        onClick={() => file.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && file.current?.click()}
        className={cx("hatch flex cursor-pointer flex-col items-center gap-1 border border-dashed px-3 py-4 text-center transition-colors", over ? "border-accent bg-accent/10" : "border-line hover:border-muted")}>
        <Icon name="up" size={18} className={over ? "text-accent" : "text-muted"} />
        <span className="text-[13px] font-semibold">{busy ? "Reading…" : "Drop your prompt files here"}</span>
        <span className="text-[11.5px] text-dim">.json · .txt · .md — LM Studio presets work. Each one goes to the step it's for.</span>
      </div>
      <input ref={file} type="file" multiple hidden accept=".json,.txt,.md,application/json,text/plain,text/markdown" onChange={(e) => { if (e.target.files) take(Array.from(e.target.files)); e.target.value = ""; }} />
      {error && <p className="text-[11.5px] text-bad">{error}</p>}
      <ol className="flex flex-col gap-px border border-line bg-line">
        {STAGE_ORDER.map((st, i) => {
          const mine = packs.filter((p) => p.stage === st);
          const cur = packs.find((p) => p.id === active[st]);
          return (
            <li key={st} className="flex flex-col gap-1.5 bg-panel px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="micro w-5 text-dim">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[12.5px] font-semibold">{STAGE_INFO[st].title}</span>
                {cur && !cur.builtin && <span className="micro ml-auto text-accent">YOURS</span>}
              </div>
              <div className="flex items-center gap-1.5 pl-7">
                <DropSelect value={active[st]} onChange={(e) => activatePack(st, e.target.value)} aria-label={`Prompt file for ${STAGE_INFO[st].title}`}
                  className="inset h-8 min-w-0 flex-1 border border-line px-2 text-[12.5px] focus:border-accent focus:outline-none">
                  {mine.map((p) => <option key={p.id} value={p.id}>{p.builtin ? "Built-in" : `${p.name}${p.file && p.file !== p.name ? ` (${p.file})` : ""}`}</option>)}
                </DropSelect>
                <button onClick={() => cur && setEdit(cur)} className="press btn-raised h-8 px-2.5 text-[12px]" disabled={!cur}>{cur?.builtin ? "View" : "Edit"}</button>
              </div>
            </li>
          );
        })}
      </ol>
      {loaded && packs.some((p) => !p.builtin && !p.stage) && (
        <p className="text-[11.5px] text-hot">Some files aren't assigned to a step: {packs.filter((p) => !p.builtin && !p.stage).map((p) => <button key={p.id} className="underline" onClick={() => setEdit(p)}>{p.file || p.name}</button>)}</p>
      )}
      {edit && <PackEditor pack={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PackEditor({ pack, onClose }: { pack: Pack; onClose: () => void }) {
  const templates = usePacks((s) => s.templates);
  const toast = useJobs((s) => s.toast);
  const [text, setText] = useState<string | null>(null);
  const [name, setName] = useState(pack.builtin ? `My ${pack.stage ? STAGE_INFO[pack.stage].short.toLowerCase() : "prompt"}` : pack.name);
  const [stage, setStage] = useState<Stage | "">(pack.stage ?? "");
  const [tpl, setTpl] = useState(pack.template ?? (pack.stage ? templates[pack.stage] : ""));
  const [params, setParams] = useState(pack.params);
  const [thinking, setThinking] = useState<Pack["thinking"]>(pack.thinking ?? "auto");
  const [seeImage, setSeeImage] = useState<boolean>(pack.see_image ?? false);
  useEffect(() => { packText(pack.id).then(setText).catch(() => setText("")); }, [pack.id]);
  const vars = stage ? STAGE_INFO[stage].vars : [];
  const save = async () => {
    if (!stage) { toast("Pick which step this prompt is for", "bad"); return; }
    try {
      if (pack.builtin) await savePackCopy({ name, text: text ?? "", stage, template: tpl, params, thinking, see_image: seeImage });
      else await updatePack(pack.id, { name, stage, text: text ?? undefined, template: tpl, params, thinking, see_image: seeImage });
      toast(pack.builtin ? `Saved “${name}” and switched ${STAGE_INFO[stage].short} to it.` : "Saved.", "good");
      onClose();
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  return (
    <Modal onClose={onClose} width={860} label="Prompt file">
      <div className="flex max-h-[80vh] flex-col">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="micro text-dim">{pack.builtin ? "BUILT-IN" : `${pack.format.toUpperCase()} · ${pack.file || "edited"}`}</div>
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" className="display w-full bg-transparent text-[20px] focus:outline-none" />
          </div>
          <button aria-label="Close" onClick={onClose} className="press btn-raised ml-auto flex h-9 w-9 items-center justify-center"><Icon name="x" size={15} /></button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_260px] gap-0 overflow-hidden">
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
            <span className="lbl">System prompt</span>
            <textarea value={text ?? "Loading…"} onChange={(e) => setText(e.target.value)} spellCheck={false}
              className="inset min-h-[360px] flex-1 resize-none border border-line p-3 font-mono text-[12px] leading-relaxed focus:border-accent focus:outline-none" />
            {pack.builtin && <p className="text-[11.5px] text-dim">Built-in prompts can't be changed — saving makes your own copy and uses it.</p>}
          </div>
          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-line p-4">
            <label className="flex flex-col gap-1"><span className="lbl">Used for</span>
              <DropSelect value={stage} onChange={(e) => { const s = e.target.value as Stage; setStage(s); if (s && (!tpl || Object.values(templates).includes(tpl))) setTpl(templates[s]); }}
                className="inset h-9 border border-line px-2 text-[13px] focus:border-accent focus:outline-none">
                <option value="">— pick a step —</option>
                {STAGE_ORDER.map((s) => <option key={s} value={s}>{STAGE_INFO[s].title}</option>)}
              </DropSelect>
            </label>
            {stage && <p className="-mt-1.5 text-[11.5px] leading-relaxed text-dim">This step {STAGE_INFO[stage].does}.</p>}
            <label className="flex flex-col gap-1"><span className="lbl">What it's sent</span>
              <textarea value={tpl} onChange={(e) => setTpl(e.target.value)} rows={4} spellCheck={false}
                className="inset resize-y border border-line p-2 font-mono text-[11.5px] focus:border-accent focus:outline-none" />
            </label>
            {vars.length > 0 && <p className="-mt-1.5 text-[11px] leading-relaxed text-dim">Fill-ins: {vars.map((v) => <code key={v} className="mr-1 text-accent">{`{${v}}`}</code>)} — a line whose fill-ins are all empty is left out.</p>}
            <label className="flex flex-col gap-1"><span className="lbl">Thinking</span>
              <DropSelect value={thinking} onChange={(e) => setThinking(e.target.value as Pack["thinking"])} className="inset h-9 border border-line px-2 text-[13px] focus:border-accent focus:outline-none">
                <option value="auto">Model default (like LM Studio)</option><option value="on">Always think first</option><option value="off">Answer straight away</option>
              </DropSelect>
            </label>
            {stage !== "look" && (
              <label className="flex items-start gap-2 text-[12.5px]"><input type="checkbox" className="mt-0.5" checked={seeImage} onChange={(e) => setSeeImage(e.target.checked)} />
                <span>Let it see the starting frame{stage === "krea" ? "" : " (or the cast's pictures for Ref shots)"}<span className="block text-[11px] text-dim">Off = text only, like typing into LM Studio.</span></span></label>
            )}
            <div className="grid grid-cols-2 gap-2">
              {([["temperature", "Temperature", 0.05], ["top_p", "Top P", 0.01], ["top_k", "Top K", 1], ["repeat_penalty", "Repeat penalty", 0.01], ["max_tokens", "Max tokens", 64]] as const).map(([k, label, step]) => (
                <label key={k} className="flex flex-col gap-1"><span className="micro text-dim">{label}</span>
                  <input type="number" step={step} value={params[k]} onChange={(e) => setParams({ ...params, [k]: Number(e.target.value) })}
                    className="inset h-8 border border-line px-2 font-mono text-[12px] focus:border-accent focus:outline-none" /></label>
              ))}
            </div>
            <div className="mt-auto flex flex-col gap-1.5 pt-2">
              <button onClick={save} className="press chamfer btn-primary h-10 text-[13.5px] font-bold">{pack.builtin ? "Save as my copy" : "Save"}</button>
              {!pack.builtin && <button onClick={async () => { if (await askConfirm(`Remove “${pack.name}”?`, "The step goes back to the built-in prompt if this one was in use.", "Remove", true)) { await deletePack(pack.id); onClose(); } }}
                className="press btn-raised h-9 text-[12.5px] text-bad">Remove</button>}
            </div>
          </aside>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ the shots
function ShotList({ scene }: { scene: Scene }) {
  const patch = useScenes((s) => s.patch);
  const toast = useJobs((s) => s.toast);
  const videos = scene.shots.map((s) => s.videos[0]).filter(Boolean) as FileRef[];
  const toFinish = () => {
    const ids = videos.map((v, i) => useTray.getState().addOutput(v, `${scene.name} · shot ${i + 1}`)?.id).filter(Boolean) as string[];
    if (!ids.length) { toast("No videos yet", "bad"); return; }
    sendTo("finish", ids);
  };
  if (!scene.shots.length) return (
    <div className="mt-2 flex flex-col items-center justify-center gap-3 border border-dashed border-line px-8 py-14 text-center">
      <b className="display text-[22px]">Write your first shot above</b>
      <p className="max-w-xl text-[13.5px] leading-relaxed text-muted">
        Be precise: actions in order, camera moves, exact dialogue in quotes, rough timing. The steps only expand and organise what you write:
        <span className="mt-2 block text-ink/80">character look block → <b>starting frame</b> (Krea 2) → <b>blueprint</b> → <b>H3 prompt</b> → <b>video</b> (FL2VA)</span>
      </p>
      <p className="text-[12.5px] text-dim">Pick the cast on the left first, and drop your own prompt files there to use them for the steps.</p>
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      {scene.shots.map((shot, i) => <ShotCard key={shot.id} scene={scene} shot={shot} index={i} />)}
      <div className="flex items-center gap-2 border-t border-line pt-3">
        <span className="micro text-dim">{scene.shots.length} SHOTS · {scene.shots.reduce((a, s) => a + s.seconds, 0)} S · {videos.length} VIDEOS</span>
        <Btn small className="ml-auto" onClick={() => scene.shots.forEach((s) => { if (!s.busy && !s.videos.length) runAll(scene.id, s.id); })} title="Blueprint + H3 prompt for every shot that has none — no videos">Write every unfinished plan</Btn>
        <Btn small onClick={toFinish} disabled={!videos.length} why="No videos yet"><Icon name="scissors" size={13} />Join in Finish</Btn>
        <Btn small onClick={() => patch(scene.id, { shots: [...scene.shots, newShot({ seconds: 8 })] })}><Icon name="plus" size={13} />Empty shot</Btn>
      </div>
    </div>
  );
}

const STEPS: { id: Step | "frame"; label: string }[] = [{ id: "frame", label: "FRAME" }, { id: "context", label: "BLUEPRINT" }, { id: "compiler", label: "H3 PROMPT" }, { id: "video", label: "VIDEO" }];

/** up to 3 of your own reference pictures for a shot (a location, an outfit, a pose), each with a short label */
function ShotRefs({ shot, up }: { shot: Shot; up: (p: Partial<Shot>) => void }) {
  const refs = shot.refs ?? [];
  const slots = [...refs, ...(refs.length < 3 ? [null] : [])];
  return (
    <Block title="Reference pictures" sub="optional — the writer looks at these at every step; reference-mode videos get them too">
      <div className="grid grid-cols-3 gap-2">
        {slots.map((r, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Slot className="h-28" value={r ? { name: r.file.filename, kind: "image", url: viewUrl(r.file), label: r.label } : null} label="Add a picture" hint="location, outfit, pose…"
              onChange={(m) => {
                const next = [...refs];
                if (!m) next.splice(i, 1);
                else next[i] = { file: { filename: m.name, subfolder: "", type: "input" }, label: r?.label ?? m.label ?? "" };
                up({ refs: next });
              }} />
            {r && <input value={r.label} onChange={(e) => { const next = [...refs]; next[i] = { ...r, label: e.target.value }; up({ refs: next }); }}
              placeholder="What it is — e.g. the gym" aria-label={`What reference ${i + 1} is`} className="inset h-7 border border-line px-2 text-[12px] focus:border-accent focus:outline-none" />}
          </div>
        ))}
      </div>
    </Block>
  );
}

function ShotCard({ scene, shot, index }: { scene: Scene; shot: Shot; index: number }) {
  const { patch, patchShot } = useScenes(useShallow((s) => ({ patch: s.patch, patchShot: s.patchShot })));
  const job = useJobs((s) => s.jobs.find((j) => j.meta?.shot === shot.id && (j.status === "running" || j.status === "queued")));
  const [open, setOpen] = useState(true);
  const up = (p: Partial<Shot>) => patchShot(scene.id, shot.id, p);
  const done = { frame: shot.mode !== "i2v" || !!shot.frame, context: !!shot.blueprint.trim(), compiler: !!shot.h3.trim(), video: shot.videos.length > 0 } as Record<string, boolean>;
  const isBusy = (s: string) => shot.busy === s || (s === "frame" && shot.busy === "krea");
  const move = (d: -1 | 1) => { const a = [...scene.shots]; const j = index + d; if (j < 0 || j >= a.length) return; [a[index], a[j]] = [a[j], a[index]]; patch(scene.id, { shots: a }); };
  const cast = castOf(scene, shot);
  const sendToAnimate = async () => {
    useSettings.getState().set("animate", { prompt: shot.h3, seconds: Math.min(15, shot.seconds), mode: shot.mode === "ref" ? "ref" : "i2v", aspect: scene.aspect });
    if (shot.frame && shot.mode === "i2v") {
      const f = await toInput(shot.frame);
      useWork.getState().set({ animateFrame: { ...f, url: inputUrl(f.name), label: `Shot ${index + 1} frame` } });
    }
    useSettings.getState().setTab("animate");
  };
  return (
    <article className={cx("ticks border bg-panel", shot.busy ? "border-accent/70" : "border-line")} aria-label={`Shot ${index + 1}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
        <button onClick={() => setOpen((o) => !o)} className="display text-[17px] leading-none" aria-expanded={open}>SHOT {String(index + 1).padStart(2, "0")}</button>
        <DropSelect value={shot.seconds} onChange={(e) => up({ seconds: Number(e.target.value) })} aria-label="Length" className="inset h-7 border border-line px-1.5 font-mono text-[12px]">
          {SECONDS.map((n) => <option key={n} value={n}>{n} s</option>)}
        </DropSelect>
        <DropSelect value={shot.mode} onChange={(e) => up({ mode: e.target.value as ShotMode })} aria-label="Type" className="inset h-7 border border-line px-1.5 text-[12px]">
          {(Object.keys(MODE_INFO) as ShotMode[]).map((k) => <option key={k} value={k}>{MODE_INFO[k].label}</option>)}
        </DropSelect>
        <span className="micro text-dim">{cast.map((c) => c.name).join(" · ") || "NO CAST"} · {Math.round(videoMp(scene, shot.seconds) * 100) / 100} MP</span>
        <ol className="ml-auto flex items-center gap-1" aria-label="Progress">
          {STEPS.map((s) => (
            <li key={s.id} className={cx("micro flex items-center gap-1 px-1.5 py-0.5", isBusy(s.id) ? "bg-accent text-accentink" : done[s.id] ? "text-good" : shot.queue.includes(s.id as Step) ? "text-accent" : "text-dim")}>
              {done[s.id] && !isBusy(s.id) ? "✓" : isBusy(s.id) ? "●" : "○"} {s.label}
            </li>
          ))}
        </ol>
        <button onClick={() => runAll(scene.id, shot.id)} disabled={!!shot.busy} className="press chamfer-sm btn-hot h-8 px-3 text-[12.5px] font-bold disabled:opacity-40" title="Write the missing steps of the plan (blueprint, H3 prompt) — no video">
          {shot.busy ? "Writing…" : done.compiler ? "Plan written ✓" : "Write the plan"}
        </button>
        <ShotMenu onUp={() => move(-1)} onDown={() => move(1)} onDup={() => { const { id: _old, ...rest } = shot; void _old; patch(scene.id, { shots: [...scene.shots.slice(0, index + 1), newShot({ ...rest, videos: [], busy: null, queue: [] }), ...scene.shots.slice(index + 1)] }); }}
          onDelete={async () => { if (await askConfirm(`Delete shot ${index + 1}?`, undefined, "Delete", true)) patch(scene.id, { shots: scene.shots.filter((x) => x.id !== shot.id) }); }} />
      </header>
      {job && <div className="h-[3px] bg-raised2"><div className="stripes h-full transition-[width]" style={{ width: `${Math.max(4, (job.value / Math.max(1, job.max)) * 100)}%` }} /></div>}
      {shot.error && <p className="border-b border-line bg-bad/10 px-3.5 py-2 text-[12.5px] text-bad">{shot.error} <button className="ml-2 underline" onClick={() => up({ error: undefined })}>dismiss</button></p>}
      {open && (
        <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
          <FramePanel scene={scene} shot={shot} index={index} />
          <div className="flex min-w-0 flex-col gap-3 border-t border-line p-3.5 lg:border-l lg:border-t-0">
            <Block title="What happens" sub="your precise description — length and type are added for the blueprint step">
              <textarea value={shot.description} onChange={(e) => up({ description: e.target.value })} rows={3}
                className="inset w-full resize-y border border-line p-2.5 text-[13.5px] leading-relaxed focus:border-accent focus:outline-none" placeholder="Actions in order, camera, exact dialogue in quotes…" />
            </Block>
            <ShotRefs shot={shot} up={up} />
            <StageBlock title="Blueprint" stage="context" scene={scene} shot={shot} value={shot.blueprint} onChange={(v) => up({ blueprint: v })} busy={isBusy("context")}
              run={() => runStep(scene.id, shot.id, "context")} runAfter={() => runAll(scene.id, shot.id, "context")} disabled={!shot.description.trim() || !!shot.busy} />
            <StageBlock title="H3 prompt" stage="compiler" scene={scene} shot={shot} value={shot.h3} onChange={(v) => up({ h3: v })} busy={isBusy("compiler")}
              run={() => runStep(scene.id, shot.id, "compiler")} runAfter={() => runAll(scene.id, shot.id, "compiler")} disabled={!shot.blueprint.trim() || !!shot.busy} copy
              stale={!!shot.h3 && shot.h3From !== undefined && shot.h3From !== shot.blueprint} />
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => runStep(scene.id, shot.id, "video")} disabled={!shot.h3.trim() || !!shot.busy || (shot.mode === "i2v" && !shot.frame)}
                className="press chamfer btn-primary flex h-10 items-center gap-2 px-5 text-[13px] font-bold uppercase tracking-wide disabled:opacity-40"
                title={shot.mode === "i2v" && !shot.frame ? "Needs a starting frame" : `FL2VA${shot.mode === "ref" ? " / Ref" : ""} · ${scene.video.steps} steps`}>
                <Icon name="film" size={15} />{isBusy("video") ? "Making video…" : shot.videos.length ? "Make another take" : "Make video"}
              </button>
              <Btn small onClick={sendToAnimate} disabled={!shot.h3.trim()} why="Compile the H3 prompt first">Open in Animate</Btn>
              <div className="ml-auto flex gap-1.5 overflow-x-auto">
                {shot.videos.slice(0, 6).map((v, i) => (
                  <button key={v.filename} onClick={() => openViewer(shot.videos.map((x, k) => ({ url: viewUrl(x), kind: "video", label: `Shot ${index + 1} · take ${shot.videos.length - k}` })), i)}
                    className="relative h-14 w-24 shrink-0 overflow-hidden border border-line hover:border-accent" aria-label={`Take ${shot.videos.length - i}`}>
                    <video src={viewUrl(v)} muted preload="metadata" className="h-full w-full object-cover" />
                    <span className="micro absolute bottom-0.5 left-1 text-white/80">T{shot.videos.length - i}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function ShotMenu({ onUp, onDown, onDup, onDelete }: { onUp: () => void; onDown: () => void; onDup: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const item = "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover";
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="More" className="press btn-raised flex h-8 w-8 items-center justify-center"><Icon name="dots" size={15} /></button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-44 border border-line bg-raised2 py-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          <button className={item} onClick={() => { onUp(); setOpen(false); }}>Move up</button>
          <button className={item} onClick={() => { onDown(); setOpen(false); }}>Move down</button>
          <button className={item} onClick={() => { onDup(); setOpen(false); }}>Duplicate</button>
          <button className={cx(item, "text-bad")} onClick={() => { onDelete(); setOpen(false); }}>Delete</button>
        </div>
      )}
    </div>
  );
}

function Block({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2"><span className="text-[12.5px] font-semibold">{title}</span>{sub && <span className="truncate text-[11.5px] text-dim">{sub}</span>}<span className="ml-auto flex items-center gap-1.5">{right}</span></div>
      {children}
    </section>
  );
}

function StageBlock({ title, stage, scene, shot, value, onChange, busy, run, runAfter, disabled, copy, stale }: {
  title: string; stage: TextStep; scene: Scene; shot: Shot; value: string; onChange: (v: string) => void; busy: boolean; run: () => void; runAfter: () => void; disabled: boolean; copy?: boolean; stale?: boolean;
}) {
  const pack = usePacks((s) => s.packs.find((p) => p.id === s.active[stage]));
  const toast = useJobs((s) => s.toast);
  const patchShot = useScenes((s) => s.patchShot);
  const [show, setShow] = useState(true);
  const [sel, setSel] = useState("");
  const [note, setNote] = useState("");
  const [think, setThink] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const noteBox = useRef<HTMLInputElement>(null);
  const fixes = shot.fixes.filter((f) => f.stage === stage);
  const undo = shot.history[stage]?.length ?? 0;
  const thought = shot.thinking?.[stage];
  const why = writerWhy(scene);
  const readSel = () => { const el = area.current; if (!el) return; const t = el.value.slice(el.selectionStart, el.selectionEnd).trim(); setSel(t.length >= 3 ? t : ""); };
  const addFix = () => {
    if (!note.trim()) { noteBox.current?.focus(); return; }
    patchShot(scene.id, shot.id, { fixes: [...shot.fixes, { id: Math.random().toString(36).slice(2, 9), stage, quote: sel, note: note.trim() }] });
    setNote(""); setSel("");
  };
  const removeFix = (id: string) => patchShot(scene.id, shot.id, { fixes: shot.fixes.filter((f) => f.id !== id) });
  return (
    <Block title={title} sub={pack ? `· ${pack.builtin ? "built-in prompt" : pack.name}${pack.thinking !== "off" ? " · thinks first" : ""}` : undefined} right={<>
      {copy && value && <button className="micro text-muted hover:text-ink" onClick={() => copyText(value)}>COPY</button>}
      {undo > 0 && <button className="micro text-muted hover:text-ink" onClick={() => undoStep(scene.id, shot.id, stage)} title="Go back to the previous version">UNDO</button>}
      {value && <button className="micro text-muted hover:text-ink" onClick={() => setShow((s) => !s)}>{show ? "HIDE" : "SHOW"}</button>}
      <span title={why}><button onClick={run} disabled={disabled || !!why} className="press btn-raised h-7 px-2.5 text-[12px] font-medium disabled:opacity-40">{busy ? "Writing…" : value ? "Redo" : "Write"}</button></span>
      <span title={why ?? "Redo this step and every step after it"}><button onClick={runAfter} disabled={disabled || !!why} className="press btn-raised h-7 px-2.5 text-[12px] font-medium disabled:opacity-40">{value ? "Redo + rest" : "Write + rest"}</button></span>
    </>}>
      {stale && <p className="text-[11.5px] text-hot">The blueprint changed since this was written. <button className="underline" disabled={disabled} onClick={run}>Rewrite it</button> or keep it as is.</p>}
      {busy && !value ? <div className="shimmer h-24" /> : show && (
        <textarea ref={area} value={value} onChange={(e) => onChange(e.target.value)} onSelect={readSel} onMouseUp={readSel} onKeyUp={readSel}
          rows={value ? Math.min(16, Math.max(4, value.split("\n").length + 1)) : 2} spellCheck={false}
          placeholder={busy ? "Writing…" : `Not written yet — press Write, or type your own.`}
          className={cx("inset w-full resize-y border border-line p-2.5 font-mono text-[12px] leading-relaxed selection:bg-hot/40 focus:border-accent focus:outline-none", busy && "opacity-50")} />
      )}
      {value && show && !busy && (
        <div className="flex flex-col gap-1.5 border border-dashed border-line px-2.5 py-2">
          <div className="flex items-center gap-2">
            <Icon name="brush" size={13} className={sel ? "text-hot" : "text-dim"} />
            {sel ? <span className="min-w-0 flex-1 truncate text-[12px] text-ink">On <span className="bg-hot/20 px-1 font-mono text-[11.5px]">“{sel.length > 90 ? sel.slice(0, 90) + "…" : sel}”</span></span>
              : <span className="flex-1 text-[11.5px] text-dim">Highlight a part that's wrong and say what to change — or just write a note about the whole thing.</span>}
            {sel && <button className="micro text-dim hover:text-ink" onClick={() => setSel("")}>CLEAR</button>}
          </div>
          <div className="flex gap-1.5">
            <input ref={noteBox} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFix(); } }}
              placeholder={sel ? "What's wrong here? e.g. she should use her right hand, and smile before speaking" : "e.g. make the push-in slower and end on her smile"} aria-label="What to change"
              className="inset h-8 min-w-0 flex-1 border border-line px-2 text-[12.5px] focus:border-accent focus:outline-none" />
            <button onClick={addFix} disabled={!note.trim()} className="press btn-raised h-8 px-3 text-[12px] font-semibold disabled:opacity-40">Add note</button>
          </div>
          {fixes.length > 0 && (
            <>
              <ol className="flex flex-col gap-1">
                {fixes.map((f, i) => (
                  <li key={f.id} className="flex items-start gap-2 bg-raised/60 px-2 py-1.5 text-[12px]">
                    <span className="micro mt-0.5 text-hot">{String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1">{f.quote && <span className="mr-1 font-mono text-[11px] text-muted">“{f.quote.length > 60 ? f.quote.slice(0, 60) + "…" : f.quote}”</span>}{f.note}</span>
                    <button aria-label="Remove note" onClick={() => removeFix(f.id)} className="text-dim hover:text-ink"><Icon name="x" size={12} /></button>
                  </li>
                ))}
              </ol>
              <div className="flex gap-1.5">
                <span title={why}><button onClick={() => applyFixes(scene.id, shot.id, stage)} disabled={!!shot.busy || !!why} className="press chamfer-sm btn-hot h-8 px-3 text-[12.5px] font-bold disabled:opacity-40">Apply {fixes.length} fix{fixes.length > 1 ? "es" : ""}</button></span>
                {stage !== "krea" && <span title={why}><button onClick={() => applyFixes(scene.id, shot.id, stage, true)} disabled={!!shot.busy || !!why} className="press btn-raised h-8 px-3 text-[12px] font-medium disabled:opacity-40"
                  title={stage === "context" ? "Fix the blueprint, then rewrite the H3 prompt" : "Fix the H3 prompt"}>{stage === "context" ? "Apply + rewrite H3" : "Apply"}</button></span>}
              </div>
            </>
          )}
        </div>
      )}
      {thought && (
        <div>
          <button className="text-[11.5px] text-muted hover:text-ink" onClick={() => setThink((t) => !t)}>{think ? "▾" : "▸"} What it was thinking</button>
          {think && <p className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap border-l-2 border-line pl-2.5 text-[11.5px] leading-relaxed text-muted">{thought}</p>}
        </div>
      )}
    </Block>
  );
}

function FramePanel({ scene, shot, index }: { scene: Scene; shot: Shot; index: number }) {
  const patchShot = useScenes((s) => s.patchShot);
  const toast = useJobs((s) => s.toast);
  const [over, setOver] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const up = (p: Partial<Shot>) => patchShot(scene.id, shot.id, p);
  const busy = shot.busy === "krea" || shot.busy === "frame";
  const ratio = scene.aspect === "16:9" ? "16 / 9" : scene.aspect === "9:16" ? "9 / 16" : "1 / 1";
  const prevHasVideo = !!scene.shots[index - 1]?.videos[0];
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setOver(false);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    try {
      const m = id ? await useTray.getState().asMedia(id) : e.dataTransfer.files?.[0] ? await useTray.getState().addUpload(e.dataTransfer.files[0]) : null;
      if (!m) return;
      if (m.kind !== "image") throw new Error("The starting frame must be a picture");
      await setFrame(scene.id, shot.id, { filename: m.name, subfolder: "", type: "input" });
    } catch (err) { toast((err as Error).message, "bad"); }
  };
  if (shot.mode !== "i2v") return (
    <div className="flex flex-col gap-2 p-3.5 text-[12.5px] text-muted">
      <span className="text-[12.5px] font-semibold text-ink">{shot.mode === "ref" ? "Reference pictures" : "No pictures"}</span>
      {shot.mode === "ref" ? <>The Ref model gets each cast member's full-body and face pictures from Characters, as &lt;Picture 1&gt;, &lt;Picture 2&gt;… The blueprint and H3 steps are told which is which.</> : <>Text-to-video: only the H3 prompt is used.</>}
    </div>
  );
  return (
    <div className="flex flex-col gap-2 p-3.5">
      <div className="flex items-center"><span className="text-[12.5px] font-semibold">Starting frame</span><span className="micro ml-auto text-dim">{scene.aspect}</span></div>
      <div onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
        className={cx("relative overflow-hidden border", shot.frame ? "border-line bg-black" : "hatch border-dashed border-line", over && "!border-accent")} style={{ aspectRatio: ratio }}>
        {shot.frame ? (
          <button className="h-full w-full" onClick={() => openViewer([{ url: viewUrl(shot.frame!), kind: "image", label: `Shot ${index + 1} starting frame` }])} aria-label="View the starting frame">
            <img src={viewUrl(shot.frame)} alt="" className="h-full w-full object-contain" />
          </button>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center text-[12px] text-muted">
            {busy ? <><div className="shimmer absolute inset-0 opacity-60" /><span className="relative">{shot.busy === "krea" ? "Writing the frame prompt…" : `Making frames with ${frameModelLabel(castOf(scene, shot))}…`}</span></> : <>Drag your starting frame here<br /><span className="text-dim">make it in Create, then drag it from Results — or make one with {frameModelLabel(castOf(scene, shot))} below</span></>}
          </div>
        )}
        {shot.frame && <button aria-label="Remove frame" onClick={() => setFrame(scene.id, shot.id, null)} className="absolute right-1.5 top-1.5 bg-black/70 p-1 text-ink hover:bg-black"><Icon name="x" size={13} /></button>}
      </div>
      {shot.candidates.length > 0 && (
        <div className="flex gap-1 overflow-x-auto">
          {shot.candidates.map((c) => (
            <button key={c.filename} onClick={() => setFrame(scene.id, shot.id, c)} title="Use this one"
              className="h-11 shrink-0 overflow-hidden border border-line hover:border-accent" style={{ aspectRatio: ratio }}>
              <img src={viewUrl(c)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <input value={shot.frameNotes} onChange={(e) => up({ frameNotes: e.target.value })} placeholder="Frame notes: pose, setting, outfit, lighting…"
        className="inset h-8 border border-line px-2 text-[12px] focus:border-accent focus:outline-none" aria-label="Frame notes" />
      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={() => runAll(scene.id, shot.id, "krea")} disabled={!!shot.busy || !castOf(scene, shot).length} title={castOf(scene, shot).length ? `${animeCast(castOf(scene, shot)) ? "Words → tags" : "Krea 2 frame builder"} → 2 frames with ${frameModelLabel(castOf(scene, shot))}` : "Add a character to the cast first"}
          className="press btn-raised h-8 text-[12px] font-semibold disabled:opacity-40">{busy ? "Working…" : shot.frame ? "New frames" : `Make with ${frameModelLabel(castOf(scene, shot))}`}</button>
        <button onClick={() => continueFromPrevious(scene.id, shot.id)} disabled={!prevHasVideo || !!shot.busy} title={prevHasVideo ? "Use the last frame of the previous shot's video" : "The shot before this one has no video yet"}
          className="press btn-raised h-8 text-[12px] font-medium disabled:opacity-40">Last frame of prev.</button>
      </div>
      {shot.kreaPrompt && (
        <div>
          <button className="text-[11.5px] text-muted hover:text-ink" onClick={() => setShowPrompt((s) => !s)}>{showPrompt ? "▾" : "▸"} Frame prompt</button>
          {showPrompt && <>
            <textarea value={shot.kreaPrompt} onChange={(e) => up({ kreaPrompt: e.target.value })} rows={6} className="inset mt-1 w-full resize-y border border-line p-2 font-mono text-[11px] leading-relaxed focus:border-accent focus:outline-none" />
            <button className="mt-1 text-[11.5px] text-accent hover:underline" disabled={!!shot.busy} onClick={() => runStep(scene.id, shot.id, "frame")}>Make 2 more with this prompt</button>
          </>}
        </div>
      )}
    </div>
  );
}
