// Which CivitAI posts you've already used, and how — so a collection shows "RECREATED · ANIMATED · SWAPPED" on the posts
// you've done and you don't redo one by accident. Kept on the rental (state/civit_used.json, backed up with the rest),
// so every browser and every new rental sees the same marks.
import { create } from "zustand";
import { loadState, saveState } from "./api";

export type UseKind = "recreate" | "animate" | "swap" | "create";
export interface PostUse { kind: UseKind; at: number; chars: string[]; n: number }
type Uses = Record<string, Partial<Record<UseKind, PostUse>>>;

export const USE_LABEL: Record<UseKind, string> = { recreate: "RECREATED", animate: "ANIMATED", swap: "SWAPPED", create: "IN CREATE" };

export const useCivitUsed = create<{ uses: Uses; loaded: boolean }>(() => ({ uses: {}, loaded: false }));
let saveT: number | undefined;
let ready: Promise<void> | null = null;
export function loadCivitUsed() {
  if (!ready) ready = loadState<Uses>("civit_used").then((u) => { useCivitUsed.setState((s) => ({ uses: { ...(u ?? {}), ...s.uses }, loaded: true })); }).catch(() => { useCivitUsed.setState({ loaded: true }); });
  return ready;
}

/** note that these posts were used: one call per press (n = how many pictures/videos it made of each) */
export async function noteUsed(ids: (number | string)[], kind: UseKind, chars: (string | null | undefined)[] = [], n = 1) {
  await loadCivitUsed();
  const who = [...new Set(chars.filter((x): x is string => !!x))];
  useCivitUsed.setState((s) => {
    const uses = { ...s.uses };
    for (const raw of ids) {
      const id = String(raw);
      if (!/^\d+$/.test(id)) continue;
      const cur = uses[id]?.[kind];
      uses[id] = { ...uses[id], [kind]: { kind, at: Date.now(), chars: [...new Set([...(cur?.chars ?? []), ...who])], n: (cur?.n ?? 0) + n } };
    }
    return { uses };
  });
  window.clearTimeout(saveT);
  saveT = window.setTimeout(() => { saveState("civit_used", useCivitUsed.getState().uses).catch(() => {}); }, 800);
}

/** the CivitAI post a tray picture or clip came from ("CivitAI 12345"), if any */
export const civitIdOfLabel = (label?: string | null) => { const m = /^CivitAI (\d+)$/.exec(label ?? ""); return m ? Number(m[1]) : null; };

/** "Recreated ×4 for Mei · 14 Nov" — one line per way it was used */
export function usedLines(id: number | string, nameOf: (charId: string) => string | undefined): string[] {
  const u = useCivitUsed.getState().uses[String(id)];
  if (!u) return [];
  return (Object.values(u) as PostUse[]).sort((a, b) => b.at - a.at).map((x) => {
    const names = x.chars.map(nameOf).filter(Boolean);
    return `${USE_LABEL[x.kind].charAt(0)}${USE_LABEL[x.kind].slice(1).toLowerCase()} ×${x.n}${names.length ? ` for ${names.join(", ")}` : ""} · ${new Date(x.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  });
}
