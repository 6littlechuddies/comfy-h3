import { BUILT } from "./lib/selfcheck";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { create } from "zustand";
import { askCivitKey, CIVIT_IMAGE_LINK, COLLECTION_LINK, civitKeyStatus, getCost, getStatus, uploadLoraWithToast, type Cost, type InstanceStatus } from "./lib/api";
import { useJobs, type Tab } from "./lib/jobs";
import { modelOf, useSettings } from "./lib/settings";
import { DRAG_TYPE, trayUrl, useTray, type TrayItem } from "./lib/tray";
import { CHAR_DRAG, useCharDrag } from "./components/ProjectRail";
import { setProjectFolder, setProjectSource, TESTING } from "./lib/jobs";
import { useMakeRefs } from "./lib/make";
import { Btn, Icon, MediaView, Seg, cx } from "./components/ui";
import CreateTab from "./tabs/Create";
import EditTab from "./tabs/Edit";
import PromptTab from "./tabs/Prompt";
import AnimateTab from "./tabs/Animate";
import FinishTab from "./tabs/Finish";
import BatchTab from "./tabs/Batch";
import CharactersTab from "./tabs/Characters";
import { GuideBanner, RECIPES, RecipesButton, applyRecipe } from "./components/Recipes";
import { SelectionBar } from "./components/SelectionBar";
import { RecipeEditorHost, editRecipe } from "./components/MyRecipes";
import { useRecipes } from "./lib/recipes";
import { OutsideHost } from "./components/OutsideHost";
import { AskHost, SweepHost, Palette, ShortcutSheet, usePalette, useShortcuts, type Command } from "./components/Dialogs";
import { importCharacters, useCharacters } from "./lib/characters";
import { viewUrl } from "./lib/api";
import { ImportCard } from "./components/ImportCard";
import { CatalogHost, openCatalog } from "./components/Catalog";
import { setHistoryProject } from "./lib/promptHistory";
import { useImport } from "./lib/importer";
import { LoraBrowser, openLoraBrowser } from "./components/LoraBrowser";
import { dropPacks, STAGE_INFO } from "./lib/packs";
import ScenesTab from "./tabs/Scenes";
import { ImageImport, openFileMeta, openImageImport } from "./components/ImageImport";
import { PictureMenuHost } from "./components/PictureMenu";
import { ProjectRail } from "./components/ProjectRail";
import { Assistant, AssistantButton } from "./components/Assistant";
import { useBatch } from "./lib/batch";
import { SelfCheck, openSelfCheck } from "./components/SelfCheck";
import { SiteLink, openSiteLink } from "./components/SiteLink";
import { Viewer, openViewer, type ViewItem } from "./components/Viewer";
import { setLater, useDownloads, type Group } from "./lib/downloads";
import { getHttpsLink } from "./lib/api";
import { isFav, useFavs } from "./lib/favs";

/** Ctrl/Cmd+Enter runs the visible tab's main button */
export const usePrimary = create<{ fns: Partial<Record<Tab, () => void>> }>(() => ({ fns: {} }));
export function usePrimaryAction(tab: Tab, fn: (() => void) | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    usePrimary.setState((s) => ({ fns: { ...s.fns, [tab]: () => ref.current?.() } }));
  }, [tab]);
}

/** cross-tab hand-offs ("Animate this", "Use in Edit" …) */
export const useHandoff = create<{ pending: Partial<Record<Tab, { id: string; slot?: string }[]>> }>(() => ({ pending: {} }));
type Desk = { extra: string; pose: string; pic2: ReturnType<typeof useMakeRefs.getState>["pic2"]; place?: ReturnType<typeof useMakeRefs.getState>["place"]; remixOf: ReturnType<typeof useMakeRefs.getState>["remixOf"] };
const deskKey = (id: string | null) => `h3.desk.${id ?? "free"}`;
function saveDesk(id: string | null, d: Desk) { try { localStorage.setItem(deskKey(id), JSON.stringify(d)); } catch { /* private mode */ } }
function loadDesk(id: string | null): Desk | null { try { return JSON.parse(localStorage.getItem(deskKey(id)) || "null"); } catch { return null; } }

export function sendTo(tab: Tab, trayIds: string[], slot?: string) {
  useHandoff.setState((s) => ({ pending: { ...s.pending, [tab]: [...(s.pending[tab] ?? []), ...trayIds.map((id) => ({ id, slot }))] } }));
  useSettings.getState().setTab(tab);
}
/** run `onItems` with tray items sent to this tab from elsewhere */
export function useHandoffInto(tab: Tab, onItems: (items: { media: import("./lib/tray").Media; slot?: string }[]) => void) {
  const pending = useHandoff((s) => s.pending[tab]);
  const ref = useRef(onItems);
  ref.current = onItems;
  useEffect(() => {
    if (!pending?.length) return;
    const p = takeHandoff(tab);
    Promise.all(p.map(async (x) => ({ media: await useTray.getState().asMedia(x.id), slot: x.slot })))
      .then((items) => ref.current(items))
      .catch((e) => useJobs.getState().toast(String(e.message ?? e), "bad"));
  }, [pending, tab]);
}
export function takeHandoff(tab: Tab) {
  const p = useHandoff.getState().pending[tab] ?? [];
  if (p.length) useHandoff.setState((s) => ({ pending: { ...s.pending, [tab]: [] } }));
  return p;
}

const TABS: { id: Tab; label: string; icon: string; blurb: string }[] = [
  { id: "characters", label: "Characters", icon: "user", blurb: "your saved cast and reference sheets" },
  { id: "scenes", label: "Scenes", icon: "film", blurb: "multi-shot videos: frame → blueprint → H3 prompt → video" },
  { id: "create", label: "Create", icon: "sparkle", blurb: "new characters, backgrounds and scenes" },
  { id: "edit", label: "Edit", icon: "brush", blurb: "change a picture with words or a brush" },
  { id: "prompt", label: "Prompt", icon: "script", blurb: "plan a video second by second" },
  { id: "animate", label: "Animate", icon: "film", blurb: "make the video with sound" },
  { id: "finish", label: "Finish", icon: "scissors", blurb: "trim, loop and export" },
  { id: "batch", label: "Batch", icon: "layers", blurb: "many at once, runs while you're away" },
];
/** the header: six groups. Merged ones (Create + Batch, Edit + Compose, Animate + its prompt writer) get a switch at
 * the top of the page; each part stays its own screen, so "Send to Compose / Prompt / Batch" still lands right. */
const GROUPS: { id: string; label: string; members: Tab[]; names: Partial<Record<Tab, string>> }[] = [
  { id: "characters", label: "Characters", members: ["characters"], names: {} },
  { id: "scenes", label: "Scenes", members: ["scenes"], names: {} },
  { id: "create", label: "Create", members: ["create"], names: {} },
  { id: "edit", label: "Edit", members: ["edit"], names: {} },
  { id: "animate", label: "Animate", members: ["animate", "prompt", "finish"], names: { animate: "Animate", prompt: "Plan a video (prompt writer)", finish: "Finish (trim, loop, export)" } },
  // 06 opens Your site (profiles, photo sets, send as drafts) — Finish lives under Animate now
  { id: "site", label: "Your site", members: [], names: {} },
  { id: "batch", label: "Batch", members: ["batch"], names: {} },
];
const groupOf = (t: Tab) => GROUPS.find((g) => g.members.includes(t)) ?? GROUPS[0];
const LAST_IN_GROUP: Record<string, Tab> = {};

/** the switch between the parts of a merged group (Create · Batch, Edit · Compose, Animate · Plan a video) */
function SubTabs({ tab }: { tab: Tab }) {
  const g = groupOf(tab);
  const setTab = useSettings((s) => s.setTab);
  if (g.members.length < 2) return null;
  return (
    <div role="tablist" aria-label={g.label} className="flex shrink-0 items-center gap-1 border-b border-line2 bg-panel px-4 py-1.5">
      {g.members.map((m) => (
        <button key={m} role="tab" aria-selected={tab === m} onClick={() => setTab(m)}
          className={cx("press h-7 border-b-2 px-2.5 text-[12.5px] font-medium transition-colors", tab === m ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>
          {g.names[m] ?? m}
        </button>
      ))}
    </div>
  );
}

const PASTE_TARGET: Partial<Record<Tab, true>> = { create: true, edit: true, prompt: true, animate: true, finish: true, batch: true };

export default function App() {
  const tab = useSettings((s) => s.s.tab);
  const loaded = useSettings((s) => s.loaded);
  const setTab = useSettings((s) => s.setTab);
  useEffect(() => { useTray.getState().loadRecent(); useRecipes.getState().load(); }, []);
  // the character picked on the left is who every tab works on
  const sel = useCharacters((s) => s.sel);
  const prevSel = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    setProjectSource(() => useCharacters.getState().sel);
    setHistoryProject(() => useCharacters.getState().sel ?? null);
    // files land in output/studio/<project name>/… (Free work and Check everything get their own folders)
    setProjectFolder((p) => p === TESTING ? "Testing" : !p ? "Free work" : useCharacters.getState().list.find((c) => c.id === p)?.name?.trim() || p);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    // every project keeps its own Create box: your words and the picture you were working from come back when you return
    if (prevSel.current !== undefined && prevSel.current !== sel) {
      const c = useSettings.getState().s.create;
      const r = useMakeRefs.getState();
      saveDesk(prevSel.current, { extra: c.extra, pose: c.pose, pic2: r.pic2, place: r.place, remixOf: r.remixOf });
      const d = loadDesk(sel);
      useSettings.getState().set("create", { extra: d?.extra ?? "", pose: d?.pose ?? c.pose });
      useMakeRefs.setState({ pic2: d?.pic2 ?? null, place: d?.place ?? null, remixOf: d?.remixOf ?? null, pic1Own: false, pic1: null, tags: null });
    }
    prevSel.current = sel;
    useSettings.getState().set("create", { characterId: sel });
    useBatch.getState().set({ characterId: sel });
  }, [sel, loaded]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); usePrimary.getState().fns[useSettings.getState().s.tab]?.(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); usePalette.setState((p) => ({ open: !p.open })); }
      if (!typing && e.key === "?") { e.preventDefault(); useShortcuts.setState({ open: true }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="scan flex h-full min-h-[640px] flex-col">
      <Header tab={tab} setTab={setTab} />
      <main className="flex min-h-0 flex-1">
        {loaded && <ProjectRail />}
        {!loaded ? <div className="m-auto text-muted">Loading your settings…</div> : (
          ([
            ["characters", CharactersTab], ["scenes", ScenesTab], ["create", CreateTab], ["edit", EditTab],
            ["prompt", PromptTab], ["animate", AnimateTab], ["finish", FinishTab], ["batch", BatchTab],
          ] as [Tab, ComponentType][]).map(([id, C]) => (
            <div key={id} data-tab={id} className={cx("min-h-0 min-w-0 flex-1 flex-col", tab === id ? "fade-in flex" : "hidden")}>
              <SubTabs tab={id} />
              <GuideBanner tab={id} />
              <div className="flex min-h-0 min-w-0 flex-1"><C /></div>
            </div>
          ))
        )}
      </main>
      <Tray />
      <Toasts />
      <DropAnywhere tab={tab} />
      <TitleProgress />
      <BootGate />
      <AskHost />
      <OutsideHost />
      <SweepHost />
      <LoraBrowser />
      <ImageImport />
      <PictureMenuHost />
      <SelectionBar />
      <RecipeEditorHost />
      <ImportCard />
      <CatalogHost />
      <SelfCheck />
      {loaded && <Assistant />}
      <Viewer />
      <SiteLink />
      <ShortcutSheet />
      <Palette commands={() => commandsFor(setTab)} />
    </div>
  );
}

// ------------------------------------------------------------------ startup screen
/** while the rental is still downloading models / starting ComfyUI, cover the Studio with the startup screen */
function BootGate() {
  const [booting, setBooting] = useState(false);
  useEffect(() => {
    let alive = true, t: ReturnType<typeof setTimeout>;
    let wasBooting = false, frameBusy = false;
    // reloading mid-upload would lose it: wait until the pieces are all sent (the unpacking carries on by itself)
    const sending = () => frameBusy || useImport.getState().run?.state === "uploading";
    const reload = () => { if (!alive) return; if (sending()) { setTimeout(reload, 2000); return; } location.reload(); };
    // "Open the Studio now" on the startup screen: stay in the Studio while the downloads carry on (flag lasts 12 h)
    let skipped = false;
    try { skipped = Date.now() - Number(localStorage.getItem("h3.skipBoot") || 0) < 12 * 3600_000; } catch { /* */ }
    const check = async () => {
      const st = await getStatus();
      if (!alive) return;
      // a status read that failed (rental busy for a moment) says nothing: keep what we had, ask again soon
      if (!st) { t = setTimeout(check, 3000); return; }
      const b = st.phase !== "ready";
      if (!b) { try { localStorage.removeItem("h3.skipBoot"); } catch { /* */ } }
      if (wasBooting && !b) { reload(); return; } // came up: start fresh so everything connects
      wasBooting = b; setBooting(b && !skipped);
      t = setTimeout(check, b ? 3000 : 30000);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      if (e.data?.h3 === "ready" && wasBooting) reload();
      if (e.data?.h3 === "importing") frameBusy = !!e.data.on;
      if (e.data?.h3 === "skip") { skipped = true; setBooting(false); }
    };
    window.addEventListener("message", onMsg);
    check();
    return () => { alive = false; clearTimeout(t); window.removeEventListener("message", onMsg); };
  }, []);
  if (!booting) return null;
  return <iframe title="Starting up" src="/h3-boot" className="fixed inset-0 z-[90] h-full w-full border-0 bg-bg" />;
}

// ------------------------------------------------------------------ header
function Header({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const [st, setSt] = useState<InstanceStatus | null>(null);
  const [cost, setCost] = useState<Cost | null>(null);
  const [gpu, setGpu] = useState("");
  const jobs = useJobs((s) => s.jobs);
  const connected = useJobs((s) => s.connected);
  const [showQ, setShowQ] = useState(false);
  useEffect(() => {
    const poll = () => getStatus().then(setSt);
    poll(); const t = setInterval(poll, 15000);
    getCost().then(setCost); const c = setInterval(() => getCost().then(setCost), 300000);
    fetch("/system_stats").then((r) => r.json()).then((s) => setGpu((s?.devices?.[0]?.name ?? "").replace(/^cuda:\d+\s*/, "").replace(/NVIDIA (GeForce )?/, "").replace(/ : .*/, ""))).catch(() => {});
    return () => { clearInterval(t); clearInterval(c); };
  }, []);
  const active = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const state = !connected ? "Reconnecting…" : active.length ? `${active.length} working` : "Ready";
  const dlActive = useDownloads((s) => s.active);
  const dlPct = useDownloads((s) => s.pct);
  return (
    <header className="glass relative z-20 flex h-[60px] shrink-0 items-center gap-4 whitespace-nowrap border-b border-line2 px-5">
      <div className="flex shrink-0 items-center gap-2.5">
        <span className="chamfer-sm flex h-8 w-8 items-center justify-center bg-accent text-accentink"><Icon name="logo" size={19} /></span>
        <span className="hidden flex-col leading-none xl:flex"><span className="display glitch-once text-[16px]" data-text="H3 Studio">H3 Studio</span><span className="micro mt-0.5 text-dim" title={`This Studio was built ${BUILT} — a rental started before a new image finished still runs the old one`}>FIELD KIT · V3 · {BUILT.slice(5, 10)}</span></span>
      </div>
      <TabNav tab={tab} setTab={setTab} />
      <button onClick={() => usePalette.setState({ open: true })} className="press inset flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line2 pl-3 pr-1.5 text-[13px] text-dim hover:border-line hover:text-muted" aria-label="Search and commands (Ctrl K)" title="Search and commands">
        <Icon name="search" size={14} /><span className="hidden 2xl:inline">Search</span><kbd className="rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[10.5px] text-muted">Ctrl K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-2 text-[13px] text-muted">
        <AssistantButton />
        <div className="relative">
          <button onClick={() => setShowQ((v) => !v)} className="press flex h-9 items-center gap-2 rounded-lg border border-line2 bg-black/20 px-3 hover:text-ink" aria-expanded={showQ} aria-label="Jobs and rental status">
            <span className={cx("h-2 w-2 rounded-full", !connected ? "bg-bad" : active.length ? "bg-accent pulse" : "bg-good")} />
            <span className="text-ink">{state}</span>
            {gpu && <span className="hidden text-dim lg:inline">{gpu}</span>}
            {dlActive && <span className="micro flex items-center gap-1 text-accent" title="Models still downloading in the background"><Icon name="down" size={11} />{dlPct}%</span>}
            {cost?.total != null && <span className="font-mono text-[12px] text-dim">${cost.total.toFixed(2)}</span>}
            <Icon name="chev" size={13} className="text-dim" />
          </button>
          {showQ && <QueuePopover onClose={() => setShowQ(false)} st={st} cost={cost} gpu={gpu} />}
        </div>
        <RecipesButton />
        <MoreMenu />
      </div>
    </header>
  );
}

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<{ set: boolean; source: string | null }>({ set: true, source: null });
  useEffect(() => { if (open) civitKeyStatus().then(setKey); }, [open]);
  const [https, setHttps] = useState<string | null>(null);
  useEffect(() => { if (!window.isSecureContext) getHttpsLink().then(setHttps); }, [open]);
  const item = "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] text-ink hover:bg-hover";
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-label="More" aria-expanded={open} className="press btn-raised flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-ink"><Icon name="dots" size={18} /></button>
      {open && <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div className="zoom-in absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-line bg-panel p-1.5 shadow-[0_24px_60px_-16px_rgba(0,0,0,.8)]" onClick={() => setOpen(false)}>
          <a className={item} href="/outputs/" target="_blank" rel="noreferrer"><Icon name="folder" size={15} className="text-muted" />All output files<Icon name="external" size={13} className="ml-auto text-dim" /></a>
          <a className={item} href="/" target="_blank" rel="noreferrer"><Icon name="layers" size={15} className="text-muted" />ComfyUI node editor<Icon name="external" size={13} className="ml-auto text-dim" /></a>
          {https && <a className={item} href={`${https}/studio/`}><Icon name="lock" size={15} className="text-muted" /><span className="flex flex-col"><span>Secure link</span><span className="text-[12px] text-dim">Needed for the microphone</span></span></a>}
          <button className={item} onClick={() => openLoraBrowser()}><Icon name="search" size={15} className="text-muted" />Browse LoRAs</button>
          <button className={item} onClick={() => openImageImport()}><Icon name="link" size={15} className="text-muted" />CivitAI: collections, links, files</button>
          <button className={item} onClick={() => askCivitKey().then((ok) => ok && setKey({ set: true, source: "studio" }))}>
            <Icon name="lock" size={15} className="text-muted" /><span className="flex flex-col"><span>CivitAI key</span><span className="text-[12px] text-dim">{key.set ? (key.source === "template" ? "Set in your Vast template" : "Saved — press to replace") : "Needed for many LoRAs"}</span></span>
            <span className={cx("ml-auto h-2 w-2 rounded-full", key.set ? "bg-good" : "bg-bad")} /></button>
          <a className={item} href="/terminal/?arg=claude" target="_blank" rel="noreferrer"><Icon name="chat" size={15} className="shrink-0 text-accent" /><span className="flex min-w-0 flex-col"><span>Claude on this rental</span><span className="text-[12px] text-dim">Reads the logs, finds and fixes problems</span></span><Icon name="external" size={13} className="ml-auto shrink-0 text-dim" /></a>
          <AlertsItem cls={item} https={https} />
          <button className={item} onClick={() => { copyDebugReport(); }}><Icon name="script" size={15} className="shrink-0 text-muted" /><span className="flex min-w-0 flex-col"><span>Copy debug report</span><span className="text-[12px] text-dim">Errors, logs, GPU · passwords hidden</span></span></button>
          <a className={item} href="/terminal/" target="_blank" rel="noreferrer"><Icon name="keyboard" size={15} className="text-muted" />Terminal<Icon name="external" size={13} className="ml-auto text-dim" /></a>
          <button className={item} onClick={() => openSelfCheck()}><Icon name="check" size={15} className="text-muted" /><span className="flex flex-col"><span>Check everything</span><span className="text-[12px] text-dim">Tests every model + CivitAI · Copy report</span></span></button>
          <button className={item} onClick={() => openSiteLink()}><Icon name="up" size={15} className="text-muted" /><span className="flex flex-col"><span>Your site</span><span className="text-[12px] text-dim">Connect · send characters as drafts</span></span></button>
          <ProtonItem cls={item} />
          <div className="my-1 h-px bg-line2" />
          <button className={item} onClick={() => useShortcuts.setState({ open: true })}><Icon name="keyboard" size={15} className="text-muted" />Keyboard shortcuts<kbd className="ml-auto rounded border border-line px-1.5 font-mono text-[11px] text-muted">?</kbd></button>
          <button className={item} onClick={() => usePalette.setState({ open: true })}><Icon name="search" size={15} className="text-muted" />Search and commands<kbd className="ml-auto rounded border border-line px-1.5 font-mono text-[11px] text-muted">Ctrl K</kbd></button>
        </div>
      </>}
    </div>
  );
}

function TabNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [ind, setInd] = useState({ left: 0, width: 0 });
  const cur = groupOf(tab).id;
  LAST_IN_GROUP[cur] = tab;
  useEffect(() => {
    const measure = () => { const el = refs.current[cur]; if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth }); };
    measure();
    document.fonts?.ready.then(measure);
    const ro = new ResizeObserver(measure);
    Object.values(refs.current).forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, [cur]);
  return (
    <nav aria-label="Steps" className="seg-track relative flex items-center gap-0.5 rounded-xl border border-line2 p-1">
      <span aria-hidden className="seg-on absolute top-1 bottom-1 rounded-lg transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)]" style={{ left: ind.left, width: ind.width }} />
      {GROUPS.map((g, i) => (
        <button key={g.id} ref={(el) => { refs.current[g.id] = el; }} onClick={() => { if (g.id === "site") { openSiteLink(); return; } if (cur === g.id) window.dispatchEvent(new CustomEvent("h3:tab-home", { detail: g.id })); setTab(LAST_IN_GROUP[g.id] ?? g.members[0]); }} aria-current={cur === g.id}
          title={g.id === "site" ? "Your site: profiles, photo sets, send characters as drafts" : g.members.map((m) => TABS.find((t) => t.id === m)?.blurb).join(" · ")} className={cx("relative z-10 flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13.5px] font-medium transition-colors", cur === g.id ? "text-white" : "text-muted hover:text-ink")}>
          <span className={cx("micro", cur === g.id ? "text-accent" : "text-dim")}>{String(i + 1).padStart(2, "0")}</span>{g.label}</button>
      ))}
    </nav>
  );
}

function QueuePopover({ onClose, st, cost, gpu }: { onClose: () => void; st: InstanceStatus | null; cost: Cost | null; gpu: string }) {
  const jobs = useJobs((s) => s.jobs).slice(0, 12);
  const cancel = useJobs((s) => s.cancel);
  const setTab = useSettings((s) => s.setTab);
  return (
    <>
    <div className="fixed inset-0 z-40" onClick={onClose} />
    <div className="zoom-in absolute right-0 top-full z-50 mt-2 w-96 whitespace-normal rounded-xl border border-line bg-panel p-3 shadow-[0_24px_60px_-16px_rgba(0,0,0,.8)]">
      <div className="mb-3 grid grid-cols-3 gap-2 text-[12px]">
        {([
          ["GPU", gpu || "—", undefined],
          ["Backup", st?.backup ? (st.all_outputs_backed_up === false ? "Saving…" : "All saved") : "Off", st?.backup ? `Backing up to ${st.backup}` : "No cloud backup set up — outputs stay on this rental only"],
          [st?.auto_shutdown_in_s != null ? "Shuts down in" : "Spent", st?.auto_shutdown_in_s != null ? `${Math.ceil(st.auto_shutdown_in_s / 60)} min` : cost?.total != null ? `$${cost.total.toFixed(2)}` : "—", st?.auto_shutdown_in_s != null ? "After this long with no jobs and no tab open" : undefined],
        ] as [string, string, string | undefined][]).map(([k, v, t]) => (
          <div key={k} title={t} className="inset rounded-lg border border-line2 px-2.5 py-2"><div className="text-dim">{k}</div><div className="mt-0.5 truncate text-[13px] font-medium text-ink">{v}</div></div>
        ))}
      </div>
      {cost?.total != null && st?.auto_shutdown_in_s != null && <p className="-mt-1 mb-3 text-[12px] text-dim">${cost.total.toFixed(2)} so far on this rental · ${cost.dph.toFixed(2)}/hour</p>}
      <DownloadGroups />
      <button onClick={() => { onClose(); openSelfCheck(); }} className="press btn-raised mb-3 flex h-9 w-full items-center justify-center gap-2 text-[13px] font-medium"
        title="Runs a tiny job through every downloaded model and shows pass / fail with the exact error">
        <Icon name="check" size={14} /> Check everything
      </button>
      <p className="lbl mb-2">Jobs</p>
      {jobs.length === 0 && <p className="text-[13px] text-muted">Nothing yet. Press a Generate button (or Ctrl+Enter).</p>}
      <div className="flex flex-col gap-1.5">
        {jobs.map((j) => (
          <div key={j.id} className="flex items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-2 text-[13px]">
            <span className={cx("h-2 w-2 shrink-0 rounded-full", j.status === "running" ? "bg-accent pulse" : j.status === "queued" ? "bg-dim" : j.status === "done" ? "bg-good" : "bg-bad")} />
            <button className="min-w-0 flex-1 truncate text-left text-ink hover:underline" onClick={() => { setTab(j.tab); onClose(); }}>{j.label}</button>
            <span className="text-muted">{j.status === "running" ? (j.max ? `${j.value}/${j.max}` : "working") : j.status}</span>
            {(j.status === "running" || j.status === "queued") && <button className="text-muted hover:text-bad" onClick={() => cancel(j.id)}>Cancel</button>}
          </div>
        ))}
      </div>
    </div>
    </>
  );
}

/** "Later" to leave a group out (this rental and the next ones), "Now" to fetch it, "Retry" for a failed one */
function LaterSwitch({ g }: { g: Group }) {
  const [busy, setBusy] = useState(false);
  const toast = useJobs((s) => s.toast);
  if (!g.can_later || g.state === "done" || g.state === "checking") return <span className="w-[104px] shrink-0" />;
  const later = g.state === "later" || g.state === "skipped";
  const go = async (what: boolean | "next", done: string) => {
    setBusy(true);
    try { await setLater(g.id, what); toast(`${g.label}: ${done}`, "good"); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setTimeout(() => setBusy(false), 4000); }
  };
  const B = ({ on, label, title, hot }: { on: () => void; label: string; title: string; hot?: boolean }) => (
    <button onClick={on} disabled={busy} title={title}
      className={cx("micro shrink-0 border px-1.5 py-0.5 text-center disabled:opacity-40", hot ? "border-accent text-accent" : "border-line text-muted hover:text-ink")}>{busy ? "…" : label}</button>
  );
  return (
    <span className="flex w-[104px] shrink-0 justify-end gap-1">
      {later ? <B hot on={() => go("next", "downloading next")} label="NOW" title="Download this next" />
        : g.state === "error" ? <B hot on={() => go(false, "trying again")} label="RETRY" title="Try the failed files again" />
        : <>
          {g.state === "waiting" && <B on={() => go("next", "moved to the front of the queue")} label="NEXT" title="Download this right after what's already running" />}
          <B on={() => go(true, "left for later — press NOW whenever you need it")} label="LATER" title="Leave this out on this rental, until you press NOW" />
        </>}
    </span>
  );
}

function DownloadGroups() {
  const groups = useDownloads((s) => s.groups);
  const active = useDownloads((s) => s.active);
  const mbps = useDownloads((s) => s.mbps);
  if (!groups.length) return null;
  return (
    <div className="mb-3">
      <p className="lbl mb-1.5 flex items-center">Models{active && <span className="micro ml-auto text-dim">{mbps} MB/S</span>}</p>
      <div className="flex flex-col gap-1.5">
        {groups.map((g) => (
          <div key={g.id} className="flex items-center gap-2.5 text-[12.5px]">
            <span className={cx("h-2 w-2 shrink-0 rounded-full", g.state === "done" ? "bg-good" : g.state === "error" ? "bg-bad" : g.state === "downloading" ? "bg-accent pulse" : "bg-dim")} />
            <span className="w-40 shrink-0 truncate text-ink">{g.label}</span>
            <div className="h-1 flex-1 bg-raised2"><div className={cx("h-full", g.state === "done" ? "bg-good" : "stripes")} style={{ width: `${g.state === "done" ? 100 : g.pct}%` }} /></div>
            <span className={cx("micro w-16 shrink-0 text-right", g.why || g.state === "error" ? "text-hot" : "text-dim")} title={g.why ?? g.error ?? undefined}>{g.state === "done" ? "READY" : g.why ? (/disk/.test(g.why) ? "NO ROOM" : "BIG CARD") : g.state === "skipped" || g.state === "later" ? "LATER" : g.state === "error" ? "FAILED" : g.state === "downloading" ? `${g.pct}%` : "IN LINE"}</span>
            <LaterSwitch g={g} />
          </div>
        )).flatMap((row, i) => { const g = groups[i]; return g.state === "error" && g.error ? [row, <p key={`${g.id}-why`} className="-mt-1 ml-[18px] text-[11px] leading-snug text-hot/90">{g.error.split(" — ").slice(1).join(" — ") || g.error}</p>] : [row]; })}
      </div>
      <a href="/h3-boot?stay=1" className="micro mt-2 inline-block text-dim hover:text-ink">FULL DOWNLOAD SCREEN — FILES, SPEEDS, RETRY</a>
    </div>
  );
}

// ------------------------------------------------------------------ tray
const trayPref = () => { try { return localStorage.getItem("h3.tray.pinned") === "1"; } catch { return false; } };

/** the tray works like the macOS dock: hidden at the bottom, slides up when the mouse reaches the bottom edge,
 *  thumbnails grow under the cursor, the wheel scrolls it sideways. Pin it to keep it open. */
function Tray() {
  const items = useTray((s) => s.items);
  const [filter, setFilter] = useState<"all" | "image" | "video" | "audio" | "fav">("all");
  const favs = useFavs((s) => s.set);
  const [menu, setMenu] = useState<string | null>(null);
  const [pinned, setPinned] = useState(trayPref);
  const [shown, setShown] = useState(false);
  const hideT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const file = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [mx, setMx] = useState<number | null>(null);
  const toast = useJobs((s) => s.toast);
  const list = items.filter((i) => filter === "all" || (filter === "fav" ? isFav(favs, i.src) : i.kind === filter));
  const upload = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      try { await useTray.getState().addUpload(f); } catch (e) { toast(`${f.name}: ${(e as Error).message}`, "bad"); }
    }
  };
  const pin = (v: boolean) => { setPinned(v); try { localStorage.setItem("h3.tray.pinned", v ? "1" : "0"); } catch { /* private mode */ } };
  const show = () => { clearTimeout(hideT.current); setShown(true); };
  const hide = () => { clearTimeout(hideT.current); hideT.current = setTimeout(() => { if (!menu) setShown(false); }, 380); };

  // the wheel scrolls the strip sideways, smoothly
  useEffect(() => {
    const el = strip.current; if (!el) return;
    let target = el.scrollLeft, raf = 0;
    const step = () => { const d = target - el.scrollLeft; if (Math.abs(d) < 0.5) { el.scrollLeft = target; raf = 0; return; } el.scrollLeft += d * 0.2; raf = requestAnimationFrame(step); };
    const w = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!dx) return;
      e.preventDefault();
      if (!raf) target = el.scrollLeft;
      target = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, target + dx * 1.3));
      if (!raf) raf = requestAnimationFrame(step);
    };
    el.addEventListener("wheel", w, { passive: false });
    return () => { el.removeEventListener("wheel", w); cancelAnimationFrame(raf); };
  }, [pinned]);

  const open = pinned || shown || !!menu;
  const viewList = list;
  const body = (
    <section aria-label="Tray" className={cx("relative flex h-[118px] items-end gap-3.5 border-t border-line px-5 pb-2.5", pinned ? "glass shrink-0" : "glass")}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDrop={(e) => { if (e.dataTransfer.files?.length) { e.preventDefault(); upload(e.dataTransfer.files); } }}>
      <div className="w-28 shrink-0 self-center">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold">Tray
          <button onClick={() => pin(!pinned)} title={pinned ? "Unpin: hide at the bottom, show when the mouse reaches the edge" : "Pin: keep the tray open"}
            className={cx("micro border px-1 py-px", pinned ? "border-accent text-accent" : "border-line text-dim hover:text-ink")}>{pinned ? "PINNED" : "PIN"}</button>
        </div>
        <div className="text-[11px] text-muted">click to view · drag into a slot</div>
        <button className="mt-1 text-[11px] text-accent hover:underline" onClick={() => file.current?.click()}>+ add files</button>
        <input ref={file} type="file" multiple hidden accept="image/*,video/*,audio/*" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
      </div>
      <div ref={strip} className="flex h-full min-w-0 flex-1 items-end gap-2 overflow-x-auto overflow-y-hidden pb-0.5 [scrollbar-width:none]"
        onMouseMove={(e) => setMx(e.clientX)} onMouseLeave={() => setMx(null)}>
        {list.length === 0 && <p className="self-center text-[13px] text-dim">Everything you make or add shows up here.</p>}
        {list.map((i, n) => <TrayThumb key={i.id} item={i} mx={mx} open={menu === i.id} setOpen={(o) => setMenu(o ? i.id : null)}
          onView={() => openViewer(viewList.map((x) => ({ url: trayUrl(x), kind: x.kind, label: x.label, trayId: x.id, download: x.src.filename })), n, trayActions)} />)}
      </div>
      <Seg className="w-72 shrink-0 self-center" value={filter} onChange={setFilter}
        options={[{ value: "all", label: "All" }, { value: "fav", label: "★" }, { value: "image", label: "Pics" }, { value: "video", label: "Clips" }, { value: "audio", label: "Audio" }]} />
    </section>
  );
  if (pinned) return body;
  return (
    <>
      {/* the hot edge: touch the bottom of the window to bring the tray up */}
      <div className="fixed inset-x-0 bottom-0 z-30 h-2" onMouseEnter={show} onDragEnter={show} />
      <button onMouseEnter={show} onClick={show} aria-label="Show the tray"
        className={cx("micro fixed bottom-1 left-1/2 z-30 -translate-x-1/2 border border-line bg-panel/90 px-3 py-1 text-dim backdrop-blur transition-opacity hover:text-ink", open ? "pointer-events-none opacity-0" : "opacity-100")}>
        ▲ TRAY · {items.length}
      </button>
      <div className={cx("fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]", open ? "translate-y-0" : "translate-y-full")}
        onMouseEnter={show} onMouseLeave={hide} onDragEnter={show}>
        {body}
      </div>
    </>
  );
}

const trayActions = (it: ViewItem) => {
  const id = it.trayId; if (!id) return [];
  const acts = [{ label: "Use in Animate", run: () => sendTo("animate", [id]) }];
  if (it.kind === "image") acts.unshift({ label: "Use in Edit", run: () => sendTo("edit", [id]) });
  if (it.kind === "video") acts.push({ label: "Trim / loop", run: () => sendTo("finish", [id]) });
  return acts;
};

function TrayThumb({ item, open, setOpen, mx, onView }: { item: TrayItem; open: boolean; setOpen: (o: boolean) => void; mx: number | null; onView: () => void }) {
  const remove = useTray((s) => s.remove);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  // a result whose file was deleted (here or on an earlier rental) leaves the tray by itself
  useEffect(() => {
    if (item.src.type !== "output" || item.input) return;
    fetch(trayUrl(item), { method: "HEAD" }).then((r) => { if (r.status === 404) remove(item.id); }).catch(() => {});
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = (fn: () => void) => () => { fn(); setOpen(false); };
  const row = "rounded px-2.5 py-1.5 text-left hover:bg-hover";
  // dock magnification: grow with closeness to the cursor
  let k = 1;
  if (mx != null && ref.current) { const r = ref.current.getBoundingClientRect(); const d = Math.abs(mx - (r.left + r.width / 2)); k = 1 + 0.6 * Math.max(0, 1 - d / 150) ** 1.6; }
  const W = Math.round(64 * k), H = Math.round(52 * k);
  return (
    <div ref={ref} className="relative flex shrink-0 flex-col items-center gap-1" style={{ width: W, transition: "width .09s ease-out" }}>
      <button draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, item.id); e.dataTransfer.effectAllowed = "copy"; }}
        onClick={onView} onContextMenu={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setPos({ left: Math.min(r.left, window.innerWidth - 190), bottom: window.innerHeight - r.top + 8 }); setOpen(!open); }}
        title={`${item.label} — click to view, right-click for more`} aria-haspopup="dialog"
        className={cx("press cursor-grab overflow-hidden border", open ? "border-accent" : "border-line hover:border-accent/70", item.kind === "image" && "checker")}
        style={{ width: W, height: H, transition: "width .09s ease-out, height .09s ease-out" }}>
        <MediaView m={{ url: trayUrl(item), kind: item.kind, label: item.label }} controls={false} />
      </button>
      <span className="max-w-full truncate text-[10px] text-dim">{item.label}</span>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" className="fixed z-50 flex w-44 flex-col rounded-lg border border-line bg-panel p-1 text-[13px] shadow-2xl" style={{ left: pos.left, bottom: pos.bottom }}>
            <button role="menuitem" className={row} onClick={act(onView)}>View large</button>
            {item.kind !== "audio" && <button role="menuitem" className={row} onClick={act(() => { useTray.getState().asMedia(item.id).then(openFileMeta).catch((e) => useJobs.getState().toast((e as Error).message, "bad")); })}>How was this made?</button>}
            {item.kind === "image" && <button role="menuitem" className={row} onClick={act(() => sendTo("edit", [item.id]))}>Use in Edit</button>}
            <button role="menuitem" className={row} onClick={act(() => sendTo("prompt", [item.id]))}>Use in Prompt</button>
            <button role="menuitem" className={row} onClick={act(() => sendTo("animate", [item.id]))}>Use in Animate</button>
            {item.kind === "video" && <button role="menuitem" className={row} onClick={act(() => sendTo("finish", [item.id]))}>Trim / loop / export</button>}
            <a role="menuitem" className={cx(row, "text-ink")} href={trayUrl(item)} download={item.src.filename} onClick={() => setOpen(false)}>Download</a>
            <button role="menuitem" className={cx(row, "text-muted")} onClick={act(() => remove(item.id))}>Hide from tray</button>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ toasts
function Toasts() {
  const toasts = useJobs((s) => s.toasts);
  const dismiss = useJobs((s) => s.dismiss);
  const setTab = useSettings((s) => s.setTab);
  return (
    <div className="pointer-events-none fixed bottom-10 right-5 z-[90] flex w-96 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx("toast-in pointer-events-auto flex items-start gap-3 rounded-xl border bg-panel p-3 text-[13px] shadow-2xl",
          t.tone === "good" ? "border-good/50" : t.tone === "bad" ? "border-bad/60" : "border-line")}>
          <span className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", t.tone === "good" ? "bg-good" : t.tone === "bad" ? "bg-bad" : "bg-blue")} />
          <span className="flex-1 leading-relaxed">{t.text}</span>
          {t.tab && <Btn small onClick={() => { setTab(t.tab!); dismiss(t.id); }}>View</Btn>}
          <button aria-label="Dismiss" className="text-muted hover:text-ink" onClick={() => dismiss(t.id)}><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ command palette contents
function commandsFor(setTab: (t: Tab) => void): Command[] {
  const s = useSettings.getState();
  const cmds: Command[] = TABS.map((t) => ({ id: `tab:${t.id}`, group: "Go to", title: t.label, hint: t.blurb, icon: t.icon, run: () => setTab(t.id) }));
  cmds.push(
    { id: "act:run", group: "Actions", title: "Run this tab's main button", icon: "play", keys: "Ctrl ↵", run: () => usePrimary.getState().fns[useSettings.getState().s.tab]?.() },
    { id: "act:drawer", group: "Actions", title: "Show or hide settings", icon: "layers", keys: "Ctrl \\", run: () => s.setDrawer(s.s.tab, !(s.s.drawers[s.s.tab] ?? true)) },
    { id: "act:keys", group: "Actions", title: "Keyboard shortcuts", icon: "keyboard", keys: "?", run: () => useShortcuts.setState({ open: true }) },
    { id: "act:outputs", group: "Actions", title: "Open all outputs", hint: "every file this rental made", icon: "folder", run: () => window.open("/outputs/", "_blank") },
    { id: "act:civitkey", group: "Actions", title: "CivitAI key", hint: "paste it once — needed for many LoRAs", icon: "lock", run: () => { askCivitKey(); } },
    { id: "act:check", group: "Actions", title: "Check everything", hint: "a tiny job through every downloaded model — pass / fail with errors", icon: "check", run: () => openSelfCheck() },
    { id: "act:civitimg", group: "Actions", title: "My CivitAI collections", hint: "saved posts → Animate / Create / your character", icon: "link", run: () => openImageImport("", "collections") },
    { id: "act:civitlink", group: "Actions", title: "Read a CivitAI image link", hint: "prompt, settings, LoRAs, workflow", icon: "link", run: () => openImageImport("", "link") },
    { id: "act:filemeta", group: "Actions", title: "How was this made? (a file)", hint: "reads prompts and workflows inside pictures", icon: "search", run: () => openImageImport("", "file") },
    { id: "act:loramgr", group: "Actions", title: "LoRA Manager page", hint: "opens a new tab", icon: "link", run: () => window.open("/loras", "_blank") },
    { id: "act:loras", group: "Actions", title: "Browse LoRAs", hint: "scroll CivitAI and add with one click", icon: "search", run: () => { const s = useSettings.getState().s; openLoraBrowser(s.tab === "create" ? modelOf(s.create).family : s.tab === "animate" ? "h3" : s.tab === "edit" ? "krea2" : "any"); } },
    { id: "act:comfy", group: "Actions", title: "Open ComfyUI (node editor)", icon: "arrow", run: () => window.open("/", "_blank") },
  );
  RECIPES.forEach((r) => cmds.push({ id: `recipe:${r.id}`, group: "Quick starts", title: r.title, hint: r.blurb, icon: "sparkle", run: () => applyRecipe(r) }));
  cmds.push({ id: "act:catalog", group: "Actions", title: "Catalog — every picture and video", hint: "all results on this rental, by project, searchable", icon: "image", run: () => openCatalog() });
  cmds.push({ id: "act:claude", group: "Actions", title: "Claude on this rental", hint: "reads the logs and fixes problems — talk to it from claude.ai/code or the Claude app", icon: "chat", run: () => window.open("/terminal/?arg=claude", "_blank") });
  cmds.push({ id: "act:report", group: "Actions", title: "Copy debug report", hint: "errors, logs, downloads, GPU — passwords hidden", icon: "script", run: () => { copyDebugReport(); } });
  cmds.push({ id: "act:terminal", group: "Actions", title: "Terminal", hint: "a shell on this rental (h3-report, h3-claude)", icon: "keyboard", run: () => window.open("/terminal/", "_blank") });
  cmds.push({ id: "myrecipe:new", group: "Your recipes", title: "New recipe", hint: "save steps you repeat — face on → sharpen → upscale → add to a set", icon: "plus", run: () => editRecipe() });
  useRecipes.getState().list.forEach((r) => cmds.push({ id: `myrecipe:${r.id}`, group: "Your recipes", title: `Edit “${r.name}”`, hint: "run it from Batch, right-click a picture, or on picked results", icon: "layers", run: () => editRecipe(r) }));
  useCharacters.getState().list.forEach((c) => cmds.push({
    id: `char:${c.id}`, group: "Characters", title: c.name, hint: `${c.age} · ${c.style}`, icon: "user",
    run: () => { useCharacters.getState().select(c.id); setTab("characters"); },
  }));
  return cmds;
}

/** everything about this rental as text (the server hides secrets): onto the clipboard when the page allows it, and as a file */
async function copyDebugReport() {
  const toast = useJobs.getState().toast;
  try {
    const r = await fetch("/studio-api/debug-report?lines=150");
    if (!r.ok) throw new Error(`the helper answered ${r.status}`);
    const text = await r.text();
    let copied = false;
    try { if (window.isSecureContext && navigator.clipboard) { await navigator.clipboard.writeText(text); copied = true; } } catch { /* fall back to the file */ }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `h3-debug-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.txt`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(copied ? "Debug report copied and saved — paste or attach it in your Claude chat" : "Debug report saved — attach it in your Claude chat", "good");
  } catch (e) { toast(`Couldn't make the report: ${(e as Error).message}`, "bad"); }
}

// ------------------------------------------------------------------ paste / drop anywhere
function DropAnywhere({ tab }: { tab: Tab }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const dragFromPage = useRef(false);
  useEffect(() => {
    const add = async (files: File[]) => {
      const media = [];
      // .safetensors files are LoRAs: they go to your LoRA library (and your backup), not the tray
      for (const f of files.filter((x) => /\.safetensors$/i.test(x.name))) await uploadLoraWithToast(f);
      files = files.filter((x) => !/\.safetensors$/i.test(x.name));
      // .zip files from Characters → Export: every character with their pictures
      for (const f of files.filter((x) => /\.zip$/i.test(x.name))) {
        // progress, the result and any error show on the import card (bottom left)
        try { await importCharacters(f); useSettings.getState().setTab("characters"); } catch { /* shown on the card */ }
      }
      files = files.filter((x) => !/\.zip$/i.test(x.name));
      // .json / .txt / .md files are prompt files for the Scenes pipeline (LM Studio presets, system prompts)
      const packs = files.filter((x) => /\.(json|txt|md)$/i.test(x.name));
      files = files.filter((x) => !/\.(json|txt|md)$/i.test(x.name));
      if (packs.length) {
        try {
          const added = await dropPacks(packs);
          useJobs.getState().toast(added.map((p) => `${p.name} → ${p.stage ? STAGE_INFO[p.stage].short : "not sure which step — pick one in Scenes"}`).join(" · "), "good");
          useSettings.getState().setTab("scenes");
        } catch (e) { useJobs.getState().toast(`Prompt files: ${(e as Error).message}`, "bad"); }
      }
      for (const f of files) {
        try { media.push(await useTray.getState().addUpload(f)); } catch (e) { useJobs.getState().toast(`${f.name}: ${(e as Error).message}`, "bad"); }
      }
      const cur = useSettings.getState().s.tab;
      const ids = media.map((m) => m.trayId!).filter(Boolean);
      if (!ids.length) return;
      if (PASTE_TARGET[cur]) sendTo(cur, ids);
      else useJobs.getState().toast(`Added ${ids.length} file${ids.length > 1 ? "s" : ""} to the tray — drag ${ids.length > 1 ? "them" : "it"} where you need ${ids.length > 1 ? "them" : "it"}.`, "info");
    };
    const isFiles = (e: DragEvent) => !!e.dataTransfer?.types.some((t) => t === "Files" || t === DRAG_TYPE || t === CHAR_DRAG);
    const enter = (e: DragEvent) => { if (isFiles(e)) { depth.current++; setOver(true); } };
    const leave = (e: DragEvent) => { if (isFiles(e) && --depth.current <= 0) { depth.current = 0; setOver(false); } };
    const overF = (e: DragEvent) => { if (isFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      depth.current = 0; setOver(false);
      if (!isFiles(e) || e.defaultPrevented) return; // a slot already took it
      // a picture dragged a little by accident inside the Studio itself (e.g. in Your site): the browser calls that a
      // "file" too — it isn't something you dropped in from outside, so nothing happens
      const internal = dragFromPage.current; dragFromPage.current = false;
      if (internal && !e.dataTransfer?.types.includes(DRAG_TYPE) && !e.dataTransfer?.types.includes(CHAR_DRAG)) return;
      if (document.querySelector("[aria-modal]") && !e.dataTransfer?.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      const dt = e.dataTransfer!;
      const cur = useSettings.getState().s.tab;
      // a character from the left rail: they become the one you're working with here
      const cid = dt.getData(CHAR_DRAG);
      if (cid) {
        useCharacters.getState().select(cid);
        if (cur === "create") useSettings.getState().set("create", { characterId: cid, raw: false });
        const ch = useCharacters.getState().list.find((x) => x.id === cid);
        const name = ch?.name ?? "Character";
        const angles = (["back", "left", "threeq", "face"] as const).filter((v) => ch?.views[v]).length;
        const tip = angles >= 2 ? " — say the angle in your words (from behind, side profile, three-quarter, close-up) and their matching sheet picture is used" : " — make their Back / Side / 3/4 views in Characters so “from behind” or “side profile” can use them";
        if (cur === "edit") { import("./lib/editPick").then((m) => m.putCharInEdit(cid)); useJobs.getState().toast(`${name} joins the chat as @${name.split(/\s+/)[0].toLowerCase()}${tip}`, "good"); return; }
        if (cur !== "create" && PASTE_TARGET[cur] && dt.getData(DRAG_TYPE)) sendTo(cur, [dt.getData(DRAG_TYPE)]);
        useJobs.getState().toast(`${name} is in${cur === "create" ? tip : ""}`, "good");
        return;
      }
      // a result or tray picture dropped on the page: into this tab
      const tid = dt.getData(DRAG_TYPE);
      if (tid) { if (PASTE_TARGET[cur]) sendTo(cur, [tid]); return; }
      add(Array.from(dt.files));
    };
    const paste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) {
        // a civitai.com/images/… link pasted outside a text box opens the importer
        const t = e.clipboardData?.getData("text") ?? "";
        const el = e.target as HTMLElement | null;
        const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
        if (!typing && (CIVIT_IMAGE_LINK.test(t) || COLLECTION_LINK.test(t))) { e.preventDefault(); openImageImport(t.trim()); }
        return; // other plain text: leave it alone
      }
      e.preventDefault();
      add(files);
    };
    // a drop a slot handled (and stopped) or a drag that ended anywhere: the "Drop to add" frame always goes away
    const reset = () => { depth.current = 0; setOver(false); };
    const startIn = () => { dragFromPage.current = true; };
    const endIn = () => { dragFromPage.current = false; };
    window.addEventListener("dragstart", startIn, true); window.addEventListener("dragend", endIn, true);
    window.addEventListener("dragenter", enter); window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overF); window.addEventListener("drop", drop); window.addEventListener("paste", paste);
    window.addEventListener("drop", reset, true); window.addEventListener("dragend", reset, true);
    return () => {
      window.removeEventListener("dragstart", startIn, true); window.removeEventListener("dragend", endIn, true);
      window.removeEventListener("dragenter", enter); window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overF); window.removeEventListener("drop", drop); window.removeEventListener("paste", paste);
      window.removeEventListener("drop", reset, true); window.removeEventListener("dragend", reset, true);
    };
  }, []);
  const dragId = useCharDrag((s) => s.id);
  const dragChar = useCharacters((s) => (dragId ? s.list.find((x) => x.id === dragId) ?? null : null));
  if (!over) return null;
  const label = TABS.find((t) => t.id === tab)?.label;
  if (dragChar) {
    const f = dragChar.views.face || dragChar.views.front;
    const where = tab === "edit" ? `joins the Edit chat as @${dragChar.name.split(/\s+/)[0].toLowerCase()}` : tab === "create" ? "becomes Create's character" : PASTE_TARGET[tab] ? `goes into ${label}` : "is picked";
    return (
      <div className="fade-in pointer-events-none fixed inset-3 z-40 flex items-end justify-center rounded-3xl border-2 border-accent bg-accent/[.07] pb-32 shadow-[inset_0_0_80px_rgba(0,0,0,.35)]">
        <div className="glass flex items-center gap-4 rounded-2xl border border-accent/60 px-6 py-4">
          {f && <img src={viewUrl(f)} alt="" className="h-16 w-16 rounded-full border-2 border-accent object-cover" />}
          <div>
            <div className="micro text-accent">Character</div>
            <div className="display text-lg">Drop {dragChar.name}</div>
            <div className="text-[13px] text-muted">{dragChar.name} {where} — with their whole sheet, not as a photo</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="fade-in pointer-events-none fixed inset-3 z-40 flex items-end justify-center rounded-3xl border-2 border-dashed border-accent/70 bg-accent/[.04] pb-32">
      <div className="glass rounded-2xl border border-line px-6 py-4 text-center">
        <div className="display text-lg ">Drop to add</div>
        <div className="text-[13px] text-muted">{PASTE_TARGET[tab] ? `straight into ${label}` : "to the tray"} · or drop on a specific slot</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ progress in the browser tab
function TitleProgress() {
  const jobs = useJobs((s) => s.jobs);
  const [doneFlag, setDoneFlag] = useState(false);
  const [, setTick] = useState(0);
  const running = jobs.find((j) => j.status === "running");
  const prevRunning = useRef<string | null>(null);
  useEffect(() => {
    if (running) {
      const pct = running.etaMs && running.startedAt ? Math.min(99, Math.round(((Date.now() - running.startedAt) / running.etaMs) * 100)) : null;
      document.title = `${pct != null ? `${pct}% · ` : "… "}${running.label} — H3 Studio`;
      prevRunning.current = running.id;
    } else {
      if (prevRunning.current && document.hidden) setDoneFlag(true);
      prevRunning.current = null;
      document.title = doneFlag ? "✓ Ready — H3 Studio" : "H3 Studio";
    }
  });
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 3000); // refresh % while running
    const vis = () => { if (!document.hidden) setDoneFlag(false); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return null;
}

/** ⋯ menu: Proton Drive — results and exports copied there automatically (set up in the Vast template) */
function ProtonItem({ cls }: { cls: string }) {
  const [st, setSt] = useState<{ on: boolean; cloud?: string; state: string; last_ok: number | null; error: string; sent: number; folder: string } | null>(null);
  useEffect(() => { fetch("/studio-api/proton").then((r) => r.json()).then(setSt).catch(() => {}); }, []);
  if (!st?.on) return null;
  const ago = st.last_ok ? `${Math.max(1, Math.round((Date.now() / 1000 - st.last_ok) / 60))} min ago` : "not yet";
  const send = async () => {
    const r = await fetch("/studio-api/proton", { method: "POST" });
    useJobs.getState().toast(r.ok ? `Sending results and an export to ${st.cloud || "Proton Drive"} (“${st.folder}”) — it runs by itself every 15 minutes too.` : ((await r.json()).error ?? "Couldn't start"), r.ok ? "info" : "bad");
  };
  return (
    <button className={cls} onClick={send} title={st.error || undefined}>
      <Icon name="up" size={15} className={st.state === "error" ? "text-bad" : "text-muted"} />
      <span className="flex flex-col"><span>Send to {st.cloud || "Proton Drive"} now</span>
        <span className={cx("text-[12px]", st.state === "error" ? "text-bad" : "text-dim")}>{st.state === "error" ? `Last try failed — ${st.error.slice(0, 70)}` : st.state === "sending" ? "Sending…" : `Automatic · last sent ${ago}${st.sent ? ` · ${st.sent} files` : ""}`}</span></span>
    </button>
  );
}

/** ⋯ menu: pop-up + chime when something finishes while you're in another window */
function AlertsItem({ cls, https }: { cls: string; https?: string | null }) {
  const [on, setOn] = useState(() => { try { return localStorage.getItem("h3.alerts") !== "off"; } catch { return true; } });
  const secure = typeof window !== "undefined" && window.isSecureContext && "Notification" in window;
  const perm = secure ? Notification.permission : "unavailable";
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { chime } = await import("./lib/jobs");
    if (!on || (secure && perm === "default")) {
      try { localStorage.removeItem("h3.alerts"); } catch { /* */ }
      setOn(true);
      if (secure && Notification.permission === "default") await Notification.requestPermission().catch(() => "denied");
      chime();
    } else { try { localStorage.setItem("h3.alerts", "off"); } catch { /* */ } setOn(false); }
  };
  const sub = !on ? "Off" : !secure ? (https ? "Sound on · Windows pop-ups need the secure link below" : "Sound on · pop-ups need the secure link") : perm === "granted" ? "Pop-up + sound when you're in another window" : perm === "denied" ? "Sound on · pop-ups blocked in the browser (allow them in site settings)" : "Press to allow pop-ups";
  return (
    <button className={cls} onClick={toggle}>
      <Icon name="bell" size={15} className="text-muted" /><span className="flex min-w-0 flex-col"><span>Alerts when done</span><span className="text-[12px] text-dim">{sub}</span></span>
      <span className={cx("ml-auto h-2 w-2 rounded-full", on ? "bg-good" : "bg-dim")} />
    </button>
  );
}
