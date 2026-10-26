// Builds ComfyUI API-format prompts for each Studio tab.
// Every builder here is validated against a real ComfyUI's /prompt by scripts/test-graphs.ts.
import { KREA_BOOST_NODE, M, h3ErosOn, h3Frames, interpOn, rtxOn, kreaBoostOn, kreaEditV2 } from "./models";

type Link = [string, number];
type Inputs = Record<string, unknown>;
export type ApiGraph = Record<string, { class_type: string; inputs: Inputs; _meta?: { title: string } }>;

class G {
  graph: ApiGraph = {};
  private n = 0;
  add(class_type: string, inputs: Inputs, title?: string): string {
    const id = String(++this.n);
    this.graph[id] = { class_type, inputs, ...(title ? { _meta: { title } } : {}) };
    return id;
  }
}
const o = (id: string, slot = 0): Link => [id, slot];

export interface LoraPick {
  name: string; strength: number;
  /** switched off: kept in the list but not used */
  off?: boolean;
  /** the LoRA's trigger words (from CivitAI), added to the prompt automatically unless noAuto */
  trigger?: string;
  noAuto?: boolean;
}
/** the LoRAs that are switched on */
export const activeLoras = (ls: LoraPick[]) => ls.filter((l) => !l.off && l.strength !== 0);
/** add the trigger words of the switched-on LoRAs that aren't in the prompt yet */
export function withTriggers(prompt: string, ls: LoraPick[]): string {
  // Only the trigger WORD itself (the first one in the LoRA's list, e.g. "acmc") — not the creator's whole list of
  // suggested tags. Those lists are recipes for the character's default look ("twintails, brown hair, striped armor…");
  // adding all of them dragged every picture back to that look, whatever the prompt said (a goth girl came out in
  // armour). And when your prompt already has the trigger, nothing is added: your words decide the rest.
  const low = prompt.toLowerCase();
  const add: string[] = [];
  for (const l of activeLoras(ls)) {
    if (l.noAuto || !l.trigger) continue;
    const word = l.trigger.split(/\s*[,\n]\s*/).map((x) => x.trim()).find(Boolean);
    if (!word || low.includes(word.toLowerCase()) || add.some((a) => a.toLowerCase() === word.toLowerCase())) continue;
    add.push(word);
  }
  return add.length ? `${add.join(", ")}, ${prompt}` : prompt;
}
export interface SamplerOpts { sampler: string; scheduler: string; steps: number; cfg: number; seed: number }

const ADULT_NEG = "child, children, kid, minor, underage, loli, shota, toddler, young child, school uniform, chibi";

// ---------------------------------------------------------------- Create
export type RealModel = "krea2" | "krea2raw";
export type AnimeModel = "anima" | "noob";
export interface CreateOpts extends SamplerOpts {
  style: "anime" | "realistic";
  /** realistic pictures: Krea 2 Turbo (default) or Krea 2 RAW */
  realModel?: RealModel;
  /** anime pictures: Anima (default) or NoobAI-XL */
  animeModel?: AnimeModel;
  /** Krea 2 RAW: Krea's turbo LoRA at this strength (0/undefined = off) */
  kreaTurboLora?: number;
  /** your own checkpoint instead of the official one: a diffusion-model file (Krea 2 / Anima fine-tunes) */
  unet?: string;
  /** …or a full SDXL checkpoint (Illustrious / NoobAI fine-tunes) */
  ckpt?: string;
  /** Illustrious only: look at this picture while drawing (IP-Adapter Plus), so a character sheet copies the picture */
  ref?: { image: string; weight: number; endAt?: number };
  positive: string;
  negative: string;
  loras: LoraPick[];
  width: number;
  height: number;
  count: number;
  cutout: boolean;
  prefix: string;
  /** finish bigger: enlarge the picture this much and redraw it lightly (a "hires fix") — ×1.5 turns 1024×1536 into 1536×2304 */
  hires?: { scale: number; denoise: number; steps?: number };
}

export function buildCreate(p: CreateOpts): ApiGraph {
  const g = new G();
  let image: Link;
  /** decode the picture; with hires: enlarge it, then redraw it lightly at the new size for real detail */
  const decode = (model: Link, pos: Link, neg: Link, ks: string, vae: Link): Link => {
    let img: Link = o(g.add("VAEDecode", { samples: o(ks), vae }));
    if (p.hires && p.hires.scale > 1.01) {
      const big = g.add("ImageScaleBy", { image: img, upscale_method: "lanczos", scale_by: p.hires.scale });
      const enc = g.add("VAEEncode", { pixels: o(big), vae });
      const ks2 = g.add("KSampler", { model, seed: p.seed, steps: p.hires.steps ?? p.steps, cfg: p.cfg, sampler_name: p.sampler, scheduler: p.scheduler,
        positive: pos, negative: neg, latent_image: o(enc), denoise: p.hires.denoise });
      img = o(g.add("VAEDecode", { samples: o(ks2), vae }));
    }
    return img;
  };
  const negative = [p.negative, ADULT_NEG].filter(Boolean).join(", ");
  if (p.style === "anime" && (p.animeModel ?? "anima") === "anima") {
    // Anima (2B, Cosmos-based) — same graph as ComfyUI's "Text to Image (Anima Base 1.0)" template (30 steps, CFG 4, er_sde/simple)
    const unet = g.add("UNETLoader", { unet_name: p.unet || M.anima, weight_dtype: "default" });
    const te = g.add("CLIPLoader", { clip_name: M.animaClip, type: "stable_diffusion", device: "default" });
    let model: Link = o(unet), clip: Link = o(te);
    for (const l of activeLoras(p.loras)) {
      const id = g.add("LoraLoader", { model, clip, lora_name: l.name, strength_model: l.strength, strength_clip: l.strength });
      model = o(id, 0); clip = o(id, 1);
    }
    const vae = g.add("VAELoader", { vae_name: M.kreaVae });
    const pos = g.add("CLIPTextEncode", { text: withTriggers(p.positive, p.loras), clip });
    const neg = g.add("CLIPTextEncode", { text: negative, clip });
    const lat = g.add("EmptyLatentImage", { width: p.width, height: p.height, batch_size: p.count });
    const ks = g.add("KSampler", {
      model, seed: p.seed, steps: p.steps, cfg: p.cfg, sampler_name: p.sampler, scheduler: p.scheduler,
      positive: o(pos), negative: o(neg), latent_image: o(lat), denoise: 1,
    });
    image = decode(model, o(pos), o(neg), ks, o(vae));
  } else if (p.style === "anime") {
    const ck = g.add("CheckpointLoaderSimple", { ckpt_name: p.ckpt || M.noob });
    let model: Link = o(ck, 0), clip: Link = o(ck, 1);
    for (const l of activeLoras(p.loras)) {
      const id = g.add("LoraLoader", { model, clip, lora_name: l.name, strength_model: l.strength, strength_clip: l.strength });
      model = o(id, 0); clip = o(id, 1);
    }
    if (p.ref) {
      const ipm = g.add("IPAdapterModelLoader", { ipadapter_file: M.ipadapterSdxl });
      const cv = g.add("CLIPVisionLoader", { clip_name: M.clipVisionH });
      const img = g.add("LoadImage", { image: p.ref.image });
      model = o(g.add("IPAdapterAdvanced", { model, ipadapter: o(ipm), image: o(img), clip_vision: o(cv), weight: p.ref.weight, weight_type: "linear",
        combine_embeds: "concat", start_at: 0, end_at: p.ref.endAt ?? 0.8, embeds_scaling: "V only" }));
    }
    const pos = g.add("CLIPTextEncode", { text: withTriggers(p.positive, p.loras), clip });
    const neg = g.add("CLIPTextEncode", { text: negative, clip });
    const lat = g.add("EmptyLatentImage", { width: p.width, height: p.height, batch_size: p.count });
    const ks = g.add("KSampler", {
      model, seed: p.seed, steps: p.steps, cfg: p.cfg, sampler_name: p.sampler, scheduler: p.scheduler,
      positive: o(pos), negative: o(neg), latent_image: o(lat), denoise: 1,
    });
    image = decode(model, o(pos), o(neg), ks, o(ck, 2));
  } else {
    // Krea 2 Turbo — same graph as ComfyUI's "Text to Image (Krea-2 Turbo)" template (8 steps, CFG 1, euler/simple);
    // Krea 2 RAW — the undistilled base (28 steps, CFG 4.5), optionally with Krea's turbo LoRA for fewer steps
    const raw = p.realModel === "krea2raw";
    const unet = g.add("UNETLoader", { unet_name: p.unet || (raw ? M.kreaRaw : M.kreaUnet), weight_dtype: "default" });
    let model: Link = o(unet);
    if (raw && p.kreaTurboLora && p.kreaTurboLora > 0) model = o(g.add("LoraLoaderModelOnly", { model, lora_name: M.kreaTurboLora, strength_model: p.kreaTurboLora }));
    for (const l of activeLoras(p.loras)) model = o(g.add("LoraLoaderModelOnly", { model, lora_name: l.name, strength_model: l.strength }));
    // Krea2T Enhancer (when installed): pictures follow the prompt more closely; 1.5 = the community workflows' setting
    if (kreaBoostOn()) model = o(g.add(KREA_BOOST_NODE, { model, enabled: true, strength: 1.5, debug: false }));
    const clip = g.add("CLIPLoader", { clip_name: M.kreaClip, type: "krea2", device: "default" });
    const vae = g.add("VAELoader", { vae_name: M.kreaVae });
    const pos = g.add("CLIPTextEncode", { text: withTriggers(p.positive, p.loras), clip: o(clip) });
    // at CFG 1 the negative is ignored anyway (the template zeroes it); above 1 it's encoded like the positive
    const neg = p.cfg > 1 ? g.add("CLIPTextEncode", { text: negative, clip: o(clip) }) : g.add("ConditioningZeroOut", { conditioning: o(pos) });
    const lat = g.add("EmptyLatentImage", { width: p.width, height: p.height, batch_size: p.count });
    const ks = g.add("KSampler", {
      model, seed: p.seed, steps: p.steps, cfg: p.cfg, sampler_name: p.sampler, scheduler: p.scheduler,
      positive: o(pos), negative: o(neg), latent_image: o(lat), denoise: 1,
    });
    image = decode(model, o(pos), o(neg), ks, o(vae));
  }
  if (p.cutout) {
    const cut = g.add("RMBG", {
      image, model: M.rmbg, sensitivity: 1, process_res: 1024, mask_blur: 0, mask_offset: 0,
      invert_output: false, refine_foreground: true, unload_model: false, background: "Alpha", background_color: "#222222",
    });
    g.add("SaveImage", { images: o(cut), filename_prefix: p.prefix + "_cutout" }, "cutout");
  } else {
    g.add("SaveImage", { images: image, filename_prefix: p.prefix }, "result");
  }
  return g.graph;
}

/** the person in one picture on a plain background (no scenery left) — what a swap is shown as "who", so their old background
 *  can't bleed into the new picture */
export function buildPlainBackground(image: string, prefix: string, color = "#eeeeee"): ApiGraph {
  const g = new G();
  const l = g.add("LoadImage", { image });
  const cut = g.add("RMBG", {
    image: o(l), model: M.rmbg, sensitivity: 1, process_res: 1024, mask_blur: 0, mask_offset: 0,
    invert_output: false, refine_foreground: true, unload_model: false, background: "Color", background_color: color,
  });
  g.add("SaveImage", { images: o(cut), filename_prefix: prefix }, "result");
  return g.graph;
}

/** remove the background of one picture (transparent PNG) */
export function buildCutout(image: string, prefix: string): ApiGraph {
  const g = new G();
  const l = g.add("LoadImage", { image });
  const cut = g.add("RMBG", {
    image: o(l), model: M.rmbg, sensitivity: 1, process_res: 1024, mask_blur: 0, mask_offset: 0,
    invert_output: false, refine_foreground: true, unload_model: false, background: "Alpha", background_color: "#222222",
  });
  g.add("SaveImage", { images: o(cut), filename_prefix: prefix }, "result");
  return g.graph;
}

// ---------------------------------------------------------------- Edit (Krea 2 Identity Edit; Anima / NoobAI redraw for anime)
/** which model edits: Krea 2 + the Identity Edit LoRA (plain-words edits, 2 pictures), or an anime redraw */
export type EditEngine = "krea" | "anima" | "noob";
export const EDIT_ENGINES: { value: EditEngine; label: string; group: string; maxImages: number; style: "realistic" | "anime" | "any" }[] = [
  { value: "krea", label: "Krea 2", group: "kedit", maxImages: 2, style: "realistic" },
  { value: "anima", label: "Anima", group: "anime", maxImages: 1, style: "anime" },
  { value: "noob", label: "Illustrious", group: "anime", maxImages: 1, style: "anime" },
];
export interface EditOpts extends SamplerOpts {
  /** default "krea" */
  engine?: EditEngine;
  /** Krea 2: how hard it holds on to the reference's look (1 = off, 4 = strong likeness; the creator's default) */
  refBoost?: number;
  /** Krea 2, two pictures: how hard it holds on to picture 1 (the scene/reference) — its layout, pose and framing.
   * 1 = copies them (the edit model's normal behaviour); lower lets your words change the pose and composition */
  sceneBoost?: number;
  images: string[]; // uploaded input filenames, image_1 first
  /** Krea 2: start from a blank white canvas of this size as picture 1 (the shape of the result), with `images` as the subject(s) —
   *  e.g. a landscape turnaround sheet from one portrait picture */
  blank?: { width: number; height: number };
  /** Krea 2: redraw only this rectangle of picture 1 (cropped, worked on at full size, pasted back with soft edges) — e.g. the face */
  region?: { x: number; y: number; width: number; height: number; feather?: number };
  instruction: string;
  negative: string;
  /** (unused since Qwen was removed; kept so older callers compile) */
  enhance?: boolean;
  resolution: number;
  prefix: string;
  /** brush editing: input filename of a white-on-black mask the size of image 1; only that area changes */
  mask?: string;
  maskSoftness?: number;
  /** the mask marks what to keep (e.g. the person, for a new background): everything else changes */
  maskInvert?: boolean;
  /** brush removal: blank out the painted area (smeared to its surrounding colours) before the edit model sees the picture, so
   *  it can't copy the person or thing back from its reference — it has to paint what belongs there instead */
  fillMask?: boolean;
  /** img2img: start from image 1 itself and only change this much (0–1), e.g. for blending a composite */
  denoise?: number;
  /** LoRAs for the edit model (style, character) — their trigger words are added to the instruction */
  loras?: LoraPick[];
  /** Illustrious redraw only: look at this picture while drawing (IP-Adapter Plus), e.g. the character's own picture */
  ref?: { image: string; weight: number; endAt?: number };
  /** your own fine-tune instead of the official model: Krea 2 / Anima diffusion model, or an Illustrious checkpoint */
  unet?: string;
  ckpt?: string;
}

export function buildEdit(p: EditOpts): ApiGraph {
  const engine = p.engine ?? "krea";
  if (engine === "krea") return buildKreaEdit(p);
  return buildAnimeEdit(p, engine);
}

/** put the edited pixels back only where the mask is white, with soft edges (brush editing) */
function pasteMasked(g: G, original: string, edited: Link, mask: string, softness = 12, invert = false, grow = 4): Link {
  const size = g.add("GetImageSize", { image: o(original) });
  const scaled = g.add("ImageScale", { image: edited, upscale_method: "lanczos", width: o(size, 0), height: o(size, 1), crop: "disabled" });
  const loaded = g.add("LoadImageMask", { image: mask, channel: "red" });
  const m = invert ? g.add("InvertMask", { mask: o(loaded) }) : loaded;
  const grown = g.add("GrowMask", { mask: o(m), expand: grow, tapered_corners: true });
  const asImg = g.add("MaskToImage", { mask: o(grown) });
  const blur = g.add("ImageBlur", { image: o(asImg), blur_radius: Math.min(31, Math.max(1, Math.round(softness))), sigma: Math.min(10, Math.max(0.5, softness / 2)) });
  const soft = g.add("ImageToMask", { image: o(blur), channel: "red" });
  return o(g.add("ImageCompositeMasked", { destination: o(original), source: o(scaled), x: 0, y: 0, resize_source: false, mask: o(soft) }));
}

/** Krea 2 + Identity Edit LoRA (github.com/lbouaraba/comfyui-krea2edit): the picture goes in twice — as latent tokens
 * (its look) and through the Qwen3-VL text encoder (what's in it). Picture 1 = the one being edited (the scene),
 * picture 2 = an optional second reference (the person to put in). Same wiring as the node's example workflow. */
function buildKreaEdit(p: EditOpts): ApiGraph {
  const g = new G();
  const unet = g.add("UNETLoader", { unet_name: p.unet || M.kreaUnet, weight_dtype: "default" });
  // V2 (once downloaded): two LoRAs, one per task — Identity Edit when a person comes from a second picture (or onto a blank
  // sheet), General Edit for plain-words changes to one picture. Loading both breaks the picture, so it's one or the other.
  const v2 = kreaEditV2();
  const identity = !!p.blank || p.images.length > 1;
  const editLora = !v2 ? M.kreaEditLora : identity ? M.kreaIdentityV2 : M.kreaGeneralV2;
  let model: Link = o(g.add("LoraLoaderModelOnly", { model: o(unet), lora_name: editLora, strength_model: 1 }));
  for (const l of activeLoras(p.loras ?? [])) model = o(g.add("LoraLoaderModelOnly", { model, lora_name: l.name, strength_model: l.strength }));
  const clip = g.add("CLIPLoader", { clip_name: M.kreaClip, type: "krea2", device: "default" });
  const vae = g.add("VAELoader", { vae_name: M.kreaVae });
  const loads = p.images.slice(0, 2).map((f) => g.add("LoadImage", { image: f }));
  // the untouched picture 1: what the result is pasted back onto
  const orig = loads[0];
  if (p.fillMask && p.mask && loads[0]) {
    // shrink the picture to a few pixels and blow it back up = the colours around the area, with no shapes left; put that into
    // the painted area (grown a little so no outline of the old thing survives)
    const size = g.add("GetImageSize", { image: o(orig) });
    const tiny = g.add("ImageScale", { image: o(orig), upscale_method: "area", width: 24, height: 24, crop: "disabled" });
    const blob = g.add("ImageScale", { image: o(tiny), upscale_method: "bilinear", width: o(size, 0), height: o(size, 1), crop: "disabled" });
    const hole = g.add("GrowMask", { mask: o(g.add("LoadImageMask", { image: p.mask, channel: "red" })), expand: 16, tapered_corners: true });
    loads[0] = g.add("ImageCompositeMasked", { destination: o(orig), source: o(blob), x: 0, y: 0, resize_source: false, mask: o(hole) });
  }
  // output: picture 1's shape at about 1 megapixel (the LoRA's sweet spot; above 2 MP the source bleeds through)
  const mp = Math.min(2, Math.max(0.5, (p.resolution || 1024) ** 2 / 1048576));
  // blank canvas: picture 1 is plain white at the size asked for (nothing in it to bleed through), the pictures given are the subject
  const first = p.blank ? g.add("EmptyImage", { width: p.blank.width, height: p.blank.height, batch_size: 1, color: 16777215 })
    : p.region ? g.add("ImageCrop", { image: o(loads[0]), width: p.region.width, height: p.region.height, x: p.region.x, y: p.region.y }) : loads[0];
  const rest = p.blank ? loads : loads.slice(1);
  const scene = p.blank ? first : g.add("ImageScaleToTotalPixels", { image: o(first), upscale_method: "lanczos", megapixels: mp, resolution_steps: 16 });
  const target = g.add("VAEEncode", { pixels: o(scene), vae: o(vae) });
  const two = rest.length > 0;
  const subject = two ? g.add("ImageScaleToTotalPixels", { image: o(rest[0]), upscale_method: "lanczos", megapixels: p.blank ? Math.min(mp, 1.2) : mp, resolution_steps: 16 }) : null;
  const subjectLat = subject ? g.add("VAEEncode", { pixels: o(subject), vae: o(vae) }) : null;
  const patched = g.add("Krea2EditModelPatch", {
    // the hold: v1.2's 4 = strong likeness; V2 Identity reaches that at about 2 (its creator's setting), V2 General stays at 4
    model, source_latent: o(target), ref_boost: v2 && identity ? Math.max(1, (p.refBoost ?? 4) / 2) : p.refBoost ?? 4, ref_boost_a: p.sceneBoost ?? 1, fit_mode: "fit",
    vae: o(vae), source_image: o(scene), target_latent: o(target),
    ...(subject && subjectLat ? { source_latent_b: o(subjectLat), source_image_b: o(subject) } : {}),
    // V2 nodes: putting a person into a scene works best with the scene pinned to the layout and the person placed beside it
    // (their look still flows, but their own pose and framing don't get copied over the scene's)
    // a blank canvas (training sets, sheets): the person beside it too, so new angles aren't pinned to their picture's own pose
    ...(v2 && subject && !p.region ? { ref_position: "beside (right of target)", ref_position_a: "aligned (trained)" } : {}),
  });
  const imgs = { image: o(scene), ...(subject ? { image_b: o(subject) } : {}) };
  const pos = g.add("Krea2EditGroundedEncode", { clip: o(clip), prompt: withTriggers(p.instruction, p.loras ?? []), grounding_px: 768, system_prompt: "", ...imgs });
  const neg = g.add("Krea2EditGroundedEncode", { clip: o(clip), prompt: p.cfg > 1 ? p.negative : "", grounding_px: 768, system_prompt: "", ...imgs });
  // a light redraw (repaint 0.32–0.42, face pass 0.45, light blend 0.2) needs far fewer steps than a full edit: ComfyUI runs every
  // step asked for even at low denoise, so 20 steps at 0.42 cost as much as a whole edit (~2 min each on a 16 GB card)
  const partial = p.denoise != null && p.denoise < 0.6;
  const steps = partial ? Math.max(6, Math.min(p.steps, Math.ceil(p.steps * p.denoise! * 1.25))) : p.steps;
  const ks = g.add("KSampler", {
    model: o(patched), seed: p.seed, steps, cfg: p.cfg, sampler_name: p.sampler, scheduler: p.scheduler,
    positive: o(pos), negative: o(neg), latent_image: o(target), denoise: p.denoise != null && p.denoise < 1 ? p.denoise : 1,
  });
  let img = o(g.add("VAEDecode", { samples: o(ks), vae: o(vae) }));
  if (p.region) {
    // back to the crop's size, then onto the original through a soft-edged rectangle
    const r = p.region, f = r.feather ?? Math.max(8, Math.round(Math.min(r.width, r.height) * 0.12));
    const small = g.add("ImageScale", { image: img, upscale_method: "lanczos", width: r.width, height: r.height, crop: "disabled" });
    let soft: string;
    if (p.mask) {
      // painted area inside the square: only the paint changes, with soft edges (ImageBlur takes at most 31 px)
      const sm = p.maskSoftness ?? 12;
      const m = g.add("CropMask", { mask: o(g.add("LoadImageMask", { image: p.mask, channel: "red" })), x: r.x, y: r.y, width: r.width, height: r.height });
      // a removal cleared a wider patch (see fillMask): paste back at least that much, or the old thing's outline survives
      const grown = g.add("GrowMask", { mask: o(m), expand: p.fillMask ? 20 : 4, tapered_corners: true });
      const blur = g.add("ImageBlur", { image: o(g.add("MaskToImage", { mask: o(grown) })), blur_radius: Math.min(31, Math.max(1, Math.round(sm))), sigma: Math.min(10, Math.max(0.5, sm / 2)) });
      soft = g.add("ImageToMask", { image: o(blur), channel: "red" });
    } else {
      const solid = g.add("SolidMask", { value: 1, width: r.width, height: r.height });
      soft = g.add("FeatherMask", { mask: o(solid), left: f, top: f, right: f, bottom: f });
    }
    img = o(g.add("ImageCompositeMasked", { destination: o(orig), source: o(small), x: r.x, y: r.y, resize_source: false, mask: o(soft) }));
  } else if (p.mask) img = pasteMasked(g, orig, img, p.mask, p.maskSoftness, p.maskInvert, p.fillMask ? 20 : 4);
  g.add("SaveImage", { images: img, filename_prefix: p.prefix }, "result");
  return g.graph;
}

/** Qwen-Image-Edit-2511 (ComfyUI's official "Image Edit (Qwen-Image 2511)" template): image1 is the picture being changed,
 *  image2/image3 are references; the prompt calls them Picture 1/2/3. Best = Qwen's own settings (40 steps, CFG 4);
 *  fast = the 4-step Lightning LoRA (CFG 1). full = the bf16 model instead of fp8 (big cards). The output keeps image1's shape
 *  at about 1 MP. Used by the edit chat's "Qwen + Krea" route as the first pass. */
export function buildQwenEdit(p: { images: string[]; prompt: string; seed: number; prefix: string; fast?: boolean; full?: boolean;
  /** turn the camera with the Multiple Angles LoRA (prompt then is "<sks> back view eye-level shot wide shot") */
  angles?: boolean }): ApiGraph {
  const g = new G();
  const unet = g.add("UNETLoader", { unet_name: p.full ? M.qwenEditFull : M.qwenEdit, weight_dtype: "default" });
  let model: Link = o(g.add("CFGNorm", { model: o(g.add("ModelSamplingAuraFlow", { model: o(unet), shift: 3.1 })), strength: 1 }));
  if (p.angles) model = o(g.add("LoraLoaderModelOnly", { model, lora_name: M.qwenAngles, strength_model: 0.9 }));
  if (p.fast) model = o(g.add("LoraLoaderModelOnly", { model, lora_name: M.qwenLightning, strength_model: 1 }));
  const clip = g.add("CLIPLoader", { clip_name: M.qwenEditClip, type: "qwen_image", device: "default" });
  const vae = g.add("VAELoader", { vae_name: M.kreaVae });
  const loads = p.images.slice(0, 3).map((f) => g.add("LoadImage", { image: f }));
  const first = g.add("FluxKontextImageScale", { image: o(loads[0]) });
  const imgs: Record<string, Link> = { image1: o(first), ...(loads[1] ? { image2: o(loads[1]) } : {}), ...(loads[2] ? { image3: o(loads[2]) } : {}) };
  const enc = (text: string) => g.add("FluxKontextMultiReferenceLatentMethod", { conditioning: o(g.add("TextEncodeQwenImageEditPlus", { clip: o(clip), vae: o(vae), prompt: text, ...imgs })), reference_latents_method: "index_timestep_zero" });
  const ks = g.add("KSampler", { model, seed: p.seed, steps: p.fast ? 4 : 40, cfg: p.fast ? 1 : 4, sampler_name: "euler", scheduler: "simple",
    positive: o(enc(p.prompt)), negative: o(enc("")), latent_image: o(g.add("VAEEncode", { pixels: o(first), vae: o(vae) })), denoise: 1 });
  g.add("SaveImage", { images: o(g.add("VAEDecode", { samples: o(ks), vae: o(vae) })), filename_prefix: p.prefix }, "result");
  return g.graph;
}

/** where is it? SAM 3 finds what the words name ("face") and the boxes come back as text: [{x,y,width,height,score}, …] */
export function buildFind(image: string, what: string, threshold = 0.4): ApiGraph {
  const g = new G();
  const ck = g.add("CheckpointLoaderSimple", { ckpt_name: M.sam3 });
  const img = g.add("LoadImage", { image });
  const txt = g.add("CLIPTextEncode", { text: what, clip: o(ck, 1) });
  const det = g.add("SAM3_Detect", { model: o(ck, 0), image: o(img), conditioning: o(txt), threshold, refine_iterations: 1, individual_masks: false });
  g.add("PreviewAny", { source: o(det, 1) }, "boxes");
  return g.graph;
}

/** finishing upscale: the picture enlarged (lanczos) and lightly redrawn at the new size by the model that suits it — real
 *  new detail (skin, hair, fabric) without changing what's in it. Tiled VAE so big sizes fit. */
/** quick upscale: NVIDIA RTX Video Super Resolution on a still picture — a second or two, sharpens what's there, no redraw */
export function buildRtxUpscale(p: { image: string; scale: number; prefix: string }): ApiGraph {
  const g = new G();
  const src = g.add("LoadImage", { image: p.image });
  const up = g.add("RTXVideoSuperResolution", { images: o(src), resize_type: "scale by multiplier", "resize_type.scale": Math.min(4, Math.max(1, p.scale)),
    quality: "HIGHBITRATE_ULTRA", strength: 1, image_encoding: "8-bit RGB" });
  g.add("SaveImage", { images: o(up), filename_prefix: p.prefix }, "result");
  return g.graph;
}

export function buildUpscale(p: { image: string; engine: "krea" | "anima" | "noob"; scale: number; denoise: number; prompt: string; negative?: string;
  steps: number; cfg: number; sampler: string; scheduler: string; seed: number; unet?: string; ckpt?: string; loras?: LoraPick[]; prefix: string }): ApiGraph {
  const g = new G();
  let model: Link, clip: Link, vae: Link;
  if (p.engine === "noob") {
    const ck = g.add("CheckpointLoaderSimple", { ckpt_name: p.ckpt || M.noob });
    model = o(ck); clip = o(ck, 1); vae = o(ck, 2);
  } else {
    model = o(g.add("UNETLoader", { unet_name: p.unet || (p.engine === "anima" ? M.anima : M.kreaUnet), weight_dtype: "default" }));
    clip = o(g.add("CLIPLoader", p.engine === "anima" ? { clip_name: M.animaClip, type: "stable_diffusion", device: "default" } : { clip_name: M.kreaClip, type: "krea2", device: "default" }));
    vae = o(g.add("VAELoader", { vae_name: M.kreaVae }));
  }
  for (const l of activeLoras(p.loras ?? [])) {
    const id = g.add("LoraLoader", { model, clip, lora_name: l.name, strength_model: l.strength, strength_clip: l.strength });
    model = o(id, 0); clip = o(id, 1);
  }
  const src = g.add("LoadImage", { image: p.image });
  const big = g.add("ImageScaleBy", { image: o(src), upscale_method: "lanczos", scale_by: p.scale });
  const lat = g.add("VAEEncodeTiled", { pixels: o(big), vae, tile_size: 1024, overlap: 64, temporal_size: 64, temporal_overlap: 8 });
  const pos = g.add("CLIPTextEncode", { text: withTriggers(p.prompt, p.loras ?? []), clip });
  const neg = p.engine === "krea" && p.cfg <= 1 ? g.add("ConditioningZeroOut", { conditioning: o(pos) }) : g.add("CLIPTextEncode", { text: [p.negative, ADULT_NEG].filter(Boolean).join(", "), clip });
  const ks = g.add("KSampler", { model, seed: p.seed, steps: p.steps, cfg: p.cfg, sampler_name: p.sampler, scheduler: p.scheduler, positive: o(pos), negative: o(neg), latent_image: o(lat), denoise: p.denoise });
  const img = g.add("VAEDecodeTiled", { samples: o(ks), vae, tile_size: 1024, overlap: 64, temporal_size: 64, temporal_overlap: 8 });
  g.add("SaveImage", { images: o(img), filename_prefix: p.prefix }, "result");
  return g.graph;
}

/** "select by words": SAM 3's outline of what the words name, grown a little, saved as a white-on-black mask the size of the
 *  picture (like a painted one) — plus the boxes it found, as text */
export function buildFindMask(image: string, what: string, grow = 16, threshold = 0.35, person = false): ApiGraph {
  const g = new G();
  const ck = g.add("CheckpointLoaderSimple", { ckpt_name: M.sam3 });
  const img = g.add("LoadImage", { image });
  const txt = g.add("CLIPTextEncode", { text: what, clip: o(ck, 1) });
  const det = g.add("SAM3_Detect", { model: o(ck, 0), image: o(img), conditioning: o(txt), threshold, refine_iterations: 2, individual_masks: false });
  let sel: Link = o(det, 0);
  if (person) {
    // a whole person: SAM 3 says which person (and where), RMBG draws their exact edge — hair, fingers, the gap under an
    // arm — so the background around them isn't part of what gets redrawn
    const matte = g.add("RMBG", {
      image: o(img), model: M.rmbg, sensitivity: 1, process_res: 1024, mask_blur: 0, mask_offset: 0,
      invert_output: false, refine_foreground: false, unload_model: false, background: "Alpha", background_color: "#222222",
    });
    const near = g.add("GrowMask", { mask: o(det, 0), expand: 40, tapered_corners: true });
    sel = o(g.add("MaskComposite", { destination: o(matte, 1), source: o(near), x: 0, y: 0, operation: "multiply" }));
  }
  const grown = g.add("GrowMask", { mask: sel, expand: Math.max(0, Math.round(grow)), tapered_corners: true });
  // helper files live in studio/_work: kept out of the tray and the catalog
  g.add("SaveImage", { images: o(g.add("MaskToImage", { mask: o(grown) })), filename_prefix: "studio/_work/mask" }, "mask");
  g.add("PreviewAny", { source: o(det, 1) }, "boxes");
  return g.graph;
}

/** anime redraw: picture 1 is redrawn by Anima or NoobAI-XL from a description of the result, keeping as much as the
 * strength allows (img2img); with a painted area only that part is redrawn (inpaint). One picture only. */
function buildAnimeEdit(p: EditOpts, engine: "anima" | "noob"): ApiGraph {
  const g = new G();
  let model: Link, clip: Link, vae: Link;
  if (engine === "anima") {
    model = o(g.add("UNETLoader", { unet_name: p.unet || M.anima, weight_dtype: "default" }));
    clip = o(g.add("CLIPLoader", { clip_name: M.animaClip, type: "stable_diffusion", device: "default" }));
    vae = o(g.add("VAELoader", { vae_name: M.kreaVae }));
  } else {
    const ck = g.add("CheckpointLoaderSimple", { ckpt_name: p.ckpt || M.noob });
    model = o(ck, 0); clip = o(ck, 1); vae = o(ck, 2);
  }
  for (const l of activeLoras(p.loras ?? [])) {
    const id = g.add("LoraLoader", { model, clip, lora_name: l.name, strength_model: l.strength, strength_clip: l.strength });
    model = o(id, 0); clip = o(id, 1);
  }
  if (p.ref && engine === "noob") {
    const ipm = g.add("IPAdapterModelLoader", { ipadapter_file: M.ipadapterSdxl });
    const cv = g.add("CLIPVisionLoader", { clip_name: M.clipVisionH });
    const rimg = g.add("LoadImage", { image: p.ref.image });
    model = o(g.add("IPAdapterAdvanced", { model, ipadapter: o(ipm), image: o(rimg), clip_vision: o(cv), weight: p.ref.weight, weight_type: "linear",
      combine_embeds: "concat", start_at: 0, end_at: p.ref.endAt ?? 0.8, embeds_scaling: "V only" }));
  }
  const src = g.add("LoadImage", { image: p.images[0] });
  const mp = Math.min(2, Math.max(0.5, (p.resolution || 1024) ** 2 / 1048576));
  const scaled = g.add("ImageScaleToTotalPixels", { image: o(src), upscale_method: "lanczos", megapixels: mp, resolution_steps: 64 });
  let lat: Link = o(g.add("VAEEncode", { pixels: o(scaled), vae }));
  if (p.mask) {
    // the painted area, at the working size: only that part is redrawn
    const size = g.add("GetImageSize", { image: o(scaled) });
    const asImg = g.add("MaskToImage", { mask: o(g.add("LoadImageMask", { image: p.mask, channel: "red" })) });
    const fitted = g.add("ImageScale", { image: o(asImg), upscale_method: "bilinear", width: o(size, 0), height: o(size, 1), crop: "disabled" });
    lat = o(g.add("SetLatentNoiseMask", { samples: lat, mask: o(g.add("ImageToMask", { image: o(fitted), channel: "red" })) }));
  }
  const pos = g.add("CLIPTextEncode", { text: withTriggers(p.instruction, p.loras ?? []), clip });
  const neg = g.add("CLIPTextEncode", { text: [p.negative, ADULT_NEG].filter(Boolean).join(", "), clip });
  const ks = g.add("KSampler", {
    model, seed: p.seed, steps: p.steps, cfg: p.cfg, sampler_name: p.sampler, scheduler: p.scheduler,
    positive: o(pos), negative: o(neg), latent_image: lat, denoise: p.denoise ?? 0.55,
  });
  let img = o(g.add("VAEDecode", { samples: o(ks), vae }));
  if (p.mask) img = pasteMasked(g, src, img, p.mask, p.maskSoftness);
  g.add("SaveImage", { images: img, filename_prefix: p.prefix }, "result");
  return g.graph;
}


// ---------------------------------------------------------------- Character import (local LLM reads a profile)
export const EXTRACT_GUIDE = `Read the character profile below and extract ONLY what is needed to draw this character.
Answer with ONE JSON object and nothing else, exactly these keys:
{"name": "", "age": 0, "gender": "female|male|other", "hair": "", "eyes": "", "body": "", "ethnicity": "", "outfit": "", "details": "", "personality": ""}
Rules:
- "age" is a number. If the profile gives no clear age, use 0.
- Each field is a short visual phrase (a few words). "details" = distinctive marks, accessories, posture.
- "personality" = 2-4 words that would show on the face (e.g. calm, teasing, tired).
- Ignore backstory, chat rules, behaviour and anything else that isn't how they look.

PROFILE:
`;

export const LOOK_GUIDE = `Look at the character in the picture and describe ONLY how they look, so an artist could draw them again.
Answer with ONE JSON object and nothing else, exactly these keys:
{"age": 0, "gender": "female|male|other", "style": "anime|realistic", "hair": "", "eyes": "", "body": "", "ethnicity": "", "outfit": "", "details": "", "personality": ""}
Rules:
- "age" is your best estimate of their apparent age as a number. If they could be under 18, or you can't tell, use 0.
- "style": "anime" for anime/manga/cartoon art, "realistic" for photos and realistic renders.
- Each other field is a short visual phrase (a few words): hair colour + length + style, eye colour, build, skin/ethnicity, every visible piece of clothing with colours, then distinctive marks, accessories, tattoos, makeup.
- "personality" = 2-4 words for the expression (e.g. calm, teasing, tired).`;

/** read a character's look from a picture (Fable 9B with its vision projector) */
export function buildDescribeCharacter(image: string, seed: number): ApiGraph {
  const g = new G();
  const img = g.add("LoadImage", { image });
  const w = g.add("LLMTextProcessor", {
    model: M.llmWriter, mmproj: M.llmWriterVision, system_prompt: "none", prompt: LOOK_GUIDE,
    max_tokens: 600, temperature: 0.2, top_p: 0.8, top_k: 20, repeat_penalty: 1.05, ctx_size: 16384,
    memory_mode: "auto", n_gpu_layers: 99, n_cpu_moe_layers: 1, seed: seed % 2 ** 31, timeout_seconds: 300, reasoning: "off", image: o(img),
  });
  g.add("PreviewAny", { source: o(w) }, "character");
  return g.graph;
}

export const SHEET_VIEWS = ["front", "left", "back", "threeq"] as const;
/** one high-resolution turnaround sheet (front, left side, back, 3/4) of the character in `image`, in a single picture */

export function buildExtractCharacter(profile: string, seed: number): ApiGraph {
  const g = new G();
  const w = g.add("LLMTextProcessor", {
    model: M.llmWriter, mmproj: "none", system_prompt: "none", prompt: EXTRACT_GUIDE + profile.slice(0, 24000),
    max_tokens: 600, temperature: 0.2, top_p: 0.8, top_k: 20, repeat_penalty: 1.05, ctx_size: 16384,
    memory_mode: "auto", n_gpu_layers: 99, n_cpu_moe_layers: 1, seed: seed % 2 ** 31, timeout_seconds: 300, reasoning: "off",
  });
  g.add("PreviewAny", { source: o(w) }, "character");
  return g.graph;
}

// ---------------------------------------------------------------- Animate (MiniMax H3)
export interface VideoRef { file: string; start: number; end: number; useSound: boolean }
export interface AnimateOpts extends Omit<SamplerOpts, "cfg"> {
  mode: "ref" | "i2v" | "loop" | "fl";
  prompt: string;
  images: string[]; // ref mode: <Picture n>; i2v/loop: [first]; fl: [first, last]
  videos: VideoRef[];
  audios: string[];
  seconds: number;
  width: number;
  height: number;
  turbo: boolean;
  loras: LoraPick[];
  refImageSize: "match" | "max";
  lowMemDecode: boolean;
  prefix: string;
}

export function buildAnimate(p: AnimateOpts): ApiGraph {
  const g = new G();
  const ref = p.mode === "ref";
  // Eros Max: one merged model for every kind of video (its own turbo deltas are baked in, so the turbo LoRA stays off)
  const eros = h3ErosOn();
  const unet = g.add("UNETLoader", { unet_name: eros ? M.h3Eros : ref ? M.h3Ref : M.h3FL, weight_dtype: "default" });
  let model: Link = o(unet);
  let steps = p.steps;
  // the official 4-step turbo LoRA exists for reference-to-video only
  if (p.turbo && ref && !eros) {
    model = o(g.add("LoraLoaderModelOnly", { model, lora_name: M.h3TurboRef, strength_model: 1 }));
    steps = 4;
  }
  for (const l of activeLoras(p.loras)) model = o(g.add("LoraLoaderModelOnly", { model, lora_name: l.name, strength_model: l.strength }));
  // Eros Max beta6: its author's "10/3 shift" (video 10, audio 3; the official files keep their own 12/3) — ComfyUI's own node
  if (eros) model = o(g.add("MiniMaxH3SigmaShift", { model, shift_video: 10, shift_audio: 3 }));
  const clip = g.add("CLIPLoader", { clip_name: M.h3TE, type: "minimax", device: "default" });
  const vae = g.add("VAELoader", { vae_name: M.h3Vae });
  const avae = g.add("VAELoader", { vae_name: M.h3AudioVae });
  const length = h3Frames(p.seconds);

  let cond: string;
  if (ref) {
    const inputs: Inputs = {
      clip: o(clip), prompt: withTriggers(p.prompt, p.loras), width: p.width, height: p.height, length, ref_image_size: p.refImageSize,
      vae: o(vae), audio_vae: o(avae),
    };
    p.images.slice(0, 9).forEach((f, i) => (inputs[`ref_images.ref_image_${i}`] = o(g.add("LoadImage", { image: f }))));
    p.videos.slice(0, 3).forEach((v, i) => {
      const fps = 24;
      const vid = g.add("VHS_LoadVideo", {
        video: v.file, force_rate: fps, custom_width: 0, custom_height: 480,
        frame_load_cap: Math.max(1, Math.round((v.end - v.start) * fps)), skip_first_frames: Math.round(v.start * fps),
        select_every_nth: 1, format: "None",
      });
      inputs[`ref_videos.ref_video_${i}`] = o(vid, 0);
      if (v.useSound) inputs[`ref_video_audios.ref_video_audio_${i}`] = o(vid, 2);
    });
    p.audios.slice(0, 3).forEach((f, i) => (inputs[`ref_audios.ref_audio_${i}`] = o(g.add("LoadAudio", { audio: f }))));
    cond = g.add("MiniMaxH3ReferenceToVideo", inputs);
  } else {
    const first = p.images[0] ? g.add("LoadImage", { image: p.images[0] }) : null;
    const lastFile = p.mode === "loop" ? p.images[0] : p.mode === "fl" ? p.images[1] : undefined;
    const last = lastFile ? (lastFile === p.images[0] && first ? first : g.add("LoadImage", { image: lastFile })) : null;
    cond = g.add("MiniMaxH3ImageToVideo", {
      clip: o(clip), vae: o(vae), prompt: withTriggers(p.prompt, p.loras), width: p.width, height: p.height, length,
      ...(first ? { first_frame: o(first) } : {}), ...(last ? { last_frame: o(last) } : {}),
    });
  }
  const noise = g.add("RandomNoise", { noise_seed: p.seed });
  const guider = g.add("BasicGuider", { model, conditioning: o(cond, 0) });
  const sampler = g.add("KSamplerSelect", { sampler_name: p.sampler });
  const sigmas = g.add("BasicScheduler", { model, scheduler: p.scheduler, steps, denoise: 1 });
  const out = g.add("SamplerCustomAdvanced", { noise: o(noise), guider: o(guider), sampler: o(sampler), sigmas: o(sigmas), latent_image: o(cond, 1) });
  const frames = p.lowMemDecode
    ? g.add("VAEDecodeTiled", { samples: o(out), vae: o(vae), tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 })
    : g.add("VAEDecode", { samples: o(out), vae: o(vae) });
  const audio = g.add("VAEDecodeAudio", { samples: o(out), vae: o(avae) });
  // smoother: RIFE puts a frame between every two (24 → 48 fps, same length and sound), as most community H3 workflows do
  const it = interpOn();
  const smooth = it.on ? g.add("FrameInterpolate", { interp_model: o(g.add("FrameInterpolationModelLoader", { model_name: M.rife })), images: o(frames), [it.widget]: 2 }) : null;
  // RTX Video Super Resolution: the finished frames enlarged to about 1080p on the long side (fast — NVIDIA's video upscaler, not
  // another diffusion pass), so a quick 0.5 MP video comes out sharp enough to post. "HIGHBITRATE" = for clean sources like these
  const upBy = Math.round(Math.min(4, 1920 / Math.max(p.width, p.height)) * 100) / 100;
  const up = rtxOn() && upBy >= 1.1 ? g.add("RTXVideoSuperResolution", { images: o(smooth ?? frames), resize_type: "scale by multiplier", "resize_type.scale": upBy,
    quality: "HIGHBITRATE_ULTRA", strength: 1, image_encoding: "8-bit RGB" }) : null;
  const video = g.add("CreateVideo", { images: o(up ?? smooth ?? frames), fps: smooth ? 48 : 24, audio: o(audio) });
  g.add("SaveVideo", { video: o(video), filename_prefix: p.prefix, format: "auto", "format.codec": "auto" }, "result");
  return g.graph;
}

// ---------------------------------------------------------------- Prompt helper (local LLMs)
export interface PromptRefPicture { file: string; tag: string; label: string }
export interface PromptRefVideo { file: string; tag: string; label: string; start: number; end: number; useSound: boolean }
export interface PromptRefAudio { tag: string; label: string }
export interface PromptOpts {
  pictures: PromptRefPicture[];
  videos: PromptRefVideo[];
  audios: PromptRefAudio[];
  idea: string;
  seconds: number;
  cuts: number; // 0 = let it decide
  camera: string;
  mode: string;
  guide: string; // the writer's instructions — "" when they come from the prompt file (system prompt)
  seed: number;
  /** the "Plan a video writer" prompt file (same one in every tab) and which model runs it */
  writer?: { file: string; params: StageParams; thinking?: "auto" | "on" | "off"; big?: boolean };
  /** saved characters among the pictures: their name, look line and the <Picture n> tags of their views */
  characters?: { name: string; look: string; tags: string[] }[];
}

export const DEFAULT_GUIDE = `You plan short videos for the MiniMax H3 video model. You turn the user's idea into a precise, richly detailed timeline. H3 follows long, concrete descriptions far better than short phrases, so write a lot — never a few words where a full paragraph fits.

Rules:
- Refer to every person, place and thing that has a reference ONLY by its tag, exactly as written, e.g. <Picture 1>. Never invent tags.
- Everyone in the video is an adult. Never describe anyone as a child or as young-looking.
- Cuts must cover the whole video from 0:00 to the end with no gaps or overlaps. If the user asks for one cut, write exactly one cut.
- Image → video: the video starts exactly on <Picture 1>. Describe what changes from that first frame, and say that everything else (face, hair, outfit, place, light, colours, art style, framing) stays exactly as in <Picture 1>.

How much to write:
- Each cut's "what happens" is ONE long paragraph on one line: about 25 words per second of the cut, at least 80 words (a 10-second single cut ≈ 200–280 words).
- Go beat by beat with times inside the paragraph ("0:00–0:02 …, 0:02–0:05 …"), so every second is covered.
- Name the body parts and how they move: head tilt, eyes and gaze, eyebrows, mouth, shoulders, each arm, each hand and its fingers, hips, legs, weight shifts, breathing. Say the speed (slowly, a quick flick), the direction and where each movement ends.
- Describe secondary motion: hair, clothes, fabric, jewellery, anything held, reflections, dust, steam, background people or objects.
- Describe the camera in detail: framing, height, angle, lens feel, how it moves (handheld sway and micro-shake, slow push-in, drift, focus pulls), and whether it ever stops.
- Describe light and colour and how they change, and the surface feel (skin texture, film grain, paint, gloss).
- Repeat each character's key look (hair, eyes, outfit) inside every cut they appear in.

Output ONLY lines in these formats, nothing else (no titles, no explanations, no markdown):
STYLE | the look of the whole clip in 40–80 words: medium (photo, film, anime, painting), lens and camera feel, lighting, colour palette, texture, mood
CUT | start | end | shot and camera | what happens (the long paragraph)
SAY | time | who (a tag) | voice (an audio tag or "none") | the exact words
SOUND | start | end | what is heard
Times look like 0:00, 0:06 or 0:06.5.
Spoken lines go on SAY lines with the exact words in plain text. Sound goes on SOUND lines: music, voices, effects, ambience, with when they start and stop. If a reference video is given, say in the cut which part copies it (dance moves, motion, camera move).`;

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const whole = Number.isInteger(Math.round(r * 10) / 10) ? String(Math.round(r)).padStart(2, "0") : (Math.round(r * 10) / 10).toFixed(1).padStart(4, "0");
  return `${m}:${whole}`;
}

/** what the describer answers when someone in a clip might be under 18; the Studio stops there */
export const MINOR_FLAG = "UNDERAGE_STOP";

/** evenly spaced frames from the trimmed part of a clip: [VHS_LoadVideo node, frame count, seconds between frames] */
function clipFrames(g: G, v: { file: string; start: number; end: number }): [string, number, number] {
  const len = Math.max(0.5, v.end - v.start);
  const n = Math.max(4, Math.min(10, Math.round(len * 1.2)));
  const nth = Math.max(1, Math.floor((len * 24) / n));
  const vid = g.add("VHS_LoadVideo", {
    video: v.file, force_rate: 24, custom_width: 0, custom_height: 384,
    frame_load_cap: n, skip_first_frames: Math.round(v.start * 24), select_every_nth: nth, format: "None",
  });
  return [vid, n, nth / 24];
}

/** the local writer model (Fable 9B + its vision projector) looks at the frames of one clip and says what happens */
function describeClip(g: G, v: { file: string; start: number; end: number }, seed: number, detail: "motion" | "full"): string {
  const [vid, n, step] = clipFrames(g, v);
  const last = fmtTime((n - 1) * step);
  const prompt = [
    `These ${n} pictures are frames from ONE video clip, in order, one every ${step.toFixed(2)} s (frame 1 is 0:00, frame ${n} is ${last}).`,
    "Describe what happens in the clip in time order with rough timestamps (0:00, 0:01.5 ...): the action, every movement or dance move and how the body moves, gestures, how the camera moves and the framing (wide, medium, close-up), and when anything changes.",
    detail === "motion"
      ? "Call the people 'person A', 'person B'. Do NOT describe their faces, hair, bodies or clothes — only what they do. Mention the setting in a few words."
      : "Then, in one or two sentences, describe the people (hair, clothes, build — no names), the setting and the lighting.",
    "Everyone must be an adult. If anyone in the frames could be under 18, answer with only the word " + MINOR_FLAG + ".",
    "Write plain sentences, no lists, no headings, no more than 160 words.",
  ].join("\n");
  return g.add("LLMTextProcessor", {
    model: M.llmWriter, mmproj: M.llmWriterVision, system_prompt: "none", prompt,
    max_tokens: 500, temperature: 0.3, top_p: 0.8, top_k: 20, repeat_penalty: 1.05, ctx_size: 16384,
    memory_mode: "auto", n_gpu_layers: 99, n_cpu_moe_layers: 1, seed: seed % 2 ** 31, timeout_seconds: 300, reasoning: "off", image: o(vid, 0),
  });
}

/** "Read the clip for me": one clip → a plain description of what happens in it */
export function buildDescribeVideo(v: { file: string; start: number; end: number }, seed: number, detail: "motion" | "full"): ApiGraph {
  const g = new G();
  g.add("PreviewAny", { source: o(describeClip(g, v, seed, detail)) }, "seen");
  return g.graph;
}

/** the idea used when the box is left empty but there's a clip to copy */
export function defaultIdea(p: Pick<PromptOpts, "videos" | "pictures" | "characters">): string {
  const vids = p.videos.map((v) => v.tag).join(" and ");
  const who = p.characters?.length ? p.characters.map((c) => `${c.name} (${c.tags.join(", ")})`).join(" and ")
    : p.pictures.length ? p.pictures.map((x) => x.tag).join(" and ") : "";
  return vids ? `Recreate what happens in ${vids} as closely as possible — the same moves, timing, framing and camera${who ? `, performed by ${who} instead of the people in the clip` : ""}.` : "";
}

export function buildPromptHelper(p: PromptOpts): ApiGraph {
  const g = new G();
  // 1) the local model watches each reference clip first (a handful of frames); its notes are spliced into the writer's prompt
  const hasPeople = p.pictures.length > 0;
  const videoDescs: [PromptRefVideo, string][] = p.videos.map((v, i) => {
    const d = describeClip(g, v, p.seed + i + 1, hasPeople ? "motion" : "full");
    g.add("PreviewAny", { source: o(d) }, `seen:${v.tag}`);
    return [v, d];
  });

  // 2) assemble the writer prompt; video descriptions are spliced in at run time
  const charTags = new Set((p.characters ?? []).flatMap((c) => c.tags));
  const refLines: string[] = [];
  p.pictures.forEach((pic, i) => refLines.push(`${pic.tag}: ${pic.label || "picture"} (attached image ${i + 1})`));
  const charLines = (p.characters ?? []).map((c) =>
    `${c.name} is the person in ${c.tags.join(" and ")} (the same person in each). ${c.name}'s look: ${c.look}. In EVERY cut where ${c.name} appears, write "${c.name} (${c.tags.join(", ")})" and restate that look, so ${c.name} stays exactly the same person from start to end.`);
  const head = [
    ...(p.guide.trim() ? [p.guide, ""] : []),
    "References:",
    ...refLines,
    ...(charLines.length ? ["", "Characters:", ...charLines] : []),
    ...(p.pictures.some((x) => !charTags.has(x.tag)) ? ["", "Identity: whenever a person from the reference pictures appears, name them by their tag (e.g. <Picture 1>) in EVERY cut and restate their key look (hair, eyes, outfit) in that cut, so they stay exactly the same person from start to end."] : []),
    ...(p.videos.length && hasPeople ? ["", "The people in the reference clips are only there to show the motion: never copy their looks — the people from the reference pictures perform it."] : []),
  ].join("\n");
  let text: unknown = head;
  for (const [v, d] of videoDescs) {
    const a = g.add("StringConcatenate", { string_a: text, string_b: `${v.tag}: ${v.label || "video clip"}${v.useSound ? " (its sound is used too)" : ""}. What happens in it: `, delimiter: "\n" });
    text = o(g.add("StringConcatenate", { string_a: o(a), string_b: o(d), delimiter: "" }));
  }
  const tail = [
    ...p.audios.map((a) => `${a.tag}: ${a.label || "audio"}`),
    "",
    `Video type: ${p.mode}. Length: ${fmtTime(p.seconds)} (${p.seconds} seconds).`,
    p.cuts > 0 ? `Use exactly ${p.cuts} cut${p.cuts > 1 ? "s" : ""}.` : "Choose how many cuts fit the idea.",
    p.camera && p.camera !== "auto" ? `Camera: ${p.camera}.` : "",
    "",
    `The idea: ${p.idea.trim() || defaultIdea(p)}`,
  ].filter((l) => l !== undefined).join("\n");
  text = typeof text === "string" ? `${text}\n${tail}` : o(g.add("StringConcatenate", { string_a: text, string_b: tail, delimiter: "\n" }));

  // 3) the writer sees the pictures directly (vision projector) when there are any
  let image: Link | undefined;
  if (p.pictures.length) {
    const loads = p.pictures.map((pic) => g.add("LoadImage", { image: pic.file }));
    image = loads.length === 1 ? o(loads[0]) : o(g.add("BatchImagesNode", Object.fromEntries(loads.map((id, i) => [`images.image${i}`, o(id)]))));
  }
  const wr = p.writer;
  const big = !!wr?.big;
  const pr = wr?.params;
  const w = g.add("LLMTextProcessor", {
    model: big ? M.llmBig : M.llmWriter, mmproj: image ? (big ? M.llmBigVision : M.llmWriterVision) : "none", system_prompt: wr?.file || "none", prompt: text,
    max_tokens: Math.max(256, Math.min(16384, Math.round(pr?.max_tokens ?? 3000))), temperature: pr?.temperature ?? 0.7, top_p: pr?.top_p ?? 0.8,
    top_k: Math.max(1, Math.round(pr?.top_k ?? 20)), repeat_penalty: pr?.repeat_penalty ?? 1.05, ctx_size: 16384,
    memory_mode: "auto", n_gpu_layers: 99, n_cpu_moe_layers: 1, seed: p.seed % 2 ** 31, timeout_seconds: big ? 900 : 300,
    reasoning: wr?.thinking ?? "off", ...(image ? { image } : {}),
  });
  g.add("PreviewAny", { source: o(w, 0) }, "timeline");
  return g.graph;
}

// ---------------------------------------------------------------- Scenes pipeline: one LLM stage with a dropped-in system prompt
export interface StageParams { temperature: number; top_p: number; top_k: number; repeat_penalty: number; max_tokens: number }
/** run one pipeline stage: `promptFile` is the system prompt (a file in models/LLM/prompts, passed to llama.cpp with -sysf) */
export function buildStage(p: { promptFile: string; promptChars?: number; input: string; params: StageParams; images?: string[]; big: boolean; seed: number; thinking?: "auto" | "on" | "off"; timeout?: number }): ApiGraph {
  const g = new G();
  let image: Link | undefined;
  const imgs = (p.images ?? []).filter(Boolean).slice(0, 4);
  if (imgs.length) {
    const loads = imgs.map((f) => g.add("LoadImage", { image: f }));
    image = loads.length === 1 ? o(loads[0]) : o(g.add("BatchImagesNode", Object.fromEntries(loads.map((id, i) => [`images.image${i}`, o(id)]))));
  }
  const maxTokens = Math.max(64, Math.min(16384, Math.round(p.params.max_tokens || 8192)));
  // room for the (sometimes very long) system prompt + your input + the answer (+ thinking) + pictures
  const need = ((p.promptChars ?? 8000) + p.input.length) / 3.2 + maxTokens + 1024 + imgs.length * 1200;
  const ctx = Math.min(65536, Math.max(8192, Math.ceil(need / 4096) * 4096));
  const w = g.add("LLMTextProcessor", {
    model: p.big ? M.llmBig : M.llmWriter, mmproj: image ? (p.big ? M.llmBigVision : M.llmWriterVision) : "none",
    system_prompt: p.promptFile, prompt: p.input,
    max_tokens: maxTokens, temperature: p.params.temperature ?? 0.6,
    top_p: p.params.top_p ?? 0.9, top_k: Math.max(1, Math.round(p.params.top_k ?? 40)), repeat_penalty: p.params.repeat_penalty ?? 1.05,
    ctx_size: ctx, memory_mode: "auto", n_gpu_layers: 99, n_cpu_moe_layers: 1, seed: p.seed % 2 ** 31, timeout_seconds: p.timeout ?? 1200, reasoning: p.thinking ?? "off",
    ...(image ? { image } : {}),
  });
  g.add("PreviewAny", { source: o(w, 0) }, "out");
  if (p.thinking !== "off") g.add("PreviewAny", { source: o(w, 1) }, "thinking");
  return g.graph;
}
