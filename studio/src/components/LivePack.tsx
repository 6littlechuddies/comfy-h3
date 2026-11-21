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

const JUMP_TONE: Record<string, string> = { none: "bg-line2", clean: "bg-good", eased: "bg-amber-300", jump: "bg-bad" };
const JUMP_WORD: Record<string, string> = { none: "not made yet", clean: "clean", eased: "eased", jump: "jumps — make the clip again" };
const RATING: Record<LiveAction["rating"], [string, string]> = { sfw: ["SFW", "text-good border-good/40"], suggestive: ["Suggestive", "text-amber-300 border-amber-300/40"], explicit: ["Explicit", "text-bad border-bad/50"] };

/** one join between two clips: a dot coloured by how far apart the two frames were before easing (hover for the number) */
function Join({ d, label }: { d?: number | null; label: string }) {
  const lv = jumpLevel(d);
  return (
    <span className="mt-[100px] flex shrink-0 items-center px-0.5" title={`${label}: ${JUMP_WORD[lv]}${d != null ? ` (${d} of 100 before easing — under 3 nobody sees it, under 8 the easing hides it)` : ""}`}>
      <span className="h-px w-3 bg-line2" />
      <span className={cx("h-2.5 w-2.5 rounded-full ring-2 ring-bg", JUMP_TONE[lv])} />
      <span className="h-px w-3 bg-line2" />
    </span>
  );
}

/** her still, small: where every action starts and ends */
function StillMini({ cid, at, label }: { cid: string; at?: number; label: string }) {
  return (
    <span className="mt-[68px] flex w-10 shrink-0 flex-col items-center gap-1" title={label}>
      <span className="aspect-[9/16] w-full overflow-hidden border border-accent/50 bg-raised2">{at ? <img src={fileUrl(cid, "anchor", at)} alt="" className="h-full w-full object-cover" /> : null}</span>
      <span className="text-[9.5px] uppercase tracking-wide text-dim">still</span>
    </span>
  );
}

function Switch({ on, set, children, title }: { on: boolean; set: (v: boolean) => void; children: React.ReactNode; title?: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => set(!on)} title={title} className="press flex items-start gap-2.5 text-left">
      <span className={cx("relative mt-0.5 h-[18px] w-8 shrink-0 border transition-colors", on ? "border-accent bg-accent" : "border-line bg-raised2")}>
        <span className={cx("absolute top-[2px] h-3 w-3 transition-all", on ? "left-[15px] bg-accentink" : "left-[2px] bg-dim")} />
      </span>
      <span className="min-w-0 text-[12.5px] leading-snug">{children}</span>
    </button>
  );
}

const field = "inset h-7 border border-line bg-raised px-1.5 text-[12px] text-ink focus:border-accent focus:outline-none";

function LivePack({ c }: { c: Character }) {
  const l = liveOf(c);
  const toast = useJobs((s) => s.toast);
  const [picking, setPicking] = useState(!l.anchor);
  const [busy, setBusy] = useState("");
  const [reel, setReel] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
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
  const checked = keys.filter((k) => l.clips[k]?.status === "ready" && l.clips[k]?.ok).length;
  const working = keys.filter((k) => ["making", "encoding"].includes(l.clips[k]?.status ?? "")).length;
  const block = blockers(l);
  const ladder = [...l.actions].sort((a, b) => (a.level ?? 99) - (b.level ?? 99));
  const clip = (key: string, label: string, note?: string) => <ClipCard key={key} cid={c.id} k={key} clip={l.clips[key]} label={label} note={note} onTick={(v) => tick(key, v)}
    onRedo={() => void run(`Making ${label.toLowerCase()} again…`, () => redoClip(c.id, key))} disabled={!l.anchor} />;
  const pct = (n: number) => (keys.length ? Math.round((n / keys.length) * 100) : 0);

  return createPortal(
    <div className="fade-in fixed inset-0 z-[85] flex flex-col bg-bg" role="dialog" aria-modal aria-label="Live pack">
      {/* header: who, how far along */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <b className="display text-[20px] leading-none">Live pack</b>
          <p className="text-[12.5px] text-muted">{c.site?.name || c.name} · her stream tips and call buttons{l.setting ? ` · ${l.setting}` : ""}</p>
        </div>
        <div className="flex items-center gap-5 text-[11.5px] text-muted">
          {([["Made", made, "bg-accent"], ["Checked by eye", checked, "bg-good"]] as const).map(([t, n, tone]) => (
            <div key={t} className="flex w-36 flex-col gap-1">
              <span className="flex justify-between"><span>{t}</span><span className="text-ink">{n}/{keys.length}</span></span>
              <span className="h-1 w-full bg-raised2"><span className={cx("block h-full transition-all", tone)} style={{ width: `${pct(n)}%` }} /></span>
            </div>))}
          {working > 0 && <span className="flex items-center gap-1.5"><span className="pulse h-1.5 w-1.5 rounded-full bg-accent" />{working} in the GPU line</span>}
        </div>
        <span className="ml-auto flex gap-2">
          <Btn small onClick={() => void run("Asking the site…", async () => { const r = await checkOnSite(c.id); toast(r.status === 200 ? `The site has her pack: ${JSON.stringify(r.body).slice(0, 220)}` : `The site answered ${r.status}: ${JSON.stringify(r.body).slice(0, 220)}`, r.status === 200 ? "good" : "info"); })}>Check on the site</Btn>
          <button aria-label="Close" onClick={close} className="press btn-raised flex h-9 w-9 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={15} /></button>
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* her still and her room */}
        <aside className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-4">
          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between"><h3 className="text-[13.5px] font-semibold">Her still</h3>
              {l.anchor && !picking && <button onClick={() => setPicking(true)} className="text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline">Pick another</button>}
              {picking && l.anchor && <button onClick={() => setPicking(false)} className="text-[12px] text-muted hover:text-ink">Keep this one</button>}</div>
            {l.anchor && !picking
              ? <img src={fileUrl(c.id, "anchor", l.anchor.at)} alt="Her still" className="aspect-[9/16] w-full border border-line object-cover" />
              : <>
                <p className="text-[11.5px] leading-relaxed text-dim">Every clip starts or ends on this exact frame. A 9:16 picture of her resting works best; others are cut from the middle.</p>
                <div className="grid max-h-[46vh] grid-cols-3 gap-1.5 overflow-y-auto">
                  {pics.length ? pics.map((p) => (
                    <button key={`${p.subfolder}/${p.filename}`} title="Use this as her still" onClick={() => void run("Making her still…", async () => {
                      if (l.anchor && Object.values(l.clips).some((x) => x.status === "ready") && !confirm("A new still means every clip is made again (they all start or end on it). Go ahead?")) return;
                      await setAnchor(c.id, p); setPicking(false);
                    })} className="press aspect-[9/16] overflow-hidden border border-line hover:border-accent">
                      <img src={viewUrl(p)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </button>)) : <p className="col-span-3 text-[12px] text-dim">No pictures of her yet — make one in 03 Create, or make a still from her room below.</p>}
                </div>
              </>}
            <div role="radiogroup" aria-label="Framing" className="grid grid-cols-2 gap-[3px] border border-line2 p-[3px]">
              {([["waist_up", "Waist up"], ["full_body", "Full body"]] as const).map(([v, t]) => (
                <button key={v} role="radio" aria-checked={l.framing === v} onClick={() => up((x) => ({ ...x, framing: v }))}
                  className={cx("press h-7 text-[12px]", l.framing === v ? "bg-raised2 text-ink" : "text-muted hover:text-ink")}>{t}</button>))}
            </div>
          </section>
          {c.style !== "anime" && <section className="flex flex-col gap-2 border-t border-line pt-4">
            <h3 className="text-[13.5px] font-semibold">Her room</h3>
            {l.setting && <p className="text-[12px] text-muted">{l.setting}</p>}
            <textarea value={l.stillPrompt ?? ""} onChange={(e) => up((x) => ({ ...x, stillPrompt: e.target.value }))} rows={5} placeholder="Plan with the writer to get her room — or write it: where she sits, what she wears at home, the room behind her, the light"
              aria-label="Her still prompt" className="inset border border-line p-2 text-[11.5px] leading-relaxed focus:border-accent focus:outline-none" />
            <Btn small onClick={() => void run("Making her webcam still (2 takes)…", async () => { const outs = await (await import("../lib/live")).makeStill(c.id, 2); toast(`${outs.length} new stills of her are at the top of the grid — pick one`, "good"); setPicking(true); })}
              disabled={!!busy} why="Busy" title="Two takes of her in that place, with her face and body from her sheet — then pick one as the still">Make a new still here</Btn>
          </section>}
          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <Switch on={l.refs !== false} set={(v) => up((x) => ({ ...x, refs: v }))} title="H3's reference mode: her sheets and her room go in as reference pictures beside the still, which is pinned as the first frame (and the last, for loops and the way back). If a clip fails that way, it's made the plain way by itself.">
              Show every clip her sheets and room
              <span className="block text-[11px] text-dim">Her face, body and room stay the same from part to part</span>
            </Switch>
            {l.refs !== false && <div className="grid grid-cols-3 gap-1.5">
              {([["Angles", c.views.sheet ?? c.views.front, null], ["Expressions", c.views.faces, "faces"], ["Room", l.room?.ref, "room"]] as const).map(([t, f, make]) => (
                <div key={t} className="flex flex-col gap-1">
                  <span className="flex aspect-square items-center justify-center overflow-hidden border border-line bg-raised2 text-center text-[10px] leading-tight text-dim">
                    {f ? <img src={viewUrl(f)} alt={t} className="h-full w-full object-cover" /> : make === "room" && !l.anchor ? "after her still" : "not made yet"}</span>
                  <span className="flex items-center justify-between text-[10.5px] text-muted">{t}
                    {make && <button disabled={!!busy || (make === "room" && !l.anchor) || (make === "faces" && !c.views.front)} className="text-accent hover:underline disabled:text-dim disabled:no-underline"
                      title={make === "room" ? "Her room as a set sheet from her still: the same view empty, a wider view, the wall behind her" : "Her face in twelve expressions and four mouth shapes, one picture (it also lands in her sheet in Characters)"}
                      onClick={() => void run(make === "room" ? "Making her room sheet…" : "Making her expression sheet…", async () => {
                        const L = await import("../lib/live");
                        if (make === "room") await L.makeRoom(c.id);
                        else {
                          const [{ facesGraph }, { useCharacters: uc }] = await Promise.all([import("../lib/sheet"), import("../lib/characters")]);
                          const front = await uc.getState().asMedia(c.id, "front");
                          if (!front) throw new Error("She needs a front picture first");
                          const { waitForJob } = await import("../lib/jobs");
                          const j = await useJobs.getState().run("characters", `${c.name}: expression sheet`, facesGraph(c, front.name), "characters:view:krea", { charId: c.id, view: "faces" });
                          await waitForJob(j.id);
                        }
                        toast(make === "room" ? "Her room sheet is in — clips made from now on use it" : "Her expression sheet is in", "good");
                      })}>{f ? "Redo" : "Make"}</button>}</span>
                </div>))}
            </div>}
          </section>
          <section className="flex flex-col gap-3 border-t border-line pt-4">
            <Switch on={l.faceFix !== false} set={(v) => up((x) => ({ ...x, faceFix: v }))} title="Before each next part (or the way back) starts, her face on the part's last frame is redrawn from her reference sheet, both are scored by DeepSeek's face match, and the better one goes on">
              Keep her face at every join
              <span className={cx("block text-[11px]", c.views.sheet ? "text-dim" : "text-amber-300")}>{c.views.sheet ? "From her All angles sheet, scored before and after" : c.views.front ? "Uses her front picture — her All angles sheet works better" : "She needs a front picture or a sheet first"}</span>
            </Switch>
            <p className="text-[11px] leading-relaxed text-dim">Clips are re-encoded exactly as the site asks (H.264, 24 fps, 720×1280, silent), and every join is eased onto the frame it meets.</p>
          </section>
        </aside>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <section className="flex flex-col gap-3">
            <div><h3 className="text-[15px] font-semibold">Idle loops</h3><p className="text-[12px] text-dim">From her still back to it, safe for everyone. They play between everything else.</p></div>
            <div className="flex flex-wrap gap-4">
              {l.idle.map((x) => (
                <div key={x.key} className={cx("flex flex-col gap-1.5", !x.on && "opacity-45")}>
                  {clip(x.key, x.kind === "idle" ? "Plain idle" : x.kind === "typing" ? "Typing on her phone" : "Talking to camera", x.kind === "typing" ? "while she writes a reply" : x.kind === "talk" ? "while she answers the chat" : "everything comes back to it")}
                  {x.kind !== "idle" && <Switch on={x.on} set={(v) => up((s) => ({ ...s, idle: s.idle.map((y) => (y.key === x.key ? { ...y, on: v } : y)) }))}><span className="text-muted">In the pack</span></Switch>}
                </div>))}
            </div>
          </section>
          <section className="mt-8 flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div><h3 className="text-[15px] font-semibold">Her ladder</h3><p className="text-[12px] text-dim">Tips on the stream and buttons on the call, mildest first. Each one starts on her still and comes back to it — {l.actions.filter((a) => a.on).length} of at most 24.</p></div>
              <Btn small onClick={() => up((x) => ({ ...x, actions: [...x.actions, { key: `action_${Date.now().toString(36)}`, title: "New action", prompt: "She ", hint: "", rating: "sfw", seconds: 4, segs: 1, tier: "free", tokens: 10, on: true, level: (ladder.at(-1)?.level ?? 0) + 1 }] }))}
                disabled={l.actions.length >= 24}><Icon name="plus" size={13} /> Add an action</Btn>
            </div>
            <ol className="flex flex-col">
              {ladder.map((a, i) => {
                const parts = Array.from({ length: a.segs }, (_, j) => segKey(a.key, j));
                const [rt, rtone] = RATING[a.rating];
                const more = open === a.key;
                return (
                  <li key={a.key} className={cx("grid grid-cols-[44px_minmax(0,1fr)] gap-x-3", !a.on && "opacity-45")}>
                    {/* the ladder rail */}
                    <div className="relative flex flex-col items-center">
                      <span className={cx("absolute top-0 w-px bg-line2", i === 0 ? "top-6" : "", i === ladder.length - 1 ? "h-6" : "bottom-0")} />
                      <span className="relative z-[1] mt-3 flex h-7 w-7 items-center justify-center border border-line2 bg-bg text-[12px] font-semibold tabular-nums" title="Her ladder step">{a.level ?? "–"}</span>
                    </div>
                    <div className="flex flex-col gap-3 border-b border-line py-3 2xl:flex-row 2xl:items-start">
                      <div className="flex min-w-0 flex-col gap-2 2xl:w-[380px] 2xl:shrink-0">
                        <div className="flex items-center gap-2">
                          <input value={a.title} maxLength={40} onChange={(e) => act(a.key, { title: e.target.value })} aria-label="Button title"
                            className="h-8 min-w-0 flex-1 border border-transparent bg-transparent px-1 text-[14px] font-semibold hover:border-line focus:border-accent focus:outline-none" />
                          <span className={cx("shrink-0 border px-1.5 text-[10.5px]", rtone)}>{rt}</span>
                          <span className="shrink-0 text-[11.5px] tabular-nums text-muted" title="Tip price on the stream (the site can change it)">{a.tokens} tokens</span>
                          <button onClick={() => act(a.key, { on: !a.on })} title={a.on ? "Take it out of the pack" : "Put it back in the pack"} className="shrink-0 text-[11.5px] text-dim hover:text-ink">{a.on ? "On" : "Off"}</button>
                        </div>
                        <textarea value={a.prompt} onChange={(e) => act(a.key, { prompt: e.target.value })} rows={2} aria-label="What she does"
                          className="inset border border-line p-2 text-[12.5px] leading-relaxed focus:border-accent focus:outline-none" />
                        {a.segs > 1 && <div className="flex flex-col gap-1.5 border-l-2 border-accent/40 pl-2">
                          {parts.map((_, j) => (
                            <textarea key={j} value={a.parts?.[j] ?? ""} rows={1} placeholder={`Part ${j + 1}: what happens (it carries on from ${j ? `part ${j}` : "her still"})`} aria-label={`Part ${j + 1}`}
                              onChange={(e) => { const ps = Array.from({ length: a.segs }, (_, q) => a.parts?.[q] ?? ""); ps[j] = e.target.value; act(a.key, { parts: ps }); }}
                              className="inset border border-line p-1.5 text-[12px] leading-relaxed focus:border-accent focus:outline-none" />))}
                          <span className="text-[11px] text-dim">{a.segs} parts × {a.seconds} s = {a.segs * a.seconds} s, played as one take</span>
                        </div>}
                        <button onClick={() => setOpen(more ? null : a.key)} aria-expanded={more} className="flex items-center gap-1 self-start text-[11.5px] text-muted hover:text-ink">
                          <Icon name="chev" size={11} className={cx("transition-transform", more ? "rotate-90" : "")} />{more ? "Less" : `Settings · level ${a.level ?? "–"} · ${a.seconds} s${a.segs > 1 ? ` × ${a.segs}` : ""} · call: ${a.tier}`}</button>
                        {more && <div className="grid grid-cols-2 gap-2 text-[11.5px] text-muted sm:grid-cols-3">
                          <label className="flex flex-col gap-1" title="Her ladder step: 1 = the free opener, higher = bolder (the order the site gets them in)">Level<input type="number" min={1} max={30} value={a.level ?? ""} onChange={(e) => act(a.key, { level: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} className={field} /></label>
                          <label className="flex flex-col gap-1">Seconds a part<input type="number" min={2} max={15} value={a.seconds} onChange={(e) => act(a.key, { seconds: Math.max(2, Math.min(15, Number(e.target.value) || 4)) })} className={field} /></label>
                          <label className="flex flex-col gap-1" title="Longer than 15 s: split into parts played back to back">Parts<input type="number" min={1} max={4} value={a.segs} onChange={(e) => act(a.key, { segs: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })} className={field} /></label>
                          <label className="flex flex-col gap-1">Rating<DropSelect value={a.rating} onChange={(e) => act(a.key, { rating: e.target.value as LiveAction["rating"] })} className={field}>
                            <option value="sfw">SFW</option><option value="suggestive">Suggestive</option><option value="explicit">Explicit (paid fans)</option></DropSelect></label>
                          <label className="flex flex-col gap-1" title="Who gets the button on the call">Call button for<DropSelect value={a.tier} onChange={(e) => act(a.key, { tier: e.target.value as LiveAction["tier"] })} className={field}>
                            <option value="free">Everyone (free)</option><option value="premium">Premium</option><option value="ultimate">Ultimate</option></DropSelect></label>
                          <label className="flex flex-col gap-1" title="Its price as a stream tip (the site can change it)">Tip (tokens)<input type="number" min={1} value={a.tokens} onChange={(e) => act(a.key, { tokens: Math.max(1, Number(e.target.value) || 10) })} className={field} /></label>
                          <label className="col-span-2 flex flex-col gap-1 sm:col-span-3">What she did — for her message after (nobody sees it)<input value={a.hint} maxLength={200} onChange={(e) => act(a.key, { hint: e.target.value })} className={field} /></label>
                        </div>}
                      </div>
                      {/* the clips, in play order, with every join between them */}
                      <div className="flex min-w-0 items-start overflow-x-auto pb-1">
                        <StillMini cid={c.id} at={l.anchor?.at} label="Starts on her still" />
                        {parts.map((k, j) => (
                          <span key={k} className="flex items-start">
                            <Join d={l.clips[k]?.enc?.d_start} label={j === 0 ? "Still → the action" : `Part ${j} → part ${j + 1}`} />
                            {clip(k, a.segs > 1 ? `Part ${j + 1}` : "The action")}
                          </span>))}
                        <Join d={l.clips[retKey(a.key)]?.enc?.d_start} label="The action → back" />
                        {clip(retKey(a.key), "Back to the still")}
                        <Join d={l.clips[retKey(a.key)]?.enc?.d_end} label="Back → her still" />
                        <StillMini cid={c.id} at={l.anchor?.at} label="Ends on her still" />
                      </div>
                    </div>
                  </li>);
              })}
            </ol>
          </section>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-panel px-5 py-3 text-[13px]">
        {busy ? <span className="flex items-center gap-2 text-muted"><span className="pulse h-1.5 w-1.5 rounded-full bg-accent" />{busy}</span>
          : l.sent ? <span className={l.sent.status < 300 ? "text-good" : "text-bad"}>{l.sent.status < 300 ? `Sent ${new Date(l.sent.at).toLocaleString()} — a draft until it's published on the site` : `Last send: the site answered ${l.sent.status} — ${l.sent.problems}`}</span>
          : block.length ? <span className="text-muted">Before sending: {block.join(" · ")}</span> : <span className="text-good">Ready to send</span>}
        <span className="ml-auto flex flex-wrap gap-2">
          <Btn onClick={() => void run("The writer is planning her actions…", async () => {
            const { liveExamples, liveExamplePics } = await import("./LiveBatch");
            const n = await planActions(c.id, { examples: liveExamples(), pictures: liveExamplePics(), count: Math.max(4, l.actions.length), ratings: [...new Set(l.actions.map((a) => a.rating))].length ? [...new Set(l.actions.map((a) => a.rating))] : ["sfw"], keep: true });
            toast(`${n} actions planned in her manner — made ones it kept stay`, "good");
          })} disabled={!!busy} why="Busy" title="DeepSeek plans her ladder and words her idle loops from her personality, learning from the examples in Batch → Live packs (the ones you've made and it keeps stay)"><Icon name="sparkle" size={14} /> Plan with the writer</Btn>
          <Btn onClick={() => void run("Making the clips… (they're in the GPU line — this can take a while)", () => makeAll(c.id))} disabled={!l.anchor || !!busy} why={!l.anchor ? "Pick her still first" : "Busy"}><Icon name="play" size={14} /> {made ? "Make the missing clips" : "Make all clips"}</Btn>
          <Btn onClick={() => void run("Putting the reel together…", async () => setReel(await makeReel(c.id)))} disabled={!made || !!busy} why="Make some clips first">Watch the reel</Btn>
          <Btn kind="primary" onClick={() => void run("Sending to the site…", async () => { const r = await sendLive(c.id); toast(`${c.name}'s live pack: ${r.note}`, r.ok ? "good" : "bad"); })}
            disabled={block.length > 0 || !!busy} why={block[0] ? `First: ${block[0]}` : "Busy"}><Icon name="up" size={14} /> Send to the site</Btn>
        </span>
      </div>
      {reel && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-6" onClick={() => setReel(null)}>
          <div className="flex max-h-full flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <video src={reel} controls autoPlay loop className="max-h-[80vh] border border-line" />
            <p className="max-w-md text-center text-[12.5px] text-muted">The whole pack the way the site plays it: every idle, and every action between two plain idles. Watch the moments one clip turns into the next — nothing should jump. Then tick the clips that look right.</p>
            <Btn small onClick={() => setReel(null)}>Close</Btn>
          </div>
        </div>)}
    </div>, document.body);
}

function ClipCard({ cid, k, clip, label, note, onTick, onRedo, disabled }: { cid: string; k: string; clip?: LiveClip; label: string; note?: string; onTick: (v: boolean) => void; onRedo: () => void; disabled?: boolean }) {
  const st = clip?.status ?? "new";
  const lk = clip?.likeness && clip.likeness.used !== "no sheet" ? clip.likeness : null;
  const final = lk ? (lk.used === "fixed" ? lk.after : lk.before) : null;
  const busy = st === "making" || st === "encoding";
  return (
    <div className="flex w-[120px] shrink-0 flex-col gap-1.5">
      <div className={cx("group relative aspect-[9/16] overflow-hidden border bg-raised2", clip?.ok ? "border-good/60" : st === "error" ? "border-bad/60" : "border-line")}>
        {st === "ready" && clip?.enc
          ? <video src={fileUrl(cid, k, clip.enc.at)} muted loop autoPlay playsInline className="h-full w-full object-cover" />
          : <span className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center text-[11px] text-dim">
              {busy ? <><span className="pulse h-1.5 w-1.5 rounded-full bg-accent" />{st === "making" ? "H3 is making it" : clip?.error ?? "Fitting it to the site"}</>
                : st === "error" ? <span className="text-bad">{clip?.error}</span> : "Not made yet"}</span>}
        {lk && <span className={cx("absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4 text-[10.5px]", final != null && final < 7 ? "text-amber-300" : "text-good")}
          title={`Her likeness on this part's last frame (DeepSeek's face match, 0-10): ${lk.before ?? "?"} before, ${lk.after ?? "?"} after the face fix. ${lk.used === "fixed" ? "The fixed frame went on." : "The fix didn't score better, so the original went on."}${lk.why ? ` ${lk.why}` : ""}`}>
          Likeness {lk.before ?? "?"} → {lk.after ?? "?"}</span>}
        {clip?.ok && <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center bg-good text-black" title="Checked by eye"><Icon name="check" size={12} /></span>}
      </div>
      <div className="flex min-w-0 flex-col">
        <b className="truncate text-[12px]">{label}</b>
        {note && <span className="truncate text-[10.5px] text-dim" title={note}>{note}</span>}
      </div>
      <div className="flex items-center gap-1">
        {st === "ready" && <button onClick={() => onTick(!clip?.ok)} aria-pressed={!!clip?.ok} title="You watched it (and its joins in the reel) and it looks right"
          className={cx("press flex h-6 flex-1 items-center justify-center gap-1 border text-[11px]", clip?.ok ? "border-good/60 bg-good/10 text-good" : "border-line text-muted hover:text-ink")}>
          {clip?.ok ? <><Icon name="check" size={11} />Looks right</> : "Looks right?"}</button>}
        <button disabled={disabled || busy} onClick={onRedo} title={st === "new" ? "Make this clip" : "Make this clip again (later parts of the action follow)"}
          className={cx("press flex h-6 items-center justify-center border border-line px-2 text-[11px] text-muted hover:text-ink disabled:opacity-40", st !== "ready" && "flex-1")}>
          {st === "new" || st === "error" ? "Make" : <Icon name="refresh" size={12} />}</button>
      </div>
    </div>
  );
}
