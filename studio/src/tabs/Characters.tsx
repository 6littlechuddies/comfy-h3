import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { runWriter } from "../lib/writer";
import { copiesPicture } from "../lib/sheet";
import { StartingFrame } from "../components/StartingFrame";
import { askConfirm } from "../components/Dialogs";
import { CharVideoDialog } from "../components/CharVideo";
import { useShallow } from "zustand/react/shallow";
import { viewUrl } from "../lib/api";
import { buildCreate, buildCutout, buildDescribeCharacter, buildEdit, buildExtractCharacter } from "../lib/graphs";
import { editGroup, useDownloads, useGroup } from "../lib/downloads";
import { useJobs } from "../lib/jobs";
import { DEFAULTS, modelArgs, modelOf, newSeed, pickModel, qualityTags, useSettings } from "../lib/settings";
import { charCkpt, charModel, familyOfModel, VIEWS, animeTags, describe, looks, exportCharacters, fromCreatorJson, importCharacters, isAdult, newCharacter, parseExtracted, useCharacters, type Character, type View } from "../lib/characters";
import { makeRef, useWork } from "../lib/work";
import { queueFullSheet, SHEET_MODELS, sheetStyle, viewEngine, viewGraph, viewMeta } from "../lib/sheet";
import { ModelsNotice } from "../components/Workspace";
import { TrainSetMaker } from "../components/Builder";
import { IdentityCard } from "../components/IdentityCard";
import { CheckpointPicker } from "../components/Checkpoint";
import { openSiteLink } from "../components/SiteLink";
import { openViewer } from "../components/Viewer";
import { pickFromCivitai } from "../components/ImageImport";
import { DRAG_TYPE, useTray, type Media } from "../lib/tray";
import { Btn, Check, Help, Icon, JobBar, Label, LoraList, Seg, Slider, Slot, TextArea, TextIn, cx } from "../components/ui";

const VIEW_PROMPT: Partial<Record<View, string>> = {
  back: "Show the exact same character from image 1 seen from directly behind: full body, standing straight, arms relaxed at the sides. Keep the same hair, outfit, colours and body proportions.",
  left: "Show the exact same character from image 1 in a full-body side profile view facing left, standing straight. Keep the same face, hair, outfit, colours and body proportions.",
  right: "Show the exact same character from image 1 in a full-body side profile view facing right, standing straight. Keep the same face, hair, outfit, colours and body proportions.",
  threeq: "Show the exact same character from image 1 in a full-body three-quarter view from the front-left, standing. Keep the same face, hair, outfit, colours and body proportions.",
  face: "Close-up portrait of the exact same character from image 1: head and shoulders, facing the camera, neutral expression. Keep the same face, hair, eyes and outfit.",
  smile: "Close-up portrait of the exact same character from image 1, head and shoulders, with a warm genuine smile. Keep the same face, hair, eyes and outfit.",
  angry: "Close-up portrait of the exact same character from image 1, head and shoulders, with an angry, intense expression. Keep the same face, hair, eyes and outfit.",
  surprised: "Close-up portrait of the exact same character from image 1, head and shoulders, with a surprised expression. Keep the same face, hair, eyes and outfit.",
};
const BG = { grey: "Plain light grey studio background.", white: "Plain pure white background." } as const;

export default function CharactersTab() {
  const { list, sel, loaded } = useCharacters(useShallow((s) => ({ list: s.list, sel: s.sel, loaded: s.loaded })));
  const { save, remove, select } = useCharacters.getState();
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"view" | "sheet" | "train">("view");
  // clicking "Characters" at the top while on the sheet maker or the training set: back to the character
  useEffect(() => { const home = (e: Event) => { if ((e as CustomEvent).detail === "characters") { setMode("view"); window.scrollTo({ top: 0 }); } }; window.addEventListener("h3:tab-home", home); return () => window.removeEventListener("h3:tab-home", home); }, []);
  const [side, setSide] = useState(false);
  const c = list.find((x) => x.id === sel) ?? null;
  const shown = list.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <main className="grid-bg min-w-0 flex-1 overflow-y-auto p-5">
        {!c ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-[13px] text-muted">
            <b className="display mb-1 text-[19px] text-ink">Every character is a project</b>
            <p className="max-w-md leading-relaxed">Pick one on the left (or press New), and their profile, sheet, pictures, scenes and videos all live under them. Import profiles or a .zip on the right. Everything comes back on every new rental.</p>
          </div>
        ) : mode === "sheet" ? <SheetMaker c={c} back={() => setMode("view")} /> : mode === "train" ? <TrainSetMaker c={c} back={() => setMode("view")} /> : <Detail c={c} side={side} onSide={() => setSide((v) => !v)} onSheet={() => setMode("sheet")} onTrain={() => setMode("train")} onDelete={async () => { if (await askConfirm(`Delete ${c.name}?`, "Their details and reference pictures are removed, including from your backup.", "Delete", true)) remove(c.id); }} />}
      </main>
      {(!c || side) && <Importer onClose={c ? () => setSide(false) : undefined} />}
    </>
  );
}

function Detail({ c, onSheet, onTrain, onDelete, side, onSide }: { c: Character; onSheet: () => void; onTrain: () => void; onDelete: () => void; side: boolean; onSide: () => void }) {
  const save = useCharacters((s) => s.save);
  const up = (p: Partial<Character>) => save({ ...c, ...p });
  const toast = useJobs((s) => s.toast);
  const adult = isAdult(c);
  const [vid, setVid] = useState(false);
  const useIn = async (tab: "prompt" | "animate") => {
    const st = useCharacters.getState();
    const ms = (await Promise.all((["front", "face"] as View[]).map((v) => st.asMedia(c.id, v)))).filter(Boolean);
    if (!ms.length) return toast("Make the reference sheet first (at least the front view).", "bad");
    const refs = ms.map((m) => ({ ...makeRef(m!), label: `${c.name}${m!.label.includes("(face)") ? " (face close-up)" : ""}` }));
    const key = tab === "prompt" ? "promptRefs" : "animateRefs";
    useWork.getState().set({ [key]: [...useWork.getState()[key], ...refs] });
    useSettings.getState().setTab(tab);
    toast(`${c.name} added as references.`, "good");
  };
  const useInCreate = () => {
    const cs = useSettings.getState().s.create;
    const mo = charModel(c), ck = charCkpt(c);
    useSettings.getState().set("create", {
      ...pickModel(mo), make: "character", subject: c.gender === "male" ? "man" : "woman", hair: c.hair, eyes: c.eyes, outfit: c.outfit,
      characterId: c.id, ...(ck ? { checkpoint: { ...cs.checkpoint, [mo]: ck } } : {}),
    });
    useSettings.getState().setTab("create");
  };
  return (
    <div className="flex flex-col gap-4">
      {vid && adult && <CharVideoDialog c={c} onClose={() => setVid(false)} />}
      <div className="flex flex-wrap items-center gap-3">
        <input value={c.name} onChange={(e) => up({ name: e.target.value })} aria-label="Name"
          className="h-10 min-w-0 rounded-lg border border-transparent bg-transparent px-1 text-xl font-semibold hover:border-line focus:border-accent focus:outline-none" />
        <span className={cx("rounded-sm px-2.5 py-1 text-xs", adult ? "bg-good/15 text-good" : "bg-bad/15 text-bad")}>{adult ? `${c.age} · adult ✓` : "needs an adult age"}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Btn onClick={useInCreate} disabled={!adult} why="Set an age of 18 or older first">Use in Create</Btn>
          <Btn onClick={() => useIn("prompt")} disabled={!adult} why="Set an age of 18 or older first">Use in Prompt</Btn>
          <Btn onClick={() => useIn("animate")} disabled={!adult} why="Set an age of 18 or older first">Use in Animate</Btn>
          <Btn kind="primary" onClick={() => setVid(true)} disabled={!adult} why="Set an age of 18 or older first"><Icon name="film" size={14} /> Make a video</Btn>
          <Btn onClick={() => openSiteLink(c.id)} disabled={!adult || !c.views.front} why="Set an adult age and a front picture first" title="Profile, content folders, send to your site as a draft"><Icon name="up" size={14} /> Your site</Btn>
          <Btn onClick={onSide} title="New character from a picture, import profiles, export or import a .zip">{side ? "Hide new / import" : "＋ New from a picture · import"}</Btn>
          <Btn kind="danger" onClick={onDelete} title="Delete"><Icon name="trash" size={14} /></Btn>
        </div>
      </div>
      <div className="flex gap-4">
        <div className="w-52 shrink-0">
          <Label help={undefined}>Their picture · the look everything copies</Label>
          <Slot className="h-72" value={c.views.front ? { name: "", kind: "image", url: viewUrl(c.views.front), label: "front" } : null}
            onChange={async (m) => {
              if (!m) return;
              try { await useCharacters.getState().setView(c.id, "front", { filename: m.name, subfolder: "", type: "input" }, { yours: true }); toast(`${c.name}'s picture is in — the sheet, scenes and edits copy it from now on`, "good"); }
              catch (e) { toast((e as Error).message, "bad"); }
            }} label="Drop or pick their picture" hint="full body works best · replaces the old one" />
          <button className="mt-1 flex items-center gap-1 text-[12px] text-accent hover:underline" onClick={() => pickFromCivitai({ kind: "front", id: c.id, name: c.name })}><Icon name="link" size={12} />Pick from CivitAI</button>
          {c.views.front && <div className="mt-1 flex gap-3 text-[12px]"><button className="text-accent hover:underline" onClick={() => viewAll(c, "front")}>View big</button>
            {c.prev?.front && <button className="text-muted hover:text-ink" title="Swap back to the picture it had before" onClick={() => useCharacters.getState().undoView(c.id, "front")}>↶ Back to the previous one</button>}</div>}
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-dim">This picture is the source of truth: the sheet maker copies its face, outfit and art style. The description below only fills in what the picture can't show.</p>
        </div>
      <div className="min-w-0 flex-1">
        <Label right={<span className="flex gap-2"><Btn small onClick={onTrain} disabled={!adult || !c.views.front} why={!adult ? "Set an age of 18 or older first" : "Add their front picture first"} title="Many new pictures of them, each face checked, captioned for training a character LoRA">Training set{c.trainset?.items.length ? ` (${c.trainset.items.filter((x) => x.keep).length})` : ""} ›</Btn><Btn small onClick={onSheet} disabled={!adult} why="Set an age of 18 or older first">Open sheet maker ›</Btn></span>}>Reference sheet</Label>
        <div className="grid grid-cols-4 gap-2 2xl:grid-cols-8">
          {VIEWS.filter((v) => v.id !== "sheet" && v.id !== "front").map((v) => (
            <div key={v.id} className="flex flex-col gap-1">
              <div className={cx("flex h-40 items-center justify-center overflow-hidden rounded-lg border border-line text-xs text-dim", v.id === "cutout" ? "checker" : "hatch")}>
                {c.views[v.id] ? <img src={viewUrl(c.views[v.id]!)} alt={v.label} className="h-full w-full cursor-zoom-in object-contain" draggable onClick={() => viewAll(c, v.id)}
                  onDragStart={(e) => { const it = useTray.getState().addOutput(c.views[v.id]!, `${c.name} ${v.label}`); if (it) e.dataTransfer.setData(DRAG_TYPE, it.id); }} /> : v.label}
              </div>
              <span className="text-center text-[11px] text-muted">{v.label}</span>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">Click a picture to see it big (scroll to zoom, ←/→ to flip through). Drag any view into a slot. In Animate and Plan a video, “Every angle” sends all of them.</p>
        <div className="mt-3"><IdentityCard c={c} /></div>
      </div>
      </div>
      <div className="grid grid-cols-2 gap-5">
        <div className="flex flex-col gap-2.5">
          <Label>Looks</Label>
          <div className="grid grid-cols-3 gap-2.5">
            <TextIn label="Age" value={c.age || ""} onChange={(v) => up({ age: Number(v.replace(/\D/g, "")) || 0 })} />
            <div className="col-span-2"><Seg label="Gender" value={c.gender} onChange={(v) => up({ gender: v })} options={[{ value: "female", label: "Woman" }, { value: "male", label: "Man" }, { value: "other", label: "Other" }]} /></div>
          </div>
          <Seg label="Style" help="style" value={c.style} onChange={(v) => up({ style: v, sheet: { ...c.sheet, style: v, model: v === "realistic" ? "krea" : c.sheet?.model } })} options={[{ value: "anime", label: "Anime" }, { value: "realistic", label: "Realistic" }]} />
          <p className="-mt-1.5 text-[11.5px] text-dim">{c.style === "anime" ? "Anime: Create, Edit, Scenes and frames use an anime model and anime LoRAs for them — never Krea 2 LoRAs." : "Realistic: everything uses Krea 2 and Krea 2 LoRAs for them."}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <TextIn label="Hair" value={c.hair} onChange={(v) => up({ hair: v })} />
            <TextIn label="Eyes" value={c.eyes} onChange={(v) => up({ eyes: v })} />
            <TextIn label="Body" value={c.body} onChange={(v) => up({ body: v })} />
            <TextIn label="Ethnicity" value={c.ethnicity} onChange={(v) => up({ ethnicity: v })} />
          </div>
          <TextIn label="Outfit" value={c.outfit} onChange={(v) => up({ outfit: v })} />
          <TextIn label="Details" value={c.details} onChange={(v) => up({ details: v })} placeholder="scars, accessories, posture…" />
          <TextIn label="Expression / mood" value={c.personality} onChange={(v) => up({ personality: v })} />
        </div>
        <div className="flex flex-col gap-3">
          <FullDescription c={c} up={up} />
          <details className="text-[12px] text-muted"><summary className="cursor-pointer">Anime tags (Illustrious / Anima) · short description</summary>
            <p className="mt-1.5 rounded-lg border border-line bg-raised p-2.5 font-mono text-[12px] leading-relaxed text-ink/85">{animeTags(c)}</p>
            <p className="mt-1.5 rounded-lg border border-line bg-raised p-2.5 text-[12.5px] leading-relaxed text-ink/85">{describe(c)}</p>
          </details>
          <CheckpointPicker model={charModel(c)} value={charCkpt(c)} models={c.style === "anime" ? ["anima", "noob"] : ["krea2"]}
            onChange={(v) => up({ sheet: { ...c.sheet, ckpt: { ...c.sheet?.ckpt, [charModel(c) === "krea2" ? "krea" : charModel(c)]: v || undefined } } })}
            onModel={(mo, ck) => { if (mo === "krea2") return; up({ animeModel: mo as "anima" | "noob", sheet: { ...c.sheet, ckpt: { ...c.sheet?.ckpt, [mo]: ck || undefined } } }); }} />
          <LoraList family={familyOfModel(charModel(c))} label={`Their LoRAs · ${charModel(c) === "krea2" ? "Krea 2" : charModel(c) === "noob" ? "Illustrious" : "Anima"} · added whenever you use them`} value={c.loras} onChange={(v) => up({ loras: v })}
            onFamily={(fam, pick) => {
              if (fam === "krea2" && c.style === "anime") { toast("That's a Krea 2 (realistic) LoRA — switch their Style to Realistic first if you want it.", "bad"); return; }
              if (fam !== "krea2" && c.style === "realistic") { toast("That's an anime LoRA — switch their Style to Anime first if you want it.", "bad"); return; }
              up({ animeModel: fam === "sdxl" ? "noob" : "anima", loras: [...c.loras.filter((x) => x.name !== pick.name), pick] });
            }} />
          <p className="-mt-1 text-[11.5px] text-dim">Checkpoint and LoRAs go together: Create, Edit and Scenes switch to this model and use them whenever {c.name} is in a picture.</p>
        </div>
      </div>
    </div>
  );
}

/** the long Krea 2 description: written by the local writer from the profile + their front picture (your own prompt
 *  file for "Character description" is used when you've added one), then yours to edit. Used word-for-word everywhere. */
function FullDescription({ c, up }: { c: Character; up: (p: Partial<Character>) => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useJobs((s) => s.toast);
  const write = async () => {
    setBusy(true);
    try {
      const front = c.views.front ? await useCharacters.getState().asMedia(c.id, "front") : null;
      const notes = [describe(c), c.details && `Details: ${c.details}`, c.personality && `Usual expression: ${c.personality}`,
        c.style === "anime" ? "Art style: anime" : "Photorealistic", c.block && `Current description (improve and lengthen it): ${c.block}`].filter(Boolean).join("\n");
      const out = await runWriter("describe", { notes }, { tab: "characters", label: `${c.name}: writing the full description`, images: front ? [front.name] : [], meta: { charId: c.id } });
      up({ block: out });
      toast(`${c.name}'s full description is in — edit it freely`, "good");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  const words = (c.block ?? "").trim().split(/\s+/).filter(Boolean).length;
  return (
    <div className="flex flex-col gap-1.5">
      <Label right={<Btn small kind="primary" onClick={write} disabled={busy || !isAdult(c)} why={busy ? "Writing…" : "Set an age of 18 or older first"}>{busy ? "Writing… ~30 s" : c.block ? "Rewrite it in full" : "Write it in full"}</Btn>}>
        Full description · Krea 2 &amp; H3 {words > 0 && <span className="ml-1 text-dim">{words} words</span>}
      </Label>
      <TextArea rows={8} value={c.block ?? ""} onChange={(v) => up({ block: v || undefined })}
        placeholder={`Press “Write it in full”: the local writer turns the profile${c.views.front ? " and their front picture" : ""} into a long, detailed description (180–260 words). Until then: ${describe(c)}`} />
      <p className="text-[11.5px] leading-relaxed text-dim">Pasted word-for-word into every frame, scene and edit, so they stay the same person. Uses your own “Character description” prompt file when you've added one (Scenes → prompt files).</p>
    </div>
  );
}

/** every picture of a character, full screen (scroll to zoom, ←/→ to flip), starting at the one you clicked */
function viewAll(c: Character, start: View) {
  const order: View[] = ["front", ...VIEWS.map((v) => v.id).filter((v) => v !== "front")];
  const have = order.filter((v) => c.views[v]);
  openViewer(have.map((v) => ({ url: viewUrl(c.views[v]!), kind: "image", label: `${c.name} · ${VIEWS.find((x) => x.id === v)?.label ?? v}` })), Math.max(0, have.indexOf(start)));
}

// ------------------------------------------------------------------ reference sheet maker
function SheetMaker({ c, back }: { c: Character; back: () => void }) {
  const run = useJobs((s) => s.run);
  const toast = useJobs((s) => s.toast);
  const jobs = useJobs(useShallow((s) => s.jobs.filter((j) => j.meta?.charId === c.id && (j.status === "running" || j.status === "queued"))));
  const [start, setStart] = useState<"existing" | "new">(c.views.front ? "existing" : "new");
  const [bg, setBg] = useState<keyof typeof BG>("grey");
  const [pick, setPick] = useState<Set<View>>(new Set(["back", "left", "right", "threeq", "face", "cutout"]));
  const busyView = (v: View) => jobs.some((j) => j.meta?.view === v);

  const makeFront = async (then?: "sheet") => {
    const anime = sheetStyle(c) === "anime";
    const cs = useSettings.getState().s.create;
    const eng = viewEngine(c);
    const mi = anime ? modelOf(cs, "anime", eng === "noob" ? "noob" : "anima") : modelOf(cs, "realistic");
    const adv = { ...mi.adv, seed: 0, lockSeed: false };
    const positive = anime
      ? `${qualityTags(mi)}, ${animeTags(c)}, full body, standing, front view, looking at viewer, arms at sides, solo focus, simple background, ${bg === "white" ? "white" : "grey"} background`
      : `${looks(c)} Full body, standing straight, facing the camera, arms relaxed. One person only, alone in the frame. ${BG[bg]}`;
    const ck = c.sheet?.ckpt?.[anime ? (eng === "noob" ? "noob" : "anima") : "krea"];
    const g = buildCreate({ ...adv, seed: newSeed(), ...modelArgs(cs, mi), ...(ck ? (anime && eng === "noob" ? { ckpt: ck } : { unet: ck }) : {}), positive, negative: DEFAULTS.create.negative, loras: c.loras, width: anime ? 832 : 928, height: anime ? 1216 : 1664, count: 1, cutout: false, prefix: `studio/characters/${c.id}_front` });
    await run("characters", `${c.name}: front view`, g, `characters:front:${c.style}`, { charId: c.id, view: "front", then, bg });
  };
  useDownloads((st) => st.groups); // follow downloads so the engine and the notice update by themselves
  const sheetEngine = viewEngine(c);
  const sheetNeed = editGroup(sheetEngine);
  const sheetDl = useGroup(sheetNeed);
  const kreaNeed = editGroup("krea"); // the one-picture sheet is always made by Krea 2 Edit
  const kreaDl = useGroup(kreaNeed);
  const fullSheet = async () => {
    try {
      if (start === "new" || !c.views.front) {
        await makeFront("sheet");
        toast("Making the front first — the character sheet and cut-out follow by themselves.", "info", "characters");
      } else {
        await queueFullSheet(c, bg);
        toast("Making the character sheet and the cut-out — about a minute.", "info", "characters");
      }
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  const makeView = async (v: View) => {
    const front = await useCharacters.getState().asMedia(c.id, "front");
    if (!front) throw new Error("Make the front view first");
    const g = v === "cutout"
      ? buildCutout(front.name, `studio/characters/${c.id}_cutout`)
      : viewGraph(c, front.name, `${VIEW_PROMPT[v]} ${v === "face" || ["smile", "angry", "surprised"].includes(v) ? "" : BG[bg]}`.trim(), v);
    await run("characters", `${c.name}: ${VIEWS.find((x) => x.id === v)!.label.toLowerCase()}`, g, `characters:${v === "cutout" ? "cutout" : "view"}`, { charId: c.id, view: v, ...(v === "cutout" ? {} : viewMeta(c)) });
  };
  const go = async () => {
    try {
      if (start === "new" || !c.views.front) {
        await makeFront();
        toast("Making the front first. When it's ready, press Make views again for the other angles.", "info", "characters");
        return;
      }
      for (const v of VIEWS.map((x) => x.id).filter((v) => v !== "front" && pick.has(v))) await makeView(v);
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  const toggle = (v: View) => setPick((p) => { const n = new Set(p); n.has(v) ? n.delete(v) : n.add(v); return n; });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button className="text-[13px] text-accent hover:underline" onClick={back}>‹ {c.name}</button>
        <h2 className="display text-[20px] leading-tight">Reference sheet</h2>
        <span className="text-[13px] text-muted">{sheetEngine === "anima" || sheetEngine === "noob"
          ? `Single angles: ${sheetEngine === "anima" ? "Anima" : "Illustrious"} draws each from their look and LoRAs, with one seed so they match. The character sheet is always made by Krea 2 Edit from the front picture.`
          : "Every angle is made from their picture (Krea 2 Edit), so face, outfit and art style match it — the description isn't used."}</span>
      </div>
      {start === "new" && <StartingFrame c={c} onPicked={() => setStart("existing")} />}
      <div className="flex gap-5">
        <div className="flex w-72 shrink-0 flex-col gap-3.5">
          <Seg label="Start from" value={start} onChange={setStart} options={[{ value: "existing", label: "Their front picture" }, { value: "new", label: "Build a starting frame" }]} />
          {start === "existing" && (
            <div>
              <Label help={undefined}>Front picture</Label>
              <Slot className="h-64" value={c.views.front ? { name: "", kind: "image", url: viewUrl(c.views.front), label: "front" } : null}
                onChange={async (m) => {
                  if (!m) return;
                  try { await useCharacters.getState().setView(c.id, "front", { filename: m.name, subfolder: "", type: "input" }, { yours: true }); } catch (e) { toast((e as Error).message, "bad"); }
                }} label="Drop their best full-body picture" hint="drag from the tray or pick a file" />
              <button className="mt-1 flex items-center gap-1 text-[12px] text-accent hover:underline" onClick={() => pickFromCivitai({ kind: "front", id: c.id, name: c.name })}><Icon name="link" size={12} />Pick from CivitAI</button>
            </div>
          )}
          <Seg label="Style" value={sheetStyle(c)} onChange={(v) => useCharacters.getState().save({ ...c, sheet: { style: v, model: SHEET_MODELS[v][0].value } })}
            options={[{ value: "anime", label: "Anime" }, { value: "realistic", label: "Realistic" }]} />
          {sheetStyle(c) === "anime" && <Seg label="Made with" value={sheetEngine} onChange={(v) => useCharacters.getState().save({ ...c, sheet: { ...c.sheet, style: sheetStyle(c), model: v as "anima" | "noob" | "krea" } })}
            options={SHEET_MODELS[sheetStyle(c)].map((m) => ({ value: m.value, label: m.label }))} />}
          <CheckpointPicker model={sheetEngine === "krea" ? "krea2" : sheetEngine === "noob" ? "noob" : "anima"} value={c.sheet?.ckpt?.[sheetEngine as "krea" | "anima" | "noob"]}
            onChange={(v) => useCharacters.getState().save({ ...c, sheet: { ...c.sheet, ckpt: { ...c.sheet?.ckpt, [sheetEngine]: v || undefined } } })} />
          {sheetEngine === "krea" && sheetStyle(c) === "anime" && <>
            <Seg label="Then redraw in" value={c.sheet?.redraw ?? ""} onChange={(v) => useCharacters.getState().save({ ...c, sheet: { ...c.sheet, redraw: (v || undefined) as "anima" | "noob" | undefined } })}
              options={[{ value: "", label: "Keep Krea's copy" }, { value: "anima", label: "Anima" }, { value: "noob", label: "Illustrious" }]} />
            {c.sheet?.redraw && <Slider label="How much the redraw changes" min={0.2} max={0.7} step={0.05} value={c.sheet?.redrawStrength ?? 0.45} show={`${Math.round((c.sheet?.redrawStrength ?? 0.45) * 100)}%`}
              onChange={(v) => useCharacters.getState().save({ ...c, sheet: { ...c.sheet, redrawStrength: v } })} />}
            <p className="-mt-2 text-[11.5px] leading-relaxed text-dim">Anima can't look at a picture, so it can't copy one by itself. This way Krea 2 Edit copies each angle from the front picture, then {c.sheet?.redraw === "noob" ? "Illustrious" : "Anima"} redraws it lightly with their tags, LoRAs and {c.sheet?.redraw ? `their ${c.sheet.redraw === "noob" ? "Illustrious" : "Anima"} checkpoint (set on their page)` : "checkpoint"} — same pose and angle, your anime model's look.</p>
          </>}
          {sheetEngine === "krea" && <p className="-mt-2 text-[11.5px] leading-relaxed text-dim">Angles are made by Krea 2 Edit on this checkpoint — a Krea 2 fine-tune (e.g. a photoreal merge) usually gives sharper skin and detail; the official one follows the picture most reliably.</p>}
          <Seg label="Background" value={bg} onChange={setBg} options={[{ value: "grey", label: "Light grey" }, { value: "white", label: "White" }]} />
          <ModelsNotice id={kreaNeed} />
          <Btn kind="primary" className="w-full" onClick={fullSheet} disabled={jobs.length > 0 || !kreaDl.ready} why={!kreaDl.ready ? kreaDl.why : "Already making it…"}>
            {start === "new" ? "Skip picking: quick front + sheet" : !c.views.front ? "Make front + character sheet" : c.views.sheet ? "Make a new character sheet" : "Make character sheet"}
          </Btn>
          {sheetEngine === "noob" && copiesPicture() && <Slider label="Copy the front picture" min={0.3} max={1} step={0.05} value={c.sheet?.refWeight ?? 0.6} show={`${Math.round((c.sheet?.refWeight ?? 0.6) * 100)}%`}
            onChange={(v) => useCharacters.getState().save({ ...c, sheet: { ...c.sheet, refWeight: v } })} />}
          <p className="-mt-2 text-[12px] leading-relaxed text-dim">One click: ONE picture with six views of the character (front, front neutral, 3/4, back, face close-up, side-profile close-up) on a clean white background, plus the cut-out. Krea 2 Edit makes it from the front picture, so face, outfit and art style match it — also for anime. The single angles below are still there if you want one redone.</p>
          <details className="border-t border-line pt-3 text-[13px]">
            <summary className="cursor-pointer text-muted hover:text-ink">Make or redo single angles</summary>
            <p className="mt-2 text-[12px] text-dim">Tick angles below, or use Redo on one picture.</p>
            <Btn className="mt-2 w-full" onClick={go} disabled={jobs.length > 0 || !c.views.front || !sheetDl.ready} why={!c.views.front ? "Add the front first" : !sheetDl.ready ? sheetDl.why : "Already making views…"}>Make {[...pick].length} ticked angles</Btn>
          </details>
          {jobs.map((j) => <div key={j.id} className="rounded-lg border border-line bg-raised/60 p-2.5"><p className="mb-1 text-xs">{j.label}</p><JobBar job={j} compact /></div>)}
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-4 content-start gap-3">
          <div className="col-span-4 flex flex-col gap-1.5">
            <div className="relative flex h-60 items-center justify-center overflow-hidden border border-line text-center text-xs text-dim hatch">
              {c.views.sheet ? <img src={viewUrl(c.views.sheet)} alt="All angles" className="h-full w-full cursor-zoom-in object-contain" onClick={() => viewAll(c, "sheet")} /> : <span>The character sheet: six views in one picture<br />Make character sheet fills this</span>}
              {busyView("sheet") && <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs">making the character sheet…</div>}
            </div>
          </div>
          {VIEWS.filter((v) => v.id !== "sheet").map((v) => (
            <div key={v.id} className="flex flex-col gap-1.5">
              <div className={cx("relative flex h-52 items-center justify-center overflow-hidden rounded-lg border text-center text-xs text-dim", v.id === "cutout" ? "checker" : "hatch", v.id === "front" ? "border-accent" : "border-line")}>
                {c.views[v.id] ? <img src={viewUrl(c.views[v.id]!)} alt={v.label} className="h-full w-full cursor-zoom-in object-contain" onClick={() => viewAll(c, v.id)} /> : <span>{v.label}<br />{v.hint}</span>}
                {busyView(v.id) && <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs">making…</div>}
              </div>
              <div className="flex items-center gap-1.5 text-[13px]">
                {v.id !== "front" && <input type="checkbox" checked={pick.has(v.id)} onChange={() => toggle(v.id)} aria-label={`Include ${v.label}`} />}
                <span className="flex-1">{v.label}</span>
                {c.prev?.[v.id] && <button className="text-[12px] text-muted hover:text-ink" title="Swap back to the picture it had before" onClick={() => useCharacters.getState().undoView(c.id, v.id).catch((e) => toast(e.message, "bad"))}>↶ Back</button>}
                {c.views.front && <Btn small onClick={async () => {
                  if (v.id === "front" && c.frontYours && !(await askConfirm("Replace your own picture?", "Redo makes a new front picture from the description. Your picture is kept — “↶ Back” swaps it back. To keep your look, redo the other angles instead (they copy your picture).", "Make a new one"))) return;
                  (v.id === "front" ? makeFront() : makeView(v.id)).catch((e) => toast(e.message, "bad"));
                }} disabled={busyView(v.id)} why="Making it…">{c.views[v.id] ? "Redo" : "Make"}</Btn>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ new character from a picture
/** a picture sent here from anywhere (a CivitAI post, a result): "New character from this picture" */
export const useNewFromPicture = create<{ pic: Media | null }>(() => ({ pic: null }));

function FromPicture() {
  const handed = useNewFromPicture((s) => s.pic);
  const [pic, setPic] = useState<Media | null>(null);
  useEffect(() => { if (handed) { setPic(handed); useNewFromPicture.setState({ pic: null }); } }, [handed]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [needAge, setNeedAge] = useState<Partial<Character> | null>(null);
  const [age, setAge] = useState("");
  const run = useJobs((s) => s.run);
  const toast = useJobs((s) => s.toast);
  const writer = useGroup("writer");

  const create = async (p: Partial<Character>) => {
    const c = newCharacter({ ...p, name: name.trim() || (p.name && p.name !== "Unnamed" ? p.name : "New character") });
    useCharacters.getState().save(c);
    await useCharacters.getState().setView(c.id, "front", { filename: pic!.name, subfolder: "", type: "input" }, { yours: true });
    useCharacters.getState().select(c.id);
    toast(isAdult(c) ? `${c.name} is in, with your picture as their look. Next: Open sheet maker → Make full sheet.` : `${c.name} is in. Their age couldn't be read from the picture — type it in Looks → Age (18 or older) to start using them.`, isAdult(c) ? "good" : "info", "characters");
    setPic(null); setName(""); setNeedAge(null); setAge("");
  };
  const read = async () => {
    if (!pic) return;
    setBusy(true);
    try {
      const job = await run("characters", "Reading the picture", buildDescribeCharacter(pic.name, newSeed()), "extract");
      await new Promise<void>((resolve) => {
        const unsub = useJobs.subscribe((s) => {
          const j = s.jobs.find((x) => x.id === job.id);
          if (!j || (j.status !== "done" && j.status !== "error" && j.status !== "cancelled")) return;
          unsub(); resolve();
          const p = j.status === "done" ? parseExtracted(j.texts.character ?? "") : null;
          if (!p) return toast(j.error ?? "Couldn't read the picture — fill the details in by hand.", "bad", "characters");
          if (p.age && p.age < 18) return toast("This picture may show someone under 18 — not imported.", "bad", "characters");
          // no age readable from the picture: made anyway — set it in Looks (18+) before using them
          create(p.age ? p : { ...p, age: 0 });
        });
      });
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  const why = !pic ? "Add a picture first" : !writer.ready ? writer.why : busy ? "Reading…" : undefined;

  return (
    <div className="flex flex-col gap-3">
      <p className="lbl">New character from a picture<Help text="Drop a picture of your character (art you made, a render, a design). Its look is read from the picture — hair, eyes, outfit, details — and the picture itself becomes their front view, so the reference sheet matches it exactly." /></p>
      <Slot className="h-52" value={pic} onChange={setPic} label="Drop their picture" hint="full body works best" />
      <button className="-mt-1.5 flex items-center gap-1 self-start text-[12px] text-accent hover:underline" onClick={() => pickFromCivitai({ kind: "new" })}><Icon name="link" size={12} />Or pick one from CivitAI (your collections or a link)</button>
      <TextIn label="Name" value={name} onChange={setName} placeholder="e.g. Rin" />
      {needAge ? (
        <div className="flex flex-col gap-2 border border-accent/50 p-3 text-[13px]">
          <span className="text-muted">Their age can't be told from the picture. How old is this character? (18 or older)</span>
          <div className="flex gap-2">
            <input value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))} placeholder="25" aria-label="Age" className="inset h-9 w-20 border px-2.5 text-[14px] focus:border-accent focus:outline-none" />
            <Btn kind="primary" className="flex-1" disabled={!(Number(age) >= 18)} why="Must be 18 or older" onClick={() => create({ ...needAge, age: Number(age) })}>Create</Btn>
          </div>
        </div>
      ) : (
        <Btn kind="primary" className="w-full" onClick={read} disabled={!!why} why={why}>Read the picture · ~30 s</Btn>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ import
function Importer({ onClose }: { onClose?: () => void }) {
  const [text, setText] = useState("");
  const [style, setStyle] = useState<"anime" | "realistic">("anime");
  const [sheet, setSheet] = useState(true);
  const [log, setLog] = useState<{ name: string; ok: boolean; msg: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const zipIn = useRef<HTMLInputElement>(null);
  const run = useJobs((s) => s.run);
  const toast = useJobs((s) => s.toast);

  const addOne = (p: Partial<Character>, label: string) => {
    if (!isAdult({ age: Number(p.age) })) {
      setLog((l) => [{ name: p.name || label, ok: false, msg: Number(p.age) ? `age ${p.age} — under 18, refused` : "no clear adult age — refused (add “Age: 25” to the profile, or make them by hand)" }, ...l]);
      return null;
    }
    const c = newCharacter({ ...p, style: (p.style as Character["style"]) ?? style });
    useCharacters.getState().save(c);
    useCharacters.getState().select(c.id);
    setLog((l) => [{ name: c.name, ok: true, msg: `${c.age} · imported` }, ...l]);
    return c;
  };

  const extract = (profile: string, label: string) =>
    new Promise<void>(async (resolve) => {
      try {
        const job = await run("characters", `Reading ${label}`, buildExtractCharacter(profile, newSeed()), "extract");
        const unsub = useJobs.subscribe((s) => {
          const j = s.jobs.find((x) => x.id === job.id);
          if (!j || (j.status !== "done" && j.status !== "error" && j.status !== "cancelled")) return;
          unsub();
          const p = j.status === "done" ? parseExtracted(j.texts.character ?? "") : null;
          if (!p) setLog((l) => [{ name: label, ok: false, msg: j.error ?? "couldn't read the profile" }, ...l]);
          else {
            const ageInText = profile.match(/\b(?:age|aged|i am|i'm|you are|you're)\D{0,6}(\d{2})\b/i)?.[1];
            if (!p.age && ageInText) p.age = Number(ageInText);
            const c = addOne(p, label);
            if (c && sheet) setTimeout(() => toast(`${c.name} imported — open the sheet maker to make their pictures.`, "good", "characters"), 50);
          }
          resolve();
        });
      } catch (e) { setLog((l) => [{ name: label, ok: false, msg: (e as Error).message }, ...l]); resolve(); }
    });

  const handle = async (items: { name: string; text: string }[]) => {
    setBusy(true);
    for (const it of items) {
      let json: any = null;
      try { json = JSON.parse(it.text); } catch { /* plain text */ }
      const arr = Array.isArray(json) ? json : json && typeof json === "object" ? [json] : null;
      const mapped = arr?.map(fromCreatorJson).filter(Boolean) as Partial<Character>[] | undefined;
      if (mapped?.length) mapped.forEach((p) => addOne(p, it.name));
      else await extract(it.text, it.name);
    }
    setBusy(false);
  };

  return (
    <aside className="flex w-[320px] shrink-0 flex-col gap-3.5 overflow-y-auto border-l border-line2 bg-panel p-5">
      {onClose && <button onClick={onClose} className="self-end text-[12px] text-muted hover:text-ink">Hide ✕</button>}
      <FromPicture />
      <div className="h-px bg-line2" />
      <p className="lbl">All your characters, in one file<Help text="Export downloads every character with their pictures, sheet and personality as one .zip. Drag that file onto any rental (or press Import file) to bring them all back at once. Your characters also come back by themselves on every new rental when the B2 backup is on." /></p>
      <div className="flex gap-2">
        <Btn className="flex-1" onClick={() => exportCharacters()} disabled={!useCharacters.getState().list.length} why="No characters yet">Export all</Btn>
        <Btn className="flex-1" onClick={() => zipIn.current?.click()}>Import file…</Btn>
        <input ref={zipIn} type="file" accept=".zip,application/zip" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { await importCharacters(f); } catch { /* shown on the import card */ } }} />
      </div>
      <div className="h-px bg-line2" />
      <p className="lbl">Import characters<Help text="Paste a character profile (any format) or drop .txt / .json files. The local Fable model pulls out only how they look — backstory and chat rules are ignored. JSON from your character creator is read directly." /></p>
      <div onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); const fs = Array.from(e.dataTransfer.files); handle(await Promise.all(fs.map(async (f) => ({ name: f.name, text: await f.text() })))); }}>
        <TextArea rows={7} value={text} onChange={setText} placeholder="Paste a character profile here — or drop .txt / .json files on this box" />
      </div>
      <div className="flex gap-2">
        <Btn className="flex-1" onClick={() => file.current?.click()}>Pick files…</Btn>
        <input ref={file} type="file" accept=".txt,.json,.md,text/plain,application/json" multiple hidden onChange={async (e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; handle(await Promise.all(fs.map(async (f) => ({ name: f.name, text: await f.text() })))); }} />
      </div>
      <Seg label="Turn into" value={style} onChange={setStyle} options={[{ value: "anime", label: "Anime" }, { value: "realistic", label: "Realistic" }]} />
      <Check checked={sheet} onChange={setSheet} title="Remind me to make their reference sheet" />
      <Btn kind="primary" className="w-full" disabled={!text.trim() || busy} why={busy ? "Reading…" : "Paste a profile first"} onClick={() => { handle([{ name: "pasted profile", text }]); setText(""); }}>
        Import · ~40 s each
      </Btn>
      {log.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-raised/60 p-2.5 text-[13px]">
          {log.slice(0, 8).map((l, i) => (
            <div key={i} className="flex gap-2"><span className={l.ok ? "text-good" : "text-bad"}>{l.ok ? "✓" : "✕"}</span><span><b className="font-medium">{l.name}</b> <span className="text-muted">{l.msg}</span></span></div>
          ))}
        </div>
      )}
      <p className="mt-auto text-xs leading-relaxed text-muted">Profiles under 18, or with no clear adult age, are refused.</p>
    </aside>
  );
}
