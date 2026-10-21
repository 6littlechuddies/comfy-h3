// "History" in the prompt box: every prompt you tried here, grouped by the pictures it went with — put any one back
// (with its pictures, when they're different from the ones in now).
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Tab } from "../lib/jobs";
import { canRestorePics, currentKey, forget, groupKey, projectNow, remember, restorePics, usePromptHistory, type HistEntry } from "../lib/promptHistory";
import { Icon, cx } from "./ui";

const ago = (t: number) => { const s = (Date.now() - t) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };
const WHY: Record<HistEntry["why"], string> = { sent: "sent", "before a rewrite": "before a rewrite", rewritten: "rewritten", replaced: "replaced" };

export function PromptHistoryButton({ tab, value, onChange }: { tab: Tab; value: string; onChange: (v: string) => void }) {
  const open = usePromptHistory((s) => s.open === tab);
  const n = usePromptHistory((s) => s.list.filter((e) => e.tab === tab && e.project === projectNow()).length);
  return <>
    <button type="button" onClick={() => usePromptHistory.setState({ open: open ? null : tab })} title="Every prompt you tried here, grouped by the pictures it went with"
      className={cx("press inline-flex h-8 items-center gap-1 rounded-sm px-2 text-[12px]", open ? "text-accent" : "text-muted hover:text-ink")}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" /></svg>{n ? n : ""}
    </button>
    {open && <HistoryPanel tab={tab} value={value} onChange={onChange} />}
  </>;
}

function HistoryPanel({ tab, value, onChange }: { tab: Tab; value: string; onChange: (v: string) => void }) {
  const list = usePromptHistory((s) => s.list);
  const [q, setQ] = useState("");
  const project = projectNow();
  const close = () => usePromptHistory.setState({ open: null });
  const cur = currentKey(tab);
  // folders: one per set of pictures, the ones you have in now first, then the most recent
  const groups = useMemo(() => {
    const m = new Map<string, HistEntry[]>();
    for (const e of list) {
      if (e.tab !== tab || e.project !== project) continue;
      if (q && !e.text.toLowerCase().includes(q.toLowerCase())) continue;
      const k = groupKey(e.pics);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()].sort((a, b) => (a[0] === cur ? -1 : b[0] === cur ? 1 : b[1][0].at - a[1][0].at));
  }, [list, tab, project, q, cur]);
  const use = (e: HistEntry, withPics: boolean) => {
    if (value.trim() && value.trim() !== e.text) remember(tab, value, "replaced"); // what was in the box isn't lost either
    if (withPics) restorePics(tab, e.pics);
    onChange(e.text);
    close();
  };
  return createPortal(
    <div className="fade-in fixed inset-0 z-[93] flex justify-end bg-black/40" onMouseDown={close}>
      <aside className="flex h-full w-[min(520px,100vw)] flex-col border-l border-line bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Prompt history">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <b className="text-[15px]">Prompt history</b>
          <span className="text-[12px] text-dim">this project · grouped by the pictures used</span>
          <button aria-label="Close" className="ml-auto text-muted hover:text-ink" onClick={close}><Icon name="x" size={15} /></button>
        </div>
        <div className="border-b border-line2 px-4 py-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your prompts" aria-label="Search your prompts" className="inset h-8 w-full border border-line px-2 text-[12.5px] focus:border-accent focus:outline-none" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {groups.length === 0 && <p className="py-10 text-center text-[13px] text-muted">Nothing yet — every prompt you send, and the text before and after each right-click rewrite, is kept here.</p>}
          {groups.map(([k, es]) => (
            <section key={k} className={cx("mb-4 border p-2.5", k === cur ? "border-accent/60" : "border-line2")}>
              <div className="mb-2 flex items-center gap-2">
                {es[0].pics.length ? es[0].pics.map((p) => <img key={p.name} src={p.url} alt="" title={p.label ?? p.name} className="h-12 w-9 border border-line object-cover" />) : <span className="text-[12px] text-dim">No pictures — words only</span>}
                <span className="ml-auto text-[11.5px] text-dim">{k === cur ? "the pictures in now · " : ""}{es.length} prompt{es.length > 1 ? "s" : ""}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {es.map((e) => (
                  <div key={e.id} className="group border border-line2 bg-raised/40 px-2.5 py-2">
                    <div className="mb-1 flex items-center gap-2 text-[11px] text-dim"><span>{ago(e.at)}</span><span className="micro">{WHY[e.why]}</span>
                      <button className="ml-auto opacity-0 hover:text-bad group-hover:opacity-100" title="Remove from history" onClick={() => forget(e.id)}><Icon name="trash" size={11} /></button></div>
                    <p className="line-clamp-4 whitespace-pre-wrap text-[12.5px] leading-snug text-ink/90">{e.text}</p>
                    <div className="mt-1.5 flex gap-1.5">
                      <button className="press border border-line px-2 py-0.5 text-[11.5px] text-muted hover:text-ink" onClick={() => use(e, false)}>Use this prompt</button>
                      {k !== cur && e.pics.length > 0 && canRestorePics(tab) && <button className="press border border-accent/60 px-2 py-0.5 text-[11.5px] text-accent" onClick={() => use(e, true)}>Use with its pictures</button>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </aside>
    </div>, document.body);
}
