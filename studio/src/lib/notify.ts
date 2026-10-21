// Phone alerts through the free ntfy app: the instance pings your phone when watched jobs finish,
// even with this page closed.
import { create } from "zustand";
import { loadState, saveState } from "./api";

export interface NotifyCfg { topic: string; every: boolean }
export const useNotify = create<NotifyCfg & { loaded: boolean; set: (p: Partial<NotifyCfg>) => void }>((set, get) => ({
  topic: "", every: false, loaded: false,
  set: (p) => { set(p); const { topic, every } = get(); saveState("notify", { topic, every }).catch(() => {}); },
}));
loadState<NotifyCfg>("notify").then((c) => useNotify.setState({ ...(c ?? {}), loaded: true }));

export async function watchJobs(ids: string[], title: string) {
  if (!useNotify.getState().topic || !ids.length) return false;
  const r = await fetch("/studio-api/notify/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, title }) }).catch(() => null);
  return !!r?.ok;
}
export async function testAlert(topic: string): Promise<string | null> {
  const r = await fetch("/studio-api/notify/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic }) }).catch(() => null);
  if (!r) return "Couldn't reach the instance";
  const b = await r.json().catch(() => ({}));
  return b.ok ? null : b.error || "Didn't send";
}
export const randomTopic = () => `h3-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("")}`;
