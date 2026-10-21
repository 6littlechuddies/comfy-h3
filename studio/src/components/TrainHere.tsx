import { useEffect, useState } from "react";
import { useCharacters, type Character, type TrainItem } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { Btn, Seg } from "./ui";
import { ModelsNotice } from "./Workspace";

interface Run { id: string; status: "running" | "done" | "error" | "cancelled"; step: string; done: number; total: number; loss?: number; left?: string; lora?: string; error?: string; log?: string[]; backed_up?: boolean; char_id?: string }

const KEY = (id: string) => `h3.train.${id}`;

/** Training set → train the character's Krea 2 LoRA on this rental (musubi-tuner); the LoRA joins their identity card */
export function TrainHere({ c, kept }: { c: Character; kept: TrainItem[] }) {
  const toast = useJobs((s) => s.toast);
  const [steps, setSteps] = useState(1500);
  const [run, setRun] = useState<Run | null>(null);
  const [ready, setReady] = useState<{ missing: string[]; vram_mb: number } | null>(null);
  const [id, setId] = useState<string | null>(() => { try { return localStorage.getItem(KEY(c.id)); } catch { return null; } });
  useEffect(() => { fetch("/studio-api/train/ready").then((r) => r.json()).then(setReady).catch(() => {}); }, [c.id]);
  useEffect(() => {
    if (!id) return;
    let live = true;
    const tick = async () => {
      const r = await fetch(`/studio-api/train/${id}`);
      if (!r.ok) { if (live) { setRun(null); setId(null); try { localStorage.removeItem(KEY(c.id)); } catch { /* */ } } return; }
      const j: Run = await r.json();
      if (!live) return;
      setRun(j);
      if (j.status === "done" && j.lora) {
        const cur = useCharacters.getState().list.find((x) => x.id === c.id);
        if (cur && !(cur.loras ?? []).some((l) => l.name === j.lora)) {
          useCharacters.getState().save({ ...cur, loras: [...(cur.loras ?? []).map((l) => (/_krea2_\d+\.safetensors$/.test(l.name) ? { ...l, off: true } : l)), { name: j.lora, strength: 1, trigger: cur.trainset?.trigger }] });
          toast(`${c.name}'s LoRA is trained and on their identity card (strength 1.0, trigger “${cur.trainset?.trigger ?? ""}”). An older trained one is switched off, not removed.`, "good", "characters");
        }
      }
      if (j.status === "running") setTimeout(() => live && tick(), 3000);
    };
    tick();
    return () => { live = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    const r = await fetch("/studio-api/train", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ char_id: c.id, name: c.name, trigger: c.trainset?.trigger, steps, items: kept.map((x) => ({ file: x.file, caption: x.caption })) }) });
    const j = await r.json();
    if (!r.ok) return toast(j.error ?? "Couldn't start training", "bad");
    setId(j.id); try { localStorage.setItem(KEY(c.id), j.id); } catch { /* */ }
    toast("Training started — the GPU is the trainer's until it's done; don't make pictures or videos meanwhile.", "info", "characters");
  };
  const [testing, setTesting] = useState<string | null>(null);
  const test = async () => {
    setTesting("Making 6 test pictures…");
    try {
      const { testLora } = await import("../lib/loraTest");
      const r = await testLora(useCharacters.getState().list.find((x) => x.id === c.id) ?? c, setTesting);
      const verdict = r.avg == null ? "couldn't score the faces — look at the 6 pictures yourself" : r.avg >= 7.5 && r.good >= r.scored - 1 ? "good — the face holds from every angle" : r.avg >= 6 ? "so-so — usable, but a training set with more side and back pictures (or Thorough) would hold better" : "weak — the face drifts; build a bigger, more varied set and train again";
      toast(`${c.name}'s LoRA test: ${r.good} of ${r.scored} faces match${r.avg != null ? ` (average ${r.avg.toFixed(1)}/10)` : ""} — ${verdict}. Also check the back-of-hair picture in the results.`, r.avg != null && r.avg >= 7.5 ? "good" : "info", "characters");
    } catch (e) { toast((e as Error).message, "bad", "characters"); } finally { setTesting(null); }
  };
  const hasLora = (c.loras ?? []).some((l) => !l.off);
  const cancel = async () => { if (id) await fetch(`/studio-api/train/${id}/cancel`, { method: "POST" }); };
  const busy = run?.status === "running";
  const mins = Math.round((steps * 2.2) / 60);
  const realistic = c.style === "realistic";
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3 text-[12.5px]">
      <b className="font-medium">Train their LoRA here</b>
      {!realistic && <p className="text-[11.5px] text-dim">This trains a Krea 2 LoRA. {c.name} is an anime character (Anima / Illustrious) — use the .zip with an SDXL/Anima trainer for now.</p>}
      {ready && ready.missing.length > 0 && <ModelsNotice id="trainer" />}
      {ready && ready.missing.length > 0 && <p className="text-[11.5px] text-dim">Needs: {ready.missing.join(", ")}.</p>}
      {!busy && <Seg label="How long" value={steps} onChange={setSteps} options={[{ value: 1000, label: "Quick" }, { value: 1500, label: "Normal" }, { value: 2500, label: "Thorough" }]} />}
      {!busy && <Btn kind="primary" onClick={start} disabled={!realistic || kept.length < 10 || !!ready?.missing.length} why={!realistic ? "Krea 2 LoRAs are for realistic characters" : kept.length < 10 ? "Keep at least 10 good pictures (15–40 is best)" : "Download “Character LoRA training” first"}>
        Train on {kept.length} pictures · ~{mins} min</Btn>}
      {run && (
        <div className="flex flex-col gap-1.5 rounded-md border border-line bg-raised/60 p-2">
          <div className="flex items-center gap-2"><span className="flex-1">{run.status === "running" ? (run.step === "training" ? `Training · step ${run.done} of ${run.total}${run.left ? ` · ${run.left} left` : ""}` : `${run.step[0].toUpperCase()}${run.step.slice(1)}…`) : run.status === "done" ? "Trained ✓" : run.status === "cancelled" ? "Cancelled" : "Stopped"}</span>
            {busy && <button className="text-[12px] text-muted hover:text-bad" onClick={cancel}>Cancel</button>}</div>
          {run.step === "training" && run.total > 0 && <div className="h-1.5 bg-raised2"><div className="h-full bg-accent transition-[width] duration-700" style={{ width: `${Math.round((run.done / run.total) * 100)}%` }} /></div>}
          {run.loss != null && busy && <span className="text-[11px] text-dim">loss {run.loss.toFixed(3)} — it wobbles; a slow drift down is good</span>}
          {run.status === "done" && <span className="text-[11.5px] text-muted">{run.lora?.split("/").pop()} {run.backed_up ? "· backed up, on every rental" : "· on this rental (add a backup in the template to keep it)"}. Try it: Create with {c.name}, their trigger word is added for you.</span>}
          {run.status === "error" && <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[10.5px] text-bad">{run.error}</pre>}
          {busy && run.log?.length ? <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[10px] text-dim">{run.log.slice(-5).join("\n")}</pre> : null}
        </div>
      )}
      {hasLora && !busy && (
        <div className="flex flex-col gap-1">
          <Btn onClick={test} disabled={!!testing}>{testing ?? "Test their LoRA · 6 pictures"}</Btn>
          <span className="text-[11.5px] leading-relaxed text-dim">From words + the LoRA only (no reference picture): laughing, three-quarter, profile, over the shoulder, back of the hair, low angle — then each face is scored against their picture. Good = 7+ on nearly all.</span>
        </div>
      )}
      <p className="text-[11.5px] leading-relaxed text-dim">Trains on Krea 2 RAW (musubi-tuner, rank 32, fp8), then the LoRA is used on Turbo everywhere {c.name} appears. On a 5090 about 2 s per step — the time above is an estimate. Make pictures again when it's done.</p>
    </div>
  );
}
