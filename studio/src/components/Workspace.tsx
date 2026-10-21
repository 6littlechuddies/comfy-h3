import { useEffect, useRef, useState, type ReactNode } from "react";
import { PosePicker } from "./PosePicker";
import { PromptHistoryButton } from "./PromptHistory";
import { MentionButton, useMention, type MentionTarget } from "./Mention";
import { useJobs, type Tab } from "../lib/jobs";
import { useSettings } from "../lib/settings";
import { DropList, Icon, cx } from "./ui";
import { setLater, useDownloads, useGroup, type GroupId } from "../lib/downloads";
import { useRewriteMenu } from "./PromptPieces";
import { useDictation } from "../lib/voice";

/** the shared layout: slide-out settings on the left, prompt bar on top, results below */
export function Workspace({ tab, title, sub, drawer, bar, children, drawerWidth = 360, needs }: {
  tab: Tab; title: string; sub?: string; drawer: ReactNode; bar?: ReactNode; children: ReactNode; drawerWidth?: number;
  /** the model group this tab needs — shows a notice while it's still downloading */
  needs?: GroupId | null;
}) {
  const open = useSettings((s) => s.s.drawers[tab] ?? true);
  const setDrawer = useSettings((s) => s.setDrawer);
  const active = useSettings((s) => s.s.tab === tab);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "\\" && (e.ctrlKey || e.metaKey) && useSettings.getState().s.tab === tab) { e.preventDefault(); setDrawer(tab, !(useSettings.getState().s.drawers[tab] ?? true)); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [tab, setDrawer]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside className="drawer relative flex shrink-0 flex-col overflow-hidden border-r border-line2 bg-panel" style={{ width: open ? drawerWidth : 52 }}>
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line2 px-3">
          <button onClick={() => setDrawer(tab, !open)} aria-expanded={open} aria-label={open ? "Hide settings" : "Show settings"} title={`${open ? "Hide" : "Show"} settings (Ctrl+\\)`}
            className="press btn-raised flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:text-ink">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 6h10M4 12h16M4 18h7" /><circle cx="17" cy="6" r="2" /><circle cx="14" cy="18" r="2" /></svg>
          </button>
          {open && <div className="fade-in min-w-0"><div key={String(active)} className="display glitch-once truncate text-[17px] leading-tight" data-text={title}>{title}</div>{sub && <div className="micro mt-0.5 truncate text-dim">{sub}</div>}</div>}
        </div>
        <div className={cx("min-h-0 flex-1 overflow-y-auto", !open && "invisible")} style={{ width: drawerWidth }}>
          <div className="flex flex-col gap-4 p-4 pb-24">{drawer}</div>
        </div>
      </aside>
      <section className="grid-bg flex min-h-0 min-w-0 flex-1 flex-col">
        {bar && <div className="relative z-10 shrink-0 px-6 pb-3 pt-5">{bar}<ModelsNotice id={needs} /></div>}
        {!bar && needs && <div className="shrink-0 px-6 pt-4"><ModelsNotice id={needs} /></div>}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      </section>
    </div>
  );
}

/** "Video models are still downloading — 62%, about 4 min" */
export function ModelsNotice({ id }: { id?: GroupId | null }) {
  const st = useGroup(id);
  const gpu = useDownloads((x) => x.gpu);
  const small = gpu?.images_only ? gpu : null;
  if (st.ready) return null;
  const g = st.group!;
  const failed = g.state === "error";
  const later = g.state === "later" || g.state === "skipped";
  return (
    <div className={cx("mt-2.5 flex items-center gap-3 border px-3.5 py-2.5 text-[13px]", failed ? "border-bad/60 bg-bad/10" : "border-accent/40 bg-accent/[.06]")} role="status">
      <span className="micro shrink-0 text-dim">{failed ? "ERROR" : later ? "LATER" : g.state === "downloading" ? `${String(g.pct).padStart(2, "0")}%` : "QUEUED"}</span>
      <div className="min-w-0 flex-1">
        <div className="text-ink">{st.why}.</div>
        {later && small && (id === "video" || id === "writer_xl") && <div className="text-[12px] text-ink/85">Images-only mode: this card ({small.name ?? "GPU"}, {Math.round((small.vram_mb ?? 0) / 1024)} GB) is too small for {id === "video" ? "H3 video" : "the 27B writer"} next to the picture models, so it isn't downloaded. Pictures, Edit, sheets and the small writer all work. Rent a 32 GB card (5090) for video days.</div>}
        <div className="text-[12px] text-muted">{failed ? "Try again, or destroy this rental and start a new one if it keeps failing — everything else still works." : later ? `Download them now (${(g.total_mb / 1024).toFixed(0)} GB) — the button unlocks by itself when they're in.` : "Set everything up now — the button unlocks by itself when they're in."}</div>
      </div>
      {failed || later || g.state === "waiting" ? <DownloadNow id={g.id} label={failed ? "Try again" : later ? "Download now" : "Download next"} retry={failed} />
        : <div className="h-1.5 w-40 shrink-0 bg-raised2"><div className="stripes h-full transition-[width] duration-700" style={{ width: `${Math.max(2, g.pct)}%` }} /></div>}
    </div>
  );
}

function DownloadNow({ id, label, retry }: { id: GroupId; label: string; retry?: boolean }) {
  const [busy, setBusy] = useState(false);
  const toast = useJobs((s) => s.toast);
  return (
    <button disabled={busy} onClick={async () => { setBusy(true); try { await setLater(id, retry ? false : "next"); toast("Downloading — it unlocks by itself when it's in.", "good"); } catch (e) { toast((e as Error).message, "bad"); } finally { setTimeout(() => setBusy(false), 4000); } }}
      className="press chamfer-sm btn-primary h-8 shrink-0 px-3 text-[12.5px] font-bold disabled:opacity-50">{busy ? "Starting…" : label}</button>
  );
}

/** the big input at the top of a tab, with chips for the main choices and the go button */
export function PromptBar({ value, onChange, placeholder, chips, action, minRows = 1, maxRows = 8, mono, rewrite, below, lead, mention, pose }: {
  value: string; onChange: (v: string) => void; placeholder: string; chips?: ReactNode; action: ReactNode; minRows?: number; maxRows?: number; mono?: boolean;
  /** right-click highlighted text → "Change this part…" (jobs show in this tab) */
  rewrite?: Tab;
  below?: ReactNode;
  /** small pictures shown at the left of the text (the reference / the picture being remixed) */
  lead?: ReactNode;
  /** type @ to add a character or picture (what that does is up to the tab) */
  mention?: MentionTarget;
  /** a "Pose" button: picks one pose (limb by limb) and puts its words in the box — as a description, or an Edit instruction */
  pose?: "describe" | "instruct";
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const at = useMention(value, onChange, ta, mention);
  const [big, setBig] = useState(false); // ⤢ a tall box for long prompts
  const txt = useRef<HTMLInputElement>(null);
  const rw = useRewriteMenu(rewrite, value, onChange);
  const toastT = useJobs((s) => s.toast);
  const [overTxt, setOverTxt] = useState(false);
  const mic = useDictation((t) => onChange(value.trim() ? `${value.trim()} ${t}` : t), (m) => toastT(m, "bad"));
  /** a .txt / .md file replaces what's in the box */
  const loadText = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(txt|md|text|prompt)$/i.test(f.name) && !f.type.startsWith("text/")) { toastT("Text files only (.txt or .md)", "bad"); return; }
    const t = (await f.text()).replace(/\r\n/g, "\n").trim();
    if (!t) { toastT(`${f.name} is empty`, "bad"); return; }
    onChange(t); toastT(`Loaded ${f.name} (${t.length.toLocaleString()} characters)`, "good");
  };
  const isText = (e: React.DragEvent) => Array.from(e.dataTransfer.items ?? []).some((i) => i.kind === "file" && (i.type.startsWith("text/") || i.type === ""));
  useEffect(() => {
    const el = ta.current; if (!el) return;
    el.style.height = "auto";
    const line = 24;
    el.style.height = big ? `${Math.max(minRows * line + 20, Math.round(window.innerHeight * 0.55))}px` : `${Math.min(maxRows * line + 20, Math.max(minRows * line + 20, el.scrollHeight))}px`;
  }, [value, minRows, maxRows, big]);
  return (
    <div className={cx("glow ticks card relative flex flex-col border transition-shadow", overTxt ? "border-accent" : "border-line")}
      onDragOver={(e) => { if (isText(e)) { e.preventDefault(); e.stopPropagation(); setOverTxt(true); } }} onDragLeave={() => setOverTxt(false)}
      onDrop={(e) => { const f = e.dataTransfer.files?.[0]; if (f && /\.(txt|md|text|prompt)$/i.test(f.name)) { e.preventDefault(); e.stopPropagation(); setOverTxt(false); loadText(f); } else setOverTxt(false); }}>
      <div className="flex min-w-0">
        {lead && <div className="flex shrink-0 gap-1.5 pl-4 pt-4">{lead}</div>}
        <textarea ref={ta} value={value} onChange={(e) => { onChange(e.target.value); requestAnimationFrame(at.sync); }} onKeyDown={at.onKeyDown} onKeyUp={(e) => { if (e.key.startsWith("Arrow") && !at.menu) at.sync(); }} onClick={at.sync} onBlur={at.close} onContextMenu={rw.onContextMenu} placeholder={placeholder} rows={minRows} aria-label={placeholder}
          className={cx("w-full min-w-0 resize-none bg-transparent px-5 pb-1 pt-4 text-[15px] leading-6 text-ink placeholder:text-dim focus:outline-none", !!lead && "pl-3", mono && "font-mono text-[13.5px]")} />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{chips}</div>
        <button type="button" onClick={() => setBig((v) => !v)} aria-pressed={big} title={big ? "Smaller box" : "Bigger box — for long prompts"}
          className={cx("press inline-flex h-8 items-center rounded-sm px-2 text-[12px]", big ? "text-accent" : "text-muted hover:text-ink")}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>{big ? <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /> : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />}</svg></button>
        {rewrite && <PromptHistoryButton tab={rewrite} value={value} onChange={onChange} />}
        {rewrite && value.trim() && <button type="button" onClick={rw.openWhole} title="Say what to change in this prompt — only that changes, the rest stays word for word (or highlight a part and right-click it)"
          className="press inline-flex h-8 items-center gap-1 rounded-sm px-2 text-[12px] text-muted hover:text-ink"><Icon name="brush" size={13} />Change it</button>}
        {pose && <PosePicker value={value} onChange={onChange} mode={pose} />}
        {at.enabled && <MentionButton onClick={at.start} />}
        <button type="button" onClick={() => txt.current?.click()} title="Load a .txt file into this box (replaces what's there) — or drag the file onto the box"
          className="press inline-flex h-8 items-center gap-1 rounded-sm px-2 text-[12px] text-muted hover:text-ink"><Icon name="script" size={13} />.txt</button>
        <button type="button" onClick={mic.toggle} disabled={mic.state === "working"} title={mic.state === "recording" ? "Stop — your words go into the box" : "Talk instead of typing (turned into text on your rental)"}
          className={cx("press inline-flex h-8 items-center gap-1 rounded-sm px-2 text-[12px]", mic.state === "recording" ? "text-bad pulse" : "text-muted hover:text-ink")}><Icon name="mic" size={13} />{mic.state === "recording" ? "Stop" : mic.state === "working" ? "…" : ""}</button>
        <input ref={txt} type="file" accept=".txt,.md,text/plain,text/markdown" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; loadText(f); }} />
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      </div>
      {below}
      {rw.menu}
      {at.menu}
    </div>
  );
}

/** a small pill menu in the prompt bar (model, shape, count…) — our own dark list, not the browser's white popup */
export function Chip<T extends string | number>({ value, options, onChange, icon, title }: {
  /** hint: one line under the option; group: a heading above the first option of each group (like HeliosGen's model menu) */
  value: T; options: { value: T; label: string; hint?: string; group?: string }[]; onChange: (v: T) => void; icon?: string; title?: string;
}) {
  const cur = options.find((o) => o.value === value) ?? options[0];
  return (
    <DropList value={value} options={options} onChange={onChange} title={title}
      button={(open) => (
        <span className={cx("press chip-raised inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-sm pl-3 pr-2.5 text-[12.5px] font-medium text-ink", open && "ring-1 ring-accent")}>
          {icon && <Icon name={icon} size={13} className="text-muted" />}
          <span>{cur?.label}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
        </span>
      )} />
  );
}

/** the primary button in the prompt bar */
export function GoButton({ onClick, disabled, why, children }: { onClick: () => void; disabled?: boolean; why?: string; children: ReactNode }) {
  return (
    <span className="group relative" title={disabled ? why : "Ctrl+Enter"}>
      <button onClick={onClick} disabled={disabled}
        className="press btn-primary chamfer flex h-11 items-center gap-2 px-6 text-[14px] uppercase tracking-wide disabled:text-dim" style={{ fontVariationSettings: '"wdth" 112' }}>
        {children}
      </button>
      {disabled && why && <span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 hidden w-max max-w-64 rounded-md border border-line bg-raised2 px-2.5 py-1.5 text-xs text-ink shadow-lg group-hover:block">{why}</span>}
    </span>
  );
}
