// Prompt packs: the system prompts behind each step of the Scenes pipeline. Drop your own .json / .txt / .md files
// (LM Studio presets, plain system prompts, JSON templates) — the server reads them, guesses which step each one is for,
// keeps them with your settings and hands them to the local LLM as its real system prompt.
import { create } from "zustand";
import type { StageParams } from "./graphs";
import { useSettings } from "./settings";
import { useDownloads } from "./downloads";

export type Stage = "look" | "krea" | "context" | "compiler" | "tweak" | "describe" | "tags" | "chat" | "plan" | "site" | "changes" | "remix" | "read" | "match" | "likeness" | "editplan" | "sort" | "setplan";
export const STAGE_ORDER: Stage[] = ["context", "compiler", "krea", "look", "describe", "tags", "tweak", "changes", "remix", "read", "match", "likeness", "editplan", "chat", "plan", "site", "sort", "setplan"];
export const STAGE_INFO: Record<Stage, { title: string; short: string; vars: string[]; does: string }> = {
  context: { title: "Scene context → blueprint", short: "Blueprint", vars: ["seconds", "mode", "description", "characters", "aspect"], does: "turns your short shot description into a structured blueprint (timing, actions, camera, dialogue)" },
  compiler: { title: "H3 prompt compiler", short: "H3 prompt", vars: ["blueprint", "MODE", "seconds", "references", "characters", "aspect", "description"], does: "turns the blueprint into the final MiniMax H3 prompt" },
  krea: { title: "Krea 2 frame builder", short: "Frame prompt", vars: ["character", "frame", "aspect"], does: "writes the Krea 2 prompt for a starting frame from the character's look block" },
  tweak: { title: "Prompt part rewriter", short: "Part rewrite", vars: ["prompt", "part", "change"], does: "rewrites a highlighted part of a prompt from your plain-words note (right-click → Change this part)" },
  look: { title: "Look block writer", short: "Look block", vars: ["notes"], does: "writes a character's fixed look block from notes or a picture" },
  describe: { title: "Character description (Krea 2)", short: "Description", vars: ["notes"], does: "writes the long, detailed Krea 2 description of a character from their profile and front picture (Characters → Write it in full)" },
  tags: { title: "Plain words → anime tags", short: "Tags", vars: ["text", "character"], does: "turns what you type in plain words into Danbooru tags for Illustrious / NoobAI / Anima" },
  plan: { title: "Plan a video writer", short: "Video plan", vars: ["request"], does: "plans a video second by second from your words, references and characters — used by Animate (plain words) and Plan a video" },
  site: { title: "Site profile writer", short: "Site profile", vars: ["character", "notes"], does: "writes a character's bio, greeting, backstory, traits, chat persona and tags for your site, from their description (⋯ → Your site → Write it for me)" },
  changes: { title: "Picture changes", short: "Changes", vars: ["take", "before", "text"], does: "with pictures in Create: pulls just the changes out of what you typed (or a whole copied prompt), so it doesn't fight your character or the reference" },
  remix: { title: "Remix merger", short: "Remix", vars: ["prompt", "change"], does: "Remix: works the words you add into the original prompt (replacing what they contradict) instead of tacking them on" },
  match: { title: "Face match check", short: "Face match", vars: ["who", "what"], does: "Characters → Build a training set: scores 0–10 how well a new picture keeps the character's face (reference on the left, new picture on the right)" },
  editplan: { title: "Edit chat instruction", short: "Edit chat", vars: ["pictures", "request", "model"], does: "Edit chat: turns your short message into one precise edit instruction — what changes, what stays, which picture is which" },
  likeness: { title: "Carry a likeness", short: "Likeness", vars: ["scene", "person", "outfit", "model"], does: "Edit → Carry picture 2's look into picture 1: rewrites picture 1's prompt with picture 2's person in it, keeping pose, composition and style" },
  read: { title: "Picture → prompt", short: "Read picture", vars: ["model", "focus", "people", "detail"], does: "Create → Read picture 2: writes the prompt for a picture's pose, place or outfit, without anyone's looks" },
  sort: { title: "Sort pictures into site sets", short: "Sort sets", vars: ["character", "existing", "pictures"], does: "Your site → Sort into sets: groups a character's pictures into themed sets from their prompts and rates each sfw / suggestive / explicit (free or behind the paywall)" },
  setplan: { title: "Plan photo sets", short: "Set plan", vars: ["character", "profile", "sets", "per", "mix", "backdrop", "poses", "existing"], does: "Batch → Plan it for me: picks themed photo sets and poses that fit who the character is, rated free or premium" },
  chat: { title: "Studio assistant", short: "Assistant", vars: ["state", "history", "message"], does: "the chat button: answers you and changes settings you describe" },
};

export interface Pack {
  id: string; name: string; file: string; stage: Stage | null; format: "builtin" | "lmstudio" | "json" | "json-template" | "text" | "edited";
  builtin?: boolean; params: StageParams; template: string | null; prompt_file: string; chars: number; preview: string; active: boolean; importedAt?: number;
  /** "auto" = the model's own default (Qwen3.8 thinks first, like LM Studio) */
  thinking: "auto" | "on" | "off";
  /** let this step see the starting frame (or the cast's pictures) */
  see_image: boolean;
}
interface PackState {
  packs: Pack[]; active: Record<Stage, string>; templates: Record<Stage, string>; loaded: boolean; error?: string;
  load: () => Promise<void>;
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) { let m = `${r.status}`; try { m = await r.text(); } catch { /* */ } throw new Error(m.slice(0, 300)); }
  return r.json() as Promise<T>;
}

export const usePacks = create<PackState>((set) => ({
  packs: [], active: { look: "builtin-look", krea: "builtin-krea", context: "builtin-context", compiler: "builtin-compiler", tweak: "builtin-tweak", describe: "builtin-describe", tags: "builtin-tags", chat: "builtin-chat", plan: "builtin-plan", site: "builtin-site", changes: "builtin-changes", remix: "builtin-remix", read: "builtin-read", match: "builtin-match", likeness: "builtin-likeness", editplan: "builtin-editplan", sort: "builtin-sort", setplan: "builtin-setplan" },
  templates: { look: "{notes}", krea: "", context: "", compiler: "{blueprint}", tweak: "FULL PROMPT:\n{prompt}\n\nPART:\n{part}\n\nCHANGE:\n{change}", describe: "{notes}", tags: "TEXT: {text}\nCHARACTER: {character}", chat: "STATE:\n{state}\n\nHISTORY:\n{history}\n\nMESSAGE: {message}", plan: "{request}", site: "CHARACTER: {character}\nNOTES: {notes}", changes: "TAKE: {take}\nBEFORE: {before}\nTEXT: {text}", remix: "ORIGINAL PROMPT:\n{prompt}\n\nCHANGES:\n{change}", read: "MODEL: {model}\nFOCUS: {focus}\nPEOPLE: {people}\nDETAIL: {detail}", likeness: "SCENE PROMPT:\n{scene}\n\nNEW PERSON:\n{person}\n\nOUTFIT: {outfit}\nMODEL: {model}", editplan: "PICTURES:\n{pictures}\n\nREQUEST: {request}\nMODEL: {model}", match: "LEFT: {who}\nRIGHT: {what}", sort: "CHARACTER: {character}\nSETS SO FAR: {existing}\n\nPICTURES:\n{pictures}", setplan: "CHARACTER: {character}\nPROFILE: {profile}\nSETS: {sets}\nPICTURES PER SET: {per}\nMIX: {mix}\nBACKDROP: {backdrop}\nPOSE IDEAS: {poses}\nALREADY MADE: {existing}" }, loaded: false,
  load: async () => {
    try {
      const d = await j<{ packs: Pack[]; active: Record<Stage, string>; templates: Record<Stage, string> }>(await fetch("/studio-api/packs", { cache: "no-store" }));
      set({ packs: d.packs, active: d.active, templates: d.templates, loaded: true, error: undefined });
    } catch (e) { set({ loaded: true, error: (e as Error).message }); }
  },
}));

/** the pack in use for a step */
export function activePack(stage: Stage): Pack | undefined {
  const s = usePacks.getState();
  return s.packs.find((p) => p.id === s.active[stage]) ?? s.packs.find((p) => p.id === `builtin-${stage}`);
}

export async function dropPacks(files: File[], stage?: Stage): Promise<Pack[]> {
  const fd = new FormData();
  if (stage) fd.append("stage", stage);
  for (const f of files) fd.append("file", f, f.name);
  const r = await j<{ added: Pack[] }>(await fetch("/studio-api/packs", { method: "POST", body: fd }));
  await usePacks.getState().load();
  return r.added;
}
export async function savePackCopy(p: { name: string; text: string; stage: Stage; template?: string | null; params?: Partial<StageParams>; thinking?: Pack["thinking"]; see_image?: boolean }): Promise<Pack> {
  const r = await j<{ added: Pack[] }>(await fetch("/studio-api/packs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }));
  await usePacks.getState().load();
  return r.added[0];
}
export async function updatePack(id: string, patch: { name?: string; stage?: Stage | null; text?: string; template?: string | null; params?: Partial<StageParams>; thinking?: Pack["thinking"]; see_image?: boolean }) {
  await j(await fetch(`/studio-api/packs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }));
  await usePacks.getState().load();
}
export async function deletePack(id: string) { await fetch(`/studio-api/packs/${id}`, { method: "DELETE" }); await usePacks.getState().load(); }
export async function activatePack(stage: Stage, id: string) {
  await j(await fetch("/studio-api/packs/active", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, id }) }));
  await usePacks.getState().load();
}
export async function packText(id: string): Promise<string> { return (await j<{ text: string }>(await fetch(`/studio-api/packs/${id}/text`))).text; }

/** fill a pack's input template; a line whose placeholders are all empty is left out */
export function fillTemplate(tpl: string, vars: Record<string, string | number | undefined>): string {
  return tpl.split("\n").flatMap((line) => {
    const names = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (names.length && names.every((n) => vars[n] === undefined || String(vars[n]).trim() === "")) return [];
    return [line.replace(/\{(\w+)\}/g, (_, n) => (vars[n] === undefined ? "" : String(vars[n])))];
  }).join("\n").trim();
}

/** the Plan-a-video writer: the active "Plan a video writer" prompt file (so an edit there reaches Animate and Plan a video
 *  alike), on the model picked in Plan a video. Instructions you typed in the old "Writer instructions" box still win until
 *  you save them as a prompt file. */
/** earlier built-in "Plan a video" instructions (short one-line cuts) — replaced by the detailed ones */
const OLD_DEFAULT_GUIDES = [`You plan short videos for the MiniMax H3 video model. You turn the user's idea into a precise timeline.

Rules:
- Refer to every person, place and thing that has a reference ONLY by its tag, exactly as written, e.g. <Picture 1>. Never invent tags.
- Everyone in the video is an adult. Never describe anyone as a child or as young-looking.
- Cuts must cover the whole video from 0:00 to the end with no gaps or overlaps.
- In each cut, say concretely what moves and how: actions in order, expressions, camera movement, lighting changes.
- If a reference video is given, say which part of the shot copies it (dance moves, motion, camera move).
- Spoken lines go on SAY lines with the exact words in plain text.
- Sound goes on SOUND lines: music, voices, effects, ambience, with when they start and stop.

Output ONLY lines in these formats, nothing else (no titles, no explanations):
CUT | start | end | shot and camera | what happens
SAY | time | who (a tag) | voice (an audio tag or "none") | the exact words
SOUND | start | end | what is heard
Times look like 0:00, 0:06 or 0:06.5.`];

export async function planWriter(guide: string, defaultGuide: string, big: boolean): Promise<{ guide: string; writer?: { file: string; params: StageParams; thinking?: Pack["thinking"]; big: boolean } }> {
  if (!usePacks.getState().loaded) await usePacks.getState().load();
  const pack = activePack("plan");
  // the old built-in instructions saved with your settings count as "not yours", so the new ones apply
  const custom = guide.trim() && guide.trim() !== defaultGuide.trim() && !OLD_DEFAULT_GUIDES.some((g) => g.trim() === guide.trim());
  if (!pack || (pack.builtin && custom)) return { guide: guide || defaultGuide, writer: { file: "none", params: pack?.params ?? { temperature: 0.7, top_p: 0.8, top_k: 20, repeat_penalty: 1.05, max_tokens: 4500 }, thinking: "off", big } };
  return { guide: "", writer: { file: pack.prompt_file, params: pack.params, thinking: pack.thinking, big } };
}

/** the 27B plans videos; Fable 9B only stands in while the 27B is still downloading */
export function useBigPlanner(): boolean {
  const g = useDownloads.getState().groups.find((x) => x.id === "writer_xl");
  let fast = false; try { fast = localStorage.getItem("h3.writer") === "fast"; } catch { /* private mode */ }
  const v = useDownloads.getState().gpu?.vram_mb;
  return !!g && g.state === "done" && !fast && (!v || v >= 28000);
}
