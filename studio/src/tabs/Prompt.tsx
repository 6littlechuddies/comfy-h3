import { useEffect, useRef, useState } from "react";
import { planWriter, useBigPlanner } from "../lib/packs";
import { buildDescribeVideo, buildPromptHelper, MINOR_FLAG, type PromptOpts } from "../lib/graphs";
import { isAdult, useCharacters, VIEWS, type Character, type View } from "../lib/characters";
import { look } from "../lib/charVideo";
import { viewUrl } from "../lib/api";
import { useShallow } from "zustand/react/shallow";
import { useGroup } from "../lib/downloads";
import { useJobs } from "../lib/jobs";
import { newSeed, useSection, DEFAULTS } from "../lib/settings";
import { normalise, parseTimeline, toPrompt, uid } from "../lib/timeline";
import { makeRef, tagsFor, useWork, type Ref } from "../lib/work";
import { useTray } from "../lib/tray";
import type { MentionTarget } from "../components/Mention";
import { useSettings } from "../lib/settings";
import { usePrimaryAction, useHandoffInto } from "../App";
import { Btn, EtaText, Help, Icon, JobBar, LoraList, PresetBar, Seg, TextArea, TextIn, cx } from "../components/ui";
import { PromptFiles } from "./Scenes";
import { savePackCopy } from "../lib/packs";
import { Chip, GoButton, PromptBar, Workspace } from "../components/Workspace";
import { RefList } from "../components/RefList";
import { Moments, TimelineBar } from "../components/TimelineView";
import { copyText } from "../lib/copy";

const MODE_LABEL = { references: "References", "first-last": "First → last frame", image: "Image → video", text: "Text only" } as const;

function Step({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-accent text-[13px] font-semibold text-accentink">{n}</span>
      <span className="text-[15px] font-semibold">{title}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}

export default function PromptTab() {
  const [p, set] = useSection("prompt");
  const { promptRefs: refs, timeline: t, textOverride, seen } = useWork();
  const setWork = useWork((s) => s.set);
  const run = useJobs((s) => s.run);
  const toast = useJobs((s) => s.toast);
  const jobs = useJobs(useShallow((s) => s.jobs.filter((j) => j.tab === "prompt")));
  const active = jobs.find((j) => j.status === "running" || j.status === "queued");
  const [busy, setBusy] = useState(false);
  const [asText, setAsText] = useState(false);
  const consumed = useRef(new Set<string>());

  useHandoffInto("prompt", (items) => setWork({ promptRefs: [...useWork.getState().promptRefs, ...items.map((i) => makeRef(i.media))] }));

  // when the writer finishes, turn its lines into the timeline; when "Read the clip" finishes, fill the idea box
  useEffect(() => {
    const done = jobs.find((j) => j.status === "done" && !consumed.current.has(j.id));
    if (!done) return;
    consumed.current.add(done.id);
    if (done.meta?.kind === "describe") {
      const txt = (done.texts.seen ?? "").trim();
      if (!txt) { toast("The model didn't say anything about the clip — try again, or trim it to the important part.", "bad", "prompt"); return; }
      if (txt.includes(MINOR_FLAG)) { toast("Stopped: someone in that clip may be under 18. Use a clip with adults only.", "bad", "prompt"); return; }
      const lead = (done.meta.lead as string) || "";
      set({ idea: `${lead}${txt}` });
      toast("Filled in from the clip — change anything you like, then press Write.", "good", "prompt");
      return;
    }
    const raw = done.texts.timeline ?? "";
    const seenTexts = Object.fromEntries(Object.entries(done.texts).filter(([k]) => k.startsWith("seen:")).map(([k, v]) => [k.slice(5), v]));
    if (Object.values(seenTexts).some((v) => v.includes(MINOR_FLAG))) {
      toast("Stopped: someone in a reference clip may be under 18. Use clips with adults only.", "bad", "prompt");
      return;
    }
    const parsed = parseTimeline(raw, (done.meta?.seconds as number) ?? p.seconds);
    if (!parsed.cuts.some((c) => c.text)) {
      toast("The writer didn't use the cut format — its whole text is kept as one cut. Edit it, or press Rewrite.", "info", "prompt");
      parsed.cuts = [{ id: uid(), start: 0, end: p.seconds, shot: "", text: raw.trim() }];
    }
    setWork({ timeline: { ...parsed, style: p.style }, textOverride: null, seen: seenTexts });
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  const aLoras = useSettings((s) => s.s.animate.loras);
  const tags = tagsFor(refs);
  const dl = useGroup("writer");
  const chars = useCharacters((s) => s.list);
  const videos = refs.filter((r) => r.media.kind === "video");
  const inUse = charactersIn(refs, tags, chars);
  const writing = jobs.some((j) => (j.status === "running" || j.status === "queued") && j.meta?.kind !== "describe");
  const reading = jobs.some((j) => (j.status === "running" || j.status === "queued") && j.meta?.kind === "describe");
  const shortClip = videos.some((r) => r.end - r.start < 2);
  const why = !dl.ready ? dl.why
    : !p.idea.trim() && !videos.length ? "Describe what should happen (step 2), or add a clip to copy"
    : shortClip ? "Reference clips must be at least 2 s — drag the trim handles apart"
    : busy || writing ? "Already writing…" : undefined;
  const readWhy = !dl.ready ? dl.why : !videos.length ? "Add a clip first" : shortClip ? "Reference clips must be at least 2 s" : reading ? "Already reading the clip…" : undefined;
  const etaKey = `prompt:${videos.length}v`;
  const readClip = async () => {
    if (readWhy) return;
    const v = videos[0];
    const people = refs.some((r) => r.media.kind === "image");
    const who = inUse.length ? inUse.map((c) => `${c.name} (${c.tags.join(", ")})`).join(" and ") : refs.filter((r) => r.media.kind === "image").map((r) => tags[r.id]).join(" and ");
    const lead = people ? `${who} recreates ${tags[v.id]} — same moves, timing and camera. What happens: ` : `Recreate ${tags[v.id]}. What happens: `;
    try {
      await run("prompt", "Reading the clip", buildDescribeVideo({ file: v.media.name, start: v.start, end: v.end }, newSeed(), people ? "motion" : "full"), "prompt:read", { kind: "describe", lead });
    } catch (e) { toast(`Couldn't start: ${(e as Error).message}`, "bad"); }
  };
  const write = async () => {
    if (why) return;
    setBusy(true);
    try {
      const pw = await planWriter(p.guide, DEFAULTS.prompt.guide, useBigPlanner());
      const graph = buildPromptHelper({
        pictures: refs.filter((r) => r.media.kind === "image").map((r) => ({ file: r.media.name, tag: tags[r.id], label: r.label })),
        videos: refs.filter((r) => r.media.kind === "video").map((r) => ({ file: r.media.name, tag: tags[r.id], label: r.label, start: r.start, end: r.end, useSound: r.useSound })),
        audios: refs.filter((r) => r.media.kind === "audio").map((r) => ({ tag: tags[r.id], label: r.label })),
        characters: inUse, idea: p.idea, seconds: p.seconds, cuts: p.cuts, camera: p.camera, mode: MODE_LABEL[p.mode], guide: pw.guide, writer: pw.writer, seed: newSeed(),
      });
      await run("prompt", "Writing the timeline", graph, etaKey, { seconds: p.seconds });
    } catch (e) { toast(`Couldn't start: ${(e as Error).message}`, "bad"); } finally { setBusy(false); }
  };
  usePrimaryAction("prompt", write);

  const finalText = textOverride ?? (t ? toPrompt(t) : "");
  // already sent to Animate and not changed there: keep Animate's prompt in step with what you change here (✕ a sound, a line…)
  useEffect(() => {
    const sent = useWork.getState().sentPlan;
    if (sent == null || !finalText || sent === finalText) return;
    if (useSettings.getState().s.animate.prompt === sent) { useSettings.getState().set("animate", { prompt: finalText }); setWork({ sentPlan: finalText }); }
  }, [finalText]); // eslint-disable-line react-hooks/exhaustive-deps
  const sendToAnimate = () => {
    const mode = p.mode === "references" ? "ref" : p.mode === "first-last" ? "fl" : p.mode === "image" ? "i2v" : "ref";
    setWork({ animateRefs: refs.map((r) => ({ ...r })) });
    useSettings.getState().set("animate", { prompt: finalText, seconds: p.seconds, mode });
    setWork({ sentPlan: finalText });
    useSettings.getState().setTab("animate");
    toast("Sent to Animate: references, timeline and length.", "good");
  };

  const chips = (
    <>
      <Chip title="Video type" value={p.mode} onChange={(v) => set({ mode: v })} options={(Object.keys(MODE_LABEL) as (keyof typeof MODE_LABEL)[]).map((k) => ({ value: k, label: MODE_LABEL[k] }))} />
      <Chip title="Length" value={p.seconds} onChange={(v) => set({ seconds: v })} options={Array.from({ length: 14 }, (_, i) => i + 2).map((n) => ({ value: n, label: `${n} s` }))} />
      <Chip title="Cuts" value={p.cuts} onChange={(v) => set({ cuts: v })} options={[{ value: 0, label: "Auto cuts" }, ...[1, 2, 3, 4].map((n) => ({ value: n, label: `${n} cut${n > 1 ? "s" : ""}` }))]} />
      <Chip title="Camera" value={p.camera} onChange={(v) => set({ camera: v })} options={[{ value: "auto", label: "Camera: auto" }, { value: "still", label: "Still camera" }, { value: "slow push in", label: "Push in" }, { value: "orbit", label: "Orbit" }, { value: "handheld", label: "Handheld" }]} />
      <span className="ml-1 text-[11px] text-dim">{refs.length ? `${refs.length} reference${refs.length > 1 ? "s" : ""}` : "no references yet — add them on the left"}</span>
    </>
  );
  // @ in the box: characters and pictures join the references (the writer names them as <Picture n>)
  const mention: MentionTarget = {
    hint: { character: "their pictures join the references", picture: "joins the references" },
    pick: async (pk) => {
      const cur = useWork.getState().promptRefs;
      if (pk.kind === "character") { setWork({ promptRefs: await withCharacter(pk.c, cur) }); return pk.c.name; }
      const md = await useTray.getState().asMedia(pk.item.id);
      if (!cur.some((r) => r.media.name === md.name)) setWork({ promptRefs: [...cur, makeRef(md)] });
      return "";
    },
  };
  return (
    <Workspace needs={"writer"} tab="prompt" title="Prompt helper" sub="Plans every second for H3"
      bar={
        <div className="relative">
          <PromptBar value={p.idea} onChange={(v) => set({ idea: v })} chips={chips} minRows={2} rewrite="prompt" mention={mention}
            placeholder={videos.length ? "Optional with a clip — leave empty to recreate the clip, press “Read the clip” to have it written for you, or add changes (e.g. “on a rainy neon street, she winks at the end”)." : "What happens? e.g. “She dances like the clip on the rainy street. Around 6 seconds she stops, looks at the camera and says my voice line.”"}
            action={<>{videos.length > 0 && <Btn small onClick={readClip} disabled={!!readWhy} why={readWhy} title="The local model watches the clip and writes what happens into this box"><Icon name="film" size={14} /> Read the clip</Btn>}<Talk onText={(txt) => set({ idea: (useSettings.getState().s.prompt.idea + " " + txt).trim() })} />
              <GoButton onClick={write} disabled={!!why} why={why}>{t ? "Write again" : "Write timeline"} <EtaText k={etaKey} prefix="· " /></GoButton></>} />
        </div>}
      drawer={<>
        <PresetBar section="prompt" />
        <div className="flex flex-col gap-2">
          <Step n={1} title="Who and what's in it" sub="optional" />
          <CharacterPicker refs={refs} onChange={(r) => setWork({ promptRefs: r })} />
          <RefList refs={refs} onChange={(r) => setWork({ promptRefs: r })} />
          <p className="text-[11.5px] leading-relaxed text-dim">Add a clip (mp4, mov, webm) to copy its moves and camera. With a clip, step 2 is optional.</p>
        </div>
        <LoraList family="h3" label="H3 LoRAs (shared with Animate)" value={aLoras} onChange={(v) => useSettings.getState().set("animate", { loras: v })} />
        <TextIn label="Look / style line (optional)" value={p.style} onChange={(v) => set({ style: v })} placeholder="e.g. anime style, soft neon lighting, film grain" />
        <WriterSetup />
      </>}>
      <div className="flex flex-col gap-3.5 pt-1">

        {active && <div className="rounded-xl border border-line bg-raised/60 p-3"><JobBar job={active} /></div>}
        {!t && !active && (
          <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-line p-10 text-center text-[13px] text-muted">
            <b className="mb-1 text-ink">No timeline yet</b>
            Add your references and idea on the left, then press Write. The local writer model looks at your pictures and clips and plans every second.
            <Btn className="mt-4" onClick={() => setWork({ timeline: normalise({ cuts: [], says: [], sounds: [], style: p.style }, p.seconds), textOverride: null })}>Or start an empty timeline by hand</Btn>
          </div>
        )}
        {t && (
          <>
            <TimelineBar t={t} seconds={p.seconds} onChange={(nt) => setWork({ timeline: nt, textOverride: null })} />
            {Object.keys(seen).length > 0 && (
              <details className="rounded-lg border border-line bg-raised/50 px-3 py-2 text-[13px]">
                <summary className="cursor-pointer text-muted">What it saw in your clips</summary>
                {Object.entries(seen).map(([k, v]) => <p key={k} className="mt-2 leading-relaxed"><span className="font-mono text-accent">{k}</span> {v}</p>)}
              </details>
            )}
            {asText ? (
              <TextArea rows={12} mono value={finalText} onChange={(v) => setWork({ textOverride: v })}
                right={textOverride != null && <button className="text-xs text-muted underline hover:text-ink" onClick={() => setWork({ textOverride: null })}>undo my text edits</button>} />
            ) : (
              <Moments t={t} seconds={p.seconds} onChange={(nt) => setWork({ timeline: nt, textOverride: null })} />
            )}
            {textOverride != null && !asText && <p className="text-xs text-accent">You edited the plain text — that version will be sent. <button className="underline" onClick={() => setWork({ textOverride: null })}>Use the timeline instead</button></p>}
            <div className="mt-auto flex items-center gap-2">
              <Btn onClick={write} disabled={!!why} why={why}><Icon name="refresh" size={14} /> Rewrite</Btn>
              <Btn onClick={() => setAsText((v) => !v)}>{asText ? "Show as timeline" : "Show as plain text"}</Btn>
              <Btn onClick={() => { copyText(finalText, "Prompt copied"); }}>Copy</Btn>
              <Btn kind="primary" className="ml-auto px-6" onClick={sendToAnimate}>Send to Animate <Icon name="arrow" size={16} /></Btn>
            </div>
          </>
        )}
      </div>
    </Workspace>
  );
}

/** dictation with the browser's speech recognition (needs the https link) */
function Talk({ onText }: { onText: (t: string) => void }) {
  const [on, setOn] = useState(false);
  const rec = useRef<any>(null);
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const ok = window.isSecureContext && !!SR;
  const why = !window.isSecureContext ? "The microphone only works on the secure https link — use the Secure link button in the top bar." : !SR ? "This browser can't do speech-to-text — try Chrome or Edge." : "";
  const toggle = () => {
    if (!ok) return;
    if (on) { rec.current?.stop(); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = false; r.lang = navigator.language || "en-US";
    r.onresult = (e: any) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript); };
    r.onend = () => setOn(false);
    r.onerror = () => setOn(false);
    rec.current = r; r.start(); setOn(true);
  };
  return (
    <span className="flex items-center">
      <Btn small onClick={toggle} disabled={!ok} why={why} className={cx(on && "!border-bad !text-bad")}><Icon name="mic" size={14} /> {on ? "Stop" : "Talk"}</Btn>
      {ok && <Help text="Uses your browser's built-in speech-to-text. In Chrome this sends your voice to Google to transcribe it." />}
    </span>
  );
}

/** the saved characters among the references, with the <Picture n> tags of their views */
export function charactersIn(refs: Ref[], tags: Record<string, string>, list: Character[]): NonNullable<PromptOpts["characters"]> {
  const out: NonNullable<PromptOpts["characters"]> = [];
  for (const c of list) {
    const mine = refs.filter((r) => r.charId === c.id && r.media.kind === "image");
    if (mine.length) out.push({ name: c.name, look: look(c), tags: mine.map((r) => tags[r.id]) });
  }
  return out;
}

const FEW: View[] = ["front", "face"];
// every angle of the sheet (no cut-out / one-picture sheet) — H3 takes up to 9 pictures in all
const ALL: View[] = ["front", "face", "threeq", "left", "right", "back", "smile", "angry", "surprised"];
const viewName = (v: View) => VIEWS.find((x) => x.id === v)?.label.toLowerCase() ?? v;
/** the references with this character's pictures added in front (they become <Picture 1>, <Picture 2>…); H3 takes 9 at most */
export async function withCharacter(c: Character, refs: Ref[], every = charEvery()): Promise<Ref[]> {
  if (refs.some((r) => r.charId === c.id)) return refs;
  const room = 9 - refs.filter((r) => r.media.kind === "image").length;
  const views = (every ? ALL : FEW).filter((v) => c.views[v]).slice(0, Math.max(0, room));
  if (!views.length) throw new Error("H3 takes at most 9 pictures — remove one first");
  const st = useCharacters.getState();
  const media = await Promise.all(views.map((v) => st.asMedia(c.id, v)));
  const add = media.flatMap((m, i) => (m ? [{ ...makeRef(m), label: `${c.name} — ${views[i] === "front" ? "full body" : viewName(views[i])}`, charId: c.id }] : []));
  const firstOther = refs.findIndex((r) => !r.charId);
  const next = [...refs];
  next.splice(firstOther < 0 ? next.length : firstOther, 0, ...add);
  const total = (every ? ALL : FEW).filter((v) => c.views[v]).length;
  if (add.length < total) useJobs.getState().toast(`Added ${add.length} of ${c.name}'s ${total} pictures — H3 takes 9 pictures at most`, "info");
  return next;
}
const charEvery = () => { try { return localStorage.getItem("h3.charviews") !== "few"; } catch { return true; } };

/** pick a saved character: its pictures go in as references, named and described for the writer.
 *  "Every angle" sends the whole reference sheet (front, face, sides, back…) instead of just the front and face. */
export function CharacterPicker({ refs, onChange }: { refs: Ref[]; onChange: (r: Ref[]) => void }) {
  const list = useCharacters((s) => s.list).filter((c) => isAdult(c) && c.views.front);
  const toast = useJobs((s) => s.toast);
  const [adding, setAdding] = useState<string | null>(null);
  const [every, setEvery] = useState(() => { try { return localStorage.getItem("h3.charviews") !== "few"; } catch { return true; } });
  const pickEvery = (v: boolean) => { setEvery(v); try { localStorage.setItem("h3.charviews", v ? "all" : "few"); } catch { /* */ } };
  const [shown, setShown] = useState(() => { try { return localStorage.getItem("h3.charpicker") !== "closed"; } catch { return true; } });
  const show = (v: boolean) => { setShown(v); try { localStorage.setItem("h3.charpicker", v ? "open" : "closed"); } catch { /* */ } };
  const has = (id: string) => refs.some((r) => r.charId === id);
  const toggle = async (c: Character) => {
    if (has(c.id)) { onChange(refs.filter((r) => r.charId !== c.id)); return; }
    setAdding(c.id);
    try { onChange(await withCharacter(c, refs, every)); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setAdding(null); }
  };
  if (!list.length) return (
    <p className="text-[12px] text-muted">No saved characters with a front picture yet. <button className="text-accent hover:underline" onClick={() => useSettings.getState().setTab("characters")}>Make one in Characters</button> to keep the same person in every cut.</p>
  );
  const added = list.filter((c) => has(c.id));
  if (!shown) return (
    <button onClick={() => show(true)} className="flex items-center gap-2 text-left text-[12.5px] text-muted hover:text-ink">
      ▸ Characters {added.length ? <span className="text-ink">· {added.map((c) => c.name).join(", ")}</span> : <span className="text-dim">· none added</span>}
    </button>
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between"><button onClick={() => show(false)} className="text-[12.5px] text-muted hover:text-ink">▾ Characters</button>
        <span className="flex gap-1 text-[11.5px]">{[[true, "Every angle"], [false, "Front + face"]].map(([v, l]) => (
          <button key={String(v)} onClick={() => pickEvery(v as boolean)} className={cx("press rounded-sm px-1.5 py-0.5", every === v ? "bg-accent/15 text-accent" : "text-muted hover:text-ink")}>{l as string}</button>))}</span></div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {list.map((c) => {
          const on = has(c.id);
          const pic = c.views.face || c.views.front!;
          return (
            <button key={c.id} onClick={() => toggle(c)} disabled={adding === c.id} aria-pressed={on} title={on ? `Remove ${c.name}` : `Add ${c.name}: ${every ? "every angle of the sheet" : "full body + face"}`}
              className={cx("press group relative flex w-[72px] shrink-0 flex-col items-stretch gap-1 rounded-sm border p-1 text-left transition-colors", on ? "border-accent bg-accent/10" : "border-line hover:border-muted")}>
              <span className="checker block h-[78px] overflow-hidden rounded-[2px]"><img src={viewUrl(pic)} alt="" className="h-full w-full object-cover" /></span>
              <span className="truncate px-0.5 text-[11.5px]">{adding === c.id ? "Adding…" : c.name}</span>
              {on && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-[2px] bg-accent text-accentink"><Icon name="check" size={11} /></span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** which model plans videos, and the prompt file it follows — shared by Plan a video and Animate */
export function WriterSetup() {
  const [p, set] = useSection("prompt");
  const toast = useJobs((s) => s.toast);
  const xl = useGroup("writer_xl");
  const custom = !!p.guide.trim() && p.guide.trim() !== DEFAULTS.prompt.guide.trim();
  const saveMine = async () => {
    try {
      await savePackCopy({ name: "My video plan instructions", text: p.guide, stage: "plan" });
      set({ guide: DEFAULTS.prompt.guide });
      toast("Saved as a prompt file and switched to it — edit it here or in Scenes → Prompt files.", "good");
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  return (
    <div className="flex flex-col gap-2 border border-line bg-raised/40 p-3">
      <span className="lbl">Video plan writer</span>
      <p className="text-[12.5px] text-ink">Qwen3.8 27B</p>
      {!xl.ready && <p className="-mt-1 text-[11.5px] text-hot">The 27B isn't in yet ({xl.why}) — Fable 9B writes until it is.</p>}
      <span className="text-[12.5px] text-muted">Instructions (prompt file)</span>
      {custom ? (
        <p className="text-[12px] leading-relaxed text-hot">Your own instructions from the old “Writer instructions” box are still in use.
          <button className="ml-1 text-accent underline" onClick={saveMine}>Save them as a prompt file</button> (then they're editable in one place) or
          <button className="ml-1 text-muted underline" onClick={() => set({ guide: DEFAULTS.prompt.guide })}>drop them</button>.</p>
      ) : <PromptFiles only="plan" />}
    </div>
  );
}
