// One-button character videos. Each preset uses the character's reference sheet as <Picture> references
// and writes a prompt that names the character and restates their look in EVERY cut, so the video
// keeps the same person all the way through instead of drifting into a random one.
import type { Character, View } from "./characters";
import { useCharacters } from "./characters";
import { fmt } from "./timeline";
import { makeRef, type Ref } from "./work";
import type { Media } from "./tray";

export interface PresetInput { clip?: Media | null; words?: string; voice?: string; place?: string; extra?: string; /** swap: wear the clip's clothes instead of their own */ clipOutfit?: boolean }
export interface CharPreset {
  id: string; title: string; blurb: string;
  /** which sheet views go in as references, in order (missing ones are skipped) */
  views: View[];
  needs?: ("clip" | "words")[];
  mode: "ref" | "loop";
  seconds: number;
  /** "max" = references at full detail (stronger likeness, slower) */
  refDetail?: "max";
  /** the video's length follows the clip */
  clipLength?: boolean;
  cuts: (c: Character, id: string, at: (a: number, b: number) => string, inp: PresetInput, secs: number) => string[];
}

/** the short look that gets repeated in every cut */
export function look(c: Character): string {
  const who = c.gender === "male" ? "man" : c.gender === "female" ? "woman" : "person";
  const eyes = c.eyes && !/eye/i.test(c.eyes) ? `${c.eyes} eyes` : c.eyes;
  return [`adult ${who}`, c.hair, eyes, c.outfit, c.details].filter(Boolean).join(", ");
}

const split = (secs: number, n: number) => Array.from({ length: n }, (_, i) => [Math.round((secs * i) / n * 10) / 10, Math.round((secs * (i + 1)) / n * 10) / 10] as const);

export const PRESETS: CharPreset[] = [
  {
    id: "dance", title: "Dance like a clip", blurb: "Copies the moves from a video you give it, beat for beat.",
    views: ["front", "face", "back"], needs: ["clip"], mode: "ref", seconds: 10,
    cuts: (c, id, at, inp, secs) => [
      `CUT 1 (${at(0, secs)}): ${id} dances ${inp.place ? `in ${inp.place}` : "in the same kind of place as <Video 1>"}, copying the exact choreography, timing and energy of <Video 1> move for move. Full body in frame, camera framed like <Video 1>. ${id} stays the same ${look(c)} the whole time — same face as <Picture 2>, same hair and outfit as <Picture 1>.`,
    ],
  },
  {
    id: "swap", title: "Replace someone in a clip", blurb: "Puts them into a video you give it — same moves, camera and place, their face and body.",
    views: ["front", "face", "threeq"], needs: ["clip"], mode: "ref", seconds: 10, refDetail: "max", clipLength: true,
    cuts: (c, id, at, inp, secs) => {
      const noun = c.gender === "male" ? "man" : c.gender === "female" ? "woman" : "person";
      const whom = inp.extra?.trim() ? inp.extra.trim().replace(/^the\s+/i, "") : "person";
      const wear = inp.clipOutfit ? `wearing the exact clothes the ${whom} wears in <Video 1>` : `in ${c.gender === "male" ? "his" : c.gender === "female" ? "her" : "their"} own outfit from <Picture 1>`;
      return [
        `CUT 1 (${at(0, secs)}): Replace the ${whom} in <Video 1> with ${id}, the ${noun} in <Picture 1>, <Picture 2> and <Picture 3>, ${wear}. ${id} keeps every distinguishing feature from the pictures: the same face as <Picture 2> (face shape, eyes, nose, lips, skin tone, freckles or marks), the same hair colour, length and style, the same body shape, ${look(c)}.`,
        `Keep everything else from <Video 1> exactly: the camera and every move it makes, the framing, background, lighting, objects and any other people. ${id} takes the original ${whom}'s exact position, size in frame, pose and movement, beat for beat with the same timing, and the same expressions and lip movements. The ${whom} from <Video 1> never appears. Do not show the reference pictures, their plain background or a split screen.`,
      ];
    },
  },
  {
    id: "talk", title: "Talk to camera", blurb: "Close-up, says your line with lip-sync.",
    views: ["face", "front"], needs: ["words"], mode: "ref", seconds: 6,
    cuts: (c, id, at, inp, secs) => [
      `CUT 1 (${at(0, secs)}): Medium close-up of ${id} (${look(c)}, the same face as <Picture 1>) ${inp.place ? `in ${inp.place}` : "in a softly lit room"}, looking into the camera.`,
      `At ${fmt(1)}, ${id} says${inp.voice ? ` in a ${inp.voice} voice` : ""}: "${(inp.words ?? "").replace(/"/g, "'")}" — natural lip-sync, small head movements, ${c.personality || "relaxed"} expression. Same face, hair and outfit as <Picture 1> and <Picture 2> throughout.`,
    ],
  },
  {
    id: "walk", title: "Walk toward camera", blurb: "Confident walk, camera tracking back.",
    views: ["front", "face", "threeq"], mode: "ref", seconds: 8,
    cuts: (c, id, at, inp, secs) => split(secs, 2).map(([a, b], i) => i === 0
      ? `CUT 1 (${at(a, b)}): Wide shot. ${id} (${look(c)}, exactly as in <Picture 1>) walks confidently toward the camera ${inp.place ? `through ${inp.place}` : "down a city street at golden hour"}; the camera tracks backwards.`
      : `CUT 2 (${at(a, b)}): Medium shot, still tracking. ${id} keeps walking, glances at the camera and smiles — still the same ${look(c)}, same face as <Picture 2>.`),
  },
  {
    id: "turn", title: "Turnaround", blurb: "Slow 360° turn on a plain background — great for checking the look.",
    views: ["front", "back", "left", "face"], mode: "ref", seconds: 8,
    cuts: (c, id, at, _inp, secs) => [
      `CUT 1 (${at(0, secs)}): Full body, plain light-grey studio background, static camera. ${id} (${look(c)}) slowly turns a full 360 degrees on the spot: front as in <Picture 1>, back as in <Picture 2>, side as in <Picture 3>, then front again. Same face as <Picture 4>, same hair and outfit from every angle.`,
    ],
  },
  {
    id: "poses", title: "Pose showcase", blurb: "Three quick poses with cuts, for reels.",
    views: ["front", "face", "threeq"], mode: "ref", seconds: 9,
    cuts: (c, id, at, inp, secs) => split(secs, 3).map(([a, b], i) => `CUT ${i + 1} (${at(a, b)}): ${["Full body", "Medium shot", "Close-up"][i]} of ${id} — the same ${look(c)} as <Picture 1>, same face as <Picture 2> — ${["striking a confident pose, hand on hip", "turning over the shoulder toward the camera", "a playful smile straight into the lens"][i]}, ${inp.place || "clean studio background with a soft rim light"}.`),
  },
  {
    id: "idle", title: "Living portrait loop", blurb: "Breathing, blinking, hair moving — loops seamlessly.",
    views: ["front"], mode: "loop", seconds: 5,
    cuts: (c, id, at, _inp, secs) => [
      `CUT 1 (${at(0, secs)}): ${id} (${look(c)}) stands still and breathes gently, blinks, small natural movements, hair and clothes moving slightly in a light breeze. Static camera. Identical to the picture — same face, hair and outfit.`,
    ],
  },
];

/** references (sheet views → <Picture n>, optional clip → <Video 1>) and the prompt for one preset */
export async function buildCharacterVideo(c: Character, p: CharPreset, inp: PresetInput, secs: number): Promise<{ refs: Ref[]; frames: Media[]; prompt: string; missing: View[] } | null> {
  const st = useCharacters.getState();
  const views = p.views.filter((v) => c.views[v]);
  const missing = p.views.filter((v) => !c.views[v]);
  if (!views.length) return null;
  const media = (await Promise.all(views.map((v) => st.asMedia(c.id, v)))).filter(Boolean) as Media[];
  const refs: Ref[] = media.map((m, i) => ({ ...makeRef(m), label: `${c.name} — ${views[i]}` }));
  if (p.needs?.includes("clip") && inp.clip) refs.push({ ...makeRef(inp.clip), label: "moves to copy" });
  // the prompt references pictures by position; if a view is missing, renumber
  const at = (a: number, b: number) => `${fmt(a)}–${fmt(b)}`;
  let prompt = [
    `${c.name} is the ${look(c)} shown in the reference pictures. Keep ${c.name} identical in every shot: same face, hair, eye colour, body and outfit.`,
    ...p.cuts(c, c.name, at, inp, secs),
  ].join("\n");
  // map <Picture k> (k = position in p.views) to the actual position after skipping missing views
  prompt = prompt.replace(/<Picture (\d+)>/g, (_, k) => {
    const v = p.views[Number(k) - 1];
    const idx = views.indexOf(v);
    return `<Picture ${idx >= 0 ? idx + 1 : 1}>`;
  }).replace(/(<Picture \d+>)( and |, )\1/g, "$1");
  return { refs, frames: media.slice(0, 1), prompt, missing };
}
