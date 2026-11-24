// Prompt packs: the system prompts behind each step of the Scenes pipeline. Drop your own .json / .txt / .md files
// (LM Studio presets, plain system prompts, JSON templates) — the server reads them, guesses which step each one is for,
// keeps them with your settings and hands them to the local LLM as its real system prompt.
import { create } from "zustand";
import type { StageParams } from "./graphs";
import { useSettings } from "./settings";
import { useDownloads } from "./downloads";

export type Stage = "look" | "krea" | "context" | "compiler" | "tweak" | "describe" | "tags" | "chat" | "plan" | "site" | "changes" | "remix" | "read" | "match" | "likeness" | "editplan" | "sort" | "setplan" | "name" | "deep" | "cosplay" | "taste" | "alias" | "live" | "lines" | "chatsim" | "chatjudge";
export const STAGE_ORDER: Stage[] = ["context", "compiler", "krea", "look", "describe", "tags", "tweak", "changes", "remix", "read", "match", "likeness", "editplan", "chat", "plan", "site", "sort", "setplan", "name", "deep", "cosplay", "taste", "alias", "live", "lines", "chatsim", "chatjudge"];
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
  name: { title: "Name characters", short: "Names", vars: ["taken", "characters"], does: "Your site → Name them: a first name for each ticked character that fits her look, heritage and pictures, all different" },
  deep: { title: "Deep profile", short: "Deep profile", vars: ["task", "character", "draft"], does: "Your site → Deep profile: after the profile, writes her life, how she reacts in 15 situations, sample texts, then a critic pass that rewrites generic or samey parts — one task at a time" },
  live: { title: "Live pack actions", short: "Live pack", vars: ["character", "framing", "count", "ratings", "keep", "examples"], does: "Your site / Batch: a character's stream tips and call actions, and her idle loops, written in her manner — learning from examples of what other creators offer" },
  chatsim: { title: "Chat test · her chat", short: "Chat test", vars: [], does: "Your site's chat test: the system prompt she chats with in the test. A stand-in for the site's own system-prompt-v4.1.md — drop that file in here as a prompt file and the test uses it as-is ({{name}}, {{manner}}, {{examples}}… are filled from her card)" },
  chatjudge: { title: "Chat test · reviewer", short: "Chat reviewer", vars: ["card", "reference", "transcript", "checks"], does: "Your site's chat test, on the cloud model you pick in Test setup: goes through every one of her replies against her background (weird, off-context, out of character, robotic, repeat, cold, too much), scores realism, voice, hooks, heat and consistency against Candy, and says what to change in her card" },
  lines: { title: "Chat lines (v4.1 + fix pack v4.2)", short: "Chat lines", vars: ["task", "character", "avoid"], does: "Your site: her style (hold profile, effort pushback, languages, opener keywords, kink stance, dangle and caption lines), 18 sample chats (the fix pack's required ones), the paid and free voice examples, and her hot lines (tease / cold / explicit / after) — checked so no two characters share a 4-word phrase" },
  alias: { title: "Site name (cosplay)", short: "Site name", vars: ["names", "taken"], does: "Your site: a cosplay character's site name fans connect to the character without it being her name — a near-twin (Makima → Makina), the meaning translated (Sakura → Blossom) or a shortening (Makima → Maki)" },
  cosplay: { title: "Cosplay planner", short: "Cosplay", vars: ["character", "series", "cosplayer", "triggers", "notes", "posts", "shots", "library", "locked", "taste"], does: "Batch → Cosplay: checks the character is an adult, describes the costume, wig and props piece by piece, and writes a realistic cosplay-photo prompt for Krea 2" },
  taste: { title: "Learn what you keep", short: "Taste", vars: ["liked", "disliked"], does: "Reads the prompts of pictures you starred, made into characters, animated, upscaled or downloaded — and the ones you deleted — and writes short notes on what you value; new prompts follow them" },
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
  packs: [], active: { look: "builtin-look", krea: "builtin-krea", context: "builtin-context", compiler: "builtin-compiler", tweak: "builtin-tweak", describe: "builtin-describe", tags: "builtin-tags", chat: "builtin-chat", plan: "builtin-plan", site: "builtin-site", changes: "builtin-changes", remix: "builtin-remix", read: "builtin-read", match: "builtin-match", likeness: "builtin-likeness", editplan: "builtin-editplan", sort: "builtin-sort", setplan: "builtin-setplan", name: "builtin-name", deep: "builtin-deep", cosplay: "builtin-cosplay", taste: "builtin-taste", alias: "builtin-alias", live: "builtin-live", lines: "builtin-lines", chatsim: "builtin-chatsim", chatjudge: "builtin-chatjudge" },
  templates: { look: "{notes}", krea: "", context: "", compiler: "{blueprint}", tweak: "FULL PROMPT:\n{prompt}\n\nPART:\n{part}\n\nCHANGE:\n{change}", describe: "{notes}", tags: "TEXT: {text}\nCHARACTER: {character}", chat: "STATE:\n{state}\n\nHISTORY:\n{history}\n\nMESSAGE: {message}", plan: "{request}", site: "CHARACTER: {character}\nNOTES: {notes}", changes: "TAKE: {take}\nBEFORE: {before}\nTEXT: {text}", remix: "ORIGINAL PROMPT:\n{prompt}\n\nCHANGES:\n{change}", read: "MODEL: {model}\nFOCUS: {focus}\nPEOPLE: {people}\nDETAIL: {detail}", likeness: "SCENE PROMPT:\n{scene}\n\nNEW PERSON:\n{person}\n\nOUTFIT: {outfit}\nMODEL: {model}", editplan: "PICTURES:\n{pictures}\n\nREQUEST: {request}\nMODEL: {model}", match: "LEFT: {who}\nRIGHT: {what}", sort: "CHARACTER: {character}\nSETS SO FAR: {existing}\n\nPICTURES:\n{pictures}", setplan: "CHARACTER: {character}\nPROFILE: {profile}\nSETS: {sets}\nPICTURES PER SET: {per}\nMIX: {mix}\nBACKDROP: {backdrop}\nPOSE IDEAS: {poses}\nALREADY MADE: {existing}", name: "TAKEN: {taken}\n\nCHARACTERS:\n{characters}", deep: "TASK:\n{task}\n\nWHO SHE IS:\n{character}\n\nWRITTEN SO FAR:\n{draft}", cosplay: "CHARACTER: {character}\nSERIES: {series}\nCOSPLAYER: {cosplayer}\nLORA TRIGGER WORDS: {triggers}\n\nREFERENCE NOTES:\n{notes}\n\nHOW THIS CHARACTER'S LORA IS PROMPTED (its creator's and users' Krea 2 posts — costume and trigger wording only):\n{posts}\n\nSHOTS (write one prompt per shot, in this order — each its own pose, camera angle and setting):\n{shots}\n\nLORAS YOU MAY ADD (their library — pick by the character's body, build and look; empty or \"(not used)\" = pick none):\n{library}\nLOCKED LORAS (always on, don't list them):\n{locked}\n\nTHEIR TASTE (wording style only):\n{taste}", taste: "LIKED:\n{liked}\n\nDISLIKED:\n{disliked}", alias: "NAMES:\n{names}\n\nTAKEN (don't use):\n{taken}", lines: "TASK: {task}\n\nWHO SHE IS:\n{character}\n\nAVOID (share no run of four words with these):\n{avoid}", chatsim: "(filled by the Studio)", chatjudge: "HER CARD:\n{card}\n\nREFERENCE:\n{reference}\n\nCHATS:\n{transcript}\n\nCHECKS:\n{checks}", live: "WHO SHE IS:\n{character}\n\nFRAMING: {framing}\nHOW MANY ACTIONS: {count}\nALLOWED RATINGS: {ratings}\nKEEP THESE KEYS (already made — plan them again with the same key):\n{keep}\n\nEXAMPLES (what other creators offer):\n{examples}" }, loaded: false,
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
