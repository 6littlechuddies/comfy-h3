// Your recipes, on screen: the editor (name + steps, with a searchable step list), the list in Batch with a drop zone per
// recipe, the "Run a recipe" menu for picked pictures, and the progress of recipes that are running.
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import type { FileRef } from "../lib/api";
import { useJobs, type Tab } from "../lib/jobs";
import { blankRecipe, needsCharacter, newStep, recipeCharacter, runRecipe, STEP_INFO, stepLabel, stopRun, useRecipeRuns, useRecipes, type MyRecipe, type Step, type StepKind } from "../lib/recipes";
import { useCharacters } from "../lib/characters";
import { droppedUrl, useTray } from "../lib/tray";
import { Modal } from "./Dialogs";
import { Icon, cx } from "./ui";

// ------------------------------------------------------------------ editor
interface EditorState { r: MyRecipe | null; runOn: FileRef[]; tab: Tab }
export const useRecipeEditor = create<EditorState>(() => ({ r: null, runOn: [], tab: "batch" }));
/** open the editor: an existing recipe, or a new one (optionally with pictures waiting to run it on) */
export function editRecipe(r?: MyRecipe, runOn: FileRef[] = [], tab: Tab = "batch") {
  useRecipes.getState().load();
  useRecipeEditor.setState({ r: r ? structuredClone(r) : blankRecipe(), runOn, tab });
}

export function RecipeEditorHost() {
  const { r, runOn, tab } = useRecipeEditor();
  const [draft, setDraft] = useState<MyRecipe | null>(null);
  const [adding, setAdding] = useState(false);
  const who = useCharacters((s) => s.list.find((x) => x.id === s.sel)?.name);
  const toast = useJobs((s) => s.toast);
  useEffect(() => { setDraft(r); setAdding(!!r && !r.steps.length); }, [r]);
  if (!r || !draft) return null;
  const close = () => useRecipeEditor.setState({ r: null, runOn: [] });
  const name = who ?? "your character";
  const setStep = (id: string, p: Partial<Step>) => setDraft({ ...draft, steps: draft.steps.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  const move = (i: number, d: number) => { const st = [...draft.steps]; const [x] = st.splice(i, 1); st.splice(i + d, 0, x); setDraft({ ...draft, steps: st }); };
  const fallback = draft.steps.length ? draft.steps.map((s) => stepLabel(s, "them").replace(/^Add to them's /, "→ ")).slice(0, 3).join(" → ") : "";
  const save = (andRun: boolean) => {
    const out = { ...draft, name: draft.name.trim() || fallback.slice(0, 60) || "My recipe" };
    useRecipes.getState().save(out);
    close();
    if (andRun) runRecipe(out, runOn, tab).catch((e) => toast((e as Error).message, "bad"));
    else toast(`Saved “${out.name}” — run it from Batch, a picture's right-click menu, or on picked pictures`, "good");
  };
  const empty = !draft.steps.length;
  const blocked = andRunWhy(draft, runOn);
  return (
    <Modal onClose={close} label="Recipe" width={600}>
      <div className="flex max-h-[76vh] flex-col">
        <div className="flex flex-col gap-1 border-b border-line px-5 pb-4 pt-5">
          <input autoFocus={!empty} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={fallback || "Name this recipe"} aria-label="Recipe name"
            className="display bg-transparent text-[20px] text-ink placeholder:text-dim focus:outline-none" />
          <p className="text-[12.5px] text-muted">Steps run in order, each on the picture the step before made. {needsCharacter(draft) ? <>The character is whoever is picked on the left when it runs{who ? <> — now <b className="font-medium text-ink">{who}</b></> : ""}.</> : "No character needed."}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {empty && !adding && <p className="text-[13px] text-dim">No steps yet.</p>}
          <ol className="flex flex-col">
            {draft.steps.map((s, i) => {
              const info = STEP_INFO[s.kind];
              return (
                <li key={s.id} className="relative flex gap-3 pb-3">
                  {i < draft.steps.length - 1 && <span aria-hidden className="absolute bottom-0 left-[17px] top-9 w-px bg-line" />}
                  <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full border", info.keeps ? "border-good/60 text-good" : "border-accent/60 text-accent")}><Icon name={info.icon} size={15} /></span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] text-ink">{stepLabel({ ...s, words: "", title: "" }, name)}</span>
                      <span className="ml-auto flex items-center gap-0.5 text-muted">
                        <button aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="press flex h-7 w-7 items-center justify-center hover:text-ink disabled:opacity-25"><Icon name="chev" size={13} className="rotate-180" /></button>
                        <button aria-label="Move down" disabled={i === draft.steps.length - 1} onClick={() => move(i, 1)} className="press flex h-7 w-7 items-center justify-center hover:text-ink disabled:opacity-25"><Icon name="chev" size={13} /></button>
                        <button aria-label="Remove step" onClick={() => setDraft({ ...draft, steps: draft.steps.filter((x) => x.id !== s.id) })} className="press flex h-7 w-7 items-center justify-center hover:text-bad"><Icon name="x" size={13} /></button>
                      </span>
                    </div>
                    {s.kind === "change" && <input value={s.words ?? ""} onChange={(e) => setStep(s.id, { words: e.target.value })} placeholder="What changes — e.g. mouth closed, looking at the camera"
                      className="inset h-9 border px-2.5 text-[13px] focus:border-accent focus:outline-none" />}
                    {s.kind === "siteSet" && (
                      <div className="flex gap-2">
                        <input value={s.title ?? ""} onChange={(e) => setStep(s.id, { title: e.target.value })} placeholder="Set name — e.g. Beach day" className="inset h-9 min-w-0 flex-1 border px-2.5 text-[13px] focus:border-accent focus:outline-none" />
                        {(["free", "premium"] as const).map((t) => <button key={t} onClick={() => setStep(s.id, { tier: t })} aria-pressed={(s.tier ?? "free") === t} className={cx("press h-9 border px-3 text-[12.5px]", (s.tier ?? "free") === t ? "border-accent text-ink" : "border-line text-muted hover:text-ink")}>{t === "free" ? "Free" : "Premium"}</button>)}
                      </div>
                    )}
                    {s.kind === "sharpen" && <label className="flex items-center gap-2 text-[12.5px] text-muted"><input type="checkbox" checked={!!s.asChar} onChange={(e) => setStep(s.id, { asChar: e.target.checked })} />Match it to {name}'s face (use when the picture is them)</label>}
                    {s.kind !== "change" && s.kind !== "siteSet" && s.kind !== "sharpen" && <span className="text-[12px] text-dim">{info.blurb}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
          {adding
            ? <StepPicker name={name} onPick={(k) => { setDraft({ ...draft, steps: [...draft.steps, newStep(k)] }); setAdding(false); }} onClose={() => setAdding(false)} />
            : <button onClick={() => setAdding(true)} className="press flex h-10 w-full items-center gap-2 border border-dashed border-line px-3 text-[13px] text-muted hover:border-accent hover:text-ink"><Icon name="plus" size={14} /> Add a step</button>}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          {draft.updated > 0 && <button onClick={() => { useRecipes.getState().remove(draft.id); close(); toast(`Deleted “${draft.name}”`, "info"); }} className="text-[12.5px] text-muted hover:text-bad">Delete recipe</button>}
          <span className="ml-auto" />
          <button onClick={close} className="press btn-raised h-9 rounded-lg px-4 text-[13px] font-medium">Cancel</button>
          {runOn.length > 0 && <button onClick={() => save(true)} disabled={empty || !!blocked} title={blocked ?? ""} className="press btn-raised h-9 rounded-lg px-4 text-[13px] font-medium disabled:opacity-50">Save and run on {runOn.length}</button>}
          <button onClick={() => save(false)} disabled={empty} className="press btn-primary chamfer-sm h-9 rounded-lg px-4 text-[13px] font-semibold disabled:opacity-50">Save recipe</button>
        </div>
      </div>
    </Modal>
  );
}
const andRunWhy = (r: MyRecipe, pics: FileRef[]) => (!pics.length ? "No pictures" : needsCharacter(r) && !recipeCharacter() ? "Pick the character on the left first" : null);

/** the list of steps to add: search box, groups, an icon + one line each, arrow keys + Enter */
function StepPicker({ name, onPick, onClose }: { name: string; onPick: (k: StepKind) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const all = Object.entries(STEP_INFO) as [StepKind, (typeof STEP_INFO)[StepKind]][];
  const rows = useMemo(() => all.filter(([, i]) => !q.trim() || `${i.label(name)} ${i.blurb}`.toLowerCase().includes(q.trim().toLowerCase())), [q, name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setSel(0), [q]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  return (
    <div className="border border-line bg-raised2" data-esc-own>
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Icon name="search" size={14} className="text-dim" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a step…" aria-label="Find a step"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(rows.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter" && rows[sel]) { e.preventDefault(); onPick(rows[sel][0]); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
          }}
          className="h-10 min-w-0 flex-1 bg-transparent text-[13px] focus:outline-none" />
      </div>
      <div ref={list} className="max-h-[300px] overflow-y-auto py-1" role="listbox" aria-label="Steps">
        {!rows.length && <p className="px-3 py-3 text-[12.5px] text-dim">No step matches “{q}”.</p>}
        {rows.map(([k, i], n) => (
          <div key={k}>
            {(n === 0 || rows[n - 1][1].group !== i.group) && <div className="px-3 pb-1 pt-2.5 text-[11px] font-medium text-dim">{i.group}</div>}
            <button data-i={n} role="option" aria-selected={n === sel} onMouseEnter={() => setSel(n)} onClick={() => onPick(k)}
              className={cx("flex w-full items-center gap-3 px-3 py-1.5 text-left", n === sel && "bg-hover")}>
              <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-md border", i.keeps ? "border-good/40 bg-good/10 text-good" : "border-accent/40 bg-accent/10 text-accent")}><Icon name={i.icon} size={14} /></span>
              <span className="min-w-0"><span className="block text-[13px] text-ink">{i.label(name)}</span><span className="block truncate text-[11.5px] text-dim">{i.blurb}</span></span>
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[11px] text-dim"><span>↑↓ choose</span><span>Enter add</span><button onClick={onClose} className="ml-auto hover:text-ink">Esc close</button></div>
    </div>
  );
}

// ------------------------------------------------------------------ running
/** recipes running now (and finished in the last minutes) */
export function RecipeRuns() {
  const runs = useRecipeRuns((s) => s.runs);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  const shown = runs.filter((r) => !r.finished || Date.now() - r.finished < 600_000);
  if (!shown.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {shown.map((r) => {
        const live = Object.values(r.step).filter((s) => s !== "done" && s !== "failed");
        return (
          <div key={r.id} className="card border border-line px-3 py-2.5 text-[12.5px]">
            <div className="flex items-center gap-2">
              <Icon name={r.finished ? "check" : "refresh"} size={13} className={r.finished ? (r.failed.length ? "text-bad" : "text-good") : "text-accent"} />
              <b className="min-w-0 truncate font-medium">{r.name}</b>
              <span className="text-muted">{r.done}/{r.total}{r.failed.length ? ` · ${r.failed.length} failed` : ""}</span>
              {!r.finished && !r.stop && <button onClick={() => stopRun(r.id)} title="No new pictures start; the ones on the way finish" className="ml-auto text-[12px] text-muted hover:text-bad">Stop after these</button>}
            </div>
            <div className="mt-1.5 h-1 bg-raised2"><div className="h-full bg-accent transition-all" style={{ width: `${(r.done / r.total) * 100}%` }} /></div>
            {live.slice(0, 2).map((s, i) => <p key={i} className="mt-1 truncate text-[11.5px] text-dim">{s}</p>)}
            {r.failed.slice(0, 2).map((f, i) => <p key={`f${i}`} className="mt-1 truncate text-[11.5px] text-bad">{f}</p>)}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ the list in Batch
export function RecipePanel() {
  const { list, load } = useRecipes();
  const toast = useJobs((s) => s.toast);
  const who = useCharacters((s) => s.list.find((x) => x.id === s.sel)?.name);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const forId = useRef<string | null>(null);
  useEffect(() => { load(); }, [load]);
  const go = async (r: MyRecipe, add: () => Promise<FileRef[]>) => {
    setBusy(r.id);
    try {
      const pics = await add();
      if (!pics.length) return;
      toast(`${r.name}: started on ${pics.length} picture${pics.length > 1 ? "s" : ""} — results appear below`, "info");
      runRecipe(r, pics, "batch").catch((e) => toast((e as Error).message, "bad"));
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(null); }
  };
  const fromFiles = async (fs: FileList | null) => {
    const out: FileRef[] = [];
    for (const f of Array.from(fs ?? []).filter((x) => x.type.startsWith("image/"))) { const m = await useTray.getState().addUpload(f); out.push({ filename: m.name, subfolder: "", type: "input" }); }
    return out;
  };
  const fromDrop = async (dt: DataTransfer) => {
    if (dt.files?.length) return fromFiles(dt.files);
    const tray = dt.getData("application/x-h3-tray");
    if (tray) { const m = await useTray.getState().asMedia(tray); return [{ filename: m.name, subfolder: "", type: "input" as const }]; }
    const url = droppedUrl(dt);
    if (url) { const m = await useTray.getState().addUrl(url); return [{ filename: m.name, subfolder: "", type: "input" as const }]; }
    return [];
  };
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <div className="flex items-center"><span className="lbl">Your recipes</span><button onClick={() => editRecipe()} className="ml-auto flex items-center gap-1 text-[12.5px] text-accent hover:underline"><Icon name="plus" size={12} /> New</button></div>
      <p className="-mt-1 text-[12px] leading-relaxed text-dim">The same steps on many pictures. Drop pictures on a recipe (files, results, or straight from a web tab){who ? <> — it runs with <b className="font-medium text-muted">{who}</b></> : ""}.</p>
      {list.map((r) => (
        <div key={r.id} onDragOver={(e) => { e.preventDefault(); setOver(r.id); }} onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); setOver(null); const dt = e.dataTransfer; go(r, () => fromDrop(dt)); }}
          className={cx("group flex flex-col gap-1 border px-3 py-2", over === r.id ? "border-accent bg-accent/10" : "border-line")}>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{r.name}</span>
            <button onClick={() => editRecipe(r)} className="text-[12px] text-muted hover:text-ink">Edit</button>
            <button disabled={busy === r.id} onClick={() => { forId.current = r.id; files.current?.click(); }} className="text-[12px] text-accent hover:underline disabled:opacity-50">{busy === r.id ? "Adding…" : "Run on files…"}</button>
          </div>
          <span className="truncate text-[11.5px] text-dim">{r.steps.map((s) => stepLabel(s, who ?? "them")).join(" → ")}</span>
        </div>
      ))}
      <input ref={files} type="file" multiple accept="image/*" className="hidden" onChange={(e) => {
        const r = list.find((x) => x.id === forId.current); const fs = e.target.files;
        if (r) go(r, () => fromFiles(fs)); e.target.value = "";
      }} />
      <RecipeRuns />
    </div>
  );
}

/** "Run a recipe" for picked pictures: a small list, plus New recipe */
export function RecipeMenu({ pics, tab, onDone }: { pics: FileRef[]; tab: Tab; onDone: () => void }) {
  const { list, load } = useRecipes();
  const toast = useJobs((s) => s.toast);
  const who = useCharacters((s) => s.list.find((x) => x.id === s.sel)?.name);
  useEffect(() => { load(); }, [load]);
  return (
    <div role="menu" className="fade-in max-h-[min(460px,60vh)] w-80 overflow-y-auto border border-line bg-raised2 py-1 shadow-2xl">
      {list.map((r) => (
        <button key={r.id} role="menuitem" onClick={() => {
          onDone();
          toast(`${r.name}: started on ${pics.length} picture${pics.length > 1 ? "s" : ""}`, "info", tab);
          runRecipe(r, pics, tab).catch((e) => toast((e as Error).message, "bad", tab));
        }} className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-hover">
          <span className="text-[13px] text-ink">{r.name}</span>
          <span className="truncate text-[11.5px] text-dim">{r.steps.map((s) => stepLabel(s, who ?? "them")).join(" → ")}</span>
        </button>
      ))}
      <button role="menuitem" onClick={() => { onDone(); editRecipe(undefined, pics, tab); }} className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-[13px] text-accent hover:bg-hover"><Icon name="plus" size={13} /> New recipe for these {pics.length}…</button>
    </div>
  );
}
