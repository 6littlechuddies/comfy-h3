// The Live pack builder: her still, idle loops and actions for the site's Live Stream (tips) and Live Action (call buttons).
// Every clip shows how big its joins jumped before they were eased (the site plays them back to back as one shot), a reel
// plays the whole pack in the order the site would, and nothing is sent until every clip is ticked as checked by eye.
import { Thumb } from "./Thumb";
import { useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { viewUrl, type FileRef } from "../lib/api";
import { useCharacters, type Character } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { TEST_WAYS, actionState, blockers, checkOnSite, ensureNudeSheet, planActions, fileUrl, isTwoState, jumpLevel, liveOf, makeAll, makeMidAnchor, makeNudeAnchor, makeReel, nudeRetKey, nudeSegKey, packKeys, redoClip, retKey, saveLive, segKey, sendLive, setAnchor, setMidAnchor, setNudeAnchor,
  type ActionClothingState, type LiveAction, type LiveClip, type LiveState } from "../lib/live";
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
function StillMini({ cid, at, label, slot = "anchor" }: { cid: string; at?: number; label: string; slot?: "anchor" | "nude_anchor" | "mid_anchor" }) {
  return (
    <span className="mt-[68px] flex w-10 shrink-0 flex-col items-center gap-1" title={label}>
      <span className={cx("aspect-[9/16] w-full overflow-hidden border bg-raised2", slot === "nude_anchor" ? "border-bad/60" : slot === "mid_anchor" ? "border-amber-300/60" : "border-accent/50")}>
        {at ? <img src={fileUrl(cid, slot, at)} alt="" className="h-full w-full object-cover" /> : null}
      </span>
      <span className="text-[9.5px] uppercase tracking-wide text-dim">{slot === "nude_anchor" ? "nude" : slot === "mid_anchor" ? "mid" : "still"}</span>
    </span>
  );
}

const STATE_BADGE: Record<ActionClothingState, [string, string]> = {
  clothed: ["Clothed", "text-muted border-line2"],
  clothed_and_nude: ["Clothed + Nude", "text-accent border-accent/50"],
  undress: ["Undress → Nude", "text-amber-300 border-amber-300/50"],
  nude: ["Nude only", "text-bad border-bad/50"],
};

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
  const two = isTwoState(l);
  const toast = useJobs((s) => s.toast);
  const [picking, setPicking] = useState(!l.anchor);
  const [pickingSlot, setPickingSlot] = useState<"anchor" | "nude_anchor" | "mid_anchor">("anchor");
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
            <div className="flex items-baseline justify-between"><h3 className="text-[13.5px] font-semibold">{picking && pickingSlot === "nude_anchor" ? "Pick Nude Anchor" : picking && pickingSlot === "mid_anchor" ? "Pick Mid-Undress Still" : "Her still (clothed)"}</h3>
              {l.anchor && !picking && <button onClick={() => { setPickingSlot("anchor"); setPicking(true); }} className="text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline">Pick another</button>}
              {picking && l.anchor && <button onClick={() => setPicking(false)} className="text-[12px] text-muted hover:text-ink">Keep current</button>}</div>
            {l.anchor && !picking
              ? <img src={fileUrl(c.id, "anchor", l.anchor.at)} alt="Her still" className="aspect-[9/16] w-full border border-line object-cover" />
              : <>
                <p className="text-[11.5px] leading-relaxed text-dim">Every clip starts or ends on this exact frame. A 9:16 picture of her resting works best; others are cut from the middle.</p>
                <div className="grid max-h-[46vh] grid-cols-3 gap-1.5 overflow-y-auto">
                  {pics.length ? pics.map((p) => (
                    <button key={`${p.subfolder}/${p.filename}`} title={`Use as ${pickingSlot.replace("_", " ")}`} onClick={() => void run(`Setting ${pickingSlot.replace("_", " ")}…`, async () => {
                      if (pickingSlot === "anchor") {
                        if (l.anchor && Object.values(l.clips).some((x) => x.status === "ready") && !confirm("A new clothed still means every clip is made again. Go ahead?")) return;
                        await setAnchor(c.id, p);
                      } else if (pickingSlot === "nude_anchor") {
                        await setNudeAnchor(c.id, p);
                      } else {
                        await setMidAnchor(c.id, p);
                      }
                      setPicking(false);
                    })} className="press aspect-[9/16] overflow-hidden border border-line hover:border-accent">
                      <Thumb f={p} className="h-full w-full object-cover" />
                    </button>)) : <p className="col-span-3 text-[12px] text-dim">No pictures of her yet — make one in 03 Create, or make a still from her room below.</p>}
                </div>
              </>}
            <div role="radiogroup" aria-label="Framing" className="grid grid-cols-2 gap-[3px] border border-line2 p-[3px]">
              {([["waist_up", "Waist up"], ["full_body", "Full body"]] as const).map(([v, t]) => (
                <button key={v} role="radio" aria-checked={l.framing === v} onClick={() => up((x) => ({ ...x, framing: v }))}
                  className={cx("press h-7 text-[12px]", l.framing === v ? "bg-raised2 text-ink" : "text-muted hover:text-ink")}>{t}</button>))}
            </div>
          </section>
          <section className="flex flex-col gap-2.5 border-t border-line pt-4">
            <Switch on={two} set={(v) => up((x) => ({ ...x, twoState: v }))} title="2-state Live Action: Clothed Still → Undress bridge → Nude Still, so once she undresses she stays nude and plays nude idles + nude takes cleanly">
              2-State: Clothed → Undress → Nude
              <span className="block text-[11px] text-dim">Adds pixel-aligned Nude Anchor + Nude Idles + nude takes for Clothed+Nude actions</span>
            </Switch>
            {two && (
              <div className="flex flex-col gap-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="flex items-center justify-between text-[11px] font-medium text-muted">
                      <span>Nude Anchor</span>
                      <button onClick={() => { setPickingSlot("nude_anchor"); setPicking(true); }} className="text-accent hover:underline">Pick</button>
                    </span>
                    <span className="flex aspect-[9/16] items-center justify-center overflow-hidden border border-bad/40 bg-raised2 text-center text-[10px] text-dim">
                      {l.nudeAnchor ? <img src={fileUrl(c.id, "nude_anchor", l.nudeAnchor.at)} alt="Nude anchor" className="h-full w-full object-cover" /> : "Edit from clothed still"}
                    </span>
                    <Btn small disabled={!!busy || !l.anchor} why={!l.anchor ? "Pick clothed still first" : "Busy"}
                      onClick={() => void run("Editing Nude Anchor from clothed still…", async () => {
                        const outs = await makeNudeAnchor(c.id, 2);
                        await setNudeAnchor(c.id, outs[0]);
                        toast(`${outs.length} pixel-aligned nude anchors made (1st selected — click Pick to view other take)`, "good");
                      })}>{l.nudeAnchor ? "Redo nude still" : "Edit from still"}</Btn>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="flex items-center justify-between text-[11px] font-medium text-muted">
                      <span>Mid-Undress <span className="text-dim">(opt)</span></span>
                      {l.midAnchor ? <button onClick={() => void setMidAnchor(c.id, null)} className="text-dim hover:text-bad">Clear</button>
                        : <button onClick={() => { setPickingSlot("mid_anchor"); setPicking(true); }} className="text-accent hover:underline">Pick</button>}
                    </span>
                    <span className="flex aspect-[9/16] items-center justify-center overflow-hidden border border-amber-300/40 bg-raised2 px-1 text-center text-[10px] text-dim">
                      {l.midAnchor ? <img src={fileUrl(c.id, "mid_anchor", l.midAnchor.at)} alt="Mid undress" className="h-full w-full object-cover" /> : "For layered outfits / cosplays"}
                    </span>
                    <Btn small disabled={!!busy || !l.anchor} why={!l.anchor ? "Pick clothed still first" : "Busy"}
                      onClick={() => void run("Making Mid-Undress still…", async () => {
                        const outs = await makeMidAnchor(c.id, 2);
                        await setMidAnchor(c.id, outs[0]);
                        toast(`${outs.length} mid-undress stills made (1st selected for 2-part Undress)`, "good");
                      })}>{l.midAnchor ? "Redo mid still" : "Make mid still"}</Btn>
                  </div>
                </div>
              </div>
            )}
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
            {l.refs !== false && <div className={cx("grid gap-1.5", two ? "grid-cols-2" : "grid-cols-3")}>
              {([
                ["Angles", c.views.sheet ?? c.views.front, null],
                ...(two ? [["Nude Body", c.views.nudeSheet, "nudeSheet"] as const] : []),
                ["Expressions", c.views.faces, "faces"],
                ["Room", l.room?.ref, "room"],
              ] as readonly (readonly [string, FileRef | undefined, "room" | "faces" | "nudeSheet" | null])[]).map(([t, f, make]) => (
                <div key={t} className="flex flex-col gap-1">
                  <span className="flex aspect-square items-center justify-center overflow-hidden border border-line bg-raised2 text-center text-[10px] leading-tight text-dim">
                    {f ? <img src={viewUrl(f)} alt={t} className="h-full w-full object-cover" /> : make === "room" && !l.anchor ? "after her still" : "not made yet"}</span>
                  <span className="flex items-center justify-between text-[10.5px] text-muted">{t}
                    {make && <button disabled={!!busy || (make === "room" && !l.anchor) || (make === "faces" && !c.views.front) || (make === "nudeSheet" && !c.views.sheet && !c.views.front)} className="text-accent hover:underline disabled:text-dim disabled:no-underline"
                      title={make === "room" ? "Her room as a set sheet from her still" : make === "nudeSheet" ? "Unclothed body baseline edited directly from her All angles sheet so body proportions never drift across nude clips" : "Her face in twelve expressions and four mouth shapes"}
                      onClick={() => void run(make === "room" ? "Making her room sheet…" : make === "nudeSheet" ? "Making her Nude Body sheet…" : "Making her expression sheet…", async () => {
                        const L = await import("../lib/live");
                        if (make === "room") await L.makeRoom(c.id);
                        else if (make === "nudeSheet") await ensureNudeSheet(c.id, true);
                        else {
                          const [{ facesGraph }, { useCharacters: uc }] = await Promise.all([import("../lib/sheet"), import("../lib/characters")]);
                          const front = await uc.getState().asMedia(c.id, "front");
                          if (!front) throw new Error("She needs a front picture first");
                          const { waitForJob } = await import("../lib/jobs");
                          const j = await useJobs.getState().run("characters", `${c.name}: expression sheet`, facesGraph(c, front.name), "characters:view:krea", { charId: c.id, view: "faces" });
                          await waitForJob(j.id);
                        }
                        toast(make === "room" ? "Her room sheet is in" : make === "nudeSheet" ? "Her Nude Body baseline sheet is in — nude anchor & nude clips will lock to it" : "Her expression sheet is in", "good");
                      })}>{f ? "Redo" : "Make"}</button>}</span>
                </div>))}
            </div>}
          </section>
          <LikenessTestPanel c={c} l={l} busy={!!busy} run={run} />
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
            <div><h3 className="text-[15px] font-semibold">Clothed idle loops</h3><p className="text-[12px] text-dim">Staggered expressive loops off her Clothed Still (5–12 s each so they don&apos;t feel repetitive). Safe for everyone.</p></div>
            <div className="flex flex-wrap gap-4">
              {l.idle.map((x) => {
                const label = x.key === "idle_smirk" ? "Knowing smirk" : x.key === "idle_tease" ? "Playful tease" : x.kind === "typing" ? "Typing" : x.kind === "talk" ? "Talking to camera" : "Smile & laugh";
                return (
                  <div key={x.key} className={cx("flex flex-col gap-1.5", !x.on && "opacity-45")}>
                    {clip(x.key, `${label} (${x.seconds}s)`, x.kind === "typing" ? "while she writes a reply" : x.kind === "talk" ? "while she answers chat" : "staggered idle loop")}
                    {x.key !== "idle_main" && <Switch on={x.on} set={(v) => up((s) => ({ ...s, idle: s.idle.map((y) => (y.key === x.key ? { ...y, on: v } : y)) }))}><span className="text-muted">In the pack</span></Switch>}
                  </div>
                );
              })}
            </div>
          </section>
          {two && (
            <section className="mt-6 flex flex-col gap-3 border-t border-line pt-6">
              <div><h3 className="text-[15px] font-semibold">Nude idle loops</h3><p className="text-[12px] text-dim">Played automatically once she undresses — starts and ends on her Nude Anchor using her Nude Body sheet.</p></div>
              <div className="flex flex-wrap gap-4">
                {(l.nudeIdle ?? []).map((x) => {
                  const label = x.key.includes("smirk") ? "Nude smirk" : x.key.includes("tease") ? "Nude tease" : x.key.includes("coy") ? "Nude coy look" : "Nude smile";
                  return (
                    <div key={x.key} className={cx("flex flex-col gap-1.5", !x.on && "opacity-45")}>
                      {clip(x.key, `${label} (${x.seconds}s)`, "nude idle loop")}
                      {x.key !== "nude_idle_main" && <Switch on={x.on} set={(v) => up((s) => ({ ...s, nudeIdle: (s.nudeIdle ?? []).map((y) => (y.key === x.key ? { ...y, on: v } : y)) }))}><span className="text-muted">In the pack</span></Switch>}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          <section className="mt-8 flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div><h3 className="text-[15px] font-semibold">Her ladder</h3><p className="text-[12px] text-dim">Tips on the stream and buttons on the call, mildest first. Each one starts on her still and comes back to it — {l.actions.filter((a) => a.on).length} of at most 24.</p></div>
              <Btn small onClick={() => up((x) => ({ ...x, actions: [...x.actions, { key: `action_${Date.now().toString(36)}`, title: "New action", prompt: "She ", hint: "", rating: "sfw", seconds: 4, segs: 1, tier: "free", tokens: 10, on: true, level: (ladder.at(-1)?.level ?? 0) + 1 }] }))}
                disabled={l.actions.length >= 24}><Icon name="plus" size={13} /> Add an action</Btn>
            </div>
            <ol className="flex flex-col">
              {ladder.map((a, i) => {
                const parts = Array.from({ length: a.segs }, (_, j) => segKey(a.key, j));
                const nudeParts = Array.from({ length: a.segs }, (_, j) => nudeSegKey(a.key, j));
                const [rt, rtone] = RATING[a.rating];
                const st = actionState(a);
                const [stLabel, stTone] = STATE_BADGE[st];
                const startSlot = two && st === "nude" ? "nude_anchor" : "anchor";
                const endSlot = two && (st === "nude" || st === "undress") ? "nude_anchor" : "anchor";
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
                          {two && <span className={cx("shrink-0 border px-1.5 text-[10.5px]", stTone)}>{stLabel}</span>}
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
                          <Icon name="chev" size={11} className={cx("transition-transform", more ? "rotate-90" : "")} />{more ? "Less" : `Settings · #${a.level ?? "–"}${a.unlock ? ` · opens at level ${a.unlock}` : ""} · ${a.seconds} s${a.segs > 1 ? ` × ${a.segs}` : ""} · ${stLabel}`}</button>
                        {more && <div className="grid grid-cols-2 gap-2 text-[11.5px] text-muted sm:grid-cols-3">
                          <label className="flex flex-col gap-1" title="Her ladder step: 1 = the free opener, higher = bolder (the order the site gets them in)">Order<input type="number" min={1} max={30} value={a.level ?? ""} onChange={(e) => act(a.key, { level: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} className={field} /></label>
                          <label className="flex flex-col gap-1">Seconds a part<input type="number" min={2} max={15} value={a.seconds} onChange={(e) => act(a.key, { seconds: Math.max(2, Math.min(15, Number(e.target.value) || 4)) })} className={field} /></label>
                          <label className="flex flex-col gap-1" title="Longer than 15 s: split into parts played back to back">Parts<input type="number" min={1} max={4} value={a.segs} onChange={(e) => act(a.key, { segs: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })} className={field} /></label>
                          <label className="flex flex-col gap-1">Rating<DropSelect value={a.rating} onChange={(e) => act(a.key, { rating: e.target.value as LiveAction["rating"] })} className={field}>
                            <option value="sfw">SFW</option><option value="suggestive">Suggestive</option><option value="explicit">Explicit (paid fans)</option></DropSelect></label>
                          <label className="flex flex-col gap-1" title="2-state Live Action role: Clothed only, Clothed + Nude (renders a nude take too), Undress bridge, or Nude only">Clothing state<DropSelect value={st} onChange={(e) => act(a.key, { clothingState: e.target.value as ActionClothingState })} className={field}>
                            <option value="clothed">Clothed only</option><option value="clothed_and_nude">Clothed + Nude (2 takes)</option><option value="undress">Undress bridge → Nude</option><option value="nude">Nude only</option></DropSelect></label>
                          <label className="flex flex-col gap-1" title="The relationship level (1–7) her call button opens at. The site never opens an explicit one before her intimate level, whatever you pick">Opens at level<DropSelect value={String(a.unlock ?? 0)} onChange={(e) => act(a.key, { unlock: Number(e.target.value) || undefined })} className={field}>
                            <option value="0">Site default ({a.rating === "sfw" ? "1" : a.rating === "suggestive" ? "2" : "intimate"})</option>{[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>Level {n}</option>)}</DropSelect></label>
                          <label className="flex flex-col gap-1" title="Its price as a stream tip (the site can change it)">Tip (tokens)<input type="number" min={1} value={a.tokens} onChange={(e) => act(a.key, { tokens: Math.max(1, Number(e.target.value) || 10) })} className={field} /></label>
                          <label className="col-span-2 flex flex-col gap-1 sm:col-span-3">What she did — for her message after (nobody sees it)<input value={a.hint} maxLength={200} onChange={(e) => act(a.key, { hint: e.target.value })} className={field} /></label>
                        </div>}
                      </div>
                      {/* the clips, in play order, with every join between them */}
                      <div className="flex min-w-0 flex-col gap-3 overflow-x-auto pb-1">
                        <div className="flex items-start">
                          <StillMini cid={c.id} slot={startSlot} at={startSlot === "nude_anchor" ? l.nudeAnchor?.at : l.anchor?.at} label={`Starts on her ${startSlot === "nude_anchor" ? "nude" : "clothed"} still`} />
                          {parts.map((k, j) => (
                            <span key={k} className="flex items-start">
                              <Join d={l.clips[k]?.enc?.d_start} label={j === 0 ? "Still → the action" : `Part ${j} → part ${j + 1}`} />
                              {clip(k, a.segs > 1 ? `Part ${j + 1}` : st === "undress" ? "Undress" : "The action")}
                            </span>))}
                          <Join d={l.clips[retKey(a.key)]?.enc?.d_start} label="The action → back" />
                          {clip(retKey(a.key), endSlot === "nude_anchor" ? "Settle to nude still" : "Back to the still")}
                          <Join d={l.clips[retKey(a.key)]?.enc?.d_end} label="Back → target still" />
                          <StillMini cid={c.id} slot={endSlot} at={endSlot === "nude_anchor" ? l.nudeAnchor?.at : l.anchor?.at} label={`Ends on her ${endSlot === "nude_anchor" ? "nude" : "clothed"} still`} />
                        </div>
                        {two && st === "clothed_and_nude" && (
                          <div className="flex items-start border-t border-dashed border-line pt-2">
                            <StillMini cid={c.id} slot="nude_anchor" at={l.nudeAnchor?.at} label="Nude take starts on her Nude Anchor" />
                            {nudeParts.map((k, j) => (
                              <span key={k} className="flex items-start">
                                <Join d={l.clips[k]?.enc?.d_start} label={j === 0 ? "Nude still → nude take" : `Nude part ${j} → ${j + 1}`} />
                                {clip(k, a.segs > 1 ? `Nude part ${j + 1}` : "Nude take")}
                              </span>))}
                            <Join d={l.clips[nudeRetKey(a.key)]?.enc?.d_start} label="Nude take → back" />
                            {clip(nudeRetKey(a.key), "Back to nude still")}
                            <Join d={l.clips[nudeRetKey(a.key)]?.enc?.d_end} label="Back → nude still" />
                            <StillMini cid={c.id} slot="nude_anchor" at={l.nudeAnchor?.at} label="Nude take ends on her Nude Anchor" />
                          </div>
                        )}
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

/** the likeness test: one action's first part made three ways (plain, sheets as pictures, RefMod), same seed, each scored */
function LikenessTestPanel({ c, l, busy, run }: { c: Character; l: LiveState; busy: boolean; run: (label: string, f: () => Promise<unknown>) => Promise<void> }) {
  const t = l.test;
  const on = l.actions.filter((a) => a.on);
  const [act, setAct] = useState(on[0]?.key ?? "");
  const making = !!t && Object.values(t.ways).some((w) => w?.status === "making");
  const best = t ? Math.max(...TEST_WAYS.map(({ way }) => t.ways[way]?.score ?? -1)) : -1;
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <div className="flex items-baseline justify-between"><h3 className="text-[13.5px] font-semibold">Which way keeps her best?</h3>
        {t && <span className="text-[11px] text-dim">{t.title}</span>}</div>
      <p className="text-[11.5px] leading-relaxed text-dim">One action's first part, made three ways with the same seed, each scored by DeepSeek's face match on its last frame. Watch them too — the score only sees the face.</p>
      {t && <div className="grid grid-cols-3 gap-1.5">
        {TEST_WAYS.map(({ way, label, what }) => { const w = t.ways[way]; return (
          <div key={way} className="flex flex-col gap-1" title={what}>
            <span className={cx("relative flex aspect-[9/16] items-center justify-center overflow-hidden border bg-raised2 text-center text-[10px] text-dim", w?.status === "ready" && w.score != null && w.score === best ? "border-good" : "border-line")}>
              {w?.status === "ready" ? <video src={fileUrl(c.id, `test_${way}`, w.at)} muted loop playsInline autoPlay className="h-full w-full object-cover" />
                : w?.status === "error" ? <span className="px-1 text-bad">{w.error}</span> : <span className="pulse">making…</span>}
              {w?.status === "ready" && <span className="absolute bottom-0 left-0 right-0 bg-black/75 py-0.5 text-[10.5px] text-white">{w.score == null ? "no score" : `face ${w.score}/10`}</span>}
            </span>
            <span className="text-center text-[10.5px] text-muted">{label}</span>
          </div>); })}
      </div>}
      <div className="flex gap-1.5">
        <select value={act} onChange={(e) => setAct(e.target.value)} aria-label="Action to test" className="inset min-w-0 flex-1 border border-line px-1.5 text-[11.5px]">
          {on.map((a) => <option key={a.key} value={a.key}>{a.title}</option>)}
        </select>
        <Btn small onClick={() => void run("Likeness test: three clips in the GPU line…", async () => { const { likenessTest } = await import("../lib/live"); await likenessTest(c.id, act); })}
          disabled={busy || making || !l.anchor || !on.length} why={!l.anchor ? "Pick her still first" : !on.length ? "Turn on an action" : "Busy"}>{t ? "Test again" : "Run the test"}</Btn>
      </div>
    </section>
  );
}
