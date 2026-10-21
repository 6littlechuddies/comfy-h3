import { useEffect, useState } from "react";
import { animeEngine, charLoras, followFor, makeWithRefs, mergeRemix, readPicture, type Take, looksPlain, mergeLoras, polishKrea, SHEET_DEFAULT, TAKES, toTags, useMakeRefs } from "../lib/make";
import { useHandoffInto } from "../App";
import { useRemix } from "../lib/remix";
import { trayIdOf, useTray } from "../lib/tray";
import type { MentionTarget } from "../components/Mention";
import { CheckpointPicker } from "../components/Checkpoint";
import { buildCreate, withTriggers, type LoraPick } from "../lib/graphs";
import { editGroup, kreaBoostInstalled, syncKreaTE, useDownloads, useGroup } from "../lib/downloads";
import { KREA_BOOST_KEY, KREA_TE_KEY } from "../lib/models";
import { WriterChoice } from "../components/WriterChoice";
import { useJobs } from "../lib/jobs";
import { CREATE_MODELS, modelArgs, modelOf, newSeed, pickModel, qualityTags, seedFor, useSection } from "../lib/settings";
import { usePrimaryAction } from "../App";
import { Advanced, Btn, EtaText, Icon, Label, LoraList, PresetBar, Seg, Slider, Slot, TextArea, TextIn, cx, tipsLine } from "../components/ui";
import { mapSampler } from "../lib/civitUse";
import type { LoraTips } from "../lib/api";
import { Chip, GoButton, PromptBar, Workspace } from "../components/Workspace";
import { PicturePicker } from "../components/PicturePicker";
import { registerPics, remember } from "../lib/promptHistory";
import type { Media } from "../lib/tray";
import { pickFromCivitai } from "../components/ImageImport";
import { Feed, type SentInfo } from "../components/Feed";
import { PromptPieces } from "../components/PromptPieces";
import { askSweep } from "../components/Dialogs";
import { StylePicker, styleAdd } from "../components/StylePicker";
import { animeTags, charCkpt, charModel, describe, looks, useCharacters, VIEWS, type Character, type View } from "../lib/characters";
import { useSettings } from "../lib/settings";
import { viewUrl } from "../lib/api";
import { lastWrite } from "../lib/writer";
import { activePack } from "../lib/packs";
import { WordDiff } from "../components/WordDiff";
import { copyText } from "../lib/copy";
import { WordBankButton } from "../components/WordBank";
import { CAST_OPTIONS, castSentence, castTags, nounOf, stripCountTags, type Gender } from "../lib/cast";
import { useWordBank } from "../lib/wordbank";
import "../lib/faceDetail";
import { FaceFix } from "../components/FaceFix";
import { BUDGET, balanceLoras, type BudgetKey } from "../lib/loraBalance";
import { loraLibrary } from "../lib/api";

// each model's own size (where it draws best); "Finish at" enlarges from here
const SIZES = {
  anime: { portrait: [832, 1216], tall: [832, 1248], square: [1024, 1024], wide: [1216, 832] },
  // ~2 MP, like the community's Krea 2 workflows (1080×1920) and CivitAI's own generator (1320×1984): more detail per picture
  realistic: { portrait: [1088, 1920], tall: [1152, 1728], square: [1440, 1440], wide: [1920, 1088] },
} as const;
const SHAPE_NAME = { portrait: "Portrait 9:16", tall: "Portrait 2:3", square: "Square", wide: "Wide 16:9" } as const;
const r16 = (n: number) => Math.round(n / 16) * 16;

const clean = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean).join(", ");

/** the empty Results: three ways in (HeliosGen-style starter cards) */
function CreateStarters({ who, onWords }: { who?: string; onWords: (t: string) => void }) {
  const cards = [
    { icon: "sparkle", title: "Describe a picture", text: "Plain words — they go to the model as typed.", run: () => onWords(who ? "sitting by a window in soft morning light, smiling at the camera" : "an adult woman sitting by a window in soft morning light, smiling at the camera") },
    { icon: "user", title: who ? `${who} in a picture you found` : "Your character in a picture you found", text: "Pick a CivitAI picture and they're swapped in. Many at once (or Pinterest): Batch → Swap in.", run: () => {
      // pick the picture on CivitAI (your collections or a link) and they're swapped straight in; without a character, Edit chat
      const c = useCharacters.getState().list.find((x) => x.id === useSettings.getState().s.create.characterId) ?? null;
      if (c) { pickFromCivitai({ kind: "swap", id: c.id, name: c.name }); return; }
      useSettings.getState().set("edit", { chat: true }); useSettings.getState().setTab("edit");
    } },
    { icon: "link", title: "Copy a CivitAI post", text: "Its prompt, settings and LoRAs, with your character.", run: () => { import("../components/ImageImport").then(({ openImageImport }) => openImageImport("", "collections")); } },
  ];
  return (
    <div className="flex flex-col items-center gap-5">
      <div><b className="display block text-[19px] text-ink">Make something</b><span className="mt-1 block">Describe it above and press Generate (Ctrl+Enter) — or start from one of these.</span></div>
      <div className="grid w-full max-w-3xl gap-3 text-left md:grid-cols-3">
        {cards.map((c) => (
          <button key={c.title} onClick={c.run} className="press card flex flex-col items-start gap-2 border border-line p-4 hover:border-accent">
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-accent/40 bg-accent/10 text-accent"><Icon name={c.icon} size={16} /></span>
            <span className="text-[13.5px] font-medium text-ink">{c.title}</span>
            <span className="text-[12px] leading-relaxed text-dim">{c.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** one line under each model in the Model menu */
const MODEL_HINT: Record<string, string> = {
  krea2: "Photos — skin, light and detail; follows plain sentences",
  anima: "Anime — follows tags and short sentences; Anima LoRAs",
  noob: "Anime (Illustrious / NoobAI) — the biggest LoRA library on CivitAI",
};

export default function CreateTab() {
  const [c, set] = useSection("create");
  const run = useJobs((s) => s.run);
  const toast = useJobs((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const anime = c.style === "anime";
  const m = modelOf(c);
  const { advKey, lorasKey, adv, loras } = m;
  const setAdv = (p: Partial<typeof adv>) => set({ [advKey]: { ...adv, ...p } });
  const person = c.make !== "background";
  const [w0, h0] = SIZES[c.style][c.shape] ?? SIZES[c.style].portrait;
  // Draft: about half the pixels (~1 MP), about twice as fast — for making many and upscaling the keepers in 07 Upscale
  const [w, h] = c.draft && !anime ? [r16(w0 * 0.72), r16(h0 * 0.72)] : [w0, h0];
  const up = c.upscale ?? 1;
  const hires = up > 1.01 ? { scale: up, denoise: anime ? 0.42 : 0.35 } : undefined;
  const ch = useCharacters((s) => s.list.find((x) => x.id === c.characterId) ?? null);
  const look = ""; // the old "Look" presets are gone: your references and LoRAs set the look
  const refs = useMakeRefs();
  // the prompt history groups prompts by the pictures they went with (and can put those pictures back)
  useEffect(() => registerPics("create", () => { const r = useMakeRefs.getState(); return ([["1", r.pic1], ["2", r.pic2], ["place", r.place]] as const).filter(([, m]) => m).map(([slot, m]) => ({ name: m!.name, url: m!.url, label: m!.label, slot })); },
    (pics) => { const at = (k: string) => { const p = pics.find((x) => x.slot === k); return p ? ({ kind: "image", name: p.name, url: p.url, label: p.label ?? p.name } as Media) : null; };
      const a = at("1"); useMakeRefs.setState({ pic1: a, pic1Own: !!a, pic2: at("2"), place: at("place"), remixOf: null, remixBase: null }); }), []);
  // remixing a picture works with exact prompts too (a CivitAI prompt you remix keeps its words)
  const usingRefs = (!c.raw || !!refs.remixOf) && !!(refs.pic1 || refs.pic2 || refs.place);
  // a picture dragged or sent here (a result, a tray item, a CivitAI post) becomes the reference / the picture to change
  useHandoffInto("create", (items) => { const m = items.find((x) => x.media.kind === "image")?.media; if (m) useMakeRefs.setState({ pic2: m }); });

  // the writer: off = your words go to the model exactly as typed (character, pictures and LoRAs still apply)
  const writerOn = anime ? c.animeTags !== false : c.polish === true;
  const cast = c.cast ?? "solo";
  const gender: Gender = ch && person ? ch.gender : c.subject === "man" ? "male" : "female";
  const positiveFor = (extraIn: string) => {
    const c_ = { ...c, extra: extraIn };
    if (c.raw) {
      // exact prompt (e.g. from a CivitAI example): only strip <lora:…> tags and make sure people are adults
      const p = c_.extra.replace(/<lora:[^>]+>/gi, "").replace(/\s+,/g, ",").replace(/,\s*,+/g, ",").trim().replace(/^,|,$/g, "").trim();
      return /\b(\d?girls?|\d?boys?|wom[ae]n|m[ae]n|female|male|person|people)\b/i.test(p) && !/\badult\b/i.test(p) ? `${p}, adult` : p;
    }
    const who = c.subject === "woman";
    if (anime) {
      const q = qualityTags(m);
      const subj = person ? (who ? "adult, mature female" : "adult, mature male") : "no humans, scenery";
      // how many people: set once, from "Who's in it" (count tags anywhere else are taken out)
      const count = person ? castTags(gender, cast) : "";
      // with a character the pose comes only from your words (the Pose button) — a pose kept from the old field was sent
      // along unseen and blended with the one you typed
      const person_ = ch ? [stripCountTags(animeTags(ch))] : [subj, c.hair, c.eyes, c.outfit, c.pose];
      const bg = c.make === "character" ? (c.cutout ? "simple background, white background" : "") : c.background;
      return clean([q, count, ...(person ? person_ : [subj]), bg, person ? stripCountTags(c_.extra) : c_.extra, look].join(", "));
    }
    const sentence = !person ? `A photo of ${c.background}, no people.`
      : ch ? `A photo of ${looks(ch).replace(/^A /, "a ")}`
      : `A photo of an adult ${who ? "woman" : "man"}${c.hair ? ` with ${c.hair}` : ""}${c.eyes ? `, ${c.eyes}` : ""}${c.outfit ? `, wearing ${c.outfit}` : ""}${c.pose ? `, ${c.pose}` : ""}.`;
    const bg = c.make === "scene" ? ` Setting: ${c.background}.` : c.make === "character" && c.cutout ? " Plain white studio background." : "";
    return `${sentence}${bg}${c_.extra ? ` ${c_.extra}.` : ""}${look ? ` ${look}` : ""}${person ? ` ${castSentence(gender, cast)}` : ""}`.replace(/\.\./g, ".");
  };
  const positive = positiveFor(c.extra);

  // a new character: their own front picture again, and their model + checkpoint (anime stays anime, realistic stays Krea 2)
  useEffect(() => {
    useMakeRefs.setState({ pic1Own: false });
    if (!ch || !person) return;
    const mo = charModel(ch), ck = charCkpt(ch);
    if (m.model !== mo || (ck && c.checkpoint?.[mo] !== ck)) {
      set({ ...pickModel(mo), ...(ck ? { checkpoint: { ...c.checkpoint, [mo]: ck } } : {}) });
      toast(`${ch.name} is ${ch.style}: Create uses ${mo === "krea2" ? "Krea 2" : mo === "noob" ? "Illustrious" : "Anima"}${ck ? " with their checkpoint" : ""}`, "info");
    }
  }, [ch?.id, ch?.style, ch?.animeModel]); // eslint-disable-line react-hooks/exhaustive-deps
  const pic1Own = useMakeRefs((st) => st.pic1Own);
  const fromWords = startsFromWords(c.startFrom, ch);
  useEffect(() => {
    if (useMakeRefs.getState().pic1Own) return;
    if (!ch?.views.front || fromWords) { useMakeRefs.setState({ pic1: null }); return; }
    let alive = true;
    useCharacters.getState().asMedia(ch.id, "front").then((md) => { if (alive && !useMakeRefs.getState().pic1Own) useMakeRefs.setState({ pic1: md }); }).catch(() => {});
    return () => { alive = false; };
  }, [ch?.id, ch?.views.front, pic1Own, fromWords]); // eslint-disable-line react-hooks/exhaustive-deps
  // Remix: show the picture you're remixing, small, in the prompt box
  const pending = useRemix((st) => st.pending);
  useEffect(() => { if (pending?.tab === "create" && pending.source) useMakeRefs.setState({ remixOf: pending.source }); }, [pending]);
  const dl = useGroup(m.group);
  useDownloads((st) => st.groups);
  const refDl = useGroup(editGroup(anime ? animeEngine(person ? ch : null) : "krea"));
  const why = usingRefs ? (!refDl.ready ? refDl.why : busy ? "Sending…" : undefined)
    : !dl.ready ? dl.why : (!positive.trim() ? "Describe something first" : busy ? "Sending…" : undefined);
  const etaKey = `create:${m.model}:${c.shape}:${c.count}${up > 1.01 ? `:x${up}` : ""}`;
  const queue = async (over: { loras?: LoraPick[]; seed?: number; count?: number; label?: string; sweep?: { name: string; strength: number } } = {}) => {
    const seed = over.seed ?? seedFor(adv, setAdv);
    const count = over.count ?? c.count;
    // LoRAs fitted into what the model holds (character leads, sliders apart) unless you switched that off
    let ls = over.loras ?? loras;
    let allLs = mergeLoras(ls, charLoras(person ? ch : null, m.family as "krea2" | "anima" | "sdxl"));
    if (c.balance !== false && !over.sweep) {
      const r = balanceLoras(allLs, await loraLibrary().catch(() => []), BUDGET[(m.family === "sdxl" ? "sdxl" : m.family === "anima" ? "anima" : "krea2") as BudgetKey]);
      if (r.changed.length) { allLs = r.loras; ls = ls.map((l) => r.loras.find((x) => x.name === l.name) ?? l); toast(`LoRAs balanced for this picture: ${r.changed.join(", ")}`, "info"); }
    }
    // Remix with words added after the old prompt: the writer works them in (replacing what they contradict)
    const base = useMakeRefs.getState().remixBase;
    const words = writerOn && base && c.extra.trim().startsWith(base.trim()) && c.extra.trim() !== base.trim()
      ? await mergeRemix(c.extra, base).catch((e) => { toast(`Added your words as typed: ${(e as Error).message}`, "info"); return c.extra; }) : c.extra;
    // anime + plain words: the local writer turns them into tags first (see them under the prompt box)
    const extra = anime && writerOn && !c.raw && looksPlain(words) ? await toTags(words, person ? ch : null).catch((e) => { if (/under 18/i.test((e as Error).message)) throw e; toast(`Sent your words as typed: ${(e as Error).message}`, "info"); return words; }) : words;
    // realistic + plain words: the local writer turns them into a precise Krea 2 prompt (see it under the prompt box)
    const polished = !anime && !c.raw && writerOn && looksPlain(words)
      ? await polishKrea(person ? `${words} ${castSentence(gender, cast)}` : words, person ? ch : null, c.shape).catch((e) => { if (/under 18/i.test((e as Error).message)) throw e; toast(`Sent your words as typed: ${(e as Error).message}`, "info"); return null; })
      : null;
    const bgLine = c.make === "character" && c.cutout ? " Plain white studio background." : "";
    const positiveSent = polished ? `${polished}${bgLine}` : positiveFor(extra);
    const graph = buildCreate({
      ...adv, seed, ...modelArgs(c, m), positive: positiveSent, negative: c.negative, loras: allLs, width: w, height: h, count, hires,
      cutout: !c.raw && person && c.make === "character" && c.cutout, prefix: `studio/create/${c.style}`,
    });
    const label = over.label ?? `${count} ${anime ? "anime" : "realistic"} ${c.make === "background" ? "background" : c.make === "scene" ? "scene" : "character"}${count > 1 ? "s" : ""}`;
    const remixed = useMakeRefs.getState().remixOf;
    // what was actually sent, shown with the picture (full screen → How it was made)
    const sent: SentInfo = { prompt: withTriggers(positiveSent, allLs), words: c.extra, negative: c.negative, model: m.label, checkpoint: c.checkpoint?.[m.model as "krea2"] || "official",
      loras: allLs.filter((l) => !l.off).map((l) => ({ name: l.name, strength: l.strength })),
      size: `${w}×${h}${hires ? ` → ${r16(w * up)}×${r16(h * up)}` : ""}`, seed, steps: adv.steps, cfg: adv.cfg, sampler: adv.sampler, scheduler: adv.scheduler, character: person && ch ? ch.name : undefined };
    await run("create", label, graph, over.sweep ? `create:${m.model}:${c.shape}:1` : etaKey, { sent, ...(remixed ? { stack: trayIdOf(remixed.out) } : {}), sweep: over.sweep, ...(c.faceFix && !over.sweep && person && c.make !== "background" ? { faceFix: { character: ch?.id ?? null, strength: c.faceStrength ?? 0.45 } } : {}), snapshot: { section: "create", settings: { ...c, [lorasKey]: ls, [advKey]: { ...adv, seed, lockSeed: true } } } });
  };
  const go = async () => {
    if (why) return;
    remember("create", c.extra, "sent");
    setBusy(true);
    // don't hold the button: the prompt writer may wait in line behind a video — you can keep pressing Generate
    setTimeout(() => setBusy(false), 600);
    try {
      if (usingRefs) {
        const r = useMakeRefs.getState();
        const remixing = !!r.remixOf;
        await makeWithRefs({
          c: person ? ch : null, anime, prompt: c.extra, asTyped: !writerOn, count: c.count, loras, cast, gender, outfit: c.outfitFrom ?? "character", balance: c.balance !== false,
          ...(remixing ? { strength: r.strength, stack: trayIdOf(r.remixOf!.out) } : {}),
          snapshot: { section: "create", settings: { ...c } },
          ...(c.faceFix && person ? { faceFix: { character: ch?.id ?? null, strength: c.faceStrength ?? 0.45 } } : {}),
          label: remixing ? `Remix${ch && person && r.pic1 ? ` · ${ch.name}` : ""}` : `${ch && person ? ch.name : "Picture"} · ${r.pic1 && r.pic2 ? TAKES.find((t) => t.value === r.take)!.label.toLowerCase() : "from a picture"}`,
        });
      } else await queue();
    } catch (e) { toast(`Couldn't start: ${(e as Error).message}`, "bad"); }
  };
  const sweep = async (l: LoraPick, title: string) => {
    if (why) return toast(why, "bad");
    const r = await askSweep(title, false, l.strength);
    if (!r) return;
    const seed = adv.lockSeed && adv.seed ? adv.seed : newSeed();
    try {
      for (const v of r.values) await queue({ seed, count: 1, label: `${title} · strength ${v.toFixed(1)}`, sweep: { name: l.name, strength: v }, loras: loras.map((x) => (x.name === l.name ? { ...x, strength: v, off: false } : x)) });
      toast(`Making ${r.values.length} pictures of the same seed — compare them in Results.`, "info");
    } catch (e) { toast(`Couldn't start: ${(e as Error).message}`, "bad"); }
  };
  const setLoras = (v: LoraPick[]) => set({ [lorasKey]: v });
  // a LoRA for another model: switch Create to that model and add it there
  const onFamily = (fam: "sdxl" | "anima" | "krea2", pick: LoraPick) => {
    const mo = fam === "sdxl" ? "noob" : fam;
    const mi = modelOf(c, undefined, mo);
    set({ ...pickModel(mo), [mi.lorasKey]: [...mi.loras.filter((x) => x.name !== pick.name), pick] });
  };
  // the LoRA creator's tips: negative words straight away, the sampler settings when you press "use"
  const onTips = (t: LoraTips, how: "auto" | "all") => {
    if (t.negative && !c.negative.toLowerCase().includes(t.negative.toLowerCase().slice(0, 24))) {
      set({ negative: [c.negative, t.negative].filter(Boolean).join(", ") });
      toast(`Added the LoRA creator's negative words: ${t.negative.slice(0, 80)}`, "info");
    }
    if (how === "all") {
      const ms = mapSampler(t.sampler ?? "", t.scheduler ?? "");
      setAdv({ ...(ms.sampler ? { sampler: ms.sampler } : {}), ...(ms.scheduler ? { scheduler: ms.scheduler } : {}), ...(t.cfg != null ? { cfg: t.cfg } : {}), ...(t.steps != null ? { steps: t.steps } : {}) });
      toast(`Using the creator's settings: ${tipsLine(t) || "strength"}`, "good");
    }
  };
  usePrimaryAction("create", go);

  const chips = (
    <>
      <Chip title="Model" value={m.model} onChange={(v) => set(pickModel(v))} options={CREATE_MODELS.map((x) => ({ value: x.model, label: x.short, group: x.style === "anime" ? "Anime" : "Realistic", hint: MODEL_HINT[x.model] }))} />
      <Chip title="Prompt" value={c.raw ? 1 : 0} onChange={(v) => set({ raw: v === 1 })} options={[{ value: 0, label: "Built from settings" }, { value: 1, label: "Exact prompt" }]} />
      {!c.raw && <Chip title="What to make" value={c.make} onChange={(v) => set({ make: v })} options={[{ value: "character", label: "Character" }, { value: "background", label: "Background" }, { value: "scene", label: "Full scene" }]} />}
      {!anime && <Chip title="Size" value={c.draft ? "draft" : "full"} onChange={(v) => set({ draft: v === "draft" })} options={[{ value: "full", label: "Full · ~2 MP" }, { value: "draft", label: "Draft · ~1 MP, 2× faster" }]} />}
      <Chip title="Shape" value={c.shape} onChange={(v) => set({ shape: v })} options={(Object.keys(SHAPE_NAME) as (keyof typeof SHAPE_NAME)[]).map((k) => ({ value: k, label: `${SHAPE_NAME[k]} ${SIZES[c.style][k].join("×")}` }))} />
      <Chip title="Finish at" value={up} onChange={(v) => set({ upscale: v })} options={[1, 1.25, 1.5, 1.75].map((x) => ({ value: x, label: x === 1 ? `Model size ${w}×${h}` : `${x === 1.5 ? "2K" : x === 1.75 ? "2.5K" : "Large"} ${r16(w * x)}×${r16(h * x)}` }))} />
      {refs.remixOf && usingRefs && <Chip title="How much may change" value={refs.strength} onChange={(v) => useMakeRefs.setState({ strength: v })} options={[{ value: 0.35, label: "Change: a little" }, { value: 0.6, label: "Change: some" }, { value: 0.8, label: "Change: a lot" }, { value: 1, label: "Change: anything (new picture)" }]} />}
      {!c.raw && <Chip title="The writer (on the rental) — off: your words go to the model exactly as typed" value={writerOn ? 1 : 0} onChange={(v) => set(anime ? { animeTags: v === 1 } : { polish: v === 1 })}
        options={[{ value: 0, label: "Words as typed" }, { value: 1, label: anime ? "Writer makes tags" : "Writer rewrites" }]} />}
      <Chip title="How many" value={c.count} onChange={(v) => set({ count: v })} options={[1, 2, 4, 6, 8].map((n) => ({ value: n, label: `×${n}` }))} />
      {!c.raw && c.make === "character" && <Chip title="Background" value={c.cutout ? 1 : 0} onChange={(v) => set({ cutout: v === 1 })} options={[{ value: 0, label: "With background" }, { value: 1, label: "Cut out" }]} />}
      {person && !c.raw && <Chip title="Who's in the picture" value={cast} onChange={(v) => set({ cast: v })} options={CAST_OPTIONS} />}
      <WordBankButton value={c.extra} onChange={(v) => set({ extra: v })} />
      {ch && person && !c.raw && <span className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-accent/60 bg-accent/10 px-3 text-[12.5px]">{ch.name}<button aria-label="Stop using this character" className="text-muted hover:text-ink" onClick={() => set({ characterId: null })}>×</button></span>}
    </>
  );
  // @ in the box: a character becomes the star, a picture becomes Picture 2 (the look / pose / scene to copy)
  const mention: MentionTarget = {
    hint: { character: "the star of the picture — their look and LoRAs", picture: "Picture 2 — copy its look, pose or scene" },
    pick: async (p) => {
      if (p.kind === "character") { set({ characterId: p.c.id }); return p.c.name; }
      const md = await useTray.getState().asMedia(p.item.id);
      useMakeRefs.setState({ pic2: md, remixOf: null, remixBase: null });
      if (c.raw) { set({ raw: false }); useJobs.getState().toast("Switched off “exact prompt” so Picture 2 is used", "info"); }
      return "picture 2";
    },
  };
  return (
    <Workspace needs={m.group} tab="create" title="Create" sub={`${anime ? "Anime" : "Realistic"} with ${m.label}`}
      bar={<PromptBar value={c.extra} onChange={(v) => set({ extra: v })} chips={chips} minRows={2} rewrite="create" pose="describe"
        lead={<BarPictures />} mention={mention}
        below={<>{usingRefs && <LastSent />}{c.raw && c.extra.trim() ? <PiecesToggle value={c.extra} onChange={(v) => set({ extra: v })} /> : null}{!c.raw && (anime || !usingRefs) && <TagsLine anime={anime} on={writerOn} preview={positive} text={c.extra} onUse={(t) => set({ extra: t })} write={() => (anime ? toTags(c.extra, person ? ch : null) : polishKrea(c.extra, person ? ch : null, c.shape))} />}</>}
        placeholder={c.raw ? "Paste or write the full prompt — it's sent exactly as typed…"
          : refs.remixOf && usingRefs ? "What should change? e.g. “she's laughing, night time, red dress” — or keep the prompt and press Generate for a new take"
          : usingRefs ? (refs.pic1 && refs.pic2 ? "Anything to change? e.g. “make it night, she's laughing” — or leave empty to copy it as it is" : "Say what to make with this picture, in plain words…")
          : anime ? "Say what you want in plain words — e.g. “she's sitting on a rooftop at night, wind in her hair, looking back” (it becomes tags for you)…" : "Say what you want in plain words — the writer turns it into a detailed Krea 2 prompt…"}
        action={<GoButton onClick={go} disabled={!!why} why={why}>Generate <EtaText k={etaKey} prefix="· " /></GoButton>} />}
      drawer={<>
        {c.raw && (
          <div className="card rounded-xl border border-accent/60 p-3 text-[12.5px] leading-relaxed text-muted">
            <b className="text-ink">Exact prompt is on.</b> The prompt box is sent as typed — character, hair, outfit and look settings are skipped.
            <button className="mt-1.5 block text-accent hover:underline" onClick={() => set({ raw: false })}>Go back to building it from settings</button>
          </div>
        )}
        {!c.raw && <References ch={person ? ch : null} anime={anime} words={c.extra} />}
        {!c.raw && person && !ch && (
          <>
            <Seg label="Character" value={c.subject} onChange={(v) => set({ subject: v })} options={[{ value: "woman", label: "Adult woman" }, { value: "man", label: "Adult man" }]} />
            <div className="grid grid-cols-2 gap-2.5">
              <TextIn label="Hair" value={c.hair} onChange={(v) => set({ hair: v })} />
              <TextIn label="Eyes" value={c.eyes} onChange={(v) => set({ eyes: v })} />
              <TextIn label="Outfit" value={c.outfit} onChange={(v) => set({ outfit: v })} />
              <TextIn label="Pose" value={c.pose} onChange={(v) => set({ pose: v })} />
            </div>
          </>
        )}
        {!c.raw && c.make !== "character" && <TextIn label="Background" value={c.background} onChange={(v) => set({ background: v })} />}
        <CheckpointPicker model={m.model} value={c.checkpoint?.[m.model]} onChange={(v) => set({ checkpoint: { ...c.checkpoint, [m.model]: v } })}
          onModel={(mo, ck) => set({ ...pickModel(mo as Parameters<typeof pickModel>[0]), checkpoint: { ...c.checkpoint, [mo]: ck } })} />
        {m.family === "krea2" && <KreaEncoder />}
        {m.family === "krea2" && <KreaBoost />}
        <WriterChoice />
        <PresetBar section="create" />
        <LoraList family={m.family} label={`LoRAs · ${m.label}`} value={loras} onChange={setLoras} onSweep={sweep} onFamily={onFamily} onTips={onTips} />
        <label className="-mt-2 flex cursor-pointer items-start gap-2 text-[12px] leading-relaxed text-muted" title="When you generate, the LoRAs (yours + your character's) are fitted into what the model holds: the character LoRA leads at its creator's strength, the others share the rest, sliders are left alone. Your settings here don't change.">
          <input type="checkbox" className="mt-0.5" checked={c.balance !== false} onChange={(e) => set({ balance: e.target.checked })} />
          <span><b className="font-medium text-ink">Keep LoRAs balanced</b> — stops stacks from going blotchy. The character LoRA leads; sliders don't count.</span>
        </label>
        <FaceFix on={!!c.faceFix} strength={c.faceStrength ?? 0.45} onChange={(p) => set({ ...(p.on != null ? { faceFix: p.on } : {}), ...(p.strength != null ? { faceStrength: p.strength } : {}) })} />
        <TextArea label="Negative prompt · never show" help="negative" rows={2} value={c.negative} onChange={(v) => set({ negative: v })} />
        <Advanced a={adv} set={setAdv}>
          <details className="text-xs text-muted"><summary className="cursor-pointer">What gets sent</summary><p className="mt-1.5 font-mono leading-relaxed text-ink/80">{withTriggers(positive, loras)}</p></details>
        </Advanced>
      </>}>
      <Feed tab="create" extra={({ j }) => {
        const sw = j.meta?.sweep as { name: string; strength: number } | undefined;
        return sw ? [{ label: `Use strength ${sw.strength.toFixed(1)}`, icon: "check", run: () => { setLoras(loras.map((x) => (x.name === sw.name ? { ...x, strength: sw.strength, off: false } : x))); toast(`Strength set to ${sw.strength.toFixed(1)}`, "good"); } }] : [];
      }} empty={<CreateStarters who={person ? ch?.name : undefined} onWords={(t) => set({ extra: t })} />} />
    </Workspace>
  );
}

/** Exact prompts are often a wall of tags: show them as labelled pieces you can select and change */
function PiecesToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line px-4 py-2">
      <button className="text-[12px] text-muted hover:text-ink" onClick={() => setOpen((o) => !o)}>{open ? "▾" : "▸"} Break it into pieces <span className="text-dim">— select parts and change them in plain words</span></button>
      {open && <PromptPieces className="mt-2" value={value} onChange={onChange} tab="create" />}
    </div>
  );
}

/** Picture 1 = your character, Picture 2 = the reference — what Create works from when they're filled */
/** with pictures: your character's own outfit, or the clothes of the person in picture 2 */
function OutfitFrom() {
  const [c, set] = useSection("create");
  const v = c.outfitFrom ?? "character";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-muted">Outfit</span>
      <div className="flex flex-wrap gap-1">
        {([["character", "Their own outfit"], ["picture", "Picture 2's clothes"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => set({ outfitFrom: k })} className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", v === k && "on")}>{l}</button>
        ))}
      </div>
    </div>
  );
}

/** Picture → prompt: write picture 2's pose / place / outfit (or all of it) into the prompt box, without anyone's looks */
function ReadPicture({ pic, anime }: { pic: import("../lib/tray").Media; anime: boolean }) {
  const [c, set] = useSection("create");
  const ch = useCharacters((s) => s.list.find((x) => x.id === c.characterId) ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useJobs((s) => s.toast);
  const g: Gender = ch ? ch.gender : c.subject === "man" ? "male" : "female";
  const people = { solo: `one ${nounOf(g)}`, plusMan: `one ${nounOf(g)} and one man`, plusWoman: `one ${nounOf(g)} and one woman`, group: "a group of adults" }[c.cast ?? "solo"];
  const go = async (focus: "all" | "pose" | "scene" | "outfit") => {
    setBusy(focus);
    try {
      const out = await readPicture(pic, focus, anime, people);
      set({ extra: out, raw: false });
      useWordBank.getState().addPrompt(`read:${pic.name}:${focus}`, out, pic.url);
      toast(`Picture 2's ${focus === "all" ? "whole picture" : focus === "scene" ? "place" : focus} is in the prompt box (and the word bank). Clear picture 2 to make it from words with your character, or keep it to insert them.`, "good");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(null); }
  };
  return (
    <div className="flex flex-wrap items-center gap-1 text-[12px] text-muted">
      <span className="mr-1">Read picture 2 into the prompt:</span>
      {([["all", "all of it"], ["pose", "pose"], ["scene", "place"], ["outfit", "outfit"]] as const).map(([k, l]) => (
        <button key={k} disabled={!!busy} onClick={() => go(k)} className="press tag-btn !h-7 !px-2 !text-[12px] disabled:opacity-50">{busy === k ? "Reading…" : l}</button>
      ))}
    </div>
  );
}

/** what the last press with pictures actually told the edit — to see why a result came out the way it did */
function LastSent() {
  const ls = useMakeRefs((s) => s.lastSent);
  if (!ls) return null;
  return (
    <details className="border-t border-line2 px-4 py-2 text-[12px] text-muted">
      <summary className="cursor-pointer select-none">What the edit was told{ls.balanced?.length ? " · LoRAs balanced" : ""}</summary>
      <div className="mt-1.5 flex flex-col gap-1 leading-relaxed">
        <span><b className="font-medium text-ink">Pictures:</b> {ls.pictures.map((p, i) => `${i + 1}) ${p}`).join("  ")}</span>
        {ls.changes != null && <span><b className="font-medium text-ink">Changes from your words:</b> {ls.changes || "none — keep the picture as it is"}</span>}
        <span className="font-mono text-[11.5px] text-ink/85">{ls.instruction}</span>
        <span><b className="font-medium text-ink">LoRAs:</b> {ls.loras.length ? ls.loras.join(" · ") : "none"} (+ the identity-edit LoRA){ls.balanced?.length ? ` — balanced: ${ls.balanced.join(", ")}` : ""}</span>
        <button className="self-start text-accent hover:underline" onClick={() => copyText([`Pictures: ${ls.pictures.join(" | ")}`, `Changes: ${ls.changes ?? ""}`, `Instruction: ${ls.instruction}`, `LoRAs: ${ls.loras.join(", ")}`, `Balanced: ${(ls.balanced ?? []).join(", ")}`].join("\n"), "Copied — paste it to Claude")}>Copy for Claude</button>
      </div>
    </details>
  );
}

/** how closely to follow picture 2's layout and pose — the edit model copies it exactly unless told it may let go */
function FollowRef({ words, take }: { words: string; take: Take }) {
  const follow = useMakeRefs((st) => st.follow);
  const now = followFor(words, take, follow);
  const opts: { v: "auto" | number; label: string; hint: string }[] = [
    { v: "auto", label: "Auto", hint: "Copies the pose, unless your words describe a different one" },
    { v: 1, label: "Exactly", hint: "Same pose, framing and layout as picture 2" },
    { v: 0.7, label: "Loosely", hint: "Similar layout; your words can move the pose" },
    { v: 0.45, label: "Just the feel", hint: "Its look and mood only — pose and framing come from your words" },
  ];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-muted">Follow picture 2's pose and layout</span>
      <div className="flex flex-wrap gap-1">
        {opts.map((x) => <button key={String(x.v)} title={x.hint} onClick={() => useMakeRefs.setState({ follow: x.v })} className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", follow === x.v && "on")}>{x.label}</button>)}
      </div>
      <p className="text-[11.5px] leading-relaxed text-dim">{follow === "auto"
        ? (now < 1 ? "Your words describe a pose, so it loosens its grip on picture 2's pose." : take === "pose" || take === "face" ? "Copying picture 2's pose (that's what this take is for)." : "Copying picture 2's pose — describe a different one (e.g. “sitting, looking back”) and it lets go.")
        : opts.find((x) => x.v === follow)!.hint + "."}</p>
    </div>
  );
}

/** with a character: words only (text to image, their LoRA does the face) or their picture as picture 1 */
export function startsFromWords(start: CreateStart | undefined, ch: { loras?: { off?: boolean }[] } | null) {
  if (!ch) return false;
  const s = start ?? "auto";
  return s === "words" || (s === "auto" && !!ch.loras?.some((l) => !l.off));
}
type CreateStart = "auto" | "picture" | "words";

function References({ ch, anime, words }: { ch: ReturnType<typeof useCharacters.getState>["list"][number] | null; anime: boolean; words: string }) {
  const r = useMakeRefs();
  const setTab = useSettings((st) => st.setTab);
  const start = useSettings((st) => st.s.create.startFrom ?? "auto");
  const fromWords = startsFromWords(start, ch);
  const hasLora = !!ch?.loras?.some((l) => !l.off);
  const pick = (v: CreateStart) => { useSettings.getState().set("create", { startFrom: v }); useMakeRefs.setState({ pic1Own: false }); };
  return (
    <div className="card flex flex-col gap-2.5 border border-line p-3">
      {ch && <div className="flex flex-col gap-1">
        <span className="lbl">Make {ch.name} from</span>
        <div className="grid grid-cols-2 gap-1">
          {([["words", "Words only", hasLora ? "their LoRA keeps the face" : "no LoRA yet: the face will drift"], ["picture", "Their picture", "edits their front picture"]] as const).map(([v, l, hint]) => (
            <button key={v} onClick={() => pick(v)} aria-pressed={(v === "words") === fromWords}
              className={cx("press flex flex-col items-start border px-2.5 py-1.5 text-left", (v === "words") === fromWords ? "border-accent bg-accent/10" : "border-line hover:border-line2")}>
              <span className="text-[12.5px] font-medium">{l}</span><span className={cx("text-[11px]", v === "words" && !hasLora ? "text-hot" : "text-dim")}>{hint}</span>
            </button>
          ))}
        </div>
        <span className="text-[11px] text-dim">{start === "auto" ? `Automatic: ${hasLora ? "words, because they have a LoRA" : "their picture, until they have a LoRA"}.` : <>Your pick. <button className="text-accent hover:underline" onClick={() => pick("auto")}>Back to automatic</button></>}</span>
      </div>}
      <div className="flex items-center"><span className="lbl flex-1">Pictures to work from</span>
        {(r.pic2 || r.pic1Own || r.place) && <button className="text-[12px] text-muted hover:text-ink" onClick={() => useMakeRefs.setState({ pic2: null, pic1Own: false, pic1: null, place: null, remixOf: null, remixBase: null })}>clear</button>}</div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <Label><span className="flex items-center gap-1.5 truncate">{ch ? `1 · ${ch.name}` : "1 · your character"}{ch && !r.pic1Own && <span className="rounded-full border border-accent/60 px-1.5 text-[10px] font-medium normal-case tracking-normal text-accent" title="Their whole sheet is used: the view closest to the angle in your words">character · {Object.keys(ch.views).filter((k) => !["sheet", "cutout"].includes(k)).length} views</span>}</span></Label>
          <Slot className="h-36" value={r.pic1} label={ch ? "Their front picture" : "Pick a character on the left"} onChange={(v) => {
            // a picture from a character's sheet: use that character with their whole sheet, not as a loose picture
            const m = v?.trayId?.match(/^kept\/characters\/([^/]+)\/(?:prev_)?(\w+)\.png$/);
            const owner = m && useCharacters.getState().list.find((x) => x.id === m[1]);
            if (owner) {
              useSettings.getState().set("create", { characterId: owner.id });
              const view = m![2] as View;
              useMakeRefs.setState((st) => ({ pic1Own: false, pic1: null, sheetViews: VIEWS.some((x) => x.id === view) && !st.sheetViews.includes(view) ? [...st.sheetViews, view] : st.sheetViews }));
              useJobs.getState().toast(`${owner.name} — their sheet pictures go in together`, "info");
              return;
            }
            useMakeRefs.setState({ pic1: v, pic1Own: !!v });
          }} />
          {ch && !ch.views.front && <button className="mt-1 text-[11.5px] text-accent hover:underline" onClick={() => setTab("characters")}>Make their front picture</button>}
          {!r.pic1 && !(ch && !ch.views.front) && <PicturePicker what="picture 1" onPick={(m) => useMakeRefs.setState({ pic1: m, pic1Own: true })} />}
        </div>
        <div>
          <Label><span className="block truncate">{r.remixOf ? "2 · the picture you're changing" : "2 · reference"}</span></Label>
          <Slot className="h-36" value={r.pic2} label="A pose, scene, CivitAI post — or a result to change" onChange={(v) => useMakeRefs.setState({ pic2: v, ...(v ? {} : { remixOf: null, remixBase: null }) })} />
          {!r.pic2 && <PicturePicker what="reference" onPick={(m) => useMakeRefs.setState({ pic2: m, remixOf: null, remixBase: null })} civitai={() => pickFromCivitai({ kind: "ref", slot: "pic2" })} />}
        </div>
      </div>
      {!r.remixOf && (
        <div>
          <Label>3 · the place (optional)</Label>
          <div className="grid grid-cols-[96px_1fr] items-start gap-2.5">
            <Slot className="h-24" value={r.place} label="A background" hint="room, street, beach…" onChange={(v) => useMakeRefs.setState({ place: v })} />
            <div className="flex flex-col gap-1">
              <p className="text-[11.5px] leading-relaxed text-dim">{r.place ? "Your character goes into this place (with picture 2's pose, if there is one). Three pictures run as an Edit chat message: Qwen-Image-Edit takes all three, then Krea 2 repaints with their LoRA and the face pass." : "Drop a place — a room or location from Pinterest, CivitAI or your results — and they're put into it."}</p>
              {!r.place && <PicturePicker what="place" onPick={(m) => useMakeRefs.setState({ place: m })} civitai={() => pickFromCivitai({ kind: "ref", slot: "place" })} />}
            </div>
          </div>
        </div>
      )}
      {ch && !r.pic1Own && ch.views.front && <SheetPick ch={ch} />}
      {r.remixOf && r.pic2 && <p className="text-[11.5px] leading-relaxed text-dim">Remix: picture 2 is changed by your words, as much as “How much may change” allows. Words you add after the old prompt are worked into it by the writer. Your character's pictures aren't used — they're already in it.</p>}
      {r.pic1 && r.pic2 && !r.remixOf && (
        <div className="flex flex-col gap-1">
          <span className="text-[12px] text-muted">Take from picture 2</span>
          <div className="flex flex-wrap gap-1">
            {TAKES.filter((t) => t.value !== "face" || (ch && !r.pic1Own)).map((t) => <button key={t.value} title={t.hint} onClick={() => useMakeRefs.setState({ take: t.value })} className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", r.take === t.value && "on")}>{t.label}</button>)}
          </div>
          <p className="text-[11.5px] leading-relaxed text-dim">{TAKES.find((t) => t.value === r.take)!.hint}. {r.take === "remake" ? "Anything you type is added at the end." : <>{anime ? "Drawn by Anima / Illustrious with their tags and LoRAs." : r.take === "look" ? "Made by Krea 2 Edit, keeping their face — only the outline of the person in picture 2 is redrawn, so they're replaced, not joined." : "Made by Krea 2 Edit, keeping their face."} Type only what should be different (“night time, red dress”). A long copied prompt is boiled down to its changes — open “What the edit was told” under the prompt box to see exactly what was sent.</>}</p>
          {<Slider label="Their look ↔ the reference" min={1} max={8} step={0.5} value={r.hold} show={r.hold <= 2 ? "follows the reference" : r.hold >= 6 ? "strictly their look" : "balanced"}
            onChange={(v) => useMakeRefs.setState({ hold: v })} />}
        </div>
      )}
      {r.pic1 && r.pic2 && !r.remixOf && r.take !== "face" && <OutfitFrom />}
      {r.pic2 && !r.remixOf && <FollowRef words={words} take={r.pic1 ? r.take : "look"} />}
      {r.pic2 && <ReadPicture pic={r.pic2} anime={anime} />}
      {!r.pic1 && !r.pic2 && <p className="text-[11.5px] leading-relaxed text-dim">Empty = make it from words only. Drop a picture in 2 (or right-click any picture → Use in Create) to copy its look with your character.</p>}
    </div>
  );
}

/** which of the character's sheet pictures go in with Picture 1 — shown side by side to the edit model as one picture */
function SheetPick({ ch }: { ch: Character }) {
  const views = useMakeRefs((st) => st.sheetViews);
  const have = VIEWS.filter((v) => v.id !== "sheet" && v.id !== "cutout" && ch.views[v.id]);
  const sheet = !!ch.views.sheet;
  const useSheet = sheet && views.includes("sheet");
  if (have.length < 2 && !sheet) return null;
  // the one-picture character sheet goes in alone; ticking a single angle switches back to angles
  const toggle = (v: View) => { if (v === "front") return; const rest: View[] = views.filter((x) => x !== "sheet"); useMakeRefs.setState({ sheetViews: rest.includes(v) ? rest.filter((x) => x !== v) : [...rest, v] }); };
  const on = useSheet ? [] : have.filter((v) => v.id === "front" || views.includes(v.id));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center"><span className="text-[12px] text-muted">From {ch.name}'s sheet · {useSheet ? "the character sheet" : `${on.length} picture${on.length > 1 ? "s" : ""}`}</span>
        {!useSheet && <button className="ml-auto text-[11px] text-muted hover:text-ink" onClick={() => useMakeRefs.setState({ sheetViews: views.length > 3 ? SHEET_DEFAULT : have.map((v) => v.id) })}>{views.length > 3 ? "fewer" : "all"}</button>}</div>
      <div className="flex flex-wrap gap-1">
        {sheet && (
          <button onClick={() => useMakeRefs.setState({ sheetViews: useSheet ? SHEET_DEFAULT : ["sheet"] })} title={useSheet ? "Use separate angles instead" : "Use the one-picture character sheet (six views) instead of separate angles"} aria-pressed={useSheet}
            className={cx("press relative h-14 w-20 overflow-hidden border", useSheet ? "border-accent" : "border-line opacity-45 hover:opacity-80")}>
            <img src={viewUrl(ch.views.sheet!)} alt="Character sheet" className="h-full w-full object-cover" />
            <span className="micro absolute inset-x-0 bottom-0 bg-black/70 text-center text-[8px] text-white/85">SHEET</span>
          </button>
        )}
        {have.map((v) => {
          const sel = !useSheet && (v.id === "front" || views.includes(v.id));
          return (
            <button key={v.id} onClick={() => toggle(v.id)} title={v.id === "front" ? "Front — always in" : `${sel ? "Leave out" : "Add"} ${v.label.toLowerCase()}`} aria-pressed={sel}
              className={cx("press relative h-14 w-10 overflow-hidden border", sel ? "border-accent" : "border-line opacity-45 hover:opacity-80")}>
              <img src={viewUrl(ch.views[v.id]!)} alt={v.label} className="h-full w-full object-cover" />
              <span className="micro absolute inset-x-0 bottom-0 bg-black/70 text-center text-[8px] text-white/85">{v.label.split(" ")[0]}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-dim">{useSheet ? "Their one-picture character sheet goes in as picture 1, so the edit sees every side of them in one go." : "Ticked pictures go in together as one picture, so the edit sees every side of them. 2–4 works best — more makes each one smaller."}</p>
    </div>
  );
}

/** the pictures this prompt works with, small, inside the prompt box */
function BarPictures() {
  const r = useMakeRefs();
  const thumb = (url: string, title: string, clear: () => void, tag: string) => (
    <span key={tag} className="group relative h-14 w-11 shrink-0 overflow-hidden border border-line" title={title}>
      <img src={url} alt="" className="h-full w-full object-cover" />
      <span className="micro absolute inset-x-0 bottom-0 bg-black/70 text-center text-[8.5px] text-white/80">{tag}</span>
      <button onClick={clear} aria-label={`Remove ${title}`} className="absolute right-0 top-0 hidden h-4 w-4 items-center justify-center bg-black/80 text-white group-hover:flex"><Icon name="x" size={10} /></button>
    </span>
  );
  const items = [
    r.pic1 && thumb(r.pic1.url, "Picture 1 — your character", () => useMakeRefs.setState({ pic1: null, pic1Own: true }), "1"),
    r.pic2 && thumb(r.pic2.url, r.remixOf ? `Remixing: ${r.remixOf.label}` : "Picture 2 — the reference", () => useMakeRefs.setState({ pic2: null, remixOf: null, remixBase: null }), r.remixOf ? "REMIX" : "2"),
  ].filter(Boolean);
  return items.length ? <>{items}</> : null;
}

/** plain words → what the writer actually sent: shown with the new words highlighted, written now or after Generate */
function TagsLine({ text, onUse, anime, write, on, preview }: { text: string; onUse: (t: string) => void; anime: boolean; write: () => Promise<string>; on: boolean; preview?: string }) {
  const t = useMakeRefs((st) => st.tags);
  const fresh = !!t && t.from === text;
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useJobs((s) => s.toast);
  useEffect(() => { if (fresh) setOpen(true); }, [fresh, t?.to]);
  if (!looksPlain(text)) return null;
  const stage = anime ? "tags" : "krea";
  const pack = lastWrite[stage]?.pack ?? activePack(stage)?.name ?? (anime ? "Words → tags" : "Krea 2 frame builder");
  const now = async () => { setBusy(true); try { await write(); setOpen(true); } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); } };
  return (
    <div className="border-t border-line px-4 py-2 text-[12px]">
      <div className="flex items-center gap-3">
        <button className="text-muted hover:text-ink" onClick={() => setOpen((o) => !o)}>{open && (fresh || !on) ? "▾" : "▸"} {fresh ? (anime ? "Tags the writer made from your words" : "Prompt the writer made from your words") : !on ? "Your words go to the model exactly as typed" : anime ? "Your words become tags when you press Generate" : "The writer turns your words into a detailed Krea 2 prompt when you press Generate"}</button>
        <span className="text-dim" title="The prompt file this step uses — change or add your own in Scenes → Prompt files">· prompt file “{pack}”</span>
        <button onClick={now} disabled={busy} className="ml-auto text-accent hover:underline disabled:opacity-50">{busy ? "Writing…" : fresh ? "Write it again" : on ? "Write it now — see it first" : "Polish it once — see it first"}</button>
      </div>
      {!on && !fresh && open && preview && preview.trim() !== text.trim() && (
        <p className="mt-1.5 max-h-28 overflow-y-auto border border-line bg-raised p-2 font-mono text-[12px] leading-relaxed text-ink/85" title="Your words plus the settings on the left (character, pose, background…). Use “Exact prompt” to send only your words.">
          <span className="text-dim">Goes to the model as: </span>{preview}
        </p>
      )}
      {open && fresh && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <p className="max-h-48 overflow-y-auto border border-line bg-raised p-2 font-mono text-[12px] leading-relaxed text-ink/85"><WordDiff before={text} after={t!.to} showRemoved={false} /></p>
          <div className="flex gap-3"><span className="text-dim">green = added by the writer</span>
            <button className="ml-auto text-accent hover:underline" onClick={() => onUse(t!.to)}>{anime ? "Put these tags in the box" : "Put this prompt in the box"}</button>
            <button className="text-muted hover:text-ink" onClick={() => copyText(t!.to)}>Copy</button></div>
        </div>
      )}
    </div>
  );
}

/** Krea 2's text encoder: the uncensored one (the community's choice — explicit prompts aren't watered down) or the stock one */
function KreaEncoder() {
  const g = useDownloads((st) => st.groups.find((x) => x.id === "krea_te"));
  const [stock, setStock] = useState(() => { try { return localStorage.getItem(KREA_TE_KEY) === "stock"; } catch { return false; } });
  const pick = (v: boolean) => { try { if (v) localStorage.setItem(KREA_TE_KEY, "stock"); else localStorage.removeItem(KREA_TE_KEY); } catch { /* private mode */ } setStock(v); syncKreaTE(); };
  const here = !g || g.state === "done";
  return (
    <div className="flex flex-col gap-1">
      <Seg label="Text encoder (Krea 2)" value={stock ? "stock" : "uncensored"} onChange={(v) => pick(v === "stock")}
        options={[{ value: "uncensored", label: "Uncensored" }, { value: "stock", label: "Stock" }]} />
      <p className="-mt-1 text-[11.5px] leading-relaxed text-dim">{stock ? "The stock encoder — it can soften explicit words." : here ? "Uncensored (abliterated Qwen3-VL): explicit prompts are read as written. Used for Create, Edit and swaps." : `Uncensored encoder ${g?.state === "downloading" ? `downloading, ${g.pct}%` : g?.state === "error" ? "failed to download (needs your CivitAI key — status menu → Retry)" : "in line"} — the stock one is used until then.`}</p>
    </div>
  );
}

/** Krea2T Enhancer on/off (A/B against plain Krea 2) */
function KreaBoost() {
  const [off, setOff] = useState(() => { try { return localStorage.getItem(KREA_BOOST_KEY) === "off"; } catch { return false; } });
  const pick = (v: boolean) => { try { if (v) localStorage.setItem(KREA_BOOST_KEY, "off"); else localStorage.removeItem(KREA_BOOST_KEY); } catch { /* private mode */ } setOff(v); syncKreaTE(); };
  const installed = kreaBoostInstalled();
  return (
    <div className="flex flex-col gap-1">
      <Seg label="Follow the prompt harder (Krea 2)" value={off ? "off" : "on"} onChange={(v) => pick(v === "off")}
        options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} />
      <p className="-mt-1 text-[11.5px] leading-relaxed text-dim">{off ? "Plain Krea 2." : installed === false ? "Needs the Krea2T Enhancer node, which comes with the newest image — plain Krea 2 until then." : "Krea2T Enhancer at 1.5, as in the community workflows: details in your prompt are followed more closely. Turn off to compare."}</p>
    </div>
  );
}
