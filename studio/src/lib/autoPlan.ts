// Batch → Plan it for me: the writer (or your Grok tab) plans photo sets that fit who each character is — places, outfits,
// a different pose and angle per picture, free or premium — then every picture's prompt is written and it's all queued.
// One click per batch of characters; the pictures use each character's sheet (the view closest to each pose's angle).
import { describe, useCharacters, type Character } from "./characters";
import { newRow, queueAll, useBatch, type Row } from "./batch";
import { expressionFor, useInspo } from "./inspo";
import { loadLib, type PwItem, type PwPick } from "./posewear";
import { runWriter } from "./writer";

export interface AutoPlan { sets: number; per: number; mix: "progression" | "sfw" | "mixed" | "bold"; backdrop: "places" | "plain"; poseSet?: string; faceFix: boolean; usePoseWear?: boolean }
interface PlannedSet { title: string; tier: "free" | "premium"; rating?: string; setting: string; outfit?: string; poses: string[] }

function toPick(it: PwItem): PwPick {
  const a = it.angles?.[0];
  return { key: it.key, lib: it.lib, title: it.title, words: it.words, thumb: it.thumb ?? "", image: a?.image || it.image || "", depth: it.lib === "depths", couple: it.couple, cat: it.cat };
}

/** pick a non-repeating PoseWear depth pose matching the shot's rating (max 2 couple poses per explicit set) */
function pickDepth(pool: PwItem[], used: Set<string>, rating: string, coupleLeft: { n: number }): PwPick | undefined {
  if (!pool.length) return undefined;
  const want = pool.filter((x) => !used.has(x.key) && (rating === "sfw" ? !x.adult && !x.couple : rating === "explicit" ? (x.couple ? coupleLeft.n > 0 : true) : !x.couple));
  const list = want.length ? want : pool.filter((x) => !x.couple && (rating === "sfw" ? !x.adult : true));
  if (!list.length) return undefined;
  const pick = list[Math.floor(Math.random() * list.length)];
  used.add(pick.key);
  if (pick.couple) coupleLeft.n--;
  return toPick(pick);
}

export async function planFor(c: Character, o: AutoPlan, usedTitles: string[] = [], depthPool: PwItem[] = [], usedPoses: Set<string> = new Set()): Promise<Partial<Row>[]> {
  const site = c.site ?? {}, fx = site.facts ?? {};
  const facts = [fx.job && `Job: ${fx.job}`, fx.city && `World/City: ${fx.city}`, fx.home && `Home: ${fx.home}`, fx.wearing && `Signature outfit: ${fx.wearing}`, fx.room && `Scene: ${fx.room}`].filter(Boolean).join(" · ");
  const profile = [facts, site.bio, site.personality && `Personality: ${site.personality}`, site.backstory, site.tags?.length && `Tags: ${site.tags.join(", ")}`, c.personality && `Notes: ${c.personality}`].filter(Boolean).join(" ");
  const poseSet = useInspo.getState().sets.find((x) => x.id === o.poseSet);
  const existing = [...(site.sets ?? []).map((s) => s.title), ...usedTitles].filter(Boolean).slice(-40).join(", ");
  const raw = await runWriter("setplan", {
    character: `${site.name || c.name} — ${describe(c)}`, profile: profile || "(none — infer it from their look)", sets: String(o.sets), per: String(o.per), mix: o.mix, backdrop: o.backdrop,
    poses: poseSet ? poseSet.items.slice(0, 20).map((x) => x.text).join(" | ") : "", existing,
  }, { tab: "batch", label: `${site.name || c.name}: planning ${o.sets} photo sets`, big: true });
  const d = (await import("./looseJson")).looseJson<{ sets?: PlannedSet[] }>(raw);
  const rows: Partial<Row>[] = [];
  let k = Math.floor(Math.random() * 50);
  for (const s of (d.sets ?? []).slice(0, o.sets)) {
    const rating = s.rating === "explicit" || s.rating === "suggestive" ? s.rating : "sfw";
    const tier = s.tier === "premium" || rating !== "sfw" ? "premium" : "free";
    if (s.title) usedTitles.push(String(s.title).slice(0, 60));
    const place = o.backdrop === "plain" ? "a plain seamless light grey studio backdrop, soft even studio light" : s.setting;
    const coupleLeft = { n: rating === "explicit" ? 2 : 0 };
    for (const pose of (s.poses ?? []).slice(0, o.per)) {
      const pw = o.usePoseWear ? pickDepth(depthPool, usedPoses, rating, coupleLeft) : undefined;
      rows.push({
        charId: c.id,
        idea: [pose, s.outfit && `wearing ${s.outfit}`, place && `setting: ${place}`].filter(Boolean).join(". "),
        expression: expressionFor(k++),
        takes: 1,
        faceFix: o.faceFix,
        ...(pw ? { pose: pw } : {}),
        toSet: { title: String(s.title || "New set").slice(0, 60), tier },
      });
    }
  }
  if (!rows.length) throw new Error(`${c.name}: the plan came back empty — try again`);
  return rows;
}

/** plan every character, put the rows in Batch (pictures), write their prompts and queue it all */
export async function planAndQueue(chars: Character[], o: AutoPlan, step: (t: string) => void, review = false): Promise<{ rows: number; jobs: number }> {
  const depthPool = o.usePoseWear ? await loadLib("depths").catch(() => [] as PwItem[]) : [];
  const usedTitles = useCharacters.getState().list.flatMap((x) => (x.site?.sets ?? []).map((s) => s.title)).filter(Boolean);
  const usedPoses = new Set<string>();
  const all: Partial<Row>[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    step(`Planning ${c.site?.name || c.name}'s photo packs (${i + 1} of ${chars.length})…`);
    all.push(...(await planFor(c, o, usedTitles, depthPool, usedPoses)));
  }
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
