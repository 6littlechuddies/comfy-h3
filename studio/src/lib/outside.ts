// "Grok tab · copy & paste" writer: instead of the local writer, the Studio builds the whole request (the prompt file's
// rules + what to write), you paste it into Grok (or any chatbot) in your own browser tab, and paste the answer back.
// No API keys and no browser automation. Requests that arrive together (a Batch "Write prompts") are copied as ONE
// message with numbered requests, and the one pasted answer is split back by its "### ANSWER n" headings.
import { create } from "zustand";
import { WRITER_KEY } from "./models";

export const writerOutside = () => { try { return localStorage.getItem(WRITER_KEY) === "outside"; } catch { return false; } };

/** let the connected Grok tab look at pictures too (pose reading, face checks, describing a picture) */
export const grokSees = () => { try { return localStorage.getItem("h3.grokSees") !== "off"; } catch { return true; } };
export interface OutsideReq {
  id: number; label: string; rules: string; input: string;
  /** pictures (input-folder names) the connected Grok tab attaches to this request */
  images?: string[];
  /** string = the answer; null = use the local writer for this one */
  resolve: (v: string | null) => void; reject: (e: Error) => void;
}
export const useOutside = create<{ reqs: OutsideReq[] }>(() => ({ reqs: [] }));
let nextId = 1;

/** ask your Grok tab; resolves with its answer, or null when you pressed "Use the local writer" */
export function askOutside(label: string, rules: string, input: string, images?: string[]): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    useOutside.setState((s) => ({ reqs: [...s.reqs, { id, label, rules: rules.trim(), input: input.trim(), resolve, reject, ...(images?.length ? { images } : {}) }] }));
  });
}

export function settle(ids: number[], how: "local" | "cancel" | Record<number, string>) {
  const { reqs } = useOutside.getState();
  for (const r of reqs.filter((x) => ids.includes(x.id))) {
    if (how === "local") r.resolve(null);
    else if (how === "cancel") r.reject(new Error("Cancelled"));
    else r.resolve(how[r.id]);
  }
  useOutside.setState((s) => ({ reqs: s.reqs.filter((x) => !ids.includes(x.id)) }));
}

/** the text to paste into Grok: the rules once, then each request */
export function messageFor(reqs: OutsideReq[], numbered = false): string {
  if (reqs.length === 1 && !numbered) {
    const r = reqs[0];
    return `${r.rules}\n\n---\n\n${r.input}\n\n---\nReply with only the finished text, nothing before or after it.`;
  }
  const same = reqs.every((r) => r.rules === reqs[0].rules);
  const head = reqs.length === 1 ? `There is one request below. Start your reply with the heading line "### ANSWER 1", then put only the finished text under it — no comments, no code blocks.` : `There are ${reqs.length} separate requests below. Answer every one of them, in order, each under its own heading line "### ANSWER 1", "### ANSWER 2" and so on. Under each heading put only the finished text for that request — no comments, no code blocks.`;
  const body = reqs.map((r, i) => `### REQUEST ${i + 1}\n${same ? "" : `INSTRUCTIONS:\n${r.rules}\n\nINPUT:\n`}${r.input}`).join("\n\n");
  return same ? `${head}\n\nINSTRUCTIONS FOR EVERY REQUEST:\n${reqs[0].rules}\n\n${body}` : `${head}\n\n${body}`;
}

const clean = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^\s*```[a-z]*\s*\n?/i, "").replace(/\n?```\s*$/, "").trim().replace(/^["“]|["”]$/g, "").trim();

/** split a pasted answer: one request → all of it; several → by "ANSWER n" headings (also **ANSWER 1** or "Answer 1:") */
export function splitAnswer(text: string, n: number): string[] | string {
  const re = /^[ \t>#*_]*answer[ \t]*(\d+)[ \t*_:.)\-]*$/gim;
  const marks = [...text.matchAll(re)];
  if (n === 1 && !marks.length) { const t = clean(text); return t ? [t] : "The answer is empty"; }
  if (!marks.length) return `Couldn't find the "### ANSWER 1" … "### ANSWER ${n}" headings in what you pasted — ask Grok to "put each answer under its ### ANSWER n heading" and paste again.`;
  const out: string[] = Array(n).fill("");
  marks.forEach((m, i) => {
    const k = Number(m[1]) - 1;
    const end = i + 1 < marks.length ? marks[i + 1].index! : text.length;
    if (k >= 0 && k < n) out[k] = clean(text.slice(m.index! + m[0].length, end));
  });
  const missing = out.map((t, i) => (t ? 0 : i + 1)).filter(Boolean);
  if (missing.length) return `Answer${missing.length > 1 ? "s" : ""} ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} missing — ask Grok to finish, then paste the whole reply again.`;
  return out;
}

// ------------------------------------------------------------------ connected Grok tab (the H3 Grok helper userscript)
export async function grokStatus(): Promise<{ connected: boolean; token: string }> {
  try { const r = await fetch("/studio-api/grok/status", { cache: "no-store" }); return r.ok ? await r.json() : { connected: false, token: "" }; } catch { return { connected: false, token: "" }; }
}
/** open grok.com in a tab that the helper connects to this rental (the link carries the rental's address + relay token) */
export async function connectGrok() {
  const w = window.open("about:blank", "h3grok");
  const { token } = await grokStatus();
  if (!token) { w?.close(); throw new Error("The rental's Studio helper isn't answering — try again in a moment"); }
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify({ url: location.origin, token })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const url = `https://grok.com/#h3=${b64}`;
  if (w) w.location.href = url; else window.open(url, "h3grok");
}
export const helperUrl = () => `${location.origin}/grok-relay/h3-grok.user.js`;

/** hand a message to the connected Grok tab and wait for its reply */
export async function relayAsk(text: string, stop: { cancelled: boolean }, images?: string[]): Promise<string> {
  const r = await fetch("/studio-api/grok/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, images: images ?? [] }) });
  if (!r.ok) throw new Error("Couldn't hand it to the Grok tab");
  const { id } = await r.json();
  const t0 = Date.now();
  while (!stop.cancelled) {
    await new Promise((res) => setTimeout(res, 2000));
    const q = await fetch(`/studio-api/grok/result/${id}`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (q?.state === "done") return q.answer as string;
    if (q?.state === "error") throw new Error(q.error || "The Grok tab couldn't write it");
    if (Date.now() - t0 > 12 * 60 * 1000) break;
  }
  void fetch(`/studio-api/grok/result/${id}`, { method: "DELETE" }).catch(() => undefined);
  throw new Error(stop.cancelled ? "Cancelled" : "The Grok tab didn't answer in 12 minutes — is it still open?");
}
