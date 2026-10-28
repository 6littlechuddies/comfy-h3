import { writerFast } from "./models";
// One call into the local writer (the 9B, or the 27B when it's in) with the prompt file you picked for that step.
import { bigWriterFits, useDownloads } from "./downloads";
import { buildStage, MINOR_FLAG } from "./graphs";
import { useJobs, waitForJob, type Tab } from "./jobs";
import { activePack, fillTemplate, packText, usePacks, type Stage } from "./packs";
import { askOutside, grokSees, grokStatus, writerOutside } from "./outside";
import { newSeed } from "./settings";
import { ADULT_NOTE, explicitStop, described, minorWords, stopMessage } from "./adult";

const ready = (id: string) => { const g = useDownloads.getState().groups.find((x) => x.id === id); return !g || g.state === "done"; };
const known = (id: string) => useDownloads.getState().groups.some((x) => x.id === id);

/** which writer can run right now: the big one when it's downloaded (and wanted), else the small one */
export function writerSize(preferBig = true): { big: boolean } {
  if (preferBig && !writerFast() && bigWriterFits() && known("writer_xl") && ready("writer_xl")) return { big: true };
  if (ready("writer")) return { big: false };
  throw new Error("The prompt writer is still downloading — try again in a few minutes");
}

export async function runWriter(stage: Stage, vars: Record<string, string>, o: { tab: Tab; label: string; images?: string[]; big?: boolean; key?: string; meta?: Record<string, unknown> }): Promise<string> {
  if (!usePacks.getState().loaded) await usePacks.getState().load();
  const pack = activePack(stage);
  if (!pack) throw new Error("No prompt file for this step");
  // the writer reads only what the age check read (no pasted "Negative prompt:" part, no quoted stop messages)
  vars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === "string" ? described(v) : v]));
  const texts = Object.values(vars);
  const hits = minorWords(...texts);
  if (hits.length) throw new Error(explicitStop(hits));
  const input = fillTemplate(pack.template || usePacks.getState().templates[stage] || "", vars);
  // "Grok tab · copy & paste": steps that have to look at a picture stay on the local writer
  const sees = !!o.images?.length && (pack.see_image !== false || stage === "describe");
  // a step that looks at pictures goes to Grok too when its tab is connected (the helper attaches them); else the local writer
  const grokEyes = sees && grokSees() && writerOutside() && !LOCAL_ONLY.includes(stage) && (await grokStatus()).connected;
  if (writerOutside() && (!sees || grokEyes) && !LOCAL_ONLY.includes(stage)) {
    const note = grokEyes ? `\n\n(The pictures this refers to are attached to this message, in order: the first attached image is picture 1, the second is picture 2.)` : "";
    const ans = await askOutside(o.label, await packText(pack.id), input + note, grokEyes ? o.images : undefined);
    if (ans !== null) {
      if (ans.includes(MINOR_FLAG)) throw new Error(stopMessage(texts));
      lastWrite[stage] = { pack: `${pack.name} (Grok)`, input, out: ans };
      return ans;
    }
  }
  const { big } = writerSize(o.big ?? true);
  const once = async (inp: string) => {
    const graph = buildStage({ promptFile: pack.prompt_file, promptChars: pack.chars, input: inp, params: pack.params,
      images: pack.see_image === false && stage !== "describe" ? [] : o.images, big, seed: newSeed(), thinking: pack.thinking === "on" ? "on" : "off" });
    const job = await useJobs.getState().run(o.tab, o.label, graph, o.key ?? `writer:${stage}:${big ? "big" : "small"}`, { kind: `writer:${stage}`, quiet: true, front: true, ...o.meta });
    const done = await waitForJob(job.id);
    return (done.texts.out ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim().replace(/^["“]|["”]$/g, "");
  };
  let out = await once(input);
  if (!out) throw new Error("The writer didn't answer — try again");
  // the writer's own check can misfire on harmless words: ask once more, saying everyone is an adult
  if (out.includes(MINOR_FLAG)) out = await once(input + ADULT_NOTE);
  if (out.includes(MINOR_FLAG)) throw new Error(stopMessage(texts));
  lastWrite[stage] = { pack: pack.name, input: input, out };
  return out;
}

/** steps that always use the local writer: the assistant chat (back and forth). Steps that look at pictures go to the
 *  connected Grok tab (pictures attached) when "Grok sees the pictures" is on, else to the local writer. */
const LOCAL_ONLY: Stage[] = ["chat"];

/** what the writer was last given and wrote, per step — shown under "What the writer did" */
export const lastWrite: Partial<Record<Stage, { pack: string; input: string; out: string }>> = {};
