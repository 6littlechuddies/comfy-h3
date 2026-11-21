// Batch → Live packs: pick characters, paste (or drop screenshots of) what other creators offer as tips / call actions,
// and each character gets her own actions planned in her manner, her still, and every clip made and fitted to its joins.
// Sending stays per character, after you've watched her reel.
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
    <div className="flex flex-col gap-3 border border-line p-3">
      <div>
        <p className="text-[13.5px] font-semibold">Live packs</p>
        <p className="text-[12px] leading-relaxed text-muted">For each character: her still, her stream tips and call actions planned by the writer in her own manner (learning from your examples), and every clip made and fitted to its joins — a clip whose join jumps is made again by itself. Then open her pack, watch the reel, tick the clips and send.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2 text-[12.5px] text-muted">Characters <button className="text-[12px] underline-offset-2 hover:text-ink hover:underline" onClick={() => setSel(new Set(chars.filter(onSite).map((c) => c.id)))}>All on the site ({chars.filter(onSite).length})</button>
          {sel.size > 0 && <button className="text-[12px] hover:text-ink" onClick={() => setSel(new Set())}>Clear</button>}</span>
        <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
          {chars.map((c) => {
            const on = sel.has(c.id); const f = coverOf(c); const l = c.live ? liveOf(c) : null;
            const made = l ? Object.values(l.clips).filter((x) => x.status === "ready").length : 0;
            return (
              <button key={c.id} onClick={() => { const n = new Set(sel); if (on) n.delete(c.id); else n.add(c.id); setSel(n); }}
                title={`${c.name}${onSite(c) ? "" : " — not on the site yet: clips can be made, send her first before the pack"}${made ? ` · ${made} clips made` : ""}`}
                className={cx("press flex h-9 items-center gap-1.5 border pr-2 text-[12.5px]", on ? "border-accent bg-accent/10 text-ink" : "border-line text-muted hover:text-ink", !onSite(c) && "opacity-60")}>
                <span className="h-9 w-7 shrink-0 overflow-hidden bg-raised2">{f && <img src={viewUrl(f)} alt="" loading="lazy" className="h-full w-full object-cover" />}</span>
                <span className="max-w-[120px] truncate">{c.site?.name || c.name}</span>{made > 0 && <span className="text-[10.5px] text-accent">{made}</span>}
              </button>);
          })}
        </div>
      </div>
      <label className="flex flex-col gap-1 text-[12.5px] text-muted">Examples of what other creators offer <span className="text-[11.5px] text-dim">tip menus, action lists, descriptions of their clips — the writer learns the range and pacing, then makes hers fit each character (never copied word for word)</span>
        <textarea value={examples} onChange={(e) => setExamples(e.target.value)} rows={6} placeholder={"e.g.\nBlow a kiss — 20 tokens\nHair flip — 25\nShow your outfit (slow turn) — 60\nLean in and whisper — 80\n…"}
          className="inset border border-line p-2 font-mono text-[12px] leading-relaxed text-ink" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {pics.map((n) => (
          <span key={n} className="relative h-14 w-10 overflow-hidden border border-line">
            <img src={viewUrl({ filename: n, subfolder: "", type: "input" })} alt="" className="h-full w-full object-cover" />
            <button aria-label="Remove" onClick={() => { const next = pics.filter((x) => x !== n); setPics(next); SAVE("h3.live.pics", JSON.stringify(next)); }} className="absolute right-0 top-0 bg-black/70 px-0.5 text-[10px] text-white">×</button>
          </span>))}
        <Btn small onClick={() => file.current?.click()} title="Screenshots of other creators' tip menus or action buttons — the writer reads them (up to 6)"><Icon name="up" size={12} /> Add screenshots</Btn>
        <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void addPics(fs); }} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
        <label className="flex items-center gap-1.5">Actions each <input type="number" min={1} max={24} value={count} onChange={(e) => setCount(Math.max(1, Math.min(24, Number(e.target.value) || 8)))} className="inset h-8 w-14 border border-line px-1.5 text-ink" /></label>
        {(["sfw", "suggestive", "explicit"] as const).map((r) => (
          <label key={r} className="flex items-center gap-1"><input type="checkbox" checked={ratings.includes(r)} onChange={(e) => setRatings(e.target.checked ? [...ratings, r] : ratings.filter((x) => x !== r).length ? ratings.filter((x) => x !== r) : ratings)} />{r === "sfw" ? "SFW" : r === "suggestive" ? "Suggestive" : "Explicit (paid fans)"}</label>))}
        <label className="flex items-center gap-1" title="Plan again for characters that already have planned actions (clips of actions it keeps stay)"><input type="checkbox" checked={replan} onChange={(e) => setReplan(e.target.checked)} /> Plan again where planned</label>
      </div>
      <div className="flex flex-col gap-1 text-[12.5px] text-muted">Her still
        <div className="flex flex-wrap gap-1">
          {([["new", "A new webcam still (DeepSeek picks her room)"], ["sheet", "Her sheet picture"], ["keep", "Keep the one she has"]] as const).map(([v, t]) => (
            <button key={v} onClick={() => setStill(v)} className={cx("press tag-btn !h-8 !px-2.5 !text-[12px]", still === v && "on")}>{t}</button>))}
        </div>
        {still === "new" && <span className="text-[11.5px] leading-relaxed text-dim">The writer decides where she'd sit in front of the camera — her bedroom, desk, sofa, whatever fits who she is — and every action is worded for that place. Two takes are made with her face and body from her sheet; the first becomes her still (swap it in her Live pack).</span>}
      </div>
      <p className="text-[11.5px] text-dim">About {Math.round(sel.size * (3 + count * 2))} clips — roughly {Math.max(1, Math.round(sel.size * (3 * 6 + count * 8) * 3.5 / 60))} min of GPU time. The site's first test was one character, 3 idle loops and 4 SFW actions.</p>
      <Btn kind="primary" onClick={go} disabled={!sel.size || running} why={running ? "Already running" : "Pick characters first"}><Icon name="play" size={14} /> Plan and make {sel.size || ""} live pack{sel.size === 1 ? "" : "s"}</Btn>
      {runs.length > 0 && (
        <ul className="flex flex-col divide-y divide-line border border-line">
          {runs.map((r) => (
            <li key={r.cid} className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px]">
              <span className={cx("h-2 w-2 shrink-0 rounded-full", r.error ? "bg-bad" : r.done ? "bg-good" : "pulse bg-accent")} />
              <b className="w-32 shrink-0 truncate">{r.name}</b>
              <span className={cx("min-w-0 flex-1 truncate", r.error ? "text-bad" : "text-muted")} title={r.error ?? r.step}>{r.error ?? r.step}</span>
              <button onClick={() => openLivePack(r.cid)} className="shrink-0 text-muted underline-offset-2 hover:text-ink hover:underline">Open</button>
            </li>))}
        </ul>)}
    </div>
  );
}
