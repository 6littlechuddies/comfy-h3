// Dense prompts, broken into labelled pieces you can click, remove, weight, or change in plain words.
// And: right-click any highlighted text in a prompt box → "Change this part…".
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Tab } from "../lib/jobs";
import { useJobs } from "../lib/jobs";
import { CAT_LABEL, CAT_ORDER, categorize, fromPieces, isTagPrompt, pid, reweight, rewritePart, rewriteWhy, toPieces, type Piece, type PieceCat } from "../lib/tweak";
import { Icon, cx } from "./ui";
import { WordDiff } from "./WordDiff";
import { copyText } from "../lib/copy";

export function PromptPieces({ value, onChange, tab, className, onUse }: { value: string; onChange: (v: string) => void; tab: Tab; className?: string; /** buttons that send the selected pieces somewhere (e.g. "Add to Create") */ onUse?: { label: string; run: (text: string, cats: string[]) => void }[] }) {
  const tags = useMemo(() => isTagPrompt(value), [value]);
  const [pieces, setPieces] = useState<Piece[]>(() => toPieces(value));
  const last = useRef(value);
  // someone else changed the text (typed in the box, a new example…): split it again
  useEffect(() => { if (value !== last.current) { setPieces(toPieces(value)); setSel(new Set()); last.current = value; } }, [value]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [lastCh, setLast] = useState<{ part: string; out: string; before: string } | null>(null);
  const toast = useJobs((s) => s.toast);
  const noteBox = useRef<HTMLInputElement>(null);
  const update = (ps: Piece[]) => { const v = fromPieces(ps, tags); setPieces(ps); last.current = v; onChange(v); };
  const chosen = pieces.filter((p) => sel.has(p.id));
  const why = rewriteWhy();

  const change = async () => {
    if (!chosen.length || !note.trim()) return;
    setBusy(true);
    try {
      const part = fromPieces(chosen, tags);
      const out = await rewritePart(tab, value, part, note.trim());
      const repl = out ? toPieces(out).map((p) => ({ ...p, cat: categorize(p.text) })) : [];
      const at = pieces.findIndex((p) => sel.has(p.id));
      const rest = pieces.filter((p) => !sel.has(p.id));
      const idx = rest.findIndex((p) => pieces.indexOf(p) > at);
      update([...rest.slice(0, idx < 0 ? rest.length : idx), ...repl, ...(idx < 0 ? [] : rest.slice(idx))]);
      setSel(new Set(repl.map((p) => p.id))); setNote(""); setAsking(false);
      setLast({ part, out: out || "", before: value });
      toast(out ? "Changed — the new part is highlighted." : "Removed.", "good");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  const act = (what: "change" | "up" | "down" | "remove" | "copy") => {
    setMenu(null);
    if (what === "change") { setAsking(true); setTimeout(() => noteBox.current?.focus(), 30); return; }
    if (what === "remove") { update(pieces.filter((p) => !sel.has(p.id))); setSel(new Set()); return; }
    if (what === "copy") { copyText(fromPieces(chosen, tags)); return; }
    update(pieces.map((p) => (sel.has(p.id) ? { ...p, text: reweight(p.text, what === "up" ? 0.1 : -0.1) } : p)));
  };
  const groups = CAT_ORDER.map((c) => [c, pieces.filter((p) => p.cat === c)] as const).filter(([, ps]) => ps.length);

  return (
    <div className={cx("flex flex-col gap-2", className)} onClick={() => setMenu(null)}>
      <div className="flex flex-col gap-1.5">
        {groups.map(([cat, ps]) => (
          <div key={cat} className="flex items-start gap-2">
            <span className="micro mt-1.5 w-[84px] shrink-0 text-dim">{CAT_LABEL[cat].toUpperCase()}</span>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1">
              {ps.map((p) => editing === p.id ? (
                <input key={p.id} autoFocus defaultValue={p.text} aria-label="Edit piece"
                  onBlur={(e) => { const t = e.target.value.trim(); update(t ? pieces.map((x) => (x.id === p.id ? { ...x, text: t, cat: categorize(t) } : x)) : pieces.filter((x) => x.id !== p.id)); setEditing(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }}
                  className="inset h-7 min-w-[120px] border border-accent px-2 font-mono text-[11.5px] focus:outline-none" style={{ width: `${Math.min(60, p.text.length + 4)}ch` }} />
              ) : (
                <button key={p.id} type="button" title="Click to select · double-click to edit · right-click for more"
                  onClick={(e) => { e.stopPropagation(); setSel((s) => { const n = new Set(e.shiftKey || e.metaKey || e.ctrlKey ? s : []); if (s.has(p.id) && (e.shiftKey || e.metaKey || e.ctrlKey)) n.delete(p.id); else n.add(p.id); return n; }); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditing(p.id); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!sel.has(p.id)) setSel(new Set([p.id])); setMenu({ x: e.clientX, y: e.clientY }); }}
                  className={cx("max-w-full truncate border px-1.5 py-0.5 text-left font-mono text-[11.5px] transition-colors",
                    sel.has(p.id) ? "border-hot bg-hot/15 text-ink" : "border-line bg-raised/50 text-ink/85 hover:border-muted", !tags && "whitespace-normal text-left")}>
                  {p.text}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!pieces.length && <p className="text-[12px] text-dim">No prompt.</p>}
      </div>
      {lastCh && (
        <div className="flex items-start gap-2 border border-good/50 bg-good/5 px-2.5 py-1.5 text-[11.5px]" onClick={(e) => e.stopPropagation()}>
          <span className="micro mt-0.5 shrink-0 text-good">CHANGED</span>
          <p className="min-w-0 flex-1 font-mono leading-relaxed text-ink/90"><WordDiff before={lastCh.part} after={lastCh.out} /></p>
          <button className="micro shrink-0 text-muted hover:text-ink" onClick={() => { onChange(lastCh.before); setLast(null); }}>UNDO</button>
          <button aria-label="Close" className="shrink-0 text-muted hover:text-ink" onClick={() => setLast(null)}>×</button>
        </div>
      )}
      {(chosen.length > 0 || asking) && (
        <div className="flex flex-col gap-1.5 border border-dashed border-hot/60 px-2.5 py-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 text-[12px]">
            <span className="micro text-hot">{chosen.length} SELECTED</span>
            {onUse?.map((u) => <button key={u.label} className="micro text-accent hover:text-ink" onClick={() => { u.run(fromPieces(chosen, tags), [...new Set(chosen.map((p) => p.cat))]); setSel(new Set()); }}>{u.label.toUpperCase()}</button>)}
            <button className="micro ml-auto text-muted hover:text-ink" onClick={() => act("remove")}>REMOVE</button>
            {tags && <><button className="micro text-muted hover:text-ink" onClick={() => act("up")} title="Stronger (weight +0.1)">STRONGER</button>
              <button className="micro text-muted hover:text-ink" onClick={() => act("down")} title="Weaker (weight −0.1)">WEAKER</button></>}
            <button className="micro text-muted hover:text-ink" onClick={() => { setSel(new Set()); setAsking(false); }}>CLEAR</button>
          </div>
          <div className="flex gap-1.5">
            <input ref={noteBox} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); change(); } }}
              placeholder="Change it how? e.g. make it a black leather jacket · softer evening light · she sits on the edge of the bed"
              aria-label="How to change the selected part" className="inset h-8 min-w-0 flex-1 border border-line px-2 text-[12.5px] focus:border-accent focus:outline-none" />
            <span title={why}><button onClick={change} disabled={!note.trim() || busy || !!why} className="press chamfer-sm btn-hot h-8 px-3 text-[12.5px] font-bold disabled:opacity-40">{busy ? "Changing…" : "Change"}</button></span>
          </div>
        </div>
      )}
      {menu && createPortal(
        <div className="fixed z-[95] w-48 border border-line bg-raised2 py-1 shadow-2xl" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 200) }} onMouseLeave={() => setMenu(null)}>
          <MenuItem onClick={() => act("change")} icon="brush">Change this…</MenuItem>
          {tags && <MenuItem onClick={() => act("up")} icon="up">Stronger</MenuItem>}
          {tags && <MenuItem onClick={() => act("down")} icon="down">Weaker</MenuItem>}
          <MenuItem onClick={() => act("copy")} icon="script">Copy</MenuItem>
          <MenuItem onClick={() => act("remove")} icon="trash" danger>Remove</MenuItem>
        </div>, document.body)}
    </div>
  );
}

function MenuItem({ onClick, icon, children, danger }: { onClick: () => void; icon: string; children: React.ReactNode; danger?: boolean }) {
  return <button onClick={onClick} className={cx("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover", danger && "text-bad")}><Icon name={icon} size={13} className="text-muted" />{children}</button>;
}

/** right-click highlighted text in a prompt box → "Change this part…" (the writer rewrites just that part) */
export function useRewriteMenu(tab: Tab | undefined, value: string, onChange: (v: string) => void) {
  const [state, setState] = useState<{ x: number; y: number; start: number; end: number } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // the last change, shown word by word (new = green, gone = struck) with Undo
  const [changed, setChanged] = useState<{ x: number; y: number; part: string; out: string; before: string; after: string } | null>(null);
  const toast = useJobs((s) => s.toast);
  const onContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (!tab) return;
    const el = e.currentTarget;
    if (el.selectionEnd - el.selectionStart < 2) return; // nothing highlighted: the normal menu
    e.preventDefault();
    setState({ x: e.clientX, y: e.clientY, start: el.selectionStart, end: el.selectionEnd });
  };
  const apply = async () => {
    if (!state || !tab || !note.trim()) return;
    // the menu can be closed while the writer works (it may wait behind a picture on the GPU); the change still lands
    const st = state, before = value;
    setBusy(true);
    try {
      const part = before.slice(st.start, st.end);
      const out = await rewritePart(tab, value, part, note.trim());
      const after = before.slice(0, st.start) + out + before.slice(st.end);
      // both versions go into the prompt history (the clock in the box), so a rewrite never loses anything
      const { remember } = await import("../lib/promptHistory");
      remember(tab, before, "before a rewrite");
      onChange(after);
      remember(tab, after, "rewritten");
      setChanged({ x: st.x, y: st.y, part, out, before, after });
      setState(null); setNote("");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  const why = rewriteWhy();
  const menu = state && createPortal(
    // while it's rewriting, the rest of the Studio stays usable: clicks go through, and a click outside just hides this box
    <div className={cx("fade-in fixed inset-0 z-[94]", busy && "pointer-events-none")} onMouseDown={() => setState(null)}>
      <div className="pointer-events-auto absolute w-[380px] border border-line bg-raised2 p-2.5 shadow-2xl" style={{ left: Math.min(state.x, window.innerWidth - 392), top: Math.min(state.y + 6, window.innerHeight - 150) }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="micro mb-1 text-hot">CHANGE THIS PART</div>
        <p className="mb-2 line-clamp-2 bg-hot/10 px-1.5 py-1 font-mono text-[11.5px] text-ink/90">“{value.slice(state.start, state.end)}”</p>
        <div className="flex gap-1.5">
          <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } if (e.key === "Escape") setState(null); }}
            placeholder="How? e.g. make it a red silk dress" aria-label="How to change this part" className="inset h-8 min-w-0 flex-1 border border-line px-2 text-[12.5px] focus:border-accent focus:outline-none" />
          <span title={why}><button onClick={apply} disabled={!note.trim() || busy || !!why} className="press chamfer-sm btn-hot h-8 px-3 text-[12.5px] font-bold disabled:opacity-40">{busy ? "…" : "Change"}</button></span>
        </div>
        <p className="mt-1.5 text-[11px] text-dim">{busy ? "Rewriting… you can keep working — the change lands in the box when it's done." : "The local writer rewrites only the highlighted part, in the same style."}</p>
      </div>
    </div>, document.body);
  const shown = changed && createPortal(
    <div className="fade-in fixed z-[94] w-[420px] border border-good/60 bg-raised2 p-2.5 shadow-2xl" style={{ left: Math.min(changed.x, window.innerWidth - 432), top: Math.min(changed.y + 6, window.innerHeight - 220) }}>
      <div className="mb-1 flex items-center gap-2"><span className="micro text-good">CHANGED</span>
        <span className="text-[11px] text-dim">green = new · struck = removed</span>
        <button className="micro ml-auto text-muted hover:text-ink" onClick={() => { if (value === changed.after) onChange(changed.before); setChanged(null); toast("Put back", "info"); }}>UNDO</button>
        <button className="micro text-muted hover:text-ink" onClick={() => { setChanged(null); import("../lib/promptHistory").then(({ usePromptHistory }) => usePromptHistory.setState({ open: tab! })); }}>HISTORY</button>
        <button aria-label="Close" className="text-muted hover:text-ink" onClick={() => setChanged(null)}>×</button></div>
      <p className="max-h-40 overflow-y-auto font-mono text-[11.5px] leading-relaxed text-ink/90"><WordDiff before={changed.part} after={changed.out} /></p>
    </div>, document.body);
  return { onContextMenu, menu: <>{menu}{shown}</> };
}

export type { PieceCat };
export { pid };
