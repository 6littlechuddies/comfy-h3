import { writerFast } from "./models";
// A character's starting frame: the picture everything else is built from. Pick the model (your own fine-tunes too),
// LoRAs and a full prompt (written by the local writer from the profile, a picture or a saved CivitAI post), make a
// batch, and click the one that looks right — it becomes their front picture, and the reference sheet follows from it.
import { ADULT_NOTE, explicitStop, described, minorWords, stopMessage } from "./adult";
import { civitImage, type CivitGen } from "./api";
import { cleanPrompt, createTargetOf, ensureLoras } from "./civitUse";
import { useCharacters, type Character } from "./characters";
import { bigWriterFits, useDownloads } from "./downloads";
import { buildCreate, buildStage, MINOR_FLAG, type LoraPick } from "./graphs";
import { useJobs, waitForJob } from "./jobs";
import { activePack, fillTemplate, usePacks } from "./packs";
import { lookBlock } from "./scenes";
import { DEFAULTS, modelArgs, modelOf, newSeed, qualityTags, useSettings, type CreateModel } from "./settings";

export interface FrameSettings {
  model: CreateModel;
  /** your own checkpoint for that model ("" = the official one) */
  checkpoint?: string;
  prompt: string;
  loras: LoraPick[];
  count: number;
  shape: keyof typeof FRAME_SHAPES;
}
export const FRAME_SHAPES = {
  portrait: { label: "Portrait 2:3 · 896×1344", w: 896, h: 1344 },
  tall: { label: "Vertical 9:16 · 1088×1920", w: 1088, h: 1920 },
  tallXL: { label: "Vertical 9:16 · 1440×2560 (Krea)", w: 1440, h: 2560 },
  square: { label: "Square · 1328×1328", w: 1328, h: 1328 },
  wide: { label: "Wide 16:9 · 1920×1088", w: 1920, h: 1088 },
} as const;

export function frameOf(c: Character): FrameSettings {
  const f = (c.frame ?? {}) as Partial<FrameSettings>;
  return {
    model: f.model ?? (c.style === "anime" ? "anima" : "krea2"),
    checkpoint: f.checkpoint ?? "",
    prompt: f.prompt ?? "",
    loras: f.loras ?? c.loras ?? [],
    count: f.count ?? 4,
    shape: f.shape ?? "portrait",
  };
}
export function saveFrame(c: Character, patch: Partial<FrameSettings>) {
  const cur = useCharacters.getState().list.find((x) => x.id === c.id) ?? c;
  useCharacters.getState().save({ ...cur, frame: { ...frameOf(cur), ...patch } });
}

const ready = (id: string) => { const g = useDownloads.getState().groups.find((x) => x.id === id); return !g || g.state === "done"; };
/** the local writer, as for "Change this part": the 27B when it's in, else the 9B */
function writer(): { big: boolean } {
  if (!writerFast() && bigWriterFits() && ready("writer_xl") && useDownloads.getState().groups.some((x) => x.id === "writer_xl")) return { big: true };
  if (ready("writer")) return { big: false };
  throw new Error("The prompt writer is still downloading");
}

/** the local writer turns the character (+ what the frame should show, + optional pictures) into a full Krea 2 prompt */
export async function writeFramePrompt(c: Character, frame: string, aspect: string, images: string[] = []): Promise<string> {
  frame = described(frame); // the writer reads only what the age check reads
  if (!usePacks.getState().loaded) await usePacks.getState().load();
  const pack = activePack("krea");
  if (!pack) throw new Error("No prompt file for the Krea 2 frame builder");
  const { big } = writer();
  const input = fillTemplate(pack.template || usePacks.getState().templates.krea || "", { character: lookBlock(c), frame, aspect });
  const hits = minorWords(frame, lookBlock(c));
  if (hits.length) throw new Error(explicitStop(hits));
  const once = async (inp: string) => {
    const graph = buildStage({ promptFile: pack.prompt_file, promptChars: pack.chars, input: inp, params: pack.params, images, big, seed: newSeed(), thinking: pack.thinking });
    const job = await useJobs.getState().run("characters", `${c.name}: writing the frame prompt`, graph, `characters:frameprompt:${big ? "big" : "small"}`, { kind: "frameprompt", charFrame: c.id });
    const done = await waitForJob(job.id);
    return (done.texts.out ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim().replace(/^["“]|["”]$/g, "");
  };
  let out = await once(input);
  if (!out) throw new Error("The writer didn't return a prompt — try again");
  if (out.includes(MINOR_FLAG)) out = await once(input + ADULT_NOTE);
  if (out.includes(MINOR_FLAG)) throw new Error(stopMessage([frame, lookBlock(c)]));
  return out;
}

/** a saved CivitAI post as the starting point: its prompt, model and LoRAs */
export async function frameFromCivitai(c: Character, link: string, onStep?: (m: string) => void): Promise<{ failed: string[]; gen: CivitGen }> {
  onStep?.("Reading the post…");
  const g = await civitImage(link);
  if (!g.prompt) throw new Error("That post has no prompt to copy");
  const model = createTargetOf(g);
  const fam = modelOf(useSettings.getState().s.create, undefined, model).family;
  const wanted = g.resources.filter((r) => r.kind === "lora" && (r.family === fam || r.family === "unknown"));
  const { picks, failed } = await ensureLoras(wanted, onStep);
  saveFrame(c, { model, prompt: cleanPrompt(g.prompt), loras: picks });
  return { failed, gen: g };
}

/** make a batch of candidates for the starting frame */
export async function makeFrames(c: Character) {
  const f = frameOf(c);
  if (!f.prompt.trim()) throw new Error("Write the prompt first (or press Write it for me)");
  const cs = useSettings.getState().s.create;
  const mi = modelOf(cs, undefined, f.model);
  const shape = FRAME_SHAPES[f.shape] ?? FRAME_SHAPES.portrait;
  const own = f.checkpoint ? (f.model === "noob" ? { ckpt: f.checkpoint } : { unet: f.checkpoint }) : {};
  const positive = mi.style === "anime" && !/masterpiece|best quality|score_/i.test(f.prompt) ? `${qualityTags(mi)}, ${f.prompt}` : f.prompt;
  const g = buildCreate({
    ...mi.adv, seed: newSeed(), ...modelArgs(cs, mi), ...own, positive, negative: DEFAULTS.create.negative, loras: f.loras,
    width: shape.w, height: shape.h, count: Math.max(1, Math.min(8, f.count)), cutout: false, prefix: `studio/characters/${c.id}_frame`,
  });
  await useJobs.getState().run("characters", `${c.name}: starting frame ×${f.count}`, g, `characters:frame:${f.model}:${f.shape}`, { charFrame: c.id, kind: "frames" });
}
