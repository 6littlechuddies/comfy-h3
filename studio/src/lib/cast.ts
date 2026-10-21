// Who is in the picture: your character alone (the default), with one man, with one woman, or a group. Said the way each
// model understands it — Danbooru count tags for anime (1girl, solo / 1girl, 1boy / 2girls), a plain sentence for Krea 2,
// and "the woman in this picture" (not "the person") in edit instructions, so the edit knows which one to replace.
export type Cast = "solo" | "plusMan" | "plusWoman" | "group";
export type Gender = "female" | "male" | "other";

export const CAST_OPTIONS: { value: Cast; label: string }[] = [
  { value: "solo", label: "Just one person" },
  { value: "plusMan", label: "+ one man" },
  { value: "plusWoman", label: "+ one woman" },
  { value: "group", label: "A group" },
];

export const nounOf = (g: Gender) => (g === "male" ? "man" : g === "female" ? "woman" : "person");

/** Danbooru count tags for the cast, the main person first */
export function castTags(g: Gender, cast: Cast = "solo"): string {
  const me = g === "male" ? "1boy" : g === "female" ? "1girl" : "1other";
  if (cast === "solo") return `${me}, solo`;
  if (cast === "plusMan") return g === "male" ? "2boys" : `${me}, 1boy`;
  if (cast === "plusWoman") return g === "female" ? "2girls" : `${me}, 1girl`;
  return g === "male" ? "multiple boys, group" : "multiple girls, group";
}

const COUNT_TAG = /^(\d\+?\s?(girls?|boys?|others?)|solo|solo focus|multiple (girls|boys|others)|group|couple)$/i;
/** take count tags out of a tag list (they're set once, from the cast) */
export function stripCountTags(tags: string): string {
  return tags.split(",").map((x) => x.trim()).filter((x) => x && !COUNT_TAG.test(x)).join(", ");
}

/** one sentence for Krea 2 */
export function castSentence(g: Gender, cast: Cast = "solo"): string {
  const n = nounOf(g);
  if (cast === "solo") return `Exactly one person in the picture: the ${n}, alone — no one else.`;
  if (cast === "plusMan") return `Exactly two people: the ${n} and one adult man.`;
  if (cast === "plusWoman") return `Exactly two people: the ${n} and one adult woman.`;
  return `A small group of adults, with the ${n} as the main subject.`;
}

/** the last line of an edit instruction */
export function castEditLine(g: Gender, cast: Cast = "solo", keepOthers = true): string {
  const n = nounOf(g);
  if (cast === "solo") return `Only one person in the result: the ${n}. Everyone is an adult.`;
  return `${keepOthers ? "Keep the other people in this picture as they are, in their places." : `The ${n} is the main subject.`} Everyone is an adult.`;
}
