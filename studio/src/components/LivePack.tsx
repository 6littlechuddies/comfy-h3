// The Live pack builder: her still, idle loops and actions for the site's Live Stream (tips) and Live Action (call buttons).
// Every clip shows how big its joins jumped before they were eased (the site plays them back to back as one shot), a reel
// plays the whole pack in the order the site would, and nothing is sent until every clip is ticked as checked by eye.
import { useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { viewUrl, type FileRef } from "../lib/api";
import { useCharacters, type Character } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { blockers, checkOnSite, planActions, fileUrl, jumpLevel, liveOf, makeAll, makeReel, packKeys, redoClip, retKey, saveLive, segKey, sendLive, setAnchor,
  type LiveAction, type LiveClip, type LiveState } from "../lib/live";
import { Btn, DropSelect, Icon, cx } from "./ui";

export const useLivePack = create<{ cid: string | null }>(() => ({ cid: null }));
export const openLivePack = (cid: string) => useLivePack.setState({ cid });

export function LivePackHost() {
  const cid = useLivePack((s) => s.cid);
  const c = useCharacters((s) => s.list.find((x) => x.id === cid) ?? null);
  return c ? <LivePack c={c} /> : null;
}

const JUMP: Record<string, [string, string]> = {
  none: ["", ""], clean: ["clean", "text-good border-good/50"], eased: ["eased", "text-amber-300 border-amber-300/50"], jump: ["jumps — make again", "text-bad border-bad/60"],
};

function LivePack({ c }: { c: Character }) {
  const l = liveOf(c);
  const toast = useJobs((s) => s.toast);
  const [picking, setPicking] = useState(!l.anchor);
  const [busy, setBusy] = useState("");
  const [reel, setReel] = useState<string | null>(null);
  const close = () => useLivePack.setState({ cid: null });
  const up = (f: (x: LiveState) => LiveState) => void saveLive(c.id, f);
  const act = (key: string, p: Partial<LiveAction>) => up((x) => ({ ...x, actions: x.actions.map((a) => (a.key === key ? { ...a, ...p } : a)) }));
  const tick = (key: string, ok: boolean) => up((x) => ({ ...x, clips: { ...x.clips, [key]: { ...x.clips[key], ok } } }));
  const run = async (label: string, f: () => Promise<unknown>) => {
    setBusy(label);
    try { await f(); } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  // her pictures to pick the still from: sheet views first, then what was made in her project (newest first)
  const jobs = useJobs((s) => s.jobs);
  const pics: FileRef[] = [...Object.values(c.views).filter(Boolean) as FileRef[],
    ...jobs.filter((j) => j.status === "done" && j.meta?.project === c.id).flatMap((j) => j.outputs.filter((o) => o.kind === "image" && o.type === "output")).slice(0, 60)];
  const keys = packKeys(l);
  const made = keys.filter((k) => l.clips[k]?.status === "ready").length;
  const working = keys.filter((k) => ["making", "encoding"].includes(l.clips[k]?.status ?? "")).length;
  const block = blockers(l);
  const clip = (key: string, label: string, note?: string) => <ClipCard key={key} cid={c.id} k={key} clip={l.clips[key]} label={label} note={note} onTick={(v) => tick(key, v)}
    onRedo={() => void run(`Making ${label} again…`, () => redoClip(c.id, key))} disabled={!l.anchor} />;

  return createPortal(
    <div className="fade-in fixed inset-0 z-[85] flex flex-col bg-bg" role="dialog" aria-modal aria-label="Live pack">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0"><b className="display text-[20px]">Live pack</b> <span className="text-[13px] text-muted">· {c.site?.name || c.name} · stream tips and call buttons</span></div>
        <span className="text-[12.5px] text-dim">{made}/{keys.length} clips made{working ? ` · ${working} in the works` : ""}</span>
        <span className="ml-auto flex gap-2">
          <Btn small onClick={() => void run("Asking the site…", async () => { const r = await checkOnSite(c.id); toast(r.status === 200 ? `The site has her pack: ${JSON.stringify(r.body).slice(0, 220)}` : `The site answered ${r.status}: ${JSON.stringify(r.body).slice(0, 220)}`, r.status === 200 ? "good" : "info"); })}>Check on the site</Btn>
          <button aria-label="Close" onClick={close} className="press btn-raised flex h-9 w-9 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={15} /></button>
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* her still */}
        <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line p-4">
          <div>
            <p className="text-[13px] font-semibold">Her still</p>
            <p className="text-[12px] leading-relaxed text-muted">Every clip starts or ends on this exact frame. A 9:16 picture of her resting pose works best — others are cut to 9:16 from the middle.</p>
          </div>
          {l.anchor && !picking
            ? <><img src={fileUrl(c.id, "anchor", l.anchor.at)} alt="Her still" className="aspect-[9/16] w-full border border-line object-cover" />
              <Btn small onClick={() => setPicking(true)}>Pick another still</Btn></>
            : <div className="grid grid-cols-3 gap-1.5">
                {pics.length ? pics.map((p) => (
                  <button key={`${p.subfolder}/${p.filename}`} title="Use this as her still" onClick={() => void run("Making her still…", async () => {
                    if (l.anchor && Object.values(l.clips).some((x) => x.status === "ready") && !confirm("A new still means every clip is made again (they all start or end on it). Go ahead?")) return;
                    await setAnchor(c.id, p); setPicking(false);
                  })} className="press aspect-[9/16] overflow-hidden border border-line hover:border-accent">
                    <img src={viewUrl(p)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>)) : <p className="col-span-3 text-[12px] text-dim">No pictures of her yet — make one in 03 Create first.</p>}
              </div>}
          {c.style !== "anime" && <div className="flex flex-col gap-1.5 border border-line p-2">
            <p className="text-[12.5px] font-semibold">Her room{l.setting ? <span className="font-normal text-muted"> · {l.setting}</span> : null}</p>
            <textarea value={l.stillPrompt ?? ""} onChange={(e) => up((x) => ({ ...x, stillPrompt: e.target.value }))} rows={5} placeholder="Plan with the writer to get her room and still prompt — or write it: where she sits, what she wears at home, the room behind her, the light"
              aria-label="Her still prompt" className="inset border border-line p-1.5 text-[11.5px] leading-relaxed" />
            <Btn small onClick={() => void run("Making her webcam still (2 takes)…", async () => { const outs = await (await import("../lib/live")).makeStill(c.id, 2); toast(`${outs.length} new stills of her are at the top of the grid — pick one`, "good"); setPicking(true); })}
              disabled={!!busy} why="Busy" title="Two takes of her in that place, with her face and body from her sheet — then pick one as the still">Make a new still</Btn>
          </div>}
          <label className="flex flex-col gap-1 text-[12.5px] text-muted">Framing
            <DropSelect value={l.framing} onChange={(e) => up((x) => ({ ...x, framing: e.target.value as LiveState["framing"] }))} className="inset h-8 border border-line bg-raised px-2 text-[13px] text-ink">
              <option value="waist_up">Waist up</option><option value="full_body">Full body</option>
            </DropSelect>
          </label>
          <p className="text-[11.5px] leading-relaxed text-dim">Clips are made with H3 and re-encoded exactly as the site asks: H.264, 24 fps, 720×1280, silent. Every join is eased onto the frame it meets; the badge on each clip says how big the jump was before that.</p>
        </aside>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <section className="flex flex-col gap-3">
            <h3 className="text-[14px] font-semibold">Idle loops <span className="font-normal text-dim">· from her still back to it, safe for everyone</span></h3>
            <div className="flex flex-wrap gap-3">
              {l.idle.map((x) => (
                <div key={x.key} className={cx("flex flex-col gap-1.5", !x.on && "opacity-50")}>
                  {clip(x.key, x.kind === "idle" ? "Plain idle" : x.kind === "typing" ? "Typing on her phone" : "Talking to camera", x.kind === "typing" ? "plays while she writes a reply" : x.kind === "talk" ? "plays while she answers in the stream chat" : "the one everything comes back to")}
                  <label className="flex items-center gap-1.5 text-[12px] text-muted"><input type="checkbox" checked={x.on} disabled={x.kind === "idle"} onChange={(e) => up((s) => ({ ...s, idle: s.idle.map((y) => (y.key === x.key ? { ...y, on: e.target.checked } : y)) }))} /> In the pack</label>
                </div>))}
            </div>
          </section>
          <section className="mt-6 flex flex-col gap-3">
            <h3 className="text-[14px] font-semibold">Actions <span className="font-normal text-dim">· tips on the stream and buttons on the call — {l.actions.filter((a) => a.on).length} of at most 24</span></h3>
            {l.actions.map((a) => (
              <div key={a.key} className={cx("flex flex-col gap-3 border border-line p-3 xl:flex-row", !a.on && "opacity-50")}>
                <div className="flex w-full flex-col gap-2 xl:w-80">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={a.on} onChange={(e) => act(a.key, { on: e.target.checked })} aria-label={`${a.title} in the pack`} />
                    <input value={a.title} maxLength={40} onChange={(e) => act(a.key, { title: e.target.value })} aria-label="Button title" className="inset h-8 min-w-0 flex-1 border border-line px-2 text-[13px] font-medium" />
                  </div>
                  <textarea value={a.prompt} onChange={(e) => act(a.key, { prompt: e.target.value })} rows={3} aria-label="What she does" className="inset border border-line p-2 text-[12.5px] leading-relaxed" />
                  {a.segs > 1 && Array.from({ length: a.segs }, (_, i) => (
                    <textarea key={i} value={a.parts?.[i] ?? ""} rows={2} placeholder={`Part ${i + 1}: what happens in this part (it carries on from part ${i || "the still"})`} aria-label={`Part ${i + 1}`}
                      onChange={(e) => { const parts = Array.from({ length: a.segs }, (_, j) => a.parts?.[j] ?? ""); parts[i] = e.target.value; act(a.key, { parts }); }}
                      className="inset border border-line p-1.5 text-[12px] leading-relaxed" />))}
                  {a.segs > 1 && <span className="text-[11px] text-dim">{a.segs} parts × {a.seconds} s = {a.segs * a.seconds} s, played back to back as one take</span>}
                  <input value={a.hint} maxLength={200} onChange={(e) => act(a.key, { hint: e.target.value })} placeholder="What she did, for her message after (nobody sees it)" aria-label="Reaction hint" className="inset h-8 border border-line px-2 text-[12px]" />
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                    <label className="flex items-center gap-1" title="Its step on her ladder: 1 = the free opener, higher = bolder (the order the site gets them in)">Level <input type="number" min={1} max={30} value={a.level ?? ""} onChange={(e) => act(a.key, { level: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} className="inset h-7 w-12 border border-line px-1" /></label>
                    <label className="flex items-center gap-1">Seconds <input type="number" min={2} max={15} value={a.seconds} onChange={(e) => act(a.key, { seconds: Math.max(2, Math.min(15, Number(e.target.value) || 4)) })} className="inset h-7 w-12 border border-line px-1" /></label>
                    <label className="flex items-center gap-1">Parts <input type="number" min={1} max={4} value={a.segs} onChange={(e) => act(a.key, { segs: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })} className="inset h-7 w-10 border border-line px-1" /></label>
                    <DropSelect value={a.rating} onChange={(e) => act(a.key, { rating: e.target.value as LiveAction["rating"] })} className="inset h-7 border border-line bg-raised px-1">
                      <option value="sfw">SFW</option><option value="suggestive">Suggestive</option><option value="explicit">Explicit (paid)</option></DropSelect>
                    <DropSelect value={a.tier} onChange={(e) => act(a.key, { tier: e.target.value as LiveAction["tier"] })} className="inset h-7 border border-line bg-raised px-1" title="Who gets the button on the call">
                      <option value="free">Call: free</option><option value="premium">Call: premium</option><option value="ultimate">Call: ultimate</option></DropSelect>
                    <label className="flex items-center gap-1" title="Its price as a stream tip (the site can change it)">Tip <input type="number" min={1} value={a.tokens} onChange={(e) => act(a.key, { tokens: Math.max(1, Number(e.target.value) || 10) })} className="inset h-7 w-14 border border-line px-1" /></label>
                  </div>
                </div>
                <div className="flex flex-wrap items-start gap-3">
                  {Array.from({ length: a.segs }, (_, i) => clip(segKey(a.key, i), a.segs > 1 ? `Part ${i + 1}` : "The action", i === 0 ? "starts on her still" : `goes on from part ${i}'s last frame`))}
                  {clip(retKey(a.key), "Back to the still", "2-4 s, ends on her still")}
                </div>
              </div>))}
            <Btn small className="self-start" onClick={() => up((x) => ({ ...x, actions: [...x.actions, { key: `action_${Date.now().toString(36)}`, title: "New action", prompt: "She ", hint: "", rating: "sfw", seconds: 4, segs: 1, tier: "free", tokens: 10, on: true }] }))}
              disabled={l.actions.length >= 24}><Icon name="plus" size={13} /> Add an action</Btn>
          </section>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-panel px-5 py-3 text-[13px]">
        {busy ? <span className="text-muted"><span className="pulse text-accent">●</span> {busy}</span>
          : l.sent ? <span className={l.sent.status < 300 ? "text-good" : "text-bad"}>{l.sent.status < 300 ? `Sent ${new Date(l.sent.at).toLocaleString()} — a draft until it's published on the site` : `Last send: the site answered ${l.sent.status} — ${l.sent.problems}`}</span>
          : block.length ? <span className="text-muted">Before sending: {block.join(" · ")}</span> : <span className="text-good">Ready to send</span>}
        <span className="ml-auto flex flex-wrap gap-2">
          <Btn onClick={() => void run("The writer is planning her actions…", async () => {
            const { liveExamples, liveExamplePics } = await import("./LiveBatch");
            const n = await planActions(c.id, { examples: liveExamples(), pictures: liveExamplePics(), count: Math.max(4, l.actions.length), ratings: [...new Set(l.actions.map((a) => a.rating))].length ? [...new Set(l.actions.map((a) => a.rating))] : ["sfw"], keep: true });
            toast(`${n} actions planned in her manner — made ones it kept stay`, "good");
          })} disabled={!!busy} why="Busy" title="DeepSeek plans her actions and words her idle loops from her personality, learning from the examples in Batch → Live packs (the ones you've made and it keeps stay)"><Icon name="sparkle" size={14} /> Plan with the writer</Btn>
          <Btn onClick={() => void run("Making the clips… (they're in the GPU line — this can take a while)", () => makeAll(c.id))} disabled={!l.anchor || !!busy} why={!l.anchor ? "Pick her still first" : "Busy"}><Icon name="play" size={14} /> {made ? "Make the missing clips" : "Make all clips"}</Btn>
          <Btn onClick={() => void run("Putting the reel together…", async () => setReel(await makeReel(c.id)))} disabled={!made || !!busy} why="Make some clips first">Watch the reel</Btn>
          <Btn kind="primary" onClick={() => void run("Sending to the site…", async () => { const r = await sendLive(c.id); toast(`${c.name}'s live pack: ${r.note}`, r.ok ? "good" : "bad"); })}
            disabled={block.length > 0 || !!busy} why={block[0] ? `First: ${block[0]}` : "Busy"}><Icon name="up" size={14} /> Send to the site</Btn>
        </span>
      </div>
      {reel && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-6" onClick={() => setReel(null)}>
          <div className="flex max-h-full flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <video src={reel} controls autoPlay loop className="max-h-[80vh] border border-line" />
            <p className="max-w-md text-center text-[12.5px] text-muted">The whole pack the way the site plays it: every idle and every action, each between two plain idles. Watch the moments where one clip turns into the next — nothing should jump. Tick the clips that look right.</p>
            <Btn small onClick={() => setReel(null)}>Close</Btn>
          </div>
        </div>)}
    </div>, document.body);
}

function ClipCard({ cid, k, clip, label, note, onTick, onRedo, disabled }: { cid: string; k: string; clip?: LiveClip; label: string; note?: string; onTick: (v: boolean) => void; onRedo: () => void; disabled?: boolean }) {
  const st = clip?.status ?? "new";
  const js = [jumpLevel(clip?.enc?.d_start), jumpLevel(clip?.enc?.d_end)];
  const worst = js.includes("jump") ? "jump" : js.includes("eased") ? "eased" : js.includes("clean") ? "clean" : "none";
  return (
    <div className="flex w-36 flex-col gap-1">
      <div className="relative aspect-[9/16] overflow-hidden border border-line bg-raised2">
        {st === "ready" && clip?.enc
          ? <video src={fileUrl(cid, k, clip.enc.at)} muted loop autoPlay playsInline className="h-full w-full object-cover" />
          : <span className="flex h-full items-center justify-center px-2 text-center text-[11.5px] text-dim">
              {st === "making" ? <span><span className="pulse text-accent">●</span> H3 is making it</span> : st === "encoding" ? "Fitting it to the site…" : st === "error" ? <span className="text-bad">{clip?.error}</span> : "Not made yet"}</span>}
        {worst !== "none" && <span className={cx("absolute left-1 top-1 border bg-black/70 px-1 text-[10.5px]", JUMP[worst][1])}
          title={`How far the ${clip?.enc?.d_start != null ? `first frame (${clip?.enc?.d_start})` : ""}${clip?.enc?.d_start != null && clip?.enc?.d_end != null ? " and " : ""}${clip?.enc?.d_end != null ? `last frame (${clip?.enc?.d_end})` : ""} were from the frames they meet, out of 100, before easing. Under 3 nobody sees it; under 8 the easing hides it; more shows as a jump.`}>{JUMP[worst][0]}</span>}
      </div>
      <b className="truncate text-[12.5px]">{label}</b>
      {note && <span className="text-[11px] leading-snug text-dim">{note}</span>}
      <div className="flex items-center gap-2 text-[11.5px]">
        {st === "ready" && <label className="flex items-center gap-1 text-muted" title="You watched it (and its joins in the reel) and it looks right"><input type="checkbox" checked={!!clip?.ok} onChange={(e) => onTick(e.target.checked)} /> Looks right</label>}
        <button disabled={disabled || st === "making" || st === "encoding"} onClick={onRedo} className="ml-auto text-muted hover:text-ink disabled:opacity-40">{st === "new" ? "Make" : "Again"}</button>
      </div>
    </div>
  );
}
