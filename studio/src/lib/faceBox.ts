// Pure helpers for the face pass (no browser code, so they can be tested on their own).
export interface Box { x: number; y: number; width: number; height: number; score: number }

/** the boxes SAM 3 printed, whatever shape the text came in ([{'x': 1, …}] with Python quotes, or JSON, nested per frame) */
export function parseBoxes(text: string): Box[] {
  const out: Box[] = [];
  const re = /\{[^{}]*\}/g;
  for (const m of text.match(re) ?? []) {
    const num = (k: string) => { const r = m.match(new RegExp(`["']?${k}["']?\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`)); return r ? Number(r[1]) : NaN; };
    const b = { x: num("x"), y: num("y"), width: num("width"), height: num("height"), score: num("score") };
    if ([b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width > 8 && b.height > 8) out.push({ ...b, score: Number.isFinite(b.score) ? b.score : 1 });
  }
  return out;
}

/** a square window around the face, with room for hair and chin, kept inside the picture (whole pixels) */
export function faceWindow(b: Box, W: number, H: number, context = 2.1) {
  const side = Math.round(Math.min(Math.min(W, H), Math.max(256, Math.max(b.width, b.height) * context)));
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const x = Math.round(Math.min(Math.max(0, cx - side / 2), W - side));
  const y = Math.round(Math.min(Math.max(0, cy - side / 2), H - side));
  return { x, y, width: side, height: side };
}

