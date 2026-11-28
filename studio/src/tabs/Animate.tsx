import { useEffect, useRef, useState } from "react";
import { activePack, planWriter, useBigPlanner } from "../lib/packs";
import { bfsSwapPrompt, buildAnimate, buildBfsVideoSwap, buildSwap, type BfsVideoSwapOpts, swapPrompt, type AnimateOpts, type LoraPick } from "../lib/graphs";
import { longSeconds, runLong, stopLong, forgetLong, useLong, type LongRun } from "../lib/long";
import { askSweep } from "../components/Dialogs";
import { h3CacheInstalled, rtxInstalled, syncKreaTE, useDownloads, useGroup } from "../lib/downloads";
import { VideoModel } from "../components/VideoModel";
import { useJobs, type Job, type Output } from "../lib/jobs";
import { H3_CACHE_KEY, M, REALISM_KEY, RTX_KEY, SMOOTH_KEY, h3Frames, h3Size, h3SizeFor } from "../lib/models";
import { H3_BLUEPRINTS, H3_MOTION_CATS, type H3MotionCat } from "../lib/h3Blueprints";
import { newSeed, seedFor, useSection, useSettings } from "../lib/settings";
import { trayIdOf, useTray, type Media } from "../lib/tray";
import type { MentionTarget } from "../components/Mention";
import { LIMITS, makeRef, useAnimateUndo, useWork, type AnimateState } from "../lib/work";
import { sendTo, usePrimaryAction, useHandoffInto } from "../App";
import { AvoidLine, MOUTH_OPTS, MUSIC_OPTS, withAvoidNote } from "../components/AvoidLine";
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
import { rayVideoCards, useCards } from "../lib/cards";
import { useSpeed } from "../lib/speed";
import { h3ErosOn } from "../lib/models";
import { stopMessage } from "../lib/adult";
import { useCharacters } from "../lib/characters";
import { CharacterPicker, charactersIn, identityLine, withCharacter, WriterSetup } from "./Prompt";
import { copyText } from "../lib/copy";

/** "she dances in the rain and waves at the end" (plain words) vs a written H3 timeline / Deooeo multimodal schema */
const isPlan = (t: string) => /\bCUT \d|\(\d+(\.\d)?s?\s*[–-]|\b\d+:\d{2}\s*[–-]|\bAt \d|integrated_multimodal_description:|\[Shot 1\]/.test(t);

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
    // "Swap into video" on any picture (V9 pack, Create, Edit): BFS H3 v1.1 swap with that exact single picture, keeping any guide video!
    const swapPic = items.find((x) => x.slot === "swap" && x.media.kind === "image")?.media;
    if (swapPic) {
      remember();
      set({ mode: "swap", swapEngine: "bfs" });
      const keepVids = useWork.getState().animateRefs.filter((r) => r.media.kind !== "image");
      setWork({ animateRefs: [makeRef(swapPic), ...keepVids] });
      toast(keepVids.some((r) => r.media.kind === "video")
        ? "Loaded into BFS Swap v1.1 — press Make video or Scout 3 drafts."
        : "Loaded into BFS Swap v1.1 — drop a guide video (≤15 s) on the left and press Make video.", "good");
      return;
    }
    // "Animate" on a picture you made: image → video, with it as the starting frame (and the same picture in Plan a video)
    const start = items.find((x) => x.slot === "start" && x.media.kind === "image")?.media;
    if (start) {
      remember();
      if (refsLike(a.mode)) set({ mode: "i2v" });
      setFrames((f) => [start, a.mode === "fl" ? f[1] : null]);
      const pr = useWork.getState().promptRefs.filter((r) => r.media.name !== start.name);
      setWork({ promptRefs: [{ ...makeRef(start), label: "first frame" }, ...pr.filter((r) => r.label !== "first frame")] });
      if (useSettings.getState().s.prompt.mode !== "first-last") useSettings.getState().set("prompt", { mode: "image" });
      toast("It's the starting frame — Image → video. Describe what happens and press Make video.", "good");
      return;
    }
    if (refsLike(a.mode)) setWork({ animateRefs: [...useWork.getState().animateRefs, ...items.map((i) => makeRef(i.media))] });
    else setFrames((f) => { const n = [...f]; for (const { media } of items) { const i = n.findIndex((x) => !x); n[i >= 0 ? i : 0] = media; } return n; });
  });

  // "Match the picture": the video takes the starting picture's shape (or the first reference picture's), so nothing is stretched
  const shapeFrom = (refsLike(a.mode) ? refs.find((r) => r.media.kind === "image")?.media : frames[0]) ?? null;
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
  const swap = a.mode === "swap";
  useCards((c) => c.cards); // re-render when the card count arrives
  useSpeed((st) => st.splitVideos);
  const split = rayVideoCards();
  // the first "Character swap" button left its LoRA (and prompt) in References mode, with no off switch: take it out once —
  // swapping is its own video type now and doesn't use this list
  useEffect(() => {
    if (!a.loras.some((l) => /h3_character_swap/i.test(l.name))) return;
    set({ loras: a.loras.filter((l) => !/h3_character_swap/i.test(l.name)), ...(/^Replace the person in <Video \d+> with the character in <Picture \d+>/.test(a.prompt) ? { prompt: "" } : {}) });
    toast("Took the old Character swap LoRA out of References — swapping is now Video type → Swap the person", "info");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const long = a.mode === "long";
  const refsMode = ref || swap || long;
  const longParts = a.longParts?.length ? a.longParts : [{ text: "", seconds: 8 }];
  const longRun = useLong((st) => st.run);
  const motionDl = useGroup("hmotion");
  const bfsDl = useGroup("bfs");
  const samDl = useGroup("sam");
  const dl = useGroup("video");
  const swapEngine = a.swapEngine ?? "bfs";
  const swapIsBfs = swapEngine === "bfs";
  const swapVid = refs.find((r) => r.media.kind === "video");
  const swapPics = refs.filter((r) => r.media.kind === "image");
  // Relay runs the whole clip in windows; BFS H3 v1.1 runs up to 15 s (respecting trim start..end)
  const swapSecs = (() => {
    if (!swapVid) return { s: 0, start: 0, end: 0, trimmed: false, overBfsLimit: false };
    const dur = swapVid.media.duration ?? swapVid.end;
    if (swapIsBfs) {
      const start = Math.max(0, swapVid.start || 0);
      const rawEnd = Math.min(dur || swapVid.end || 5, swapVid.end > start ? swapVid.end : dur || 5);
      const span = Math.max(0.5, rawEnd - start);
      const capped = Math.min(15, span);
      return { s: Math.round(capped * 10) / 10, start, end: start + capped, trimmed: start > 0.05 || rawEnd < dur - 0.05, overBfsLimit: span > 15.1 };
    }
    const trimmed = swapVid.end < Math.min(dur, 15) - 0.05;
    return { s: Math.round((trimmed ? swapVid.end : dur) * 10) / 10, start: 0, end: trimmed ? swapVid.end : dur, trimmed, overBfsLimit: false };
  })();
  // BFS H3 v1.1 output size: automatically matches the guide video's own aspect ratio (multiples of 32)
  const swapVidRatio = swapVid?.media.width && swapVid?.media.height ? swapVid.media.width / swapVid.media.height : (ratio ?? 16 / 9);
  const swapBfsSize = h3SizeFor(swapVidRatio, a.swapBfsMp ?? 0.6);
  // Character profile -> concise Alissonerdx `{details}` list for BFS H3 v1.1 (no manual prompting needed)
  const swapChar = (() => { const id = swapPics.find((r) => r.charId)?.charId; return id ? useCharacters.getState().list.find((c) => c.id === id) ?? null : null; })();
  const swapCharDetails = (() => {
    if (!swapChar) return "";
    const gender = swapChar.gender === "male" ? "Male" : swapChar.gender === "female" ? "Female" : "Adult person";
    return [gender, swapChar.ethnicity, swapChar.hair && `${swapChar.hair} hair`, swapChar.eyes && `${swapChar.eyes} eyes`, swapChar.body, swapChar.outfit, swapChar.details].filter(Boolean).join(", ");
  })();
  const swapFull = swapIsBfs ? /^body_swap:/i.test(a.prompt.trim()) : /<Video 1>/.test(a.prompt);
  const swapText = swapFull
    ? a.prompt.trim()
    : swapIsBfs
      ? bfsSwapPrompt({ details: swapCharDetails || swapChar?.block || a.swapBfsDetails, who: a.swapWho, notes: a.prompt, pictures: swapPics.length || 1 })
      : swapPrompt({ pictures: swapPics.length || 1, who: a.swapWho, name: (a.swapName ?? "").trim() || swapChar?.name, look: swapChar?.block, keep: a.swapKeep, notes: a.prompt });
  const why = !dl.ready ? dl.why : long ? (!longParts.some((pt) => pt.text.trim()) ? "Write what happens in part 1"
      : longRun?.status === "running" ? "A long video is being made — wait, or stop it below"
      : refs.some((r) => r.media.kind === "video" || r.media.kind === "audio") ? "Long video uses pictures only — remove the clips and sounds (to follow a video, use Swap the person)"
      : busy ? "Sending…" : undefined)
    : swap ? (!swapVid ? "Add the video with the person to replace"
      : !swapPics.length ? "Add at least one picture of your character"
      : refs.filter((r) => r.media.kind === "video").length > 1 ? "Swap uses one video — remove the others"
      : busy ? "Sending…" : undefined)
    : (!a.prompt.trim() ? "Write a prompt (or send one from the Prompt helper)"
    : !ref && !frames[0] ? "Add the starting picture"
    : a.mode === "fl" && !frames[1] ? "Add the last picture"
    : ref && refs.some((r) => r.media.kind === "video" && (r.end - r.start < 2 || r.end - r.start > 15)) ? "Reference clips must be 2–15 s long"
    : busy ? "Sending…" : undefined);
  // turbo: References (its own 4-step LoRA), and every other type too with Speed-ups → Faster video steps (8 steps)
  const vt = useSpeed((st) => st.videoTurbo);
  const turboOk = !swap && (ref || long || (vt && !h3ErosOn()));
  const takes = Math.max(1, Math.min(8, Math.round(a.takes || 1)));
  const etaKey = `animate:${a.mode}:${turboOk && a.turbo ? "turbo" : "full"}:${a.seconds}s:${a.mp}`;

  const opts = (seed: number, turbo: boolean, over: Partial<AnimateOpts> = {}): AnimateOpts => ({
    ...a.adv, seed, mode: a.mode === "swap" || a.mode === "long" ? "ref" : a.mode, prompt: a.prompt, avoid: a.avoid, music: a.music, mouth: a.mouth, seconds: a.seconds, width, height, turbo, loras: a.loras, ...over,
    refImageSize: a.refImageSize, lowMemDecode: a.lowMemDecode, prefix: "studio/animate/h3", ray: rayVideoCards(),
    images: ref ? refs.filter((r) => r.media.kind === "image").map((r) => r.media.name) : (frames.filter(Boolean) as Media[]).map((m) => m.name),
    // a clip whose motion is copied exactly goes in as depth only (its people's looks never reach H3)
    videos: ref ? refs.filter((r) => r.media.kind === "video" && !r.motion).map((r) => ({ file: r.media.name, start: r.start, end: r.end, useSound: r.useSound })) : [],
    audios: ref ? refs.filter((r) => r.media.kind === "audio").map((r) => r.media.name) : [],
    ...(ref && refs.some((r) => r.motion && r.media.kind === "video") ? { motion: (() => { const m = refs.find((r) => r.motion && r.media.kind === "video")!; return { file: m.media.name, start: m.start, end: m.end, strength: 0.8, endAt: 0.7 }; })() } : {}),
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
    if (!force && plan && plan.from === a.prompt + "\u0000" + (a.avoid ?? "") + (a.music ?? "score")) return plan.to;
    const rs = ref ? refs : [];
    const tags = tagsFor(rs);
    const modeLabel = a.mode === "ref" ? "References" : a.mode === "fl" ? "First → last frame" : "Image → video";
    const pw = await planWriter(useSettings.getState().s.prompt.guide, DEFAULTS.prompt.guide, useBigPlanner());
    const graph = buildPromptHelper({
      pictures: [...rs.filter((r) => r.media.kind === "image").map((r) => ({ file: r.media.name, tag: tags[r.id], label: r.label })),
        ...(!ref ? (frames.filter(Boolean) as Media[]).map((m, i) => ({ file: m.name, tag: `<Picture ${i + 1}>`, label: i === 0 ? "the first frame" : "the last frame" })) : [])],
      videos: rs.filter((r) => r.media.kind === "video").map((r) => ({ file: r.media.name, tag: tags[r.id], label: r.label, start: r.start, end: r.end, useSound: r.useSound })),
      audios: rs.filter((r) => r.media.kind === "audio").map((r) => ({ tag: tags[r.id], label: r.label })),
      characters: charactersIn(rs, tags, useCharacters.getState().list), idea: withAvoidNote(a.prompt, a.avoid), music: a.music, mouth: a.mouth, seconds: a.seconds, cuts: 0, camera: "auto", mode: modeLabel,
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
    setPlan({ from: a.prompt + "\u0000" + (a.avoid ?? "") + (a.music ?? "score"), to: text });
    // into the planned-prompts history of each character in it (Characters tab → Planned prompts)
    import("../lib/plans").then(({ addPlan }) => addPlan({ chars: [...new Set(rs.map((r) => r.charId).filter((x): x is string => !!x))], project: useCharacters.getState().sel,
      idea: a.prompt, seconds: a.seconds, mode: a.mode, cuts: 0, camera: "auto", text, sent: Date.now() })).catch(() => {});
    return text;
  };
  // Build BFS H3 Character Swap v1.1 options (shared by Make video, Scout 3 drafts, and Render Hero)
  const buildBfsOpts = async (seed: number, turbo: boolean, size: { width: number; height: number }, pics: string[], kitchen: boolean): Promise<BfsVideoSwapOpts> => {
    let turboLora: string | undefined;
    if (turbo) {
      const have = await (await import("../lib/api")).listLoras().catch(() => [] as string[]);
      const norm = (x: string) => x.replace(/\\/g, "/").toLowerCase();
      const hasDmd = have.some((x) => norm(x) === norm(M.h3BfsTurbo8));
      const hasFl8 = have.some((x) => norm(x) === norm(M.h3TurboFl8));
      turboLora = hasDmd ? M.h3BfsTurbo8 : hasFl8 ? M.h3TurboFl8 : M.h3BfsTurbo8;
    }
    return {
      video: swapVid!.media.name, start: swapSecs.start, end: swapSecs.end,
      hasAudio: swapVid!.media.has_audio, useAudio: a.swapBfsAudio !== false,
      pictures: pics, width: size.width, height: size.height,
      prompt: swapText, seed, turbo, turboLora,
      strength: a.swapBfsStrength ?? 1, loras: a.loras, anime: swapChar?.style === "anime",
      cutoutRef: a.swapBfsCutout !== false, lowMemDecode: a.lowMemDecode, kitchen, prefix: "studio/animate/bfs_swap",
    };
  };

  /** Seed Hunter: queue 3 cheap 8-step drafts (0.4 MP) with different seeds — hover your favorite to click "Render Hero (same seed)" */
  const scout3 = async () => {
    if (why) return;
    setBusy(true); setTimeout(() => setBusy(false), 600);
    const stack = `scout:${Date.now().toString(36)}`;
    try {
      if (swap && swapIsBfs && swapVid) {
        const oi = await fetch("/object_info/ModelAttentionBackend").then((r) => r.json()).catch(() => null);
        const kitchen = JSON.stringify(oi ?? {}).includes("comfy kitchen attention");
        const pics = swapPics.map((r) => r.media.name);
        const draftSz = h3SizeFor(swapVidRatio, 0.4);
        for (let i = 0; i < 3; i++) {
          const seed = newSeed();
          const bfsO = await buildBfsOpts(seed, true, draftSz, pics, kitchen);
          await run("animate", `Scout ${i + 1}/3 · BFS Swap · ${swapSecs.s} s`, buildBfsVideoSwap(bfsO), `animate:bfs_swap:turbo:${Math.round(swapSecs.s)}s:0.4`,
            { bfsOpts: bfsO, preview: true, stack, snapshot: { section: "animate", settings: { ...a, adv: { ...a.adv, seed, lockSeed: true } }, media: { refs, frames } } });
        }
        toast("Queued 3 fast BFS drafts (0.4 MP · 8 steps) — hover your favorite and click Render Hero (same seed).", "good");
        return;
      }
      if (swap || long) return;
      const planned = await planFirst();
      const id = ref ? identityLine(refs, useCharacters.getState().list, planned) : "";
      const prompt = id ? `${id}\n${planned}` : planned;
      const draftSz = sizeOf(0.4);
      const turbo = turboOk;
      for (let i = 0; i < 3; i++) {
        const seed = newSeed();
        const o = opts(seed, turbo, { prompt, ...draftSz, steps: turbo ? 8 : Math.min(12, a.adv.steps) });
        await run("animate", `Scout ${i + 1}/3 · ${a.seconds} s draft`, buildAnimate(o), `animate:${a.mode}:${turbo ? "turbo" : "full"}:${a.seconds}s:0.4`,
          { opts: o, preview: true, stack, snapshot: { section: "animate", settings: { ...a, adv: { ...a.adv, seed, lockSeed: true } }, media: { refs, frames } } });
      }
      toast("Queued 3 fast drafts (0.4 MP) — hover your favorite and click Render Hero (same seed).", "good");
    } catch (e) { toast(`Couldn't start scout: ${(e as Error).message}`, "bad"); }
  };

  // Swap the person: either BFS H3 Character Swap v1.1 (native guide-latent, best likeness ≤15 s) or H3 Relay v1.5 (SAM 3.1 masked looping)
  const goSwap = async () => {
    if (!swapVid) return;
    setBusy(true); setTimeout(() => setBusy(false), 600);
    try {
      const oi = await fetch("/object_info/ModelAttentionBackend").then((r) => r.json()).catch(() => null);
      const kitchen = JSON.stringify(oi ?? {}).includes("comfy kitchen attention");
      const seed = seedFor(a.adv, (p) => set({ adv: { ...a.adv, ...p } }));
      const secs = swapSecs.s;
      if (swapIsBfs) {
        const pics = swapPics.map((r) => r.media.name);
        const turbo = !!a.swapBfsTurbo;
        const bfsO = await buildBfsOpts(seed, turbo, swapBfsSize, pics, kitchen);
        await run(
          "animate",
          `BFS Swap v1.1 · ${secs} s · ${turbo ? "8-step fast" : "20-step hero"} · ${swapChar?.site?.name || swapChar?.name || `${pics.length} pic${pics.length > 1 ? "s" : ""}`}`,
          buildBfsVideoSwap(bfsO),
          `animate:bfs_swap:${turbo ? "turbo" : "hero"}:${Math.round(secs)}s:${a.swapBfsMp ?? 0.6}`,
          { bfsOpts: bfsO, preview: turbo, snapshot: { section: "animate", settings: { ...a, adv: { ...a.adv, seed, lockSeed: true } }, media: { refs, frames } } },
        );
        if (swapSecs.overBfsLimit) toast("BFS H3 v1.1 runs up to 15 s at a time — rendered the first 15 s of your selection. Switch Engine to H3 Relay v1.5 for longer full clips.", "info");
        return;
      }
      const g = buildSwap({ video: swapVid.media.name, who: (a.swapWho ?? "").trim() || "person", pick: a.swapPick ?? "largest",
        resolution: a.swapRes ?? "768", seconds: swapSecs.trimmed ? swapVid.end : 0, prompt: swapText, seed, kitchen, prefix: "studio/animate/swap",
        pictures: await (async () => {
          const pics = swapPics.map((r) => r.media.name);
          if (!a.swapBfs || !bfsDl.ready || !samDl.ready) return pics;
          // her head on frame 1 first (BFS): that still leads the pictures — her, already in the scene, pose and light
          const face = swapChar ? await useCharacters.getState().asMedia(swapChar.id, (await import("../lib/characters")).faceView(swapChar) ?? "front").catch(() => null) : null;
          try {
            const still = await (await import("../lib/faceDetail")).bfsFirstFrame(swapVid.media.name, face?.name ?? pics[0], a.swapPick ?? "largest");
            return [still, ...pics].slice(0, 8);
          } catch (e) { toast(`BFS still skipped: ${(e as Error).message} — swapping from her pictures alone`, "info"); return pics; }
        })(),
        ...(a.swapDepth && motionDl.ready ? { depth: { strength: 0.6, endAt: 0.6 } } : {}) });
      await run("animate", `Swap the person · ${(a.swapWho ?? "").trim() || "person"} → ${swapPics.length} picture${swapPics.length > 1 ? "s" : ""}`, g, `animate:swap:${a.swapRes ?? "768"}:${Math.round(secs)}s`,
        { snapshot: { section: "animate", settings: { ...a, adv: { ...a.adv, seed, lockSeed: true } }, media: { refs, frames } } });
      if (swapVid.start > 0.05) toast("H3 Relay swap uses the video from its start — trim the clip itself, or switch Engine to BFS H3 v1.1 to swap any trimmed range", "info");
    } catch (e) { toast(`Couldn't start: ${(e as Error).message}`, "bad"); }
  };
  /** one part's words → the Plan-a-video writer (with the pictures and characters), like a normal video's plain words */
  const planPart = async (idea: string, seconds: number, n: number): Promise<string> => {
    const tags = tagsFor(refs);
    const pw = await planWriter(useSettings.getState().s.prompt.guide, DEFAULTS.prompt.guide, useBigPlanner());
    const graph = buildPromptHelper({
      pictures: refs.filter((r) => r.media.kind === "image").map((r) => ({ file: r.media.name, tag: tags[r.id], label: r.label })), videos: [], audios: [],
      characters: charactersIn(refs, tags, useCharacters.getState().list), idea: withAvoidNote(idea, a.avoid), music: a.music, mouth: a.mouth, seconds, cuts: 0, camera: "auto",
      mode: "References", guide: pw.guide, writer: pw.writer, seed: newSeed(),
    });
    const job = await run("animate", `Long video · planning part ${n}`, graph, "prompt:0v", { quiet: true, front: true });
    const done = await waitForJob(job.id);
    const raw = done.texts.timeline ?? "";
    if (done.status !== "done" || !raw.trim()) throw new Error(done.error ?? `The writer didn't answer for part ${n}`);
    if (Object.entries(done.texts).some(([k, v]) => k.startsWith("seen:") && v.includes(MINOR_FLAG))) throw new Error("Stopped: someone in a reference picture may be under 18 — use pictures of adults only");
    if (raw.includes(MINOR_FLAG)) throw new Error(stopMessage([idea]));
    const parsed = parseTimeline(raw, seconds);
    return parsed.cuts.some((c) => c.text) ? toPrompt(parsed) : raw.trim();
  };
  // Long video: each part planned like a normal video (it knows it carries straight on from the part before), then made one
  // after another with H3 Relay's continuation and joined (lib/long.ts)
  const goLong = async () => {
    setBusy(true);
    try {
      const parts = longParts.filter((pt) => pt.text.trim());
      const pics = refs.filter((r) => r.media.kind === "image").map((r) => r.media.name);
      const oi = await fetch("/object_info/H3RelayAttention").then((r) => r.json()).catch(() => null);
      const kitchen = JSON.stringify(oi ?? {}).includes("comfy kitchen attention");
      const list = useCharacters.getState().list;
      const shots = [];
      for (let i = 0; i < parts.length; i++) {
        const pt = parts[i];
        const idea = i === 0 ? pt.text.trim()
          : `${pt.text.trim()}\n(This part carries straight on from the moment the part before it ends — the same take: no new start, no cut, no reset of the pose, camera, light or sound. Part ${i + 1} of ${parts.length}.)`;
        const planned = planning ? await planPart(idea, pt.seconds, i + 1) : idea;
        const id = identityLine(refs, list, planned);
        shots.push({ prompt: id ? `${id}\n${planned}` : planned, seconds: pt.seconds, seed: newSeed() });
      }
      const r: LongRun = { id: Date.now().toString(36), title: parts[0].text.trim().slice(0, 60), shots, images: pics,
        global: [a.prompt.trim(), "One continuous take: the same people, faces, hair, outfits, place, light and sound from start to finish."].filter(Boolean).join("\n"),
        ...(a.longStart && pics[0] ? { firstFrame: pics[0] } : {}), width, height, overlap: a.longOverlap ?? 18, turbo: turboOk && a.turbo, loras: a.loras,
        anime: refs.some((x) => x.charId && list.find((c) => c.id === x.charId)?.style === "anime"), refImageSize: a.refImageSize, kitchen, done: 0, status: "running", at: Date.now() };
      setBusy(false);
      await runLong(r);
    } catch (e) { toast(`Couldn't start: ${(e as Error).message}`, "bad"); } finally { setBusy(false); }
  };
  // the CivitAI posts among the references / frames ("CivitAI 12345") get marked ANIMATED, with the characters in it
  const noteCivit = () => {
    const ms = [...refs.map((r) => r.media), ...frames].filter(Boolean) as { label?: string }[];
    const ids = ms.map((m) => /^CivitAI (\d+)$/.exec(m.label ?? "")?.[1]).filter((x): x is string => !!x);
    if (!ids.length) return;
    const chars = [...new Set(refs.map((r) => r.charId).filter((x): x is string => !!x))];
    import("../lib/civitUsed").then(({ noteUsed }) => noteUsed(ids, "animate", chars.length ? chars : [useCharacters.getState().sel], Math.max(1, takes))).catch(() => {});
  };
  const go = async () => {
    if (why) return;
    noteCivit();
    if (swap) return goSwap();
    if (long) return goLong();
    import("../lib/promptHistory").then(({ remember }) => remember("animate", a.prompt, "sent"));
    setBusy(true);
    setTimeout(() => setBusy(false), 600); // keep the button free: you can line up more while it plans
    try {
      if (ref && refs.some((r) => r.motion && r.media.kind === "video")) await (await import("../lib/posewear")).motionReady();
      // a character among the references: who's who said first ("<Picture 1> is her reference sheet… the woman in the video is her")
      const planned = await planFirst();
      const id = ref ? identityLine(refs, useCharacters.getState().list, planned) : "";
      const prompt = id ? `${id}\n${planned}` : planned;
      // a video made from a saved plan: counted on it
      import("../lib/plans").then(({ planOfText, updatePlan }) => { const pl = planOfText(prompt); if (pl) updatePlan(pl.id, { made: (pl.made ?? 0) + takes }); }).catch(() => {});
      const optsP = (seed: number, turbo: boolean, over: Partial<AnimateOpts> = {}) => opts(seed, turbo, { prompt, ...over });
      // N takes: the same plan, each with its own seed — one press, every variation lined up (they stack as one tile)
      const stack = `takes:${Date.now().toString(36)}`;
      const turbo = turboOk && a.turbo;
      for (let i = 0; i < takes; i++) {
        const seed = takes === 1 ? seedFor(a.adv, (p) => set({ adv: { ...a.adv, ...p } })) : newSeed();
        const o = optsP(seed, turbo);
        await run("animate", label(`${turbo ? " · turbo" : ""}${takes > 1 ? ` · take ${i + 1}/${takes}` : ""}`), buildAnimate(o), etaKey,
          { opts: o, ...(takes > 1 ? { stack } : {}), snapshot: { section: "animate", settings: { ...a, adv: { ...a.adv, seed, lockSeed: true } }, media: { refs, frames } } });
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
    const bfs = j.meta?.bfsOpts as BfsVideoSwapOpts | undefined;
    if (bfs) {
      const heroMp = Math.max(0.98, a.swapBfsMp ?? 0.98);
      const heroSz = h3SizeFor(bfs.width / Math.max(1, bfs.height), heroMp);
      const hero: BfsVideoSwapOpts = { ...bfs, turbo: false, turboLora: undefined, width: heroSz.width, height: heroSz.height };
      try {
        await run("animate", `BFS Swap v1.1 · Hero 20-step · ${heroSz.width}×${heroSz.height}`, buildBfsVideoSwap(hero), `animate:bfs_swap:hero:${Math.round(bfs.end - bfs.start)}s:${heroMp}`,
          { bfsOpts: hero });
      } catch (e) { toast((e as Error).message, "bad"); }
      return;
    }
    const o = { ...(j.meta!.opts as AnimateOpts), turbo: false, steps: Math.max(20, useSettings.getState().s.animate.adv.steps), width, height };
    try { await run("animate", `${o.seconds} s video · Hero quality`, buildAnimate(o), `animate:${o.mode}:full:${o.seconds}s:${a.mp}`, { opts: o }); }
    catch (e) { toast((e as Error).message, "bad"); }
  };

  const takeOpts = [1, 2, 3, 4, 6, 8].map((n) => ({ value: n, label: n === 1 ? "1 take" : `${n} takes`, hint: n === 1 ? "one video" : `${n} videos from one press — same plan, different seeds` }));
  const chips = (
    <>
      <Chip title="Video type" value={a.mode} onChange={(v) => set({ mode: v })} options={[{ value: "swap", label: "Swap the person" }, { value: "long", label: "Long video (past 15 s)" }, { value: "ref", label: "References" }, { value: "i2v", label: "Image → video" }, { value: "fl", label: "First → last" }, { value: "loop", label: "Seamless loop" }]} />
      {swap && <>
        <Chip title="Swap engine" value={swapEngine} onChange={(v) => set({ swapEngine: v })} options={[
          { value: "bfs", label: "Engine: BFS H3 v1.1", hint: "Alissonerdx guide-latent LoRA — best likeness, no mask halos, auto BiRefNet cutout, up to 15 s" },
          { value: "relay", label: "Engine: H3 Relay v1.5", hint: "SAM 3.1 masked looping — for videos longer than 15 s or replacing one person in a crowd" },
        ]} />
        {swapIsBfs ? <>
          <Chip title="Quality & steps" value={a.swapBfsTurbo ? 1 : 0} onChange={(v) => set({ swapBfsTurbo: v === 1 })} options={[
            { value: 0, label: "Hero · 20 steps", hint: "Full quality (res_multistep, no turbo LoRA — sharpest skin & hands)" },
            { value: 1, label: "Fast · 8 steps", hint: "DMD 8-step turbo LoRA — quick preview & iteration" },
          ]} />
          <Chip title="Size" value={a.swapBfsMp ?? 0.6} onChange={(v) => set({ swapBfsMp: v })} options={[
            { value: 0.4, label: "Draft 0.4 MP" },
            { value: 0.6, label: "Good 0.6 MP" },
            { value: 0.98, label: "Full 1 MP" },
            { value: 1.2, label: "Hero 1.2 MP" },
          ]} />
          <Chip title="Reference background" value={a.swapBfsCutout === false ? 0 : 1} onChange={(v) => set({ swapBfsCutout: v === 1 })} options={[
            { value: 1, label: "Ref: Auto cutout", hint: "BiRefNetRMBG neutral #808080 cutout so her old room never bleeds into the video" },
            { value: 0, label: "Ref: Original pic", hint: "Keep her reference picture background as-is" },
          ]} />
          <Chip title="Swap strength" value={a.swapBfsStrength ?? 1} onChange={(v) => set({ swapBfsStrength: v })} options={[
            { value: 0.85, label: "LoRA 0.85" },
            { value: 1, label: "LoRA 1.0" },
            { value: 1.15, label: "LoRA 1.15" },
          ]} />
          <Chip title="Sound" value={a.swapBfsAudio === false ? 0 : 1} onChange={(v) => set({ swapBfsAudio: v === 1 })} options={[
            { value: 1, label: "Sound: Guide audio" },
            { value: 0, label: "Sound: H3 generated" },
          ]} />
          {!swapChar && (
            <label className="flex h-8 items-center gap-1.5 border border-line bg-black/20 px-2 text-[12.5px] text-muted" title="Optional: short description of the person in your standalone photo (e.g. “Female, long black hair, black dress”). Leave blank to auto-detect from the photo.">
              Photo<input value={a.swapBfsDetails ?? ""} onChange={(e) => set({ swapBfsDetails: e.target.value })} placeholder="look (optional)" aria-label="Reference photo look" disabled={swapFull} className="w-36 bg-transparent text-ink placeholder:text-dim focus:outline-none disabled:opacity-50" />
            </label>
          )}
          <label className="flex h-8 items-center gap-1.5 border border-line bg-black/20 px-2 text-[12.5px] text-muted" title="Optional: if several people appear in the clip, say which one to replace (e.g. “woman on the left”). Leave empty for solo clips.">
            Target<input value={a.swapWho ?? ""} onChange={(e) => set({ swapWho: e.target.value })} placeholder="main subject" aria-label="Target subject" disabled={swapFull} className="w-32 bg-transparent text-ink placeholder:text-dim focus:outline-none disabled:opacity-50" />
          </label>
          <span className="ml-1 font-mono text-[11px] text-dim">{swapVid ? `${swapBfsSize.width}×${swapBfsSize.height} · ${swapSecs.s} s${swapSecs.overBfsLimit ? " (capped at 15 s)" : ""}` : "add a video"}</span>
        </> : <>
          <label className="flex h-8 items-center gap-1.5 border border-line bg-black/20 px-2 text-[12.5px] text-muted" title="Who in the video becomes your character — plain words, e.g. “woman”, “man in a red shirt”, “dancer”">
            Replace<input value={a.swapWho ?? ""} onChange={(e) => set({ swapWho: e.target.value })} placeholder="person" aria-label="Who to replace" className="w-36 bg-transparent text-ink placeholder:text-dim focus:outline-none" />
          </label>
          <label className="flex h-8 items-center gap-1.5 border border-line bg-black/20 px-2 text-[12.5px] text-muted" title="Your character's name, written into the prompt. If the video comes back with no swap at all, adding the name is the first thing to try">
            Name<input value={a.swapName ?? ""} onChange={(e) => set({ swapName: e.target.value })} placeholder={swapChar?.name ?? "optional"} aria-label="Character name" disabled={swapFull} className="w-28 bg-transparent text-ink placeholder:text-dim focus:outline-none disabled:opacity-50" />
          </label>
          <label className="flex h-8 items-center gap-1.5 border border-line bg-black/20 px-2 text-[12.5px] text-muted" title="Things the swap should keep — comma-separated, e.g. “sunglasses, red scarf, tattoos”. If it removed something you wanted, add it here">
            Keep<input value={a.swapKeep ?? ""} onChange={(e) => set({ swapKeep: e.target.value })} placeholder="e.g. sunglasses, tattoos" aria-label="Also keep" disabled={swapFull} className="w-40 bg-transparent text-ink placeholder:text-dim focus:outline-none disabled:opacity-50" />
          </label>
          <Chip title="If several match" value={a.swapPick ?? "largest"} onChange={(v) => set({ swapPick: v })} options={[{ value: "largest", label: "The biggest one" }, { value: "leftmost", label: "The one on the left" }, { value: "rightmost", label: "The one on the right" }]} />
          <Chip title="Quality" value={a.swapRes ?? "768"} onChange={(v) => set({ swapRes: v })} options={[{ value: "768", label: "Sharp · 768p" }, { value: "480", label: "Fast · 480p" }]} />
          <Chip title="Lock the motion" value={a.swapDepth && motionDl.ready ? 1 : 0} onChange={(v) => { if (v && !motionDl.ready) { toast(motionDl.why ?? "Copy motion from a video isn't downloaded", "info"); return; } set({ swapDepth: v === 1 }); }}
            options={[{ value: 0, label: "Motion: from the video", hint: "she moves like the person, in her own shape" }, { value: 1, label: "Motion: locked (depth)", hint: "exact moves — and the person's outline, so for a similar build and hair" }]} />
          <Chip title="Start from a BFS still" value={a.swapBfs && bfsDl.ready && samDl.ready ? 1 : 0} onChange={(v) => { if (v && !(bfsDl.ready && samDl.ready)) { toast((!bfsDl.ready ? bfsDl.why : samDl.why) ?? "BFS isn't downloaded", "info"); return; } set({ swapBfs: v === 1 }); }}
            options={[{ value: 0, label: "Likeness: her pictures" }, { value: 1, label: "Likeness: + BFS still of frame 1", hint: "her head put on frame 1 first (about a minute), then given to H3 as her first picture" }]} />
          <span className="ml-1 text-[11px] text-dim">{swapVid ? `${swapSecs.s} s · the video's own length and sound` : "add a video"}</span>
        </>}
      </>}
      {long && <>
        <Chip title="Joins" value={a.longOverlap ?? 18} onChange={(v) => set({ longOverlap: v })} options={[{ value: 18, label: "Joins: 0.75 s overlap", hint: "Relay's default" }, { value: 35, label: "Joins: 1.5 s overlap", hint: "smoother, each part adds a little less" }, { value: 52, label: "Joins: 2.2 s overlap" }, { value: 69, label: "Joins: 2.9 s overlap" }]} />
        <Chip title="First frame" value={a.longStart ? 1 : 0} onChange={(v) => set({ longStart: v === 1 })} options={[{ value: 0, label: "Pictures as references" }, { value: 1, label: "Start on picture 1", hint: "the first picture is also the exact first frame" }]} />
        <span className="text-[11px] text-dim">{longSeconds(longParts)} s in {longParts.length} part{longParts.length > 1 ? "s" : ""}</span>
      </>}
      {!swap && <>{!long && <Chip title="Length" value={a.seconds} onChange={(v) => set({ seconds: v })} options={Array.from({ length: 14 }, (_, i) => i + 2).map((n) => ({ value: n, label: `${n} s` }))} />}
      <Chip title="Shape" value={a.aspect} onChange={(v) => set({ aspect: v })} options={[{ value: "auto", label: ratio ? `Match the picture (${ratioLabel(ratio)})` : "Match the picture" }, { value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }, { value: "1:1", label: "1:1" }]} />
      <Chip title="Music" value={a.music ?? "score"} onChange={(v) => set({ music: v })} options={MUSIC_OPTS} />
      <Chip title="Mouth" value={a.mouth ?? "closed"} onChange={(v) => set({ mouth: v })} options={MOUTH_OPTS} />
      <Chip title="Size" value={a.mp} onChange={(v) => set({ mp: v })} options={[{ value: 0.4, label: "Draft 0.4 MP" }, { value: 0.6, label: "Good 0.6 MP" }, { value: 0.98, label: "Full 1 MP" }, { value: 1.2, label: "1.2 MP" }, { value: 1.5, label: "1.5 MP" }, { value: 2, label: "2 MP" },
        ...([0.4, 0.6, 0.98, 1.2, 1.5, 2].includes(a.mp) ? [] : [{ value: a.mp, label: `${a.mp} MP` }])]} />
      {!isPlan(a.prompt) && <Chip title="Plain words" value={a.plan === false ? 0 : 1} onChange={(v) => set({ plan: v === 1 })} options={[{ value: 1, label: "Writer plans it (recommended)" }, { value: 0, label: "Send my words as typed" }]} />}
      {!long && <Chip title="Takes" value={takes} onChange={(v) => set({ takes: v })} options={takeOpts} />}
      {turboOk && <Chip title="Speed" value={a.turbo ? 1 : 0} onChange={(v) => set({ turbo: v === 1 })} options={[{ value: 1, label: "Turbo", hint: "8 steps — fast" }, { value: 0, label: "Full quality", hint: "more steps — slower, finer detail" }]} />}
      <span className="ml-1 font-mono text-[11px] text-dim">{width}×{height}{long ? "" : ` · ${nFrames} frames`}{split > 1 ? ` · split across ${split} cards` : ""}</span></>}
    </>
  );
  // @ in the box: References mode → characters and pictures join the references; otherwise a picture is the first frame
  const mention: MentionTarget = {
    hint: refsLike(a.mode) ? { character: "their pictures join the references", picture: "joins the references" } : { character: "only in References mode", picture: "becomes the first frame" },
    pick: async (pk) => {
      if (pk.kind === "character") {
        if (!refsLike(a.mode)) throw new Error("Characters go in as references — set the mode to References first (in this mode the first frame decides who's in it)");
        remember(); setWork({ animateRefs: await withCharacter(pk.c, useWork.getState().animateRefs) });
        return pk.c.name;
      }
      const md = await useTray.getState().asMedia(pk.item.id);
      remember();
      if (refsLike(a.mode)) { const cur = useWork.getState().animateRefs; if (!cur.some((r) => r.media.name === md.name)) setWork({ animateRefs: [...cur, makeRef(md)] }); }
      else setFrames((f) => [md, a.mode === "fl" ? f[1] : null]);
      return "";
    },
  };
  return (
    <Workspace needs={"video"} tab="animate" title="Animate" sub="MiniMax H3, video with sound"
      bar={<PromptBar value={a.prompt} onChange={(v) => set({ prompt: v })} chips={chips} minRows={3} maxRows={10} rewrite="animate" mention={mention}
        placeholder={long ? "Optional: what holds for the whole video — the place, her outfit, the look (each part's own action goes in the parts on the left)" : swap ? "Optional notes added to the prompt — e.g. “his jacket stays open”. Leave empty for the default." : "Say what happens in plain words — the writer plans it second by second with your references and characters (like Plan a video)…"}
        below={<>
          {!swap && <AvoidLine value={a.avoid ?? ""} onChange={(v) => set({ avoid: v })} />}
          {swap && <div className="mt-1.5 flex items-start gap-2 text-[11.5px] leading-snug text-dim">
            <span className="min-w-0 flex-1"><span className="text-muted">{swapFull ? "Sent as you wrote it" : "Prompt it sends"}:</span> {swapFull ? "(your edit above)" : swapText}</span>
            {swapFull ? <button onClick={() => set({ prompt: "" })} className="shrink-0 text-accent hover:underline" title="Go back to the default prompt with your Name and Keep">Back to the default</button>
              : <button onClick={() => set({ prompt: swapText })} className="shrink-0 text-accent hover:underline" title="Put the whole prompt in the box to change any of it">Edit the whole prompt</button>}
          </div>}
          {!long && planning && a.prompt.trim() ? <PlanLine plan={plan} text={a.prompt + "\u0000" + (a.avoid ?? "") + (a.music ?? "score")} onUse={(t) => set({ prompt: t })} onPlan={() => planFirst(true)} /> : null}
        </>}
        action={<div className="flex items-center gap-1.5">
          {!long && (!swap || swapIsBfs) && (
            <Btn onClick={scout3} disabled={!!why} why={why} title="Seed Hunter: render 3 fast 0.4 MP drafts with different seeds, then hover your favorite and click Render Hero (same seed)">
              Scout 3
            </Btn>
          )}
          <GoButton onClick={go} disabled={!!why} why={why}>{long ? `Make ${longSeconds(longParts)} s video` : takes > 1 && !swap ? `Make ${takes}` : "Make video"} <EtaText k={etaKey} prefix="· " /></GoButton>
        </div>} />}
      drawer={<>
        <PresetBar section="animate" />
        <button onClick={() => openImageImport("", "collections")} className="press group flex items-center gap-2.5 border border-dashed border-line px-3 py-2.5 text-left hover:border-accent">
          <Icon name="link" size={16} className="shrink-0 text-accent" />
          <span className="min-w-0"><span className="block text-[13px] font-semibold text-ink">Copy a video from CivitAI</span>
            <span className="block text-[11.5px] text-muted">From your saved collections or a link — its prompt, LoRAs and the clip come in.</span></span>
        </button>
        {long && <LongPanel parts={longParts} onChange={(p) => set({ longParts: p })} run={longRun} planning={planning} />}
        {swap && (
          <div className="border border-accent/40 bg-accent/[.05] px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
            {swapIsBfs ? <>
              <b className="text-ink">BFS H3 Character Swap v1.1.</b> Pick a character (or drop her picture) + add <b className="text-ink">one guide video (≤15 s)</b>. Her picture is automatically cut out onto neutral <code className="text-ink">#808080</code> grey (so her old room never bleeds in) and her look is auto-filled into the trained <code className="text-ink">body_swap:</code> prompt.
              <span className="mt-1.5 block"><b className="text-ink">Tips:</b> Use <b className="text-ink">Hero · 20 steps</b> for final quality or <b className="text-ink">Fast · 8 steps</b> for quick tests. For clips longer than 15 s or crowds, switch <b className="text-ink">Engine → H3 Relay v1.5</b>.</span>
            </> : <>
              <b className="text-ink">Swap the person (H3 Relay v1.5).</b> Add <b className="text-ink">one video</b> and <b className="text-ink">any pictures of your character</b> — face, outfit, accessories; they're all treated as the same character (a reference sheet counts as one picture). The video's movement, camera, background and sound stay; only the person you name above changes.
              <span className="mt-1.5 block"><b className="text-ink">If it struggles:</b> no swap at all → add the character's <b className="text-ink">Name</b>. It removed something you wanted → add it to <b className="text-ink">Keep</b>. Anything else → <b className="text-ink">Edit the whole prompt</b> under the box.</span>
            </>}
          </div>
        )}
        {refsMode ? (
          <div><Label right={<span className="flex gap-3">{undo.stack.length > 0 && <button className="text-xs text-muted hover:text-ink" title="Bring back the box, references, frames and LoRAs from before the last change (Ctrl+Z)" onClick={doUndo}>↶ Undo</button>}
            {!swap && <button className="text-xs text-accent hover:underline" title="Your references, words, length and LoRAs go along" onClick={planInPrompt}>Plan a video with these</button>}</span>}>{swap ? "Video and pictures" : "References"}</Label>
            <div className="mb-2"><CharacterPicker refs={refs} singleFront={swap && swapIsBfs} onChange={(r) => { remember(); setWork({ animateRefs: r }); }} /></div>
            <RefList refs={refs} onChange={(r) => { if (r.length < refs.length) remember(); setWork({ animateRefs: r }); }} /></div>
        ) : (
          <div className={a.mode === "fl" ? "grid grid-cols-2 gap-2.5" : ""}>
            <div><Label>{a.mode === "loop" ? "Picture (start = end)" : "First frame"}</Label><Slot className="h-44" value={frames[0]} onChange={(m) => { remember(); setFrames((f) => [m, f[1]]); }} label="Starting picture" /></div>
            {a.mode === "fl" && <div><Label>Last frame</Label><Slot className="h-44" value={frames[1]} onChange={(m) => { remember(); setFrames((f) => [f[0], m]); }} label="Ending picture" /></div>}
          </div>
        )}
        {!refsMode && <div className="flex justify-end gap-3">{undo.stack.length > 0 && <button className="text-xs text-muted hover:text-ink" onClick={doUndo}>↶ Undo</button>}<button className="text-xs text-accent hover:underline" onClick={planInPrompt}>Plan a video with these</button></div>}
        {!turboOk && !swap && <p className="text-xs text-muted">{h3ErosOn() ? "Eros Max has its own speed built in — turbo stays off." : "Turbo for this type is off in ⋯ → Speed-ups (Faster video steps)."}</p>}
        {!swap && !long && (
          <H3BlueprintPicker
            onPick={(bp) => {
              remember();
              set({ prompt: bp.prompt, seconds: bp.seconds, plan: false, music: "none" });
              toast(`Loaded “${bp.label}” (${bp.seconds} s Deooeo H3 blueprint — ready to render).`, "good");
            }}
          />
        )}
        {(!swap || swapIsBfs) && <LoraList family="h3" label={swapIsBfs ? "Extra H3 LoRAs (optional, e.g. MysticXXX)" : "H3 LoRAs"} value={a.loras} onChange={(v) => { if (v.length < a.loras.length) remember(); set({ loras: v }); }} onSweep={sweep} />}
        <Advanced a={a.adv} set={(p) => set({ adv: { ...a.adv, ...p } })} hideCfg>
          <Slider label="Size (megapixels)" min={0.3} max={2.5} step={0.05} value={a.mp} show={`${a.mp.toFixed(2)} MP · ${width}×${height}`} onChange={(v) => set({ mp: Math.round(v * 100) / 100 })} />
          <p className="-mt-2 text-[11.5px] leading-relaxed text-dim">On a 5090: about 2 MP for 8 s, 1.5 MP for 12 s, 1.2 MP for 15 s. Bigger and longer needs more GPU memory — turn on low-memory decode if it runs out.</p>
          <VideoModel />
          {ref && <Seg label="Reference detail" help="refImageSize" value={a.refImageSize} onChange={(v) => set({ refImageSize: v })} options={[{ value: "match", label: "Match (fast)" }, { value: "max", label: "Max (sharper)" }]} />}
          <WriterSetup />
          <SmoothCheck />
          <RealismCheck />
          <RtxCheck />
          <H3CacheCheck />
          <Check checked={a.lowMemDecode} onChange={(v) => set({ lowMemDecode: v })} title="Low-memory decode" sub="If long videos run out of GPU memory" help="lowMem" />
        </Advanced>
        <p className="text-xs leading-relaxed text-dim">The first video of a rental also loads the models (~1–2 min).</p>
      </>}>
      <Feed tab="animate" kinds={["video"]} empty={<><b className="display text-[19px] text-ink">Bring it to life</b><span>Add references on the left (or send them from Prompt), describe what happens above, and press Make video.</span></>}
        extra={({ j }) => {
          const sw = j.meta?.sweep as { name: string; strength: number } | undefined;
          return [
            ...(sw ? [{ label: `Use strength ${sw.strength.toFixed(1)}`, icon: "check", run: () => { set({ loras: a.loras.map((x) => (x.name === sw.name ? { ...x, strength: sw.strength, off: false } : x)) }); toast(`Strength set to ${sw.strength.toFixed(1)}`, "good"); } }] : []),
            ...(j.meta?.preview ? [{ label: "Render Hero (same seed)", icon: "sparkle", primary: true, run: () => redoFull(j) }] : []),
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
/** Long video: the parts in order (what happens, how long), and the run that's going or stopped — Continue picks it up */
function LongPanel({ parts, onChange, run, planning }: { parts: { text: string; seconds: number }[]; onChange: (p: { text: string; seconds: number }[]) => void; run: LongRun | null; planning: boolean }) {
  const upd = (i: number, p: Partial<{ text: string; seconds: number }>) => onChange(parts.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const n = run?.shots.length ?? 0;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="border border-accent/40 bg-accent/[.05] px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
        <b className="text-ink">Long video.</b> H3 makes up to 15 s at a time, so a long video is made in parts. Each part starts from the last moment of the one before
        (its motion, light and sound, not just its last picture), and the parts are joined into one take. Your pictures go into every part, so she stays the same.
        {planning ? " The writer plans each part from your words." : " Your words go in as typed."} To follow a real video instead, use <b className="text-ink">Swap the person</b>: it works through any length.
      </div>
      {parts.map((pt, i) => (
        <div key={i} className="card flex flex-col gap-1.5 rounded-lg border border-line p-2.5">
          <div className="flex items-center justify-between gap-2 text-[12.5px]">
            <b className="text-ink">Part {i + 1}</b>
            <span className="flex items-center gap-2">
              <select value={pt.seconds} onChange={(e) => upd(i, { seconds: Number(e.target.value) })} aria-label={`Part ${i + 1} length`} className="h-7 rounded-sm border border-line bg-raised2 px-1 text-[12px] text-ink">
                {Array.from({ length: 13 }, (_, k) => k + 3).map((s) => <option key={s} value={s}>{s} s</option>)}
              </select>
              {parts.length > 1 && <button onClick={() => onChange(parts.filter((_, j) => j !== i))} className="text-muted hover:text-ink" aria-label={`Remove part ${i + 1}`}>✕</button>}
            </span>
          </div>
          <TextArea value={pt.text} onChange={(v) => upd(i, { text: v })} rows={2} placeholder={i === 0 ? "What happens first — e.g. “she walks into the kitchen and puts the kettle on”" : "What happens next — it carries straight on from the part before"} />
        </div>
      ))}
      <button onClick={() => onChange([...parts, { text: "", seconds: 8 }])} className="press self-start rounded-sm border border-dashed border-line px-3 py-1.5 text-[12.5px] text-ink hover:border-accent">+ Add a part</button>
      {run && (
        <div className="card flex flex-col gap-1.5 rounded-lg border border-line p-2.5 text-[12.5px]">
          <div className="flex items-center justify-between gap-2"><b className="text-ink">{run.title || "Long video"}</b><span className="text-dim">{longSeconds(run.shots)} s · {n} parts</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full bg-accent transition-[width]" style={{ width: `${(Math.min(run.done, n + 1) / (n + 1)) * 100}%` }} /></div>
          <span className="text-muted">{run.status === "done" ? "Joined — it's in the feed." : run.status === "running" ? (run.done >= n ? "Joining the parts…" : `Making part ${run.done + 1} of ${n}…`)
            : run.status === "failed" ? `Stopped at ${run.done >= n ? "the join" : `part ${run.done + 1}`}: ${run.error ?? "failed"}` : `Paused after part ${run.done} of ${n}.`}</span>
          <div className="flex gap-3">
            {run.status === "running" && <button className="text-accent hover:underline" onClick={stopLong}>Stop after this part</button>}
            {(run.status === "failed" || run.status === "stopped") && <button className="text-accent hover:underline" onClick={() => runLong(run)} title="Finished parts aren't made again">Continue from {run.done >= n ? "the join" : `part ${run.done + 1}`}</button>}
            {run.status !== "running" && <button className="text-muted hover:text-ink" onClick={forgetLong}>Clear</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** the types that take references (pictures, clips, sounds) instead of a first frame */
const refsLike = (m: string) => m === "ref" || m === "swap" || m === "long";

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

/** fal's H3 Realism People LoRA on/off (it downloads as its own small group) */
function RealismCheck() {
  const g = useDownloads((st) => st.groups.find((x) => x.id === "hreal"));
  const [off, setOff] = useState(() => { try { return localStorage.getItem(REALISM_KEY) === "off"; } catch { return false; } });
  const pick = (on: boolean) => { try { if (on) localStorage.removeItem(REALISM_KEY); else localStorage.setItem(REALISM_KEY, "off"); } catch { /* private mode */ } setOff(!on); syncKreaTE(); };
  return <Check checked={!off && g?.state === "done"} onChange={pick} title="Realistic skin"
    sub={!g ? "Not in this rental's model list yet — restart it" : g.state !== "done" ? "Its LoRA is still downloading" : "fal's Realism People LoRA: skin keeps its texture instead of smoothing out (not used for anime)"} />;
}

/** RTX upscale of the finished video on/off */
function RtxCheck() {
  const [off, setOff] = useState(() => { try { return localStorage.getItem(RTX_KEY) === "off"; } catch { return false; } });
  const pick = (on: boolean) => { try { if (on) localStorage.removeItem(RTX_KEY); else localStorage.setItem(RTX_KEY, "off"); } catch { /* private mode */ } setOff(!on); syncKreaTE(); };
  const there = rtxInstalled();
  return <Check checked={!off && there !== false} onChange={pick} title="Upscale to 1080p (NVIDIA RTX)"
    sub={there === false ? "Not on this rental (NVIDIA's upscaler didn't install or this card doesn't support it)" : "NVIDIA's video upscaler on the finished frames — a few seconds, not another generation"} />;
}

/** ApplyMiniMaxH3FirstBlockCache speedup toggle (Deooeo's 0.10 / max 2 cache setting — auto-detected when node is installed) */
function H3CacheCheck() {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(H3_CACHE_KEY) === "on"; } catch { return false; } });
  const pick = (v: boolean) => { try { if (v) localStorage.setItem(H3_CACHE_KEY, "on"); else localStorage.removeItem(H3_CACHE_KEY); } catch { /* private mode */ } setOn(v); syncKreaTE(); };
  const there = h3CacheInstalled();
  return <Check checked={on && there !== false} onChange={pick} title="First-Block Cache speedup (Deooeo)"
    sub={there === false ? "ApplyMiniMaxH3FirstBlockCache node isn't installed on this rental" : "Reuses early-block features on 20+ step renders (0.10 / max 2) for faster Hero videos with minimal quality loss"} />;
}

/** 1-click Deooeo-format H3 motion & soundscape blueprint picker (36 timestamped blueprints across 6 categories) */
function H3BlueprintPicker({ onPick }: { onPick: (bp: (typeof H3_BLUEPRINTS)[number]) => void }) {
  const [cat, setCat] = useState<H3MotionCat>("tease");
  const items = H3_BLUEPRINTS.filter((b) => b.cat === cat);
  return (
    <details className="rounded-lg border border-line bg-raised/35 px-3 py-2 text-[12.5px]">
      <summary className="cursor-pointer select-none font-medium text-ink">
        H3 Motion Blueprints <span className="ml-1.5 text-[11px] font-normal text-dim">36 Deooeo-format presets</span>
      </summary>
      <div className="mt-2.5 flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {H3_MOTION_CATS.map((c) => (
            <button key={c.id} type="button" onClick={() => setCat(c.id)}
              className={`press tag-btn !h-7 !px-2 !text-[11.5px] ${cat === c.id ? "on" : ""}`}>{c.label}</button>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          {items.map((bp) => (
            <button key={bp.id} type="button" onClick={() => onPick(bp)} title={bp.hint}
              className="press flex items-center justify-between gap-2 rounded border border-line bg-black/20 px-2.5 py-1.5 text-left text-[12px] hover:border-accent">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">{bp.label}</span>
                <span className="block truncate text-[11px] text-dim">{bp.hint}</span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-accent">{bp.seconds}s</span>
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}
