// Batch → Live packs: pick characters, paste (or drop screenshots of) what other creators offer as tips / call actions,
// and each character gets her own actions planned in her manner, her still, and every clip made and fitted to its joins.
// Sending stays per character, after you've watched her reel.
import { Thumb } from "./Thumb";
import { useRef, useState } from "react";
import { uploadFile, viewUrl } from "../lib/api";
import { coverOf, useCharacters } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { liveBatch, liveOf, useLiveBatch, type LiveAction } from "../lib/live";
import { openLivePack } from "./LivePack";
import { Btn, Icon, cx } from "./ui";

const LS = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const SAVE = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };
export const liveExamples = () => LS("h3.live.examples", "");
export const liveExamplePics = (): string[] => { try { return JSON.parse(LS("h3.live.pics", "[]")); } catch { return []; } };

export function LiveBatchPanel() {
  const chars = useCharacters((s) => s.list);
  const { runs, running } = useLiveBatch();
  const toast = useJobs((s) => s.toast);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [examples, setExamples] = useState(liveExamples);
  const [pics, setPics] = useState<string[]>(liveExamplePics);
  const [count, setCount] = useState(() => Number(LS("h3.live.count", "8")) || 8);
  const [ratings, setRatings] = useState<LiveAction["rating"][]>(() => { try { return JSON.parse(LS("h3.live.ratings", '["sfw"]')); } catch { return ["sfw"]; } });
  const [replan, setReplan] = useState(false);
  const [still, setStill] = useState<"new" | "sheet" | "keep">(() => (LS("h3.live.still", "new") as "new"));
  const file = useRef<HTMLInputElement>(null);
  const onSite = (c: (typeof chars)[number]) => !!c.site?.sent?.ok;
  const addPics = async (fs: File[]) => {
    const names: string[] = [];
    for (const f of fs.filter((x) => x.type.startsWith("image/")).slice(0, 6)) names.push((await uploadFile(f)).name);
    const next = [...pics, ...names].slice(-6); setPics(next); SAVE("h3.live.pics", JSON.stringify(next));
  };
  const go = () => {
    SAVE("h3.live.examples", examples); SAVE("h3.live.count", String(count)); SAVE("h3.live.ratings", JSON.stringify(ratings)); SAVE("h3.live.still", still);
    void liveBatch([...sel], { examples, pictures: pics, count, ratings, replan, still }).then(() => toast("Live packs: everything is made — open each one, watch its reel, tick the clips and send", "good"));
  };
  return (
    <div className="flex flex-col gap-4 border border-line p-3">
      <div>
        <p className="text-[14px] font-semibold">Live packs</p>
        <p className="text-[12px] leading-relaxed text-muted">Her still, her room and a ladder of stream tips and call buttons in her own manner — every clip made and fitted to its joins while you're away. You check each pack by eye, then send.</p>
      </div>
      <Step n={1} title="Who" aside={<span className="flex gap-2"><button className="underline-offset-2 hover:text-ink hover:underline" onClick={() => setSel(new Set(chars.filter(onSite).map((c) => c.id)))}>All on the site ({chars.filter(onSite).length})</button>
          {sel.size > 0 && <button className="hover:text-ink" onClick={() => setSel(new Set())}>Clear</button>}</span>}>
        <div className="grid max-h-60 grid-cols-4 gap-1.5 overflow-y-auto pr-0.5">
          {chars.map((c) => {
            const on = sel.has(c.id); const f = coverOf(c); const l = c.live ? liveOf(c) : null;
            const made = l ? Object.values(l.clips).filter((x) => x.status === "ready").length : 0;
            return (
              <button key={c.id} onClick={() => { const n = new Set(sel); if (on) n.delete(c.id); else n.add(c.id); setSel(n); }} aria-pressed={on}
                title={`${c.name}${onSite(c) ? "" : " — not on the site yet: clips can be made, send her first before the pack"}${made ? ` · ${made} clips made` : ""}`}
                className={cx("press group relative flex flex-col overflow-hidden border text-left", on ? "border-accent" : "border-line hover:border-line2", !onSite(c) && "opacity-55")}>
                <span className="aspect-[3/4] w-full bg-raised2">{f && <Thumb f={f} className="h-full w-full object-cover" />}</span>
                <span className={cx("truncate px-1 py-0.5 text-[10.5px]", on ? "bg-accent text-accentink" : "text-muted")}>{c.site?.name || c.name}</span>
                {made > 0 && <span className="absolute right-0.5 top-0.5 bg-black/75 px-1 text-[9.5px] text-accent" title={`${made} clips made`}>{made}</span>}
              </button>);
          })}
        </div>
      </Step>
      <Step n={2} title="What other creators offer" note="Tip menus, action lists, descriptions of their clips. The writer learns the range, pacing and price steps — then writes hers for each character, never copied.">
        <textarea value={examples} onChange={(e) => setExamples(e.target.value)} rows={6} placeholder={"Blow a kiss — 20 tokens\nHair flip — 25\nShow your outfit (slow turn) — 60\nLean in and whisper — 80\n…"}
          className="inset border border-line p-2 font-mono text-[11.5px] leading-relaxed text-ink focus:border-accent focus:outline-none" />
        <div className="flex flex-wrap items-center gap-1.5">
          {pics.map((n) => (
            <span key={n} className="relative h-14 w-10 overflow-hidden border border-line">
              <img src={viewUrl({ filename: n, subfolder: "", type: "input" })} alt="" className="h-full w-full object-cover" />
              <button aria-label="Remove screenshot" onClick={() => { const next = pics.filter((x) => x !== n); setPics(next); SAVE("h3.live.pics", JSON.stringify(next)); }} className="absolute right-0 top-0 bg-black/75 px-1 text-[10px] text-white hover:bg-bad">×</button>
            </span>))}
          <button onClick={() => file.current?.click()} title="Screenshots of other creators' tip menus or action buttons — the writer reads them (up to 6)"
            className="press flex h-14 w-10 flex-col items-center justify-center gap-0.5 border border-dashed border-line2 text-[9.5px] text-muted hover:border-accent hover:text-ink"><Icon name="up" size={12} />Shots</button>
          <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void addPics(fs); }} />
        </div>
      </Step>
      <Step n={3} title="Her ladder">
        <div className="flex items-center gap-2 text-[12.5px] text-muted">
          <span>Actions each</span>
          <input type="range" min={1} max={24} value={count} onChange={(e) => setCount(Number(e.target.value))} className="min-w-0 flex-1 accent-accent" aria-label="Actions each" />
          <b className="w-6 text-right tabular-nums text-ink">{count}</b>
        </div>
        <div className="flex flex-wrap gap-1">
          {(["sfw", "suggestive", "explicit"] as const).map((r) => { const on = ratings.includes(r); return (
            <button key={r} aria-pressed={on} onClick={() => setRatings(on ? (ratings.filter((x) => x !== r).length ? ratings.filter((x) => x !== r) : ratings) : [...ratings, r])}
              className={cx("press tag-btn !h-7 !px-2.5 !text-[11.5px]", on && "on")}>{r === "sfw" ? "SFW" : r === "suggestive" ? "Suggestive" : "Explicit · paid fans"}</button>); })}
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-muted" title="Plan again for characters that already have a ladder (clips of actions it keeps stay)"><input type="checkbox" checked={replan} onChange={(e) => setReplan(e.target.checked)} /> Plan again where she already has one</label>
      </Step>
      <Step n={4} title="Her still">
        <div role="radiogroup" aria-label="Her still" className="flex flex-col gap-1">
          {([["new", "A new webcam still", "The writer picks her room — bedroom, desk, sofa, whatever fits her — and words every action for it. Made from her reference sheet (one is made first if she has none)."],
            ["sheet", "Her sheet picture", "Her front picture as it is."], ["keep", "Keep the one she has", "Only characters without a still get one."]] as const).map(([v, t, d]) => (
            <button key={v} role="radio" aria-checked={still === v} onClick={() => setStill(v)}
              className={cx("press flex items-start gap-2 border px-2 py-1.5 text-left", still === v ? "border-accent bg-accent/5" : "border-line hover:border-line2")}>
              <span className={cx("mt-1 h-2.5 w-2.5 shrink-0 rounded-full border", still === v ? "border-accent bg-accent" : "border-line2")} />
              <span className="min-w-0"><span className="block text-[12.5px] text-ink">{t}</span>{still === v && <span className="block text-[11px] leading-snug text-dim">{d}</span>}</span>
            </button>))}
        </div>
      </Step>
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <div className="flex justify-between text-[12px] text-muted"><span>{sel.size} character{sel.size === 1 ? "" : "s"} · about {Math.round(sel.size * (3 + count * 2))} clips</span><span title="A rough guess — time your first character for the real rate">~{Math.max(1, Math.round(sel.size * (3 * 6 + count * 8) * 3.5 / 60))} min of GPU</span></div>
        <Btn kind="primary" onClick={go} disabled={!sel.size || running} why={running ? "Already running" : "Pick characters first"}><Icon name="play" size={14} /> Plan and make {sel.size || ""} live pack{sel.size === 1 ? "" : "s"}</Btn>
        <Btn onClick={async () => {
          const { sendReady } = await import("../lib/live");
          const r = await sendReady([...sel]);
          toast(`Live packs: ${r.sent.length} sent${r.skipped.length ? ` · ${r.skipped.length} not ready (clips to make or tick: ${r.skipped.slice(0, 4).join(", ")}${r.skipped.length > 4 ? "…" : ""})` : ""}${r.failed.length ? ` · ${r.failed.length} refused — open them to see why` : ""}`, r.failed.length ? "bad" : "good");
        }} disabled={!sel.size || running} why={running ? "Still making" : "Pick characters first"} title="Every picked character whose pack is made and checked by eye goes to the site in one go (drafts until published there)"><Icon name="up" size={14} /> Send the ready packs</Btn>
        <p className="text-[11px] leading-snug text-dim">The site's first test: one character, 4 SFW actions.</p>
      </div>
      {runs.length > 0 && (
        <ul className="flex flex-col border border-line">
          {runs.map((r) => (
            <li key={r.cid}>
              <button onClick={() => openLivePack(r.cid)} title={`${r.error ?? r.step} — open her pack`} className="press flex w-full items-center gap-2 px-2.5 py-2 text-left text-[12px] hover:bg-hover">
                <span className={cx("h-2 w-2 shrink-0 rounded-full", r.error ? "bg-bad" : r.done ? "bg-good" : "pulse bg-accent")} />
                <span className="min-w-0 flex-1"><b className="block truncate text-[12.5px]">{r.name}</b>
                  <span className={cx("block truncate", r.error ? "text-bad" : "text-dim")}>{r.error ?? r.step}</span></span>
                <Icon name="chev" size={11} className="shrink-0 text-dim" />
              </button>
            </li>))}
        </ul>)}
    </div>
  );
}

/** one step of the setup, numbered because they're done in order */
function Step({ n, title, note, aside, children }: { n: number; title: string; note?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center border border-line2 text-[11px] tabular-nums text-muted">{n}</span>
        <h4 className="text-[13px] font-semibold">{title}</h4>
        {aside && <span className="ml-auto text-[11.5px] text-muted">{aside}</span>}
      </div>
      {note && <p className="text-[11.5px] leading-snug text-dim">{note}</p>}
      {children}
    </section>
  );
}
