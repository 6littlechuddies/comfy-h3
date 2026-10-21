// Favourites (★): remembered across rentals with your settings.
import { create } from "zustand";
import { loadState, saveState, type FileRef } from "./api";

const key = (f: FileRef) => `${f.type}/${f.subfolder}/${f.filename}`;
export const useFavs = create<{ set: Record<string, true> }>(() => ({ set: {} }));
loadState<Record<string, true>>("favorites").then((s) => s && useFavs.setState({ set: s }));
export const isFav = (s: Record<string, true>, f: FileRef) => !!s[key(f)];
export function toggleFav(f: FileRef) {
  const cur = { ...useFavs.getState().set };
  const k = key(f);
  if (cur[k]) delete cur[k]; else cur[k] = true;
  useFavs.setState({ set: cur });
  saveState("favorites", cur).catch(() => {});
}
