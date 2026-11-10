// "What these use": the LoRAs the pictures in a CivitAI collection were made with — most used first, with the strength
// people usually set — and the settings they share. Add any of the LoRAs to your library with one press.
import { useEffect, useState } from "react";
import { installLora } from "../lib/api";
import { useJobs } from "../lib/jobs";
import { Modal } from "./Dialogs";
import { Icon, cx } from "./ui";

interface Uses {
  pictures: number; told: number; more: boolean;
  loras: { version_id: number; model_id?: number; name: string; version: string; base: string; family: string; count: number; weight: number | null; installed: boolean }[];
  by_name: { name: string; count: number; weight: number | null }[];
  samplers: [string, number][]; steps: number | null; cfg: number | null; error?: string;
}

export function CollectionUses({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Uses | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<Record<number, string>>({});
  const toast = useJobs((s) => s.toast);
  useEffect(() => {
    let live = true;
    fetch(`/studio-api/civitai/collection-summary?id=${encodeURIComponent(id)}`).then(async (r) => {
      const j = await r.json().catch(() => null) as Uses | null;
      if (!live) return;
      if (!r.ok || !j) setErr(j?.error ?? `The rental answered ${r.status}`); else setD(j);
    }).catch((e) => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [id]);
  const add = async (l: Uses["loras"][number]) => {
    setBusy((b) => ({ ...b, [l.version_id]: "0%" }));
    try {
      const j = await installLora(`https://civitai.com/models/${l.model_id ?? 0}?modelVersionId=${l.version_id}`, (st) => setBusy((b) => ({ ...b, [l.version_id]: `${Math.round(((st.progress as number) ?? 0) * 100)}%` })));
      if (j.status !== "done") throw new Error(j.error ?? "the download failed");
      toast(`${l.name} added to your LoRAs`, "good");
      setD((cur) => cur && { ...cur, loras: cur.loras.map((x) => (x.version_id === l.version_id ? { ...x, installed: true } : x)) });
    } catch (e) { toast(`${l.name}: ${(e as Error).message}`, "bad"); }
    finally { setBusy((b) => { const n = { ...b }; delete n[l.version_id]; return n; }); }
  };
  return (
    <Modal onClose={onClose} width={680} label="What these pictures use">
      <div className="flex items-center border-b border-line px-4 py-3">
        <b className="text-[14px]">What these pictures use</b>
        {d && <span className="ml-2 text-[12px] text-muted">{d.told} of {d.pictures} pictures say how they were made{d.more ? " (the newest ones)" : ""}</span>}
        <button aria-label="Close" className="ml-auto text-muted hover:text-ink" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="max-h-[66vh] overflow-y-auto px-4 py-3 text-[13px]">
        {err && <p className="text-bad">{err}</p>}
        {!d && !err && <p className="text-muted">Reading how each picture was made… (up to a minute for a big collection)</p>}
        {d && (<>
          {(d.samplers.length > 0 || d.steps != null) && (
            <p className="mb-3 text-[12.5px] text-muted">Usual settings: {[d.samplers[0] && `sampler ${d.samplers[0][0]}`, d.steps != null && `${d.steps} steps`, d.cfg != null && `CFG ${d.cfg}`].filter(Boolean).join(" · ")}</p>
          )}
          {!d.loras.length && !d.by_name.length && <p className="text-muted">None of these pictures list the LoRAs they were made with.</p>}
          {d.loras.map((l) => (
            <div key={l.version_id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-line2 py-2 last:border-0">
              <span className="min-w-0"><span className="block truncate text-ink">{l.name} <span className="text-dim">{l.version}</span></span>
                <span className="block text-[11.5px] text-muted">{l.base || "?"} · in {l.count} picture{l.count === 1 ? "" : "s"}{l.weight != null ? ` · usual strength ${l.weight}` : ""}</span></span>
              <a href={`https://civitai.com/models/${l.model_id ?? ""}?modelVersionId=${l.version_id}`} target="_blank" rel="noreferrer" className="text-[12px] text-muted hover:text-ink">Open</a>
              {l.installed ? <span className="w-20 text-right text-[12px] text-good">in your LoRAs</span>
                : <button disabled={!!busy[l.version_id]} onClick={() => add(l)} className={cx("press h-7 w-20 rounded-md border border-accent/60 text-[12px] text-accent hover:bg-accent/10 disabled:opacity-60")}>{busy[l.version_id] ?? "Add"}</button>}
            </div>
          ))}
          {d.by_name.length > 0 && (
            <details className="mt-3 text-[12.5px]">
              <summary className="cursor-pointer text-muted hover:text-ink">Named in prompts only ({d.by_name.length}) — no link to add them from</summary>
              <ul className="mt-1.5 space-y-0.5 text-muted">{d.by_name.map((x) => <li key={x.name} className="flex gap-3"><span className="min-w-0 flex-1 truncate">{x.name}</span><span className="tabular-nums text-dim">{x.count}×{x.weight != null ? ` · ${x.weight}` : ""}</span></li>)}</ul>
            </details>
          )}
        </>)}
      </div>
    </Modal>
  );
}
