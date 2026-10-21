// "@" in a prompt box: a list of your characters and recent pictures. Picking one puts it where it belongs in that tab
// (Create: the star or Picture 2; Edit: Picture 1/2; Animate & Plan: the references) and writes its name into the text.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useShallow } from "zustand/react/shallow";
import { viewUrl } from "../lib/api";
import { isAdult, useCharacters, type Character } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { trayUrl, useTray, type TrayItem } from "../lib/tray";
import { Icon, cx } from "./ui";

export type MentionPick = { kind: "character"; c: Character } | { kind: "picture"; item: TrayItem };
export interface MentionTarget {
  /** one line under each kind in the list: what picking it does in this tab */
  hint: { character: string; picture: string };
  /** do it; resolves with the words that replace "@…" in the text ("" = just remove it) */
  pick: (p: MentionPick) => Promise<string> | string;
  /** pictures aren't offered (e.g. a tab that only takes characters) */
  noPictures?: boolean;
}

interface Row { key: string; group: "Characters" | "Pictures"; title: string; sub: string; thumb: string; pick: MentionPick }

/** the "@word" right before the caret, if the caret is in one */
function triggerAt(text: string, caret: number): { start: number; q: string } | null {
  const m = text.slice(0, caret).match(/(^|\s)@([^\s@]{0,30})$/);
  return m ? { start: caret - m[2].length - 1, q: m[2] } : null;
}

export function useMention(value: string, onChange: (v: string) => void, ta: RefObject<HTMLTextAreaElement | null>, target?: MentionTarget) {
  const [trig, setTrig] = useState<{ start: number; q: string } | null>(null);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const chars = useCharacters(useShallow((s) => s.list.filter((c) => isAdult(c) && c.views.front)));
  const pics = useTray(useShallow((s) => s.items.filter((i) => i.kind === "image").slice(0, 60)));
  const toast = useJobs((s) => s.toast);

  const rows: Row[] = useMemo(() => {
    if (!trig || !target) return [];
    const q = trig.q.toLowerCase();
    const cs = chars.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 6).map((c): Row => ({
      key: `c:${c.id}`, group: "Characters", title: c.name, sub: target.hint.character.replace("{name}", c.name), thumb: viewUrl(c.views.face || c.views.front!), pick: { kind: "character", c },
    }));
    const ps = target.noPictures ? [] : pics.filter((p) => !q || p.label.toLowerCase().includes(q)).slice(0, q ? 8 : 6).map((p): Row => ({
      key: `p:${p.id}`, group: "Pictures", title: p.label || "Picture", sub: target.hint.picture, thumb: trayUrl(p), pick: { kind: "picture", item: p },
    }));
    return [...cs, ...ps];
  }, [trig, target, chars, pics]);
  useEffect(() => { setSel(0); }, [trig?.q]);

  const sync = () => {
    const el = ta.current;
    if (!el || !target) return;
    setTrig(el.selectionStart === el.selectionEnd ? triggerAt(el.value, el.selectionStart) : null);
  };
  const choose = async (r: Row) => {
    if (!trig || busy) return;
    const at = trig;
    setBusy(true);
    try {
      const words = await target!.pick(r.pick);
      const before = value.slice(0, at.start);
      const after = value.slice(at.start + 1 + at.q.length);
      let head: string, tail: string;
      if (words) { head = before + words + " "; tail = after.replace(/^ /, ""); }
      else { const b = before.replace(/\s+$/, ""); tail = after.replace(/^\s+/, ""); head = b && tail ? b + " " : b; }
      onChange(head + tail);
      setTrig(null);
      requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(head.length, head.length); } });
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!trig || !rows.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => (i + 1) % rows.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => (i - 1 + rows.length) % rows.length); }
    else if ((e.key === "Enter" && !e.ctrlKey && !e.metaKey) || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); choose(rows[Math.min(sel, rows.length - 1)]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setTrig(null); }
  };
  /** the "@" button: types an @ at the caret and opens the list */
  const start = () => {
    const el = ta.current; if (!el) return;
    const p = el.selectionStart ?? value.length;
    const pre = value.slice(0, p);
    const ins = pre && !/\s$/.test(pre) ? " @" : "@";
    onChange(pre + ins + value.slice(p));
    requestAnimationFrame(() => { el.focus(); const c = p + ins.length; el.setSelectionRange(c, c); setTrig({ start: c - 1, q: "" }); });
  };

  const open = !!trig && !!target;
  // the box near the top of the screen (Create, Edit) → the list opens under the text; lower down → above the box
  const el = ta.current;
  const under = !!el && el.getBoundingClientRect().top < 400;
  const menu = open ? (
    <div role="listbox" aria-label="Add a character or picture" className={cx("fade-in absolute left-3 z-40 w-[340px] overflow-hidden border border-line bg-raised2 shadow-2xl", !under && "bottom-full mb-2")}
      style={under && el ? { top: el.offsetTop + el.offsetHeight + 4 } : undefined} onMouseDown={(e) => e.preventDefault()}>
      {!rows.length ? (
        <p className="px-3 py-3 text-[12.5px] text-muted">{trig!.q ? `Nothing called “${trig!.q}”.` : "No characters or pictures yet — make a character, or drop a picture anywhere first."}</p>
      ) : (
        <div className="max-h-[320px] overflow-y-auto py-1">
          {rows.map((r, i) => (
            <div key={r.key}>
              {(i === 0 || rows[i - 1].group !== r.group) && <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-dim">{r.group}</div>}
              <button role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => choose(r)} disabled={busy}
                className={cx("flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left", i === sel ? "bg-hover" : "")}>
                <span className={cx("h-9 w-9 shrink-0 overflow-hidden border border-line", r.group === "Characters" ? "rounded-full" : "rounded-[3px]")}><img src={r.thumb} alt="" className="h-full w-full object-cover" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] text-ink">{r.title}</span><span className="block truncate text-[11.5px] text-dim">{r.sub}</span></span>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[11px] text-dim">
        <span>↑↓ choose</span><span>Enter add</span><span className="ml-auto">Esc close</span>
      </div>
    </div>
  ) : null;
  return { onKeyDown, sync, menu, start, close: () => { if (!busy) setTrig(null); }, enabled: !!target, busy };
}

/** the small "@" button in the prompt bar */
export function MentionButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Add a character or picture by name — or just type @ in the box"
      className="press inline-flex h-8 items-center gap-1 rounded-sm px-2 text-[12px] text-muted hover:text-ink"><Icon name="user" size={13} />@</button>
  );
}
