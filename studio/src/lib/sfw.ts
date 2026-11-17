// "Make it SFW": a nude or revealing picture redrawn fully clothed by Krea 2 Edit, in an outfit that matches the
// character's own (their outfit words), or a plain everyday one. The face, body, pose, background and light stay.
import { useJobs } from "./jobs";
import { useSettings, newSeed, editArgs } from "./settings";
import { useCharacters, type Character } from "./characters";
import type { Media } from "./tray";

export function sfwInstruction(c?: Character | null): string {
  const outfit = (c?.outfit || "").trim();
  const wear = outfit ? `her own outfit: ${outfit}` : "a casual everyday outfit that suits her style (a fitted top and jeans or a skirt)";
  return `Make this photo safe for work. Dress the person in ${wear}, so she is fully clothed: nothing see-through, no exposed breasts, nipples or genitals, no lingerie. ` +
    "Keep exactly the same face, hair, body shape, pose, hands, expression, camera angle, background and lighting — only the clothing changes, and it fits her body naturally.";
}

/** queue the SFW version of one picture (Krea 2 Edit, the picture as picture 1) */
export async function makeSfw(m: Media, c?: Character | null, opts: { tab?: string; meta?: Record<string, unknown> } = {}) {
  const ch = c ?? useCharacters.getState().list.find((x) => x.id === useCharacters.getState().sel) ?? null;
  const { buildEdit } = await import("./graphs");
  const ed = useSettings.getState().s.edit;
  const g = buildEdit({ ...editArgs(ed, "krea"), seed: newSeed(), images: [m.name], instruction: sfwInstruction(ch), negative: "", resolution: 1448, prefix: "studio/edit/sfw" } as never);
  return useJobs.getState().run((opts.tab ?? "edit") as never, `SFW version${ch ? ` · ${ch.name}` : ""}`, g as never, "edit:krea:1:raw", { before: m.url, ...(opts.meta ?? {}) });
}
