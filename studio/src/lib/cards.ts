// How many graphics cards this rental works with (start.sh runs one ComfyUI per card behind a router when there are several)
// and whether H3 videos can be split across them with Raylight. One card: { cards: 1 } and nothing changes.
import { create } from "zustand";

export const useCards = create<{ cards: number; raylight: boolean }>(() => ({ cards: 1, raylight: false }));
async function check() {
  try {
    const r = await fetch("/h3-router", { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    if (typeof d?.cards === "number") useCards.setState({ cards: d.cards, raylight: !!d.raylight });
  } catch { /* one card: there's no router */ }
}
check();
setInterval(check, 60_000);

/** cards a single H3 video is split across: a power of two (the sequence splits evenly), at most 8; 1 = not split */
export function rayCards(): number {
  const { cards, raylight } = useCards.getState();
  if (!raylight || cards < 2) return 1;
  return cards >= 8 ? 8 : cards >= 4 ? 4 : 2;
}
