// V8 Cover-Art 8-Pack Factory: 1-click multi-GPU cover generator for 1 or 100+ characters.
// Generates 4 genuinely distinct, non-repeating pose styles drawn across our 154+ CivitAI-mined blueprint repertoire:
//   1. Upfront Magnetic Portrait (waist-up / chest-up close-in — arms-up, bar lean, zipper tease)
//   2. Amateur Bedroom Mirror / Handheld Selfie (lived-in bedroom mirror with phone OR raw candid phone snap)
//   3. Creative Candid (wide CivitAI repertoire — doorway turn, staircase glance, backwards chair, window light)
//   4. Diagonal Legs-in-Frame Pinup (85%+ edge-to-edge rule-of-thirds seated/reclining leg glamour)
// across 2 engines (Krea 2 Turbo Crisp Photo + BSS_DesireX2 Dry-Matte finished with Krea 2 Pass-2 zero-speck refine
// = 8 covers/char, or 4 Krea-only). Streams straight into ComfyUI's multi-GPU router for 100% 8× RTX 5090 saturation!
import { comboOptions, listLoras } from "./api";
import { newGroup, newRow, queueAll, useBatch, type Row } from "./batch";
import { pickCoverPackBlueprints, type CoverArchetypeId, type CoverArchetypePick } from "./blueprints";
import { type Character } from "./characters";
import { type ApiGraph, type LoraPick } from "./graphs";
import { useJobs, waitForJob } from "./jobs";
import { looseJson } from "./looseJson";
import { M } from "./models";
import { newSeed } from "./settings";

const LORA_REALISM = "civitai/realism_engine_krea2_v3.1.safetensors";
const LORA_SNAP_V2 = "civitai/RealisticSnapshotKrea2V2.safetensors";
const LORA_SNAP_V1 = "civitai/RealisticSnapshotKrea2.safetensors";
const DESIREX_CANDIDATES = ["civitai/BSS_DesireX2_INT8_ConvRot.safetensors"];

export interface CoverPackOpts {
  /** Generate both Krea 2 Turbo + DesireX (8 covers/char) when DesireX is installed; false = Krea 2 only (4/char) */
  includeDesireX: boolean;
  /** Stage finished candidates into a local "Cover Art Candidates" free set in Your site (NEVER overwrites live card/cover!) */
  stageToLocalSet: boolean;
  /** Let the user inspect/edit prompts in Batch before queueing */
  review: boolean;
}

/** Strip wet/sweat/sheen/dewy buzzwords that cause DesireX to generate distracting water-droplet particles on skin */
export function sanitizeDrySkin(prompt: string, isDesireX = false): string {
  let out = prompt
    .replace(/\b(?:subtle\s+|natural\s+|warm\s+|coastal\s+|oily\s+|light\s+)?(?:sweat[- ]?sheen|skin\s+sheen|warm\s+sheen|subtle\s+sheen|natural\s+sheen|sweat\s+droplets?|water\s+droplets?|glistening|dewy|perspiration|sweaty|sweat|oily|luminous|gleaming)\b/gi, "matte")
    .replace(/\bmatte\s+matte\b/gi, "matte")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
  if (isDesireX && !/dry matte natural skin/i.test(out)) {
    out = `${out.replace(/[. ]+$/, "")}. Clean dry matte natural skin with subtle realistic pores and soft natural lighting.`;
  }
  return out;
}

function resolveLoras(specs: [string, number][], installed: string[]): LoraPick[] {
  if (!installed.length) return specs.map(([name, strength]) => ({ name, strength }));
  const norm = (x: string) => x.replace(/\\/g, "/");
  const byExact = new Map(installed.map((x) => [norm(x).toLowerCase(), x]));
  const byBase = new Map(installed.map((x) => [norm(x).split("/").pop()!.toLowerCase(), x]));
  const out: LoraPick[] = [];
  for (const [want, strength] of specs) {
    const hit = byExact.get(norm(want).toLowerCase()) ?? byBase.get(norm(want).split("/").pop()!.toLowerCase());
    if (hit) out.push({ name: hit, strength });
  }
  return out;
}

function pickInstalledUnet(candidates: string[], installed: string[]): string | undefined {
  if (!installed.length) return undefined;
  const norm = (x: string) => x.replace(/\\/g, "/");
  const byExact = new Map(installed.map((x) => [norm(x).toLowerCase(), x]));
  const byBase = new Map(installed.map((x) => [norm(x).split("/").pop()!.toLowerCase(), x]));
  for (const want of candidates) {
    const hit = byExact.get(norm(want).toLowerCase()) ?? byBase.get(norm(want).split("/").pop()!.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

function slugOf(c: Character): string {
  const disp = (c.site?.name || c.name || c.id).trim();
  return disp.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || c.id;
}

/** Build the 3-archetype DeepSeek cover-art planner prompt for one character using 3 unique CivitAI blueprints */
export function buildCoverPackPlanPrompt(c: Character, picks: CoverArchetypePick[]): string {
  const s = c.site ?? {};
  const fx = s.facts ?? {};
  const disp = (s.name || c.name || "Character").trim();
  const isCosplay = /^Cosplay of /i.test(c.source ?? "");
  const canonTitle = isCosplay ? (c.source ?? "").replace(/^Cosplay of /i, "").trim() : "";
  const age = Math.max(21, Number(c.age) || 25);
  const eth = (s.ethnicity || c.ethnicity || "").trim();
  const identity = [
    `a stunning ${age}-year-old${eth ? ` ${eth}` : ""} adult woman`,
    canonTitle ? `cosplaying ${canonTitle}` : "",
    c.hair ? `${c.hair} hair` : "",
    c.eyes ? `${c.eyes} eyes` : "",
    c.body ? c.body : "attractive natural curvy hourglass build",
    c.outfit ? `wearing ${c.outfit}` : "",
    c.details ? c.details : "",
  ].filter(Boolean).join(", ");
  const worldParts = [fx.job || s.occupation, fx.city, fx.home || s.setting, s.personality || c.personality].filter(Boolean);
  const world = worldParts.length ? worldParts.join(", ") : "a rich warm lived-in real-world setting fitting her aesthetic";

  const byStyle = Object.fromEntries(picks.map((p) => [p.style, p])) as Record<CoverArchetypeId, CoverArchetypePick>;

  return (
    `Write 4 completely different, high-charm, scroll-stopping SFW/teasing cover-art photo prompts for ${disp} (${identity}).\n` +
    `Her world / vibe: ${world}.\n\n` +
    `Output ONLY valid JSON with these exact 4 keys: {"upfront": "...", "selfie": "...", "creative": "...", "diagonal": "..."}\n\n` +
    `THE 4 VARIATIONS MUST LOOK UNMISTAKABLY DIFFERENT FROM ONE ANOTHER:\n` +
    `1. "upfront" (Upfront Magnetic Portrait — waist-up or chest-up close-in portrait; zero leg-template):\n` +
    `   Follow this fresh CivitAI camera & pose blueprint: [${byStyle.upfront.blueprint.name}] ${byStyle.upfront.blueprint.words}\n` +
    `   Set in a rich, atmospheric real-world spot from her world with warm practical lighting.\n\n` +
    `2. "selfie" (Authentic Amateur Mirror / Handheld Selfie — everyday girlfriend charm in her full outfit/cosplay):\n` +
    `   Follow this fresh CivitAI camera & pose blueprint: [${byStyle.selfie.blueprint.name}] ${byStyle.selfie.blueprint.words}\n` +
    `   Set in a real lived-in bedroom, messy apartment mirror, or warm bathroom vanity (only hold a smartphone if it is a mirror selfie; for front-camera selfies keep hands empty!).\n\n` +
    `3. "creative" (Creative Candid — expressive, varied full-body or 3/4 framing from her world, NOT a seated diagonal leg pose):\n` +
    `   Follow this fresh CivitAI camera & pose blueprint: [${byStyle.creative.blueprint.name}] ${byStyle.creative.blueprint.words}\n` +
    `   Set in a DIFFERENT real-world location fitting her story or vibe with warm natural or practical light.\n\n` +
    `4. "diagonal" (Diagonal Legs-in-Frame Pinup — 85%+ edge-to-edge rule-of-thirds cover glamour with face in upper third and thighs/legs sweeping across the lower foreground):\n` +
    `   Follow this fresh CivitAI camera & pose blueprint: [${byStyle.diagonal.blueprint.name}] ${byStyle.diagonal.blueprint.words}\n` +
    `   Set in a warm, moody interior or iconic spot from her world with minimal empty ceiling space.\n\n` +
    "STRICT QUALITY & ANATOMY RULES:\n" +
    "- 80–120 words per prompt, flowing natural photography English, positive-only wording (never write 'no X').\n" +
    "- SFW COVER-SAFE & HIGH SEX APPEAL: seductive gaze, natural curves, neckline/cleavage tease, figure-flattering posture — keep breasts/nipples covered by her outfit so every candidate works as a public site card.\n" +
    "- CLEAN DRY MATTE SKIN (CRITICAL): describe 'clean dry matte natural skin with subtle realistic pores'. NEVER write 'sweat', 'sheen', 'dewy', 'glistening', 'wet', 'oily', or 'luminous' (those cause sweat-droplet artifacts!).\n" +
    "- NATURAL ANATOMY: keep both arms and hands in relaxed, physically natural positions (never awkwardly twisted behind her back).\n" +
    "- NO WIG WORDS: never write 'wig', 'lace-front', or 'hairline' — always describe it as her real hair.\n" +
    "- Close-in confident framing with minimal empty ceiling space; authentic 35mm / smartphone photography feel. Everyone is an adult."
  );
}

async function planCharacterCovers(c: Character, picks: CoverArchetypePick[]): Promise<Record<CoverArchetypeId, string>> {
  const disp = c.site?.name || c.name;
  const prompt = buildCoverPackPlanPrompt(c, picks);
  const graph: ApiGraph = {
    "1": {
      class_type: "LLMTextProcessor",
      inputs: {
        model: M.llmBig, mmproj: "none", system_prompt: "none", prompt,
        max_tokens: 2400, temperature: 0.85, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
        ctx_size: 12288, memory_mode: "auto", n_gpu_layers: 99, n_cpu_moe_layers: 1,
        seed: newSeed() % 2 ** 31, timeout_seconds: 240, reasoning: "off",
      },
    },
    "2": { class_type: "PreviewAny", _meta: { title: "covers" }, inputs: { source: ["1", 0] } },
  };
  const job = await useJobs.getState().run("batch", `Cover 8-Pack plan · ${disp}`, graph, "writer:cover8", { quiet: true, front: true, noTray: true, project: c.id });
  const done = await waitForJob(job.id);
  const raw = (done.texts.covers ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!raw) throw new Error(`${disp}: cover planner returned empty output`);
  const parsed = looseJson<Record<string, unknown>>(raw);
  const out = {} as Record<CoverArchetypeId, string>;
  for (const k of ["upfront", "selfie", "creative", "diagonal"] as CoverArchetypeId[]) {
    const v = String(parsed[k] ?? "").trim();
    if (v) out[k] = sanitizeDrySkin(v, false);
  }
  if (!Object.keys(out).length) throw new Error(`${disp}: could not parse cover prompts`);
  return out;
}

/** Plan & queue 8 diverse Cover-Art Hero candidates per character (4 CivitAI styles × Krea 2 Turbo + DesireX w/ Krea 2 Pass-2 zero-speck refine)
 *  with 8-worker parallel DeepSeek planning & immediate streaming dispatch across all GPUs! */
export async function planAndQueueCoverPack(
  chars: Character[],
  opts: CoverPackOpts,
  onStep: (msg: string) => void,
): Promise<{ rows: number; jobs: number; failed: string[]; hasDesireX: boolean }> {
  if (!chars.length) throw new Error("Pick at least one character");
  onStep("Checking installed Krea 2 / DesireX checkpoints & LoRAs…");
  const [installedLoras, installedUnets] = await Promise.all([
    listLoras().catch(() => [] as string[]),
    comboOptions("UNETLoader", "unet_name").catch(() => [] as string[]),
  ]);
  const desireXUnet = opts.includeDesireX ? pickInstalledUnet(DESIREX_CANDIDATES, installedUnets) : undefined;
  const kreaLoras = resolveLoras(
    [[LORA_REALISM, 0.60], [installedLoras.some((x) => /RealisticSnapshotKrea2V2/i.test(x)) ? LORA_SNAP_V2 : LORA_SNAP_V1, 0.45]],
    installedLoras,
  );
  const desireLoras = resolveLoras([[LORA_REALISM, 0.40]], installedLoras);
  const kreaRefineLoras = resolveLoras([[LORA_REALISM, 0.45]], installedLoras);

  const runTs = Math.floor(Date.now() / 1000);
  const group = newGroup(`Cover-Art ${desireXUnet ? "8-Pack" : "4-Pack"} (${chars.length} char${chars.length === 1 ? "" : "s"})`);
  const failed: string[] = [];
  let totalRows = 0;
  let totalJobs = 0;
  let doneCount = 0;
  let cursor = 0;

  // Pre-deal unique non-repeating 4-style blueprints sequentially so no two characters share a pose
  const dealt = chars.map(() => pickCoverPackBlueprints("cover8"));

  const b = useBatch.getState();
  b.set({ target: "image" });
  const empty = b.rows.filter((r) => !r.imitate && !r.civit && !r.idea.trim() && !r.prompt.trim());
  if (empty.length) useBatch.setState((s) => ({ rows: s.rows.filter((r) => !empty.includes(r)) }));

  const concurrency = Math.min(8, chars.length);
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < chars.length) {
      const idx = cursor++;
      const c = chars[idx];
      const disp = c.site?.name || c.name;
      const slug = slugOf(c);
      onStep(`Planning Cover ${desireXUnet ? "8-Pack" : "4-Pack"} (${doneCount + 1}/${chars.length}: ${disp})…`);
      try {
        const plan = await planCharacterCovers(c, dealt[idx]);
        const charRows: Partial<Row>[] = [];
        const setKey = `free-v8-covers-${runTs}`;
        for (const pick of dealt[idx]) {
          const basePrompt = plan[pick.style];
          if (!basePrompt) continue;
          const engines: { tag: string; label: string; unet?: string; refineUnet?: string; refineLoras?: LoraPick[]; steps: number; loras: LoraPick[]; prompt: string }[] = [
            { tag: "krea2", label: "Krea 2", unet: undefined, steps: 10, loras: kreaLoras, prompt: sanitizeDrySkin(basePrompt, false) },
            ...(desireXUnet ? [{ tag: "desirex", label: "DesireX", unet: desireXUnet, refineUnet: M.kreaUnet, refineLoras: kreaRefineLoras, steps: 8, loras: desireLoras, prompt: sanitizeDrySkin(basePrompt, true) }] : []),
          ];
          for (const eng of engines) {
            charRows.push({
              charId: c.id,
              idea: `Cover · ${pick.label} · ${eng.label}`,
              prompt: eng.prompt,
              status: "ready",
              takes: 1,
              loras: eng.loras,
              group,
              ...(opts.stageToLocalSet ? { toSet: { title: "Cover Art Candidates (V8)", tier: "free", rating: "suggestive", setKey } } : {}),
              cover: {
                style: pick.style,
                engine: eng.tag,
                unet: eng.unet,
                refineUnet: eng.refineUnet,
                refineLoras: eng.refineLoras,
                steps: eng.steps,
                prefix: `studio/packs/${slug}/cover_${pick.style}_${eng.tag}`,
                label: `${disp} · Cover (${pick.label} · ${eng.label})`,
              },
            });
          }
        }
        if (charRows.length) {
          const made = charRows.map((p) => newRow(p));
          useBatch.setState((s) => ({ rows: [...s.rows, ...made] }));
          totalRows += made.length;
          // Stream immediately to all GPUs as soon as each character's prompts finish (zero waiting on 8× GPU pods!)
          if (!opts.review) {
            totalJobs += await queueAll(made.map((r) => r.id));
          }
        }
      } catch (e) {
        failed.push(`${disp}: ${(e as Error).message}`);
      }
      doneCount++;
    }
  }));

  if (!totalRows) throw new Error(failed[0] || "No cover-art shots were planned");
  return { rows: totalRows, jobs: totalJobs, failed, hasDesireX: !!desireXUnet };
}
