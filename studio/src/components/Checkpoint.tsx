// Your own checkpoints: Krea 2 / Anima / Illustrious fine-tunes from CivitAI (Muse, gonzaLomo…), picked per model.
// Added by link, kept in your models library and re-downloaded on every rental (like LoRAs).
import { useEffect, useState, type ReactNode } from "react";
import { create } from "zustand";
import { fetchMissingModels, forgetModel, installLora, myModels, type LoraJob, type MyModel } from "../lib/api";
import { useJobs } from "../lib/jobs";
import { Btn, Help, Icon, cx, DropSelect } from "./ui";

const useModels = create<{ items: MyModel[]; v: number }>(() => ({ items: [], v: 0 }));
export const bumpModels = () => useModels.setState((s) => ({ v: s.v + 1 }));
function useMyModels() {
  const v = useModels((s) => s.v);
  const items = useModels((s) => s.items);
  useEffect(() => {
    let live = true;
    const load = () => myModels().then((r) => { if (live) useModels.setState({ items: r.items }); }).catch(() => {});
    load();
    return () => { live = false; };
  }, [v]);
  // Live-poll every 4 s while any checkpoint is actively downloading so the dropdown unlocks automatically (no page reload needed)
  const anyActive = items.some((m) => !m.here && m.downloading);
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => {
      myModels().then((r) => useModels.setState({ items: r.items })).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [anyActive]);
  return items;
}
function statusSuffix(m: MyModel): string {
  if (m.here) return "";
  if (m.downloading) {
    if (m.progress && m.progress > 0.01) return ` (downloading ${Math.round(m.progress * 100)}%…)`;
    if (m.step) return ` (${m.step})`;
    return " (downloading…)";
  }
  if (m.problem) return " (failed)";
  if (m.step) return ` (${m.step})`;
  return " (not downloaded)";
}
const FAMILY_OF: Record<string, string> = { anima: "anima", noob: "sdxl", krea2: "krea2", krea2raw: "krea2" };
const OFFICIAL: Record<string, string> = { anima: "Anima base 1.0", noob: "Illustrious · NoobAI-XL 1.1", krea2: "Krea 2 Turbo", krea2raw: "Krea 2 RAW" };

const MODEL_OF_FAMILY: Record<string, string> = { anima: "anima", sdxl: "noob", krea2: "krea2" };
const GROUP: Record<string, string> = { krea2: "Realistic · Krea 2", anima: "Anime · Anima", noob: "Anime · Illustrious" };

/** "Checkpoint": the official model or one of your own fine-tunes for it; "+ Add" takes a CivitAI link.
 *  With onModel, every model's checkpoints are listed together and picking one of another model switches to that model. */
export function CheckpointPicker({ model, value, onChange, onModel, models = ["krea2", "anima", "noob"], follow, extra, right }: { model: string; value: string | undefined; onChange: (v: string) => void;
  onModel?: (model: string, ckpt: string) => void; models?: string[];
  /** an option above the official one that follows another setting (Batch: "Same as 03 Create" → value "@create") */
  follow?: string;
  /** more options above the official one: [value, label] (Batch: "@auto" → DeepSeek picks per character) */
  extra?: [string, string][];
  /** something beside the label (Batch: the lock) */
  right?: ReactNode }) {
  const all = useMyModels();
  const fam = FAMILY_OF[model];
  const mine = all.filter((m) => m.family === fam);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState("");
  const [job, setJob] = useState<LoraJob | null>(null);
  const [fetching, setFetching] = useState(false);
  const toast = useJobs((s) => s.toast);
  const add = async () => {
    if (!link.trim()) return;
    try {
      const r = await installLora(link.trim(), setJob);
      setJob(null);
      if (r.status !== "done" || !r.name) { toast(`Couldn't add it: ${r.error}`, "bad"); return; }
      if (r.kind !== "model") { toast(`“${r.title}” is a LoRA — it's in your LoRA library; add it from the LoRA list.`, "info"); return; }
      bumpModels();
      const other = r.family && r.family !== fam ? MODEL_OF_FAMILY[r.family] : undefined;
      if (r.family === fam) onChange(r.name);
      else if (other && onModel) onModel(other, r.name);
      toast(`Added “${r.title}”${r.family === fam ? " and switched to it" : other && onModel ? ` and switched to ${GROUP[other] ?? other} with it` : ` (a ${r.family} model — pick it there)`}. It comes back on every rental.`, "good");
      setLink(""); setAdding(false);
    } catch (e) { setJob(null); toast((e as Error).message, "bad"); }
  };
  if (!fam) return null;
  const cur = mine.find((m) => m.name === value);
  const startFetch = async (name?: string) => {
    setFetching(true);
    try {
      const r = await fetchMissingModels(name);
      bumpModels();
      if (r.started.length) toast(`Started downloading ${r.started.length} checkpoint${r.started.length > 1 ? "s" : ""}${!r.key ? " (note: no CivitAI key set — NSFW/gated models may fail)" : ""}.`, "info");
      else toast("Already downloading or already on disk.", "info");
    } catch (e) { toast((e as Error).message, "bad"); }
    finally { setFetching(false); }
  };
  const removeModel = async (m: MyModel) => {
    try {
      await forgetModel(m.name);
      if (value === m.name) onChange("");
      bumpModels();
      toast(`Removed “${m.title}” from your checkpoints list.`, "info");
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  const missingIdle = mine.filter((m) => !m.here && !m.downloading);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="lbl">Checkpoint<Help text="The official model, or your own fine-tune of it from CivitAI (e.g. a Krea 2 or Anima merge). Your own ones download once and come back on every rental." /></span>
        <span className="flex items-center gap-2">{right}<button className="micro text-muted hover:text-ink" onClick={() => setAdding((a) => !a)}>{adding ? "CANCEL" : "+ ADD FROM CIVITAI"}</button></span>
      </div>
      {onModel ? (
        <DropSelect value={`${model}|${cur ? cur.name : ""}`} aria-label="Checkpoint"
          onChange={(e) => { const [mo, ...rest] = e.target.value.split("|"); const ck = rest.join("|"); if (mo === model) onChange(ck); else onModel(mo, ck); }}
          className="inset h-9 border border-line bg-raised px-2.5 text-[13px] focus:border-accent focus:outline-none">
          {models.map((mo) => (
            <optgroup key={mo} label={GROUP[mo] ?? mo}>
              <option value={`${mo}|`}>{OFFICIAL[mo]} (official)</option>
              {all.filter((x) => x.family === FAMILY_OF[mo]).map((x) => <option key={x.name} value={`${mo}|${x.name}`}>{x.title}{x.version ? ` · ${x.version}` : ""}{statusSuffix(x)}</option>)}
            </optgroup>
          ))}
        </DropSelect>
      ) : (
        <DropSelect value={follow && value === "@create" ? "@create" : extra?.some(([v]) => v === value) ? value! : cur ? cur.name : ""} onChange={(e) => onChange(e.target.value)} aria-label="Checkpoint"
          className="inset h-9 border border-line bg-raised px-2.5 text-[13px] focus:border-accent focus:outline-none">
          {follow && <option value="@create">{follow}</option>}
          {extra?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          <option value="">{OFFICIAL[model]} (official)</option>
          {mine.map((m) => <option key={m.name} value={m.name}>{m.title}{m.version ? ` · ${m.version}` : ""}{statusSuffix(m)}</option>)}
        </DropSelect>
      )}
      {value && !value.startsWith("@") && !cur && <p className="text-[11.5px] text-bad">That checkpoint isn't in your models any more — pick another.</p>}
      {cur && !cur.here && (
        <div className="flex flex-col gap-1.5 border border-bad/40 bg-bad/5 px-2.5 py-2 text-[11.5px] leading-relaxed text-bad">
          {cur.downloading ? (
            <>
              <span>Downloading{cur.progress && cur.progress > 0.01 ? ` · ${Math.round(cur.progress * 100)}%` : cur.step ? ` · ${cur.step}` : "…"} (pictures wait for it, or pick another checkpoint meanwhile).</span>
              {cur.progress != null && cur.progress > 0 && (
                <div className="h-1 w-full bg-raised2"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(cur.progress * 100)}%` }} /></div>
              )}
            </>
          ) : cur.problem ? (
            <span>Failed to download: {cur.problem}</span>
          ) : cur.step ? (
            <span>{cur.step}. Click Download now to pull it immediately, or Remove if it's a duplicate.</span>
          ) : (
            <span>Not downloaded on this rental yet (not queued). Click Download now to pull it from CivitAI, or Remove if it's a duplicate.</span>
          )}
          <div className="flex items-center gap-2 pt-0.5">
            {!cur.downloading && <Btn small onClick={() => startFetch(cur.name)} disabled={fetching}>{cur.problem ? "Retry download" : "Download now"}</Btn>}
            <Btn small onClick={() => removeModel(cur)} title="Remove this entry from your checkpoints list (fixes stale duplicates)">Remove</Btn>
          </div>
        </div>
      )}
      {(!cur || cur.here) && missingIdle.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-[11.5px] text-dim">
          <span>{missingIdle.length} saved checkpoint{missingIdle.length > 1 ? "s" : ""} not downloaded on this rental</span>
          <button type="button" onClick={() => startFetch()} disabled={fetching} className="text-accent hover:underline disabled:opacity-50">{fetching ? "Starting…" : "Download missing"}</button>
        </div>
      )}
      {adding && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="civitai.com/models/…?modelVersionId=…"
              aria-label="CivitAI checkpoint link" className="inset h-9 min-w-0 flex-1 border border-line px-2.5 text-[12.5px] focus:border-accent focus:outline-none" />
            <Btn small onClick={add} disabled={!link.trim() || !!job} why={job ? "Downloading…" : "Paste a link"}>Add</Btn>
          </div>
          {job && <div className="flex items-center gap-2 text-[12px] text-muted"><div className="h-1 flex-1 bg-raised2"><div className={cx("h-full bg-accent")} style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} /></div>{job.title ?? "Starting…"}{job.total_mb ? ` · ${(job.total_mb / 1000).toFixed(1)} GB` : ""}</div>}
          <p className="text-[11.5px] text-dim">A Krea 2, Anima or Illustrious checkpoint (.safetensors). Big files take a few minutes.</p>
        </div>
      )}
      {!adding && mine.length === 0 && !onModel && <p className="text-[11.5px] text-dim"><Icon name="link" size={11} className="mr-1 inline" />No fine-tunes of this model yet.</p>}
    </div>
  );
}
