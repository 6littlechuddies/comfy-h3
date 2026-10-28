// Validates every Studio graph against a real ComfyUI (models can be empty dummy files):
//   COMFY=http://127.0.0.1:18288 npx tsx scripts/test-graphs.ts
// ComfyUI validates node types, inputs, links and combo values before queueing; we then cancel the queue.
import { buildExtend, buildQwenEdit, buildCreate, buildEdit, buildFind, buildFindMask, buildUpscale, buildAnimate, buildPromptHelper, buildExtractCharacter, buildCutout, buildDescribeCharacter, buildDescribeVideo, buildStage, DEFAULT_GUIDE, type ApiGraph } from "../src/lib/graphs";

const COMFY = process.env.COMFY || "http://127.0.0.1:18288";
const s = { sampler: "euler_ancestral", scheduler: "normal", steps: 28, cfg: 5.5, seed: 123456789012345 };
const lora = [{ name: "test_lora.safetensors", strength: 0.8 }];

const cases: [string, ApiGraph][] = [
  ["create anime", buildCreate({ ...s, style: "anime", positive: "1girl, adult", negative: "lowres", loras: lora, width: 832, height: 1216, count: 2, cutout: false, prefix: "studio/create/x" })],
  ["create anima 2K finish", buildCreate({ ...s, sampler: "er_sde", scheduler: "simple", steps: 30, cfg: 4, style: "anime", animeModel: "anima", positive: "1girl, adult", negative: "", loras: [], width: 832, height: 1248, count: 1, cutout: false, prefix: "studio/create/an", hires: { scale: 1.5, denoise: 0.42 } })],
  ["create krea 2K finish", buildCreate({ ...s, style: "realistic", realModel: "krea2", positive: "a photo of an adult woman", negative: "", loras: [], width: 1024, height: 1536, count: 1, cutout: false, prefix: "studio/create/r", hires: { scale: 1.5, denoise: 0.35 } })],
  ["create noob 2K finish", buildCreate({ ...s, style: "anime", animeModel: "noob", positive: "1girl, adult", negative: "", loras: [], width: 832, height: 1248, count: 1, cutout: false, prefix: "studio/create/n", hires: { scale: 1.5, denoise: 0.42 } })],
  ["create anime cutout", buildCreate({ ...s, style: "anime", positive: "1girl", negative: "", loras: [], width: 832, height: 1216, count: 1, cutout: true, prefix: "studio/create/x" })],
  ["create anima", buildCreate({ ...s, sampler: "er_sde", scheduler: "simple", steps: 30, cfg: 4, style: "anime", animeModel: "anima", positive: "masterpiece, best quality, score_7, 1girl, adult", negative: "worst quality", loras: lora, width: 832, height: 1216, count: 2, cutout: false, prefix: "studio/create/an" })],
  ["create noob + picture (IP-Adapter sheet angle)", buildCreate({ ...s, style: "anime", animeModel: "noob", positive: "1girl, adult, from side", negative: "lowres", loras: lora, width: 832, height: 1216, count: 1, cutout: false, prefix: "studio/characters/x_left", ref: { image: "test.png", weight: 0.6, endAt: 0.75 } })],
  ["create noob", buildCreate({ ...s, style: "anime", animeModel: "noob", positive: "1girl, adult", negative: "lowres", loras: [], width: 832, height: 1216, count: 1, cutout: false, prefix: "studio/create/n" })],
  ["create krea 2 raw + turbo lora", buildCreate({ ...s, sampler: "euler", scheduler: "simple", steps: 12, cfg: 1.5, style: "realistic", realModel: "krea2raw", kreaTurboLora: 0.6, positive: "a woman", negative: "blurry", loras: lora, width: 928, height: 1664, count: 1, cutout: false, prefix: "studio/create/kr" })],
  ["create krea 2 raw full", buildCreate({ ...s, sampler: "euler", scheduler: "simple", steps: 28, cfg: 4.5, style: "realistic", realModel: "krea2raw", positive: "a woman", negative: "blurry", loras: [], width: 1024, height: 1024, count: 1, cutout: false, prefix: "studio/create/kr" })],
  ["create krea 2", buildCreate({ ...s, sampler: "euler", scheduler: "simple", steps: 8, cfg: 1, style: "realistic", realModel: "krea2", positive: "a woman", negative: "", loras: lora, width: 928, height: 1664, count: 2, cutout: false, prefix: "studio/create/k" })],
  ["create krea 2 cfg>1 cutout", buildCreate({ ...s, sampler: "euler", scheduler: "simple", steps: 8, cfg: 2, style: "realistic", realModel: "krea2", positive: "a woman", negative: "blurry", loras: [], width: 1024, height: 1024, count: 1, cutout: true, prefix: "studio/create/k" })],
  ["create krea own checkpoint", buildCreate({ ...s, sampler: "euler", scheduler: "beta", steps: 6, cfg: 1, style: "realistic", realModel: "krea2", unet: "civitai/muse_v35_int8.safetensors", positive: "photo", negative: "", loras: [], width: 1440, height: 2560, count: 4, cutout: false, prefix: "studio/characters/x_frame" })],
  ["extend to 16:9", buildExtend({ image: "test.png", w: 1088, h: 1920, left: 1164, right: 1164, top: 0, bottom: 0, sceneW: 1936, sceneH: 1088, prompt: "extend the room", seed: 1, steps: 10, cfg: 1, sampler: "euler", scheduler: "simple", prefix: "studio/edit/extend" })],
  ["edit krea single", buildEdit({ ...s, sampler: "euler", scheduler: "simple", steps: 10, cfg: 1, images: ["test.png"], instruction: "change her jacket to red", negative: "", enhance: false, resolution: 1024, prefix: "studio/edit/e" })],
  ["edit krea two pictures", buildEdit({ ...s, sampler: "euler", scheduler: "simple", steps: 10, cfg: 1, images: ["test.png", "test2.png"], instruction: "put this person at the table", negative: "", enhance: false, resolution: 1024, prefix: "studio/edit/e", refBoost: 4 })],
  ["edit krea brush + cfg", buildEdit({ ...s, sampler: "euler", scheduler: "simple", steps: 20, cfg: 3, images: ["test.png"], instruction: "remove the lamp", negative: "blurry", enhance: false, resolution: 1024, prefix: "studio/edit/e", mask: "test2.png", maskSoftness: 40 })],
  ["edit krea blend", buildEdit({ ...s, sampler: "euler", scheduler: "simple", steps: 10, cfg: 1, images: ["test.png"], instruction: "blend", negative: "", enhance: false, resolution: 1024, prefix: "studio/compose/c", denoise: 0.35 })],
  ["edit anima redraw", buildEdit({ ...s, engine: "anima", sampler: "er_sde", scheduler: "simple", steps: 30, cfg: 4, images: ["test.png"], instruction: "1girl, red jacket", negative: "", enhance: false, resolution: 1024, prefix: "studio/edit/e", denoise: 0.5 })],
  ["edit noob brush", buildEdit({ ...s, engine: "noob", sampler: "euler_ancestral", scheduler: "normal", steps: 28, cfg: 5, images: ["test.png"], instruction: "1girl, red jacket", negative: "", enhance: false, resolution: 1024, prefix: "studio/edit/e", mask: "test2.png", denoise: 0.8 })],
  ["edit krea blank canvas sheet", buildEdit({ ...s, sampler: "euler", scheduler: "simple", steps: 10, cfg: 1, images: ["test.png"], blank: { width: 1920, height: 1088 }, instruction: "turnaround sheet", negative: "", enhance: false, resolution: 1440, prefix: "studio/characters/x_sheet", refBoost: 4 })],
  ["edit krea face region (one picture)", buildEdit({ ...s, sampler: "euler", scheduler: "simple", steps: 10, cfg: 1, images: ["test.png"], region: { x: 10, y: 10, width: 256, height: 256 }, instruction: "sharper face", negative: "", enhance: false, resolution: 1024, prefix: "studio/edit/face", denoise: 0.45 })],
  ["edit krea face region + identity picture", buildEdit({ ...s, sampler: "euler", scheduler: "simple", steps: 10, cfg: 1, images: ["test.png", "test2.png"], region: { x: 10, y: 10, width: 256, height: 256 }, instruction: "sharper face", negative: "", enhance: false, resolution: 1024, prefix: "studio/edit/face", denoise: 0.45, refBoost: 4 })],
  ["find face (SAM 3)", buildFind("test.png", "face")],
  ["chat: new background (kept area flipped)", buildEdit({ ...s, sampler: "euler", scheduler: "simple", steps: 8, cfg: 1, images: ["test.png"], instruction: "a bedroom", negative: "", enhance: false, resolution: 1024, prefix: "studio/edit/chat", mask: "test2.png", maskInvert: true, maskSoftness: 14, refBoost: 1 })],
  ["chat: Krea repaint of the Qwen draft with the character", buildEdit({ ...s, sampler: "euler", scheduler: "simple", steps: 8, cfg: 1, images: ["test.png", "test2.png"], instruction: "keep it, her face from picture 2", negative: "", enhance: false, resolution: 1024, prefix: "studio/edit/chat", denoise: 0.42, refBoost: 4, loras: lora })],
  ["qwen edit 2511 one picture", buildQwenEdit({ images: ["test.png"], prompt: "make it night", seed: 7, prefix: "studio/edit/chat" })],
  ["qwen edit 2511 three pictures, full", buildQwenEdit({ images: ["test.png", "test2.png", "test.png"], prompt: "Replace the woman in Picture 1 with the woman from Picture 2, wearing the sweater from Picture 3", seed: 7, full: true, prefix: "studio/edit/chat" })],
  ["qwen edit 2511 fast (Lightning)", buildQwenEdit({ images: ["test.png", "test2.png"], prompt: "put her in picture 1", seed: 7, fast: true, prefix: "studio/edit/chat" })],
  ["finish upscale krea", buildUpscale({ image: "test.png", engine: "krea", scale: 2, denoise: 0.3, prompt: "sharp photo", steps: 8, cfg: 1, sampler: "euler", scheduler: "simple", seed: 1, prefix: "studio/edit/finish" })],
  ["finish upscale anima + lora", buildUpscale({ image: "test.png", engine: "anima", scale: 1.5, denoise: 0.35, prompt: "1girl", negative: "lowres", steps: 30, cfg: 4, sampler: "er_sde", scheduler: "simple", seed: 1, loras: lora, prefix: "studio/edit/finish" })],
  ["finish upscale noob", buildUpscale({ image: "test.png", engine: "noob", scale: 2, denoise: 0.35, prompt: "1girl", steps: 28, cfg: 5, sampler: "euler_ancestral", scheduler: "normal", seed: 1, prefix: "studio/edit/finish" })],
  ["select by words (SAM 3 mask)", buildFindMask("test.png", "her right hand", 16)],
  ["edit krea painted small area (crop + mask)", buildEdit({ ...s, sampler: "euler", scheduler: "simple", steps: 10, cfg: 1, images: ["test.png"], mask: "test2.png", maskSoftness: 40, region: { x: 20, y: 20, width: 384, height: 384 }, instruction: "peace sign", negative: "", enhance: false, resolution: 1024, prefix: "studio/edit/e" })],
  ["extract character", buildExtractCharacter("Maki, 26, red hair", 5)],
  ["describe character from picture", buildDescribeCharacter("test.png", 5)],
  ["create with LoRA off + triggers", buildCreate({ ...s, sampler: "euler", scheduler: "normal", steps: 20, cfg: 5, style: "anime", positive: "1girl", negative: "", loras: [], width: 832, height: 1216, count: 1, cutout: false, prefix: "studio/create/t" })],
  ["cutout", buildCutout("test.png", "studio/characters/x_cutout")],
];
const a = { sampler: "er_sde", scheduler: "beta", steps: 10, seed: 42, prompt: "<Picture 1> dances", seconds: 10, width: 1344, height: 768, loras: lora, refImageSize: "match" as const, prefix: "studio/animate/a" };
cases.push(
  ["animate ref full", buildAnimate({ ...a, mode: "ref", images: ["test.png", "test2.png"], videos: [{ file: "test.mp4", start: 1, end: 5, useSound: true }, { file: "test.mp4", start: 0, end: 3, useSound: false }], audios: ["test.wav"], turbo: false, lowMemDecode: false })],
  ["animate ref turbo tiled", buildAnimate({ ...a, mode: "ref", images: ["test.png"], videos: [], audios: [], turbo: true, lowMemDecode: true })],
  ["animate i2v", buildAnimate({ ...a, mode: "i2v", images: ["test.png"], videos: [], audios: [], turbo: false, lowMemDecode: false })],
  ["animate loop turbo", buildAnimate({ ...a, mode: "loop", images: ["test.png"], videos: [], audios: [], turbo: true, lowMemDecode: false })],
  ["animate first-last", buildAnimate({ ...a, mode: "fl", images: ["test.png", "test2.png"], videos: [], audios: [], turbo: false, lowMemDecode: false })],
  ["prompt full", buildPromptHelper({ pictures: [{ file: "test.png", tag: "<Picture 1>", label: "Rin" }, { file: "test2.png", tag: "<Picture 2>", label: "street" }], videos: [{ file: "test.mp4", tag: "<Video 1>", label: "dance", start: 1, end: 5, useSound: true }], audios: [{ tag: "<Audio 1>", label: "my voice" }], idea: "she dances", seconds: 10, cuts: 2, camera: "auto", mode: "references", guide: DEFAULT_GUIDE, seed: 7 })],
  ["prompt character + clip, no idea", buildPromptHelper({ pictures: [{ file: "test.png", tag: "<Picture 1>", label: "Rin — full body" }, { file: "test2.png", tag: "<Picture 2>", label: "Rin — face" }], videos: [{ file: "test.mp4", tag: "<Video 1>", label: "", start: 0, end: 3, useSound: false }, { file: "test.mp4", tag: "<Video 2>", label: "", start: 1, end: 4, useSound: false }], audios: [], idea: "", seconds: 8, cuts: 0, camera: "auto", mode: "references", guide: DEFAULT_GUIDE, seed: 9, characters: [{ name: "Rin", look: "adult woman, red hair", tags: ["<Picture 1>", "<Picture 2>"] }] })],
  ["prompt clip only", buildPromptHelper({ pictures: [], videos: [{ file: "test.mp4", tag: "<Video 1>", label: "", start: 0, end: 3, useSound: true }], audios: [], idea: "", seconds: 6, cuts: 0, camera: "auto", mode: "references", guide: DEFAULT_GUIDE, seed: 9 })],
  ["read the clip", buildDescribeVideo({ file: "test.mp4", start: 0.5, end: 3 }, 11, "motion")],
  ["scene stage (small, no image)", buildStage({ promptFile: "studio_builtin_context.txt", input: "12 second i2v. She waves.", params: { temperature: 0.6, top_p: 0.9, top_k: 40, repeat_penalty: 1.05, max_tokens: 2048 }, big: false, seed: 3 })],
  ["scene stage (big, frame)", buildStage({ promptFile: "studio_builtin_context.txt", input: "8 second i2v. She waves.", params: { temperature: 0.6, top_p: 0.9, top_k: 40, repeat_penalty: 1.05, max_tokens: 2048 }, images: ["test.png"], big: true, seed: 3 })],
  ["scene stage (thinking, long prompt)", buildStage({ promptFile: "studio_builtin_compiler.txt", promptChars: 46700, input: "We are doing I2V.", params: { temperature: 0.6, top_p: 0.9, top_k: 40, repeat_penalty: 1.05, max_tokens: 8192 }, images: ["test.png"], big: true, seed: 3, thinking: "auto" })],
  ["scene stage (2 refs)", buildStage({ promptFile: "studio_builtin_compiler.txt", input: "x", params: { temperature: 0.3, top_p: 0.9, top_k: 40, repeat_penalty: 1.05, max_tokens: 2048 }, images: ["test.png", "test2.png"], big: false, seed: 3 })],
  ["scene video fl2va res_multistep", buildAnimate({ ...a, sampler: "res_multistep", scheduler: "simple", steps: 40, mode: "i2v", images: ["test.png"], videos: [], audios: [], turbo: false, lowMemDecode: false })],
  ["prompt text only", buildPromptHelper({ pictures: [], videos: [], audios: [], idea: "a cat", seconds: 5, cuts: 0, camera: "auto", mode: "text", guide: DEFAULT_GUIDE, seed: 7 })],
  ["prompt one pic", buildPromptHelper({ pictures: [{ file: "test.png", tag: "<Picture 1>", label: "Rin" }], videos: [], audios: [], idea: "x", seconds: 5, cuts: 1, camera: "still", mode: "references", guide: DEFAULT_GUIDE, seed: 7 })],
);

let bad = 0;
for (const [name, graph] of cases) {
  const r = await fetch(`${COMFY}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: "test" }) });
  const body = await r.json();
  if (r.ok && body.prompt_id) console.log(`ok   ${name}`);
  else { bad++; console.log(`FAIL ${name}\n${JSON.stringify(body, null, 1).slice(0, 3000)}`); }
}
await fetch(`${COMFY}/queue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
await fetch(`${COMFY}/interrupt`, { method: "POST" });
process.exit(bad ? 1 : 0);
