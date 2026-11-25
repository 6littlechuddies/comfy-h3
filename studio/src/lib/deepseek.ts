// DeepSeek writes instead of a local model: its key in the Vast template (DEEPSEEK_API_KEY) or pasted in the Studio.
// While it's on, every writer job (an LLM graph) goes to the rental's /studio-api/deepseek/graph instead of ComfyUI, and
// the local writer isn't downloaded.
import { create } from "zustand";

export const useDeepseek = create<{ on: boolean; known: boolean; model: string; source: string | null }>(() => ({ on: false, known: false, model: "", source: null }));
export const deepseekOn = () => useDeepseek.getState().on;

export async function loadDeepseek() {
  try {
    const d = await (await fetch("/studio-api/deepseek", { cache: "no-store" })).json();
    useDeepseek.setState({ on: !!d.on, known: true, model: d.model ?? "", source: d.source ?? null });
  } catch { useDeepseek.setState({ known: true }); }
}

/** try a key and keep it on this rental ("" removes it); throws with DeepSeek's reason when it doesn't work */
export async function setDeepseekKey(key: string) {
  const r = await fetch("/studio-api/deepseek", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `The rental answered ${r.status}`);
  useDeepseek.setState({ on: !!d.on, known: true, model: d.model ?? "", source: d.source ?? null });
  import("./downloads").then((m) => m.refreshDownloads()).catch(() => {});
  // DeepSeek writes now: the local writer's files come off this disk and it isn't downloaded again (new rentals with the
  // key in the template never download it)
  // (key removed: the local writer downloads again)
  for (const group of d.on ? ["writer", "writer_xl"] : ["writer"]) await fetch("/studio-api/downloads/later", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d.on ? { group, remove: true } : { group, later: false }) }).catch(() => null);
}

/** what the model name means, for people */
export const modelName = (m: string) => (m === "deepseek-flash" ? "V4.1 Flash 1017" : m);

let loading: Promise<void> | null = null;
/** the first look is shared: everyone asking at start waits for the same answer */
export function ensureDeepseek(): Promise<void> { return useDeepseek.getState().known ? Promise.resolve() : (loading ??= loadDeepseek()); }
if (typeof window !== "undefined") void ensureDeepseek();

// ------------------------------------------------------------------ WebSocket DeepSeek multiplexer (/studio-api/ds-ws)
// One persistent WebSocket carries all concurrent DeepSeek chat/judge/writer calls so Chrome's 6-connection HTTP/1.1
// limit never stalls 16-24+ parallel characters. Falls back silently to HTTP fetch() if WS is blocked or drops mid-call.
type WsResp = { id?: string; ok?: boolean; data?: Record<string, unknown>; error?: string; status?: number };
type Pending = { resolve: (r: WsResp) => void; reject: (e: Error) => void; cancelled?: boolean };

class WsTransportError extends Error {
  constructor(msg: string) { super(msg); this.name = "WsTransportError"; }
}

let wsSock: WebSocket | null = null;
let wsOpening: Promise<WebSocket | null> | null = null;
let wsBackoff = 1000;
let wsDownUntil = 0;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsSeq = 0;
const wsPending = new Map<string, Pending>();

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/studio-api/ds-ws`;
}

function dropPending(reason: string) {
  for (const [id, p] of wsPending) {
    wsPending.delete(id);
    if (!p.cancelled) p.reject(new WsTransportError(reason));
  }
}

function scheduleReconnect() {
  if (wsReconnectTimer || typeof window === "undefined") return;
  const delay = wsBackoff;
  wsBackoff = Math.min(15_000, wsBackoff * 2);
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    if (wsPending.size > 0) void openWs();
  }, delay);
}

function openWs(): Promise<WebSocket | null> {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") return Promise.resolve(null);
  if (wsSock && wsSock.readyState === WebSocket.OPEN) return Promise.resolve(wsSock);
  if (Date.now() < wsDownUntil) return Promise.resolve(null);
  if (wsOpening) return wsOpening;

  wsOpening = new Promise<WebSocket | null>((resolve) => {
    let settled = false;
    const finish = (s: WebSocket | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      wsOpening = null;
      resolve(s);
    };
    let sock: WebSocket;
    try { sock = new WebSocket(wsUrl()); }
    catch { wsDownUntil = Date.now() + 30_000; finish(null); return; }

    // Don't stall callers if a proxy blocks WS upgrades — fail fast to HTTP fallback
    const timer = setTimeout(() => {
      if (sock.readyState !== WebSocket.OPEN) {
        try { sock.close(); } catch { /* */ }
        wsDownUntil = Date.now() + 30_000;
        finish(null);
      }
    }, 2000);

    sock.onopen = () => {
      wsSock = sock;
      wsBackoff = 1000;
      wsDownUntil = 0;
      finish(sock);
    };
    sock.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let msg: WsResp;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const id = msg.id;
      if (!id) return;
      const p = wsPending.get(id);
      if (!p) return;
      wsPending.delete(id);
      p.resolve(msg);
    };
    sock.onerror = () => {
      if (!settled) { wsDownUntil = Date.now() + 30_000; finish(null); }
    };
    sock.onclose = () => {
      const wasOpen = wsSock === sock;
      if (wasOpen) wsSock = null;
      if (!settled) { wsDownUntil = Date.now() + 30_000; finish(null); }
      dropPending("WebSocket closed");
      if (wasOpen) scheduleReconnect();
    };
  });
  return wsOpening;
}

/** cancel an in-flight WebSocket request by id (no-op if not pending) */
export function dsCancel(id: string) {
  const p = wsPending.get(id);
  if (p) {
    p.cancelled = true;
    wsPending.delete(id);
    p.resolve({ id, ok: false, error: "cancelled", status: 499 });
  }
  if (wsSock && wsSock.readyState === WebSocket.OPEN) {
    try { wsSock.send(JSON.stringify({ id, kind: "cancel" })); } catch { /* */ }
  }
}

async function dsWsRequest(kind: "chat" | "writer", payload: Record<string, unknown>, id?: string): Promise<WsResp> {
  const sock = await openWs();
  if (!sock || sock.readyState !== WebSocket.OPEN) throw new WsTransportError("WebSocket unavailable");
  const rid = id ?? `dsr-${Date.now().toString(36)}-${++wsSeq}`;
  return new Promise<WsResp>((resolve, reject) => {
    wsPending.set(rid, { resolve, reject });
    try {
      sock.send(JSON.stringify({ id: rid, kind, payload }));
    } catch (e) {
      wsPending.delete(rid);
      reject(new WsTransportError(String(e)));
    }
  });
}

/** /studio-api/chatsim via WS multiplexer with silent HTTP fetch() fallback */
export async function dsChatSim(payload: { messages: { role: string; content: string }[]; max_tokens?: number; temperature?: number; top_p?: number; frequency_penalty?: number; presence_penalty?: number }): Promise<string> {
  try {
    const res = await dsWsRequest("chat", payload);
    if (!res.ok) throw new Error(res.error || `The rental answered ${res.status ?? 502}`);
    return String(res.data?.text ?? "");
  } catch (e) {
    if (!(e instanceof WsTransportError)) throw e;
  }
  const r = await fetch("/studio-api/chatsim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `The rental answered ${r.status}`);
  return String(d.text ?? "");
}

/** /studio-api/judge via WS multiplexer with silent HTTP fetch() fallback */
export async function dsJudge(payload: { provider: string; model?: string; max_tokens?: number; messages: { role: string; content: string }[] }): Promise<string> {
  try {
    const res = await dsWsRequest("chat", { ...payload, mode: "judge" });
    if (!res.ok) throw new Error(res.error || `The rental answered ${res.status ?? 502}`);
    return String(res.data?.text ?? "");
  } catch (e) {
    if (!(e instanceof WsTransportError)) throw e;
  }
  const r = await fetch("/studio-api/judge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `The rental answered ${r.status}`);
  return String(d.text ?? "");
}

export type DsGraphAnswer = { texts?: Record<string, string>; error?: string; node?: string };

/** /studio-api/deepseek/graph via WS multiplexer with silent HTTP async+poll fallback */
export async function dsWriterGraph(
  payload: { graph: Record<string, unknown>; label?: string },
  opts?: { id?: string; isCancelled?: () => boolean },
): Promise<{ status: number; d: DsGraphAnswer }> {
  try {
    const res = await dsWsRequest("writer", payload, opts?.id);
    if (res.ok) return { status: 200, d: (res.data ?? {}) as DsGraphAnswer };
    const d = (res.data ?? { error: res.error }) as DsGraphAnswer;
    if (!d.error && res.error) d.error = res.error;
    return { status: res.status ?? 502, d };
  } catch (e) {
    if (!(e instanceof WsTransportError)) {
      return { status: 0, d: { error: `Couldn't reach the rental: ${(e as Error).message}` } };
    }
  }
  if (opts?.isCancelled?.()) return { status: 499, d: { error: "cancelled" } };
  // Silent HTTP fallback (existing async + 2s polling path)
  try {
    const r0 = await fetch("/studio-api/deepseek/graph", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, async: true }) });
    const first = { status: r0.status, d: await r0.json().catch(() => ({})) as DsGraphAnswer & { job?: string } };
    if (first.status !== 200 || !first.d.job) return first;
    for (let miss = 0; ;) {
      await new Promise((r) => setTimeout(r, 2000));
      if (opts?.isCancelled?.()) return { status: 499, d: { error: "cancelled" } };
      const r = await fetch(`/studio-api/deepseek/graph?job=${first.d.job}`).catch(() => null);
      if (!r) { if (++miss > 30) return { status: 0, d: { error: "Lost the rental while DeepSeek was writing" } }; continue; }
      miss = 0;
      const d = await r.json().catch(() => ({})) as DsGraphAnswer & { state?: string };
      if (d.state === "running") continue;
      if (d.state === "gone") return { status: 0, d: { error: "The rental restarted while DeepSeek was writing — run it again" } };
      return { status: r.status, d };
    }
  } catch (e) {
    return { status: 0, d: { error: `Couldn't reach the rental: ${(e as Error).message}` } };
  }
}
