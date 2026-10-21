import { useEffect, useRef, useState } from "react";
import { viewUrl } from "../lib/api";
import { buildEdit, EDIT_ENGINES, type EditEngine } from "../lib/graphs";
import { useShallow } from "zustand/react/shallow";
import { editGroup, useDownloads, useGroup } from "../lib/downloads";
import { useJobs, type Job, type Output } from "../lib/jobs";
import { EDIT_TO_CREATE, TEMPLATES, editArgs, editCheckpoint, editKeys, newSeed, seedFor, useSection, useSettings } from "../lib/settings";
import { CheckpointPicker } from "../components/Checkpoint";
import { trayIdOf, useTray, type Media } from "../lib/tray";
import type { MentionTarget } from "../components/Mention";
import { sendTo, usePrimaryAction, useHandoffInto } from "../App";
import { useCharacters } from "../lib/characters";
import { registerPics, remember } from "../lib/promptHistory";
import { mergeLoras } from "../lib/make";
import { balanceLoras, BUDGET } from "../lib/loraBalance";
import { loraLibrary } from "../lib/api";
import "../lib/faceDetail";
import { FaceFix } from "../components/FaceFix";
import { KreaEditModel } from "../components/KreaEditModel";
import { LikenessCard } from "../components/Likeness";
import { SelectWords } from "../components/SelectWords";
import { Advanced, LoraList, Btn, Check, EtaText, H1, Icon, Label, Panel, PresetBar, Seg, Slider, Slot, TextArea, TextIn, cx } from "../components/ui";
import { Chip, GoButton, PromptBar, Workspace } from "../components/Workspace";
import { Feed } from "../components/Feed";
import { useRemix } from "../lib/remix";
import { Painter } from "../components/Painter";
import { EditChat } from "../components/EditChat";
import type { InputFile } from "../lib/api";
import { PicturePicker } from "../components/PicturePicker";
import { pickFromCivitai } from "../components/ImageImport";
import { useEditPick } from "../lib/editPick";

/** words that ask for something to be taken out of the painted area */
const REMOVE_WORDS = /\b(remove|erase|delete|get rid of|take out|take away|clear away|clean up|without)\b/i;

/** Edit: the chat (one message at a time on the latest picture) or the classic picture slots + instruction */
export default function EditTab() {
  const chat = useSettings((st) => !!st.s.edit.chat);
  return chat ? <EditChat /> : <ClassicEdit />;
}

/** each character project keeps its own Edit pictures and words (remembered in this browser) */
type EditDesk = { pics: (Media | null)[]; instruction: string; place?: Media | null };
const editDeskKey = (p: string | null) => `h3.editdesk.${p ?? "free"}`;
const loadEditDesk = (p: string | null): EditDesk | null => { try { return JSON.parse(localStorage.getItem(editDeskKey(p)) || "null"); } catch { return null; } };
const saveEditDesk = (p: string | null, d: EditDesk) => { try { localStorage.setItem(editDeskKey(p), JSON.stringify(d)); } catch { /* private mode */ } };

function ClassicEdit() {
  const [e, set] = useSection("edit");
  const project = useCharacters((st) => st.sel ?? null);
  const [pics, setPics] = useState<(Media | null)[]>(() => loadEditDesk(useCharacters.getState().sel ?? null)?.pics ?? [null, null]);
  const run = useJobs((s) => s.run);
  const toast = useJobs((s) => s.toast);
  const jobs = useJobs(useShallow((s) => s.jobs.filter((j) => j.tab === "edit")));
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState<{ before: string; after: string } | null>(null);
  const [mask, setMask] = useState<(InputFile & { url: string; from?: "words"; box?: { x: number; y: number; width: number; height: number; W: number; H: number } }) | null>(null);
  const [painting, setPainting] = useState(false);
  // the place: a background picture (room, street, beach…) the result should be set in — like Create's third box
  const [place, setPlace] = useState<Media | null>(() => loadEditDesk(useCharacters.getState().sel ?? null)?.place ?? null);
  const [soft, setSoft] = useState(12);

  // switching project: put this one's pictures and words away, bring the other project's back — nothing carries over
  const deskOf = useRef<string | null>(project);
  const live = useRef<EditDesk>({ pics, instruction: e.instruction, place });
  live.current = { pics, instruction: e.instruction, place };
  useEffect(() => {
    if (deskOf.current === project) return;
    saveEditDesk(deskOf.current, live.current);
    const d = loadEditDesk(project);
    setPics(d?.pics ?? [null, null]); setPlace(d?.place ?? null); setMask(null);
    set({ instruction: d?.instruction ?? "" });
    deskOf.current = project;
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => saveEditDesk(project, { pics, instruction: e.instruction, place }), 400); return () => clearTimeout(t); }, [pics, e.instruction, place, project]);

  // a picture picked for one of these boxes from CivitAI
  const picked = useEditPick((st) => st.pending);
  useEffect(() => {
    if (!picked.length) return;
    useEditPick.setState({ pending: [] });
    for (const { media, slot } of picked) {
      if (slot === "place") { setPlace(media); continue; }
      const i = Number(slot) - 1;
      if (i === 0) setMask(null);
      setPics((cur) => { const n = [...cur]; while (n.length <= i) n.push(null); n[i] = media; return n; });
    }
  }, [picked]);

  // the prompt history groups your instructions by the pictures they went with (and can put those back)
  const picsNow = useRef({ pics, place }); picsNow.current = { pics, place };
  useEffect(() => registerPics("edit", () => [...picsNow.current.pics.map((m, i) => (m ? { name: m.name, url: m.url, label: m.label, slot: String(i + 1) } : null)), picsNow.current.place ? { ...picsNow.current.place, slot: "place" } : null].filter(Boolean).map((m) => ({ name: m!.name, url: m!.url, label: m!.label, slot: m!.slot })),
    (hp) => {
      const asM = (slot: string) => { const p = hp.find((x) => x.slot === slot); return p ? ({ kind: "image", name: p.name, url: p.url, label: p.label ?? p.name } as Media) : null; };
      setMask(null); setPics([asM("1"), asM("2")]); setPlace(asM("place"));
    }), []);

  const pending = useRemix((s) => s.pending);
  useEffect(() => {
    if (pending?.tab !== "edit" || !pending.snap.media) return;
    const m = pending.snap.media as { pics?: (Media | null)[]; mask?: typeof mask };
    if (m.pics) setPics(m.pics);
    setMask(m.mask ?? null);
    useRemix.setState({ pending: null });
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  useHandoffInto("edit", (items) => {
    // a picture made in Create: edit it with the same kind of model (anime stays anime, with Create's checkpoint)
    const from = items.map((x) => `${x.media.trayId ?? ""} ${x.media.url}`).join(" ");
    const cs = useSettings.getState().s.create;
    const want: EditEngine | null = /studio(?:%2F|\/)create(?:%2F|\/)anime/i.test(from) ? (cs.animeModel === "noob" ? "noob" : "anima") : /studio(?:%2F|\/)create(?:%2F|\/)realistic/i.test(from) ? "krea" : null;
    if (want && want !== (useSettings.getState().s.edit.engine ?? "krea")) { setEngine(want); useJobs.getState().toast(`Editing with ${EDIT_ENGINES.find((x) => x.value === want)!.label}, like the picture was made`, "info"); }
    setPics((cur) => {
    const next = [...cur];
    for (const { media, slot } of items) {
      // "Use in Edit · Picture 2" → that slot; otherwise the first empty one
      if (slot === "place") { setPlace(media); continue; }
      if (slot === "brush") { next[0] = media; setMask(null); setTimeout(() => setPainting(true), 50); continue; }
      const want = slot && /^\d$/.test(slot) ? Number(slot) - 1 : -1;
      if (want >= 0) { while (next.length <= want) next.push(null); next[want] = media; if (want === 0) setMask(null); continue; }
      const i = next.findIndex((p) => !p);
      if (i >= 0) next[i] = media; else if (next.length < 4) next.push(media); else next[0] = media;
    }
    return next;
  });
  });

  // identity card: with a character picked (and "use automatically" on), copying a pose or putting someone in a scene gets
  // their picture as picture 2 — once per picture 1, so clearing it sticks
  const selChar = useCharacters((st) => st.list.find((x) => x.id === st.sel) ?? null);
  const autoFor = useRef<string | null>(null);
  const autoPic2 = useRef<string | null>(null); // the picture 2 we filled in: their LoRAs come along with it
  useEffect(() => {
    const p1 = pics[0];
    if (!p1 || pics[1] || !selChar?.views.front || selChar.identity?.auto === false) return;
    if ((e.engine ?? "krea") !== "krea" || e.mode === "free" || autoFor.current === p1.name) return;
    autoFor.current = p1.name;
    useCharacters.getState().asMedia(selChar.id, "front").then((m) => {
      if (!m) return;
      autoPic2.current = m.name;
      setPics((p) => (p[1] ? p : [p[0], m, ...p.slice(2)]));
      toast(`Picture 2: ${selChar.name} (their identity card) — clear it to edit without them`, "info");
    }).catch(() => {});
  }, [pics[0]?.name, e.mode, e.engine, selChar?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const engine: EditEngine = e.engine ?? "krea";
  const createS = useSettings((st) => st.s.create);
  const info = EDIT_ENGINES.find((x) => x.value === engine)!;
  const keys = editKeys(engine);
  const anime = engine === "anima" || engine === "noob";
  useDownloads((s) => s.groups); // re-check which group to wait for as downloads arrive
  const need = editGroup(engine);
  const dl = useGroup(need);
  const filled = (pics.filter(Boolean) as Media[]).slice(0, info.maxImages);
  // a painted area is a fix: only picture 1, built on what's there (picture 2 only when your words ask for it)
  const brushFix = !!mask && engine === "krea";
  const usesPic2 = /\b(picture|image|pic)\s*2\b|\bsecond (picture|image)\b|@/i.test(e.instruction);
  const why = place && engine === "krea" && !filled.length ? "Add Picture 1 — the person or picture that goes into the place" : !dl.ready ? dl.why : (!filled.length ? "Add at least one picture (Picture 1)" : !e.instruction.trim() && !brushFix ? (anime ? "Describe how the result should look" : "Write what you want changed") : busy ? "Sending…" : undefined);
  const etaKey = `edit:${engine}:${filled.length}:raw`;
  // an instruction saved from the old Qwen editor ("image 1 / image 2" wording) becomes the Krea 2 version
  useEffect(() => {
    const old: Record<string, "pose" | "scene"> = {
      "Make the person in image 1 copy the exact pose of the person in image 2. Keep their face, hair, outfit and the background of image 1 exactly the same.": "pose",
      "Place the person from image 1 into the scene of image 2. Keep their face, hair and outfit exactly the same, and match the lighting and colours of image 2.": "scene",
    };
    const k = old[e.instruction];
    if (k && engine === "krea") set({ instruction: TEMPLATES("krea")[k] });
  }, [engine]); // eslint-disable-line react-hooks/exhaustive-deps
  /** switch engine; a ready-made instruction follows along (your own words are kept) */
  const setEngine = (v: EditEngine) => {
    const was = Object.values(TEMPLATES(engine)).includes(e.instruction) || !e.instruction.trim();
    const anyNew = v === "anima" || v === "noob";
    set({ engine: v, ...(anyNew ? { mode: "free" as const } : {}), ...(was ? { instruction: TEMPLATES(v)[anyNew ? "free" : e.mode] } : {}) });
    if ((pics.filter(Boolean).length) > EDIT_ENGINES.find((x) => x.value === v)!.maxImages) toast(`${EDIT_ENGINES.find((x) => x.value === v)!.label} uses ${EDIT_ENGINES.find((x) => x.value === v)!.maxImages === 1 ? "only Picture 1" : `the first ${EDIT_ENGINES.find((x) => x.value === v)!.maxImages} pictures`}`, "info");
  };
  const go = async () => {
    if (why) return;
    remember("edit", e.instruction, "sent");
    setBusy(true);
    try {
      // with a place picture: three pictures are more than Krea 2 Edit takes, so it goes to Edit chat (Qwen takes all three,
      // then Krea 2 repaints with the character's LoRA and the face pass) — the same way Create does it
      if (place && engine === "krea") { await editWithPlace(filled, place, e.instruction); return; }
      for (let i = 0; i < e.count; i++) {
        const a = e[keys.adv];
        const seed = i === 0 ? seedFor(a, (p) => set({ [keys.adv]: { ...a, ...p } } as Partial<typeof e>)) : newSeed();
        const ck = editCheckpoint(e, useSettings.getState().s.create, engine).own;
        // their LoRAs too (realistic characters, Krea 2), when picture 2 is them — balanced so the stack doesn't smear
        const ident = selChar && selChar.identity?.auto !== false && selChar.style === "realistic" && engine === "krea" && e.mode !== "free" && filled[1]?.name === autoPic2.current;
        const loras = ident ? balanceLoras(mergeLoras(editArgs(e).loras, selChar!.loras ?? []), await loraLibrary().catch(() => []), BUDGET.kreaEdit).loras : editArgs(e).loras;
        const words = e.instruction.trim();
        // "remove the man", "erase the cup", "get rid of the logo": the painted area is blanked out first (see fillMask) and fully
        // redrawn — the edit model copies whatever its reference shows, so it can't remove something it can still see
        const removing = brushFix && REMOVE_WORDS.test(words);
        const instruction = removing
          ? `The blurred patch in this picture is empty space where ${words.replace(REMOVE_WORDS, "").replace(/^\s*(the|a|an|that|this)\s+/i, "").trim() || "something"} was taken out. Fill it with exactly what is behind it — continue the background, wall, floor, furniture, sky or scenery around it, with the same light, perspective, grain and texture — so nothing is there and nothing looks edited. Everything outside the patch stays exactly as it is.`
          : brushFix
          ? `${words || "Fix what looks wrong here — anatomy, fingers, artifacts — so it looks natural"}. Change only that; everything else stays exactly as it is. It must blend in seamlessly with the rest of the picture: the same skin tone, light, grain and texture.`
          : e.instruction;
        const images = brushFix && !usesPic2 ? filled.slice(0, 1) : filled;
        const graph = buildEdit({ ...editArgs(e), loras, ...(ck ? (engine === "noob" ? { ckpt: ck } : { unet: ck }) : {}), seed, images: images.map((m) => m.name), instruction, negative: e.negative, resolution: e.resolution, prefix: "studio/edit/edit",
          ...(mask && pics[0] ? { mask: mask.name, maskSoftness: soft, ...(engine === "krea" ? regionFor(mask.box) : {}), ...(removing ? { fillMask: true, refBoost: 1 } : brushFix ? { denoise: e.brushStrength ?? 0.7 } : {}) } : {}) });
        await run("edit", `Edit${e.count > 1 ? ` ${i + 1}/${e.count}` : ""}: ${e.instruction.slice(0, 40)}${e.instruction.length > 40 ? "…" : ""}`, graph, etaKey,
          { before: filled[0].url, ...(e.faceFix ? { faceFix: { character: null, strength: e.faceStrength ?? 0.45 } } : {}), snapshot: { section: "edit", settings: { ...e, [keys.adv]: { ...a, seed, lockSeed: true } }, media: { pics, mask } } });
      }
    } catch (err) { toast(`Couldn't start: ${(err as Error).message}`, "bad"); } finally { setBusy(false); }
  };
  usePrimaryAction("edit", go);
  const goRef = useRef(go); goRef.current = go;

  const names = engine === "krea"
    ? e.mode === "pose" ? ["1 · the pose", "2 · your character"] : e.mode === "scene" ? ["1 · the scene", "2 · your character"] : ["1 · your picture", "2 · reference"]
    : anime ? ["1 · the picture to redraw"]
    : ["1 · your picture"];
  const slots = pics.slice(0, info.maxImages);

  const chips = (
    <>
      <Chip title="Model" value={engine} onChange={setEngine} options={EDIT_ENGINES.map((x) => ({ value: x.value, label: x.label }))} />
      <button onClick={() => set({ chat: true })} title="Change the picture one message at a time — name pictures with @, fix one part, swap the background, put your character in"
        className="press inline-flex h-8 items-center gap-1.5 rounded-sm border border-accent/60 bg-accent/10 px-3 text-[12.5px] font-medium text-ink hover:bg-accent/20"><Icon name="chat" size={13} />Edit chat</button>
      {!anime && <Chip title="What you're doing" value={e.mode} onChange={(v) => set({ mode: v, instruction: v === "free" ? e.instruction : TEMPLATES(engine)[v] })}
        options={[{ value: "pose", label: "Copy the pose" }, { value: "scene", label: "Put in the scene" }, { value: "free", label: "Free edit" }]} />}
      <Chip title="How many" value={e.count} onChange={(v) => set({ count: v })} options={[1, 2, 3, 4].map((n) => ({ value: n, label: `×${n}` }))} />
      {pics[0] && <span className={cx("inline-flex h-8 items-stretch overflow-hidden rounded-sm border text-[12.5px] font-medium", mask ? "border-bad/70 bg-bad/10 text-ink" : "border-line bg-raised2/70 text-ink")}>
        <button onClick={() => setPainting(true)} className="press inline-flex items-center gap-1.5 px-3 hover:bg-hover" title={mask ? "Change the painted area" : "Paint the part to change — only that part is redrawn"}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M18 2l4 4-12 12H6v-4z" /><path d="M3 22h6" /></svg>{mask ? "Painted area ✓" : "Paint area"}</button>
        {mask && <button onClick={() => setMask(null)} aria-label="Remove the painted area" title="Remove the painted area — edit the whole picture again" className="press border-l border-bad/50 px-2 hover:bg-bad/20">×</button>}
      </span>}
      {pics[0] && <SelectWords pic={pics[0]} onMask={(m, note) => { setMask({ ...m, from: "words" }); if (!e.instruction.trim() || Object.values(TEMPLATES(engine)).includes(e.instruction)) set({ mode: "free", instruction: "" }); toast(`${note}. Now say what it should become, and press Make edit — only that part changes.`, "good"); }} />}
    </>
  );
  // @ in the box: the picture or character goes into Picture 1 if it's empty, else Picture 2, and the words say which
  const mention: MentionTarget = {
    hint: { character: "their front picture as Picture 1 or 2", picture: "into Picture 1, or Picture 2 if 1 is taken" },
    pick: async (p) => {
      const md = p.kind === "character" ? await useCharacters.getState().asMedia(p.c.id, "front") : await useTray.getState().asMedia(p.item.id);
      if (!md) throw new Error(`${p.kind === "character" ? p.c.name : "That picture"} has no front picture yet`);
      const slot = !pics[0] ? 0 : 1;
      if (slot === 0) { setMask(null); if (p.kind === "character") autoFor.current = md.name; } // their own picture: don't also fill them in as Picture 2
      if (slot === 1 && p.kind === "character" && p.c.id === selChar?.id) autoPic2.current = md.name; // their LoRAs come along, like the identity card
      setPics((cur) => { const n = [...cur]; n[slot] = md; return n; });
      return p.kind === "character" ? `${p.c.name} (picture ${slot + 1})` : `picture ${slot + 1}`;
    },
  };
  return (
    <Workspace needs={need} tab="edit" title="Edit" sub={engine === "krea" ? "Krea 2 · Identity Edit" : `${info.label} · redraw`}
      bar={<PromptBar value={e.instruction} onChange={(v) => set({ instruction: v })} chips={chips} minRows={2} rewrite="edit" mention={mention} pose={anime ? "describe" : "instruct"}
        placeholder={anime ? "Describe the result — e.g. “1girl, red raincoat, rain, night, neon” (tags work)" : "Say what to change — e.g. “Change her jacket to a red raincoat. Keep everything else the same.”"}
        action={<GoButton onClick={go} disabled={!!why} why={why}>Make edit <EtaText k={etaKey} prefix="· " /></GoButton>} />}
      drawer={<>
        <PresetBar section="edit" />
        <div className="grid grid-cols-2 gap-3">
          {slots.map((m, i) => (
            <div key={i}>
              <Label><span className="block truncate" title={names[i]}>{names[i]}</span></Label>
              <Slot className="h-40" value={m} onChange={(v) => { if (i === 0) setMask(null); setPics((p) => { const n = [...p]; n[i] = v; return i >= 2 && !v ? n.filter((_, j) => j !== i) : n; }); }}
                label={i === 0 ? "Your picture" : "Optional"} />
              {!m && i < 2 && <PicturePicker what={`picture ${i + 1}`} onPick={(v) => { if (i === 0) setMask(null); setPics((p) => { const n = [...p]; while (n.length <= i) n.push(null); n[i] = v; return n; }); }}
                civitai={() => pickFromCivitai({ kind: "edit", slot: i === 0 ? "1" : "2" })} />}
            </div>
          ))}
        </div>
        {engine === "krea" && (
          <div>
            <Label>The place (optional)</Label>
            <div className="grid grid-cols-[96px_1fr] gap-3">
              <Slot className="h-24" value={place} label="A background" hint="room, street, beach…" onChange={setPlace} />
              <div className="flex flex-col gap-1">
                <p className="text-[11.5px] leading-relaxed text-dim">{place ? "The result is set in this place, with its background and light. With a place it's three pictures, so it runs as an Edit chat message: Qwen-Image-Edit takes all of them, then Krea 2 repaints with your character's LoRA and the face pass." : "Drop a place — a room or location from Pinterest, CivitAI or your results — and the picture is moved into it."}</p>
                {!place && <PicturePicker what="place" onPick={setPlace} civitai={() => pickFromCivitai({ kind: "edit", slot: "place" })} />}
              </div>
            </div>
          </div>
        )}
        <LikenessCard pic1={pics[0] ?? null} pic2={pics[1] ?? null} anime={anime} onPrompt={(t, note) => { set({ instruction: t }); toast(note, "info"); }}
          onPic2={(m) => setPics((p) => { const n = [...p]; while (n.length < 2) n.push(null); n[1] = m; return n; })} />
        {engine === "krea" && <p className="-mt-1 text-[12px] leading-relaxed text-dim">Krea 2 edits Picture 1 from your words. With a Picture 2 it puts that person in (keeping their face, hair and outfit). Two faces in one picture can blend a little — keep it to one person when you can.</p>}
        {anime && <>
          <Slider label="How much changes" min={0.15} max={0.95} step={0.05} value={e.strength ?? 0.55} show={`${Math.round((e.strength ?? 0.55) * 100)}%`} onChange={(v) => set({ strength: v })} />
          <p className="-mt-2 text-[12px] leading-relaxed text-dim">{info.label} redraws Picture 1 from your description, keeping its layout. Low = touch-up, high = mostly new. Paint an area to redraw only that part. To copy a pose from another picture, switch to Krea 2.</p>
        </>}
        {mask && (
          <div className="card flex items-center gap-3 rounded-xl border border-line p-2.5">
            <img src={mask.url} alt="Painted area" className="h-12 w-12 rounded border border-line object-contain" title="White = the part that will change" />
            <div className="flex-1 text-[13px]">Only the {mask.from === "words" ? "selected" : "painted"} area changes<div className="flex gap-3 text-xs"><button className="text-accent hover:underline" onClick={() => setPainting(true)}>repaint</button><button className="text-muted hover:text-ink" onClick={() => setMask(null)}>clear</button></div></div>
          </div>
        )}
        {mask && <Slider label="Painted edge softness" min={2} max={40} value={soft} show={`${soft}px`} onChange={setSoft} />}
        {brushFix && <>
          <Slider label="How much the painted area changes" min={0.35} max={1} step={0.05} value={e.brushStrength ?? 0.7} show={`${Math.round((e.brushStrength ?? 0.7) * 100)}%`} onChange={(v) => set({ brushStrength: v })} />
          <p className="-mt-2 text-[11.5px] leading-relaxed text-dim">Only Picture 1 is used{pics[1] ? " (Picture 2 is left out unless your words name it)" : ""}, starting from what's there now. Low = a touch-up, high = redrawn from scratch. To take something out, just say so ("remove the man", "erase the cup") — the area is cleared first and filled with what's behind it.</p>
        </>}
        <CheckpointPicker model={EDIT_TO_CREATE[engine]} value={editCheckpoint(e, createS, engine).own}
          onChange={(v) => set({ checkpoint: { ...e.checkpoint, [engine]: v } })}
          onModel={(mo, ck) => { const eng = (Object.keys(EDIT_TO_CREATE) as EditEngine[]).find((k) => EDIT_TO_CREATE[k] === mo)!; setEngine(eng); set({ engine: eng, checkpoint: { ...e.checkpoint, [eng]: ck } }); }} />
        {editCheckpoint(e, createS, engine).fromCreate && <p className="-mt-2 text-[11.5px] text-dim">Same checkpoint as Create{editCheckpoint(e, createS, engine).own ? "" : " (the official one)"} — pick another here to change it for Edit only.</p>}
        <LoraList family={keys.family} label={`LoRAs · ${info.label} (optional)`} value={e[keys.loras] ?? []} onChange={(v) => set({ [keys.loras]: v } as Partial<typeof e>)}
          onFamily={(fam, pick) => { const eng: EditEngine = fam === "sdxl" ? "noob" : fam === "anima" ? "anima" : "krea"; const k = editKeys(eng); setEngine(eng); set({ engine: eng, [k.loras]: [...(e[k.loras] ?? []).filter((x) => x.name !== pick.name), pick] } as Partial<typeof e>); }} />
        <p className="-mt-2 text-[12px] leading-relaxed text-dim">Not needed to keep a face — Edit copies it from your picture. Use LoRAs for a style or effect you want added.</p>
        {engine === "krea" && <KreaEditModel />}
        {engine === "krea" && <Slider label="Hold on to the reference" min={1} max={8} step={0.5} value={e.refBoost ?? 4} show={(e.refBoost ?? 4).toFixed(1)} onChange={(v) => set({ refBoost: v })} />}
        <FaceFix on={!!e.faceFix} strength={e.faceStrength ?? 0.45} onChange={(p) => set({ ...(p.on != null ? { faceFix: p.on } : {}), ...(p.strength != null ? { faceStrength: p.strength } : {}) })} />
        <TextIn label="Negative prompt · avoid" help="negative" value={e.negative} onChange={(v) => set({ negative: v })} placeholder="e.g. blurry, extra fingers" />
        <Advanced a={e[keys.adv]} set={(p) => set({ [keys.adv]: { ...e[keys.adv], ...p } } as Partial<typeof e>)}>
          <TextIn label="Reference size" help="resolution" value={e.resolution} onChange={(v) => set({ resolution: Math.max(256, Math.min(2048, Number(v) || 1024)) })} />
        </Advanced>
      </>}>
      {painting && pics[0] && <Painter src={pics[0].url} onClose={() => setPainting(false)} onDone={(m) => { setMask(m); setPainting(false); if (Object.values(TEMPLATES(engine)).includes(e.instruction)) set({ mode: "free", instruction: "" }); }}
        onRemove={mask ? () => { setMask(null); setPainting(false); } : undefined}
        onFix={engine === "krea" ? (m, words) => { setMask(m); set({ mode: "free", instruction: words }); setPainting(false); setTimeout(() => goRef.current(), 120); } : undefined} />}
      {compare && <Compare {...compare} onClose={() => setCompare(null)} />}
      <Feed tab="edit" empty={<><b className="display text-[19px] text-ink">Change any picture with words</b><span>Drop your picture in Picture 1 (settings on the left), say what to change above, and press Make edit.<br />Use “Paint area” to change only one part.</span></>}
        extra={({ o, j }) => typeof j.meta?.before === "string" ? [{ label: "Compare", icon: "image", run: () => setCompare({ before: j.meta!.before as string, after: viewUrl(o) }) }] : []} />
    </Workspace>
  );
}

function Compare({ before, after, onClose }: { before: string; after: string; onClose: () => void }) {
  const [x, setX] = useState(50);
  return (
    <div className="mb-4 rounded-xl border border-line bg-raised/60 p-3">
      <div className="mb-2 flex items-center justify-between text-[13px]"><span className="font-medium">Before ← drag → After</span><Btn small onClick={onClose}>Close</Btn></div>
      <div className="relative mx-auto h-[420px] overflow-hidden rounded-lg bg-black select-none">
        <img src={after} alt="After" className="absolute inset-0 h-full w-full object-contain" />
        <img src={before} alt="Before" className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - x}% 0 0)` }} />
        <div className={cx("pointer-events-none absolute inset-y-0 w-0.5 bg-accent")} style={{ left: `${x}%` }} />
        <input type="range" min={0} max={100} value={x} onChange={(ev) => setX(Number(ev.target.value))} aria-label="Before/after" className="absolute inset-x-0 bottom-2 mx-auto w-2/3" />
      </div>
    </div>
  );
}

/** a small painted area (a hand, an eye, a logo) is cut out with room around it, redrawn at full size and pasted back — much
 *  sharper than redrawing the whole picture; a big painted area is edited on the whole picture as before */
function regionFor(box?: { x: number; y: number; width: number; height: number; W: number; H: number }) {
  if (!box || box.width < 1) return {};
  if ((box.width * box.height) / (box.W * box.H) > 0.35) return {};
  const side = Math.round(Math.min(Math.min(box.W, box.H), Math.max(384, Math.max(box.width, box.height) * 1.8)));
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const x = Math.round(Math.min(Math.max(0, cx - side / 2), box.W - side));
  const y = Math.round(Math.min(Math.max(0, cy - side / 2), box.H - side));
  return { region: { x, y, width: side, height: side } };
}

/** Edit with a place: picture 1 (and 2) plus the place go to Edit chat as one message, with your words */
async function editWithPlace(pics: Media[], place: Media, words: string) {
  const { useDownloads } = await import("../lib/downloads");
  const q = useDownloads.getState().groups.find((g) => g.id === "qwen");
  if (q && q.state !== "done") throw new Error(`A place picture needs the Edit chat helper (Qwen-Image-Edit) — it's ${q.state === "downloading" ? `downloading, ${q.pct}%` : q.state === "error" ? "failed to download (status menu → Retry)" : "in line"}. Until then clear the place, or put the place in Picture 1 and your character in Picture 2.`);
  const ec = await import("../lib/editchat");
  await ec.useEditChat.getState().load();
  const chat = ec.useEditChat.getState().newChat();
  const a = ec.addPic(chat.id, pics[0], { label: "picture 1", start: true });
  const b = pics[1] ? ec.addPic(chat.id, pics[1], { label: "picture 2" }) : null;
  const pl = ec.addPic(chat.id, place, { label: "place" });
  ec.useEditChat.getState().patch(chat.id, (x) => ({ ...x, title: "Edit · with a place" }));
  // the words say "picture 1 / picture 2" — tie them to the pictures, then the place
  const names = `Picture 1 is @${a.key}${b ? `, picture 2 is @${b.key}` : ""}, the place is @${pl.key}.`;
  const text = `${names} ${words.trim()}${/[.!?]$/.test(words.trim()) ? "" : "."} Set it in @${pl.key}: its background, setting and light. Only one person unless I said otherwise.`;
  useSettings.getState().set("edit", { chat: true });
  useJobs.getState().toast("Three pictures go to Edit chat (Qwen takes all three) — follow it there.", "info", "edit");
  ec.send(text).catch(() => {});
}
