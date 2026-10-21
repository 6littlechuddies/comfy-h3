// Poses by how bold they read. Bold is three levers together: how open the pose is × the camera angle × how much she's
// wearing — a low or overhead camera makes the same pose read about one level bolder. Each pose is written limb by limb
// (weight, legs, hands, torso, head and eyes): one concrete pose works, two in one prompt get blended, and vague words
// ("sensual pose") get ignored. The words go into the prompt box exactly as shown — nothing rewrites them.

export type Level = 0 | 1 | 2 | 3;
export interface Pose { id: string; name: string; words: string }

export const LEVELS: { level: Level; name: string; hint: string }[] = [
  { level: 0, name: "Clothed", hint: "Editorial, natural — fully dressed pictures" },
  { level: 1, name: "Relaxed", hint: "Open, lounging — swimwear, wet, lingerie, bedroom" },
  { level: 2, name: "Bold", hint: "Wide, arched, low to the camera — the explicit sets" },
  { level: 3, name: "Framing", hint: "Extreme angles and tight crops that make any pose bolder" },
];

export const POSES: Record<Level, Pose[]> = {
  0: [
    { id: "hip", name: "Weight on one leg", words: "standing with her weight on one leg, the other knee softly bent, one hand on her hip, the other arm relaxed at her side, shoulders turned slightly away, chin a little down, eyes on the camera" },
    { id: "wall", name: "Leaning on a wall", words: "leaning one shoulder against a wall, arms folded loosely under her chest, one ankle crossed over the other, head tilted, looking at the camera" },
    { id: "chair", name: "Seated, legs crossed", words: "sitting upright on the edge of a chair, legs crossed at the knee, both hands resting on her top thigh, back straight, head turned toward the camera" },
    { id: "walk", name: "Walking toward camera", words: "mid-stride walking toward the camera, front foot just landing, arms swinging naturally, hair moving with the step, a small smile" },
    { id: "shoulder", name: "Over the shoulder", words: "standing with her back to the camera, head turned to look back over her shoulder, one hand lifting her hair off her neck, the other at her side" },
    { id: "rail", name: "Leaning on a railing", words: "leaning forward on a railing with both forearms, one knee bent so the foot rests on the lower bar, looking sideways at the camera" },
  ],
  1: [
    { id: "crouch", name: "Crouching, knees apart", words: "crouching low with her knees apart, both hands resting on the floor between her feet, leaning slightly forward, looking up at the camera" },
    { id: "side", name: "On her side, on an elbow", words: "lying on her side on the bed, propped up on one elbow, top leg bent forward over the other, free hand resting on her hip, looking back over her shoulder" },
    { id: "floorsit", name: "Sitting, knees to one side", words: "sitting on the floor with both knees bent and dropped to one side, leaning back on one straight arm, the other hand in her hair" },
    { id: "kneel", name: "Kneeling upright", words: "kneeling upright with her knees slightly apart, hands clasped behind her back, chest forward, chin raised, eyes on the camera" },
    { id: "sofa", name: "Reclining on a sofa", words: "reclining on a sofa, one arm bent behind her head, one knee raised, the other leg stretched out along the cushions, head resting back" },
    { id: "bedsit", name: "Sitting on the bed edge", words: "sitting on the edge of the bed, legs apart with her feet on the floor, hands pressed on the mattress beside her hips, leaning back slightly" },
  ],
  2: [
    { id: "stance", name: "Wide stance, from below", words: "standing with her legs wide apart, hands on her hips, shot from a low angle looking up at her, chin down, looking down into the camera" },
    { id: "prone", name: "Face down, hips lifted", words: "lying face down with her hips lifted toward the camera, chest pressed low to the bed, arms stretched forward, looking back over her shoulder" },
    { id: "wide", name: "Seated wide, leaning in", words: "sitting with her legs wide apart, leaning forward with her elbows on her knees, hands together between her thighs, looking straight into the camera" },
    { id: "arch", name: "One knee, arched back", words: "kneeling on one knee with the other leg extended out to the side, torso arched back, one hand in her hair, the other on her raised thigh" },
    { id: "back", name: "On her back, knees up", words: "lying on her back with her knees raised and apart, one hand behind her head, the other resting on her stomach, head turned toward the camera" },
    { id: "fours", name: "On all fours", words: "on all fours on the bed, back deeply arched, knees apart, looking back over her shoulder at the camera" },
  ],
  3: [
    { id: "between", name: "Extreme low, between legs", words: "extreme low angle looking up between her open legs, her face visible above, looking down at the camera" },
    { id: "overhead", name: "Overhead, lying flat", words: "top-down overhead shot, lying flat on her back with her legs open and both arms stretched above her head, looking straight up into the camera" },
    { id: "waist", name: "Tight crop, waist to chin", words: "tight crop from her waist to her chin, back arched, one hand on her chest, lips parted" },
    { id: "thigh", name: "Cropped at mid-thigh", words: "cropped at mid-thigh, hips turned toward the camera, thumbs hooked into her waistband" },
  ],
};

export const CAMERAS: { id: string; name: string; words: string; bolder: number }[] = [
  { id: "eye", name: "Eye level", words: "", bolder: 0 },
  { id: "low", name: "Low angle", words: "shot from a low angle looking up at her", bolder: 1 },
  { id: "high", name: "Overhead", words: "shot from directly overhead", bolder: 1 },
  { id: "close", name: "Close crop", words: "framed close and cropped tight", bolder: 0 },
];

/** the words that go into the box: the pose (as a description, or as an instruction for Edit), then the camera */
export function poseWords(p: Pose, cameraId: string, mode: "describe" | "instruct"): string {
  const cam = CAMERAS.find((c) => c.id === cameraId);
  // a pose that already names its own angle doesn't get a second one
  const own = /\b(low angle|overhead|top-down|crop)/i.test(p.words);
  const body = cam?.words && !own ? `${p.words}, ${cam.words}` : p.words;
  return mode === "instruct" ? `Change her pose: ${body}. Keep her face, hair and outfit.` : `${body[0].toUpperCase()}${body.slice(1)}.`;
}

/** put the pose into the box: replaces the pose you added last time (one pose per picture — two get blended) */
export function insertPose(text: string, last: string | null, words: string): string {
  if (last && text.includes(last)) return text.replace(last, words);
  const t = text.trim();
  return t ? `${t}${/[.!?]$/.test(t) ? "" : "."} ${words}` : words;
}
