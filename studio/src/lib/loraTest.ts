// "Test it": is a trained character LoRA any good? Six pictures from words + the LoRA only (no reference picture pinned),
// each a different angle and expression — including two from behind — then each face is scored 0–10 against their own
// picture. A good LoRA: the same person in every one, the back of the hair right, and no stiff copy of one face.
import { looks, type Character } from "./characters";
import { buildCreate } from "./graphs";
import { useJobs, waitForJob } from "./jobs";
import { DEFAULTS, modelArgs, modelOf, newSeed, useSettings } from "./settings";

const SHOTS: { what: string; face: boolean; w: number; h: number }[] = [
  { what: "close-up portrait facing the camera, laughing with her head tipped back, plain light grey background, soft even light", face: true, w: 1024, h: 1024 },
  { what: "waist-up, three-quarter view from the left, a slow smirk, sitting in a cafe by the window, daylight", face: true, w: 896, h: 1152 },
  { what: "close-up side profile facing right, eyes closed, a faint smile, warm evening light", face: true, w: 1024, h: 1024 },
  { what: "full body, seen from behind, looking back over her shoulder at the camera, on a city street at dusk", face: true, w: 832, h: 1216 },
  { what: "back view, facing away from the camera, showing the back of her hair and outfit, standing in front of a plain white wall", face: false, w: 832, h: 1216 },
  { what: "full body, shot from a low angle, hands on hips, serious intense look, on a beach in bright sunlight", face: true, w: 832, h: 1216 },
];

export async function testLora(c: Character, onStep?: (t: string) => void): Promise<{ scored: number; good: number; avg: number | null }> {
  const mine = (c.loras ?? []).filter((l) => !l.off);
  if (!mine.length) throw new Error(`${c.name} has no LoRA switched on — train one first (Training set → Train their LoRA here)`);
  const st = useSettings.getState().s;
  const mi = modelOf(st.create, "realistic");
  const who = looks(c).replace(/^A /, "a ");
  const jobs = [];
  for (const [i, s] of SHOTS.entries()) {
    const positive = `A real smartphone photo of ${who}. ${s.what[0].toUpperCase()}${s.what.slice(1)}. Natural skin texture, unretouched.`.replace(/\bher\b/g, c.gender === "male" ? "his" : "her");
    const g = buildCreate({ ...mi.adv, seed: newSeed(), ...modelArgs(st.create, mi), positive, negative: DEFAULTS.create.negative, loras: [...mine, ...mi.loras],
      width: s.w, height: s.h, count: 1, cutout: false, prefix: `studio/characters/${c.id}_loratest` });
    jobs.push(await useJobs.getState().run("characters", `${c.name}: LoRA test ${i + 1}/6`, g, "create:realistic:portrait:1", { charId: c.id, loraTest: true }));
  }
  const { checkFace } = await import("./builder");
  const scores: number[] = [];
  for (const [i, j] of jobs.entries()) {
    onStep?.(`Checking test ${i + 1}/6…`);
    const done = await waitForJob(j.id);
    const out = done.outputs.find((x) => x.kind === "image" && x.type === "output");
    if (!out || !SHOTS[i].face) continue;
    const r = await checkFace(c, out).catch(() => null);
    if (typeof r?.score === "number") scores.push(r.score);
  }
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return { scored: scores.length, good: scores.filter((x) => x >= 7).length, avg };
}
