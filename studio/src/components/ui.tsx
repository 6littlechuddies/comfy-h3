import { BUDGET, balanceLoras, roleOf, stackTotal, type BudgetKey } from "../lib/loraBalance";
import { Children, Fragment, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { openPictureMenu } from "./PictureMenu";
import { bumpModels } from "./Checkpoint";
import { type LoraTips, addLoraFromLink, loadState, saveState, uploadLoraWithToast, forgetObjectInfo, listSamplers, listSchedulers, loraJob, loraLibrary, type LoraInfo, type LoraJob } from "../lib/api";
import type { LoraPick } from "../lib/graphs";
import { timeLeft, useJobs, type Job } from "../lib/jobs";
import { newSeed, useSettings, type Adv } from "../lib/settings";
import { DRAG_TYPE, droppedUrl, useTray, type Media } from "../lib/tray";
import { HELP } from "../lib/help";
import { askConfirm, askText } from "./Dialogs";
import { openLoraBrowser } from "./LoraBrowser";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ------------------------------------------------------------------ icons (stroke)
const P: Record<string, string> = {
  logo: "M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z M8 16V8 M16 16V8 M8 12h8",
  x: "M6 6l12 12 M18 6L6 18",
  up: "M12 16V4 M7 9l5-5 5 5 M5 20h14",
  down: "M12 4v11 M7 10l5 5 5-5 M5 20h14",
  play: "M8 5v14l11-7z",
  mic: "M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z M5 11a7 7 0 0 0 14 0 M12 18v4",
  plus: "M12 5v14 M5 12h14",
  dice: "M4 4h16v16H4z M9 9h.01 M15 15h.01 M15 9h.01 M9 15h.01",
  lock: "M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4",
  unlock: "M5 11h14v10H5z M8 11V7a4 4 0 0 1 7.5-2",
  grip: "M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01",
  stop: "M6 6h12v12H6z",
  check: "M5 12l5 5L20 7",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0",
  film: "M4 4h16v16H4z M8 4v16 M16 4v16 M4 9h4 M4 15h4 M16 9h4 M16 15h4",
  wave: "M3 12h2 M7 8v8 M11 5v14 M15 9v6 M19 11v2",
  image: "M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15 9h.01",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  back: "M19 12H5 M11 18l-6-6 6-6",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
  search: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M20 20l-4-4",
  user: "M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  layers: "M12 3l9 5-9 5-9-5z M3 13l9 5 9-5",
  brush: "M18 3l3 3-9 9-3-3z M9 12c-3 0-5 2-5 5 0 1.5-1 2.5-2 3 4 1 8-.5 9-4",
  script: "M6 3h9l4 4v14H6z M9 9h7 M9 13h7 M9 17h4",
  scissors: "M6 6a2.5 2.5 0 1 0 0 .01 M6 18a2.5 2.5 0 1 0 0 .01 M8 7.5L20 18 M8 16.5L20 6",
  keyboard: "M3 6h18v12H3z M7 10h.01 M11 10h.01 M15 10h.01 M7 14h10",
  folder: "M3 6h6l2 2h10v11H3z",
  chev: "M6 9l6 6 6-6",
  sweep: "M4 20V14 M9 20V10 M14 20V6 M19 20V3",
  dots: "M5 12h.01 M12 12h.01 M19 12h.01",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  chat: "M4 5h16v11H10l-5 4v-4H4z",
  rail: "M4 4h16v16H4z M9 4v16",
  link: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1 M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1",
};
export function Icon({ name, size = 16, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {(P[name] ?? "").split(" M").map((d, i) => <path key={i} d={(i ? "M" : "") + d} />)}
    </svg>
  );
}

// ------------------------------------------------------------------ basics
export function Btn({ children, onClick, kind = "ghost", disabled, why, className, title, type = "button", small }: {
  children: ReactNode; onClick?: () => void; kind?: "primary" | "ghost" | "danger"; disabled?: boolean; why?: string;
  className?: string; title?: string; type?: "button" | "submit"; small?: boolean;
}) {
  const base = small ? "h-8 px-2.5 text-[13px] rounded-lg" : kind === "primary" ? "h-12 px-5 text-[15px] rounded-[10px]" : "h-9 px-3 text-[13px] rounded-lg";
  const look = kind === "primary"
    ? "btn-primary text-accentink font-semibold disabled:text-dim"
    : kind === "danger" ? "btn-raised text-bad"
    : "btn-raised text-ink font-medium disabled:text-dim";
  return (
    <span className={cx("relative group inline-flex", className?.includes("w-full") && "w-full", className?.includes("flex-1") && "flex-1")} title={disabled ? why : title}>
      <button type={type} onClick={onClick} disabled={disabled} className={cx("press inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed", base, look, className)}>
        {children}
      </button>
      {disabled && why && (
        <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-max max-w-64 -translate-x-1/2 rounded-md border border-line bg-raised2 px-2.5 py-1.5 text-xs text-ink shadow-lg group-hover:block">{why}</span>
      )}
    </span>
  );
}

export function Help({ k, text }: { k?: string; text?: string }) {
  const t = text ?? (k ? HELP[k] : "");
  const [open, setOpen] = useState(false);
  if (!t) return null;
  return (
    <span className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="What is this?" onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen((o) => !o)}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-sm border border-line text-[10px] font-semibold normal-case tracking-normal text-muted hover:text-ink">?</button>
      {open && <span role="tooltip" className="absolute left-1/2 top-full z-40 mt-1.5 w-64 -translate-x-1/2 rounded-md border border-line bg-raised2 p-2.5 text-xs font-normal normal-case leading-relaxed tracking-normal text-ink shadow-xl">{t}</span>}
    </span>
  );
}

export function Label({ children, help, htmlFor, right }: { children: ReactNode; help?: string; htmlFor?: string; right?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <label htmlFor={htmlFor} className="lbl flex items-center">{children}{help && <Help k={help} />}</label>
      {right}
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, label, help, className }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label?: string; help?: string; className?: string;
}) {
  return (
    <div className={className}>
      {label && <Label help={help}>{label}</Label>}
      <div role="radiogroup" aria-label={label} className="seg-track flex gap-[3px] rounded-lg border border-line2 p-[3px]">
        {options.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title} onClick={() => onChange(o.value)}
            className={cx("press h-[34px] min-w-0 flex-auto truncate rounded-md px-2 text-[13px] font-medium", o.value === value ? "seg-on text-white" : "text-muted hover:text-ink")}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TextIn({ label, help, value, onChange, placeholder, className, mono }: {
  label?: string; help?: string; value: string | number; onChange: (v: string) => void; placeholder?: string; className?: string; mono?: boolean;
}) {
  const id = useId();
  return (
    <div className={className}>
      {label && <Label htmlFor={id} help={help}>{label}</Label>}
      <input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className={cx("inset h-10 w-full rounded-lg border border-line2 px-3 text-sm text-ink transition-colors placeholder:text-dim hover:border-line focus:border-accent focus:outline-none", mono && "font-mono")} />
    </div>
  );
}

export function TextArea({ label, help, value, onChange, rows = 3, placeholder, className, right, mono }: {
  label?: string; help?: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; className?: string; right?: ReactNode; mono?: boolean;
}) {
  const id = useId();
  return (
    <div className={className}>
      {label && <Label htmlFor={id} help={help} right={right}>{label}</Label>}
      <textarea id={id} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className={cx("inset w-full resize-y rounded-lg border border-line2 px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-dim hover:border-line focus:border-accent focus:outline-none", mono && "font-mono text-[13px]")} />
    </div>
  );
}

export function Select({ label, help, value, options, onChange, className }: {
  label?: string; help?: string; value: string; options: (string | { value: string; label: string })[]; onChange: (v: string) => void; className?: string;
}) {
  const id = useId();
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  if (value && !opts.some((o) => o.value === value)) opts.unshift({ value, label: value });
  return (
    <div className={className}>
      {label && <Label htmlFor={id} help={help}>{label}</Label>}
      <DropSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}
        className="btn-raised h-10 w-full rounded-lg px-2.5 text-sm text-ink focus:border-accent focus:outline-none">
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </DropSelect>
    </div>
  );
}

export function Slider({ label, help, value, min, max, step = 1, onChange, show }: {
  label: string; help?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; show?: string;
}) {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id} help={help} right={<span className="font-mono text-xs text-ink">{show ?? value}</span>}>{label}</Label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </div>
  );
}

export function Check({ checked, onChange, title, sub, help }: { checked: boolean; onChange: (v: boolean) => void; title: string; sub?: string; help?: string }) {
  return (
    <label className={cx("card flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-[13px] transition-colors", checked ? "border-accent/60" : "border-line hover:border-muted/40")}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
      <span><b className="font-semibold">{title}</b>{help && <Help k={help} />}{sub && <><br /><span className="text-muted">{sub}</span></>}</span>
    </label>
  );
}

/** a side column: scrolling body + an always-visible footer for the main button */
export function Panel({ children, className, w, footer, tone = "panel" }: { children: ReactNode; className?: string; w?: string; footer?: ReactNode; tone?: "panel" | "panel2" }) {
  return (
    <aside className={cx("flex shrink-0 flex-col border-line2", tone === "panel" ? "bg-panel" : "bg-panel2", className ?? "border-r", w)}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">{children}</div>
      {footer && <div className="border-t border-line2 px-5 py-4">{footer}</div>}
    </aside>
  );
}
export function H1({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return <div><h1 className="display text-[20px] leading-tight">{children}</h1>{sub && <p className="mt-1 text-[13px] text-muted">{sub}</p>}</div>;
}

// ------------------------------------------------------------------ presets + remembered
const NO_PRESETS: Record<string, unknown> = {};
export function PresetBar({ section }: { section: "create" | "edit" | "prompt" | "animate" | "finish" }) {
  const presets = useSettings((s) => s.presets[section]) ?? NO_PRESETS;
  const { savePreset, applyPreset, deletePreset, reset } = useSettings.getState();
  const names = Object.keys(presets);
  const [sel, setSel] = useState("");
  const saveAs = async () => { const n = await askText("Name this preset", sel || "", "Save preset"); if (n) { savePreset(section, n); setSel(n); useJobs.getState().toast(`Saved preset “${n}”`, "good"); } };
  // no presets yet: one small line instead of an empty dropdown
  if (!names.length) return (
    <p className="text-xs text-muted"><span className="text-good">✓</span> Opens like this next time · <button className="underline hover:text-ink" onClick={saveAs}>save as a preset</button> · <button className="underline hover:text-ink" onClick={async () => { if (await askConfirm("Reset this tab?", "Every setting on this tab goes back to how it started. Presets are kept.", "Reset")) reset(section); }}>reset</button></p>
  );
  return (
    <div>
      <div className="flex items-center gap-2">
        <DropSelect aria-label="Preset" value={sel} onChange={(e) => { setSel(e.target.value); if (e.target.value) applyPreset(section, e.target.value); }}
          className="btn-raised h-[34px] min-w-0 flex-1 rounded-lg px-2 text-[13px] text-ink">
          <option value="">{names.length ? "Load a preset…" : "No presets yet"}</option>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </DropSelect>
        <Btn small onClick={saveAs}>Save</Btn>
        {sel && <Btn small onClick={async () => { if (await askConfirm(`Delete “${sel}”?`, "The preset is removed for every future rental too.", "Delete", true)) { deletePreset(section, sel); setSel(""); } }} title="Delete preset"><Icon name="trash" size={14} /></Btn>}
      </div>
      <p className="mt-1.5 text-xs text-muted"><span className="text-good">✓</span> Opens like this next time. <button className="text-muted underline hover:text-ink" onClick={async () => { if (await askConfirm("Reset this tab?", "Every setting on this tab goes back to how it started. Presets are kept.", "Reset")) reset(section); }}>reset</button></p>
    </div>
  );
}

// ------------------------------------------------------------------ advanced sampler box
export function Advanced({ a, set, children, hideCfg }: { a: Adv; set: (p: Partial<Adv>) => void; children?: ReactNode; hideCfg?: boolean }) {
  const [samplers, setSamplers] = useState<string[]>([]);
  const [schedulers, setSchedulers] = useState<string[]>([]);
  useEffect(() => { listSamplers().then(setSamplers); listSchedulers().then(setSchedulers); }, []);
  return (
    <details className="card rounded-[10px] border border-line px-3 py-2.5">
      <summary className="cursor-pointer text-[13px] font-semibold">
        Advanced <span className="font-normal text-muted">· {a.sampler} · {a.scheduler} · {a.steps} steps{hideCfg ? "" : ` · CFG ${a.cfg}`}{a.lockSeed ? " · seed locked" : ""}</span>
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <Select label="Sampler" help="sampler" value={a.sampler} options={samplers} onChange={(v) => set({ sampler: v })} />
        <Select label="Scheduler" help="scheduler" value={a.scheduler} options={schedulers} onChange={(v) => set({ scheduler: v })} />
        <TextIn label="Steps" help="steps" value={a.steps} onChange={(v) => set({ steps: Math.max(1, Math.min(200, Number(v) || 1)) })} />
        {!hideCfg && <TextIn label="CFG" help="cfg" value={a.cfg} onChange={(v) => set({ cfg: Number(v) || 0 })} />}
      </div>
      <div className="mt-2.5 flex items-end gap-2">
        <TextIn className="flex-1" label="Seed" help="seed" mono value={a.seed || ""} placeholder="random" onChange={(v) => set({ seed: Number(v.replace(/\D/g, "")) || 0 })} />
        <Btn onClick={() => set({ lockSeed: !a.lockSeed, seed: a.seed || newSeed() })} title={a.lockSeed ? "Seed locked: same result every run" : "Lock this seed"} className="h-10">
          <Icon name={a.lockSeed ? "lock" : "unlock"} /> {a.lockSeed ? "Locked" : "Lock"}
        </Btn>
      </div>
      {children && <div className="mt-2.5 flex flex-col gap-2.5">{children}</div>}
    </details>
  );
}

// ------------------------------------------------------------------ LoRAs
const FAMILY_LABEL: Record<string, string> = { sdxl: "SDXL / Illustrious", anima: "Anima", qwen: "Qwen", krea2: "Krea 2", h3: "MiniMax H3", video: "another video model", other: "other model", unknown: "unknown" };

/** your LoRAs: pick with a strength slider, paste a CivitAI link to add one — kept for every future rental */
type ImgFam = "sdxl" | "anima" | "krea2";
/** the creator's tips, in short */
export const tipsLine = (t?: LoraTips) => !t ? "" : [t.weight != null && `strength ${t.weight_range ?? t.weight}`, t.sampler, t.scheduler, t.cfg != null && `CFG ${t.cfg_range ?? t.cfg}`, t.steps != null && `${t.steps_range ?? t.steps} steps`].filter(Boolean).join(" · ");
/** LoRA strengths add up: past a point every model smears (patchy, watercolour-like, lost detail). Warn on the total
 * (sliders not counted) and balance the way guides do it: the character leads, the rest support (see lib/loraBalance). */
const STACK_KEY: Record<string, BudgetKey> = { krea2: "krea2", anima: "anima", sdxl: "sdxl", h3: "h3" };
function StackWarning({ value, onChange, family, lib }: { value: LoraPick[]; onChange: (v: LoraPick[]) => void; family?: string; lib: LoraInfo[] }) {
  const key = STACK_KEY[family ?? ""];
  if (!key) return null;
  const budget = BUDGET[key];
  const info = (n: string) => lib.find((x) => x.name === n);
  const counted = value.filter((l) => !l.off && roleOf(l, info(l.name)) !== "slider");
  const total = stackTotal(value, lib);
  if (counted.length < 2 || total <= budget + 0.2) return null;
  const sliders = value.filter((l) => !l.off && roleOf(l, info(l.name)) === "slider").length;
  return (
    <div className="mb-2 border border-hot/50 bg-hot/[.07] px-2.5 py-2 text-[12px] leading-relaxed text-muted" role="status">
      <b className="text-ink">{counted.length} LoRAs adding up to {total.toFixed(1)}</b>{sliders ? ` (${sliders} slider${sliders > 1 ? "s" : ""} not counted)` : ""}. {family === "krea2" ? "Krea 2 Turbo" : "This model"} turns patchy and blotchy past about {budget.toFixed(1)}.
      {" "}Balancing keeps the character LoRA at its creator's strength and lowers the others to share the rest.
      <button onClick={() => onChange(balanceLoras(value, lib, budget).loras)} className="ml-1 font-medium text-accent hover:underline">Balance them</button>
      <span className="block text-dim">With “Keep LoRAs balanced” on (Create), this happens by itself when you generate.</span>
    </div>
  );
}

export function LoraList({ value, onChange, family, label = "LoRAs", onSweep, onFamily, onTips }: { value: LoraPick[]; onChange: (v: LoraPick[]) => void; family?: "sdxl" | "anima" | "krea2" | "h3"; label?: string; filter?: (n: string) => boolean; onSweep?: (l: LoraPick, title: string) => void;
  /** a LoRA for another model was added: switch to that model and add it there (instead of warning "probably won't work") */
  onFamily?: (family: ImgFam, pick: LoraPick) => void;
  /** use a LoRA's creator tips: "auto" when it's added (negative words), "all" when you press Use (sampler, scheduler, CFG, steps too) */
  onTips?: (tips: LoraTips, how: "auto" | "all") => void }) {
  const [lib, setLib] = useState<LoraInfo[]>([]);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [link, setLink] = useState("");
  const [dl, setDl] = useState<LoraJob | null>(null);
  const [showOther, setShowOther] = useState(false);
  const toast = useJobs((s) => s.toast);
  const refresh = () => loraLibrary().then(setLib);
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (adding) refresh(); }, [adding]); // eslint-disable-line react-hooks/exhaustive-deps
  // a LoRA added from elsewhere (browser, "Use this prompt") that we don't know yet → reload the library
  const missing = value.some((v) => !lib.some((l) => l.name === v.name));
  useEffect(() => { if (missing) refresh(); }, [missing, value.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // fill in trigger words we learned since the LoRA was picked
  useEffect(() => {
    if (!lib.length) return;
    let changed = false;
    const nv = value.map((v) => { const t = lib.find((l) => l.name === v.name)?.trigger; if (t && v.trigger === undefined) { changed = true; return { ...v, trigger: t }; } return v; });
    if (changed) onChange(nv);
  }, [lib]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  /** add one LoRA: the creator's strength, its tips, and — if it's for another model — switch to that model */
  const addPick = (name: string, trig: string | undefined, fam?: string, tips?: LoraTips) => {
    const { value: v, onChange: set } = latest.current;
    if (v.some((x) => x.name === name)) return;
    const pick: LoraPick = { name, strength: tips?.weight ?? 0.8, trigger: trig || undefined };
    if (onFamily && family && family !== "h3" && fam && fam !== family && (fam === "sdxl" || fam === "anima" || fam === "krea2")) {
      onFamily(fam, pick);
      toast(`That LoRA is for ${FAMILY_LABEL[fam] ?? fam} — switched to ${FAMILY_LABEL[fam] ?? fam} and added it there.`, "info");
    } else set([...v, pick]);
    if (tips && onTips) onTips(tips, "auto");
  };
  const browse = () => openLoraBrowser(onFamily && family !== "h3" ? "any" : family ?? "any", async (name, trig) => {
    const l = await loraLibrary(); setLib(l);
    const inf = l.find((x) => x.name === name);
    addPick(name, trig, inf?.family, inf?.tips);
  });
  const info = (n: string) => lib.find((l) => l.name === n);
  const fits = (l: LoraInfo) => !family || l.family === family || l.family === "unknown";
  const avail = lib.filter((l) => !value.some((v) => v.name === l.name) && `${l.title} ${l.name}`.toLowerCase().includes(q.toLowerCase()));
  const good = avail.filter(fits), other = avail.filter((l) => !fits(l));

  const install = async () => {
    if (!link.trim()) return;
    try {
      const id = await addLoraFromLink(link.trim());
      setDl({ status: "running", progress: 0 });
      const t = setInterval(async () => {
        const j = await loraJob(id).catch(() => null);
        if (!j) return;
        setDl(j);
        if (j.status !== "running") {
          clearInterval(t);
          if (j.status === "done" && j.name && j.kind === "model") {
            // a checkpoint, not a LoRA: it went to your models — pick it under Checkpoint
            forgetObjectInfo(); bumpModels();
            toast(`“${j.title}” is a checkpoint, not a LoRA — it's in your models now. Pick it under Checkpoint (it'll be there on every rental).`, "good");
            setLink(""); setAdding(false); setDl(null);
          } else if (j.status === "done" && j.name) {
            forgetObjectInfo(); await refresh();
            addPick(j.name, j.trigger, j.family, j.tips);
            toast(`Added “${j.title}”${j.trigger ? ` — trigger words: ${j.trigger}` : ""}. It'll be here on every rental.`, "good");
            setLink(""); setAdding(false); setDl(null);
          } else toast(`Couldn't add that LoRA: ${j.error}`, "bad");
        }
      }, 800);
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  const upOwn = async (f: File) => {
    if (!/\.safetensors$/i.test(f.name)) return toast(`${f.name}: LoRAs must be .safetensors files`, "bad");
    const r = await uploadLoraWithToast(f);
    if (r) { await refresh(); addPick(r.name, r.trigger, undefined); setAdding(false); }
  };
  const row = (l: LoraInfo, warn?: boolean) => (
    <button key={l.name} className={cx("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover", warn && "opacity-60")} title={l.name}
      onClick={() => { addPick(l.name, l.trigger, l.family, l.tips); setAdding(false); setQ(""); }}>
      <span className="min-w-0 flex-1 truncate">{l.title}</span>
      <span className={cx("shrink-0 rounded px-1.5 py-0.5 text-[10px]", warn && !onFamily ? "bg-bad/15 text-bad" : warn ? "bg-accent/15 text-accent" : "bg-white/5 text-muted")} title={warn && onFamily ? `Picking it switches to ${FAMILY_LABEL[l.family] ?? l.base}` : undefined}>{warn && onFamily ? "switches to " : ""}{FAMILY_LABEL[l.family] ?? l.base}</span>
    </button>
  );
  return (
    <div>
      <Label help="lora" right={<span className="flex items-center gap-3"><LoraSets family={family ?? "any"} value={value} onChange={onChange} /></span>}>{label}</Label>
      <StackWarning value={value} onChange={onChange} family={family} lib={lib} />
      <div className="flex flex-col gap-1.5">
        {value.map((l, i) => {
          const inf = info(l.name);
          const bad = inf && family && !fits(inf);
          const upd = (p: Partial<LoraPick>) => onChange(value.map((v, j) => (j === i ? { ...v, ...p } : v)));
          const trig = l.trigger ?? inf?.trigger ?? "";
          const role = roleOf(l, inf);
          return (
            <div key={l.name} className={cx("card border px-2.5 py-2 transition-opacity", bad ? "border-bad/50" : "border-line", l.off && "opacity-55")}>
              <div className="flex items-center gap-2 text-[13px]">
                <button role="switch" aria-checked={!l.off} aria-label={`${l.off ? "Turn on" : "Turn off"} ${inf?.title ?? l.name}`} onClick={() => upd({ off: !l.off })}
                  className={cx("relative h-[18px] w-8 shrink-0 border transition-colors", l.off ? "border-line bg-raised2" : "border-accent bg-accent")}>
                  <span className={cx("absolute top-[2px] h-3 w-3 transition-all", l.off ? "left-[2px] bg-dim" : "left-[15px] bg-accentink")} />
                </button>
                <span className="min-w-0 flex-1 truncate" title={l.name}>{inf?.title ?? l.name.split("/").pop()?.replace(/\.safetensors$/, "")}</span>
                {(role === "slider" || role === "character") && <span className={cx("micro border px-1", role === "slider" ? "border-cyan/50 text-cyan" : "border-accent/50 text-accent")}
                  title={role === "slider" ? "Slider: moves one thing (size, age look, detail…) up or down. Not counted in the total, and Balance leaves it alone. Negative = the other way." : "Character LoRA: leads the stack — Balance keeps it at its creator's strength"}>{role.toUpperCase()}</span>}
                {inf?.remembered && <span className="micro text-good" title="Kept: re-downloaded automatically on every rental">KEPT</span>}
                {onSweep && <button aria-label={`Try strengths for ${inf?.title ?? l.name}`} title="Try strengths: same picture at several strengths, side by side" className="text-muted hover:text-accent" onClick={() => onSweep(l, inf?.title ?? l.name.split("/").pop()!.replace(/\.safetensors$/, ""))}><Icon name="sweep" size={15} /></button>}
                <button aria-label={`Remove ${l.name}`} className="text-muted hover:text-ink" onClick={() => onChange(value.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
              </div>
              {bad && <p className="mt-0.5 text-[11px] text-bad">Made for {FAMILY_LABEL[inf!.family] ?? inf!.base} — probably won't work here{onFamily && (inf!.family === "sdxl" || inf!.family === "anima" || inf!.family === "krea2") && <button className="ml-1.5 text-accent hover:underline" onClick={() => { onChange(value.filter((_, j) => j !== i)); onFamily(inf!.family as ImgFam, l); }}>move it to {FAMILY_LABEL[inf!.family]}</button>}</p>}
              {inf?.tips && tipsLine(inf.tips) && <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-dim">
                <span className="min-w-0 flex-1 truncate" title={`The creator recommends: ${tipsLine(inf.tips)}${inf.tips.negative ? ` · negative: ${inf.tips.negative}` : ""}`}>Creator: {tipsLine(inf.tips)}</span>
                {onTips && <button className="shrink-0 text-accent hover:underline" title="Use the creator's strength, sampler, scheduler, CFG, steps and negative words" onClick={() => { if (inf.tips!.weight != null) upd({ strength: inf.tips!.weight }); onTips(inf.tips!, "all"); }}>use</button>}
              </div>}
              {!l.off && (
                <>
                  <div className="mt-1 flex items-center gap-2.5">
                    <input type="range" min={role === "slider" ? -3 : 0} max={role === "slider" ? 3 : 1.5} step={0.05} value={l.strength} aria-label={`${l.name} strength`} className="flex-1"
                      onChange={(e) => upd({ strength: Number(e.target.value) })} />
                    <span className="w-9 text-right font-mono text-xs">{l.strength.toFixed(2)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                    {trig ? (
                      <>
                        <button onClick={() => upd({ noAuto: !l.noAuto })} title={l.noAuto ? "Trigger words are not added — click to add them automatically" : "Trigger words are added to your prompt automatically — click to stop"}
                          className={cx("micro shrink-0 border px-1 py-px", l.noAuto ? "border-line text-dim" : "border-accent/60 text-accent")}>{l.noAuto ? "OFF" : "AUTO"}</button>
                        <span className={cx("min-w-0 flex-1 truncate font-mono", l.noAuto ? "text-dim line-through" : "text-muted")} title={trig}>{trig}</span>
                      </>
                    ) : <span className="flex-1 text-dim">No trigger words needed</span>}
                    <button className="shrink-0 text-dim hover:text-ink" onClick={async () => { const t = await askText("Trigger words (comma separated)", trig, "Save"); if (t !== null) upd({ trigger: t, noAuto: false }); }}>edit</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
        {adding ? (
          <div className="card rounded-lg border border-line p-2">
            <div className="mb-2 flex gap-1.5">
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a CivitAI link…" aria-label="CivitAI link"
                onKeyDown={(e) => e.key === "Enter" && install()}
                className="inset h-8 min-w-0 flex-1 rounded-md border border-line2 px-2 text-[13px] focus:border-accent focus:outline-none" />
              <Btn small onClick={install} disabled={!link.trim() || dl?.status === "running"} why="Downloading…">Add</Btn>
            </div>
            {dl?.status === "running" && (
              <div className="mb-2">
                <div className="mb-1 flex justify-between text-[11px] text-muted"><span>{dl.title ?? "Finding it on CivitAI…"}</span><span>{Math.round(dl.progress * 100)}%{dl.total_mb ? ` of ${dl.total_mb} MB` : ""}</span></div>
                <div className="h-1.5 overflow-hidden rounded-sm bg-raised2"><div className="stripes h-full transition-[width]" style={{ width: `${dl.progress * 100}%` }} /></div>
              </div>
            )}
            <label className="mb-2 flex cursor-pointer items-center justify-center gap-1.5 border border-dashed border-line px-2 py-2 text-[12.5px] text-muted hover:border-accent hover:text-ink"
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => { e.preventDefault(); e.stopPropagation(); for (const f of Array.from(e.dataTransfer.files)) await upOwn(f); }}>
              <Icon name="up" size={14} /> Upload your own .safetensors (or drop it here)
              <input type="file" accept=".safetensors" multiple className="hidden" onChange={async (e) => { for (const f of Array.from(e.target.files ?? [])) await upOwn(f); e.target.value = ""; }} />
            </label>
            <input autoFocus placeholder="…or search the ones you have" value={q} onChange={(e) => setQ(e.target.value)}
              className="inset mb-1.5 h-8 w-full rounded-md border border-line2 px-2 text-[13px] focus:border-accent focus:outline-none" />
            <div className="max-h-52 overflow-y-auto">
              {good.length === 0 && <p className="p-2 text-xs text-muted">{lib.length ? "No matching LoRAs for this model yet — paste a CivitAI link above." : "No LoRAs yet — paste a CivitAI link above."}</p>}
              {good.slice(0, 80).map((l) => row(l))}
              {other.length > 0 && (
                <>
                  <button className="mt-1 w-full px-2 py-1 text-left text-[11px] text-muted hover:text-ink" onClick={() => setShowOther((v) => !v)}>
                    {showOther || good.length === 0 ? "▾" : "▸"} {other.length} made for other models (may not work well here)
                  </button>
                  {(showOther || good.length === 0) && other.slice(0, 80).map((l) => row(l, true))}
                </>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between"><button className="text-xs text-muted hover:text-ink" onClick={() => setAdding(false)}>Close</button><button className="text-xs text-accent hover:underline" onClick={() => { setAdding(false); browse(); }}>Browse CivitAI ›</button></div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <Btn className="w-full" onClick={browse} title="Scroll through CivitAI LoRAs right here"><Icon name="search" size={14} /> Browse</Btn>
            <Btn className="w-full" onClick={() => setAdding(true)} title="Pick one you have, or paste a CivitAI link"><Icon name="plus" size={14} /> Add</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ media
export function MediaView({ m, className, controls = true, contain }: { m: { url: string; kind: string; label?: string }; className?: string; controls?: boolean; contain?: boolean }) {
  if (m.kind === "video") return <video src={controls ? m.url : `${m.url}#t=0.5`} preload="metadata" controls={controls} muted={!controls} loop playsInline className={cx("h-full w-full bg-black", contain ? "object-contain" : "object-cover", className)} />;
  if (m.kind === "audio") return <div className={cx("flex h-full w-full flex-col items-center justify-center gap-2 bg-raised2 p-2", className)}><Icon name="wave" size={22} /><span className="truncate text-[11px] text-muted">{m.label}</span>{controls && <audio src={m.url} controls className="w-full" />}</div>;
  return <img src={m.url} alt={m.label ?? ""} className={cx("h-full w-full", contain ? "object-contain" : "object-cover", className)} />;
}

/** a drop zone for one file: drag from the tray, drop a file from your computer, or click to browse */
export function Slot({ value, onChange, accept = ["image"], label, className, hint, tall }: {
  value?: Media | null; onChange: (m: Media | null) => void; accept?: ("image" | "video" | "audio")[]; label?: string; className?: string; hint?: string; tall?: boolean;
}) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const toast = useJobs((s) => s.toast);
  const take = async (p: Promise<Media>) => {
    setBusy(true);
    try {
      const m = await p;
      if (!accept.includes(m.kind as any)) throw new Error(`This slot takes ${accept.join(" or ")} files`);
      onChange(m);
    } catch (e) { toast(String((e as Error).message), "bad"); } finally { setBusy(false); }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (id) return take(useTray.getState().asMedia(id));
    const f = e.dataTransfer.files?.[0];
    if (f) return take(useTray.getState().addUpload(f));
    // dragged from another tab (Pinterest, Instagram, any site): the rental fetches it
    const url = droppedUrl(e.dataTransfer);
    if (url) take(useTray.getState().addUrl(url));
  };
  const acceptAttr = accept.map((a) => `${a}/*`).join(",");
  return (
    <div className={cx("relative", className)}>
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
        onContextMenu={value && (value.kind === "image" || value.kind === "video") ? (e) => openPictureMenu(e, { media: value }) : undefined}
        title={value && value.kind === "image" ? "Right-click for more: use in Edit, copy its look, save…" : undefined}
        className={cx("relative flex items-center justify-center overflow-hidden rounded-[10px] border text-center text-[13px]", tall ? "h-full min-h-40" : "h-full",
          value ? "border-line bg-black" : "hatch border-dashed border-line text-muted", over && "!border-accent ring-2 ring-accent/40")}>
        {value ? (value.kind === "image"
          ? <button type="button" className="h-full w-full cursor-zoom-in" title="Click to see it full size · right-click for more" onClick={() => import("./Viewer").then((v) => v.openViewer([{ url: value.url, kind: "image", label: value.label }], 0))}><MediaView m={value} controls={false} contain /></button>
          : <MediaView m={value} controls contain />) : (
          <button type="button" onClick={() => file.current?.click()} className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-3 hover:text-ink">
            <Icon name="up" size={20} />
            <span>{busy ? "Adding…" : label ?? "Drop here"}</span>
            <span className="text-[11px] text-dim">{hint ?? "drag from the tray, or click to pick a file"}</span>
          </button>
        )}
        {busy && value && <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs">Adding…</div>}
      </div>
      {value && (
        <button aria-label="Remove" onClick={() => onChange(null)} className="absolute right-1.5 top-1.5 rounded-md bg-black/70 p-1 text-ink hover:bg-black"><Icon name="x" size={14} /></button>
      )}
      <input ref={file} type="file" accept={acceptAttr} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) take(useTray.getState().addUpload(f)); e.target.value = ""; }} />
    </div>
  );
}

// ------------------------------------------------------------------ job progress
export function fmtDur(ms?: number) {
  if (ms == null || !isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}
export function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, [active]);
  return now;
}
export function JobBar({ job, compact }: { job: Job; compact?: boolean }) {
  const now = useNow(job.status === "running" || job.status === "queued");
  const cancel = useJobs((s) => s.cancel);
  const elapsed = job.startedAt ? now - job.startedAt : 0;
  const frac = job.status === "running" && job.etaMs ? Math.min(0.97, elapsed / job.etaMs) : 0;
  const stepFrac = job.max ? job.value / job.max : 0;
  const left = timeLeft(job, now);
  const ahead = useJobs((s) => job.status === "queued" ? s.jobs.filter((x) => x.status === "running" || (x.status === "queued" && x.queuedAt < job.queuedAt)).length : 0);
  const label = job.status === "queued" ? (ahead ? `Waiting in line · ${ahead} ahead of it` : "Starting…") : job.status === "running"
    ? `${job.nodeTitle ?? "Working"}${job.max ? ` · step ${job.value} of ${job.max}` : ""}` : job.status === "done" ? "Done" : job.status === "error" ? "Failed" : "Cancelled";
  return (
    <div className={cx("flex flex-col gap-1.5", compact && "text-xs")}>
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="truncate">{label}</span>
        <span className="flex shrink-0 items-center gap-2 text-muted">
          {job.status === "running" && (left != null && left > 0 ? `~${fmtDur(left)} left` : "almost there")}
          {(job.status === "running" || job.status === "queued") && <button className="text-muted hover:text-bad" onClick={() => cancel(job.id)} aria-label="Cancel">Cancel</button>}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-sm bg-raised2">
        <div className={cx("stripes h-full transition-[width] duration-500", job.status === "queued" && "pulse w-full opacity-40")}
          style={{ width: job.status === "queued" ? undefined : `${Math.round(Math.max(frac, job.status === "done" ? 1 : 0, stepFrac * 0.15 + frac * 0.85) * 100)}%` }} />
      </div>
      {job.error && <p className="text-xs text-bad">{job.error}</p>}
    </div>
  );
}

export function EtaText({ k, prefix = "" }: { k: string; prefix?: string }) {
  const eta = useJobs((s) => s.eta(k));
  return eta ? <span className="font-normal opacity-80">{prefix}~{fmtDur(eta)}</span> : null;
}

export { cx };

/** a dropdown list drawn by the Studio (keyboard: arrows, Enter, Esc) */
export function DropList<T extends string | number>({ value, options, onChange, title, button, className }: {
  value: T; options: { value: T; label: ReactNode; hint?: string; /** a heading shown above the first row of each group */ group?: string; /** a trash icon at the right of the row */ onDelete?: () => void }[]; onChange: (v: T) => void; title?: string; button: (open: boolean) => ReactNode; className?: string;
}) {
  const [at, setAt] = useState<{ x: number; y: number; w: number; up: boolean } | null>(null);
  const [hi, setHiState] = useState(0);
  const hiRef = useRef(0);
  const setHi = (v: number | ((h: number) => number)) => setHiState((h) => { const n = typeof v === "function" ? v(h) : v; hiRef.current = n; return n; });
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const open = () => {
    const r = btn.current!.getBoundingClientRect();
    const up = r.bottom + Math.min(320, options.length * 34 + 12) > window.innerHeight && r.top > window.innerHeight / 2;
    setAt({ x: r.left, y: up ? r.top : r.bottom, w: r.width, up });
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
  };
  const close = () => setAt(null);
  const choose = (i: number) => { const o = options[i]; if (o) onChange(o.value); close(); btn.current?.focus(); };
  useEffect(() => {
    if (!at) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); close(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setHi((h) => Math.min(options.length - 1, h + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setHi((h) => Math.max(0, h - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); choose(hiRef.current); }
    };
    // scrolling the list itself (wheel, scroll bar, middle-button autoscroll) keeps it open; only the page moving closes it
    const shut = (e: Event) => { if (list.current && e.target instanceof Node && list.current.contains(e.target)) return; close(); };
    window.addEventListener("keydown", k, true); window.addEventListener("resize", shut); window.addEventListener("scroll", shut, true);
    return () => { window.removeEventListener("keydown", k, true); window.removeEventListener("resize", shut); window.removeEventListener("scroll", shut, true); };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <button ref={btn} type="button" title={title} aria-label={title} aria-haspopup="listbox" aria-expanded={!!at} onClick={() => (at ? close() : open())} className={cx("text-left", className)}>{button(!!at)}</button>
      {at && createPortal(
        <div className="fixed inset-0 z-[97]" onMouseDown={(e) => { if (e.button === 0) close(); }} onWheel={(e) => { if (!list.current?.contains(e.target as Node)) close(); }}>
          <ul ref={list} role="listbox" aria-label={title} onMouseDown={(e) => e.stopPropagation()} onAuxClick={(e) => e.preventDefault()}
            className="fade-in absolute max-h-80 overflow-y-auto border border-line bg-raised2 py-1 shadow-2xl"
            style={{ left: Math.min(at.x, window.innerWidth - Math.max(at.w, 200) - 8), minWidth: Math.max(at.w, 180), ...(at.up ? { bottom: window.innerHeight - at.y + 4 } : { top: at.y + 4 }) }}>
            {options.map((o, i) => (<Fragment key={String(o.value)}>
              {o.group && o.group !== options[i - 1]?.group && <li role="presentation" className="micro px-3 pb-0.5 pt-2 text-dim">{o.group.toUpperCase()}</li>}
              <li role="option" aria-selected={o.value === value} onMouseEnter={() => setHi(i)} onClick={() => choose(i)}
                className={cx("flex cursor-pointer flex-col px-3 py-1.5 text-[13px]", i === hi ? "bg-hover text-ink" : "text-ink/85", o.value === value && "text-accent")}>
                <span className="flex items-center gap-2">{o.value === value ? <Icon name="check" size={12} /> : <span className="w-3" />}<span className="min-w-0 flex-1">{o.label}</span>
                  {o.onDelete && <button type="button" aria-label="Delete" title="Delete" onClick={(e) => { e.stopPropagation(); o.onDelete!(); }}
                    className="press -my-1 -mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center text-dim hover:text-bad"><Icon name="trash" size={13} /></button>}</span>
                {o.hint && <span className="pl-5 text-[11.5px] text-dim">{o.hint}</span>}
              </li>
            </Fragment>))}
          </ul>
        </div>, document.body)}
    </>
  );
}


type OptLike = { value: string; label: ReactNode; disabled?: boolean; group?: string };
function optionsOf(children: ReactNode): OptLike[] {
  const out: OptLike[] = [];
  const walk = (n: ReactNode, group?: string) => Children.forEach(n, (ch) => {
    if (!isValidElement(ch)) return;
    const el = ch as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string }>;
    if (el.type === "option") out.push({ value: String(el.props.value ?? (typeof el.props.children === "string" ? el.props.children : "")), label: el.props.children, disabled: el.props.disabled, group });
    else if (el.type === "optgroup") walk(el.props.children, el.props.label);
    else if (el.props?.children) walk(el.props.children, group);
  });
  walk(children);
  return out;
}
/** drop-in for <select>: same props and <option> children, drawn as the Studio's own dark list */
export function DropSelect({ value, onChange, children, className, disabled, title, id, ...rest }: {
  value: string | number | undefined | null; onChange: (e: { target: { value: string } }) => void; children: ReactNode; className?: string; disabled?: boolean; title?: string; id?: string; "aria-label"?: string;
}) {
  const opts = optionsOf(children).filter((o) => !o.disabled);
  const v = String(value ?? "");
  const cur = opts.find((o) => o.value === v);
  if (disabled) return <span id={id} title={title} className={cx(className, "flex items-center opacity-50")}>{cur?.label ?? ""}</span>;
  return (
    <DropList value={v} options={opts} onChange={(x) => onChange({ target: { value: String(x) } })} title={title ?? rest["aria-label"]}
      className={cx(className, "flex items-center justify-between gap-2")}
      button={() => <><span className="min-w-0 truncate">{cur?.label ?? ""}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-muted" aria-hidden><path d="M6 9l6 6 6-6" /></svg></>} />
  );
}


// ------------------------------------------------------------------ LoRA sets: save the LoRAs you keep using together, switch in one click
interface LoraSet { name: string; loras: LoraPick[] }
const NO_SETS: LoraSet[] = [];
const useLoraSets = create<{ sets: Record<string, LoraSet[]>; loaded: boolean }>(() => ({ sets: {}, loaded: false }));
let setsLoading = false;
function loadSets() {
  if (setsLoading || useLoraSets.getState().loaded) return;
  setsLoading = true;
  loadState<Record<string, LoraSet[]>>("lora_sets").then((d) => useLoraSets.setState({ sets: d && typeof d === "object" ? d : {}, loaded: true })).catch(() => useLoraSets.setState({ loaded: true }));
}
function putSets(sets: Record<string, LoraSet[]>) { useLoraSets.setState({ sets }); saveState("lora_sets", sets).catch(() => {}); }
/** save LoRAs as a preset for one model family (shows up under "LoRA presets" in every tab for that model) */
export async function saveLoraSet(family: string, name: string, loras: LoraPick[]) {
  if (!useLoraSets.getState().loaded) {
    const d = await loadState<Record<string, LoraSet[]>>("lora_sets").catch(() => null);
    useLoraSets.setState({ sets: d && typeof d === "object" ? d : {}, loaded: true });
  }
  const all = useLoraSets.getState().sets;
  putSets({ ...all, [family]: [{ name, loras: loras.map((l) => ({ ...l })) }, ...(all[family] ?? []).filter((x) => x.name !== name)] });
}

function LoraSets({ family, value, onChange }: { family: string; value: LoraPick[]; onChange: (v: LoraPick[]) => void }) {
  useEffect(loadSets, []);
  const sets = useLoraSets((st) => st.sets[family] ?? NO_SETS);
  const toast = useJobs((st) => st.toast);
  const opts = [
    ...sets.map((x, i) => ({ value: `use:${i}`, label: x.name, hint: x.loras.map((l) => `${l.name.replace(/\.safetensors$/, "").split("/").pop()} ${l.strength}`).join(" · ").slice(0, 90),
      onDelete: () => { const all = useLoraSets.getState().sets; putSets({ ...all, [family]: (all[family] ?? []).filter((_, j) => j !== i) }); toast(`Deleted “${x.name}”`, "info"); } })),
    ...(value.length ? [{ value: "save", label: "Save these as a set…", hint: `${value.length} LoRA${value.length > 1 ? "s" : ""}, with their strengths` }] : []),
  ];
  if (!opts.length) return <span className="text-xs text-dim" title="Add LoRAs, then save them as a LoRA preset to switch between looks in one click">LoRA presets</span>;
  return (
    <DropList value="" options={opts} title="LoRA sets" button={(open) => <span className={cx("text-xs", open ? "text-ink" : "text-muted hover:text-ink")}>LoRA presets{sets.length ? ` · ${sets.length}` : ""} ▾</span>}
      onChange={async (v) => {
        const all = useLoraSets.getState().sets;
        if (v === "save") {
          const name = await askText("Name this LoRA set", "", "Save set");
          if (!name?.trim()) return;
          putSets({ ...all, [family]: [{ name: name.trim(), loras: value.map((l) => ({ ...l })) }, ...(all[family] ?? []).filter((x) => x.name !== name.trim())] });
          toast(`Saved “${name.trim()}” — pick it from LoRA presets any time`, "good");
        } else if (v.startsWith("use:")) {
          const st = (all[family] ?? [])[Number(v.slice(4))];
          if (st) { onChange(st.loras.map((l) => ({ ...l }))); toast(`Using the “${st.name}” LoRAs`, "good"); }
        } else if (v.startsWith("del:")) {
          const i = Number(v.slice(4));
          putSets({ ...all, [family]: (all[family] ?? []).filter((_, j) => j !== i) });
        }
      }} />
  );
}
