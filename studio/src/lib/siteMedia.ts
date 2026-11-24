// What a character shows on your site, picked from her pictures (Catalog, right-click, Your site): her CARD (the picture on
// the grid and in chat — her cover photo), a BANNER (the explore page's wide hero), her PROFILE CAROUSEL (up to 12 pictures
// after her card) and her HOVER LOOP (the card moving, made from the card picture by itself).
import type { FileRef } from "./api";
import { useCharacters, type Character } from "./characters";
import { useJobs } from "./jobs";

const same = (a: FileRef, b: FileRef) => a.filename === b.filename && (a.subfolder ?? "") === (b.subfolder ?? "") && a.type === b.type;
const cur = (id: string): Character => { const c = useCharacters.getState().list.find((x) => x.id === id); if (!c) throw new Error("That character is gone"); return c; };
const resend = async (id: string) => { const { resendIfSent } = await import("../components/SiteLink"); const m = await resendIfSent(id); if (m) useJobs.getState().toast(m, /Couldn't/.test(m) ? "bad" : "good"); };

/** her card: the cover photo everything shows. With `pin`, she's pinned for an animated cover made from it later
 *  (Your site → Animated covers → Make the pinned ones), so the video work can wait for a multi-GPU rental */
export async function setCard(id: string, ref: FileRef, o: { pin?: boolean } = {}) {
  const { changeCover } = await import("./cover");
  await changeCover(id, ref); // also resends when she's on your site already
  if (o.pin) pinCoverVideo(id, ref);
}

/** pin her for an animated cover from this picture (her card when none is given) */
export function pinCoverVideo(id: string, from?: FileRef) {
  const c = cur(id);
  const f = from ?? c.cover ?? c.views.front;
  if (!f) return;
  useCharacters.getState().save({ ...c, site: { ...c.site, coverVideoPin: { from: f, at: Date.now() } } });
}
export const unpinCoverVideo = (id: string) => { const c = cur(id); const { coverVideoPin: _x, ...rest } = c.site ?? {}; useCharacters.getState().save({ ...c, site: rest }); };

export async function setBanner(id: string, ref: FileRef | null) {
  const c = cur(id);
  useCharacters.getState().save({ ...c, site: { ...c.site, bannerFile: ref ?? undefined } });
  useJobs.getState().toast(ref ? `${c.name}'s banner is set — it goes with her next send` : `${c.name}'s banner is cleared`, "good");
  await resend(id);
}

/** pictures in one of her premium sets, or rated explicit anywhere: never in the public carousel */
function privateOnes(c: Character): FileRef[] {
  const out: FileRef[] = [];
  for (const s of c.site?.sets ?? []) for (const it of s.items) if (it.filename && (s.tier === "premium" || it.rating === "explicit" || s.rating === "explicit")) out.push(it);
  return out;
}

/** add pictures to her profile carousel (up to 12, in the order picked); videos and private-set pictures are left out */
export async function addToCarousel(id: string, refs: FileRef[]): Promise<{ added: number; skipped: string[] }> {
  const c = cur(id);
  const have = [...(c.site?.galleryFiles ?? [])];
  const priv = privateOnes(c);
  const skipped: string[] = [];
  let added = 0;
  for (const r of refs) {
    if (/\.(mp4|webm|mov|gif)$/i.test(r.filename)) { skipped.push("a video (pictures only)"); continue; }
    if (priv.some((p) => same(p, r))) { skipped.push("a picture from a premium or explicit set"); continue; }
    if (have.some((h) => same(h, r))) continue;
    if (have.length >= 12) { skipped.push("over 12"); continue; }
    have.push(r); added++;
  }
  useCharacters.getState().save({ ...c, site: { ...c.site, galleryFiles: have } });
  const why = [...new Set(skipped)];
  useJobs.getState().toast(`${added} added to ${c.name}'s profile carousel (${have.length}/12)${why.length ? ` · left out: ${why.join(", ")}` : ""}. Everyone sees these, signed out too — no nudity.`, added ? "good" : "info");
  if (added) await resend(id);
  return { added, skipped: why };
}

export async function removeFromCarousel(id: string, ref: FileRef) {
  const c = cur(id);
  useCharacters.getState().save({ ...c, site: { ...c.site, galleryFiles: (c.site?.galleryFiles ?? []).filter((x) => !same(x, ref)) } });
}

/** whose card on your site has no animated cover yet */
export const needsLoop = (c: Character) => !c.site?.loopFile;
