// A picture picked for one of Edit's boxes from somewhere else (CivitAI, the catalog…): Edit takes it when it's open.
import { create } from "zustand";
import type { Media } from "./tray";

export type EditSlot = "1" | "2" | "place";
export const useEditPick = create<{ pending: { media: Media; slot: EditSlot }[] }>(() => ({ pending: [] }));
export const putInEdit = (media: Media, slot: EditSlot) => useEditPick.setState((s) => ({ pending: [...s.pending, { media, slot }] }));

/** words picked from somewhere else (pieces of a CivitAI prompt) for Edit chat's message box */
export const useEditWords = create<{ words: string }>(() => ({ words: "" }));
export const putWordsInEdit = (w: string) => useEditWords.setState((s) => ({ words: s.words ? `${s.words} ${w}` : w }));

/** a character dropped onto Edit (from the left rail): joins the open chat as @name, with their whole sheet behind them */
export const useEditChars = create<{ ids: string[] }>(() => ({ ids: [] }));
export const putCharInEdit = (id: string) => useEditChars.setState((s) => ({ ids: [...s.ids, id] }));
