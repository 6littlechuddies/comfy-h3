// The assistant: a chat with the local writer model. It sees what you see (the tab, your character, the prompt boxes and
// settings, recent jobs), answers in plain words and can change settings for you. Talk to it with the mic — your voice is
// turned into text on the rental. Each character keeps its own conversation.
import { useEffect, useRef, useState } from "react";
import { useCharacters } from "../lib/characters";
import { useJobs, type Tab } from "../lib/jobs";
import { useScenes } from "../lib/scenes";
import { useSettings, type Settings } from "../lib/settings";
import { useDictation } from "../lib/voice";
import { runWriter } from "../lib/writer";
import { Icon, cx } from "./ui";

interface Msg { role: "you" | "assistant"; text: string; done?: string[]; at: number }
const TABS: Tab[] = ["characters", "scenes", "create", "edit", "prompt", "animate", "finish", "batch"];
const SECTION: Partial<Record<Tab, keyof Settings>> = { create: "create", edit: "edit", prompt: "prompt", animate: "animate", finish: "finish" };
const CHAR_FIELDS = ["name", "hair", "eyes", "body", "ethnicity", "outfit", "details", "personality", "block"] as const;

const key = (id: string | null) => `h3.chat.${id ?? "free"}`;
const loadMsgs = (id: string | null): Msg[] => { try { return JSON.parse(localStorage.getItem(key(id)) || "[]"); } catch { return []; } };
const saveMsgs = (id: string | null, m: Msg[]) => { try { localStorage.setItem(key(id), JSON.stringify(m.slice(-60))); } catch { /* private mode */ } };

/** what the assistant gets to see: the current tab's settings (plain values only), the picked character, recent jobs */
function snapshot() {
  const st = useSettings.getState().s;
  const tab = st.tab;
  const sec = SECTION[tab];
  const flat: Record<string, unknown> = {};
  if (sec) for (const [k, v] of Object.entries(st[sec] as Record<string, unknown>)) {
    if (typeof v === "string") flat[`${sec}.${k}`] = v.length > 600 ? `${v.slice(0, 600)}…` : v;
    else if (typeof v === "number" || typeof v === "boolean") flat[`${sec}.${k}`] = v;
  }
  const cs = useCharacters.getState();
  const c = cs.list.find((x) => x.id === cs.sel);
  const character = c ? Object.fromEntries([["age", c.age], ["style", c.style], ["gender", c.gender], ...CHAR_FIELDS.map((f) => [f, c[f] ?? ""]), ["pictures", Object.keys(c.views)]]) : null;
  const sc = useScenes.getState();
  const scene = tab === "scenes" ? sc.list.find((x) => x.id === sc.sel) : undefined;
  const jobs = useJobs.getState().jobs.slice(0, 5).map((j) => ({ what: j.label, status: j.status, ...(j.error ? { error: j.error.slice(0, 200) } : {}) }));
  return JSON.stringify({ tab, settings: flat, character, ...(scene ? { scene: { name: scene.name, shots: scene.shots.slice(0, 8).map((s) => ({ seconds: s.seconds, mode: s.mode, description: s.description.slice(0, 300) })) } } : {}), recentJobs: jobs }, null, 1);
}

/** do what the assistant asked for, only where it's allowed; returns what changed */
async function apply(actions: unknown): Promise<string[]> {
  const done: string[] = [];
  if (!Array.isArray(actions)) return done;
  for (const a of actions as Record<string, unknown>[]) {
    if (!a || typeof a !== "object") continue;
    if (a.do === "set" && typeof a.path === "string") {
      const [sec, field] = a.path.split(".");
      const st = useSettings.getState();
      const cur = (st.s as unknown as Record<string, Record<string, unknown>>)[sec];
      if (!cur || !(field in cur) || typeof cur[field] === "object") continue;
      const v = typeof cur[field] === "number" ? Number(a.value) : typeof cur[field] === "boolean" ? !!a.value : String(a.value ?? "");
      if (typeof v === "number" && !Number.isFinite(v)) continue;
      st.set(sec as never, { [field]: v } as never);
      done.push(`${sec} → ${field}`);
    } else if (a.do === "character" && typeof a.field === "string" && (CHAR_FIELDS as readonly string[]).includes(a.field)) {
      const cs = useCharacters.getState();
      const c = cs.list.find((x) => x.id === cs.sel);
      if (!c) continue;
      cs.save({ ...c, [a.field]: String(a.value ?? "") });
      done.push(`${c.name} → ${a.field}`);
    } else if (a.do === "tab" && TABS.includes(a.value as Tab)) {
      useSettings.getState().setTab(a.value as Tab);
      done.push(`opened ${a.value}`);
    } else if (a.do === "generate") {
      await new Promise((r) => setTimeout(r, 120)); // let the changes above reach the screen first
      const { usePrimary } = await import("../App");
      const fn = usePrimary.getState().fns[useSettings.getState().s.tab];
      if (fn) { fn(); done.push("pressed the main button"); }
    }
  }
  return done;
}

import { create } from "zustand";
export const useAssistant = create<{ open: boolean }>(() => ({ open: false }));
/** the small "Ask" button in the header */
export function AssistantButton() {
  const open = useAssistant((s) => s.open);
  return (
    <button onClick={() => useAssistant.setState({ open: !open })} title="Assistant — ask or change things in plain words (or talk)" aria-pressed={open}
      className={cx("press flex h-8 shrink-0 items-center gap-1.5 border px-2.5 text-[12px]", open ? "border-accent text-ink" : "border-line text-muted hover:text-ink")}>
      <Icon name="chat" size={13} />Ask
    </button>
  );
}

export function Assistant() {
  const open = useAssistant((s) => s.open);
  const setOpen = (v: boolean) => useAssistant.setState({ open: v });
  const sel = useCharacters((s) => s.sel);
  const name = useCharacters((s) => s.list.find((x) => x.id === s.sel)?.name);
  const [msgs, setMsgs] = useState<Msg[]>(() => loadMsgs(sel));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useJobs((s) => s.toast);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { setMsgs(loadMsgs(sel)); }, [sel]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [msgs, open]);
  const mic = useDictation((t) => setText((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t)), (m) => toast(m, "bad"));

  const send = async (message = text) => {
    const m = message.trim();
    if (!m || busy) return;
    const mine: Msg = { role: "you", text: m, at: Date.now() };
    const next = [...msgs, mine];
    setMsgs(next); saveMsgs(sel, next); setText(""); setBusy(true);
    try {
      const history = next.slice(-9, -1).map((x) => `${x.role === "you" ? "USER" : "ASSISTANT"}: ${x.text}`).join("\n") || "(none)";
      const tab = useSettings.getState().s.tab;
      const out = await runWriter("chat", { state: snapshot(), history, message: m }, { tab, label: "Assistant", key: "writer:chat" });
      const block = out.match(/```actions\s*([\s\S]*?)```/);
      let done: string[] = [];
      if (block) { try { done = await apply(JSON.parse(block[1])); } catch { /* not valid JSON: just show the answer */ } }
      const reply: Msg = { role: "assistant", text: out.replace(/```actions[\s\S]*?```/g, "").trim() || (done.length ? "Done." : "…"), done, at: Date.now() };
      const all = [...next, reply];
      setMsgs(all); saveMsgs(sel, all);
    } catch (e) {
      const all = [...next, { role: "assistant" as const, text: `I couldn't answer: ${(e as Error).message}`, at: Date.now() }];
      setMsgs(all); saveMsgs(sel, all);
    } finally { setBusy(false); }
  };

  if (!open) return null;
  return (
    <div role="dialog" aria-label="Assistant" className="zoom-in fixed right-4 top-[64px] z-40 flex h-[min(440px,calc(100vh-140px))] w-[340px] flex-col border border-line bg-panel shadow-[0_24px_60px_-16px_rgba(0,0,0,.85)]">
      <div className="flex items-center gap-2 border-b border-line2 px-3.5 py-2.5">
        <Icon name="chat" size={15} className="text-accent" />
        <div className="flex-1 leading-tight"><div className="text-[13.5px] font-semibold">Assistant</div><div className="text-[11.5px] text-dim">{name ? `${name}'s project · remembers this chat` : "Free work"} · runs on your rental</div></div>
        {msgs.length > 0 && <button onClick={() => { setMsgs([]); saveMsgs(sel, []); }} className="text-[12px] text-muted hover:text-ink" title="Start a fresh conversation">Clear</button>}
        <button onClick={() => setOpen(false)} aria-label="Close" className="press flex h-7 w-7 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={15} /></button>
      </div>
      <div ref={list} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
        {msgs.length === 0 && (
          <div className="m-auto max-w-[300px] text-center text-[12.5px] leading-relaxed text-muted">
            Ask anything about what's on screen, or say what to change — <i>“make her outfit a red leather jacket and generate four”</i>, <i>“write a longer prompt for this scene”</i>. Press the mic and just talk.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cx("max-w-[88%] whitespace-pre-wrap px-3 py-2 text-[13px] leading-relaxed", m.role === "you" ? "self-end bg-accent/15 text-ink" : "self-start border border-line bg-raised text-ink/90")}>
            {m.text}
            {!!m.done?.length && <div className="mt-1.5 flex flex-wrap gap-1">{m.done.map((d) => <span key={d} className="micro border border-good/50 px-1.5 py-0.5 text-good">✓ {d}</span>)}</div>}
          </div>
        ))}
        {busy && <div className="self-start border border-line bg-raised px-3 py-2 text-[13px] text-muted"><span className="pulse">Thinking…</span></div>}
      </div>
      <div className="border-t border-line2 p-2.5">
        <div className="flex items-end gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={mic.state === "recording" ? "Listening… press the mic again to stop" : "Type, or press the mic and talk"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            className="inset min-h-[44px] flex-1 resize-none border border-line px-2.5 py-2 text-[13px] focus:border-accent focus:outline-none" />
          <button onClick={mic.toggle} disabled={mic.state === "working"} title={mic.state === "recording" ? "Stop and turn it into text" : "Talk (turned into text on your rental)"}
            className={cx("press flex h-11 w-11 shrink-0 items-center justify-center border", mic.state === "recording" ? "border-bad bg-bad/20 text-bad pulse" : "border-line text-muted hover:text-ink", mic.state === "working" && "opacity-50")}>
            <Icon name="mic" size={16} />
          </button>
          <button onClick={() => send()} disabled={!text.trim() || busy} className="press btn-primary flex h-11 shrink-0 items-center px-3.5 text-[13px] font-semibold disabled:opacity-40">Send</button>
        </div>
        <p className="mt-1.5 text-[11px] text-dim">{mic.state === "working" ? "Turning your voice into text… (the first time downloads the speech model, ~1 min)" : "Enter sends · Shift+Enter new line · uses your own “Studio assistant” prompt file if you add one"}</p>
      </div>
    </div>
  );
}
