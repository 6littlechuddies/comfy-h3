// How a CivitAI picture or video was made — prompt, settings, every resource used — with one-click
// "Send to Animate", "Use in Create" and "Plan in Prompt". Used in the LoRA browser and the link importer.
import { Fragment, useEffect, useState } from "react";
import { saveWorkflow, type CivitGen, type CivitResource } from "../lib/api";
import { genMedia, cleanPrompt, createTargetOf, targetFamily, ensureLoras, genAsText, genClipWithCharacter, genStyleToCreate, genSwap, genToAnimate, genToCreate, genToPrompt, lorasFor, type SwapMode } from "../lib/civitUse";
import { useDownloads } from "../lib/downloads";
import { isAdult, useCharacters } from "../lib/characters";
import { PromptPieces, useRewriteMenu } from "./PromptPieces";
import { useJobs } from "../lib/jobs";
import { useSettings } from "../lib/settings";
import { Icon, cx, DropSelect, saveLoraSet } from "./ui";
import { askText } from "./Dialogs";
import { create } from "zustand";
import { copyText } from "../lib/copy";
import { useWordBank } from "../lib/wordbank";

/** why the CivitAI window was opened: to pick a picture for a new character, or for a character's own front picture */
export type PickPurpose = { kind: "new" } | { kind: "front"; id: string; name: string } | { kind: "ref"; slot: "pic2" | "place" } | { kind: "edit"; slot: "1" | "2" | "place" } | { kind: "swap"; id: string; name: string } | null;
export const usePickPurpose = create<{ p: PickPurpose }>(() => ({ p: null }));

const FAM: Record<string, string> = { anima: "ANIMA", sdxl: "ILLUSTRIOUS", krea2: "KREA 2", qwen: "QWEN", h3: "H3 VIDEO", video: "VIDEO", other: "OTHER", unknown: "?" };
const KIND: Record<string, string> = { checkpoint: "MODEL", lora: "LORA", embedding: "EMBED" };
const show = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));

type Dest = "animate" | "create" | "prompt" | "edit" | "characters";
export function GenData({ gen: original, loading, onDone }: { gen: CivitGen; loading?: boolean; onDone: (tab: Dest) => void }) {
  // your edits to the prompt (pieces / plain text) are what every button uses
  const startPrompt = cleanPrompt(original.prompt || original.workflow?.prompt || "");
  const [edited, setEdited] = useState(startPrompt);
  useEffect(() => setEdited(startPrompt), [original.id, startPrompt]); // eslint-disable-line react-hooks/exhaustive-deps
  // its words go into the word bank (Create → Word bank), for every project
  useEffect(() => { if (!loading && startPrompt) useWordBank.getState().add(original); }, [original.id, startPrompt, loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const gen: CivitGen = { ...original, prompt: edited };
  const [view, setView] = useState<"pieces" | "text">("pieces");
  const toast = useJobs((s) => s.toast);
  const [showNeg, setShowNeg] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [media, setMedia] = useState<boolean>(gen.video);
  const [busy, setBusy] = useState<string | null>(null);
  const [prog, setProg] = useState<Record<string, number>>({});
  const onEach = (r: CivitResource, p: number) => setProg((x) => ({ ...x, [String(r.version_id ?? r.name)]: p }));
  const [, bump] = useState(0);
  const copy = (text: string, what: string) => copyText(text, `${what} copied`);

  const videoLoras = lorasFor(gen, "h3");
  const ct = createTargetOf(gen);
  const ctLabel = { anima: "Anima", noob: "Illustrious", krea2: "Krea 2", krea2raw: "Krea 2 RAW" }[ct];
  const createLoras = lorasFor(gen, targetFamily(ct));
  const prompt = edited;
  const other = gen.resources.filter((r) => r.kind === "lora" && !videoLoras.includes(r) && !createLoras.includes(r));

  const act = async (what: "animate" | "create" | "prompt") => {
    if (busy) return;
    setBusy("Starting…");
    try {
      let failed: string[] = [];
      if (what === "animate") failed = (await genToAnimate(gen, { media, loras: videoLoras }, setBusy)).failed;
      else if (what === "create") failed = (await genToCreate(gen, setBusy)).failed;
      else await genToPrompt(gen, media, setBusy);
      toast(what === "animate" ? `Sent to Animate: the prompt${videoLoras.length - failed.length > 0 ? `, ${videoLoras.length - failed.length} video LoRA${videoLoras.length - failed.length > 1 ? "s" : ""}` : ""}${media ? `, and the ${gen.video ? "clip" : "picture"} as <${gen.video ? "Video" : "Picture"}>` : ""}.`
        : what === "create" ? `Set up in Create (${ctLabel}, Exact prompt) with its settings — press Generate.` : "Sent to Prompt — press Write timeline.", "good");
      if (failed.length) toast(`Couldn't add: ${failed.join("; ")}`, "bad");
      onDone(what);
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(null); }
  };
  const addOne = async (r: CivitResource) => {
    setBusy(`Adding`);
    try { const { failed } = await ensureLoras([r], undefined, onEach); if (failed.length) toast(failed[0], "bad"); else toast(`Added “${r.name}” to your library`, "good"); bump((n) => n + 1); }
    finally { setBusy(null); }
  };

  // every LoRA the picture used that isn't in your library yet, whatever model family it was made for
  const todo = gen.resources.filter((r) => r.kind === "lora" && !r.installed && r.model_id && r.version_id);
  const addAll = async () => {
    if (busy || !todo.length) return;
    setBusy(`Adding ${todo.length} LoRA${todo.length > 1 ? "s" : ""}…`);
    try {
      const { failed } = await ensureLoras(todo, undefined, onEach);
      const ok = todo.length - failed.length;
      if (ok) toast(`Added ${ok} LoRA${ok > 1 ? "s" : ""} to your library`, "good");
      if (failed.length) toast(`Couldn't add: ${failed.join("; ")}`, "bad");
      bump((n) => n + 1);
    } finally { setBusy(null); }
  };

  // every LoRA it used, downloaded, kept as a LoRA preset per model (Krea 2 / Anima / Illustrious / H3) — like a playlist
  const allLoras = gen.resources.filter((r) => r.kind === "lora" && (r.installed || (r.model_id && r.version_id)));
  const savePreset = async () => {
    if (busy || !allLoras.length) return;
    const name = await askText("Name this LoRA preset", `${gen.username ? `${gen.username} · ` : ""}${gen.base || "CivitAI"} ${gen.id ?? ""}`.trim(), "Save preset");
    if (!name?.trim()) return;
    setBusy(`Adding ${allLoras.length} LoRA${allLoras.length > 1 ? "s" : ""}…`);
    try {
      const { picks, failed } = await ensureLoras(allLoras, undefined, onEach);
      const byFam: Record<string, typeof picks> = {};
      allLoras.forEach((r) => { const p = picks.find((x) => x.name === r.installed); if (p) (byFam[r.family || "other"] ??= []).push(p); });
      const fams = Object.keys(byFam).filter((f) => f !== "other" && f !== "unknown");
      for (const f of fams) await saveLoraSet(f, fams.length > 1 ? `${name.trim()} (${FAM[f] ?? f})` : name.trim(), byFam[f]);
      if (fams.length) toast(`Saved “${name.trim()}” — ${fams.map((f) => `${byFam[f].length} ${FAM[f] ?? f}`).join(", ")} LoRA${picks.length > 1 ? "s" : ""}. Pick it from “LoRA presets” above any LoRA list.`, "good");
      else toast("None of its LoRAs are for a model the Studio runs", "bad");
      if (failed.length) toast(`Couldn't add: ${failed.join("; ")}`, "bad");
      bump((n) => n + 1);
    } finally { setBusy(null); }
  };

  // opened to make pictures (not from Animate / Prompt): "with your character" goes on top and Animate becomes a plain button
  const pictureFirst = !gen.video && !["animate", "prompt"].includes(useSettings.getState().s.tab);
  const animateBtn = (
    <button onClick={() => act("animate")} disabled={!!busy || !prompt}
      className={cx("press flex items-center justify-center gap-2 font-bold disabled:opacity-50", pictureFirst ? "btn-raised h-9 text-[12.5px]" : "chamfer btn-hot h-11 text-[14px]")}>
      <Icon name="film" size={pictureFirst ? 13 : 15} />{busy && !pictureFirst ? busy : "Send to Animate"}
    </button>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className={cx("flex flex-wrap items-center gap-1.5 text-[12px] text-muted", pictureFirst && "order-[-2]")}>
        {gen.base && <span className="micro border border-line px-1.5 py-0.5 text-ink" title="Base model">{gen.base}</span>}
        {gen.process && gen.page && <span className="micro text-dim">{gen.process}</span>}
        {gen.comfy && gen.page && <span className="micro text-dim" title="Made in ComfyUI">COMFY</span>}
        {gen.username && <span>by <b className="font-semibold text-ink">{gen.username}</b></span>}
        {gen.page ? <a href={gen.page} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-muted hover:text-ink">CivitAI<Icon name="external" size={12} /></a>
          : <span className="micro ml-auto text-dim">{gen.process === "a1111" ? "A1111 / FORGE METADATA" : gen.process === "comfyui" ? "COMFYUI METADATA" : "YOUR FILE"}</span>}
      </div>

      {prompt || startPrompt ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="micro text-dim">PROMPT{edited !== startPrompt ? " · EDITED" : ""}</span>
            <div className="ml-auto flex items-center gap-2">
              {(["pieces", "text"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={cx("micro", view === v ? "text-accent" : "text-dim hover:text-ink")}>{v === "pieces" ? "PIECES" : "TEXT"}</button>)}
              {edited !== startPrompt && <button className="micro text-dim hover:text-ink" onClick={() => setEdited(startPrompt)}>RESET</button>}
              <button onClick={() => copy(prompt, "Prompt")} className="micro text-muted hover:text-ink">COPY</button>
            </div>
          </div>
          {view === "pieces"
            ? <div className="max-h-72 overflow-y-auto border border-line p-2"><PromptPieces value={edited} onChange={setEdited} tab={gen.video ? "animate" : "create"} onUse={gen.video ? undefined : USE_PIECES} /></div>
            : <TextRewrite value={edited} onChange={setEdited} tab={gen.video ? "animate" : "create"} />}
          <p className="text-[11px] text-dim">{view === "pieces" ? "Click pieces to select (shift for more), right-click to change them in plain words, double-click to edit." : "Highlight a part and right-click to change it in plain words."}</p>
        </div>
      ) : <p className="text-[12.5px] text-muted">{loading ? "Reading how it was made…" : "No prompt was shared for this one."}</p>}
      {gen.negative && (
        <div>
          <button className="text-[12px] text-muted hover:text-ink" onClick={() => setShowNeg((s) => !s)}>{showNeg ? "▾" : "▸"} Negative prompt</button>
          {showNeg && <p className="mt-1 max-h-28 overflow-y-auto font-mono text-[11.5px] leading-relaxed text-muted">{cleanPrompt(gen.negative)}</p>}
        </div>
      )}

      <dl className="grid grid-cols-3 gap-px border border-line bg-line text-[12px]">
        {([["SAMPLER", gen.sampler], ["SCHEDULER", gen.scheduler], ["STEPS", gen.steps], ["CFG", gen.cfg], ["SEED", gen.seed], ["SIZE", gen.size]] as const).map(([k, val]) => (
          <div key={k} className="bg-panel px-2.5 py-1.5"><dt className="micro text-dim">{k}</dt><dd className="mt-0.5 truncate font-mono text-[11.5px] text-ink" title={show(val)}>{show(val)}</dd></div>
        ))}
      </dl>
      {Object.keys(gen.more).length > 0 && (
        <div>
          <button className="text-[12px] text-muted hover:text-ink" onClick={() => setShowMore((s) => !s)}>{showMore ? "▾" : "▸"} {Object.keys(gen.more).length} more settings</button>
          {showMore && <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">{Object.entries(gen.more).map(([k, v]) => <Fragment key={k}><dt className="text-dim">{k}</dt><dd className="truncate font-mono text-ink/90" title={String(v)}>{String(v)}</dd></Fragment>)}</dl>}
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center"><span className="micro text-dim">RESOURCES USED · {String(gen.resources.length).padStart(2, "0")}</span>
          {loading ? <span className="micro ml-auto text-dim">LOADING…</span>
            : todo.length > 0 && <button disabled={!!busy} onClick={addAll} title="Download every LoRA this picture used, so you can copy its exact look"
              className="press ml-auto border border-line px-2 py-1 text-[11.5px] font-semibold text-ink hover:border-accent disabled:opacity-40">{busy?.startsWith("Adding") ? "Adding…" : `Add all LoRAs · ${todo.length}`}</button>}
          {!loading && allLoras.length > 0 && <button disabled={!!busy} onClick={savePreset} title="Download its LoRAs and keep them together, with their strengths, as a LoRA preset you can switch to in one click"
            className={cx("press border border-accent/60 px-2 py-1 text-[11.5px] font-semibold text-accent hover:bg-accent/10 disabled:opacity-40", todo.length === 0 && "ml-auto", todo.length > 0 && "ml-1.5")}>Save as LoRA preset</button>}</div>
        {gen.resources.length === 0 && !loading && <p className="text-[12px] text-dim">CivitAI doesn't list the resources for this one.</p>}
        <ul className="flex flex-col gap-px border border-line bg-line">
          {gen.resources.map((r) => (
            <li key={`${r.version_id ?? r.name}`} className="relative flex items-center gap-2 bg-panel px-2.5 py-2">
              {prog[String(r.version_id ?? r.name)] != null && prog[String(r.version_id ?? r.name)] >= 0 && prog[String(r.version_id ?? r.name)] < 1 && (
                <span className="absolute inset-x-0 bottom-0 h-[3px] bg-raised2"><span className="block h-full bg-good transition-[width] duration-300" style={{ width: `${Math.max(3, prog[String(r.version_id ?? r.name)] * 100)}%` }} /></span>)}
              <span className={cx("micro w-[46px] shrink-0", r.kind === "lora" ? "text-accent" : "text-dim")}>{KIND[r.kind] ?? r.kind.toUpperCase().slice(0, 6)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-ink" title={`${r.name} ${r.version}`}>{r.name}{r.version && <span className="ml-1 font-normal text-dim">{r.version}</span>}</div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className={cx("micro", r.family === "h3" ? "text-cyan" : videoLoras.includes(r) || createLoras.includes(r) ? "text-muted" : "text-dim")}>{FAM[r.family] ?? r.base}</span>
                  {r.weight != null && r.kind === "lora" && <span className="font-mono text-muted">@ {r.weight}</span>}
                  {r.trigger && r.kind === "lora" && <span className="truncate font-mono text-accent/80" title={`Trigger words: ${r.trigger}`}>› {r.trigger}</span>}
                </div>
              </div>
              {r.kind === "lora" && (r.installed
                ? <span className="micro shrink-0 text-good" title={r.installed}>✓ LIBRARY</span>
                : r.model_id && r.version_id ? <button disabled={!!busy} onClick={() => addOne(r)} className="press shrink-0 border border-line px-2 py-1 text-[11.5px] font-semibold text-ink hover:border-accent disabled:opacity-40">Add</button> : null)}
              {r.model_id && <a href={`https://civitai.com/models/${r.model_id}${r.version_id ? `?modelVersionId=${r.version_id}` : ""}`} target="_blank" rel="noreferrer" aria-label={`${r.name} on CivitAI`} className="shrink-0 text-dim hover:text-ink"><Icon name="external" size={12} /></a>}
            </li>
          ))}
        </ul>
      </div>

      {gen.workflow && <WorkflowView gen={gen} />}

      <div className={cx("flex flex-col gap-2", pictureFirst ? "order-[-1] border-b border-line pb-3" : "border-t border-line pt-3")}>
        {!gen.video && <PickFor gen={gen} busy={busy} setBusy={setBusy} onDone={onDone} />}
        {pictureFirst && <WithCharacter gen={gen} busy={busy} setBusy={setBusy} onDone={onDone} />}
        {animateBtn}
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          <input type="checkbox" checked={media} onChange={(e) => setMedia(e.target.checked)} />
          Also add the {gen.video ? "clip as a reference (copy its moves and camera)" : "picture as a reference"}
        </label>
        <p className="text-[11.5px] leading-relaxed text-dim">
          {videoLoras.length ? `Brings its video LoRA${videoLoras.length > 1 ? "s" : ""} along: ${videoLoras.map((r) => r.name).join(", ")} (added to your library if needed).`
            : "None of its LoRAs are for H3 video — the prompt comes along on its own."}
          {other.length > 0 && ` Left out (made for ${[...new Set(other.map((r) => r.base || "another model"))].join(", ")}): ${other.map((r) => r.name).join(", ")}.`}
        </p>
        {!pictureFirst && <WithCharacter gen={gen} busy={busy} setBusy={setBusy} onDone={onDone} />}
        {!gen.video && <button disabled={!!busy} onClick={async () => {
          setBusy("Copying the picture…");
          try {
            const m = await genMedia(gen);
            const [{ useNewFromPicture }, { useCharacters }, { useSettings }] = await Promise.all([import("../tabs/Characters"), import("../lib/characters"), import("../lib/settings")]);
            useCharacters.getState().select(null);
            useNewFromPicture.setState({ pic: m });
            useSettings.getState().setTab("characters");
            toast("On the right: name them and press Read the picture — they get their own project.", "good");
            onDone("characters");
          } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(null); }
        }} title="Their own project, so this doesn't mix into the character you're on" className="press btn-raised flex h-9 items-center justify-center gap-1.5 text-[12.5px] font-medium disabled:opacity-40"><Icon name="user" size={13} />New character (own project) from this picture</button>}
        <div className="grid grid-cols-2 gap-1.5">
          <button disabled={!!busy || !prompt || gen.video} onClick={async () => {
            setBusy("Copying the style…");
            try { const r = await genStyleToCreate(gen, setBusy); toast(r.words ? `Its style is in Create: “${r.words.slice(0, 80)}${r.words.length > 80 ? "…" : ""}” + its settings and LoRAs. Pick your character and press Generate.` : "Its settings and LoRAs are in Create (no style words found in the prompt).", "good"); if (r.failed.length) toast(`Couldn't add: ${r.failed.join("; ")}`, "bad"); onDone("create"); }
            catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(null); }
          }} title="Only its lighting, camera and style words + settings + LoRAs — your own subject and character stay" className="press btn-raised h-9 px-2 text-[12.5px] font-medium disabled:opacity-40">Copy style → Create</button>
          <button onClick={() => act("create")} disabled={!!busy || !prompt || gen.video} title={gen.video ? "This one is a video" : `Exact prompt + its settings + ${createLoras.length} LoRA(s) in Create · ${ctLabel}`}
            className="press btn-raised h-9 px-2 text-[12.5px] font-medium disabled:opacity-40">Whole prompt → Create · {ctLabel}</button>
          <button onClick={() => act("prompt")} disabled={!!busy || !prompt} title="Use it as the idea in the Prompt helper, which writes an H3 timeline"
            className="press btn-raised h-9 px-2 text-[12.5px] font-medium disabled:opacity-40">Plan in Prompt</button>
          <button onClick={() => copy(genAsText(gen), "Everything")} className="press btn-raised h-9 px-2 text-[12.5px] font-medium">Copy all</button>
        </div>
      </div>
    </div>
  );
}

/** go to a tab after GenData set it up */
export const openTab = (tab: Dest) => useSettings.getState().setTab(tab);

/** what's inside its ComfyUI workflow, and a button to open it in the node editor */
function WorkflowView({ gen }: { gen: CivitGen }) {
  const wf = gen.workflow!;
  const toast = useJobs((s) => s.toast);
  const [nodes, setNodes] = useState(false);
  const open = async () => {
    try {
      const r = await saveWorkflow({ key: gen.workflow_key, civitai_id: gen.id || undefined, name: gen.id ? `civitai_${gen.id}` : `file_${(gen.local?.name ?? "workflow").replace(/\.[^.]+$/, "")}` });
      window.open("/", "_blank");
      toast(`Saved as “${r.name}” — find it in ComfyUI's Workflows list (left sidebar).${r.format === "api" ? " It was stored as an API graph, so the layout is automatic." : ""}`, "good");
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  const settings = Object.entries(wf.settings);
  return (
    <div className="flex flex-col gap-2 border border-line px-2.5 py-2.5">
      <div className="flex items-center gap-2"><span className="micro text-cyan">COMFYUI WORKFLOW · {wf.nodes.length} NODES</span>
        <button onClick={open} className="press btn-raised ml-auto h-7 px-2.5 text-[12px] font-medium">Open in ComfyUI</button></div>
      {wf.models.length > 0 && <p className="text-[11.5px] text-muted"><span className="micro mr-1 text-dim">MODELS</span>{[...new Set(wf.models.map((m) => m.name))].join(" · ")}</p>}
      {wf.loras.length > 0 && <p className="text-[11.5px] text-muted"><span className="micro mr-1 text-dim">LORAS</span>{wf.loras.map((l) => `${l.name.replace(/\.safetensors$/, "")}${l.weight != null ? ` @ ${l.weight}` : ""}`).join(" · ")}</p>}
      {settings.length > 0 && <p className="font-mono text-[11px] text-muted">{settings.map(([k, v]) => `${k} ${v}`).join(" · ")}</p>}
      <button className="text-left text-[11.5px] text-muted hover:text-ink" onClick={() => setNodes((n) => !n)}>{nodes ? "▾" : "▸"} Every node</button>
      {nodes && (
        <ul className="max-h-56 overflow-y-auto font-mono text-[11px] leading-relaxed">
          {wf.nodes.map((n) => <li key={n.id} className="truncate text-ink/85" title={JSON.stringify(n.values)}><span className="text-accent">{n.title}</span> <span className="text-dim">{Object.entries(n.values).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(" ")}</span></li>)}
        </ul>
      )}
    </div>
  );
}

/** plain-text view of the prompt with right-click "Change this part" */
function TextRewrite({ value, onChange, tab }: { value: string; onChange: (v: string) => void; tab: "animate" | "create" }) {
  const rw = useRewriteMenu(tab, value, onChange);
  return <>
    <textarea value={value} onChange={(e) => onChange(e.target.value)} onContextMenu={rw.onContextMenu} rows={6} spellCheck={false}
      className="inset w-full resize-y border border-line p-2.5 font-mono text-[12px] leading-relaxed selection:bg-hot/40 focus:border-accent focus:outline-none" />
    {rw.menu}
  </>;
}

/** put one of your saved characters into this picture / clip */
function WithCharacter({ gen, busy, setBusy, onDone }: { gen: CivitGen; busy: string | null; setBusy: (s: string | null) => void; onDone: (tab: Dest) => void }) {
  const chars = useCharacters((s) => s.list).filter((c) => isAdult(c) && c.views.front);
  const toast = useJobs((s) => s.toast);
  const qwen = useDownloads((s) => s.groups.find((g) => g.id === "qwen"));
  const [id, setId] = useState<string>("");
  const [mode, setMode] = useState<SwapMode>("swap");
  const [outfit, setOutfit] = useState<"theirs" | "picture">("theirs");
  const [who, setWho] = useState("");
  const c = chars.find((x) => x.id === id) ?? chars[0];
  if (!chars.length) return <p className="border border-dashed border-line px-2.5 py-2 text-[11.5px] text-dim">Make a character in Characters (with a front picture) to put them into posts like this one.</p>;
  const qwenReady = !qwen || qwen.state === "done";
  const go = async () => {
    if (!c || busy) return;
    setBusy("Starting…");
    try {
      if (gen.video) { await genClipWithCharacter(gen, c, setBusy); toast(`In Prompt: ${c.name}'s pictures + the clip. Press Write timeline (or Read the clip first), then Send to Animate.`, "good"); onDone("prompt"); }
      else {
        const tab = await genSwap(gen, c, { mode, outfit, who }, setBusy);
        toast(mode === "swap" ? (tab === "edit" ? `Swapping ${c.name} in — follow it in Edit.` : `Putting ${c.name} in — it's in Create with both pictures.`)
          : mode === "remake" ? `Its prompt with ${c.name} in it is in Create (exact prompt) and making pictures — change the words and press Generate for more.`
          : `${c.name} in that pose is in Create (exact prompt) and making pictures.`, "good");
        onDone(tab);
      }
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(null); }
  };
  const MODES: [SwapMode, string, string][] = [
    ["swap", "Swap into it", qwenReady ? "the person becomes yours — pose, framing, light and place stay (Qwen + Krea, face check)" : "the person becomes yours — only their outline is redrawn, so no second person appears"],
    ["remake", "Remake with words", "its prompt with your character in it → a new picture from text, with their LoRA"],
    ["pose", "Only the pose", "the pose read limb by limb → your character in it, from text"],
  ];
  return (
    <div className="flex flex-col gap-2 border border-line bg-raised/40 px-2.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="micro text-accent">WITH YOUR CHARACTER</span>
        <DropSelect value={c?.id} onChange={(e) => setId(e.target.value)} aria-label="Character" className="inset ml-auto h-7 border border-line px-1.5 text-[12px]">
          {chars.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </DropSelect>
      </div>
      {!gen.video && (
        <div className="grid grid-cols-3 gap-1">
          {MODES.map(([v, label, sub]) => (
            <button key={v} onClick={() => setMode(v)} className={cx("press border px-2 py-1.5 text-left", mode === v ? "border-accent bg-accent/10" : "border-line hover:border-muted")}>
              <span className="block text-[12px] font-semibold">{label}</span><span className="block text-[10.5px] leading-snug text-dim">{sub}</span>
            </button>
          ))}
        </div>
      )}
      {!gen.video && mode !== "pose" && (
        <div className="flex items-center gap-3 text-[12px] text-muted">
          <label className="flex items-center gap-1.5"><input type="radio" checked={outfit === "theirs"} onChange={() => setOutfit("theirs")} />{c?.name}'s outfit</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={outfit === "picture"} onChange={() => setOutfit("picture")} />the picture's outfit</label>
        </div>
      )}
      {!gen.video && <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Which person, if there are several (optional) — e.g. the woman on the left"
        className="inset h-7 border border-line px-2 text-[12px] focus:border-accent focus:outline-none" aria-label="Which person" />}
      <button onClick={go} disabled={!!busy || !c} className="press chamfer-sm btn-primary h-9 text-[13px] font-bold disabled:opacity-40">
        {gen.video ? `${c?.name} performs this clip →` : mode === "swap" ? `Swap ${c?.name} in` : mode === "remake" ? `Remake it with ${c?.name}` : `${c?.name} in this pose`}
      </button>
      {!gen.video && mode === "swap" && !qwenReady && <p className="text-[10.5px] leading-snug text-dim">The best swap uses the Edit chat helper (Qwen-Image-Edit) — it's still downloading{qwen?.state === "downloading" ? ` (${qwen.pct}%)` : ""}. Until then only the person's outline is redrawn.</p>}
      {gen.video && <p className="text-[10.5px] leading-snug text-dim">Their full-body and face pictures + the clip go to Prompt, which writes an H3 timeline with them in it.</p>}
    </div>
  );
}

/** opened from Characters to pick a picture: the one button that does it, on top */
function PickFor({ gen, busy, setBusy, onDone }: { gen: CivitGen; busy: string | null; setBusy: (s: string | null) => void; onDone: (tab: Dest) => void }) {
  const p = usePickPurpose((s) => s.p);
  const toast = useJobs((s) => s.toast);
  if (!p) return null;
  const go = async () => {
    setBusy("Copying the picture…");
    try {
      if (p.kind === "swap") {
        const c = useCharacters.getState().list.find((x) => x.id === p.id);
        if (!c) throw new Error("That character is gone");
        usePickPurpose.setState({ p: null });
        onDone(await genSwap(gen, c, { mode: "swap", outfit: "theirs", who: "" }, setBusy));
        return;
      }
      const m = await genMedia(gen);
      if (p.kind === "ref") {
        const { useMakeRefs } = await import("../lib/make");
        useMakeRefs.setState(p.slot === "pic2" ? { pic2: m, remixOf: null, remixBase: null } : { place: m });
        toast(p.slot === "pic2" ? "It's picture 2 in Create — its prompt comes along (Remake with words uses it)." : "It's the place picture in Create.", "good");
        usePickPurpose.setState({ p: null });
        onDone("create");
        return;
      }
      if (p.kind === "edit") {
        const { putInEdit } = await import("../lib/editPick");
        putInEdit(m, p.slot);
        toast(p.slot === "place" ? "It's the place picture in Edit." : `It's picture ${p.slot} in Edit.`, "good");
        usePickPurpose.setState({ p: null });
        onDone("edit");
        return;
      }
      if (p.kind === "front") {
        await useCharacters.getState().setView(p.id, "front", { filename: m.name, subfolder: "", type: "input" }, { yours: true });
        toast(`${p.name}'s picture is in — the sheet, scenes and edits copy it from now on.`, "good");
      } else {
        const [{ useNewFromPicture }] = await Promise.all([import("../tabs/Characters")]);
        useCharacters.getState().select(null);
        useNewFromPicture.setState({ pic: m });
        toast("On the right: name them and press Read the picture.", "good");
      }
      usePickPurpose.setState({ p: null });
      onDone("characters");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(null); }
  };
  return (
    <div className="flex flex-col gap-1 border border-accent/70 bg-accent/10 p-2">
      <button onClick={go} disabled={!!busy} className="press chamfer btn-primary flex h-11 items-center justify-center gap-2 text-[14px] font-bold disabled:opacity-50">
        <Icon name={p.kind === "ref" || p.kind === "edit" ? "image" : "user"} size={15} />{p.kind === "swap" ? `Swap ${p.name} into this picture` : p.kind === "ref" ? (p.slot === "pic2" ? "Use as picture 2 in Create" : "Use as the place in Create") : p.kind === "edit" ? (p.slot === "place" ? "Use as the place in Edit" : `Use as picture ${p.slot} in Edit`) : p.kind === "front" ? `Use as ${p.name}'s picture` : "Use for the new character"}
      </button>
      <button className="text-[11px] text-muted hover:text-ink" onClick={() => usePickPurpose.setState({ p: null })}>{p.kind === "swap" ? `Not swapping ${p.name} in any more` : p.kind === "ref" ? "Not picking for Create any more" : p.kind === "edit" ? "Not picking for Edit any more" : "Not picking for a character any more"}</button>
    </div>
  );
}

/** "only its lighting / pose / background": the pieces you select go into your own prompt, and the writer blends them in */
const USE_PIECES: { label: string; run: (text: string, cats: string[]) => void }[] = [
  { label: "Add to Create", run: async (text, cats) => {
    const [{ useSettings }, { useJobs }] = await Promise.all([import("../lib/settings"), import("../lib/jobs")]);
    const cur = (useSettings.getState().s.create.extra ?? "").trim();
    const what = cats.filter((c) => c !== "other").join(", ") || "these details";
    useSettings.getState().set("create", { raw: false, extra: `${cur ? `${cur.replace(/\.?$/, ".")} ` : ""}Use the ${what} from this: ${text.replace(/\.?$/, ".")}` });
    useJobs.getState().toast(`Added to Create's box (${what}) — your character and words stay; the writer blends it in when you generate.`, "good");
  } },
  { label: "Add to my poses", run: async (text) => {
    const [{ useInspo, setFor }, { useJobs }] = await Promise.all([import("../lib/inspo"), import("../lib/jobs")]);
    const id = setFor("pose");
    useInspo.getState().add(id, { text });
    useJobs.getState().toast(`Pose saved to “${useInspo.getState().sets.find((x) => x.id === id)?.name}” — Batch → Content plan uses it.`, "good");
  } },
  { label: "Save as scene", run: async (text) => {
    const [{ useInspo, setFor }, { useJobs }] = await Promise.all([import("../lib/inspo"), import("../lib/jobs")]);
    const id = setFor("scene");
    useInspo.getState().add(id, { text });
    useJobs.getState().toast(`Scene saved to “${useInspo.getState().sets.find((x) => x.id === id)?.name}” — Batch → Content plan → Scenes.`, "good");
  } },
  { label: "Add to Edit chat", run: async (text) => {
    const [{ putWordsInEdit }, { useJobs }] = await Promise.all([import("../lib/editPick"), import("../lib/jobs")]);
    putWordsInEdit(text);
    useJobs.getState().toast("Added to Edit chat's message box.", "good");
  } },
];
