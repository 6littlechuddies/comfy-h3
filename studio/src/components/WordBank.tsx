// Word bank panel (Create): the words from every CivitAI picture you've opened, sorted by what they describe.
// Click a word to add it to the prompt, click again to take it out. Shared by all projects.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { allTerms, hasTerm, toggleTerm, useWordBank, type BankTerm } from "../lib/wordbank";
import { CAT_LABEL, CAT_ORDER, type PieceCat } from "../lib/tweak";
import { Icon, cx } from "./ui";

const CATS = CAT_ORDER.filter((c) => c !== "lora");

export function WordBankButton({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const n = useWordBank((s) => s.refs.length);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        title="Words from the CivitAI pictures you've opened — click to add them to the prompt"
        className={cx("press chip-raised inline-flex h-8 items-center gap-1.5 rounded-sm pl-2.5 pr-3 text-[12.5px] font-medium text-ink", open && "ring-1 ring-accent")}>
        <Icon name="script" size={13} className="text-muted" />Word bank{n ? <span className="text-dim">{n}</span> : null}
      </button>
      {open && <WordBank value={value} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

function WordBank({ value, onChange, onClose }: { value: string; onChange: (v: string) => void; onClose: () => void }) {
  const bank = useWordBank(useShallow((s) => ({ refs: s.refs, mine: s.mine, hidden: s.hidden, loaded: s.loaded })));
  const [cat, setCat] = useState<PieceCat | "all">(() => { try { return (localStorage.getItem("h3.bank.cat") as PieceCat) || "all"; } catch { return "all"; } });
  const [view, setView] = useState<"words" | "pictures">("words");
  const [q, setQ] = useState("");
  const [own, setOwn] = useState("");
  useEffect(() => { try { localStorage.setItem("h3.bank.cat", cat); } catch { /* */ } }, [cat]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const terms = useMemo(() => allTerms(bank), [bank]);
  const ql = q.trim().toLowerCase();
  const match = (t: BankTerm) => (cat === "all" || t.cat === cat) && (!ql || t.t.toLowerCase().includes(ql));
  const shown = terms.filter(match);
  const counts = useMemo(() => { const c: Partial<Record<PieceCat, number>> = {}; for (const t of terms) c[t.cat] = (c[t.cat] ?? 0) + 1; return c; }, [terms]);
  const byCat = CATS.map((c) => [c, shown.filter((t) => t.cat === c)] as const).filter(([, l]) => l.length);
  const picked = terms.filter((t) => hasTerm(value, t.t)).length;

  const word = (t: BankTerm & { n?: number; mine?: boolean }, key: string) => {
    const on = hasTerm(value, t.t);
    return (
      <span key={key} className="group relative inline-flex">
        <button type="button" onClick={() => onChange(toggleTerm(value, t.t))} title={on ? "In the prompt — click to take it out" : "Add to the prompt"}
          className={cx("press max-w-full rounded-sm border px-2 py-1 text-left text-[12.5px] leading-snug",
            on ? "border-accent bg-accent/15 text-ink" : "border-line bg-raised2 text-ink/90 hover:border-muted")}>
          {t.t}{t.n && t.n > 1 ? <span className="ml-1.5 text-[11px] text-dim">{t.n}</span> : null}{t.mine ? <span className="ml-1.5 text-[11px] text-accent">yours</span> : null}
        </button>
        <button type="button" aria-label={`Remove “${t.t}” from the bank`} title="Remove from the bank"
          onClick={() => useWordBank.getState().hide(t.t)}
          className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full border border-line bg-panel text-[10px] text-muted hover:text-bad group-hover:flex">×</button>
      </span>
    );
  };

  return createPortal(
    <aside role="dialog" aria-label="Word bank" className="fade-in fixed bottom-0 right-0 top-0 z-[90] flex w-[min(440px,100vw)] flex-col border-l border-line bg-panel shadow-2xl">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line2 px-4">
        <div className="min-w-0 flex-1">
          <div className="display text-[17px] leading-tight">Word bank</div>
          <div className="text-[12px] text-dim">{bank.refs.length} picture{bank.refs.length === 1 ? "" : "s"} · {terms.length} words · {picked} in your prompt · every project</div>
        </div>
        <button onClick={onClose} aria-label="Close word bank" className="press flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:text-ink"><Icon name="x" size={16} /></button>
      </div>

      <div className="flex shrink-0 flex-col gap-2.5 border-b border-line2 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 flex-1 items-center gap-2 border border-line bg-raised2 px-2.5">
            <Icon name="search" size={13} className="text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a word…" aria-label="Find a word" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-dim focus:outline-none" />
          </div>
          <div className="flex h-8 border border-line text-[12px]">
            {(["words", "pictures"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cx("px-2.5", view === v ? "bg-raised2 text-ink" : "text-muted hover:text-ink")}>{v === "words" ? "Words" : "By picture"}</button>
            ))}
          </div>
        </div>
        {view === "words" && (
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setCat("all")} className={cx("rounded-sm px-2 py-0.5 text-[12px]", cat === "all" ? "bg-accent/15 text-ink ring-1 ring-accent" : "text-muted hover:text-ink")}>All</button>
            {CATS.filter((c) => counts[c]).map((c) => (
              <button key={c} onClick={() => setCat(c)} className={cx("rounded-sm px-2 py-0.5 text-[12px]", cat === c ? "bg-accent/15 text-ink ring-1 ring-accent" : "text-muted hover:text-ink")}>
                {CAT_LABEL[c]} <span className="text-dim">{counts[c]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!bank.refs.length && !bank.mine.length ? (
          <div className="flex flex-col gap-2 py-6 text-[13px] leading-relaxed text-muted">
            <b className="text-ink">Nothing here yet.</b>
            <span>Open a CivitAI picture — paste its link in Import, pick one from a collection, or click one in Browse LoRAs. Its prompt lands here, cut into words you can click into any prompt.</span>
          </div>
        ) : view === "words" ? (
          shown.length ? (
            cat === "all" && !ql
              ? byCat.map(([c, l]) => (
                <section key={c} className="mb-4">
                  <h3 className="mb-1.5 text-[12px] font-semibold text-muted">{CAT_LABEL[c]}</h3>
                  <div className="flex flex-wrap gap-1.5">{l.slice(0, 60).map((t) => word(t, t.t))}</div>
                  {l.length > 60 && <button onClick={() => setCat(c)} className="mt-1.5 text-[12px] text-accent hover:underline">All {l.length} {CAT_LABEL[c].toLowerCase()} words</button>}
                </section>
              ))
              : <div className="flex flex-wrap gap-1.5">{shown.map((t) => word(t, t.t))}</div>
          ) : <p className="py-4 text-[13px] text-muted">No words match{ql ? ` “${q}”` : ""}.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {bank.refs.filter((r) => !ql || r.prompt.toLowerCase().includes(ql)).map((r) => {
              const hidden = new Set(bank.hidden);
              const ts = r.terms.filter((t) => !hidden.has(t.t.toLowerCase()));
              return (
                <div key={r.id} className="flex gap-3 border border-line p-2.5">
                  {r.thumb ? <img src={r.thumb} alt="" loading="lazy" className="h-24 w-16 shrink-0 bg-black object-cover" onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} /> : <div className="h-24 w-16 shrink-0 bg-raised2" />}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-[12px] text-dim">
                      <span className="truncate">{r.base || "CivitAI"} · {new Date(r.at).toLocaleDateString()}</span>
                      {r.page && <a href={r.page} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" title="Open on CivitAI"><Icon name="external" size={12} /></a>}
                      <button onClick={() => { let p = value; for (const t of ts) if (!hasTerm(p, t.t)) p = toggleTerm(p, t.t); onChange(p); }} className="ml-auto text-accent hover:underline">Add all</button>
                      <button onClick={() => useWordBank.getState().remove(r.id)} aria-label="Remove this picture from the bank" title="Remove this picture" className="text-muted hover:text-bad"><Icon name="trash" size={12} /></button>
                    </div>
                    <div className="flex flex-wrap gap-1">{ts.map((t, i) => word(t, `${r.id}:${i}`))}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <form className="flex shrink-0 items-center gap-2 border-t border-line2 px-4 py-3" onSubmit={(e) => { e.preventDefault(); if (own.trim()) { useWordBank.getState().addMine(own); setOwn(""); } }}>
        <input value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Add your own word or phrase…" aria-label="Add your own word or phrase"
          className="h-8 min-w-0 flex-1 border border-line bg-raised2 px-2.5 text-[13px] text-ink placeholder:text-dim focus:border-accent focus:outline-none" />
        <button type="submit" disabled={!own.trim()} className="press btn-raised h-8 px-3 text-[12.5px] font-medium disabled:opacity-40">Add</button>
        {bank.hidden.length > 0 && <button type="button" onClick={() => useWordBank.getState().clearHidden()} className="text-[12px] text-muted hover:text-ink" title="Bring back the words you removed">Undo removals ({bank.hidden.length})</button>}
      </form>
    </aside>,
    document.body,
  );
}
