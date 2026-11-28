// V9 Master Pack: 1-click UrGF 5-tier demand pack builder (Selfies, Lingerie & Thighs, Bare Boobs & Solo Doggy,
// Explicit Solo, Voyeur / Cuckold Corner POV). Lets you select any adult character(s) — brand-new uploads OR existing
// linked UrGF characters — and pick exactly which of the 5 sets to generate.
import { listLoras, objectInfo, toInput, type FileRef } from "./api";
import { newGroup, newRow, queueAll, useBatch, type Row } from "./batch";
import { type Character } from "./characters";
import { buildMasterPackCutout, type ApiGraph, type LoraPick } from "./graphs";
import { useJobs, waitForJob } from "./jobs";
import { looseJson } from "./looseJson";
import { M } from "./models";
import { newSeed } from "./settings";

export type MasterPackKey = "selfies" | "lingerie_thighs" | "boobs_ass_doggy" | "explicit_solo" | "cuckold_pov";

export interface MasterPackSpec {
  key: MasterPackKey;
  shortLabel: string;
  title: string;
  setTag: string;
  tier: "free" | "premium";
  rating: "sfw" | "suggestive" | "explicit";
  shots: number;
  refBoost: number;
  nudeFraming?: boolean;
  loras: [string, number][];
  hint: string;
  promptSpec: string;
}

const LORA_SNAP = "civitai/RealisticSnapshotKrea2.safetensors";
const LORA_SELFIE = "civitai/krea2-s3lfie-r3alism-9.safetensors";
const LORA_PHONE = "civitai/krea-smartphone-photo-slider.safetensors";
const LORA_NUDE = "civitai/realistic_nudes_krea2_v2.safetensors";
const LORA_SNOFS = "civitai/snofs_krea_v1_5.safetensors";

export const MASTER_PACKS: MasterPackSpec[] = [
  {
    key: "selfies",
    shortLabel: "Selfies",
    title: "Casual Selfies & Tease",
    setTag: "v9-selfies",
    tier: "free",
    rating: "sfw",
    shots: 4,
    refBoost: 1.42,
    loras: [[LORA_SELFIE, 0.35], [LORA_PHONE, 0.45]],
    hint: "Free · SFW · 4 arm's-length selfies (kissy, shower towel, oversized tee, lying flirty)",
    promptSpec:
      "selfies (4 authentic arm's-length selfies she snapped herself — exact framing!):\n" +
      "- s1: High-angle arm's-length close-up selfie looking up through her lashes blowing a playful kiss (kissy lips), wearing black lace lingerie or low-cut top.\n" +
      "- s2: Casual arm's-length selfie biting her lower lip softly, wrapped loosely in a bath towel with damp hair right out of the shower.\n" +
      "- s3: Cheeky arm's-length selfie with her tongue slightly sticking out and a wicked smirk, wearing only an oversized t-shirt with knees drawn up showing bare thighs.\n" +
      "- s4: Lying on her stomach propped up on her elbows, intimate arm's-length angle looking straight into the lens with a flirty smile (or stretching both arms overhead).",
  },
  {
    key: "lingerie_thighs",
    shortLabel: "Lingerie & Thighs",
    title: "Lingerie & Thighs Focus",
    setTag: "v9-lingerie_thighs",
    tier: "premium",
    rating: "suggestive",
    shots: 4,
    refBoost: 1.40,
    loras: [[LORA_PHONE, 0.40], [LORA_SNAP, 0.25]],
    hint: "Premium · Suggestive · 4 shots (lace bralette + thighs, cleavage pull, garter/stockings, rear thong)",
    promptSpec:
      "lingerie_thighs (4 shots spotlighting lingerie, cleavage tease & shapely thighs/socks — SINGLE GARMENT DIRECTLY AGAINST BARE SKIN!):\n" +
      "- l1: Full-body coquettish pose highlighting her sleek shapely toned thighs and legs wearing solely a sheer lace bralette resting directly against her bare shoulders, bare collarbone, and flat bare midriff, matching lace panties, and thigh-high socks.\n" +
      "- l2: Clothed cleavage tease — leaning forward toward camera pulling down the low neckline of her single fitted camisole or bikini top worn directly against her bare shoulders and bare collarbone, teasing deep cleavage with a playful smile.\n" +
      "- l3: Delicate lace bralette worn directly against her bare shoulders, bare collarbone, and bare waist, paired with a garter belt and thigh-high stockings seated on her couch/bed framing her narrow waist and thighs (single lingerie set directly on bare skin!).\n" +
      "- l4: Rear three-quarter glance back over her shoulder wearing solely a delicate lace bralette strap across her bare back and shoulders, tiny cheeky lace thong, and thigh-high socks, arched spine framing her curvy ass and legs.",
  },
  {
    key: "boobs_ass_doggy",
    shortLabel: "Boobs & Doggy",
    title: "Bare Boobs & Solo Doggy",
    setTag: "v9-boobs_ass_doggy",
    tier: "premium",
    rating: "explicit",
    shots: 4,
    refBoost: 1.40,
    nudeFraming: true,
    loras: [[LORA_NUDE, 0.45], [LORA_PHONE, 0.35]],
    hint: "Premium · Explicit · 4 solo escalation shots (topless shirt-lift, naked rear view, solo doggy, kneeling bare breasts)",
    promptSpec:
      "boobs_ass_doggy (4 solo explicit escalation shots — bare boobs + solo ass/doggy invite):\n" +
      "- b1: Arm's-length bare-tits topless selfie lifting her crop top up above her bare breasts, biting her lip looking right into the lens.\n" +
      "- b2: Full-body naked rear view in her room glancing back over her shoulder, framing her bare back curve and round ass.\n" +
      "- b3: Solo face-down, ass-up on all fours in doggy pose on her bed inviting the viewer from behind, arched back looking back with a needy gaze (rear anatomy only!).\n" +
      "- b4: Kneeling topless pressing her bare breasts together with empty hands resting on her ribcage, sultry upward eye contact.",
  },
  {
    key: "explicit_solo",
    shortLabel: "Explicit Solo",
    title: "Explicit Solo (Spread · Touching · Dildo)",
    setTag: "v9-explicit_solo",
    tier: "premium",
    rating: "explicit",
    shots: 4,
    refBoost: 1.38,
    loras: [[LORA_SNOFS, 0.52], [LORA_NUDE, 0.30], [LORA_PHONE, 0.35]],
    hint: "Premium · Explicit · 4 solo shots (legs spread, fingering/touching, seated spread POV, dildo tease)",
    promptSpec:
      "explicit_solo (4 explicit solo pussy spread, touching herself & dildo shots):\n" +
      "- e1: Lying completely naked on her back on her bed with knees bent and legs spread wide open toward the camera showing her bare wet pussy cleanly.\n" +
      "- e2: Touching herself / fingering — reclining naked on her bed/couch, one hand gently spreading her wet pussy open while her other hand rests on her bare breast, eyes half-closed in pleasure.\n" +
      "- e3: Tight seated spread-pussy POV on the edge of the bed leaning back on one arm with thighs parted wide, sultry eye contact.\n" +
      "- e4: Solo dildo play — kneeling/reclining naked holding a realistic glass/silicone dildo up to her parted glossy lips licking it while looking up with heavy-lidded eyes.",
  },
  {
    key: "cuckold_pov",
    shortLabel: "Cuckold POV",
    title: "Voyeur · Cuckold Corner POV",
    setTag: "v9-cuckold",
    tier: "premium",
    rating: "explicit",
    shots: 4,
    refBoost: 1.38,
    nudeFraming: true,
    loras: [[LORA_SNOFS, 0.70], [LORA_PHONE, 0.35]],
    hint: "Premium · Explicit · 4 corner voyeur/cuckold POV shots (White & Black bulls: doggy, cowgirl, missionary)",
    promptSpec:
      "cuckold_pov (4 FIRST-PERSON CORNER VOYEUR / CUCKOLD POV shots — EXACT ANATOMICAL GEOMETRY!):\n" +
      "Every cuckold_pov shot is a wide candid photo taken from a DIM CORNER OF THE BEDROOM: in the LOWER FOREGROUND EDGE, the viewer's own hand grips his own erect penis watching across the room; across the room on the bed, she is COMPLETELY NAKED having sex with ANOTHER MAN in clear, physically accurate body alignment while she locks eyes with the viewer in the corner. NEVER write 'head turned away' (which turns the man backwards!) — describe BOTH bodies facing the exact right direction:\n" +
      "- c1 (White Bull · Side-Profile Doggy): Wide corner voyeur POV — viewer's hand gripping his own erect penis in bottom foreground watching across the room; on the bed in clear three-quarter side profile, she is completely naked on all fours on hands and knees facing left while a fair-skinned muscular white man kneels directly behind her hips gripping her waist with explicit vaginal penetration, his thick erect penis visibly thrusting deep inside her wet pussy between her cheeks (his face cropped near top edge), while she turns her head sideways toward the camera in the corner with a wicked smirk.\n" +
      "- c2 (White Bull · Explicit Cowgirl): Wide corner voyeur POV — viewer's hand gripping his own erect penis in bottom foreground watching across the room; on the bed across the room, a fair-skinned muscular white man lies flat on his back on the mattress (torso, chest, and hips visible, face off to the side) while she sits completely naked straddling his hips in an open three-quarter angle leaning slightly back with palms on his thighs, explicit vaginal penetration clearly visible as she bounces on his thick erect penis inserted deep inside her wet stretched pussy, locking eyes straight at the viewer in the corner with parted lips.\n" +
      "- c3 (Black Bull / BBC · Side-Profile Doggy): Wide corner voyeur POV — viewer's hand gripping his own erect penis in bottom foreground watching across the room; on the bed in clear three-quarter side profile (contrasting skin tones), she is completely naked on all fours on hands and knees facing left while a muscular Black man kneels directly behind her hips gripping her waist with explicit vaginal penetration, his thick dark erect penis visibly thrusting deep inside her wet pussy between her spread cheeks (his face cropped near top edge), while she glances sideways straight at the viewer in the corner mid-moan.\n" +
      "- c4 (Black Bull / BBC · Clean Explicit Missionary — SINGLE MAN ONLY!): Candid handheld bedroom shot (contrasting skin tones, ONLY TWO PEOPLE in frame — one woman and one muscular Black man), she lies completely naked on her back on the mattress with her knees pulled high and legs spread wide around his waist while he kneels between her thighs with explicit vaginal penetration, his single thick dark erect penis sliding deep inside her wet pussy mid-thrust, while she turns her head toward the camera with heavy-lidded eyes.",
  },
];

export const ALL_MASTER_PACK_KEYS: MasterPackKey[] = MASTER_PACKS.map((p) => p.key);
export const SOLO_MASTER_PACK_KEYS: MasterPackKey[] = MASTER_PACKS.filter((p) => p.key !== "cuckold_pov").map((p) => p.key);

const HOURGLASS_FOCUS = new Set(["dani", "katie", "rosie", "claire"]);
const KNOWN_FACE_HAND = new Set(["roxie", "jax"]);

/** best source reference picture for a character (works for both new uploads and linked UrGF characters) */
export function masterPackRef(c: Character): FileRef | null {
  return c.views?.front ?? c.cover ?? c.views?.face ?? null;
}

/** which of the 5 V9 packs this character already has in site.sets */
export function v9PackStatus(c: Character): { have: MasterPackKey[]; missing: MasterPackKey[] } {
  const keys = (c.site?.sets ?? []).map((s) => (s.set_key || "").toLowerCase());
  const have: MasterPackKey[] = [];
  const missing: MasterPackKey[] = [];
  for (const p of MASTER_PACKS) {
    const tag = p.setTag.toLowerCase();
    const hit = keys.some((k) => k.includes(`-${tag}-`) || k.endsWith(`-${tag}`) || k.includes(tag));
    (hit ? have : missing).push(p.key);
  }
  return { have, missing };
}

function bodyDescFor(c: Character): { desc: string; anchor: string } {
  const disp = (c.site?.name || c.name || "").trim().toLowerCase();
  const rawBody = (c.body || "").trim();
  if (disp === "claire") {
    return {
      desc: "snatched slender hourglass figure with a very narrow cinched waist, flat toned stomach, shapely rounded hips, firm natural breasts, and sleek toned legs",
      anchor: "her exact snatched slender hourglass proportions (very narrow cinched waist, flat toned stomach, shapely rounded hips, full natural breasts)",
    };
  }
  if (HOURGLASS_FOCUS.has(disp)) {
    return {
      desc: "pronounced hourglass figure with a tight narrow cinched waist, flat toned stomach, full natural breasts, full curvy rounded hips, and shapely toned thighs",
      anchor: "her exact pronounced hourglass proportions from the reference picture (tight narrow cinched waist, flat toned stomach, full natural breasts, curvy rounded hips)",
    };
  }
  if (/curvy|voluptuous|busty|hourglass/i.test(rawBody)) {
    return {
      desc: `${rawBody}, tight narrow cinched waist, flat toned stomach, full shapely hips, natural proportions from the reference picture`,
      anchor: "her exact natural bust, narrow waist, and hip proportions from the reference picture",
    };
  }
  return {
    desc: `${rawBody || "natural fit hourglass figure"}, preserving her exact bust, waist, and hip proportions from the reference picture with a flat toned stomach`,
    anchor: "her exact natural bust, narrow waist, and hip proportions from the reference picture",
  };
}

/** Build the targeted DeepSeek / 27B prompt for ONLY the chosen packs */
export function buildMasterPackPlanPrompt(c: Character, selectedKeys: MasterPackKey[]): string {
  const chosen = MASTER_PACKS.filter((p) => selectedKeys.includes(p.key));
  const s = c.site ?? {};
  const fx = s.facts ?? {};
  const disp = (s.name || c.name || "Character").trim();
  const eth = (s.ethnicity || c.ethnicity || "").trim();
  const ethStr = eth ? `${eth} adult woman` : "adult woman";
  const { desc: bodyDesc } = bodyDescFor(c);
  const who = `the exact ${ethStr} from the reference picture (${[c.hair && `${c.hair} hair`, c.eyes && `${c.eyes} eyes`, bodyDesc].filter(Boolean).join(", ")})`;
  const worldParts = [fx.job || s.occupation, fx.city, fx.home || s.setting, (s.personality || c.personality) && `vibe: ${s.personality || c.personality}`, s.tags?.length && `tags: ${s.tags.join(", ")}`].filter(Boolean);
  const world = worldParts.length ? worldParts.join(", ") : "her cozy personal bedroom and everyday home setting";
  const schema = `{${chosen.map((p) => `"${p.key}": ["shot1","shot2","shot3","shot4"]`).join(", ")}}`;
  const totalShots = chosen.reduce((sum, p) => sum + p.shots, 0);
  const sections = chosen.map((p, idx) => `${idx + 1}. ${p.promptSpec}`).join("\n\n");

  return (
    `Write ${chosen.length} high-converting photo pack${chosen.length === 1 ? "" : "s"} (4 shots each = ${totalShots} shots total) for an adult companion character named ${disp}, grounded naturally in HER world (${world}).\n` +
    `Character: ${who}\n\n` +
    `Output ONLY valid JSON with these exact keys and 4 shot strings each: ${schema}\n\n` +
    `${sections}\n\n` +
    "CAMERA & VISUAL STYLE (CRITICAL — RAW AMATEUR HANDHELD LOOK, NOT PROFESSIONALLY SHOT!):\n" +
    "Every single shot MUST look like a real, raw, candid amateur phone photo she snapped herself or a partner snapped handheld in the moment — arm's-length outstretched angles, bird's-eye slightly-from-above angles, tilted raw bedroom/home lighting, authentic candid iPhone snap feel, natural imperfect skin & room lighting (NEVER glossy DSLR studio lighting, NEVER magazine glamour photography!).\n\n" +
    "STRICT RULES: 55–80 words per shot. Positive-only wording (NEVER write 'no X' or 'zero X'). For every lingerie, bralette, swimwear, towel, or single-top shot, explicitly describe that single garment resting directly against her bare shoulders, bare collarbone, bare chest, and bare skin so Krea 2 renders one clean garment on bare skin. Skip mirrors/reflections, skip hair-pulling, skip random cups/props. Rear shots describe rear anatomy only; front shots describe front anatomy only. End every shot with 'Raw amateur handheld phone photo, authentic natural room lighting, natural anatomy, realistic skin texture. Everyone is an adult.'"
  );
}

/** Match preferred LoRA paths against what is installed on this rental (exact path or filename fallback) */
function resolvePackLoras(specs: [string, number][], installed: string[]): LoraPick[] {
  if (!installed.length) return specs.map(([name, strength]) => ({ name, strength }));
  const norm = (x: string) => x.replace(/\\/g, "/");
  const byExact = new Map(installed.map((x) => [norm(x).toLowerCase(), x]));
  const byBase = new Map(installed.map((x) => [norm(x).split("/").pop()!.toLowerCase(), x]));
  const out: LoraPick[] = [];
  for (const [want, strength] of specs) {
    const exact = byExact.get(norm(want).toLowerCase());
    if (exact) { out.push({ name: exact, strength }); continue; }
    const base = byBase.get(norm(want).split("/").pop()!.toLowerCase());
    if (base) out.push({ name: base, strength });
  }
  return out;
}

/** Run the V9 planner through Studio's job pipeline (auto-routes to DeepSeek when enabled, else local 27B writer) */
async function planCharacterPacks(c: Character, selectedKeys: MasterPackKey[]): Promise<Record<string, string[]>> {
  const disp = c.site?.name || c.name;
  const prompt = buildMasterPackPlanPrompt(c, selectedKeys);
  const graph: ApiGraph = {
    "1": {
      class_type: "LLMTextProcessor",
      inputs: {
        model: M.llmBig, mmproj: "none", system_prompt: "none", prompt,
        max_tokens: 4200, temperature: 0.82, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
        ctx_size: 16384, memory_mode: "auto", n_gpu_layers: 99, n_cpu_moe_layers: 1,
        seed: newSeed() % 2 ** 31, timeout_seconds: 300, reasoning: "off",
      },
    },
    "2": { class_type: "PreviewAny", _meta: { title: "packs" }, inputs: { source: ["1", 0] } },
  };
  const job = await useJobs.getState().run("batch", `V9 plan · ${disp} (${selectedKeys.length} sets)`, graph, "writer:v9pack", { quiet: true, front: true, noTray: true, project: c.id });
  const done = await waitForJob(job.id);
  const raw = (done.texts.packs ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!raw) throw new Error(`${disp}: planner returned empty output`);
  const parsed = looseJson<Record<string, unknown>>(raw);
  const out: Record<string, string[]> = {};
  for (const k of selectedKeys) {
    const arr = parsed[k];
    if (Array.isArray(arr)) out[k] = arr.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 4);
  }
  if (!Object.values(out).some((a) => a.length > 0)) {
    throw new Error(`${disp}: could not parse any shots for the selected sets`);
  }
  return out;
}

/** Generate a 1-time clean #808080 grey cutout for this character (BiRefNet HR-matting, or FaceSegment if faceMode) */
async function prepareCutout(c: Character, faceMode: boolean, hasFaceSegment: boolean): Promise<string> {
  const ref = masterPackRef(c);
  if (!ref) throw new Error(`${c.site?.name || c.name} needs a front or cover picture first`);
  const staged = await toInput(ref);
  const slug = (c.site?.name || c.name || c.id).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "char";
  const useFace = hasFaceSegment && (faceMode || KNOWN_FACE_HAND.has((c.site?.name || c.name || "").trim().toLowerCase()));
  try {
    const g = buildMasterPackCutout(staged.name, `studio/_work/v9_cutout_${slug}`, useFace ? "face" : "birefnet");
    const job = await useJobs.getState().run("batch", `V9 cutout · ${c.site?.name || c.name}`, g, "cutout:v9", { quiet: true, front: true, noTray: true, no4k: true, project: c.id });
    const done = await waitForJob(job.id);
    const out = done.outputs.find((x) => x.kind === "image" && x.type === "output");
    if (out) return (await toInput(out)).name;
  } catch {
    // Graceful fallback: if cutout node fails or isn't available, keep going with the staged front image
  }
  return staged.name;
}

export interface MasterPackOpts {
  packs: MasterPackKey[];
  replaceExisting: boolean;
  faceOnlyCutout: boolean;
  review: boolean;
}

export async function planAndQueueMasterPack(
  chars: Character[],
  opts: MasterPackOpts,
  onStep: (msg: string) => void,
): Promise<{ rows: number; jobs: number; sets: number; failed: string[] }> {
  const selected = MASTER_PACKS.filter((p) => opts.packs.includes(p.key));
  if (!chars.length) throw new Error("Pick at least one character");
  if (!selected.length) throw new Error("Pick at least one V9 set to build");

  onStep("Checking installed LoRAs & nodes…");
  const [installedLoras, faceSegInfo] = await Promise.all([
    listLoras().catch(() => [] as string[]),
    objectInfo("FaceSegment").catch(() => null),
  ]);
  const hasFaceSegment = !!faceSegInfo;
  const resolvedByPack = new Map<MasterPackKey, LoraPick[]>(
    selected.map((p) => [p.key, resolvePackLoras(p.loras, installedLoras)]),
  );

  // Plan prompts in parallel (up to 4 chars at once so DeepSeek runs fast without stalling)
  const plans: (Record<string, string[]> | null)[] = new Array(chars.length).fill(null);
  const failed: string[] = [];
  let planIdx = 0;
  let planDone = 0;
  const concurrency = Math.min(4, chars.length);

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (planIdx < chars.length) {
      const i = planIdx++;
      const c = chars[i];
      const disp = c.site?.name || c.name;
      onStep(`Planning V9 packs (${planDone + 1}/${chars.length}: ${disp})…`);
      try {
        plans[i] = await planCharacterPacks(c, selected.map((p) => p.key));
      } catch (e) {
        failed.push(`${disp}: ${(e as Error).message}`);
      }
      planDone++;
    }
  }));

  const runTs = Math.floor(Date.now() / 1000);
  const rowsToAdd: Partial<Row>[] = [];
  let setCount = 0;
  const group = newGroup(`V9 Master Pack (${selected.length} sets)`);

  for (let i = 0; i < chars.length; i++) {
    const plan = plans[i];
    if (!plan) continue;
    const c = chars[i];
    const disp = c.site?.name || c.name;
    const slug = disp.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || c.id;
    onStep(`Preparing cutout (${i + 1}/${chars.length}: ${disp})…`);
    let cutoutImage: string;
    try {
      cutoutImage = await prepareCutout(c, opts.faceOnlyCutout, hasFaceSegment);
    } catch (e) {
      failed.push(`${disp}: ${(e as Error).message}`);
      continue;
    }

    const { anchor: bodyAnchor } = bodyDescFor(c);
    for (const pack of selected) {
      const shots = plan[pack.key] ?? [];
      if (!shots.length) continue;
      setCount++;
      const setKey = `${pack.tier}-${pack.setTag}-${runTs}`;
      const packLoras = resolvedByPack.get(pack.key) ?? [];
      shots.forEach((shotPrompt, sIdx) => {
        rowsToAdd.push({
          charId: c.id,
          idea: `V9 ${pack.shortLabel} · ${sIdx + 1}/${shots.length}`,
          prompt: shotPrompt,
          status: "ready",
          takes: 1,
          loras: packLoras,
          group,
          toSet: { title: pack.title, tier: pack.tier, rating: pack.rating, setKey },
          v9: {
            packKey: pack.key,
            packTag: pack.setTag,
            cutoutImage,
            refBoost: pack.refBoost,
            bodyAnchor,
            prefix: `studio/packs/${slug}/v9_${pack.key}_${sIdx + 1}`,
            nudeFraming: pack.nudeFraming,
            replaceExisting: opts.replaceExisting,
          },
        });
      });
    }
  }

  if (!rowsToAdd.length) {
    throw new Error(failed[0] || "No V9 Master Pack shots were planned");
  }

  const b = useBatch.getState();
  b.set({ target: "image" });
  const empty = b.rows.filter((r) => !r.imitate && !r.civit && !r.idea.trim() && !r.prompt.trim());
  const made = rowsToAdd.map((p) => newRow(p));
  useBatch.setState((s) => ({ rows: [...s.rows.filter((r) => !empty.includes(r)), ...made] }));

  if (opts.review) {
    return { rows: made.length, jobs: 0, sets: setCount, failed };
  }

  onStep(`Queueing ${made.length} V9 pictures across GPU(s)…`);
  const jobs = await queueAll(made.map((r) => r.id));
  return { rows: made.length, jobs, sets: setCount, failed };
}
