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
/** ApplyMiniMaxH3FirstBlockCache (Deooeo speedup node): opt-in toggle in 05 Animate → Advanced when node is installed */
const h3Cache = { on: false };
export const setH3Cache = (on: boolean) => { h3Cache.on = on; };
export const h3CacheOn = () => h3Cache.on;
export const H3_CACHE_KEY = "h3.firstBlockCache"; // "on" = enable First-Block Cache (0.10 / max 2)
export const H3_CACHE_NODE = "ApplyMiniMaxH3FirstBlockCache";
const h3 = { eros: false };
/** Animate → Video model: Eros Max (models.txt group "eros") once it's downloaded and picked, else the official H3 files */
export const setH3Eros = (on: boolean) => { h3.eros = on; };
export const h3ErosOn = () => h3.eros;
export const H3_MODEL_KEY = "h3.videoModel"; // "eros" = use Eros Max when it's here
/** which local writer writes prompts: the 27B whenever it's downloaded (default), or "fast" = always the 9B */
export const WRITER_KEY = "h3.writer";
/** the 9B "fast" writer is gone: always false (an old "fast" choice now means the 27B) */
export const writerFast = () => false;
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
/** realistic skin in videos: fal's H3 Realism People LoRA, when it's downloaded, unless you switched it off (Animate) */
const realism = { on: false };
export const setRealism = (on: boolean) => { realism.on = on; };
export const realismOn = () => realism.on;
export const REALISM_KEY = "h3.realism"; // "off" = never
export const REALISM_TRIGGER = "r34l1sm";
/** character sheets with the QuadView LoRA (Krea 2), when it's downloaded */
const quad = { on: false };
export const setQuadSheet = (on: boolean) => { quad.on = on; };
export const quadSheetOn = () => quad.on;
/** head and body swap with BFS (Alissonerdx) on Krea 2, when its group "bfs" is downloaded */
const bfs = { on: false };
export const setBfs = (on: boolean) => { bfs.on = on; };
export const bfsOn = () => bfs.on;
export const KREA_EDIT_KEY = "h3.kreaEdit"; // "v1" = always the v1.2 LoRA
export const M = {
  /** fal's MiniMax H3 Realism People LoRA (models.txt group "hreal") */
  h3Realism: "minimax/h3-realism-people-t2v-i2v-r2v.safetensors",
  /** Alissonerdx's QuadView character-sheet LoRA for Krea 2 (group "csheet") */
  quadView: "QuadView_krea2_v1.safetensors",
  /** BFS head swap v1.1 and body swap v1 for Krea 2 (group "bfs") */
  bfsHead: "BFS/bfs_head_swap_v1.1_krea2.safetensors",
  bfsBody: "BFS/bfs_body_swap_v1_krea2.safetensors",
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
  /** Krea 2 depth ControlNet-LoRA (Patil/Krea-2-depth-controlnet) and the depth estimator (Depth Anything V2 Small, Apache-2.0) */
  kreaDepth: "depth-control-lora.safetensors",
  depthAnything: "depth_anything_v2_vits_fp16.safetensors",
  h3Motion: "minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors",
  videoDepth: "video_depth_anything_vits.pth",
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
  /** Character swap LoRA v1.5 (akatz-ai): the person in a reference video becomes the character in a reference picture */
  h3Swap: "minimax/h3_character_swap_v1.5.safetensors",
  /** BFS Character Swap v1.1 for MiniMax H3 Ref2VA (Alissonerdx): guide-latent swap LoRA (~80 MB, native H3 nodes) */
  h3BfsSwap: "BFS/minimax_h3_character_swap_v1.1_ref2va_fro.safetensors",
  /** DMD 8-step Ref2VA turbo LoRA for fast BFS H3 Character Swap v1.1 previews */
  h3BfsTurbo8: "minimax/minimax_h3_dmd_ref2va_8step_turbo_pruned.safetensors",
  /** H3 Relay's swap recipe: the full-precision video VAE (also in the Video group) and the FL2V 8-step 768p turbo */
  h3VaeFp16: "minimax_h3_video_vae_fp16.safetensors",
  h3TurboFl8: "minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
  // the 9B Fable writer was removed: "the writer" is the 27B everywhere now (same files as llmBig)
  llmWriter: "Qwen3.8-27B-Uncensored-noMTP-Q5_K_M.gguf",
  llmWriterVision: "mmproj-Qwen3.8-27B-Uncensored-F16.gguf",
  llmBig: "Qwen3.8-27B-Uncensored-noMTP-Q5_K_M.gguf",
  llmBigVision: "mmproj-Qwen3.8-27B-Uncensored-F16.gguf",
  llmVideo: "Qwen3VL-8B-Instruct-Q8_0.gguf",
  rmbg: "RMBG-2.0",
  /** Extend (models.txt group "extend"): Qwen-Image-2.1 int8 + its Qwen3-VL-8B encoder + VAE, and the Outpaint LoRA v2 */
  qwen21: "qwen_image_2.1_int8_convrot.safetensors",
  qwen21TE: "qwen3vl_8b_int8_convrot.safetensors",
  qwen21Vae: "qwen_image_2.1_vae_bf16.safetensors",
  qwen21Outpaint: "qwen21/qwen-image-2.1-outpaint-v2.safetensors",
  /** Qwen Image 2.1's official 8-step turbo LoRA (Speed-ups → Faster Extend) */
  qwen21Turbo: "qwen21/qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors",
  /** SAM 3.1: finds things by words (models.txt group "sam") */
  sam3: "sam3.1_multiplex_fp16.safetensors",
  // Edit chat's "Qwen + Krea" route: Qwen-Image-Edit-2511 (models.txt groups "qwen" and "qwen_full")
  qwenEdit: "qwen_image_edit_2511_fp8mixed.safetensors",
  qwenEditFull: "qwen_image_edit_2511_bf16.safetensors",
  qwenEditClip: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
  qwenLightning: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
  qwenAngles: "qwen-image-edit-2511-multiple-angles-lora.safetensors",
} as const;

/** H3 frame count: 24 fps, snapped UP to the model's 17k+5 grid (same formula as the official template). */
export function h3Frames(seconds: number): number {
  const l = Math.max(5, Math.round(seconds * 24));
  return l + ((((5 - (l % 17)) % 17) + 17) % 17);
}

/** H3 frame count snapped DOWN to the largest 17k+5 <= clip frames (prevents empty tail frames on guide-video swaps). */
export function h3FramesFloor(seconds: number): number {
  const raw = Math.max(5, Math.floor(seconds * 24));
  return Math.max(5, raw - ((((raw - 5) % 17) + 17) % 17));
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
