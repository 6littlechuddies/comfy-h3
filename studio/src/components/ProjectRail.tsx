// The project rail: every character is a project you can fold open — their profile and sheet, pictures, scenes and
// videos sit under them. Whichever one is picked is who every tab works on (Create, Scenes, Animate, Batch…).
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { viewUrl } from "../lib/api";
import { openCatalog } from "./Catalog";
import { exportCharacters, importCharacters, newCharacter, useCharacters, type Character } from "../lib/characters";
import type { Tab } from "../lib/jobs";
import { newScene, useScenes } from "../lib/scenes";
import { useSettings } from "../lib/settings";
import { Icon, cx } from "./ui";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { askConfirm, askText } from "./Dialogs";
import { duplicateScene, removePreset, savePreset, sceneFromPreset, useScenePresets } from "../lib/scenePresets";
import type { Scene } from "../lib/scenes";
import { useJobs } from "../lib/jobs";
import { useWork } from "../lib/work";
import { DRAG_TYPE, useTray } from "../lib/tray";
import { QueuePanel } from "./QueueDock";
import { MOVE_DRAG, countLabel, moveResults, useMoveDrag, type MoveItem } from "../lib/move";
import { useSelect } from "../lib/select";

/** a project as a drop target for results dragged from the results grid: they move into this project */
function useMoveTarget(project: string | null) {
  const [over, setOver] = useState(false);
  const armed = useMoveDrag((s) => s.n > 0);
  const n = useMoveDrag((s) => s.n);
  const has = (e: React.DragEvent) => e.dataTransfer.types.includes(MOVE_DRAG);
  const props = {
    onDragOver: (e: React.DragEvent) => { if (!has(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!over) setOver(true); },
    onDragLeave: (e: React.DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false); },
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      if (!has(e)) return;
      e.preventDefault(); // the page's own drop (into this tab) leaves it alone
      let items: MoveItem[] = [];
      try { items = JSON.parse(e.dataTransfer.getData(MOVE_DRAG)); } catch { return; }
      useMoveDrag.setState({ n: 0 });
      const k = moveResults(items, project);
      const name = project ? useCharacters.getState().list.find((c) => c.id === project)?.name ?? "that project" : "Free work";
      useSelect.getState().clear();
      useJobs.getState().toast(k ? `Moved ${countLabel(k)} to ${project ? `${name}'s project` : "Free work"}` : `Already in ${project ? `${name}'s project` : "Free work"}`, k ? "good" : "info");
    },
  };
  return { props, over, armed, n };
}
/** the ring a drop target gets while results are being dragged */
const dropRing = (armed: boolean, over: boolean) => (over ? "!border-accent bg-accent/15 outline outline-2 outline-accent" : armed ? "outline outline-1 outline-dashed outline-accent/50" : "");
export const CHAR_DRAG = "application/x-h3-character";
/** the character being dragged right now (from the rail): the drop overlay and the slots show it as a character, not a photo */
export const useCharDrag = create<{ id: string | null }>(() => ({ id: null }));

/** the drag picture: their face in an accent ring + name + "Character · whole sheet", so it never looks like a loose photo */
function charGhost(c: Character): HTMLElement {
  const el = document.createElement("div");
  const f = c.views.face || c.views.front;
  const n = Object.keys(c.views).filter((k) => !["sheet", "cutout"].includes(k)).length;
  el.style.cssText = "position:fixed;top:-200px;left:-400px;display:flex;align-items:center;gap:10px;padding:6px 14px 6px 6px;border-radius:999px;background:var(--color-panel,#15151a);border:2px solid var(--color-accent,#d4ff3a);box-shadow:0 8px 30px rgba(0,0,0,.5);font:600 13px system-ui,sans-serif;color:#fff;z-index:9999";
  el.innerHTML = `${f ? `<img src="${viewUrl(f)}" style="width:38px;height:38px;border-radius:999px;object-fit:cover;border:2px solid var(--color-accent,#d4ff3a)">` : ""}<span style="display:flex;flex-direction:column;line-height:1.2"><span></span><span style="font-weight:500;font-size:11px;opacity:.75">Character · ${n} sheet picture${n === 1 ? "" : "s"}</span></span>`;
  (el.querySelector("span span") as HTMLElement).textContent = c.name;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 0);
  return el;
}

// ------------------------------------------------------------------ right-click menus
interface MenuItem { label: string; icon?: string; run?: () => void | Promise<void>; danger?: boolean; head?: boolean; hint?: string }
const useMenu = create<{ at: { x: number; y: number; items: MenuItem[] } | null }>(() => ({ at: null }));
const openMenu = (e: React.MouseEvent, items: MenuItem[]) => { e.preventDefault(); e.stopPropagation(); useMenu.setState({ at: { x: e.clientX, y: e.clientY, items } }); };

function RailMenu() {
  const at = useMenu((s) => s.at);
  useEffect(() => {
    if (!at) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") useMenu.setState({ at: null }); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [at]);
  if (!at) return null;
  const h = Math.min(window.innerHeight - 16, at.items.length * 32 + 12);
  return createPortal(
    <div className="fixed inset-0 z-[96]" onMouseDown={() => useMenu.setState({ at: null })} onContextMenu={(e) => { e.preventDefault(); useMenu.setState({ at: null }); }}>
      <div role="menu" className="fade-in absolute max-h-[80vh] w-64 overflow-y-auto border border-line bg-raised2 py-1 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}
        style={{ left: Math.min(at.x, window.innerWidth - 268), top: Math.max(8, Math.min(at.y, window.innerHeight - h - 8)) }}>
        {at.items.map((it, i) => it.head
          ? <div key={i} className="micro px-3 pb-1 pt-2 text-dim">{it.label}</div>
          : (
            <button key={i} role="menuitem" onClick={async () => { useMenu.setState({ at: null }); try { await it.run?.(); } catch (e) { useJobs.getState().toast((e as Error).message, "bad"); } }}
              className={cx("flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-hover", it.danger ? "text-bad" : "text-ink")}>
              {it.icon ? <Icon name={it.icon} size={13} className={it.danger ? "" : "text-muted"} /> : <span className="w-[13px]" />}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>{it.hint && <span className="micro text-dim">{it.hint}</span>}
            </button>
          ))}
      </div>
    </div>, document.body);
}

/** "New scene from a preset" entries for a cast */
function presetItems(cast: string[], go: () => void): MenuItem[] {
  const list = useScenePresets.getState().list;
  if (!list.length) return [{ label: "Scene presets", head: true }, { label: "No presets yet — right-click a scene → Save as preset", icon: "script" }];
  return [{ label: "New scene from a preset", head: true }, ...list.map((p) => ({ label: p.name, icon: "film", hint: `${p.shots.length} shots`, run: () => { const s = sceneFromPreset(p, cast); useScenes.getState().select(s.id); go(); } }))];
}
function sceneMenu(s: Scene, go: () => void): MenuItem[] {
  return [
    { label: "Open", icon: "film", run: () => { useScenes.getState().select(s.id); go(); } },
    { label: "Rename…", icon: "script", run: async () => { const n = await askText("Rename scene", s.name, "Rename"); if (n?.trim()) useScenes.getState().patch(s.id, { name: n.trim() }); } },
    { label: "Duplicate", icon: "layers", run: () => { const c = duplicateScene(s); useScenes.getState().select(c.id); go(); } },
    { label: "Save as preset…", icon: "check", hint: `${s.shots.length} shots`, run: async () => { const n = await askText("Name this preset", s.name, "Save preset"); if (n?.trim()) { savePreset(s, n.trim()); useJobs.getState().toast(`Saved “${n.trim()}” — right-click any character or scene to start from it`, "good"); } } },
    ...presetItems(s.cast, go),
    { label: "Manage", head: true },
    ...useScenePresets.getState().list.map((p) => ({ label: `Delete preset “${p.name}”`, icon: "trash", danger: true, run: async () => { if (await askConfirm(`Delete the preset “${p.name}”?`, "Scenes made from it stay.", "Delete", true)) removePreset(p.id); } })),
    { label: "Delete this scene…", icon: "trash", danger: true, run: async () => { if (await askConfirm(`Delete “${s.name}”?`, "Its shots, frames and videos list are removed from the Studio.", "Delete", true)) useScenes.getState().remove(s.id); } },
  ];
}


const pref = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** pick who the Studio is working on (null = free work, no character) */
export function useActiveCharacter(): Character | null {
  return useCharacters((s) => s.list.find((x) => x.id === s.sel) ?? null);
}

export function ProjectRail() {
  const { list, sel, loaded } = useCharacters(useShallow((s) => ({ list: s.list, sel: s.sel, loaded: s.loaded })));
  const tab = useSettings((s) => s.s.tab);
  // narrow by default where you work on pictures (Create, Edit, Animate, Batch…), wide in Characters and Scenes;
  // each tab remembers if you change it
  const wideByDefault = (t: string) => t === "characters" || t === "scenes";
  const smallFor = (t: string) => pref(`h3.rail.small.${t}`, wideByDefault(t) ? "0" : "1") === "1";
  const [small, setSmall] = useState(() => smallFor(tab));
  useEffect(() => { setSmall(smallFor(tab)); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<Set<string>>(() => new Set(sel ? [sel] : []));
  const [q, setQ] = useState("");
  useEffect(() => { if (sel) setOpen((o) => (o.has(sel) ? o : new Set([...o, sel]))); }, [sel]);
  const toggleSmall = () => { setSmall((v) => { setPref(`h3.rail.small.${tab}`, v ? "0" : "1"); return !v; }); };
  const shown = q ? list.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : list;

  const zipIn = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const pick = (id: string | null, go?: Tab) => {
    useCharacters.getState().select(id);
    // switching project: another project's characters don't stay in Animate / Plan a video (Free work = none)
    const w = useWork.getState();
    const keep = (rs: typeof w.animateRefs) => rs.filter((r) => !r.charId || r.charId === id);
    const a = keep(w.animateRefs), p = keep(w.promptRefs);
    if (a.length !== w.animateRefs.length || p.length !== w.promptRefs.length) {
      w.set({ animateRefs: a, promptRefs: p });
      useJobs.getState().toast(id ? "Took the other project's characters out of Animate and Plan a video" : "Free work: no characters in Animate and Plan a video (add one with the character picker)", "info");
    }
    if (go) useSettings.getState().setTab(go);
  };
  const add = () => {
    const c = newCharacter();
    useCharacters.getState().save(c);
    pick(c.id, "characters");
  };

  if (small) return (<>
    <RailMenu />
    <aside aria-label="Characters" className="flex w-[58px] shrink-0 flex-col items-center gap-2 border-r border-line2 bg-panel py-3">
      <button onClick={toggleSmall} title="Show the character list" aria-label="Show the character list" className="press flex h-8 w-8 items-center justify-center text-muted hover:text-ink"><Icon name="rail" size={16} /></button>
      <FreeDrop narrow on={!sel} onClick={() => pick(null)} />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto p-0.5">
        {list.map((c) => <DropAvatar key={c.id} c={c} on={c.id === sel} onClick={() => pick(c.id)} />)}
      </div>
      <QueuePanel narrow />
      <button onClick={add} title="New character" className="press flex h-9 w-9 items-center justify-center border border-line text-muted hover:border-accent hover:text-ink"><Icon name="plus" size={14} /></button>
    </aside>
  </>);

  return (<>
    <RailMenu />
    <aside aria-label="Characters" className="flex w-[248px] shrink-0 flex-col border-r border-line2 bg-panel">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="lbl flex-1">Projects</span>
        <button onClick={add} title="New character" className="press flex h-7 items-center gap-1 border border-line px-2 text-[12px] text-muted hover:border-accent hover:text-ink"><Icon name="plus" size={12} />New</button>
        <button onClick={toggleSmall} title="Make this list narrow" aria-label="Make this list narrow" className="press flex h-7 w-7 items-center justify-center text-muted hover:text-ink"><Icon name="rail" size={15} /></button>
      </div>
      {list.length > 7 && (
        <div className="px-3 pb-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a character" aria-label="Find a character"
            className="inset h-8 w-full border border-line px-2 text-[12.5px] focus:border-accent focus:outline-none" />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3">
        <FreeDrop on={!sel} onClick={() => pick(null)} />
        {!loaded && <p className="px-2 py-2 text-[12.5px] text-muted">Loading…</p>}
        {loaded && list.length === 0 && <p className="px-2 py-3 text-[12.5px] leading-relaxed text-muted">No characters yet. Press <b className="text-ink">New</b>, or import profiles in Characters.</p>}
        {shown.map((c) => (
          <Project key={c.id} c={c} on={c.id === sel} tab={tab} open={open.has(c.id)}
            toggle={() => setOpen((o) => { const n = new Set(o); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
            pick={(go) => pick(c.id, go)} />
        ))}
      </div>
      <div className="border-t border-line2 p-2.5 pb-0">
        <button onClick={() => openCatalog()} title="Every picture and video on this rental, by project — nothing is ever left out here"
          className="press flex h-9 w-full items-center justify-center gap-2 border border-line text-[12.5px] text-ink hover:border-accent"><Icon name="image" size={14} />Catalog · every picture</button>
      </div>
      <QueuePanel />
      <div className="flex gap-1.5 border-t border-line2 p-2.5">
        <button onClick={() => zipIn.current?.click()} disabled={importing} className="press flex h-8 flex-1 items-center justify-center gap-1.5 border border-line text-[12px] text-muted hover:text-ink disabled:opacity-50" title="Bring back an Export all .zip: characters, results, settings, presets, prompt files, LoRAs — everything"><Icon name="up" size={12} />{importing ? "Importing…" : "Import"}</button>
        <input ref={zipIn} type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
          setImporting(true);
          try { await importCharacters(f); } catch { /* the import card shows progress, the result and any error */ }
          finally { setImporting(false); }
        }} />
        <button onClick={() => exportCharacters()} disabled={!list.length} className="press flex h-8 flex-1 items-center justify-center gap-1.5 border border-line text-[12px] text-muted hover:text-ink disabled:opacity-40" title="Everything — characters, scenes, presets, prompt files and your preferences — as one .zip"><Icon name="down" size={12} />Export all</button>
      </div>
    </aside>
  </>);
}

function FreeDrop({ on, onClick, narrow }: { on: boolean; onClick: () => void; narrow?: boolean }) {
  const t = useMoveTarget(null);
  if (narrow) return (
    <button {...t.props} onClick={onClick} title={t.armed ? "Drop here to move them to Free work" : "Free work — no character"}
      className={cx("press flex h-10 w-10 items-center justify-center border", on ? "border-accent text-accent" : "border-line text-muted hover:text-ink", dropRing(t.armed, t.over))}><Icon name="sparkle" size={15} /></button>
  );
  return (
    <button {...t.props} onClick={onClick} className={cx("flex items-center gap-2.5 border-l-2 px-2 py-2 text-left text-[13px]", on ? "border-accent bg-hover text-ink" : "border-transparent text-muted hover:bg-hover hover:text-ink", dropRing(t.armed, t.over))}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-line"><Icon name="sparkle" size={14} /></span>
      <span className="flex flex-col leading-tight"><span>Free work</span><span className="text-[11.5px] text-dim">{t.over ? `Drop to move ${countLabel(t.n)} here` : "no character"}</span></span>
    </button>
  );
}
function DropAvatar({ c, on, onClick }: { c: Character; on: boolean; onClick: () => void }) {
  const t = useMoveTarget(c.id);
  return <div {...t.props} title={t.armed ? `Drop here to move them to ${c.name}` : c.name} className={cx("shrink-0", dropRing(t.armed, t.over))}><Avatar c={c} on={on} onClick={onClick} size={40} /></div>;
}

function Avatar({ c, on, onClick, size = 36 }: { c: Character; on?: boolean; onClick?: () => void; size?: number }) {
  const f = c.views.face || c.views.front;
  return (
    <button onClick={onClick} title={c.name} style={{ width: size, height: size }}
      className={cx("shrink-0 overflow-hidden border bg-raised2", on ? "border-accent" : "border-line hover:border-muted")}>
      {f ? <img src={viewUrl(f)} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-[13px] font-semibold text-muted">{c.name.slice(0, 1).toUpperCase()}</span>}
    </button>
  );
}

function Project({ c, on, tab, open, toggle, pick }: { c: Character; on: boolean; tab: Tab; open: boolean; toggle: () => void; pick: (go?: Tab) => void }) {
  const drop = useMoveTarget(c.id);
  const scenes = useScenes(useShallow((s) => s.list.filter((x) => x.cast.includes(c.id))));
  const sceneSel = useScenes((s) => s.sel);
  const views = Object.keys(c.views).length;
  const row = (label: string, icon: string, go: Tab, extra?: string, active?: boolean) => (
    <button onClick={() => pick(go)} className={cx("flex w-full items-center gap-2 py-1.5 pl-2 pr-1 text-left text-[12.5px]", active ? "text-ink" : "text-muted hover:text-ink")}>
      <Icon name={icon} size={12.5} className={active ? "text-accent" : "text-dim"} /><span className="flex-1 truncate">{label}</span>{extra && <span className="micro text-dim">{extra}</span>}
    </button>
  );
  return (
    <div className="mt-0.5">
      <div onContextMenu={(e) => openMenu(e, [
        { label: c.name, head: true },
        { label: "Open profile & sheet", icon: "user", run: () => pick("characters") },
        { label: "Rename…", icon: "script", run: async () => { const n = await askText("Rename", c.name, "Rename"); if (n?.trim()) useCharacters.getState().save({ ...c, name: n.trim() }); } },
        { label: "New scene", icon: "plus", run: () => { const s = useScenes.getState().add({ ...newScene(`${c.name} — new scene`), cast: [c.id] }); useScenes.getState().select(s.id); pick("scenes"); } },
        ...presetItems([c.id], () => pick("scenes")),
        { label: "Project", head: true },
        { label: "Export this project (.zip)", icon: "down", run: () => exportCharacters([c.id]) },
        { label: "Duplicate character", icon: "layers", run: () => { const n = { ...newCharacter(), ...c, id: newCharacter().id, name: `${c.name} (copy)`, views: {} }; useCharacters.getState().save(n); useCharacters.getState().select(n.id); } },
        { label: "Delete character…", icon: "trash", danger: true, run: async () => { if (await askConfirm(`Delete ${c.name}?`, "Their details and reference pictures are removed, including from your backup. Their scenes stay.", "Delete", true)) useCharacters.getState().remove(c.id); } },
      ])} draggable title="Drag into any picture slot, or onto Create / Edit / Animate"
        onDragStart={(e) => {
          // the whole row drags: their front picture (for slots) + who they are (for tabs)
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData(CHAR_DRAG, c.id);
          const f = c.views.front || c.views.face;
          const it = f ? useTray.getState().addOutput(f, `${c.name} front`) : undefined;
          if (it) e.dataTransfer.setData(DRAG_TYPE, it.id);
          e.dataTransfer.setDragImage(charGhost(c), 26, 26);
          useCharDrag.setState({ id: c.id });
        }}
        onDragEnd={() => useCharDrag.setState({ id: null })}
        {...drop.props}
        className={cx("flex cursor-grab items-center gap-2 border-l-2 px-2 py-1.5 active:cursor-grabbing", on ? "border-accent bg-hover" : "border-transparent hover:bg-hover", dropRing(drop.armed, drop.over))}>
        <Avatar c={c} on={on} onClick={() => { pick(); if (!open) toggle(); }} />
        <button onClick={() => { pick(); if (!open || on) toggle(); }} className="min-w-0 flex-1 text-left">
          <div className={cx("truncate text-[13px] font-medium", on ? "text-ink" : "text-ink/85")}>{c.name}</div>
          <div className="text-[11.5px] text-dim">{drop.over ? <span className="text-accent">Drop to move {countLabel(drop.n)} here</span> : <>{c.style === "anime" ? "Anime" : "Realistic"} · {views} pic{views === 1 ? "" : "s"}{scenes.length ? ` · ${scenes.length} scene${scenes.length > 1 ? "s" : ""}` : ""}</>}</div>
        </button>
        <button onClick={toggle} aria-label={open ? "Fold" : "Unfold"} aria-expanded={open} className="press flex h-6 w-6 items-center justify-center text-dim hover:text-ink">
          <Icon name="chev" size={13} className={cx("transition-transform", !open && "-rotate-90")} />
        </button>
      </div>
      {open && (
        <div className="ml-[22px] border-l border-line2 pl-1.5">
          {row("Profile & sheet", "user", "characters", undefined, on && tab === "characters")}
          {row("Make pictures", "sparkle", "create", undefined, on && tab === "create")}
          {row("Edit pictures", "brush", "edit", undefined, on && tab === "edit")}
          <div onContextMenu={(e) => openMenu(e, [{ label: "New scene", icon: "plus", run: () => { const s = useScenes.getState().add({ ...newScene(`${c.name} — new scene`), cast: [c.id] }); useScenes.getState().select(s.id); pick("scenes"); } }, ...presetItems([c.id], () => pick("scenes"))])}
            className="flex items-center gap-2 py-1.5 pl-2 pr-1 text-[12.5px] text-muted" title="Right-click: new scene, or start from a preset">
            <Icon name="film" size={12.5} className="text-dim" /><span className="flex-1">Scenes</span>
            <button onClick={() => { const s = useScenes.getState().add({ ...newScene(`${c.name} — new scene`), cast: [c.id] }); useScenes.getState().select(s.id); pick("scenes"); }}
              title="New scene with this character" className="press flex h-5 w-5 items-center justify-center text-dim hover:text-accent"><Icon name="plus" size={11} /></button>
          </div>
          {scenes.map((s) => (
            <button key={s.id} onClick={() => { useScenes.getState().select(s.id); pick("scenes"); }} onContextMenu={(e) => openMenu(e, sceneMenu(s, () => pick("scenes")))} title="Right-click: rename, duplicate, save as preset…"
              className={cx("ml-4 flex w-[calc(100%-1rem)] items-center gap-1.5 border-l py-1 pl-2.5 text-left text-[12px]", on && tab === "scenes" && sceneSel === s.id ? "border-accent text-ink" : "border-line2 text-muted hover:text-ink")}>
              <span className="flex-1 truncate">{s.name}</span><span className="micro text-dim">{s.shots.length}</span>
            </button>
          ))}
          {row("Animate", "play", "animate", undefined, on && tab === "animate")}
          {row("Batch · many at once", "layers", "batch", undefined, on && tab === "batch")}
          <button onClick={() => exportCharacters([c.id])} className="flex w-full items-center gap-2 py-1.5 pl-2 pr-1 text-left text-[12.5px] text-muted hover:text-ink">
            <Icon name="down" size={12.5} className="text-dim" /><span className="flex-1">Export this project</span><span className="micro text-dim">.ZIP</span>
          </button>
        </div>
      )}
    </div>
  );
}
