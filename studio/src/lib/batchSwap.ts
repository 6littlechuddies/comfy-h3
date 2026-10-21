// Batch → photo set → "Swap in": every picture you dropped (CivitAI, Pinterest, any photo — no prompt needed) goes through
// the same pipeline as Edit chat's swap: the writer looks at the picture and your character and writes the instruction,
// Qwen-Image-Edit swaps the person, Krea 2 repaints with their LoRA, then the face pass and the face check. One picture
// after another (the GPU does one thing at a time anyway); each runs in its own hidden chat, so your own chats stay as
// they are. The steps are run from this page, so it has to stay open until the run is done.
import { create } from "zustand";
import type { Character } from "./characters";
import type { Row } from "./batch";

export interface SwapItem { row: Row; who: Character; outfit: "theirs" | "picture"; toSet?: { title: string; tier: "free" | "premium" } }
interface SwapRun { running: boolean; total: number; done: number; failed: number; now: string; stopAsked: boolean }
export const useSwapRun = create<SwapRun>(() => ({ running: false, total: 0, done: 0, failed: 0, now: "", stopAsked: false }));
export const stopSwaps = () => useSwapRun.setState({ stopAsked: true });

let queue: SwapItem[] = [];

/** add pictures to the run (starts it if it isn't going) */
export function startSwaps(items: SwapItem[]) {
  queue.push(...items);
  const st = useSwapRun.getState();
  useSwapRun.setState({ total: (st.running ? st.total : 0) + items.length, ...(st.running ? {} : { done: 0, failed: 0 }) });
  if (!st.running) void loop();
}

async function loop() {
  const [{ useBatch }, ec, { addToSiteSet }, { useJobs }] = await Promise.all([import("./batch"), import("./editchat"), import("./characters"), import("./jobs")]);
  await ec.useEditChat.getState().load();
  useSwapRun.setState({ running: true, stopAsked: false });
  const upd = (id: string, p: Partial<Row>) => useBatch.getState().update(id, p);
  while (queue.length) {
    if (useSwapRun.getState().stopAsked) {
      for (const it of queue) upd(it.row.id, { status: "ready", step: undefined });
      queue = [];
      break;
    }
    const it = queue.shift()!;
    const { row, who } = it;
    const n = useSwapRun.getState().done + useSwapRun.getState().failed + 1;
    useSwapRun.setState({ now: `${who.name} into picture ${n} of ${useSwapRun.getState().total}` });
    upd(row.id, { step: `Swapping ${who.name} in…` });
    try {
      if (!row.imitate) throw new Error("No picture");
      const chat = ec.useEditChat.getState().newChat({ select: false, batch: true, title: `Batch · ${who.name} · ${n}` });
      const pic = ec.addPic(chat.id, row.imitate, { label: "picture", start: true });
      const me = await ec.addCharacter(chat.id, who);
      const noun = who.gender === "male" ? "man" : who.gender === "female" ? "woman" : "person";
      // the row's words say which person (if there are several) or add a change
      const extra = row.idea.trim();
      const whom = extra && /^(the\s+)?(woman|man|girl|guy|person|one)\b/i.test(extra) ? `the ${extra.replace(/^the\s+/i, "")}` : `the ${noun}`;
      const outfit = it.outfit === "picture" ? `, wearing the clothes ${whom} wears in @${pic.key}` : `, in ${who.gender === "male" ? "his" : "her"} own full outfit from @${me.key}`;
      const more = extra && whom === `the ${noun}` ? ` ${extra.replace(/\.?$/, ".")}` : "";
      // their sheet picture at the same angle as this picture (a back shot gets their back view)
      // like Orior's pipeline: read the picture first (pose, framing, camera — never the person's looks), so the edit is told the
      // exact pose in words as well as shown it; then their sheet picture at that angle
      upd(row.id, { step: "Reading the pose…" });
      const pose = await ec.poseOf(row.imitate).catch(() => "");
      upd(row.id, { step: `Matching ${who.name}'s angle…` });
      const view = await ec.viewFor(who, row.imitate, `${extra} ${pose}`);
      upd(row.id, { step: `Swapping ${who.name} in (${view} view)…` });
      const exact = pose ? ` The pose, exactly: ${pose.replace(/\s+/g, " ").slice(0, 700).replace(/\.?$/, ".")}` : "";
      await ec.send(`@${me.key} replaces ${whom} in @${pic.key}${outfit}. Keep the exact pose, hands, framing, light and background of @${pic.key}.${exact} Only one person: ${who.name}.${more}`, { chatId: chat.id, takes: 1, view });
      const done = ec.useEditChat.getState().chats.find((c) => c.id === chat.id);
      const turn = done?.turns.at(-1);
      const take = done?.head ? turn?.takes[done.head.take] : undefined;
      if (!take || turn?.status !== "done") throw new Error(turn?.error || "Nothing came out");
      if (it.toSet) addToSiteSet(who.id, it.toSet.title, it.toSet.tier, take.file);
      const r = useBatch.getState().rows.find((x) => x.id === row.id);
      upd(row.id, { step: undefined, results: [...(r?.results ?? []), take.url], ...(take.score != null ? { score: take.score } : {}) });
      useSwapRun.setState((s) => ({ done: s.done + 1 }));
    } catch (e) {
      upd(row.id, { status: "error", step: undefined, error: (e as Error).message });
      useSwapRun.setState((s) => ({ failed: s.failed + 1 }));
    }
  }
  const s = useSwapRun.getState();
  useSwapRun.setState({ running: false, now: "" });
  if (s.done + s.failed) useJobs.getState().toast(`Batch swap ${s.stopAsked ? "stopped" : "done"}: ${s.done} picture${s.done === 1 ? "" : "s"}${s.failed ? `, ${s.failed} failed` : ""} — they're in Edit's results and the catalog.`, s.failed ? "info" : "good", "batch");
}
