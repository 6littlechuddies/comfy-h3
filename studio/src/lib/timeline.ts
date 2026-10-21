// The Prompt helper's timeline: parsed from the writer's lines, edited by you, turned into the H3 prompt.
export interface Cut { id: string; start: number; end: number; shot: string; text: string }
export interface Say { id: string; at: number; who: string; voice: string; words: string }
export interface Sound { id: string; start: number; end: number; text: string }
export interface Timeline { cuts: Cut[]; says: Say[]; sounds: Sound[]; style: string }

let n = 0;
export const uid = () => `t${Date.now().toString(36)}${(n++).toString(36)}`;

export function parseTime(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)s?$/);
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}
export function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round((s - m * 60) * 10) / 10;
  const whole = Number.isInteger(r) ? String(r).padStart(2, "0") : r.toFixed(1).padStart(4, "0");
  return `${m}:${whole}`;
}

/** parse "CUT | 0:00 | 0:05 | shot | text" style lines; tolerant of bullets, brackets, stray text, a "0:00-0:05" range
 *  in one field, and a cut's description running on over several lines (those lines join the cut instead of being lost) */
export function parseTimeline(raw: string, seconds: number): Timeline {
  const t: Timeline = { cuts: [], says: [], sounds: [], style: "" };
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  let last: Cut | Sound | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s>*\-•]+/, "").replace(/^\d+[.)]\s+/, "").trim();
    if (!line) continue;
    let parts = line.split("|").map((p) => p.trim());
    const tag = parts[0]?.toUpperCase().replace(/[^A-Z]/g, "");
    // "CUT | 0:00-0:05 | shot | text" → split the range into two fields
    const range = parts[1]?.match(/^(\d[\d:.]*s?)\s*[–—-]\s*(\d[\d:.]*s?)$/);
    if (range && (tag === "CUT" || tag === "SOUND")) parts = [parts[0], range[1], range[2], ...parts.slice(2)];
    if (tag === "CUT" && parts.length >= 4) {
      const s = parseTime(parts[1]), e = parseTime(parts[2]);
      if (s != null && e != null) {
        const c = { id: uid(), start: s, end: e, shot: parts.length >= 5 ? parts[3] : "", text: (parts.length >= 5 ? parts.slice(4) : parts.slice(3)).join(" | ") };
        t.cuts.push(c); last = c; continue;
      }
    } else if (tag === "SAY" && parts.length >= 5) {
      const a = parseTime(parts[1]);
      if (a != null) { t.says.push({ id: uid(), at: a, who: parts[2], voice: /none/i.test(parts[3]) ? "" : parts[3], words: parts.slice(4).join(" | ").replace(/^["“]|["”]$/g, "") }); last = null; continue; }
    } else if (tag === "STYLE" && parts.length >= 2) {
      t.style = parts.slice(1).join(" | "); last = null; continue;
    } else if (tag === "SOUND" && parts.length >= 4) {
      const s = parseTime(parts[1]), e = parseTime(parts[2]);
      if (s != null && e != null) { const so = { id: uid(), start: s, end: e, text: parts.slice(3).join(" | ") }; t.sounds.push(so); last = so; continue; }
    }
    // not a tagged line: it carries on the cut (or sound) above it
    if (last && !/^(CUT|SAY|SOUND|STYLE)\b/i.test(line)) last.text = `${last.text} ${line}`.trim();
  }
  return normalise(t, seconds);
}

/** cuts sorted, clamped to the video and made contiguous (no gaps/overlaps) */
export function normalise(t: Timeline, seconds: number): Timeline {
  const cuts = [...t.cuts].sort((a, b) => a.start - b.start).map((c) => ({ ...c }));
  if (!cuts.length) cuts.push({ id: uid(), start: 0, end: seconds, shot: "", text: "" });
  cuts[0].start = 0;
  for (let i = 0; i < cuts.length; i++) {
    if (i > 0) cuts[i].start = cuts[i - 1].end;
    cuts[i].end = i === cuts.length - 1 ? seconds : Math.min(seconds, Math.max(cuts[i].start + 0.5, cuts[i].end));
  }
  const clamp = (v: number) => Math.min(seconds, Math.max(0, v));
  return {
    ...t,
    cuts: cuts.filter((c) => c.end - c.start > 0.05),
    says: t.says.map((s) => ({ ...s, at: clamp(s.at) })).sort((a, b) => a.at - b.at),
    sounds: t.sounds.map((s) => ({ ...s, start: clamp(s.start), end: clamp(Math.max(s.start, s.end)) })),
  };
}

/** the final H3 prompt text */
export function toPrompt(t: Timeline): string {
  const out: string[] = [];
  if (t.style.trim()) out.push(t.style.trim());
  const multi = t.cuts.length > 1;
  t.cuts.forEach((c, i) => {
    const head = multi ? `CUT ${i + 1} (${fmt(c.start)}–${fmt(c.end)})` : `(${fmt(c.start)}–${fmt(c.end)})`;
    out.push(`${head}${c.shot ? `, ${c.shot}` : ""}: ${c.text}`.trim());
    for (const s of t.says.filter((s) => s.at >= c.start && (s.at < c.end || (i === t.cuts.length - 1 && s.at <= c.end))))
      out.push(`At ${fmt(s.at)}, ${s.who || "they"} ${s.voice ? `says in the voice of ${s.voice}` : "says"}: "${s.words}"`);
  });
  if (t.sounds.length)
    out.push("Sound: " + t.sounds.map((s) => `${s.text} (${fmt(s.start)}–${fmt(s.end)})`).join("; ") + ".");
  return out.join("\n");
}

/** move the boundary between cut i and i+1 */
export function moveBoundary(t: Timeline, i: number, at: number): Timeline {
  const cuts = t.cuts.map((c) => ({ ...c }));
  const a = cuts[i], b = cuts[i + 1];
  if (!a || !b) return t;
  const v = Math.round(Math.min(b.end - 0.5, Math.max(a.start + 0.5, at)) * 10) / 10;
  a.end = v; b.start = v;
  return { ...t, cuts };
}
