// A saved pose or background used AS A PICTURE (exact), not as words: the CivitAI post is fetched to the rental, then
//  - pose: the person is cut out onto flat grey (BiRefNet) — their pose with no background, no room, nothing to copy but the
//    body position — and goes in as picture 2 with "Copy the pose";
//  - background: the people are removed by Krea 2 Edit, leaving the empty place — it goes in as "the place".
// Both are cached per post, so picking the same one again is instant.
import { useJobs, type Job } from "./jobs";
import { useTray, type Media } from "./tray";
import { useSettings, newSeed } from "./settings";
import type { InspoItem } from "./inspo";

const CACHE = "h3.inspo.pics";
const cache = (): Record<string, { filename: string; subfolder: string }> => { try { return JSON.parse(localStorage.getItem(CACHE) || "{}"); } catch { return {}; } };
const remember = (k: string, f: { filename: string; subfolder: string }) => { try { const c = cache(); c[k] = f; localStorage.setItem(CACHE, JSON.stringify(c)); } catch { /* */ } };

/** run a job and wait for its picture */
export async function runForPicture(label: string, graph: Record<string, unknown>, tab: "create" | "edit" = "create"): Promise<{ filename: string; subfolder: string }> {
  const job = await useJobs.getState().run(tab, label, graph as never, "cutout", { no4k: true, quiet: true } as never) as unknown as Job;
  const id = job.id;
  return new Promise((res, rej) => {
    const check = () => {
      const j = useJobs.getState().jobs.find((x) => x.id === id);
      if (!j) return false;
      if (j.status === "done") { const o = j.outputs.find((x) => x.kind === "image" && x.type === "output"); if (o) res(o); else rej(new Error("It finished without a picture")); return true; }
      if (j.status === "error" || j.status === "cancelled") { rej(new Error(j.error || "It didn't finish")); return true; }
      return false;
    };
    if (check()) return;
    const un = useJobs.subscribe(() => { if (check()) un(); });
  });
}

async function asMedia(f: { filename: string; subfolder: string }, label: string): Promise<Media> {
  const t = useTray.getState().addOutput({ ...f, type: "output", kind: "image" } as never, label);
  if (!t) throw new Error("Couldn't add it");
  return useTray.getState().asMedia(t.id);
}

/** the pose of a saved item, as a grey-background cut-out of the person */
export async function posePicture(i: InspoItem, onStep?: (t: string) => void): Promise<Media> {
  const key = `pose|${i.url || i.thumb}`;
  const hit = cache()[key];
  if (hit) { try { const r = await fetch(`/view?filename=${encodeURIComponent(hit.filename)}&subfolder=${encodeURIComponent(hit.subfolder)}&type=output`, { method: "HEAD" }); if (r.ok) return asMedia(hit, "Pose"); } catch { /* make it again */ } }
  onStep?.("Getting the picture…");
  const src = await useTray.getState().addUrl(i.url || i.thumb!);
  onStep?.("Cutting the person out (pose only, no background)…");
  const { buildGreenScreen } = await import("./graphs");
  const out = await runForPicture("Pose from a saved post", buildGreenScreen(src.name, "studio/_work/pose", "#808080") as never);
  remember(key, out);
  return asMedia(out, "Pose");
}

/** the place of a saved item, with the people taken out */
export async function placePicture(i: InspoItem, onStep?: (t: string) => void): Promise<Media> {
  const key = `place|${i.url || i.thumb}`;
  const hit = cache()[key];
  if (hit) { try { const r = await fetch(`/view?filename=${encodeURIComponent(hit.filename)}&subfolder=${encodeURIComponent(hit.subfolder)}&type=output`, { method: "HEAD" }); if (r.ok) return asMedia(hit, "Place"); } catch { /* make it again */ } }
  onStep?.("Getting the picture…");
  const src = await useTray.getState().addUrl(i.url || i.thumb!);
  onStep?.("Taking the people out (empty place)…");
  const [{ buildEdit }, { editArgs }] = await Promise.all([import("./graphs"), import("./settings")]);
  const ed = useSettings.getState().s.edit;
  const g = buildEdit({ ...editArgs(ed, "krea"), seed: newSeed(), images: [src.name], negative: "", resolution: 1448, prefix: "studio/_work/place",
    instruction: "Remove every person from this picture completely. Show the same empty place: the same room or location, the same light, the same camera angle and framing, with nothing left where they were." } as never);
  const out = await runForPicture("Background from a saved post", g as never, "edit");
  remember(key, out);
  return asMedia(out, "Place");
}
