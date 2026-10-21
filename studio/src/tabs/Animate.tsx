import { useEffect, useRef, useState } from "react";
import { activePack, planWriter, useBigPlanner } from "../lib/packs";
import { buildAnimate, type AnimateOpts, type LoraPick } from "../lib/graphs";
import { askSweep } from "../components/Dialogs";
import { rtxInstalled, syncKreaTE, useDownloads, useGroup } from "../lib/downloads";
import { VideoModel } from "../components/VideoModel";
import { useJobs, type Job, type Output } from "../lib/jobs";
import { RTX_KEY, SMOOTH_KEY, h3Frames, h3Size, h3SizeFor } from "../lib/models";
import { newSeed, seedFor, useSection, useSettings } from "../lib/settings";
import { trayIdOf, useTray, type Media } from "../lib/tray";
import type { MentionTarget } from "../components/Mention";
import { LIMITS, makeRef, useAnimateUndo, useWork, type AnimateState } from "../lib/work";
import { sendTo, usePrimaryAction, useHandoffInto } from "../App";
import { Advanced, Btn, Check, EtaText, H1, Icon, Label, LoraList, Panel, PresetBar, Seg, Slider, Slot, TextArea } from "../components/ui";
import { openImageImport } from "../components/ImageImport";
import { RefList } from "../components/RefList";
import { Chip, GoButton, PromptBar, Workspace } from "../components/Workspace";
import { Feed } from "../components/Feed";
import { useRemix } from "../lib/remix";
import { buildPromptHelper, MINOR_FLAG } from "../lib/graphs";
import { waitForJob } from "../lib/jobs";
import { DEFAULTS } from "../lib/settings";
import { parseTimeline, toPrompt } from "../lib/timeline";
import { tagsFor } from "../lib/work";
import { stopMessage } from "../lib/adult";
import { useCharacters } from "../lib/characters";
import { CharacterPicker, charactersIn, withCharacter, WriterSetup } from "./Prompt";
import { copyText } from "../lib/copy";

/** "she dances in the rain and waves at the end" (plain words) vs a written H3 timeline */
const isPlan = (t: string) => /\bCUT \d|\(\d+(\.\d)?s?\s*[–-]|\b\d+:\d{2}\s*[–-]|\bAt \d/.test(t);

export default function AnimateTab() {
  const [a, set] = useSection("animate");
  const refs = useWork((s) => s.animateRefs);
  const setWork = useWork((s) => s.set);
  const frames = useWork((s) => s.animateFrames);
  const setFrames = (f: (Media | null)[] | ((f: (Media | null)[]) => (Media | null)[])) => setWork({ animateFrames: typeof f === "function" ? f(useWork.getState().animateFrames) : f });
  const undo = useAnimateUndo();
  /** remember how things are now, so Ctrl+Z / Undo can bring it back after a big change */
  const remember = () => undo.push({ prompt: useSettings.getState().s.animate.prompt, refs: useWork.getState().animateRefs, frames: useWork.getState().animateFrames, loras: useSettings.getState().s.animate.loras });
  const doUndo = () => {
    const last = undo.pop();
    if (!last) return;
    setWork({ animateRefs: last.refs, animateFrames: last.frames });
    set({ prompt: last.prompt, loras: last.loras as typeof a.loras });
    toast("Undone", "info");
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useSettings.getState().s.tab !== "animate" || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable)) return; // text boxes keep their own undo
      e.preventDefault(); doUndo();
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useJobs((s) => s.run);
  const toast = useJobs((s) => s.toast);
  const [busy, setBusy] = useState(false);

  const pending = useRemix((s) => s.pending);
  // the remix restores settings before this tab sees it — so what was here is captured whenever a remix for this tab is coming
  const undoBefore = useRef<AnimateState | null>(null);
  useEffect(() => useRemix.subscribe((st, prev) => {
    if (st.pending?.tab === "animate" && st.pending !== prev.pending) undoBefore.current = lastSeen.current;
  }), []);
  const lastSeen = useRef<AnimateState | null>(null);
  lastSeen.current = { prompt: a.prompt, refs, frames: useWork.getState().animateFrames, loras: a.loras };
  useEffect(() => {
    if (pending?.tab !== "animate" || !pending.snap.media) return;
    if (undoBefore.current) { undo.push(undoBefore.current); undoBefore.current = null; }
    const m = pending.snap.media as { refs?: typeof refs; frames?: (Media | null)[] };
    // remix keeps what you already have in here and adds the video's own references (Ctrl+Z / Undo brings back the old box)
    const before = useWork.getState();
    const cur = before.animateRefs;
    const add = (m.refs ?? []).filter((r) => !cur.some((c) => c.media.name === r.media.name));
    const merged = [...cur, ...add];
    const keep: typeof refs = [];
    const count: Record<string, number> = {};
    for (const r of merged) { const k = r.media.kind; count[k] = (count[k] ?? 0) + 1; if (count[k] <= LIMITS[k]) keep.push(r); }
    setWork({ animateRefs: keep });
    if (m.frames?.some(Boolean)) setFrames(m.frames);
    if (keep.length < merged.length) toast(`Kept your references and added what fit (H3 limits: ${LIMITS.image} pictures, ${LIMITS.video} clips, ${LIMITS.audio} sounds)`, "info");
    useRemix.setState({ pending: null });
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const handed = useWork((s) => s.animateFrame);
  useEffect(() => { if (handed) { setFrames([handed, null]); setWork({ animateFrame: null }); } }, [handed]); // eslint-disable-line react-hooks/exhaustive-deps
  useHandoffInto("animate", (items) => {
    // "Animate" on a picture you made: image → video, with it as the starting frame (and the same picture in Plan a video)
    const start = items.find((x) => x.slot === "start" && x.media.kind === "image")?.media;
    if (start) {
      remember();
      if (a.mode === "ref") set({ mode: "i2v" });
      setFrames((f) => [start, a.mode === "fl" ? f[1] : null]);
      const pr = useWork.getState().promptRefs.filter((r) => r.media.name !== start.name);
      setWork({ promptRefs: [{ ...makeRef(start), label: "first frame" }, ...pr.filter((r) => r.label !== "first frame")] });
      if (useSettings.getState().s.prompt.mode !== "first-last") useSettings.getState().set("prompt", { mode: "image" });
      toast("It's the starting frame — Image → video. Describe what happens and press Make video.", "good");
      return;
    }
    if (a.mode === "ref") setWork({ animateRefs: [...useWork.getState().animateRefs, ...items.map((i) => makeRef(i.media))] });
    else setFrames((f) => { const n = [...f]; for (const { media } of items) { const i = n.findIndex((x) => !x); n[i >= 0 ? i : 0] = media; } return n; });
  });

  // "Match the picture": the video takes the starting picture's shape (or the first reference picture's), so nothing is stretched
  const shapeFrom = (a.mode === "ref" ? refs.find((r) => r.media.kind === "image")?.media : frames[0]) ?? null;
  const ratio = usePicRatio(shapeFrom);
  // a new starting picture switches the shape back to "Match the picture" (pick 16:9 etc. after it to override)
  const lastShape = useRef(shapeFrom?.name);
  useEffect(() => {
    if (shapeFrom?.name && shapeFrom.name !== lastShape.current && a.aspect !== "auto") set({ aspect: "auto" });
    lastShape.current = shapeFrom?.name ?? lastShape.current;
  }, [shapeFrom?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const sizeOf = (mp: number) => (a.aspect === "auto" ? h3SizeFor(ratio ?? 16 / 9, mp) : h3Size(a.aspect, mp));
  const { width, height } = sizeOf(a.mp);
  const nFrames = h3Frames(a.seconds);
  const ref = a.mode === "ref";
  const dl = useGroup("video");
  const why = !dl.ready ? dl.why : (!a.prompt.trim() ? "Write a prompt (or send one from the Prompt helper)"
    : !ref && !frames[0] ? "Add the starting picture"
    : a.mode === "fl" && !frames[1] ? "Add the last picture"
    : ref && refs.some((r) => r.media.kind === "video" && (r.end - r.start < 2 || r.end - r.start > 15)) ? "Reference clips must be 2–15 s long"
    : busy ? "Sending…" : undefined);
  const turboOk = ref;
  const etaKey = `animate:${a.mode}:${turboOk && (a.turbo || a.takes === 2) ? "turbo" : "full"}:${a.seconds}s:${a.mp}`;

  const opts = (seed: number, turbo: boolean, over: Partial<AnimateOpts> = {}): AnimateOpts => ({
    ...a.adv, seed, mode: a.mode, prompt: a.prompt, seconds: a.seconds, width, height, turbo, loras: a.loras, ...over,
    refImageSize: a.refImageSize, lowMemDecode: a.lowMemDecode, prefix: "studio/animate/h3",
    images: ref ? refs.filter((r) => r.media.kind === "image").map((r) => r.media.name) : (frames.filter(Boolean) as Media[]).map((m) => m.name),
    videos: ref ? refs.filter((r) => r.media.kind === "video").map((r) => ({ file: r.media.name, start: r.start, end: r.end, useSound: r.useSound })) : [],
    audios: ref ? refs.filter((r) => r.media.kind === "audio").map((r) => r.media.name) : [],
  });
  const label = (extra = "") => `${a.seconds} s video${extra}`;
  /** "Plan it in Plan a video": your references (or first/last frames), words, length and type go along — LoRAs stay shared */
  const planInPrompt = () => {
    const pr = ref ? refs.map((r) => ({ ...r })) : (frames.filter(Boolean) as Media[]).map((m, i) => ({ ...makeRef(m), label: i === 0 ? "first frame" : "last frame" }));
    const cur = useWork.getState().promptRefs;
    const same = cur.length === pr.length && cur.every((r, i) => r.media.name === pr[i].media.name);
    setWork({ promptRefs: same ? cur : pr });
    const st = useSettings.getState();
    const words = a.prompt.trim() && !isPlan(a.prompt) ? a.prompt : st.s.prompt.idea;
    st.set("prompt", { idea: words, seconds: a.seconds, mode: a.mode === "ref" ? "references" : a.mode === "fl" ? "first-last" : "image" });
    st.setTab("prompt");
  };
  const [plan, setPlan] = useState<{ from: string; to: string } | null>(null);
  const planning = a.plan !== false && !isPlan(a.prompt);
  /** plain words → the Plan-a-video writer, with your references and characters → an H3 timeline (what goes to the video) */
  const planFirst = async (force = false): Promise<string> => {
    if (!planning) return a.prompt;
    if (!force && plan && plan.from === a.prompt) return plan.to;
    const rs = ref ? refs : [];
    const tags = tagsFor(rs);
    const modeLabel = a.mode === "ref" ? "References" : a.mode === "fl" ? "First → last frame" : "Image → video";
    const pw = await planWriter(useSettings.getState().s.prompt.guide, DEFAULTS.prompt.guide, useBigPlanner());
    const graph = buildPromptHelper({
      pictures: [...rs.filter((r) => r.media.kind === "image").map((r) => ({ file: r.media.name, tag: tags[r.id], label: r.label })),
        ...(!ref ? (frames.filter(Boolean) as Media[]).map((m, i) => ({ file: m.name, tag: `<Picture ${i + 1}>`, label: i === 0 ? "the first frame" : "the last frame" })) : [])],
      videos: rs.filter((r) => r.media.kind === "video").map((r) => ({ file: r.media.name, tag: tags[r.id], label: r.label, start: r.start, end: r.end, useSound: r.useSound })),
      audios: rs.filter((r) => r.media.kind === "audio").map((r) => ({ tag: tags[r.id], label: r.label })),
      characters: charactersIn(rs, tags, useCharacters.getState().list), idea: a.prompt, seconds: a.seconds, cuts: 0, camera: "auto", mode: modeLabel,
      guide: pw.guide, writer: pw.writer, seed: newSeed(),
    });
    const job = await run("animate", "Planning the video from your words", graph, `prompt:${rs.filter((r) => r.media.kind === "video").length}v`, { quiet: true, front: true });
    const done = await waitForJob(job.id);
    const raw = done.texts.timeline ?? "";
    if (done.status !== "done" || !raw.trim()) throw new Error(done.error ?? "The writer didn't answer — try again, or switch planning off");
    if (Object.entries(done.texts).some(([k, v]) => k.startsWith("seen:") && v.includes(MINOR_FLAG))) throw new Error("Stopped: someone in a reference picture may be under 18 — use pictures of adults only");
    if (raw.includes(MINOR_FLAG)) throw new Error(stopMessage([a.prompt]));
    const parsed = parseTimeline(raw, a.seconds);
    const text = parsed.cuts.some((c) => c.text) ? toPrompt(parsed) : raw.trim();
    setPlan({ from: a.prompt, to: text });
    return text;
  };
  const go = async () => {
    if (why) return;
    import("../lib/promptHistory").then(({ remember }) => remember("animate", a.prompt, "sent"));
    setBusy(true);
    setTimeout(() => setBusy(false), 600); // keep the button free: you can line up more while it plans
    try {
      const prompt = await planFirst();
      const optsP = (seed: number, turbo: boolean, over: Partial<AnimateOpts> = {}) => opts(seed, turbo, { prompt, ...over });
      if (a.takes === 2) {
        for (let i = 0; i < 2; i++) {
          const seed = newSeed();
          const o = optsP(seed, turboOk);
          await run("animate", label(turboOk ? ` · quick preview ${i + 1}/2` : ` · take ${i + 1}/2`), buildAnimate(o), `animate:${a.mode}:${turboOk ? "turbo" : "full"}:${a.seconds}s:${a.mp}`, { opts: o, preview: turboOk, snapshot: { section: "animate", settings: a, media: { refs, frames } } });
        }
      } else {
        const seed = seedFor(a.adv, (p) => set({ adv: { ...a.adv, ...p } }));
        const o = optsP(seed, turboOk && a.turbo);
        await run("animate", label(turboOk && a.turbo ? " · turbo" : ""), buildAnimate(o), etaKey, { opts: o, snapshot: { section: "animate", settings: { ...a, adv: { ...a.adv, seed, lockSeed: true } }, media: { refs, frames } } });
      }
    } catch (e) { toast(`Couldn't start: ${(e as Error).message}`, "bad"); }
  };
  usePrimaryAction("animate", go);

  const sweep = async (l: LoraPick, title: string) => {
    if (why) return toast(why, "bad");
    const r = await askSweep(title, true, l.strength);
    if (!r) return;
    const seed = a.adv.lockSeed && a.adv.seed ? a.adv.seed : newSeed();
    const draft = r.fast ? sizeOf(0.4) : { width, height };
    const turbo = r.fast && turboOk;
    try {
      for (const v of r.values) {
        const o = opts(seed, turbo, { ...draft, loras: a.loras.map((x) => (x.name === l.name ? { ...x, strength: v, off: false } : x)) });
        await run("animate", `${title} · strength ${v.toFixed(1)}${r.fast ? " · draft" : ""}`, buildAnimate(o), `animate:${a.mode}:${turbo ? "turbo" : "full"}:${a.seconds}s:${r.fast ? 0.4 : a.mp}`,
          { opts: o, sweep: { name: l.name, strength: v }, preview: r.fast, snapshot: { section: "animate", settings: { ...a, loras: o.loras, adv: { ...a.adv, seed, lockSeed: true } }, media: { refs, frames } } });
      }
      toast(`Making ${r.values.length} ${r.fast ? "quick drafts" : "videos"} with the same seed — compare them in Results.`, "info");
    } catch (e) { toast(`Couldn't start: ${(e as Error).message}`, "bad"); }
  };

  const redoFull = async (j: Job) => {
    const o = { ...(j.meta!.opts as AnimateOpts), turbo: false, steps: useSettings.getState().s.animate.adv.steps, width, height };
    try { await run("animate", `${o.seconds} s video · full quality`, buildAnimate(o), `animate:${o.mode}:full:${o.seconds}s:${a.mp}`, { opts: o }); }
    catch (e) { toast((e as Error).message, "bad"); }
  };

  const speedOpts = turboOk
    ? [{ value: "1f", label: `1 take · full` }, { value: "1t", label: "1 take · turbo" }, { value: "2t", label: "2 quick previews" }]
    : [{ value: "1f", label: "1 take" }, { value: "2f", label: "2 takes" }];
  const speedVal = a.takes === 2 ? (turboOk ? "2t" : "2f") : turboOk && a.turbo ? "1t" : "1f";
  const chips = (
    <>
      <Chip title="Video type" value={a.mode} onChange={(v) => set({ mode: v })} options={[{ value: "ref", label: "References" }, { value: "i2v", label: "Image → video" }, { value: "fl", label: "First → last" }, { value: "loop", label: "Seamless loop" }]} />
      <Chip title="Length" value={a.seconds} onChange={(v) => set({ seconds: v })} options={Array.from({ length: 14 }, (_, i) => i + 2).map((n) => ({ value: n, label: `${n} s` }))} />
      <Chip title="Shape" value={a.aspect} onChange={(v) => set({ aspect: v })} options={[{ value: "auto", label: ratio ? `Match the picture (${ratioLabel(ratio)})` : "Match the picture" }, { value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }, { value: "1:1", label: "1:1" }]} />
      <Chip title="Size" value={a.mp} onChange={(v) => set({ mp: v })} options={[{ value: 0.4, label: "Draft 0.4 MP" }, { value: 0.6, label: "Good 0.6 MP" }, { value: 0.98, label: "Full 1 MP" }, { value: 1.2, label: "1.2 MP" }, { value: 1.5, label: "1.5 MP" }, { value: 2, label: "2 MP" },
        ...([0.4, 0.6, 0.98, 1.2, 1.5, 2].includes(a.mp) ? [] : [{ value: a.mp, label: `${a.mp} MP` }])]} />
      {!isPlan(a.prompt) && <Chip title="Plain words" value={a.plan === false ? 0 : 1} onChange={(v) => set({ plan: v === 1 })} options={[{ value: 1, label: "Writer plans it (recommended)" }, { value: 0, label: "Send my words as typed" }]} />}
      <Chip title="Takes & speed" value={speedVal} onChange={(v) => set({ takes: v.startsWith("2") ? 2 : 1, turbo: v.endsWith("t") })} options={speedOpts} />
      <span className="ml-1 font-mono text-[11px] text-dim">{width}×{height} · {nFrames} frames</span>
    </>
  );
  // @ in the box: References mode → characters and pictures join the references; otherwise a picture is the first frame
  const mention: MentionTarget = {
    hint: a.mode === "ref" ? { character: "their pictures join the references", picture: "joins the references" } : { character: "only in References mode", picture: "becomes the first frame" },
    pick: async (pk) => {
      if (pk.kind === "character") {
        if (a.mode !== "ref") throw new Error("Characters go in as references — set the mode to References first (in this mode the first frame decides who's in it)");
        remember(); setWork({ animateRefs: await withCharacter(pk.c, useWork.getState().animateRefs) });
        return pk.c.name;
      }
      const md = await useTray.getState().asMedia(pk.item.id);
      remember();
      if (a.mode === "ref") { const cur = useWork.getState().animateRefs; if (!cur.some((r) => r.media.name === md.name)) setWork({ animateRefs: [...cur, makeRef(md)] }); }
      else setFrames((f) => [md, a.mode === "fl" ? f[1] : null]);
      return "";
    },
  };
  return (
    <Workspace needs={"video"} tab="animate" title="Animate" sub="MiniMax H3, video with sound"
      bar={<PromptBar value={a.prompt} onChange={(v) => set({ prompt: v })} chips={chips} minRows={3} maxRows={10} rewrite="animate" mention={mention}
        placeholder="Say what happens in plain words — the writer plans it second by second with your references and characters (like Plan a video)…"
        below={planning && a.prompt.trim() ? <PlanLine plan={plan} text={a.prompt} onUse={(t) => set({ prompt: t })} onPlan={() => planFirst(true)} /> : null}
        action={<GoButton onClick={go} disabled={!!why} why={why}>{a.takes === 2 ? "Make 2" : "Make video"} <EtaText k={etaKey} prefix="· " /></GoButton>} />}
      drawer={<>
        <PresetBar section="animate" />
        <button onClick={() => openImageImport("", "collections")} className="press group flex items-center gap-2.5 border border-dashed border-line px-3 py-2.5 text-left hover:border-accent">
          <Icon name="link" size={16} className="shrink-0 text-accent" />
          <span className="min-w-0"><span className="block text-[13px] font-semibold text-ink">Copy a video from CivitAI</span>
            <span className="block text-[11.5px] text-muted">From your saved collections or a link — its prompt, LoRAs and the clip come in.</span></span>
        </button>
        {ref ? (
          <div><Label right={<span className="flex gap-3">{undo.stack.length > 0 && <button className="text-xs text-muted hover:text-ink" title="Bring back the box, references, frames and LoRAs from before the last change (Ctrl+Z)" onClick={doUndo}>↶ Undo</button>}
            <button className="text-xs text-accent hover:underline" title="Your references, words, length and LoRAs go along" onClick={planInPrompt}>Plan a video with these</button></span>}>References</Label>
            <div className="mb-2"><CharacterPicker refs={refs} onChange={(r) => { remember(); setWork({ animateRefs: r }); }} /></div>
            <RefList refs={refs} onChange={(r) => { if (r.length < refs.length) remember(); setWork({ animateRefs: r }); }} /></div>
        ) : (
          <div className={a.mode === "fl" ? "grid grid-cols-2 gap-2.5" : ""}>
            <div><Label>{a.mode === "loop" ? "Picture (start = end)" : "First frame"}</Label><Slot className="h-44" value={frames[0]} onChange={(m) => { remember(); setFrames((f) => [m, f[1]]); }} label="Starting picture" /></div>
            {a.mode === "fl" && <div><Label>Last frame</Label><Slot className="h-44" value={frames[1]} onChange={(m) => { remember(); setFrames((f) => [f[0], m]); }} label="Ending picture" /></div>}
          </div>
        )}
        {!ref && <div className="flex justify-end gap-3">{undo.stack.length > 0 && <button className="text-xs text-muted hover:text-ink" onClick={doUndo}>↶ Undo</button>}<button className="text-xs text-accent hover:underline" onClick={planInPrompt}>Plan a video with these</button></div>}
        {!turboOk && <p className="text-xs text-muted">Turbo is only available for References videos — this type always uses full steps.</p>}
        <LoraList family="h3" label="H3 LoRAs" value={a.loras} onChange={(v) => { if (v.length < a.loras.length) remember(); set({ loras: v }); }} onSweep={sweep} />
        <Advanced a={a.adv} set={(p) => set({ adv: { ...a.adv, ...p } })} hideCfg>
          <Slider label="Size (megapixels)" min={0.3} max={2.5} step={0.05} value={a.mp} show={`${a.mp.toFixed(2)} MP · ${width}×${height}`} onChange={(v) => set({ mp: Math.round(v * 100) / 100 })} />
          <p className="-mt-2 text-[11.5px] leading-relaxed text-dim">On a 5090: about 2 MP for 8 s, 1.5 MP for 12 s, 1.2 MP for 15 s. Bigger and longer needs more GPU memory — turn on low-memory decode if it runs out.</p>
          <VideoModel />
          {ref && <Seg label="Reference detail" help="refImageSize" value={a.refImageSize} onChange={(v) => set({ refImageSize: v })} options={[{ value: "match", label: "Match (fast)" }, { value: "max", label: "Max (sharper)" }]} />}
          <WriterSetup />
          <SmoothCheck />
          <RtxCheck />
          <Check checked={a.lowMemDecode} onChange={(v) => set({ lowMemDecode: v })} title="Low-memory decode" sub="If long videos run out of GPU memory" help="lowMem" />
        </Advanced>
        <p className="text-xs leading-relaxed text-dim">The first video of a rental also loads the models (~1–2 min).</p>
      </>}>
      <Feed tab="animate" kinds={["video"]} empty={<><b className="display text-[19px] text-ink">Bring it to life</b><span>Add references on the left (or send them from Prompt), describe what happens above, and press Make video.</span></>}
        extra={({ j }) => {
          const sw = j.meta?.sweep as { name: string; strength: number } | undefined;
          return [
            ...(sw ? [{ label: `Use strength ${sw.strength.toFixed(1)}`, icon: "check", run: () => { set({ loras: a.loras.map((x) => (x.name === sw.name ? { ...x, strength: sw.strength, off: false } : x)) }); toast(`Strength set to ${sw.strength.toFixed(1)}`, "good"); } }] : []),
            ...(j.meta?.preview ? [{ label: "Redo in full quality", icon: "refresh", run: () => redoFull(j) }] : []),
          ];
        }} />
    </Workspace>
  );
}

/** what the writer planned from your words — see it before the video, keep it in the box to change it by hand */
function PlanLine({ plan, text, onUse, onPlan }: { plan: { from: string; to: string } | null; text: string; onUse: (t: string) => void; onPlan: () => Promise<string> }) {
  const fresh = !!plan && plan.from === text;
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useJobs((s) => s.toast);
  useEffect(() => { if (fresh) setOpen(true); }, [fresh, plan?.to]);
  const pack = activePack("plan")?.name ?? "Plan a video writer";
  const now = async () => { setBusy(true); try { await onPlan(); setOpen(true); } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); } };
  return (
    <div className="border-t border-line px-4 py-2 text-[12px]">
      <div className="flex items-center gap-3">
        <button className="text-muted hover:text-ink" onClick={() => setOpen((o) => !o)}>{open && fresh ? "▾" : "▸"} {fresh ? "The plan the writer made (this is what H3 gets)" : "Plain words: the writer plans the video (cuts, camera, speech, sound) when you press Make video"}</button>
        <span className="text-dim" title="The prompt file that plans videos — change it in Scenes → Prompt files (Plan a video writer). It writes H3 timelines, not Krea 2 picture prompts.">· prompt file “{pack}” · writes for H3</span>
        <button onClick={now} disabled={busy} className="ml-auto text-accent hover:underline disabled:opacity-50">{busy ? "Planning… ~30 s" : fresh ? "Plan it again" : "Plan it now — see it first"}</button>
      </div>
      {open && fresh && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <p className="max-h-64 overflow-y-auto whitespace-pre-wrap border border-line bg-raised p-2 font-mono text-[12px] leading-relaxed text-ink/85">{plan!.to}</p>
          <div className="flex gap-3"><button className="text-accent hover:underline" onClick={() => onUse(plan!.to)}>Put it in the box to edit</button>
            <button className="text-muted hover:text-ink" onClick={() => copyText(plan!.to)}>Copy</button></div>
        </div>
      )}
    </div>
  );
}

/** a picture's width ÷ height (from what the upload knows, else by loading it) */
function usePicRatio(m: Media | null): number | null {
  const [r, setR] = useState<number | null>(null);
  useEffect(() => {
    if (!m) { setR(null); return; }
    if (m.width && m.height) { setR(m.width / m.height); return; }
    let live = true;
    const i = new Image();
    i.onload = () => { if (live && i.naturalHeight) setR(i.naturalWidth / i.naturalHeight); };
    i.src = m.url;
    return () => { live = false; };
  }, [m?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  return r;
}
const ratioLabel = (r: number) => {
  const known: [number, string][] = [[16 / 9, "16:9"], [9 / 16, "9:16"], [1, "1:1"], [4 / 5, "4:5"], [5 / 4, "5:4"], [2 / 3, "2:3"], [3 / 2, "3:2"], [3 / 4, "3:4"], [4 / 3, "4:3"]];
  const k = known.find(([v]) => Math.abs(v - r) / v < 0.03);
  return k ? k[1] : r > 1 ? "wide" : "tall";
};

/** smoother videos (frame interpolation) on/off */
function SmoothCheck() {
  const g = useDownloads((st) => st.groups.find((x) => x.id === "smooth"));
  const [off, setOff] = useState(() => { try { return localStorage.getItem(SMOOTH_KEY) === "off"; } catch { return false; } });
  const pick = (on: boolean) => { try { if (on) localStorage.removeItem(SMOOTH_KEY); else localStorage.setItem(SMOOTH_KEY, "off"); } catch { /* private mode */ } setOff(!on); syncKreaTE(); };
  return <Check checked={!off} onChange={pick} title="Smoother motion (48 fps)"
    sub={g && g.state !== "done" ? "Its small model is still downloading" : "Puts a frame between every two (RIFE) — same length and sound"} />;
}

/** RTX upscale of the finished video on/off */
function RtxCheck() {
  const [off, setOff] = useState(() => { try { return localStorage.getItem(RTX_KEY) === "off"; } catch { return false; } });
  const pick = (on: boolean) => { try { if (on) localStorage.removeItem(RTX_KEY); else localStorage.setItem(RTX_KEY, "off"); } catch { /* private mode */ } setOff(!on); syncKreaTE(); };
  const there = rtxInstalled();
  return <Check checked={!off && there !== false} onChange={pick} title="Upscale to 1080p (NVIDIA RTX)"
    sub={there === false ? "Not on this rental (NVIDIA's upscaler didn't install or this card doesn't support it)" : "NVIDIA's video upscaler on the finished frames — a few seconds, not another generation"} />;
}
