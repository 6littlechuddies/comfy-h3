// Batch → Cosplay: paste characters, research them (adult check, costume, LoRAs, prompt), approve LoRAs, add to the batch.
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { addList, approve, findLoras, picksOf, researchAll, toBatch, useCosplay, type Candidate, type CosItem } from "../lib/cosplay";
import { usePoseWear } from "../lib/posewear";
import { isAdult, looks, useCharacters } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { viewUrl } from "../lib/api";
import { Btn, DropSelect, Icon, LoraList, Seg, cx } from "./ui";
import { examples, useBank } from "../lib/promptBank";

/** what the writer has learned from what you keep (the prompt bank) — no typing: it comes from what you do */
function Learned() {
  const b = useBank();
  const liked = Object.values(b.entries).filter((e) => e.score >= 3).length;
  const del = Object.values(b.entries).filter((e) => e.score < 0).length;
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line pt-3 text-[12.5px]">
      <div className="flex items-center gap-2"><span className="lbl">Learned taste</span><button onClick={() => setOpen(!open)} className="ml-auto text-dim hover:text-ink">{open ? "Hide" : "Show"}</button></div>
      <p className="mt-1 leading-relaxed text-dim">{!b.loaded ? "Loading…" : liked ? `From ${liked} picture${liked > 1 ? "s" : ""} you kept and built on${del ? ` and ${del} you deleted` : ""}. New prompts follow it${b.taste ? "" : " (notes come once 6+ are kept)"}.` : "Nothing yet. Star pictures, make characters from them, animate, upscale or download them — the writer learns from what you keep, and from what you delete."}</p>
      {open && <div className="mt-2 flex flex-col gap-2">
        {b.taste?.notes && <pre className="whitespace-pre-wrap rounded-sm border border-line bg-black/20 p-2 font-sans text-[12px] text-muted">{b.taste.notes}</pre>}
        {examples(3).map((e) => <p key={e.k} className="line-clamp-3 border-l-2 border-accent/40 pl-2 text-[11.5px] text-muted" title={e.prompt}><b className="text-ink">{e.score.toFixed(1)}</b> · {Object.keys(e.sig).join(", ")} — {e.prompt}</p>)}
      </div>}
    </div>
  );
}

/** where the poses come from: the writer's varied mix, or your PoseWear picks (copied exactly through their depth) */
function PoseSource() {
  const o = useCosplay((s) => s.opts);
  const n = usePoseWear((s) => s.picks.filter((p) => p.lib === "poses" || p.lib === "depths").length);
  const set = (p: Partial<typeof o>) => useCosplay.getState().set({ opts: { ...o, ...p } });
  return (
    <div className="flex flex-col gap-1.5">
      <Seg label="Poses" value={o.poses ?? "mix"} onChange={(v) => set({ poses: v })} options={[{ value: "mix", label: "Varied by the writer" }, { value: "posewear", label: `My PoseWear picks${n ? ` (${n})` : ""}` }]} />
      <button onClick={() => import("./PoseWear").then(({ openPoseWear }) => openPoseWear("many", "depths"))} className="press btn-raised flex h-9 items-center justify-center gap-1.5 text-[13px]"><Icon name="user" size={14} className="text-muted" />Browse poses (PoseWear)</button>
      {(o.poses ?? "mix") === "posewear" && <p className="text-[12px] leading-relaxed text-dim">{n ? `Each picture takes the next of your ${n} poses — the body position is copied from its depth (Krea 2 depth control), the costume and place are written around it.` : "Pick some poses first."}</p>}
    </div>
  );
}

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
        <span>Approve LoRAs automatically <span className="text-dim">— off: you tick them yourself on each character (several allowed). On: the most collected Krea 2 LoRA, if it has at least</span></span></label>
      {o.auto && <label className="-mt-1 flex items-center gap-2 pl-6 text-[12.5px] text-muted"><input type="number" min={0} step={10} value={o.minCollected} onChange={(e) => set({ minCollected: Math.max(0, Number(e.target.value) || 0) })} className="inset h-8 w-20 border px-2" /> collections</label>}
      <label className="flex cursor-pointer items-start gap-2 text-[13px]"><input type="checkbox" className="mt-0.5" checked={o.posts} onChange={(e) => set({ posts: e.target.checked })} />
        <span>Read the LoRA's own posts <span className="text-dim">— the writer copies how people prompt that character's costume on Krea 2 (from the LoRA's CivitAI examples)</span></span></label>
      <label className="flex items-center gap-2 text-[13px]">Pictures per character
        <DropSelect value={o.takes} onChange={(e) => set({ takes: Number(e.target.value) })} className="inset h-8 border px-2 text-[13px]">{[1, 2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}</DropSelect></label>
      <p className="-mt-2 text-[12px] leading-relaxed text-dim">Each picture is its own shot: a different camera angle, pose and place — never repeated across the batch.</p>
      <PoseSource />
      <LoraList value={o.loras ?? []} onChange={(v) => set({ loras: v })} family="krea2" label="LoRAs on every picture" />
      <p className="text-[12px] leading-relaxed text-dim">Characters who are under 18, or drawn that way, are skipped and listed. Keep character names out of your site's titles: the site character is the cosplayer.</p>
      <Learned />
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
  const collapsed = !!o.collapsed;
  const setCollapsed = (v: boolean) => useCosplay.getState().set({ opts: { ...useCosplay.getState().opts, collapsed: v } });
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
    try { setBusy("add"); const n = await toBatch((m) => setBusy(m)); toast(n ? `Added ${n} cosplay picture${n > 1 ? "s" : ""} to the batch — check them below, then Queue` : "No character is ready yet — Research first", n ? "good" : "info"); if (n) setCollapsed(true); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  const ready = items.filter((i) => i.status === "ready");
  const skipped = items.filter((i) => i.status === "skipped");
  const todo = items.filter((i) => i.status === "new" || i.status === "error");
  const waitingLora = ready.filter((i) => picksOf(i) === undefined && i.loras?.length);
  const pics = ready.reduce((n, i) => n + (i.shots?.length || 1), 0);
  return (
    <div className="card flex flex-col gap-3 border border-line p-4">
      <div className="flex items-center gap-2">
        <button onClick={() => setCollapsed(!collapsed)} className="press flex items-center gap-1.5 text-left" title={collapsed ? "Show the list" : "Fold the list away"}>
          <Icon name="chev" size={14} className={cx("text-muted transition-transform", collapsed && "-rotate-90")} />
          <span className="text-[15px] font-semibold">Cosplay</span></button>
        <span className="text-[12.5px] text-muted">{items.length ? `${items.length} characters · ${ready.length} ready (${pics} pictures) · ${skipped.length} skipped${todo.length ? ` · ${todo.length} to research` : ""}` : "paste your list of characters"}</span>
        {items.length > 0 && !collapsed && <button onClick={() => useCosplay.getState().set({ items: [] })} className="ml-auto text-[12px] text-dim hover:text-ink">Clear list</button>}
      </div>
      {collapsed ? (
        <div className="flex flex-wrap items-center gap-1">
          {items.map((it) => <span key={it.key} title={`${it.name}${it.series ? ` · ${it.series}` : ""} — ${it.status}`} className={cx("h-10 w-8 overflow-hidden rounded-[2px] border", it.status === "ready" ? "border-good/60" : it.status === "skipped" ? "border-line opacity-40" : it.status === "error" ? "border-bad/60" : "border-line")}>
            {it.picture ? <img src={viewUrl({ filename: it.picture, subfolder: "", type: "input" })} alt={it.name} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-[10px] text-dim">{it.name.slice(0, 2)}</span>}</span>)}
          <button onClick={add} disabled={!!busy || !ready.length} className="press btn-primary ml-auto flex h-9 items-center gap-2 px-3 text-[12.5px] font-semibold uppercase tracking-wide text-accentink disabled:opacity-40">{busy && busy !== "research" ? busy : `Add ${pics || ""} to batch`}</button>
        </div>
      ) : <>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={items.length ? 2 : 6} placeholder={"One per line, with the series:\nReze\tChainsaw Man\nYoruichi Shihōin — Bleach\n2B (NieR: Automata)"}
        className="inset w-full resize-y border px-3 py-2 font-mono text-[12.5px] focus:border-accent focus:outline-none" />
      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={() => { const n = addList(text); setText(""); toast(n ? `Added ${n} character${n > 1 ? "s" : ""}` : "Nothing new in that list", "info"); }} disabled={!text.trim()}><Icon name="plus" size={14} /> Add to list</Btn>
        <Btn onClick={() => research()} disabled={!!busy || !todo.length}><Icon name="script" size={14} /> {busy === "research" ? "Researching…" : `Research ${todo.length || ""}`}</Btn>
        {ready.length > 0 && <Btn onClick={async () => { for (const it of ready) useCosplay.getState().update(it.key, { status: "new" }); await research(); }} disabled={!!busy} title="Write every ready character's prompts again (new shots, your LoRA picks' wording)"><Icon name="refresh" size={14} /> Rewrite all</Btn>}
        <button onClick={add} disabled={!!busy || !ready.length} className="press btn-primary ml-auto flex h-10 items-center gap-2 px-4 text-[13px] font-semibold uppercase tracking-wide text-accentink disabled:opacity-40">
          {busy && busy !== "research" ? busy : `Add ${pics || ""} to batch`}</button>
      </div>
      {waitingLora.length > 0 && <p className="text-[12.5px] text-hot">{waitingLora.length} character{waitingLora.length > 1 ? "s have" : " has"} LoRAs to look at (open them below and tick the ones you want — several are fine). Untouched ones go in on the prompt alone.</p>}
      <div className="flex flex-col gap-2">
        {items.map((it) => <CosRow key={it.key} it={it} busy={!!busy} onRedo={() => research(it.key)} />)}
      </div>
      </>}
    </div>
  );
}

function CosRow({ it, busy, onRedo }: { it: CosItem; busy: boolean; onRedo: () => void }) {
  const [open, setOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  const toast = useJobs((s) => s.toast);
  const picks = picksOf(it);
  const tone = it.status === "ready" ? "text-good" : it.status === "skipped" ? "text-dim" : it.status === "error" ? "text-bad" : "text-muted";
  const label = it.status === "ready" ? `ready · ${it.shots?.length || 1} picture${(it.shots?.length || 1) > 1 ? "s" : ""}` : it.status === "skipped" ? "skipped" : it.status === "looking" ? "researching…" : it.status === "error" ? "error" : "to research";
  const loraLine = picks === undefined ? (it.loras?.length ? `${it.loras.length} LoRA${it.loras.length > 1 ? "s" : ""} to look at` : it.status === "ready" ? "no LoRA found" : "") : picks.length ? `LoRA${picks.length > 1 ? "s" : ""}: ${picks.map((l) => l.name).join(", ")}` : "no CivitAI LoRA";
  const extra = it.extra?.length ? ` + ${it.extra.length} of yours` : "";
  const findMore = async () => { setFinding(true); try { const loras = await findLoras(it); useCosplay.getState().update(it.key, { loras }); if (!loras.length) toast(`No Krea 2 LoRA names ${it.name} on CivitAI — add one of yours below`, "info"); } finally { setFinding(false); } };
  const canPick = it.status !== "skipped";
  return (
    <div className={cx("border border-line px-3 py-2", it.status === "skipped" && "opacity-60")}>
      <div className="flex items-center gap-2" title={`${it.name}${it.series ? ` · ${it.series}` : ""}`}>
        {it.picture ? <img src={viewUrl({ filename: it.picture, subfolder: "", type: "input" })} alt={it.name} className="h-10 w-8 shrink-0 rounded-[2px] object-cover" /> : <span className="h-10 w-8 shrink-0 rounded-[2px] bg-hover" />}
        <button onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[13.5px]"><span className="font-semibold">{it.name}</span>{it.series && <span className="text-muted"> · {it.series}</span>}</div>
          <div className={cx("truncate text-[12px]", tone)}>{label}{it.age ? ` · age ${it.age}` : ""}{it.why ? ` — ${it.why}` : ""}{loraLine || extra ? ` · ${loraLine}${extra}` : ""}</div>
        </button>
        {(it.status === "ready" || it.status === "error") && <button disabled={busy} onClick={onRedo} title="Research and write again (new shots, your LoRA picks)" className="press text-[12px] text-dim hover:text-ink">Redo</button>}
        <button onClick={() => useCosplay.getState().set({ items: useCosplay.getState().items.filter((x) => x.key !== it.key) })} title="Take off the list" className="press text-dim hover:text-ink"><Icon name="x" size={13} /></button>
      </div>
      {open && canPick && (
        <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2 text-[12.5px]">
          {it.status === "ready" && <p className="text-muted"><b className="text-ink">Costume:</b> {it.outfit} · <b className="text-ink">Wig:</b> {it.wig} · <b className="text-ink">Eyes:</b> {it.eyes}{it.props && it.props !== "none" ? <> · <b className="text-ink">Props:</b> {it.props}</> : null}</p>}
          {(it.shots?.length ? it.shots : it.prompt ? [{ brief: "", pose: it.pose ?? "", prompt: it.prompt }] : []).map((sh, i) => (
            <div key={i} className="flex gap-2">
              {sh.ref && <img src={sh.ref.thumb} alt="" title={sh.ref.title} referrerPolicy="no-referrer" className="h-16 w-12 shrink-0 border border-line object-cover" />}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[11px] text-dim">Picture {i + 1}{sh.brief ? ` — ${sh.brief.replace(/ · /g, " · ")}` : ""}</span>
                <textarea value={sh.prompt} onChange={(e) => { const shots = [...(it.shots ?? [{ brief: "", pose: it.pose ?? "", prompt: it.prompt ?? "" }])]; shots[i] = { ...shots[i], prompt: e.target.value }; useCosplay.getState().update(it.key, { shots, prompt: shots[0].prompt }); }}
                  rows={3} className="inset w-full resize-y border px-2.5 py-1.5 text-[12px] focus:border-accent focus:outline-none" />
              </div>
            </div>))}
          <div className="flex items-center gap-2"><span className="lbl">CivitAI LoRAs</span><span className="text-[11.5px] text-dim">tick any number</span>
            <button onClick={() => approve(it.key, null)} className={cx("press rounded-sm px-1.5 py-0.5", picks && !picks.length ? "bg-accent/15 text-accent" : "text-muted hover:text-ink")}>None</button>
            <button onClick={findMore} disabled={finding} className="press ml-auto text-dim hover:text-ink">{finding ? "Searching…" : "Search CivitAI again"}</button></div>
          {(it.loras?.length || picks?.length) ? <div className="grid grid-cols-3 gap-2">
            {[...(it.loras ?? []), ...(picks ?? []).filter((p) => !(it.loras ?? []).some((l) => l.version_id === p.version_id))].map((l) => <LoraCard key={l.version_id} l={l} on={!!picks?.some((p) => p.version_id === l.version_id)} pick={() => approve(it.key, l)} />)}
          </div> : <p className="text-dim">{it.status === "new" ? "Research finds them." : "None found by name."}</p>}
          <LoraList value={it.extra ?? []} onChange={(v) => useCosplay.getState().update(it.key, { extra: v })} family="krea2" label={`Your LoRAs for ${it.name}`} />
          {it.status === "ready" && <p className="text-[11.5px] text-dim">Changed the LoRAs? Press Redo so the prompts use their trigger words and costume wording (or just Add — triggers are put in front either way).</p>}
        </div>)}
    </div>
  );
}

function LoraCard({ l, on, pick }: { l: Candidate; on: boolean; pick: () => void }) {
  const img = l.images.find((i) => !i.video) ?? l.images[0];
  return (
    <button onClick={pick} title={l.name} className={cx("press flex flex-col gap-1 border p-1 text-left", on ? "border-accent bg-accent/10" : "border-line hover:border-muted")}>
      <span className="block h-28 overflow-hidden rounded-[2px] bg-hover">{img && <img src={img.url} alt="" className={cx("h-full w-full object-cover", img.explicit && "blur-md")} />}</span>
      <span className="truncate text-[12px] font-semibold">{l.name}</span>
      <span className="truncate text-[11px] text-muted">{l.collected.toLocaleString()} collected · {l.downloads.toLocaleString()} downloads</span>
      {l.trigger && <span className="truncate text-[11px] text-dim">trigger: {l.trigger}</span>}
      <span className={cx("text-[11.5px]", on ? "text-accent" : "text-dim")}>{on ? "✓ Using it — click to drop" : "Use this one"}</span>
    </button>
  );
}
