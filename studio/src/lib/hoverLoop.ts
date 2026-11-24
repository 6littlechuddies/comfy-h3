// Her hover loop, made by itself: her card picture animated with H3 as a seamless loop (it starts and ends on the picture),
// small idle movement only, so the card on your site comes alive when hovered. Set as her hover loop when it's done.
import type { FileRef } from "./api";
import { useCharacters } from "./characters";

const running = new Set<string>();

/** the picture's width ÷ height (portrait cards are ~0.56–0.75) */
const ratioOf = (url: string) => new Promise<number>((ok) => { const i = new Image(); i.onload = () => ok(i.naturalWidth / Math.max(1, i.naturalHeight)); i.onerror = () => ok(9 / 16); i.src = url; });

/** make the pinned ones (or the given ones): `takes` each, all queued at once — on a rental with several GPUs they run side by side */
export async function makePinned(ids: string[], takes = 1): Promise<void> {
  const list = useCharacters.getState().list.filter((c) => ids.includes(c.id));
  await Promise.allSettled(list.flatMap((c) => Array.from({ length: takes }, (_, k) => makeHoverLoop(c.id, c.site?.coverVideoPin?.from, k))));
}

export async function makeHoverLoop(id: string, from?: FileRef, take = 0): Promise<FileRef> {
  const key = `${id}:${take}`;
  if (running.has(key)) throw new Error("already being made");
  running.add(key);
  try {
    const [{ buildAnimate }, { useJobs, waitForJob }, { useSettings, newSeed }, { h3SizeFor }, { toInput, viewUrl }, { look }] = await Promise.all([
      import("./graphs"), import("./jobs"), import("./settings"), import("./models"), import("./api"), import("./charVideo")]);
    const c0 = useCharacters.getState().list.find((x) => x.id === id);
    if (!c0) throw new Error("that character is gone");
    const src = from ?? c0.cover ?? c0.views.front;
    if (!src) throw new Error("she has no card picture yet — pick one first");
    const input = await toInput(src);
    const ratio = await ratioOf(viewUrl(src));
    const { width, height } = h3SizeFor(ratio, 0.5);
    const a = useSettings.getState().s.animate;
    const name = c0.site?.name || c0.name;
    const prompt = `${name} (${look(c0)}) holds the exact pose, framing and place of the picture and comes gently alive: she breathes, blinks, shifts her weight a little and gives a small natural smile; her hair and clothes move slightly. The camera does not move. The clip starts and ends on this exact picture, so it loops seamlessly. Same face, hair, outfit, place and light as the picture throughout. Silent.`;
    const g = buildAnimate({ sampler: a.adv.sampler, scheduler: a.adv.scheduler, steps: a.adv.steps, seed: newSeed(), mode: "loop", prompt, images: [input.name], videos: [], audios: [],
      seconds: 5, width, height, turbo: a.turbo, loras: a.loras, refImageSize: a.refImageSize, lowMemDecode: a.lowMemDecode, prefix: `studio/site/loop_${id}`, plain: true,
      mouth: "closed", music: "none", avoid: "camera movement, cuts, zoom, text, watermark", anime: c0.style === "anime" });
    const j = await useJobs.getState().run("characters", `${name} · animated cover${take ? ` · take ${take + 1}` : ""}`, g, "animate:loop:5s", { charId: id });
    const done = await waitForJob(j.id);
    const out = done.outputs.find((o) => o.kind === "video" && o.type === "output");
    if (done.status !== "done" || !out) throw new Error(done.error ?? "H3 finished without a video");
    const ref: FileRef = { filename: out.filename, subfolder: out.subfolder, type: "output" };
    // her pin is done; the first one made becomes her animated cover (switch it any time in Your site → Animated covers)
    const c = useCharacters.getState().list.find((x) => x.id === id);
    if (c) { const { coverVideoPin: _p, ...rest } = c.site ?? {}; useCharacters.getState().save({ ...c, site: { ...rest, loopFile: c.site?.loopFile ?? ref } }); }
    const { resendIfSent } = await import("../components/SiteLink");
    const m = await resendIfSent(id);
    useJobs.getState().toast(`${name}'s animated cover is made${m ? ` · ${m}` : " — it goes with her next send"}`, "good");
    return ref;
  } finally { running.delete(key); }
}
