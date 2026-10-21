// Before → after, word by word: new words highlighted, removed words struck through.
import { useMemo } from "react";

type Part = { t: string; k: "same" | "add" | "del" };

export function diffWords(a: string, b: string): Part[] {
  const A = a.split(/(\s+)/).filter((x) => x !== "");
  const B = b.split(/(\s+)/).filter((x) => x !== "");
  if (A.length * B.length > 600_000) return [{ t: a, k: "del" }, { t: " ", k: "same" }, { t: b, k: "add" }];
  const norm = (s: string) => s.toLowerCase().replace(/[.,;:!?"“”()]/g, "");
  const n = A.length, m = B.length;
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = norm(A[i]) === norm(B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Part[] = [];
  const push = (t: string, k: Part["k"]) => { const last = out[out.length - 1]; if (last && last.k === k) last.t += t; else out.push({ t, k }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (norm(A[i]) === norm(B[j])) { push(B[j], "same"); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { if (/\S/.test(A[i])) push(A[i], "del"); else push(A[i], "same"); i++; }
    else { push(B[j], /\S/.test(B[j]) ? "add" : "same"); j++; }
  }
  while (i < n) { if (/\S/.test(A[i])) push(A[i], "del"); i++; }
  while (j < m) { push(B[j], /\S/.test(B[j]) ? "add" : "same"); j++; }
  return out;
}

/** shows `after`, with what's new highlighted and (optionally) what's gone struck through */
export function WordDiff({ before, after, showRemoved = true, className }: { before: string; after: string; showRemoved?: boolean; className?: string }) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  return (
    <span className={className}>
      {parts.map((p, i) => p.k === "same" ? <span key={i}>{p.t}</span>
        : p.k === "add" ? <mark key={i} className="bg-good/25 text-ink">{p.t}</mark>
        : showRemoved ? <del key={i} className="text-bad/80 decoration-bad/70">{p.t} </del> : null)}
    </span>
  );
}

export function diffCount(before: string, after: string) {
  const parts = diffWords(before, after);
  const words = (k: Part["k"]) => parts.filter((p) => p.k === k).reduce((n, p) => n + p.t.trim().split(/\s+/).filter(Boolean).length, 0);
  return { added: words("add"), removed: words("del") };
}
