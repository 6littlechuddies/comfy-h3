// Your own checkpoints: Krea 2 / Anima / Illustrious fine-tunes from CivitAI (Muse, gonzaLomo…), picked per model.
// Added by link, kept in your models library and re-downloaded on every rental (like LoRAs).
import { useEffect, useState } from "react";
import { create } from "zustand";
import { installLora, myModels, type LoraJob, type MyModel } from "../lib/api";
import { useJobs } from "../lib/jobs";
import { Btn, Help, Icon, cx, DropSelect } from "./ui";

const useModels = create<{ items: MyModel[]; v: number }>(() => ({ items: [], v: 0 }));
export const bumpModels = () => useModels.setState((s) => ({ v: s.v + 1 }));
function useMyModels() {
  const v = useModels((s) => s.v);
  useEffect(() => { myModels().then((r) => useModels.setState({ items: r.items })).catch(() => {}); }, [v]);
  return useModels((s) => s.items);
}
const FAMILY_OF: Record<string, string> = { anima: "anima", noob: "sdxl", krea2: "krea2", krea2raw: "krea2" };
const OFFICIAL: Record<string, string> = { anima: "Anima base 1.0", noob: "Illustrious · NoobAI-XL 1.1", krea2: "Krea 2 Turbo", krea2raw: "Krea 2 RAW" };

const MODEL_OF_FAMILY: Record<string, string> = { anima: "anima", sdxl: "noob", krea2: "krea2" };
const GROUP: Record<string, string> = { krea2: "Realistic · Krea 2", anima: "Anime · Anima", noob: "Anime · Illustrious" };

/** "Checkpoint": the official model or one of your own fine-tunes for it; "+ Add" takes a CivitAI link.
 *  With onModel, every model's checkpoints are listed together and picking one of another model switches to that model. */
export function CheckpointPicker({ model, value, onChange, onModel, models = ["krea2", "anima", "noob"] }: { model: string; value: string | undefined; onChange: (v: string) => void;
  onModel?: (model: string, ckpt: string) => void; models?: string[] }) {
  const all = useMyModels();
  const fam = FAMILY_OF[model];
  const mine = all.filter((m) => m.family === fam);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState("");
  const [job, setJob] = useState<LoraJob | null>(null);
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
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="lbl">Checkpoint<Help text="The official model, or your own fine-tune of it from CivitAI (e.g. a Krea 2 or Anima merge). Your own ones download once and come back on every rental." /></span>
        <button className="micro text-muted hover:text-ink" onClick={() => setAdding((a) => !a)}>{adding ? "CANCEL" : "+ ADD FROM CIVITAI"}</button>
      </div>
      {onModel ? (
        <DropSelect value={`${model}|${cur ? cur.name : ""}`} aria-label="Checkpoint"
          onChange={(e) => { const [mo, ...rest] = e.target.value.split("|"); const ck = rest.join("|"); if (mo === model) onChange(ck); else onModel(mo, ck); }}
          className="inset h-9 border border-line bg-raised px-2.5 text-[13px] focus:border-accent focus:outline-none">
          {models.map((mo) => (
            <optgroup key={mo} label={GROUP[mo] ?? mo}>
              <option value={`${mo}|`}>{OFFICIAL[mo]} (official)</option>
              {all.filter((x) => x.family === FAMILY_OF[mo]).map((x) => <option key={x.name} value={`${mo}|${x.name}`} disabled={!x.here}>{x.title}{x.version ? ` · ${x.version}` : ""}{x.here ? "" : " (downloading…)"}</option>)}
            </optgroup>
          ))}
        </DropSelect>
      ) : (
        <DropSelect value={cur ? cur.name : ""} onChange={(e) => onChange(e.target.value)} aria-label="Checkpoint"
          className="inset h-9 border border-line bg-raised px-2.5 text-[13px] focus:border-accent focus:outline-none">
          <option value="">{OFFICIAL[model]} (official)</option>
          {mine.map((m) => <option key={m.name} value={m.name} disabled={!m.here}>{m.title}{m.version ? ` · ${m.version}` : ""}{m.here ? "" : " (downloading…)"}</option>)}
        </DropSelect>
      )}
      {value && !cur && <p className="text-[11.5px] text-bad">That checkpoint isn't in your models any more — using the official one.</p>}
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
