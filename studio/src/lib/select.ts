// Picking several results at once (tick the corner of a picture, Shift+click for a run of them) — the floating bar then
// does one thing to all of them.
import { create } from "zustand";
import type { Job, Output, Tab } from "./jobs";
import { trayIdOf } from "./tray";

export interface Picked { o: Output; j: Job }
interface SelState {
  tab: Tab | null;
  items: Record<string, Picked>;
  /** the last one ticked: Shift+click picks everything between it and the next */
  anchor: string | null;
  /** "Select" pressed: clicking a picture ticks it instead of opening it */
  mode: boolean;
  start: (tab: Tab) => void;
  toggle: (tab: Tab, it: Picked) => void;
  setMany: (tab: Tab, its: Picked[], on: boolean) => void;
  clear: () => void;
}
export const pickKey = (o: Output) => trayIdOf(o);
export const useSelect = create<SelState>((set, get) => ({
  tab: null, items: {}, anchor: null, mode: false,
  start: (tab) => set({ tab, mode: true, items: get().tab === tab ? get().items : {} }),
  toggle: (tab, it) => {
    const k = pickKey(it.o);
    const items = get().tab === tab ? { ...get().items } : {};
    if (items[k]) delete items[k]; else items[k] = it;
    set({ tab, items, anchor: k });
  },
  setMany: (tab, its, on) => {
    const items = get().tab === tab ? { ...get().items } : {};
    for (const it of its) { const k = pickKey(it.o); if (on) items[k] = it; else delete items[k]; }
    set({ tab, items, anchor: its.length ? pickKey(its[its.length - 1].o) : get().anchor });
  },
  clear: () => set({ items: {}, anchor: null, mode: false }),
}));
