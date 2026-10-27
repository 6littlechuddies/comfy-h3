// In-app dialogs (instead of the browser's prompt/confirm boxes), the command palette (Ctrl+K)
// and the keyboard shortcut sheet (?).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Icon, cx } from "./ui";

// ------------------------------------------------------------------ ask / confirm
interface Ask { kind: "text" | "confirm"; title: string; body?: string; initial?: string; ok: string; danger?: boolean; allowEmpty?: boolean; resolve: (v: string | boolean | null) => void }
const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }));
/** null = cancelled; with allowEmpty, an empty box answers "" */
export const askText = (title: string, initial = "", ok = "Save", allowEmpty = false) =>
  new Promise<string | null>((resolve) => useAsk.setState({ ask: { kind: "text", title, initial, ok, allowEmpty, resolve: (v) => resolve(v as string | null) } }));
export const askConfirm = (title: string, body?: string, ok = "Confirm", danger = false) =>
  new Promise<boolean>((resolve) => useAsk.setState({ ask: { kind: "confirm", title, body, ok, danger, resolve: (v) => resolve(!!v) } }));

export function Modal({ children, onClose, width = 420, label }: { children: ReactNode; onClose: () => void; width?: number; label: string }) {
  useEffect(() => {
    // a list inside the dialog (data-esc-own) closes itself first
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(document.activeElement as HTMLElement | null)?.closest?.("[data-esc-own]")) { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  return createPortal(
    <div className="fade-in fixed inset-0 z-[100] flex items-start justify-center bg-black/55 px-4 pt-[14vh] backdrop-blur-[3px]" onMouseDown={onClose} role="dialog" aria-label={label} aria-modal>
      <div className="zoom-in ticks frame card w-full border border-line" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>{children}</div>
    </div>, document.body);
}

export function AskHost() {
  const ask = useAsk((s) => s.ask);
  const [v, setV] = useState("");
  useEffect(() => { if (ask) setV(ask.initial ?? ""); }, [ask]);
  if (!ask) return null;
  const done = (val: string | boolean | null) => { ask.resolve(val); useAsk.setState({ ask: null }); };
  return (
    <Modal onClose={() => done(null)} label={ask.title}>
      <form className="flex flex-col gap-4 p-5" onSubmit={(e) => { e.preventDefault(); done(ask.kind === "text" ? (v.trim() || (ask.allowEmpty ? "" : null)) : true); }}>
        <h2 className="display text-lg">{ask.title}</h2>
        {ask.body && <p className="-mt-2 text-[13.5px] leading-relaxed text-muted">{ask.body}</p>}
        {ask.kind === "text" && <input autoFocus value={v} onChange={(e) => setV(e.target.value)} className="inset h-11 rounded-lg border border-line2 px-3 text-[15px] focus:border-accent focus:outline-none" />}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => done(null)} className="press btn-raised h-9 rounded-lg px-4 text-[13px] font-medium">Cancel</button>
          <button type="submit" autoFocus={ask.kind === "confirm"} className={cx("press h-9 rounded-lg px-4 text-[13px] font-semibold", ask.danger ? "btn-raised !text-bad" : "btn-primary chamfer-sm")}>{ask.ok}</button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ strength sweep
export interface Sweep { values: number[]; fast: boolean }
const useSweepAsk = create<{ ask: { title: string; video: boolean; current: number; resolve: (v: Sweep | null) => void } | null }>(() => ({ ask: null }));
export const askSweep = (title: string, video: boolean, current: number) =>
  new Promise<Sweep | null>((resolve) => useSweepAsk.setState({ ask: { title, video, current, resolve } }));
const STRENGTHS = [0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2];
export function SweepHost() {
  const ask = useSweepAsk((s) => s.ask);
  const [vals, setVals] = useState<number[]>([]);
  const [fast, setFast] = useState(true);
  useEffect(() => { if (ask) { setVals(ask.video ? [0.5, 0.8, 1] : [0.4, 0.6, 0.8, 1]); setFast(true); } }, [ask]);
  if (!ask) return null;
  const done = (v: Sweep | null) => { ask.resolve(v); useSweepAsk.setState({ ask: null }); };
  const n = vals.length;
  return (
    <Modal onClose={() => done(null)} label="Try strengths" width={480}>
      <form className="flex flex-col gap-4 p-5" onSubmit={(e) => { e.preventDefault(); if (n) done({ values: [...vals].sort((a, b) => a - b), fast }); }}>
        <div>
          <div className="micro text-dim">STRENGTH SWEEP</div>
          <h2 className="display text-lg leading-tight">{ask.title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">Makes the same {ask.video ? "video" : "picture"} (same seed, same prompt) once per strength, side by side in your results. Then press <b className="text-ink">Use this strength</b> on the one you like.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STRENGTHS.map((v) => (
            <button type="button" key={v} aria-pressed={vals.includes(v)} onClick={() => setVals((x) => (x.includes(v) ? x.filter((y) => y !== v) : [...x, v]))}
              className={cx("press tag-btn w-14 font-mono", vals.includes(v) && "on")}>{v.toFixed(1)}</button>
          ))}
        </div>
        <p className="-mt-2 text-[12px] text-dim">Now at {ask.current.toFixed(2)}.</p>
        {ask.video && (
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
            <input type="checkbox" className="mt-0.5" checked={fast} onChange={(e) => setFast(e.target.checked)} />
            <span><b className="text-ink">Quick drafts</b><span className="block text-muted">Lower resolution{" "}(and the 4-step turbo for References videos) — about 3–4× faster. Make the winner in full quality afterwards.</span></span>
          </label>
        )}
        <div className="flex items-center justify-end gap-2">
          <span className="micro mr-auto text-dim">{n} {ask.video ? "VIDEOS" : "PICTURES"}</span>
          <button type="button" onClick={() => done(null)} className="press btn-raised h-9 px-4 text-[13px] font-medium">Cancel</button>
          <button type="submit" disabled={!n} className="press btn-primary chamfer-sm h-9 px-4 text-[13px]">Make {n}</button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ command palette
export interface Command { id: string; title: string; hint?: string; group: string; icon?: string; keys?: string; run: () => void }
export const usePalette = create<{ open: boolean; extra: () => Command[] }>(() => ({ open: false, extra: () => [] }));

export function Palette({ commands }: { commands: () => Command[] }) {
  const open = usePalette((s) => s.open);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const all = useMemo(() => (open ? [...commands(), ...usePalette.getState().extra()] : []), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = all.filter((c) => words.every((w) => `${c.title} ${c.hint ?? ""} ${c.group}`.toLowerCase().includes(w))).slice(0, 40);
  useEffect(() => { setI(0); }, [q, open]);
  useEffect(() => { list.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" }); }, [i]);
  if (!open) return null;
  const close = () => { usePalette.setState({ open: false }); setQ(""); };
  const go = (c?: Command) => { if (!c) return; close(); setTimeout(c.run, 0); };
  let lastGroup = "";
  return (
    <Modal onClose={close} width={600} label="Command palette">
      <div className="flex items-center gap-3 border-b border-line2 px-4">
        <Icon name="search" size={17} className="text-muted" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a tab, run a recipe, find a character…"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(shown.length - 1, x + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === "Enter") { e.preventDefault(); go(shown[i]); }
          }}
          className="h-14 flex-1 bg-transparent text-[16px] placeholder:text-dim focus:outline-none" aria-label="Search commands" />
        <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted">Esc</kbd>
      </div>
      <div ref={list} className="max-h-[52vh] overflow-y-auto p-2">
        {shown.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted">Nothing matches “{q}”.</p>}
        {shown.map((c, n) => {
          const head = c.group !== lastGroup ? (lastGroup = c.group) : null;
          return (
            <div key={c.id}>
              {head && <div className="px-3 pb-1 pt-3 text-[12px] font-semibold text-dim">{head}</div>}
              <button data-i={n} onMouseMove={() => setI(n)} onClick={() => go(c)}
                className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px]", n === i ? "bg-hover text-white" : "text-ink")}>
                <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", n === i ? "bg-accent/20 text-accent" : "bg-raised2 text-muted")}><Icon name={c.icon ?? "arrow"} size={15} /></span>
                <span className="min-w-0 flex-1 truncate">{c.title}{c.hint && <span className="ml-2 text-[12.5px] text-muted">{c.hint}</span>}</span>
                {c.keys && <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted">{c.keys}</kbd>}
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ shortcuts sheet
export const useShortcuts = create<{ open: boolean }>(() => ({ open: false }));
const SHORTCUTS: [string, string][] = [
  ["Ctrl + K", "Command palette — jump anywhere, run recipes"],
  ["Ctrl + Enter", "Run the main button on this tab"],
  ["Ctrl + \\", "Show or hide the settings panel"],
  ["Ctrl + V", "Paste a picture straight into this tab"],
  ["Drop files", "Anywhere on the page adds them to this tab"],
  ["← / →", "Previous / next in the full-screen viewer"],
  ["F", "Favourite in the viewer"],
  ["Esc", "Close any window"],
  ["?", "This list"],
];
export function ShortcutSheet() {
  const open = useShortcuts((s) => s.open);
  if (!open) return null;
  return (
    <Modal onClose={() => useShortcuts.setState({ open: false })} width={520} label="Keyboard shortcuts">
      <div className="p-5">
        <h2 className="display mb-3 text-lg">Keyboard shortcuts</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[13.5px]">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="contents"><dt><kbd className="whitespace-nowrap rounded-md border border-line bg-raised2 px-2 py-0.5 text-[12px]">{k}</kbd></dt><dd className="text-muted">{d}</dd></div>
          ))}
        </dl>
      </div>
    </Modal>
  );
}
