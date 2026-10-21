// Batch → Plan it for me: the writer (or your Grok tab) plans photo sets that fit who each character is — places, outfits,
// a different pose and angle per picture, free or premium — then every picture's prompt is written and it's all queued.
// One click per batch of characters; the pictures use each character's sheet (the view closest to each pose's angle).
import { describe, type Character } from "./characters";
import { newRow, queueAll, useBatch, type Row } from "./batch";
import { expressionFor, useInspo } from "./inspo";
import { runWriter } from "./writer";

export interface AutoPlan { sets: number; per: number; mix: "sfw" | "mixed" | "bold"; backdrop: "places" | "plain"; poseSet?: string; faceFix: boolean }
interface PlannedSet { title: string; tier: "free" | "premium"; rating?: string; setting: string; outfit?: string; poses: string[] }

export async function planFor(c: Character, o: AutoPlan): Promise<Partial<Row>[]> {
  const site = c.site ?? {};
  const profile = [site.bio, site.personality && `Personality: ${site.personality}`, site.backstory, site.tags?.length && `Tags: ${site.tags.join(", ")}`, c.personality && `Notes: ${c.personality}`].filter(Boolean).join(" ");
  const poseSet = useInspo.getState().sets.find((x) => x.id === o.poseSet);
  const raw = await runWriter("setplan", {
    character: `${c.name} — ${describe(c)}`, profile: profile || "(none — infer it from their look)", sets: String(o.sets), per: String(o.per), mix: o.mix, backdrop: o.backdrop,
    poses: poseSet ? poseSet.items.slice(0, 20).map((x) => x.text).join(" | ") : "", existing: (site.sets ?? []).map((s) => s.title).join(", "),
  }, { tab: "batch", label: `${c.name}: planning ${o.sets} photo sets`, big: true });
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`${c.name}: the writer didn't answer with a plan — try again`);
  const d = JSON.parse(m[0]) as { sets?: PlannedSet[] };
  const rows: Partial<Row>[] = [];
  let k = Math.floor(Math.random() * 50);
  for (const s of (d.sets ?? []).slice(0, o.sets)) {
    const tier = s.tier === "premium" ? "premium" : "free";
    const place = o.backdrop === "plain" ? "a plain seamless light grey studio backdrop, soft even studio light" : s.setting;
    for (const pose of (s.poses ?? []).slice(0, o.per)) {
      rows.push({ charId: c.id, idea: [pose, s.outfit && `wearing ${s.outfit}`, place && `setting: ${place}`].filter(Boolean).join(". "), expression: expressionFor(k++),
        takes: 1, faceFix: o.faceFix, toSet: { title: String(s.title || "New set").slice(0, 60), tier } });
    }
  }
  if (!rows.length) throw new Error(`${c.name}: the plan came back empty — try again`);
  return rows;
}

/** plan every character, put the rows in Batch (pictures), write their prompts and queue it all */
export async function planAndQueue(chars: Character[], o: AutoPlan, step: (t: string) => void, review = false): Promise<{ rows: number; jobs: number }> {
  const all: Partial<Row>[] = [];
  for (const c of chars) { step(`Planning ${c.name}'s sets…`); all.push(...(await planFor(c, o))); }
  const b = useBatch.getState();
  b.set({ target: "image" });
  const empty = b.rows.filter((r) => !r.imitate && !r.idea.trim() && !r.prompt.trim());
  const made = all.map((p) => newRow(p));
  useBatch.setState((s) => ({ rows: [...s.rows.filter((r) => !empty.includes(r)), ...made] }));
  if (review) {
    // write them into the rows' prompt boxes and stop: you read / edit them, then press Queue
    step(`Writing ${all.length} prompts…`);
    const { writePicturePrompts } = await import("./batch");
    await writePicturePrompts();
    return { rows: all.length, jobs: 0 };
  }
  step(`Writing ${all.length} prompts and queueing…`);
  // only the planned rows: anything else already in Batch stays as it is
  const jobs = await queueAll(made.map((r) => r.id));
  return { rows: all.length, jobs };
}
