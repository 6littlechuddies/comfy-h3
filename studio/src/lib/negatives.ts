// The negative prompt you actually use: the words that keep coming back in the negatives of your results (yours, and the
// CivitAI posts you recreated) — the ones in at least a quarter of them, most common first. Used to set a default.
import { useJobs } from "./jobs";

/** from every rental (the usage log on your drive), falling back to this browser's results */
export async function commonNegativesAll(min = 0.25, max = 30): Promise<{ text: string; from: number }> {
  try {
    const r = await (await fetch("/studio-api/usage")).json() as { negatives?: { word: string; uses: number }[]; negative_jobs?: number };
    const n = r.negative_jobs ?? 0;
    if (n >= 5 && r.negatives?.length) {
      const words = r.negatives.filter((x) => x.uses / n >= min).slice(0, max).map((x) => x.word);
      if (words.length) return { text: words.join(", "), from: n };
    }
  } catch { /* the browser's own results below */ }
  return commonNegatives(min, max);
}

export function commonNegatives(min = 0.25, max = 30): { text: string; from: number } {
  const negs = useJobs.getState().jobs.map((j) => (j.meta?.sent as { negative?: string } | undefined)?.negative ?? "").filter((n) => n.trim());
  const count = new Map<string, number>();
  for (const n of negs) {
    const seen = new Set<string>();
    for (const raw of n.split(/[,\n]/)) {
      const w = raw.replace(/[()[\]{}]|:\s*[\d.]+/g, "").trim().toLowerCase();
      if (w && w.length < 40 && !seen.has(w)) { seen.add(w); count.set(w, (count.get(w) ?? 0) + 1); }
    }
  }
  const words = [...count.entries()].filter(([, c]) => c / Math.max(1, negs.length) >= min).sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
  return { text: words.join(", "), from: negs.length };
}
