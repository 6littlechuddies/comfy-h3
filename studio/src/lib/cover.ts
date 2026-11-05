// One way to change a character's cover photo, from anywhere (right-click on a picture, Characters tab, upload): it's
// kept with their pictures, shows everywhere they appear, and your site gets it too when they're already on it.
import type { FileRef } from "./api";
import { useCharacters } from "./characters";
import { useJobs } from "./jobs";

export async function changeCover(id: string, file: FileRef | null): Promise<void> {
  const st = useCharacters.getState();
  const c = st.list.find((x) => x.id === id);
  if (!c) throw new Error("That character is gone");
  await st.setCover(id, file);
  const toast = useJobs.getState().toast;
  toast(file ? `${c.name}'s new cover photo is in` : `${c.name} shows their own picture again`, "good");
  const { resendIfSent } = await import("../components/SiteLink");
  const msg = await resendIfSent(id);
  if (msg) toast(msg, /Couldn't/.test(msg) ? "bad" : "good");
}
