// Edit chat: change a picture by talking to it, one message at a time, like the cloud editors — but on your rental, with
// Krea 2's look and your character's face. Each message works on the picture you're on (the last result, or any earlier
// one you click), and the pictures you name with @ (your character, a Pinterest photo, a sweater) go in as references.
// Every message takes one of four routes:
//   part        — it names a part (her right hand, the sweater): SAM 3 outlines it and only that part is redrawn by Krea 2
//   background  — a new background: SAM 3 keeps the person, Krea 2 redraws everything else, then a light pass blends the light
//   hybrid      — big changes (put @Faery in, a new pose, 3+ pictures): Qwen-Image 2.1 makes the change, Krea 2 repaints it
//                 lightly with the character's picture and LoRAs (so the look and face are Krea's), then the face pass
//   krea        — everything else: one Krea 2 Edit with the picture + one reference
// Your words go in as typed; only @names are turned into the "picture 2" / <image2> wording each model understands.
import { useDownloads as useDl } from "./downloads";
import { create } from "zustand";
import { loadState, saveState, viewUrl, type FileRef } from "./api";
import { type View, useCharacters, type Character } from "./characters";
import { charLoras } from "./make";
import { useJobs, waitForJob, type Job } from "./jobs";
import { mediaOf } from "./recipes";
import { useTray, type Media } from "./tray";

import { BIG, order, routeOf, wordsFor, type ChatPic, type Engine, type Route } from "./chatwords";
export { routeOf, wordsFor, type ChatPic, type Engine, type Route };
export interface Take { file: FileRef; url: string; score?: number | null; why?: string; draft?: string }
export interface Head { turn: string; take: number }
export interface Turn {
  id: string; text: string; route: Route; note: string; status: "running" | "done" | "failed"; step?: string; error?: string;
  /** what it worked on: a picture's key, or the take it continued from */
  from: { pic?: string; head?: Head }; refs: string[]; takes: Take[]; at: number;
  /** what the model was actually told (after the writer refined your words) */
  told?: string;
}
export interface Chat { id: string; title: string; pics: ChatPic[]; turns: Turn[]; head: Head | null; start: string | null; updated: number;
  /** the character project the chat belongs to (null = Free work): each project sees only its own chats */
  project?: string | null;
  /** made by a Batch swap run: kept out of the chat list (its results are in Batch and the catalog) */
  batch?: boolean }
/** the project picked on the left (each project keeps its own chats) */
export const projectNow = () => useCharacters.getState().sel ?? null;
/** chats of the project you're in (old chats from before projects were kept apart show everywhere) */
export const inProject = (c: Chat, p = projectNow()) => c.project === undefined || (c.project ?? null) === p;

const uid = () => Math.random().toString(36).slice(2, 9);
const slug = (t: string) => t.toLowerCase().replace(/\.[a-z0-9]{2,4}$/, "").replace(/[^a-z0-9]+/g, "").slice(0, 16) || "pic";

interface ChatState {
  chats: Chat[]; cur: string | null; engine: Engine; takes: 1 | 2; check: boolean; loaded: boolean;
  /** the writer turns each message into one precise instruction first (it sees the pictures); off = your words as typed */
  refine: boolean;
  /** Qwen: best = Qwen's own 40 steps; fast = the 4-step Lightning LoRA */
  /** auto = fast (Lightning) on cards under 24 GB, where 40 steps of Qwen take ~10 minutes; best everywhere else */
  quality: "auto" | "best" | "fast";
  load: () => Promise<void>;
  set: (p: Partial<Pick<ChatState, "engine" | "takes" | "check" | "cur" | "refine" | "quality">>) => void;
  current: () => Chat | null;
  newChat: (o?: { select?: boolean; batch?: boolean; title?: string }) => Chat;
  patch: (id: string, f: (c: Chat) => Chat) => void;
  remove: (id: string) => void;
}
let saveT: ReturnType<typeof setTimeout> | undefined;
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => { const { chats, cur, engine, takes, check, refine, quality } = useEditChat.getState(); saveState("edit_chats", { chats: [...chats.filter((c) => !c.batch).slice(-30), ...chats.filter((c) => c.batch).slice(-60)], cur, engine, takes, check, refine, qwenQuality: quality }).catch(() => {}); }, 600); };
export const useEditChat = create<ChatState>((set, get) => ({
  chats: [], cur: null, engine: "auto", takes: 2, check: true, refine: true, quality: "auto", loaded: false,
  load: async () => {
    if (get().loaded) return;
    const d = await loadState<{ chats: Chat[]; cur: string | null; engine: Engine; takes: 1 | 2; check: boolean; refine?: boolean; qwenQuality?: "auto" | "best" | "fast" }>("edit_chats");
    // a message that was running when the page closed: its jobs may still finish, but this page can't follow them any more
    const chats = (d?.chats ?? []).map((c) => ({ ...c, turns: c.turns.map((t) => (t.status === "running" ? { ...t, status: "failed" as const, error: "The page was closed while this was running — its pictures are in Edit's results" } : t)) }));
    set({ loaded: true, chats, cur: d?.cur ?? null, engine: d?.engine ?? "auto", takes: d?.takes ?? 2, check: d?.check ?? true, refine: d?.refine ?? true, quality: d?.qwenQuality ?? "auto" });
  },
  set: (p) => { set(p); persist(); },
  current: () => get().chats.find((c) => c.id === get().cur && inProject(c) && !c.batch) ?? null,
  newChat: (o = {}) => { const c: Chat = { id: uid(), title: o.title ?? "New chat", pics: [], turns: [], head: null, start: null, updated: Date.now(), project: projectNow(), ...(o.batch ? { batch: true } : {}) }; set((s) => ({ chats: [...s.chats, c], ...(o.select === false ? {} : { cur: c.id }) })); persist(); return c; },
  patch: (id, f) => { set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...f(c), updated: Date.now() } : c)) })); persist(); },
  remove: (id) => { set((s) => ({ chats: s.chats.filter((c) => c.id !== id), cur: s.cur === id ? null : s.cur })); persist(); },
}));
const chatNow = (id: string) => useEditChat.getState().chats.find((c) => c.id === id)!;
const patchTurn = (chat: string, turn: string, p: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
  useEditChat.getState().patch(chat, (c) => ({ ...c, turns: c.turns.map((t) => (t.id === turn ? { ...t, ...(typeof p === "function" ? p(t) : p) } : t)) }));

/** a picture into the chat under a short name you can type after @ (the same picture twice keeps its first name) */
export function addPic(chatId: string, m: Media, opts: { label?: string; charId?: string; start?: boolean } = {}): ChatPic {
  const c = chatNow(chatId);
  const have = c.pics.find((p) => p.name === m.name && p.charId === opts.charId);
  if (have) { if (opts.start) useEditChat.getState().patch(chatId, (x) => ({ ...x, start: have.key })); return have; }
  const label = opts.label ?? m.label ?? m.name;
  let key = slug(opts.charId ? label.split(/\s+/)[0] : label.replace(/\b(picture|photo|image)\b/gi, ""));
  for (let i = 2; c.pics.some((p) => p.key === key); i++) key = `${key.replace(/\d+$/, "")}${i}`;
  const pic: ChatPic = { key, name: m.name, url: m.url, label, ...(opts.charId ? { charId: opts.charId } : {}) };
  useEditChat.getState().patch(chatId, (x) => ({ ...x, pics: [...x.pics, pic], start: opts.start || (!x.start && !opts.charId) ? key : x.start,
    title: x.title === "New chat" && !opts.charId ? label.slice(0, 40) : x.title }));
  return pic;
}
/** a character's picture (their best face picture for the face, the front for the whole person) */
export async function addCharacter(chatId: string, c: Character): Promise<ChatPic> {
  const m = await useCharacters.getState().asMedia(c.id, "front");
  if (!m) throw new Error(`${c.name} needs a front picture first`);
  return addPic(chatId, await plainOf(c, m), { label: c.name, charId: c.id });
}

/** the character-sheet view a message asks for, if it names an angle */
export function angleView(words: string): View | null {
  if (/\b(three.?quarters?|3\/4)\b/i.test(words)) return "threeq";
  if (/\b(from behind|from the back|back view|rear view|her back to|his back to|facing away|over (?:her|his|their|the) shoulder|back of (?:her|his|their|the) (?:hair|head))\b/i.test(words)) return "back";
  if (/\b(side view|in profile|profile view|side profile|from the side|side.?on)\b/i.test(words)) return "left";
  return null;
}

/** the pose in a picture, in words (body, arms, hands, legs, head, gaze, framing, camera) — no looks, place or outfit; cached */
const poseCache = new Map<string, Promise<string>>();
export function poseOf(m: Media): Promise<string> {
  if (!poseCache.has(m.name)) poseCache.set(m.name, (async () => {
    const { runWriter } = await import("./writer");
    return (await runWriter("read", { model: "krea2", focus: "pose", people: "one person", detail: "short" }, { tab: "batch", label: "Reading the pose", images: [m.name], big: false })).trim();
  })().catch((e) => { poseCache.delete(m.name); throw e; }));
  return poseCache.get(m.name)!;
}

/** which of a character's sheet pictures fits a picture they're going into: its own prompt (CivitAI's, or the one inside the
 *  file) says the angle ("from behind", "side profile", "close-up"); without one, the local writer looks at the pose. The
 *  edit model copies the angle of the picture it's given, so a front picture swapped into a back shot came out blotchy,
 *  with extra limbs. */
export async function viewFor(c: Character, m: Media, words = ""): Promise<View> {
  const { promptOfPicture } = await import("./likeness");
  const p = await promptOfPicture(m).catch(() => null);
  const t = `${words} ${p?.prompt ?? ""}`;
  let v: View | null = angleView(t) ?? (/\b(close.?up|portrait|headshot|selfie)\b/i.test(t) ? "face" : null);
  if (!v && !p?.prompt && m.kind === "image") {
    try {
      const { runWriter } = await import("./writer");
      const r = await runWriter("read", { model: "krea2", focus: "pose", people: "one person", detail: "short" }, { tab: "batch", label: "Reading the picture's camera angle", images: [m.name], big: false });
      v = angleView(r) ?? (/\b(close.?up|portrait|head and shoulders)\b/i.test(r) ? "face" : null);
    } catch { /* front it is */ }
  }
  return v && c.views[v] ? v : "front";
}

/** their front picture with the background taken out (plain grey), made once per page: a swap that's shown them standing in a
 *  street put that street next to the bathroom it was told to put them in. Falls back to the picture as it is. */
const plainCache = new Map<string, Promise<Media | null>>();
export async function plainOf(c: Character, m: Media): Promise<Media> {
  const key = `${c.id}:${m.name}`;
  if (!plainCache.has(key)) plainCache.set(key, (async () => {
    try {
      const { buildPlainBackground } = await import("./graphs");
      const j = await useJobs.getState().run("edit", `${c.name} without their background`, buildPlainBackground(m.name, "studio/_work/plain"), "cutout", { quiet: true, noTray: true, quietFail: true });
      return await mediaOf(await outOf(j), `${c.name}`);
    } catch { plainCache.delete(key); return null; }
  })());
  return (await plainCache.get(key)) ?? m;
}

const charOf = (p?: ChatPic | null) => (p?.charId ? useCharacters.getState().list.find((c) => c.id === p.charId) ?? null : null);
const adult = " Everyone is an adult.";

async function outOf(j: Job): Promise<FileRef> {
  const done = await waitForJob(j.id);
  const o = done.outputs.find((x) => x.kind === "image" && x.type === "output");
  if (!o) throw new Error(`${j.label} made no picture`);
  return { filename: o.filename, subfolder: o.subfolder, type: o.type };
}
function regionAround(box: { x: number; y: number; width: number; height: number; W: number; H: number }) {
  if ((box.width * box.height) / (box.W * box.H) > 0.35) return {};
  const side = Math.round(Math.min(Math.min(box.W, box.H), Math.max(384, Math.max(box.width, box.height) * 1.8)));
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  return { region: { x: Math.round(Math.min(Math.max(0, cx - side / 2), box.W - side)), y: Math.round(Math.min(Math.max(0, cy - side / 2), box.H - side)), width: side, height: side } };
}

/** one take of one message → the picture it made (and the Qwen draft, for the hybrid) */
async function oneTake(chatId: string, turnId: string, route: Route, part: string | undefined, text: string, canvas: ChatPic, refs: ChatPic[], who: Character | null, last: boolean, told?: string, qwen: { fast?: boolean; full?: boolean } = {}): Promise<Take> {
  const [{ buildEdit, buildQwenEdit }, { editArgs, newSeed, useSettings }, { selectByWords, sharpenFace }] = await Promise.all([import("./graphs"), import("./settings"), import("./faceDetail")]);
  const run = useJobs.getState().run;
  const step = (s: string) => patchTurn(chatId, turnId, { step: s });
  const quiet = { quiet: true, noTray: true, quietFail: true, chat: chatId };
  const shown = { quietFail: true, chat: chatId, stack: `chat:${turnId}` };
  const base = editArgs(useSettings.getState().s.edit, "krea");
  const pics = chatNow(chatId).pics;
  const anime = who?.style === "anime";
  const keepStyle = anime ? " Keep the drawing style: anime art, not a photo." : "";
  const loras = [...(base.loras ?? []), ...(who && !anime ? charLoras(who, "krea2") : [])];
  const faceAfter = !!who && (route === "hybrid" || route === "background");
  const finalMeta = (isLast: boolean) => (isLast ? shown : quiet);

  if (route === "part" || route === "background") {
    step(route === "part" ? `Finding ${part} (SAM 3)` : "Finding the person (SAM 3)");
    const sel = await selectByWords(canvas.name, route === "part" ? part! : "person", route === "part" ? 16 : 6, true);
    if (!sel) {
      if (route === "part") { step(`Couldn't find ${part} — editing the whole picture`); return oneTake(chatId, turnId, "krea", undefined, text, canvas, refs, who, last, told, qwen); }
      throw new Error("Couldn't find a person to keep — try “Krea only” or describe the whole picture");
    }
    const ref = refs.find((r) => !r.charId);
    const ordered = ref ? [canvas, ref] : [canvas];
    const words = wordsFor(text, pics, ordered, "krea").trim().replace(/\.?$/, ".");
    if (route === "part") {
      step(`Redrawing ${part} (Krea 2)`);
      const g = buildEdit({ ...base, loras, seed: newSeed(), images: ordered.map((p) => p.name), instruction: `${words} Change only that; keep everything else exactly the same.${keepStyle}${adult}`, negative: "", resolution: 1024,
        prefix: "studio/edit/chat", mask: sel.mask.name, maskSoftness: 10, ...regionAround(sel.box), ...(ref ? { refBoost: 4 } : {}) });
      const out = await outOf(await run("edit", `Chat · ${part}`, g, `edit:krea:${ordered.length}:raw`, { before: canvas.url, ...finalMeta(last) }));
      return { file: out, url: viewUrl(out) };
    }
    step("New background (Krea 2)");
    const bgWords = ref ? `${words} Use the place from picture 2 as the background.` : words;
    const g1 = buildEdit({ ...base, loras, seed: newSeed(), images: ordered.map((p) => p.name), instruction: `${bgWords} Keep the person exactly as they are.${keepStyle}${adult}`, negative: "", resolution: 1024,
      prefix: "studio/edit/chat", mask: sel.mask.name, maskInvert: true, maskSoftness: 14, refBoost: ref ? 3 : 1 });
    let out = await outOf(await run("edit", "Chat · new background", g1, `edit:krea:${ordered.length}:raw`, { before: canvas.url, ...quiet }));
    step("Blending the light");
    const blended = await mediaOf(out, "background");
    const g2 = buildEdit({ ...base, loras, seed: newSeed(), images: [blended.name], instruction: `Keep this picture exactly as it is. Make the light and shadows on the person match the place naturally, as one photo.${keepStyle}${adult}`, negative: "", resolution: 1024, prefix: "studio/edit/chat", denoise: 0.2 });
    out = await outOf(await run("edit", "Chat · blending the light", g2, "edit:krea:1:raw", { before: canvas.url, ...finalMeta(last && !faceAfter) }));
    if (faceAfter) { step("Sharpening the face"); out = (await sharpenFace(out, { tab: "edit", character: who, meta: finalMeta(last) })) ?? out; }
    return { file: out, url: viewUrl(out) };
  }

  if (route === "hybrid") {
    const ordered = order(canvas, refs).slice(0, 3);
    const prompt = told ?? qwenWords(text, pics, ordered);
    step("Qwen-Image is making the change");
    const draft = await outOf(await run("edit", "Chat · Qwen draft", buildQwenEdit({ images: ordered.map((p) => p.name), prompt, seed: newSeed(), prefix: "studio/edit/chat-draft", ...qwen }), "qwen:edit", { before: canvas.url, ...quiet }));
    const d = await mediaOf(draft, "Qwen draft");
    step("Krea 2 is repainting it");
    const face = who ? pics.find((p) => p.charId === who.id) : null;
    const images = face ? [d.name, face.name] : [d.name];
    const instruction = face
      ? `Keep this picture exactly as it is — the same pose, hands, outfit, background, framing and light. Make it a sharp, natural ${anime ? "anime picture" : "photo with real skin texture"}. The person is ${who!.name} from the second picture: exactly their face, eyes, nose, lips, hair and skin tone.${keepStyle}${adult}`
      : `Keep this picture exactly as it is — the same pose, people, outfit, background and framing. Make it a sharp, natural ${anime ? "anime picture" : "photo with real skin texture and light"}.${keepStyle}${adult}`;
    const g = buildEdit({ ...base, loras, seed: newSeed(), images, instruction, negative: "", resolution: 1024, prefix: "studio/edit/chat", denoise: face ? 0.42 : 0.32, refBoost: 4 });
    let out = await outOf(await run("edit", "Chat · Krea repaint", g, `edit:krea:${images.length}:raw`, { before: canvas.url, ...finalMeta(last && !faceAfter) }));
    if (faceAfter) { step("Sharpening the face"); out = (await sharpenFace(out, { tab: "edit", character: who, meta: finalMeta(last) })) ?? out; }
    return { file: out, url: viewUrl(out), draft: viewUrl(draft) };
  }

  // krea: the picture + one reference
  const ordered = order(canvas, refs).slice(0, 2);
  const ref = ordered[1];
  const words = wordsFor(text, pics, ordered, "krea").trim().replace(/\.?$/, ".");
  const keepFace = ref?.charId ? ` They keep exactly the face, hair, eye colour and skin tone of the person in picture 2.` : "";
  const loose = BIG.test(text) ? { sceneBoost: 0.6 } : {};
  step("Krea 2 Edit");
  const g = buildEdit({ ...base, loras, seed: newSeed(), images: ordered.map((p) => p.name), instruction: told ? `${told}${keepStyle}${/adult/i.test(told) ? "" : adult}` : `${words}${keepFace}${keepStyle}${adult}`, negative: "", resolution: 1024, prefix: "studio/edit/chat", ...(ref ? { refBoost: 4 } : {}), ...loose });
  const out = await outOf(await run("edit", `Chat · ${text.slice(0, 30)}`, g, `edit:krea:${ordered.length}:raw`, { before: canvas.url, ...shown }));
  return { file: out, url: viewUrl(out) };
}

/** your words for Qwen, without the writer: @names → Picture N, plus "keep their face" for each character */
function qwenWords(text: string, pics: ChatPic[], ordered: ChatPic[]): string {
  const chars = ordered.filter((p) => p.charId);
  return `${wordsFor(text, pics, ordered, "qwen").trim().replace(/\.?$/, ".")}${chars.map((p) => ` ${p.label} (Picture ${ordered.indexOf(p) + 1}): keep exactly their face, hair, eye colour and body.`).join("")} Keep Picture 1's camera, framing and light unless asked otherwise.${adult}`;
}
const REFUSAL = /^(?:i'?m sorry|sorry|i can(?:no|')t|i cannot|i am unable|i'?m unable|as an ai)/i;
/** the writer turns the message into one precise instruction (it looks at the pictures); null when it can't — then your words go as typed */
async function refined(text: string, pics: ChatPic[], ordered: ChatPic[], model: "qwen" | "krea", earlier: string[] = []): Promise<string | null> {
  const { runWriter } = await import("./writer");
  // the chat so far: "like before", "go back to the red one", "undo that" make sense to the writer
  const history = earlier.length ? earlier.slice(-4).map((t, i, a) => `${i + 1 === a.length ? "Last" : `${a.length - i} messages ago`}: ${wordsFor(t, pics, ordered, "qwen")}`).join("\n") : "(none — this is the first message)";
  const pictures = ordered.map((p, i) => `Picture ${i + 1}: ${i === 0 ? `the picture being changed (${p.label})` : p.charId ? `${p.label} — the character; their face and hair must stay exactly theirs` : `${p.label} — a reference picture`}`).join("\n");
  const request = wordsFor(text, pics, ordered, "qwen");
  try {
    const out = (await runWriter("editplan", { pictures, request, model, history }, { tab: "edit", label: "Refining your words", images: ordered.map((p) => p.name), big: true, meta: { quietFail: true, chat: true } })).replace(/\s+/g, " ").trim();
    return out.length > 20 && !REFUSAL.test(out) ? out : null;
  } catch { return null; }
}

/** the picture a new message works on */
export function canvasOf(c: Chat): ChatPic | null {
  if (c.head) {
    const t = c.turns.find((x) => x.id === c.head!.turn);
    const take = t?.takes[c.head.take];
    if (take) return { key: `step${c.turns.indexOf(t!) + 1}`, name: "", url: take.url, label: `step ${c.turns.indexOf(t!) + 1}` };
  }
  return c.pics.find((p) => p.key === c.start) ?? null;
}

/** send a message: works out the picture, the references and the route, makes the takes, checks the faces, picks the best */
export async function send(text: string, o: { chatId?: string; takes?: 1 | 2; /** the character's sheet view to use (else from the words) */ view?: View } = {}): Promise<void> {
  const st = useEditChat.getState();
  let chat = (o.chatId ? st.chats.find((c) => c.id === o.chatId) : null) ?? st.current() ?? st.newChat();
  // a character's picture is always made fresh from them (a chat from an earlier rental names a copy that's gone) — and from the
  // sheet view your words ask for ("three-quarter", "from behind", "side view"), when their sheet has it
  const want = o.view ?? angleView(text);
  for (const p of chat.pics.filter((x) => x.charId)) {
    const c = useCharacters.getState().list.find((x) => x.id === p.charId);
    const view = c && want && c.views[want] ? want : "front";
    const m = c ? await useCharacters.getState().asMedia(c.id, view).catch(() => null) : null;
    const fresh = c && m ? await plainOf(c, m) : null;
    if (fresh && fresh.name !== p.name) useEditChat.getState().patch(chat.id, (x) => ({ ...x, pics: x.pics.map((q) => (q.key === p.key ? { ...q, name: fresh.name, url: fresh.url } : q)) }));
  }
  chat = useEditChat.getState().chats.find((c) => c.id === chat.id) ?? chat;
  const words = text.trim();
  if (!words) throw new Error("Say what to change");
  const named = Array.from(new Set(Array.from(words.matchAll(/@([a-z0-9]+)/gi)).map((m) => m[1].toLowerCase())))
    .map((k) => chat.pics.find((p) => p.key === k)).filter(Boolean) as ChatPic[];
  // the picture to change: where you are in the chat; or (first message) the first picture you named that isn't a character
  let canvas = canvasOf(chat);
  let refs = named;
  if (!canvas) {
    canvas = named.find((p) => !p.charId) ?? named[0] ?? null;
    if (!canvas) throw new Error("Add a picture first — drop one in, or type @ to pick one");
    useEditChat.getState().patch(chat.id, (c) => ({ ...c, start: canvas!.key }));
  }
  if (!canvas.name) { const take = chat.turns.find((t) => t.id === chat.head?.turn)?.takes[chat.head!.take]; const m = await mediaOf(take!.file, canvas.label); canvas = { ...canvas, name: m.name }; }
  refs = refs.filter((p) => p.name !== canvas!.name);
  // "the original" / "the first picture": the picture the chat started from comes back as a reference
  const start = chat.pics.find((p) => p.key === chat.start);
  let said = words;
  const ORIGINAL = /\b(?:the\s+)?(?:original(?:\s+(?:picture|photo|image|one|pic))?|(?:first|starting)\s+(?:picture|photo|image|pic))\b/i;
  if (start && start.name !== canvas.name && ORIGINAL.test(words) && !refs.some((r) => r.name === start.name)) {
    refs = [...refs, start];
    said = words.replace(ORIGINAL, `@${start.key}`); // so each model is told which picture "the original" is
  }
  // the character: the one you named now, else the one this chat is about
  const who = charOf(refs.find((r) => r.charId)) ?? charOf(chat.pics.find((p) => p.charId));
  const { useDownloads } = await import("./downloads");
  const q = useDownloads.getState().groups.find((g) => g.id === "qwen");
  const qwenReady = !q || q.state === "done";
  const r = routeOf(said, refs, st.engine, qwenReady);
  if (r.route === "hybrid" && !qwenReady) throw new Error("The Qwen + Krea route needs the Edit chat helper models (≈16 GB) — press Download in the chat settings, or pick Krea only");
  const turn: Turn = { id: uid(), text: words, route: r.route, note: r.note, status: "running", step: "Starting", from: chat.head ? { head: chat.head } : { pic: canvas.key }, refs: refs.map((p) => p.key), takes: [], at: Date.now() };
  useEditChat.getState().patch(chat.id, (c) => ({ ...c, turns: [...c.turns, turn] }));
  const n = o.takes ?? st.takes;
  // Qwen: the bf16 model when it's here and the card is big enough; fast = the Lightning LoRA
  const full = useDownloads.getState().groups.find((g) => g.id === "qwen_full")?.state === "done" && (useDownloads.getState().gpu?.vram_mb ?? 0) >= 46000;
  const qwen = { fast: qwenFast(st.quality), full };
  let told: string | undefined;
  if (r.route === "hybrid" || r.route === "krea") {
    const model = r.route === "hybrid" ? "qwen" : "krea";
    const ordered = order(canvas, refs).slice(0, model === "qwen" ? 3 : 2);
    const writer = useDownloads.getState().groups.find((g) => g.id === "writer");
    if (st.refine && (!writer || writer.state === "done")) {
      patchTurn(chat.id, turn.id, { step: "Refining your words (the writer looks at the pictures)" });
      told = (await refined(said, chat.pics, ordered, model, chat.turns.filter((t) => t.status === "done").map((t) => t.text))) ?? undefined;
    }
    if (!told && model === "qwen") told = qwenWords(said, chat.pics, ordered);
    if (told) patchTurn(chat.id, turn.id, { told });
  }
  try {
    const takes: Take[] = [];
    let firstErr = "";
    for (let i = 0; i < n; i++) {
      try { takes.push(await oneTake(chat.id, turn.id, r.route, r.part, said, canvas, refs, who, true, told, qwen)); patchTurn(chat.id, turn.id, { takes: [...takes] }); }
      catch (e) { firstErr ||= (e as Error).message; }
    }
    if (!takes.length) throw new Error(firstErr || "Nothing came out");
    // the face check: each take against their picture; one more try when none look like them
    const writer = useDownloads.getState().groups.find((g) => g.id === "writer");
    if (who && st.check && (!writer || writer.state === "done")) {
      const { checkFace } = await import("./builder");
      const score = async (t: Take) => { patchTurn(chat.id, turn.id, { step: "Checking the face" }); const s = await checkFace(who, t.file).catch(() => ({ score: undefined, why: "" })); t.score = s.score; t.why = s.why; };
      for (const t of takes) await score(t);
      if (takes.every((t) => typeof t.score === "number" && t.score < 6)) {
        patchTurn(chat.id, turn.id, { step: "The face didn't match — one more try" });
        try { const t = await oneTake(chat.id, turn.id, r.route, r.part, said, canvas, refs, who, true, told, qwen); await score(t); takes.push(t); } catch { /* keep what we have */ }
      }
    }
    const best = takes.reduce((b, t, i) => ((t.score ?? 0) > (takes[b].score ?? 0) ? i : b), 0);
    patchTurn(chat.id, turn.id, { status: "done", step: undefined, takes: [...takes], ...(firstErr && takes.length < n ? { error: `One take failed: ${firstErr}` } : {}) });
    useEditChat.getState().patch(chat.id, (c) => ({ ...c, head: { turn: turn.id, take: best } }));
  } catch (e) {
    patchTurn(chat.id, turn.id, { status: "failed", step: undefined, error: (e as Error).message });
  }
}

/** continue from this take (the next message works on it) */
export const continueFrom = (chatId: string, head: Head) => useEditChat.getState().patch(chatId, (c) => ({ ...c, head }));
/** a take as a picture you can name in a later message (e.g. go back to step 2's outfit) */
export async function takeAsPic(chatId: string, turnIdx: number, take: Take): Promise<ChatPic> {
  const m = await mediaOf(take.file, `step ${turnIdx + 1}`);
  return addPic(chatId, m, { label: `step${turnIdx + 1}` });
}
export const trayMedia = (id: string) => useTray.getState().asMedia(id);

/** Qwen's Lightning (fast) setting: picked, or automatic on a card under 24 GB (best = 9–11 min per picture on 16 GB) */
export function qwenFast(q: ChatState["quality"]): boolean {
  if (q !== "auto") return q === "fast";
  const vram = useDl.getState().gpu?.vram_mb ?? 0;
  return vram > 0 && vram < 24000;
}
