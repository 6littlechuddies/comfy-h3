// Model files baked into the image by models.txt. Change here if models.txt changes.
export const KREA_TE_UNCENSORED = "qwen3VL4BAbliteratedComfyui_v10_full_fp8.safetensors";
const kreaTE = { uncensored: false };
/** set from the downloads (is the uncensored encoder here?) and your choice (Create → Advanced) */
export const setKreaTE = (uncensored: boolean) => { kreaTE.uncensored = uncensored; };
export const KREA_TE_KEY = "h3.kreaTE"; // "stock" = always the stock encoder
const kreaEdit = { v2: false };
/** set from the downloads (are the V2 edit LoRAs here?) and your choice (Edit → Edit model) */
export const setKreaEditV2 = (v2: boolean) => { kreaEdit.v2 = v2; };
export const kreaEditV2 = () => kreaEdit.v2;
const kreaBoost = { on: false };
/** Krea2T Enhancer (custom node): on when the node is installed, unless you switched it off (Create → Follow the prompt harder) */
export const setKreaBoost = (on: boolean) => { kreaBoost.on = on; };
export const kreaBoostOn = () => kreaBoost.on;
export const KREA_BOOST_KEY = "h3.kreaBoost"; // "off" = never
export const KREA_BOOST_NODE = "ComfyUI-Krea2T-Enhancer";
const h3 = { eros: false };
/** Animate → Video model: Eros Max (models.txt group "eros") once it's downloaded and picked, else the official H3 files */
export const setH3Eros = (on: boolean) => { h3.eros = on; };
export const h3ErosOn = () => h3.eros;
export const H3_MODEL_KEY = "h3.videoModel"; // "eros" = use Eros Max when it's here
/** which local writer writes prompts: the 27B whenever it's downloaded (default), or "fast" = always the 9B */
export const WRITER_KEY = "h3.writer";
export const writerFast = () => { try { return localStorage.getItem(WRITER_KEY) === "fast"; } catch { return false; } };
/** smoother videos: ComfyUI's FrameInterpolate (RIFE) doubles the frames, when the node and the model are here and it's on */
const interp = { on: false, widget: "multiplier" };
export const setInterp = (on: boolean, widget?: string) => { interp.on = on; if (widget) interp.widget = widget; };
export const interpOn = () => interp;
export const SMOOTH_KEY = "h3.smooth"; // "off" = never
/** RTX Video Super Resolution (NVIDIA VFX nodes): finished videos enlarged to about 1080p, when the node is here and it's on */
const rtx = { on: false };
export const setRtx = (on: boolean) => { rtx.on = on; };
export const rtxOn = () => rtx.on;
export const RTX_KEY = "h3.rtxUp"; // "off" = never
export const KREA_EDIT_KEY = "h3.kreaEdit"; // "v1" = always the v1.2 LoRA
export const M = {
  noob: "NoobAI-XL-v1.1.safetensors",
  /** IP-Adapter Plus (SDXL) + its image encoder: Illustrious character sheets that copy the front picture */
  ipadapterSdxl: "ip-adapter-plus_sdxl_vit-h.safetensors",
  clipVisionH: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
  kreaUnet: "krea2_turbo_fp8_scaled.safetensors",
  kreaRaw: "krea2_raw_civitai.safetensors", // CivitAI upload (falls back to the official fp8 file under this name)
  kreaTurboLora: "krea2_turbo_lora_rank_64_bf16.safetensors",
  kreaEditLora: "Krea2/krea2_identity_edit_v1_2.safetensors", // Edit tab (models.txt group "kedit")
  /** V2 (models.txt group "kedit2"): Identity Edit restages a person from a picture, General Edit does plain-words changes */
  kreaIdentityV2: "Krea2/krea2_identity_edit_v2.safetensors",
  kreaGeneralV2: "Krea2/krea2_general_edit_v2.safetensors",
  anima: "anima-base-v1.0.safetensors",
  animaClip: "qwen_3_06b_base.safetensors",
  /** Krea 2's text encoder: the uncensored (abliterated) one once it's downloaded (models.txt group "krea_te") — the
   *  community's choice, so explicit prompts aren't watered down — unless you switched back to the stock one */
  get kreaClip() { return kreaTE.uncensored ? KREA_TE_UNCENSORED : "qwen3vl_4b_fp8_scaled.safetensors"; },
  kreaVae: "qwen_image_vae.safetensors",
  h3Ref: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  /** H3 Eros Max beta6 int8 (one hybrid model for reference, text and first-frame videos) */
  h3Eros: "h3ErosMax_beta6_int8.safetensors",
  /** RIFE v4.26 for ComfyUI's FrameInterpolate (models.txt group "smooth") */
  rife: "rife_v4.26.safetensors",
  h3FL: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  h3TE: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  h3Vae: "minimax_h3_video_vae_int8_convrot.safetensors",
  h3AudioVae: "minimax_h3_audio_vae_fp32.safetensors",
  h3TurboRef: "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
  llmWriter: "Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-Q8_0.gguf",
  llmWriterVision: "mmproj-F16.gguf",
  llmBig: "Qwen3.8-27B-Uncensored-noMTP-Q5_K_M.gguf",
  llmBigVision: "mmproj-Qwen3.8-27B-Uncensored-F16.gguf",
  llmVideo: "Qwen3VL-8B-Instruct-Q8_0.gguf",
  rmbg: "RMBG-2.0",
  /** SAM 3.1: finds things by words (models.txt group "sam") */
  sam3: "sam3.1_multiplex_fp16.safetensors",
  // Edit chat's "Qwen + Krea" route: Qwen-Image-Edit-2511 (models.txt groups "qwen" and "qwen_full")
  qwenEdit: "qwen_image_edit_2511_fp8mixed.safetensors",
  qwenEditFull: "qwen_image_edit_2511_bf16.safetensors",
  qwenEditClip: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
  qwenLightning: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
  qwenAngles: "qwen-image-edit-2511-multiple-angles-lora.safetensors",
} as const;

/** H3 frame count: 24 fps, snapped to the model's 17k+5 grid (same formula as the official template). */
export function h3Frames(seconds: number): number {
  const l = Math.max(5, Math.round(seconds * 24));
  return l + ((((5 - (l % 17)) % 17) + 17) % 17);
}

/** Size for H3 from a picture's width ÷ height and megapixels, multiples of 32 (a vertical photo stays vertical, never stretched) */
export function h3SizeFor(ratio: number, mp: number): { width: number; height: number } {
  const r = Math.min(2.5, Math.max(0.4, ratio || 16 / 9));
  const px = mp * 1024 * 1024;
  const h = Math.sqrt(px / r);
  const q = (v: number) => Math.max(256, Math.round(v / 32) * 32);
  return { width: q(h * r), height: q(h) };
}

/** Size for H3 from an aspect ratio and megapixels, multiples of 32 (matches ResolutionSelector). */
export function h3Size(aspect: string, mp: number): { width: number; height: number } {
  const [a, b] = aspect.split(":").map(Number);
  const px = mp * 1024 * 1024;
  const h = Math.sqrt((px * b) / a);
  const w = (h * a) / b;
  const r = (v: number) => Math.max(256, Math.round(v / 32) * 32);
  return { width: r(w), height: r(h) };
}
