// Batch → Cosplay: paste characters, research them (adult check, costume, LoRAs, prompt), approve LoRAs, add to the batch.
// Layout: the drawer has four folding sections (who wears it · LoRAs & checkpoint · shots & poses · learned taste); the main
// card is the list — one row per character with its status and chips, opening into tabs (Pictures · LoRAs · Look & checkpoint).
import { useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { addList, approve, findLoras, picksOf, researchAll, toBatch, useCosplay, type Candidate, type CosItem } from "../lib/cosplay";
import { usePoseWear } from "../lib/posewear";
import { isAdult, looks, useCharacters } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { viewUrl } from "../lib/api";
import { Btn, DropSelect, Icon, LoraList, Seg, cx } from "./ui";
import { CheckpointPicker } from "./Checkpoint";
import { examples, useBank } from "../lib/promptBank";

// ------------------------------------------------------------------ small parts
const SEC_KEY = "h3.cosplay.sections";
const loadSec = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(SEC_KEY) || "{}"); } catch { return {}; } };

/** a folding section of the drawer: title, a one-line summary of what's set, the controls */
function Section({ id, title, summary, children, first }: { id: string; title: string; summary?: ReactNode; children: ReactNode; first?: boolean }) {
  const [open, setOpen] = useState(() => loadSec()[id] ?? true);
  const flip = () => { const v = !open; setOpen(v); try { localStorage.setItem(SEC_KEY, JSON.stringify({ ...loadSec(), [id]: v })); } catch { /* */ } };
  return (
    <section className={cx("flex flex-col", !first && "border-t border-line pt-3")}>
      <button onClick={flip} aria-expanded={open} className="group flex items-center gap-2 text-left">
        <Icon name="chev" size={12} className={cx("text-dim transition-transform", !open && "-rotate-90")} />
        <span className="text-[13px] font-semibold text-ink">{title}</span>
        {!open && summary && <span className="ml-auto truncate text-[11.5px] text-dim">{summary}</span>}
      </button>
      {open && <div className="mt-2.5 flex flex-col gap-3">{children}</div>}
    </section>
  );
}

/** a switch with a title and one line of what it does */
function Toggle({ on, set, title, sub }: { on: boolean; set: (v: boolean) => void; title: string; sub: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => set(!on)} className="press flex items-start gap-2.5 text-left">
      <span className={cx("relative mt-0.5 h-[18px] w-8 shrink-0 border transition-colors", on ? "border-accent bg-accent" : "border-line bg-raised2")}>
        <span className={cx("absolute top-[2px] h-3 w-3 transition-all", on ? "left-[15px] bg-accentink" : "left-[2px] bg-dim")} />
      </span>
      <span className="flex min-w-0 flex-col"><span className="text-[13px] text-ink">{title}</span><span className="text-[11.5px] leading-snug text-dim">{sub}</span></span>
    </button>
  );
}

/** a small rounded label */
function Chip({ children, tone = "dim", title }: { children: ReactNode; tone?: "dim" | "good" | "bad" | "accent" | "hot"; title?: string }) {
  const c = { dim: "border-line text-muted", good: "border-good/40 text-good", bad: "border-bad/40 text-bad", accent: "border-accent/50 text-accent", hot: "border-hot/50 text-hot" }[tone];
  return <span title={title} className={cx("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px]", c)}>{children}</span>;
}

// ------------------------------------------------------------------ the drawer
/** what the writer has learned from what you keep (the prompt bank) — no typing: it comes from what you do */
function Learned() {
  const b = useBank();
  const liked = Object.values(b.entries).filter((e) => e.score >= 3).length;
  const del = Object.values(b.entries).filter((e) => e.score < 0).length;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2 text-[12.5px]">
      <p className="leading-relaxed text-dim">{!b.loaded ? "Loading…" : liked ? `From ${liked} picture${liked > 1 ? "s" : ""} you kept${del ? ` and ${del} you deleted` : ""}. It steers how prompts are worded — never the pose or background.` : "Nothing yet. Star, animate, upscale or download pictures — the writer learns from what you keep and what you delete."}</p>
      {liked > 0 && <button onClick={() => setOpen(!open)} className="self-start text-[12px] text-accent hover:underline">{open ? "Hide what it learned" : "See what it learned"}</button>}
      {open && <div className="flex flex-col gap-2">
        {b.taste?.notes && <pre className="whitespace-pre-wrap rounded-sm border border-line bg-black/20 p-2 font-sans text-[12px] text-muted">{b.taste.notes}</pre>}
        {examples(3).map((e) => <p key={e.k} className="line-clamp-3 border-l-2 border-accent/40 pl-2 text-[11.5px] text-muted" title={e.prompt}><b className="text-ink">{e.score.toFixed(1)}</b> · {e.prompt}</p>)}
      </div>}
    </div>
  );
}

export function CosplayOptions() {
  const o = useCosplay((s) => s.opts);
  const set = (p: Partial<typeof o>) => useCosplay.getState().set({ opts: { ...o, ...p } });
  const chars = useCharacters(useShallow((s) => s.list.filter((c) => isAdult(c) && c.style !== "anime" && c.views.front)));
  const nPoses = usePoseWear((s) => s.picks.filter((p) => p.lib === "poses" || p.lib === "depths").length);
  const nLocked = Object.keys(o.lockedAll ?? {}).filter((n) => (o.loras ?? []).some((l) => l.name === n)).length;
  const who = o.cosplayer === "one" ? chars.find((c) => c.id === o.charId)?.name ?? "pick one" : o.look?.trim() || "a new woman each";
  return (
    <div className="flex flex-col gap-3">
      <Section first id="who" title="Who wears it" summary={who}>
        <Seg value={o.cosplayer} onChange={(v) => set({ cosplayer: v })} options={[{ value: "each", label: "A new woman each" }, { value: "one", label: "One of mine" }]} />
        {o.cosplayer === "one" ? <>
          <DropSelect value={o.charId ?? ""} onChange={(e) => set({ charId: e.target.value || null })} className="inset h-10 border px-2.5 text-[13.5px]">
            <option value="">Pick a character…</option>
            {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </DropSelect>
          <p className="-mt-1.5 text-[11.5px] text-dim">She wears every costume — her face and body come from her pictures.</p>
        </> : <label className="flex flex-col gap-1">
          <input value={o.look ?? ""} onChange={(e) => set({ look: e.target.value })} placeholder="Their look, e.g. East Asian — Japanese or Korean" className="inset h-9 border px-2.5 text-[13px] focus:border-accent focus:outline-none" />
          <span className="text-[11.5px] text-dim">Adult women about 25; blank lets the writer decide. Faces always vary.</span>
        </label>}
      </Section>

      <Section id="loras" title="LoRAs & checkpoint" summary={`${(o.loras ?? []).length} on every picture${nLocked ? ` · ${nLocked} locked` : ""}${o.director ? " · DeepSeek picks" : ""}`}>
        <Toggle on={!!o.director} set={(v) => set({ director: v })} title="Let DeepSeek pick LoRAs"
          sub="Per character: reads her build, then up to 5 of your Krea 2 LoRAs (realism, body shape, style) — each with a reason. Kept under Krea 2's strength limit so nothing goes blotchy. It picks a checkpoint too only when Checkpoint above is set to “DeepSeek picks one for each character”." />
        <Toggle on={o.auto} set={(v) => set({ auto: v })} title="Approve her CivitAI LoRA by itself" sub="The most collected Krea 2 LoRA of the character. Off: you tick them on each character." />
        {o.auto && <label className="-mt-1.5 flex items-center gap-2 pl-[42px] text-[12px] text-muted">if it has at least<input type="number" min={0} step={10} value={o.minCollected} onChange={(e) => set({ minCollected: Math.max(0, Number(e.target.value) || 0) })} className="inset h-7 w-16 border px-1.5" />collections</label>}
        <Toggle on={o.posts} set={(v) => set({ posts: v })} title="Learn from her LoRA's posts" sub="Copies how people word that costume on Krea 2, and what they pair the LoRA with." />
        <LoraList value={o.loras ?? []} onChange={(v) => set({ loras: v })} family="krea2" label="On every picture"
          locks={o.lockedAll ?? {}} onLock={(n, on) => { const m = { ...(o.lockedAll ?? {}) }; if (on) m[n] = true; else delete m[n]; set({ lockedAll: m }); }} />
      </Section>

      <Section id="shots" title="Shots & poses" summary={`${o.takes} per character · ${o.poses === "posewear" ? `${nPoses} picked poses` : o.poses === "mix" ? "poses in words" : "PoseWear auto"}`}>
        <label className="flex items-center justify-between gap-2 text-[13px]">Pictures per character
          <DropSelect value={o.takes} onChange={(e) => set({ takes: Number(e.target.value) })} className="inset h-8 border px-2 text-[13px]">{[1, 2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}</DropSelect></label>
        <p className="-mt-2 text-[11.5px] leading-snug text-dim">The first is a close-up; every one gets its own angle, pose and place.</p>
        <Seg wrap value={o.poses ?? "library"} onChange={(v) => set({ poses: v })} options={[{ value: "library", label: "PoseWear · auto" }, { value: "posewear", label: `My picks${nPoses ? ` · ${nPoses}` : ""}` }, { value: "mix", label: "Words only" }]} />
        <p className="-mt-1.5 text-[11.5px] leading-snug text-dim">{(o.poses ?? "library") === "library" ? "DeepSeek picks poses from the PoseWear depth library that suit each character — no pose used twice in a batch (your ★ first, your hidden ones never). Krea 2 copies each one's body position." : o.poses === "posewear" ? (nPoses ? "Each picture takes the next of your picks; Krea 2 copies its body position from its depth." : "No poses picked yet.") : "The writer describes the poses in words (nothing copied)."}</p>
        <button onClick={() => import("./PoseWear").then(({ openPoseWear }) => openPoseWear("many", "depths"))} className="press btn-raised flex h-9 items-center justify-center gap-1.5 text-[13px]"><Icon name="user" size={14} className="text-muted" />Browse poses</button>
      </Section>

      <Section id="taste" title="Learned taste"><Learned /></Section>

      <p className="border-t border-line pt-3 text-[11.5px] leading-relaxed text-dim">Characters who are under 18, or drawn that way, are skipped. On your site the character is the cosplayer — keep the series character's name out of titles.</p>
    </div>
  );
}

// ------------------------------------------------------------------ the list
export function CosplayList() {
  const items = useCosplay((s) => s.items);
  const o = useCosplay((s) => s.opts);
  const toast = useJobs((s) => s.toast);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [pasting, setPasting] = useState(false);
  const collapsed = !!o.collapsed;
  const setCollapsed = (v: boolean) => useCosplay.getState().set({ opts: { ...useCosplay.getState().opts, collapsed: v } });
  const cosplayer = () => {
    if (o.cosplayer !== "one") return "";
    const c = useCharacters.getState().list.find((x) => x.id === o.charId);
    if (!c) throw new Error("Pick the character who wears the costumes (Who wears it, on the left)");
    return looks(c);
  };
  const research = async (only?: string) => {
    try { setBusy("research"); await researchAll(cosplayer(), only); } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  const add = async () => {
    try { setBusy("add"); const n = await toBatch((m) => setBusy(m)); toast(n ? `Added ${n} cosplay picture${n > 1 ? "s" : ""} to the batch — check them below, then Queue` : "No character is ready yet — Research first", n ? "good" : "info"); if (n) setCollapsed(true); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  const addText = () => { const n = addList(text); setText(""); setPasting(false); toast(n ? `Added ${n} character${n > 1 ? "s" : ""}` : "Nothing new in that list", "info"); };
  const ready = items.filter((i) => i.status === "ready");
  const skipped = items.filter((i) => i.status === "skipped");
  const errors = items.filter((i) => i.status === "error");
  const working = items.filter((i) => i.status === "looking");
  const workers = useCosplay((s) => s.workers ?? 0);
  const todo = items.filter((i) => i.status === "new" || i.status === "error");
  const waitingLora = ready.filter((i) => picksOf(i) === undefined && i.loras?.length);
  const pics = ready.reduce((n, i) => n + (i.shots?.length || 1), 0);
  const pct = items.length ? Math.round(((ready.length + skipped.length) / items.length) * 100) : 0;
  const addBtn = (big: boolean) => (
    <button onClick={add} disabled={!!busy || !ready.length} className={cx("press btn-primary flex items-center gap-2 font-semibold uppercase tracking-wide text-accentink disabled:opacity-40", big ? "h-10 px-4 text-[13px]" : "h-9 px-3 text-[12.5px]")}>
      <Icon name="plus" size={14} />{busy && busy !== "research" ? busy : `Add ${pics || ""} picture${pics === 1 ? "" : "s"} to batch`}</button>);

  return (
    <div className="card flex flex-col border border-line">
      {/* header: title, counts, progress */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3.5">
        <button onClick={() => setCollapsed(!collapsed)} className="press flex items-center gap-1.5" title={collapsed ? "Show the list" : "Fold the list away"}>
          <Icon name="chev" size={14} className={cx("text-muted transition-transform", collapsed && "-rotate-90")} />
          <span className="display text-[17px]">Cosplay</span></button>
        {items.length > 0 && <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone="good">{ready.length} ready</Chip>
          {working.length > 0 && <Chip tone="accent" title="Writers working side by side. It starts at 6 and adds one each time a character comes back quickly, up to 16; it halves when DeepSeek or CivitAI push back. DeepSeek bills per word, so more at once costs the same — it just finishes sooner.">{working.length} researching{workers ? ` · ${workers} writers` : ""}</Chip>}
          {todo.length - errors.length > 0 && <Chip>{todo.length - errors.length} to research</Chip>}
          {errors.length > 0 && <Chip tone="bad">{errors.length} failed</Chip>}
          {skipped.length > 0 && <Chip title={skipped.map((s) => `${s.name}: ${s.why ?? ""}`).join("\n")}>{skipped.length} skipped</Chip>}
        </div>}
        <div className="ml-auto flex items-center gap-2">
          {items.length > 0 && !collapsed && <button onClick={() => useCosplay.getState().set({ items: [] })} className="text-[12px] text-dim hover:text-bad">Clear list</button>}
          {collapsed && addBtn(false)}
        </div>
      </div>
      {items.length > 0 && <div className="mx-4 mt-3 h-1 overflow-hidden bg-raised2"><div className={cx("h-full bg-accent transition-all", working.length > 0 && "stripes")} style={{ width: `${pct}%` }} /></div>}

      {collapsed ? (
        <div className="flex flex-wrap gap-1.5 p-4">
          {items.map((it) => <Face key={it.key} it={it} size="s" />)}
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-4">
          {/* the list goes in here */}
          {(!items.length || pasting) ? (
            <div className="flex flex-col gap-2">
              <textarea autoFocus={pasting} value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={"Paste characters, one per line, with the series:\nReze\tChainsaw Man\nYoruichi Shihōin — Bleach\n2B (NieR: Automata)"}
                className="inset w-full resize-y border px-3 py-2 font-mono text-[12.5px] focus:border-accent focus:outline-none" />
              <div className="flex gap-2"><Btn onClick={addText} disabled={!text.trim()}><Icon name="plus" size={14} /> Add to list</Btn>{items.length > 0 && <Btn onClick={() => { setPasting(false); setText(""); }}>Cancel</Btn>}</div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Btn onClick={() => setPasting(true)}><Icon name="plus" size={14} /> Add characters</Btn>
              <Btn onClick={() => research()} disabled={!!busy || !todo.length}><Icon name="script" size={14} /> {busy === "research" ? "Researching…" : `Research${todo.length ? ` ${todo.length}` : ""}`}</Btn>
              {ready.length > 0 && <Btn onClick={async () => { for (const it of ready) useCosplay.getState().update(it.key, { status: "new" }); await research(); }} disabled={!!busy} title="Write every ready character again (new shots, your LoRA picks, what you locked stays)"><Icon name="refresh" size={14} /> Rewrite all</Btn>}
              <span className="ml-auto">{addBtn(true)}</span>
            </div>
          )}
          {waitingLora.length > 0 && <p className="flex items-center gap-2 border border-hot/40 bg-hot/5 px-3 py-2 text-[12.5px] text-hot"><Icon name="sparkle" size={13} />{waitingLora.length} character{waitingLora.length > 1 ? "s have" : " has"} CivitAI LoRAs to look at — open them and pick in the LoRAs tab.</p>}
          {items.length > 0 && <div className="flex flex-col divide-y divide-line border border-line">
            {items.map((it) => <CosRow key={it.key} it={it} busy={!!busy} onRedo={() => research(it.key)} />)}
          </div>}
        </div>
      )}
    </div>
  );
}

/** her official picture (or her initials), with a status ring */
function Face({ it, size }: { it: CosItem; size: "s" | "m" }) {
  const ring = it.status === "ready" ? "border-good/70" : it.status === "error" ? "border-bad/70" : it.status === "looking" ? "border-accent" : "border-line";
  return (
    <span title={`${it.name}${it.series ? ` · ${it.series}` : ""} — ${it.status}`} className={cx("relative shrink-0 overflow-hidden rounded-[3px] border-2 bg-raised2", ring, size === "s" ? "h-11 w-9" : "h-14 w-11", it.status === "skipped" && "opacity-40 grayscale")}>
      {it.picture ? <img src={viewUrl({ filename: it.picture, subfolder: "", type: "input" })} alt={it.name} className="h-full w-full object-cover" />
        : <span className="flex h-full items-center justify-center text-[11px] font-semibold text-dim">{it.name.slice(0, 2).toUpperCase()}</span>}
      {it.status === "looking" && <span className="shimmer absolute inset-0" />}
    </span>
  );
}

type RowTab = "pictures" | "loras" | "look";
function CosRow({ it, busy, onRedo }: { it: CosItem; busy: boolean; onRedo: () => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<RowTab>("pictures");
  const director = useCosplay((s) => s.opts.director);
  const picks = picksOf(it);
  const shots = it.shots?.length ? it.shots : it.prompt ? [{ brief: "", pose: it.pose ?? "", prompt: it.prompt }] : [];
  const nLoras = (picks?.length ?? 0) + (it.extra?.length ?? 0) + (director ? it.ai?.length ?? 0 : 0);
  const status = it.status === "ready" ? <Chip tone="good">ready</Chip> : it.status === "skipped" ? <Chip title={it.why}>skipped</Chip> : it.status === "looking" ? <Chip tone="accent">researching…</Chip> : it.status === "error" ? <Chip tone="bad" title={it.why}>failed</Chip> : <Chip>to research</Chip>;
  const canOpen = it.status !== "skipped";
  return (
    <div className={cx("bg-panel transition-colors", open && "bg-raised/30")}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Face it={it} size="m" />
        <button onClick={() => canOpen && setOpen(!open)} className="min-w-0 flex-1 text-left" disabled={!canOpen}>
          <div className="flex items-baseline gap-1.5 truncate"><span className="text-[14px] font-semibold">{it.name}</span>{it.series && <span className="truncate text-[12.5px] text-muted">{it.series}</span>}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {status}
            {it.status === "ready" && <Chip>{shots.length} picture{shots.length === 1 ? "" : "s"}</Chip>}
            {nLoras > 0 && <Chip tone="accent">{nLoras} LoRA{nLoras === 1 ? "" : "s"}</Chip>}
            {picks === undefined && !!it.loras?.length && <Chip tone="hot">{it.loras.length} to look at</Chip>}
            {it.build && director && <Chip title={it.build}>{it.build.split(/[—–-]/)[0].trim().slice(0, 28)}</Chip>}
            {(it.status === "skipped" || it.status === "error") && it.why && <span className="truncate text-[11.5px] text-dim">{it.why}</span>}
          </div>
        </button>
        {(it.status === "ready" || it.status === "error") && <button disabled={busy} onClick={onRedo} title="Research and write again (what you locked stays)" className="press flex h-8 w-8 items-center justify-center text-dim hover:text-ink"><Icon name="refresh" size={14} /></button>}
        {canOpen && <button onClick={() => setOpen(!open)} aria-label={open ? "Close" : "Open"} className="press flex h-8 w-8 items-center justify-center text-dim hover:text-ink"><Icon name="chev" size={14} className={cx("transition-transform", !open && "-rotate-90")} /></button>}
        <button onClick={() => useCosplay.getState().set({ items: useCosplay.getState().items.filter((x) => x.key !== it.key) })} title="Take off the list" className="press flex h-8 w-8 items-center justify-center text-dim hover:text-bad"><Icon name="x" size={13} /></button>
      </div>
      {open && canOpen && (
        <div className="flex flex-col gap-3 px-3 pb-3 pl-[68px] text-[12.5px]">
          <div className="flex gap-0.5 border-b border-line">
            {([["pictures", `Pictures${shots.length ? ` · ${shots.length}` : ""}`], ["loras", `LoRAs${nLoras ? ` · ${nLoras}` : ""}`], ["look", "Look & checkpoint"]] as [RowTab, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={cx("press -mb-px border-b-2 px-3 py-1.5 text-[12.5px]", tab === k ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>{l}</button>))}
          </div>
          {tab === "pictures" && <Pictures it={it} shots={shots} />}
          {tab === "loras" && <Loras it={it} />}
          {tab === "look" && <Look it={it} />}
        </div>)}
    </div>
  );
}

function Pictures({ it, shots }: { it: CosItem; shots: { brief: string; pose: string; prompt: string; ref?: { thumb: string; title: string } }[] }) {
  if (!shots.length) return <p className="text-dim">{it.status === "new" ? "Press Research to write her pictures." : "No prompts yet."}</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {shots.map((sh, i) => (
        <div key={i} className="flex gap-2.5">
          {sh.ref ? <img src={sh.ref.thumb} alt="" title={sh.ref.title} referrerPolicy="no-referrer" className="h-20 w-14 shrink-0 border border-line object-cover" />
            : <span className="flex h-20 w-14 shrink-0 items-center justify-center border border-line font-mono text-[18px] text-dim">{i + 1}</span>}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {sh.brief && <div className="flex flex-wrap gap-1">{sh.brief.split(" · ").map((b) => { const [k, ...v] = b.split(": "); return <Chip key={b} title={b}><b className="font-medium text-ink">{k.replace(/ \(copy exactly\)/, "").toLowerCase()}</b>{v.join(": ").slice(0, 38)}</Chip>; })}</div>}
            <textarea value={sh.prompt} onChange={(e) => { const all = [...(it.shots ?? [{ brief: "", pose: it.pose ?? "", prompt: it.prompt ?? "" }])]; all[i] = { ...all[i], prompt: e.target.value }; useCosplay.getState().update(it.key, { shots: all, prompt: all[0].prompt }); }}
              rows={3} className="inset w-full resize-y border px-2.5 py-1.5 text-[12px] leading-relaxed focus:border-accent focus:outline-none" />
          </div>
        </div>))}
    </div>
  );
}

function Loras({ it }: { it: CosItem }) {
  const [finding, setFinding] = useState(false);
  const toast = useJobs((s) => s.toast);
  const director = useCosplay((s) => s.opts.director);
  const picks = picksOf(it);
  const up = (p: Partial<CosItem>) => useCosplay.getState().update(it.key, p);
  const lock = (n: string, on: boolean) => { const m = { ...(it.aiLocked ?? {}) }; if (on) m[n] = true; else delete m[n]; up({ aiLocked: m }); };
  const findMore = async () => { setFinding(true); try { const loras = await findLoras(it); up({ loras }); if (!loras.length) toast(`No Krea 2 LoRA names ${it.name} on CivitAI — add one of yours below`, "info"); } finally { setFinding(false); } };
  const cands = [...(it.loras ?? []), ...(picks ?? []).filter((p) => !(it.loras ?? []).some((l) => l.version_id === p.version_id))];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2"><span className="lbl">Her CivitAI LoRA</span><span className="text-[11.5px] text-dim">pick any</span>
          <button onClick={() => approve(it.key, null)} className={cx("press rounded-full border px-2 text-[11px]", picks && !picks.length ? "border-accent/60 text-accent" : "border-line text-muted hover:text-ink")}>None</button>
          <button onClick={findMore} disabled={finding} className="press ml-auto text-[12px] text-dim hover:text-ink">{finding ? "Searching…" : "Search again"}</button></div>
        {cands.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {cands.map((l) => <LoraCard key={l.version_id} l={l} on={!!picks?.some((p) => p.version_id === l.version_id)} pick={() => approve(it.key, l)} />)}
        </div> : <p className="text-dim">{it.status === "new" ? "Research finds them." : "None found by name — add one of yours below."}</p>}
      </div>
      <LoraList value={it.extra ?? []} onChange={(v) => up({ extra: v })} family="krea2" label="Your LoRAs for her" locks={it.aiLocked ?? {}} onLock={lock} />
      {director && <LoraList value={it.ai ?? []} onChange={(v) => up({ ai: v })} family="krea2" label="Picked by DeepSeek" locks={it.aiLocked ?? {}} onLock={lock}
        notes={Object.fromEntries((it.ai ?? []).map((l) => [l.name, it.aiLocked?.[l.name] ? "Locked by you — kept at this strength on every rewrite" : it.aiWhy?.[l.name] ? `Why: ${it.aiWhy[l.name]}` : ""]).filter(([, v]) => v))} />}
      {it.status === "ready" && <p className="text-[11.5px] text-dim">Changed her LoRAs? Redo (↻) so the prompts use their wording — trigger words are put in front either way.</p>}
    </div>
  );
}

function Look({ it }: { it: CosItem }) {
  const up = (p: Partial<CosItem>) => useCosplay.getState().update(it.key, p);
  const director = useCosplay((s) => s.opts.director);
  const row = (k: string, v?: string) => v && v !== "none" ? <div className="flex gap-2"><span className="w-16 shrink-0 text-dim">{k}</span><span className="text-ink">{v}</span></div> : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">{row("Costume", it.outfit)}{row("Wig", it.wig)}{row("Eyes", it.eyes)}{row("Props", it.props)}{row("Build", it.build)}{row("Age", it.age)}</div>
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <CheckpointPicker model="krea2" models={["krea2"]} value={it.aiCheckpoint?.name === "official" ? "" : it.aiCheckpoint?.name ?? ""}
          onChange={(v) => up({ aiCheckpoint: { name: v || "official", why: v === it.aiCheckpoint?.name ? it.aiCheckpoint.why : "your pick" }, ckLocked: true })} />
        <div className="flex items-center gap-2 text-[11.5px]">
          <button onClick={() => up({ ckLocked: !it.ckLocked })} aria-pressed={!!it.ckLocked}
            className={cx("press flex h-6 items-center gap-1 rounded-sm border px-1.5", it.ckLocked ? "border-accent/60 bg-accent/15 text-accent" : "border-line text-dim hover:text-ink")}>
            <Icon name={it.ckLocked ? "lock" : "unlock"} size={11} />{it.ckLocked ? "Locked" : "Auto"}</button>
          <span className="truncate text-dim" title={it.aiCheckpoint?.why}>{it.ckLocked ? "Your pick for her — wins over the batch's Checkpoint" : it.aiCheckpoint?.why ? `Why: ${it.aiCheckpoint.why}` : "The batch's Checkpoint unless you pick one here"}</span>
        </div>
      </div>
    </div>
  );
}

function LoraCard({ l, on, pick }: { l: Candidate; on: boolean; pick: () => void }) {
  const img = l.images.find((i) => !i.video) ?? l.images[0];
  return (
    <button onClick={pick} title={`${l.name}${l.trigger ? `\ntrigger: ${l.trigger}` : ""}`} className={cx("press group relative flex flex-col overflow-hidden border text-left", on ? "border-accent" : "border-line hover:border-muted")}>
      <span className="relative block aspect-[4/5] overflow-hidden bg-hover">
        {img && <img src={img.url} alt="" className={cx("h-full w-full object-cover transition-transform group-hover:scale-[1.03]", img.explicit && "blur-md")} />}
        {on && <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accentink"><Icon name="check" size={14} /></span>}
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-6">
          <span className="block truncate text-[12px] font-semibold text-white">{l.name}</span>
          <span className="block text-[10.5px] text-white/70">{l.collected.toLocaleString()} collected · {l.downloads.toLocaleString()} ↓</span>
        </span>
      </span>
    </button>
  );
}
