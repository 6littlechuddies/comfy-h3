import { askOutside, writerOutside } from "./outside";
import { writerFast } from "./models";
// "Change this part": the local writer rewrites one highlighted piece of a prompt from a plain-words note.
// Also: split dense prompts into labelled pieces (subject, outfit, pose, setting, lighting, camera, style…).
import { buildStage } from "./graphs";
import { bigWriterFits, useDownloads } from "./downloads";
import { useJobs, type Tab } from "./jobs";
import { activePack, fillTemplate, packText, usePacks } from "./packs";
import { newSeed } from "./settings";

const ready = (id: string) => { const g = useDownloads.getState().groups.find((x) => x.id === id); return !g || g.state === "done"; };
const known = (id: string) => useDownloads.getState().groups.some((x) => x.id === id);
/** why the rewriter can't run, or undefined */
export function rewriteWhy(): string | undefined {
  if (ready("writer") || (known("writer_xl") && ready("writer_xl"))) return undefined;
  return "The prompt writer is still downloading";
}

/** run the rewriter and wait for its answer */
export async function rewritePart(tab: Tab, prompt: string, part: string, change: string): Promise<string> {
  const outside = writerOutside();
  const why = rewriteWhy();
  if (why && !outside) throw new Error(why);
  if (!usePacks.getState().loaded) await usePacks.getState().load();
  const pack = activePack("tweak");
  if (!pack) throw new Error("No prompt file for rewriting");
  if (outside) {
    // "Grok tab · copy & paste": Grok can't see the pictures, but the references' written looks go along
    const c0 = await rewriteContext(tab, `${part} ${change}`);
    const inp = fillTemplate(pack.template || usePacks.getState().templates.tweak, { prompt, part, change: c0.text ? `${change}\n\n${c0.text}` : change });
    const ans = await askOutside("Rewriting part of the prompt", await packText(pack.id), inp);
    if (ans !== null) return ans;
    if (why) throw new Error(why);
  }
  // the 27B when it's in (unless you chose the fast 9B everywhere), else the 9B
  const big = ready("writer_xl") && (!ready("writer") || (!writerFast() && bigWriterFits()));
  const ctx = await rewriteContext(tab, `${part} ${change}`);
  const input = fillTemplate(pack.template || usePacks.getState().templates.tweak, { prompt, part, change: ctx.text ? `${change}\n\n${ctx.text}` : change });
  const graph = buildStage({ promptFile: pack.prompt_file, promptChars: pack.chars, input, params: { ...pack.params, max_tokens: Math.max(pack.params.max_tokens || 0, 900) }, images: ctx.images, big, seed: newSeed(), thinking: pack.thinking, timeout: 240 });
  const job = await useJobs.getState().run(tab, "Rewriting part of the prompt", graph, `tweak:${big ? "big" : "small"}`, { kind: "tweak" });
  return new Promise((resolve, reject) => {
    const check = () => {
      const j = useJobs.getState().jobs.find((x) => x.id === job.id);
      if (!j) return false;
      if (j.status === "done") { resolve((j.texts.out ?? "").trim().replace(/^["“]|["”]$/g, "")); return true; }
      if (j.status === "error" || j.status === "cancelled") {
        const slow = /timed out/i.test(j.error || "");
        reject(new Error(slow ? "The writer took over 4 minutes and was stopped — usually the GPU was full. Try again (it now frees the GPU first)." : j.error || "Cancelled"));
        return true;
      }
      return false;
    };
    if (check()) return;
    const unsub = useJobs.subscribe(() => { if (check()) unsub(); });
  });
}

/** who "picture 1" / "character 1" / a character's name is: the references in this tab (their tags, labels and, for saved
 *  characters, their written look), plus the pictures themselves so the writer can look at them */
async function rewriteContext(tab: Tab, asked: string): Promise<{ text: string; images: string[] }> {
  const [{ useWork, tagsFor }, { useCharacters, looks }] = await Promise.all([import("./work"), import("./characters")]);
  const w = useWork.getState();
  const refs = tab === "animate" ? w.animateRefs : tab === "prompt" ? w.promptRefs : [];
  const tags = tagsFor(refs);
  const chars = useCharacters.getState();
  const lines: string[] = [];
  const seen = new Set<string>();
  let n = 0;
  for (const r of refs) {
    const c = r.charId ? chars.list.find((x) => x.id === r.charId) : undefined;
    if (c && !seen.has(c.id)) {
      seen.add(c.id); n++;
      const theirs = refs.filter((x) => x.charId === c.id).map((x) => tags[x.id]).join(", ");
      lines.push(`Character ${n} = ${c.name}, shown in ${theirs}. ${c.name}'s look: ${looks(c)}`);
    } else if (!c) lines.push(`${tags[r.id]} = ${r.label || r.media.kind}${r.media.kind === "image" ? " (picture attached)" : ""}`);
  }
  // a character named in the note but not in the references (e.g. "make her look like Rin")
  const low = asked.toLowerCase();
  for (const c of chars.list) if (!seen.has(c.id) && c.name && low.includes(c.name.toLowerCase())) { seen.add(c.id); lines.push(`${c.name}'s look: ${looks(c)}`); }
  if (!lines.length) return { text: "", images: [] };
  const images = refs.filter((r) => r.media.kind === "image").slice(0, 4).map((r) => r.media.name);
  return {
    text: `REFERENCES (what "picture 1", "character 1" or a name in the note means — the first attached image is <Picture 1>, and so on):\n${lines.join("\n")}\nWhen the note asks to match a picture or character, write their actual look into the part (hair, eyes, face, body, outfit) and keep their tag; otherwise leave the references alone.`,
    images,
  };
}

// ------------------------------------------------------------------ pieces
export type PieceCat = "quality" | "subject" | "look" | "outfit" | "pose" | "expression" | "setting" | "lighting" | "camera" | "style" | "lora" | "other";
export const CAT_LABEL: Record<PieceCat, string> = {
  quality: "Quality", subject: "Who", look: "Looks", outfit: "Outfit", pose: "Pose & action", expression: "Expression",
  setting: "Setting", lighting: "Lighting", camera: "Camera & framing", style: "Style", lora: "LoRAs", other: "Other",
};
export const CAT_ORDER: PieceCat[] = ["subject", "look", "outfit", "pose", "expression", "setting", "lighting", "camera", "style", "quality", "lora", "other"];
/** the parts "Copy style" takes */
export const STYLE_CATS: PieceCat[] = ["lighting", "camera", "style", "quality"];

const RULES: [PieceCat, RegExp][] = [
  ["lora", /^<lora:|^embedding:|^<hypernet/i],
  ["quality", /\b(masterpiece|best quality|high quality|highres|absurdres|very aesthetic|aesthetic|newest|score_\d|ultra.?detailed|highly detailed|detailed|8k|4k|hdr|uhd|sharp focus|worst quality|low quality|lowres|amazing quality|great quality|year 20\d\d)\b/i],
  ["subject", /\b(\d+\s?(girl|boy|other)s?|solo|multiple (girls|boys)|couple|woman|man|female|male|adult|mature|person|people|character)\b/i],
  ["camera", /\b(close.?up|full body|upper body|lower body|cowboy shot|portrait|from (above|below|behind|side)|pov|dutch angle|wide shot|medium shot|long shot|angle|lens|\d+mm|depth of field|bokeh|blurry background|focus|framing|composition|shot|camera|selfie|looking at viewer|viewer|centered|symmetr)/i],
  ["lighting", /\b(light|lighting|lit|sunlight|sunset|sunrise|golden hour|neon|glow|shadow|backlight|rim light|volumetric|dark|night|moonlight|candle|flash|soft light|hard light|studio light|cinematic lighting|chiaroscuro)\b/i],
  ["style", /\b(anime|manga|realistic|photorealistic|photo|photograph|cinematic|film|analog|illustration|painting|oil|watercolor|sketch|lineart|cel shad|3d|render|style|art by|by [a-z]|artist|aesthetic|retro|vintage|digital art|concept art|grain|vibrant|pastel|monochrome|greyscale)\b/i],
  ["expression", /\b(smile|smiling|grin|blush|open mouth|closed mouth|tongue|wink|crying|tears|angry|sad|happy|surprised|expression|serious|smirk|pout|laugh|frown|ahegao|seductive|shy|embarrass|parted lips|half.?closed eyes|closed eyes)\b/i],
  ["outfit", /\b(dress|shirt|t-shirt|blouse|skirt|pants|jeans|shorts|jacket|coat|hoodie|sweater|uniform|bikini|swimsuit|lingerie|bra|panties|underwear|stockings|thighhighs|pantyhose|socks|boots|shoes|heels|sneakers|gloves|hat|cap|glasses|choker|necklace|earrings|jewelry|scarf|tie|belt|apron|kimono|armor|costume|outfit|clothes|clothing|wearing|nude|naked|topless|bodysuit|leotard|corset|cape|hood|mask|collar|sleeve|sleeveless|bare shoulders|cleavage)\b/i],
  ["look", /\b(hair|bangs|ponytail|twintails|braid|bun|eyes|eyebrows|eyelashes|lips|skin|tan|pale|freckles|mole|scar|tattoo|piercing|breasts|chest|abs|muscular|slim|thin|curvy|thick|petite|tall|short|body|figure|face|ears|tail|wings|horns|makeup|nails|lipstick)\b/i],
  ["pose", /\b(standing|sitting|lying|kneeling|squatting|walking|running|jumping|dancing|leaning|bending|crouching|arms|hands?|legs?|spread|crossed|holding|pose|posing|reaching|hugging|stretching|on back|on stomach|all fours|turning|looking (back|away|up|down|at)|head tilt|from behind|hand on)\b/i],
  ["setting", /\b(background|outdoors|indoors|room|bedroom|bathroom|kitchen|office|street|city|forest|beach|ocean|sea|sky|clouds|park|school|classroom|cafe|bar|club|stage|studio|garden|field|mountain|river|rain|snow|water|pool|car|train|window|bed|couch|sofa|chair|table|wall|floor|building|alley|rooftop|night city|landscape|scenery|interior|simple background|white background)\b/i],
];

export interface Piece { id: string; text: string; cat: PieceCat }
let n = 0;
export const pid = () => `p${Date.now().toString(36)}${n++}`;
export function categorize(t: string): PieceCat {
  for (const [cat, re] of RULES) if (re.test(t)) return cat;
  return "other";
}
/** tag prompts split on commas (not inside brackets); sentence prompts split into sentences */
export function isTagPrompt(p: string): boolean {
  const parts = splitTop(p, ",");
  return parts.length >= 4 && parts.reduce((a, x) => a + x.trim().split(/\s+/).length, 0) / parts.length <= 4.5;
}
function splitTop(p: string, sep: string): string[] {
  const out: string[] = []; let depth = 0, cur = "";
  for (const ch of p) {
    if ("([{<".includes(ch)) depth++;
    if (")]}>".includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
export function toPieces(p: string): Piece[] {
  const clean = p.replace(/\s*\bBREAK\b\s*/g, ", ").replace(/\n+/g, ", ");
  const parts = isTagPrompt(clean) ? splitTop(clean, ",")
    // sentences; a long sentence with a comma list ("…at night, rain, cinematic lighting") splits at its commas, keeping them
    : clean.split(/(?<=[.!?])\s+(?=[A-Z<(])/).flatMap((s) => {
      const bits = splitTop(s, ",");
      return s.length > 70 && bits.length >= 3 ? bits.map((b, i) => (i < bits.length - 1 ? `${b},` : b)) : [s];
    }).map((s) => s.trim()).filter(Boolean);
  return parts.map((text) => ({ id: pid(), text, cat: categorize(text) }));
}
export function fromPieces(ps: Piece[], tags: boolean): string {
  if (tags) return ps.map((x) => x.text.replace(/[,\s]+$/, "")).join(", ");
  // a removed piece can leave "…, ." or a trailing comma behind
  return ps.map((x) => x.text.trim()).join(" ").replace(/\s+([,.])/g, "$1").replace(/,+([.!?])/g, "$1").replace(/,{2,}/g, ",").replace(/,\s*$/, "");
}
/** (tag:1.2) style weights for tag prompts */
export function reweight(t: string, delta: number): string {
  const m = t.match(/^\((.+):(\d*\.?\d+)\)$/);
  const base = m ? m[1] : t.replace(/^\((.+)\)$/, "$1");
  const w = Math.round(((m ? Number(m[2]) : 1) + delta) * 10) / 10;
  return Math.abs(w - 1) < 0.01 ? base : `(${base}:${Math.max(0.1, Math.min(2, w))})`;
}
