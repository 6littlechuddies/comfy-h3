// The floating bar over picked results: one press does it to all of them. Results of a change stack on the picture they
// came from (flip through with the arrows), in the tab you're in.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { FileRef } from "../lib/api";
import { addToSiteSet, useCharacters } from "../lib/characters";
import { isFav, toggleFav, useFavs } from "../lib/favs";
import { useJobs, type Tab } from "../lib/jobs";
import { familyOf, mediaOf } from "../lib/recipes";
import { useSelect, type Picked } from "../lib/select";
import { useSettings } from "../lib/settings";
import { trayIdOf, useTray } from "../lib/tray";
import { viewUrl } from "../lib/api";
import { askConfirm } from "./Dialogs";
import { RecipeMenu } from "./MyRecipes";
import { countLabel, moveResults } from "../lib/move";
import { Icon, cx } from "./ui";

/** each picture through `fn`, two at a time; failures are counted and the first one is shown */
async function eachPic(its: Picked[], what: string, tab: Tab, fn: (it: Picked) => Promise<unknown>) {
  const toast = useJobs.getState().toast;
  let next = 0, bad = 0, first = "";
  const worker = async () => { while (next < its.length) { const it = its[next++]; try { await fn(it); } catch (e) { bad++; first ||= (e as Error).message; } } };
  await Promise.all([worker(), worker()]);
  if (bad) toast(`${what}: ${bad} of ${its.length} didn't go${first ? ` — ${first}` : ""}`, "bad", tab);
}
const ref = (it: Picked): FileRef => ({ filename: it.o.filename, subfolder: it.o.subfolder, type: it.o.type });

export function SelectionBar() {
  const { tab, items, clear } = useSelect();
  const cur = useSettings((s) => s.s.tab);
  const c = useCharacters((s) => s.list.find((x) => x.id === s.sel) ?? null);
  const favs = useFavs((s) => s.set);
  const toast = useJobs((s) => s.toast);
  const [menu, setMenu] = useState(false);
  const [moveMenu, setMoveMenu] = useState(false);
  const chars = useCharacters((s) => s.list);
  const its = Object.values(items);
  // leaving the tab, or Esc, lets go of the selection
  useEffect(() => { if (tab && cur !== tab) clear(); }, [cur, tab, clear]);
  useEffect(() => {
    if (!its.length && !useSelect.getState().mode) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[role=dialog]")) { if (menu) setMenu(false); else clear(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [its.length, menu, clear]);
  useEffect(() => { if (!its.length) { setMenu(false); setMoveMenu(false); } }, [its.length]);
  if (!tab || !its.length) return null;

  const pics = its.filter((it) => it.o.kind === "image");
  const videos = its.length - pics.length;
  const t = tab;
  const stack = (it: Picked) => ({ stack: typeof it.j.meta?.stack === "string" ? it.j.meta.stack : trayIdOf(it.o), quietFail: true }); // one summary instead of a popup each
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  const noPics = !pics.length ? "Pick pictures (videos can only be downloaded, favourited or deleted)" : undefined;

  type A = { key: string; icon: string; label: string; short?: string; why?: string; run: () => void | Promise<void>; danger?: boolean };
  const acts: A[] = [
    {
      key: "up", icon: "up", label: "Upscale ×2", why: noPics, run: async () => {
        toast(`Upscaling ${n(pics.length, "picture")} — each one stacks on its original`, "info", t);
        const { upscaleJob } = await import("../lib/likeness");
        await eachPic(pics, "Upscale", t, async (it) => upscaleJob(await mediaOf(ref(it), it.j.label), familyOf(it.o), { tab: t, meta: stack(it) }));
      },
    },
    {
      key: "face", icon: "sparkle", label: "Sharpen faces", why: noPics, run: async () => {
        toast(`Sharpening the faces in ${n(pics.length, "picture")}`, "info", t);
        const { sharpenFace } = await import("../lib/faceDetail");
        await eachPic(pics, "Sharpen faces", t, (it) => sharpenFace(ref(it), { tab: t, meta: stack(it) }));
      },
    },
    ...(c ? [
      {
        key: "on", icon: "user", label: `Put ${c.name}'s face on these`, short: `${c.name.split(" ")[0]}'s face`, why: noPics, run: async () => {
          toast(`Putting ${c.name}'s face on ${n(pics.length, "picture")} — everything else stays`, "info", t);
          const { faceOntoJobs } = await import("../lib/likeness");
          await eachPic(pics, "Face on", t, async (it) => faceOntoJobs(await mediaOf(ref(it), it.j.label), c, 1, { tab: t, meta: stack(it) }));
        },
      },
      {
        key: "priv", icon: "lock", label: `Add to ${c.name}'s private set`, short: "Private set", why: noPics, run: () => {
          pics.forEach((it) => addToSiteSet(c.id, "Private", "premium", ref(it)));
          toast(`Added ${n(pics.length, "picture")} to ${c.name}'s private set — send it from their page (⋯ → Your site)`, "good", t);
        },
      },
      {
        key: "train", icon: "layers", label: `Add to ${c.name}'s training set`, short: "Training set", why: noPics, run: async () => {
          toast(`Adding ${n(pics.length, "picture")} to ${c.name}'s training set — each face is checked`, "info", t);
          const { addToSet } = await import("../lib/builder");
          await eachPic(pics, "Training set", t, (it) => addToSet(c, ref(it)));
        },
      },
    ] as A[] : []),
  ];
  const allFav = its.every((it) => isFav(favs, it.o));
  const run = (a: A) => { if (a.why) return; clear(); Promise.resolve(a.run()).catch((e) => toast((e as Error).message, "bad", t)); };
  const download = async () => {
    for (const it of its) {
      const a = document.createElement("a"); a.href = viewUrl(it.o); a.download = it.o.filename;
      document.body.appendChild(a); a.click(); a.remove();
      await new Promise((r) => setTimeout(r, 350));
    }
    if (its.length > 1) toast(`Downloading ${its.length} files — if the browser asks, allow several downloads`, "info", t);
  };
  const del = async () => {
    if (!(await askConfirm(`Delete ${n(its.length, its.length === pics.length ? "picture" : "file")}?`, "They're removed from the rental too. This can't be undone.", "Delete", true))) return;
    useJobs.getState().removeOutputs(its.map((it) => ({ jobId: it.j.id, filename: it.o.filename, subfolder: it.o.subfolder })));
    clear();
  };
  const btn = "press flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-ink hover:bg-white/10 disabled:opacity-40";
  return createPortal(
    <div className="fade-in fixed inset-x-0 bottom-12 z-[55] mx-auto flex w-fit max-w-[calc(100vw-24px)] items-center gap-0.5 rounded-full border border-line bg-raised2/95 p-1 pl-4 shadow-2xl backdrop-blur" role="toolbar" aria-label="Picked results">
      <span className="mr-2 shrink-0 text-[12.5px] font-medium text-ink">{its.length} picked{videos && pics.length ? <span className="text-dim"> · {videos} video{videos > 1 ? "s" : ""}</span> : ""}</span>
      <span className="h-5 w-px bg-line" aria-hidden />
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {acts.map((a) => (
          <button key={a.key} onClick={() => run(a)} disabled={!!a.why} title={a.why ?? a.label} className={btn}><Icon name={a.icon} size={14} className="text-muted" />{a.short ?? a.label}</button>
        ))}
      </div>
      <span className="relative shrink-0">
        <button onClick={() => setMenu((v) => !v)} disabled={!pics.length} aria-expanded={menu} title={noPics ?? "Run one of your recipes on these"} className={cx(btn, menu && "bg-white/10")}><Icon name="layers" size={14} className="text-accent" />Recipe<Icon name="chev" size={12} className="text-muted" /></button>
        {menu && <div className="absolute bottom-full right-0 mb-2"><RecipeMenu pics={pics.map(ref)} tab={t} onDone={() => { setMenu(false); clear(); }} /></div>}
      </span>
      <span className="relative shrink-0">
        <button onClick={() => setMoveMenu((v) => !v)} aria-expanded={moveMenu} title="Move these to another project (or drag them onto one on the left)" className={cx(btn, moveMenu && "bg-white/10")}><Icon name="folder" size={14} className="text-muted" />Move to<Icon name="chev" size={12} className="text-muted" /></button>
        {moveMenu && (
          <div role="menu" className="absolute bottom-full right-0 mb-2 max-h-[50vh] w-60 overflow-y-auto rounded-xl border border-line bg-raised2 py-1 shadow-2xl">
            {[{ id: null as string | null, name: "Free work" }, ...chars.map((x) => ({ id: x.id as string | null, name: x.name }))].map((p) => (
              <button key={p.id ?? "free"} role="menuitem" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-hover" onClick={() => {
                const k = moveResults(its.map((it) => ({ jobId: it.j.id, filename: it.o.filename, subfolder: it.o.subfolder })), p.id);
                setMoveMenu(false); clear();
                toast(k ? `Moved ${countLabel(k)} to ${p.id ? `${p.name}'s project` : "Free work"}` : `Already in ${p.name}`, k ? "good" : "info", t);
              }}><Icon name={p.id ? "user" : "sparkle"} size={13} className="text-muted" /><span className="truncate">{p.name}</span></button>
            ))}
          </div>
        )}
      </span>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
      <button onClick={() => its.forEach((it) => { if (isFav(favs, it.o) === allFav) toggleFav(it.o); })} title={allFav ? "Remove from favourites" : "Add to favourites"} aria-label="Favourite" className={cx(btn, "w-9 justify-center px-0")}>
        <svg width={15} height={15} viewBox="0 0 24 24" fill={allFav ? "#F0A845" : "none"} stroke={allFav ? "#F0A845" : "currentColor"} strokeWidth="2" aria-hidden><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>
      </button>
      <button onClick={download} title="Download all" aria-label="Download all" className={cx(btn, "w-9 justify-center px-0")}><Icon name="down" size={15} /></button>
      <button onClick={del} title="Delete" aria-label="Delete" className={cx(btn, "w-9 justify-center px-0 hover:text-bad")}><Icon name="trash" size={15} /></button>
      <button onClick={clear} title="Let go (Esc)" aria-label="Clear selection" className={cx(btn, "w-9 justify-center px-0 text-muted")}><Icon name="x" size={15} /></button>
    </div>, document.body);
}
