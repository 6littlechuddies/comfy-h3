// The edit chat's rules, in plain code with no browser parts (so they can be tested on their own): which route a message
// takes, and how @names become the words each model understands.
export type Route = "krea" | "part" | "background" | "hybrid";
export type Engine = "auto" | "krea" | "hybrid";
export interface ChatPic { key: string; name: string; url: string; label: string; charId?: string }

const PARTS = /\b((?:her|his|their|the)\s+)?((?:left|right)\s+)?(hands?|fingers?|arms?|legs?|feet|foot|shoes?|boots?|face|eyes|mouth|lips|teeth|tongue|hair|top|shirt|t-?shirt|blouse|sweater|hoodie|jacket|coat|dress|skirt|pants|jeans|shorts|bra|bikini|lingerie|necklace|earrings?|glasses|sunglasses|hat|cap|bag|phone|cup|clothes|clothing|outfit)\b/i;
const EXPRESSION = /\b(smile|smiling|grin|frown|laugh(?:ing)?|wink(?:ing)?|pout(?:ing)?|blush(?:ing)?|cry(?:ing)?|eyes? (?:open|closed|shut)|close (?:her|his|their) eyes|open (?:her|his|their) eyes|expression|look (?:happy|sad|angry|surprised|shy|serious)|tongue|bite (?:her|his) lip)\b/i;
const BACKGROUND = /\b(background|backdrop|scenery|setting|surroundings|behind (?:her|him|them))\b/i;
export const BIG = /\b(pose|posing|sit|sitting|sits|seated|stand|standing|stands|kneel|lie down|kneel(?:ing|s)?|lying|lies|laying|crouch(?:ing)?|squat(?:ting)?|turn(?:s|ed|ing)? around|from behind|walking|jumping|leaning|bending|replace|swap|put .* in(?:to)?|instead of|whole|full body|camera angle|zoom)\b/i;

/** which route a message takes (and why, in a few words shown under it) */
export function routeOf(text: string, refs: ChatPic[], engine: Engine, qwenReady: boolean): { route: Route; note: string; part?: string } {
  const chars = refs.filter((r) => r.charId);
  const others = refs.filter((r) => !r.charId);
  // the words without the @names ("@sweater" is a picture, not the part to redraw)
  const plain = text.replace(/@[a-z0-9]+/gi, " ");
  const keepBg = /\b(keep|same|don'?t (?:change|touch)|leave)\b[^.,;]{0,30}\b(background|backdrop|setting|scenery)\b/i.test(plain);
  // only a new background when the place is the one other picture — with a second person or reference too, it's a bigger job
  const bg = BACKGROUND.test(plain) && !keepBg && !chars.length && others.length <= 1;
  const m = plain.match(PARTS);
  // a face change in plain words ("make her smile", "close her eyes", "put her tongue away") is a face-only edit
  const expr = !m && EXPRESSION.test(plain);
  const part = (m || expr) && !chars.length && !BIG.test(plain) && others.length <= 1
    ? expr ? "face" : /(clothes|clothing|outfit)/i.test(m![3]) ? "clothing" : /tongue|teeth|lips/i.test(m![3]) ? "mouth" : m![0].trim() : undefined;
  if (bg) return { route: "background", note: others.length ? "new background from the picture you named — the person stays as they are" : "new background — the person stays as they are" };
  if (part) return { route: "part", note: `only “${part}” changes (SAM 3 outlines it)`, part };
  // a picture to take something from (a sweater, shoes) is a bigger job than Krea's two-picture edit does well
  const big = chars.length > 0 || refs.length >= 2 || BIG.test(plain) || others.length > 0;
  const wantHybrid = engine === "hybrid" || (engine === "auto" && big);
  if (wantHybrid && qwenReady) return { route: "hybrid", note: `Qwen-Image-Edit makes the change, Krea 2 repaints it${chars.length ? ", then the face pass" : ""}${refs.length > 2 ? " — Qwen takes 3 pictures, so the first two you named are used" : ""}` };
  if (wantHybrid && engine === "hybrid") return { route: "hybrid", note: "Qwen + Krea (needs the Edit chat helper models)" };
  return { route: "krea", note: refs.length > 1 ? "Krea 2 Edit — it takes the picture + one reference, so only the first one named is used" : "Krea 2 Edit" };
}

export const order = (canvas: ChatPic, refs: ChatPic[]) => [canvas, ...refs.filter((r) => r.name !== canvas.name)];
/** @names → what each model calls the pictures: Qwen "Picture 1/2/3", Krea "this picture" / "picture 2" */
export function wordsFor(text: string, pics: ChatPic[], ordered: ChatPic[], model: "qwen" | "krea"): string {
  return text.replace(/@([a-z0-9]+)/gi, (all, k: string) => {
    const p = pics.find((x) => x.key === k.toLowerCase());
    const i = p ? ordered.findIndex((x) => x.name === p.name) : -1;
    if (!p || i < 0) return p ? p.label : all;
    const name = p.charId ? p.label : "";
    if (model === "qwen") return name ? `${name} (Picture ${i + 1})` : `Picture ${i + 1}`;
    if (i === 0) return "this picture";
    return name ? `${name}, the person from picture ${i + 1}` : `picture ${i + 1}`;
  });
}
