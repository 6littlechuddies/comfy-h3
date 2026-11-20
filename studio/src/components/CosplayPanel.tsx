// Batch → Cosplay: paste characters, research them (adult check, costume, LoRAs, prompt), approve LoRAs, add to the batch.
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { addList, approve, findLoras, researchAll, toBatch, useCosplay, type Candidate, type CosItem } from "../lib/cosplay";
import { isAdult, looks, useCharacters } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { viewUrl } from "../lib/api";
import { Btn, DropSelect, Icon, Seg, cx } from "./ui";

/** the drawer part: who wears the costumes, and how LoRAs are picked */
export function CosplayOptions() {
  const o = useCosplay((s) => s.opts);
  const set = (p: Partial<typeof o>) => useCosplay.getState().set({ opts: { ...o, ...p } });
  const chars = useCharacters(useShallow((s) => s.list.filter((c) => isAdult(c) && c.style !== "anime" && c.views.front)));
  return (
    <div className="flex flex-col gap-3">
      <Seg label="Cosplayer" value={o.cosplayer} onChange={(v) => set({ cosplayer: v })} options={[{ value: "each", label: "A new woman each" }, { value: "one", label: "One of mine" }]} />
      {o.cosplayer === "one" && (
        <DropSelect value={o.charId ?? ""} onChange={(e) => set({ charId: e.target.value || null })} className="inset h-10 border px-2.5 text-[13.5px]">
          <option value="">Pick a character…</option>
          {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </DropSelect>)}
      <p className="-mt-1 text-[12px] leading-relaxed text-dim">{o.cosplayer === "one" ? "She wears every costume: her face and body come from her pictures." : "Each costume is worn by a different adult woman the writer describes."}</p>
      <label className="flex cursor-pointer items-start gap-2 text-[13px]"><input type="checkbox" className="mt-0.5" checked={o.auto} onChange={(e) => set({ auto: e.target.checked })} />
        <span>Pick LoRAs by myself <span className="text-dim">— the most collected Krea 2 LoRA for each character, if it has at least</span></span></label>
      {o.auto && <label className="-mt-1 flex items-center gap-2 pl-6 text-[12.5px] text-muted"><input type="number" min={0} step={10} value={o.minCollected} onChange={(e) => set({ minCollected: Math.max(0, Number(e.target.value) || 0) })} className="inset h-8 w-20 border px-2" /> collections</label>}
      <label className="flex items-center gap-2 text-[13px]">Pictures per character
        <DropSelect value={o.takes} onChange={(e) => set({ takes: Number(e.target.value) })} className="inset h-8 border px-2 text-[13px]">{[1, 2, 3, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}</DropSelect></label>
      <p className="text-[12px] leading-relaxed text-dim">Characters who are under 18, or drawn that way, are skipped and listed. Keep character names out of your site's titles: the site character is the cosplayer.</p>
    </div>
  );
}

/** the main part: the list, research, LoRA approval, add to batch */
export function CosplayList() {
  const items = useCosplay((s) => s.items);
  const o = useCosplay((s) => s.opts);
  const toast = useJobs((s) => s.toast);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const cosplayer = () => {
    if (o.cosplayer !== "one") return "";
    const c = useCharacters.getState().list.find((x) => x.id === o.charId);
    if (!c) throw new Error("Pick the character who wears the costumes (Cosplayer, on the left)");
    return looks(c);
  };
  const research = async (only?: string) => {
    try { setBusy("research"); await researchAll(cosplayer(), only); } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  const add = async () => {
    try { setBusy("add"); const n = await toBatch((m) => setBusy(m)); toast(n ? `Added ${n} cosplay row${n > 1 ? "s" : ""} to the batch — check them below, then Queue` : "No character is ready yet — Research first", n ? "good" : "info"); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  const ready = items.filter((i) => i.status === "ready");
  const skipped = items.filter((i) => i.status === "skipped");
  const todo = items.filter((i) => i.status === "new" || i.status === "error");
  const waitingLora = ready.filter((i) => i.lora === undefined && i.loras?.length);
  return (
    <div className="card flex flex-col gap-3 border border-line p-4">
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-semibold">Cosplay</span>
        <span className="text-[12.5px] text-muted">{items.length ? `${items.length} characters · ${ready.length} ready · ${skipped.length} skipped${todo.length ? ` · ${todo.length} to research` : ""}` : "paste your list of characters"}</span>
        {items.length > 0 && <button onClick={() => useCosplay.getState().set({ items: [] })} className="ml-auto text-[12px] text-dim hover:text-ink">Clear list</button>}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={items.length ? 2 : 6} placeholder={"One per line, with the series:\nReze\tChainsaw Man\nYoruichi Shihōin — Bleach\n2B (NieR: Automata)"}
        className="inset w-full resize-y border px-3 py-2 font-mono text-[12.5px] focus:border-accent focus:outline-none" />
      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={() => { const n = addList(text); setText(""); toast(n ? `Added ${n} character${n > 1 ? "s" : ""}` : "Nothing new in that list", "info"); }} disabled={!text.trim()}><Icon name="plus" size={14} /> Add to list</Btn>
        <Btn onClick={() => research()} disabled={!!busy || !todo.length}><Icon name="script" size={14} /> {busy === "research" ? "Researching…" : `Research ${todo.length || ""}`}</Btn>
        <button onClick={add} disabled={!!busy || !ready.length} className="press btn-primary ml-auto flex h-10 items-center gap-2 px-4 text-[13px] font-semibold uppercase tracking-wide text-accentink disabled:opacity-40">
          {busy && busy !== "research" ? busy : `Add ${ready.length || ""} to batch`}</button>
      </div>
      {waitingLora.length > 0 && <p className="text-[12.5px] text-hot">{waitingLora.length} character{waitingLora.length > 1 ? "s have" : " has"} LoRAs to approve or turn down (below). Without a choice they go in on the prompt alone.</p>}
      <div className="flex flex-col gap-2">
        {items.map((it) => <CosRow key={it.key} it={it} busy={!!busy} onRedo={() => research(it.key)} />)}
      </div>
    </div>
  );
}

function CosRow({ it, busy, onRedo }: { it: CosItem; busy: boolean; onRedo: () => void }) {
  const [open, setOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  const toast = useJobs((s) => s.toast);
  const tone = it.status === "ready" ? "text-good" : it.status === "skipped" ? "text-dim" : it.status === "error" ? "text-bad" : "text-muted";
  const label = it.status === "ready" ? "ready" : it.status === "skipped" ? "skipped" : it.status === "looking" ? "researching…" : it.status === "error" ? "error" : "to research";
  const findMore = async () => { setFinding(true); try { const loras = await findLoras(it); useCosplay.getState().update(it.key, { loras }); if (!loras.length) toast(`No Krea 2 LoRA names ${it.name} on CivitAI`, "info"); } finally { setFinding(false); } };
  return (
    <div className={cx("border border-line px-3 py-2", it.status === "skipped" && "opacity-60")}>
      <div className="flex items-center gap-2">
        {it.picture ? <img src={viewUrl({ filename: it.picture, subfolder: "", type: "input" })} alt="" className="h-10 w-8 shrink-0 rounded-[2px] object-cover" /> : <span className="h-10 w-8 shrink-0 rounded-[2px] bg-hover" />}
        <button onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[13.5px]"><span className="font-semibold">{it.name}</span>{it.series && <span className="text-muted"> · {it.series}</span>}</div>
          <div className={cx("truncate text-[12px]", tone)}>{label}{it.age ? ` · age ${it.age}` : ""}{it.why ? ` — ${it.why}` : ""}{it.status === "ready" ? ` · ${it.lora ? `LoRA: ${it.lora.name}` : it.lora === null ? "no LoRA" : it.loras?.length ? `${it.loras.length} LoRA${it.loras.length > 1 ? "s" : ""} to look at` : "no LoRA found"}` : ""}</div>
        </button>
        {(it.status === "ready" || it.status === "error") && <button disabled={busy} onClick={onRedo} title="Research again" className="press text-[12px] text-dim hover:text-ink">Redo</button>}
        <button onClick={() => useCosplay.getState().set({ items: useCosplay.getState().items.filter((x) => x.key !== it.key) })} title="Take off the list" className="press text-dim hover:text-ink"><Icon name="close" size={13} /></button>
      </div>
      {open && it.status === "ready" && (
        <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2 text-[12.5px]">
          <p className="text-muted"><b className="text-ink">Costume:</b> {it.outfit} · <b className="text-ink">Wig:</b> {it.wig} · <b className="text-ink">Eyes:</b> {it.eyes}{it.props && it.props !== "none" ? <> · <b className="text-ink">Props:</b> {it.props}</> : null}</p>
          <textarea value={it.prompt} onChange={(e) => useCosplay.getState().update(it.key, { prompt: e.target.value })} rows={5} className="inset w-full resize-y border px-2.5 py-1.5 text-[12.5px] focus:border-accent focus:outline-none" />
          <div className="flex items-center gap-2"><span className="lbl">LoRA</span>
            <button onClick={() => approve(it.key, null)} className={cx("press rounded-sm px-1.5 py-0.5", it.lora === null ? "bg-accent/15 text-accent" : "text-muted hover:text-ink")}>None (prompt only)</button>
            <button onClick={findMore} disabled={finding} className="press ml-auto text-dim hover:text-ink">{finding ? "Searching…" : "Search CivitAI again"}</button></div>
          <div className="grid grid-cols-3 gap-2">
            {(it.loras ?? []).map((l) => <LoraCard key={l.version_id} l={l} on={it.lora?.version_id === l.version_id} pick={() => approve(it.key, l)} />)}
          </div>
        </div>)}
    </div>
  );
}

function LoraCard({ l, on, pick }: { l: Candidate; on: boolean; pick: () => void }) {
  const img = l.images.find((i) => !i.video) ?? l.images[0];
  return (
    <button onClick={pick} className={cx("press flex flex-col gap-1 border p-1 text-left", on ? "border-accent bg-accent/10" : "border-line hover:border-muted")}>
      <span className="block h-28 overflow-hidden rounded-[2px] bg-hover">{img && <img src={img.url} alt="" className={cx("h-full w-full object-cover", img.explicit && "blur-md")} />}</span>
      <span className="truncate text-[12px] font-semibold">{l.name}</span>
      <span className="truncate text-[11px] text-muted">{l.collected.toLocaleString()} collected · {l.downloads.toLocaleString()} downloads</span>
      {l.trigger && <span className="truncate text-[11px] text-dim">trigger: {l.trigger}</span>}
      <span className={cx("text-[11.5px]", on ? "text-accent" : "text-dim")}>{on ? "✓ Approved" : "Use this one"}</span>
    </button>
  );
}
