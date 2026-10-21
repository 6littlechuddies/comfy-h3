// Scenes & pose collections: see what's saved, add poses by typing, make new collections, remove things.
import { useState } from "react";
import { rememberSet, useInspo, type InspoKind } from "../lib/inspo";
import { Modal } from "./Dialogs";
import { cx } from "./ui";

export function InspoManager({ onClose }: { onClose: () => void }) {
  const { sets, newSet, removeSet, renameSet, add, removeItem } = useInspo();
  const [cur, setCur] = useState(() => sets.find((x) => x.kind === "pose" && !x.id.startsWith("poses-"))?.id ?? sets[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const set = sets.find((x) => x.id === cur);
  const make = (kind: InspoKind) => { const id = newSet(kind === "pose" ? "My poses" : "My scenes", kind); setCur(id); rememberSet(kind, id); };
  const addTyped = () => {
    if (!set) return;
    for (const line of draft.split("\n").map((x) => x.trim()).filter(Boolean)) add(set.id, { text: line });
    setDraft("");
  };
  return (
    <Modal onClose={onClose} label="Scenes and pose collections" width={720}>
      <div className="flex max-h-[76vh] flex-col gap-3 p-5">
        <h2 className="display text-lg">Scenes &amp; poses</h2>
        <div className="flex flex-wrap gap-1.5">
          {sets.map((x) => (
            <button key={x.id} onClick={() => { setCur(x.id); rememberSet(x.kind, x.id); }} aria-pressed={cur === x.id}
              className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", cur === x.id && "on")}>{x.kind === "scene" ? "Scenes · " : ""}{x.name} ({x.items.length})</button>
          ))}
          <button onClick={() => make("pose")} className="press h-7 px-2 text-[12px] text-muted hover:text-ink">+ Pose collection</button>
          <button onClick={() => make("scene")} className="press h-7 px-2 text-[12px] text-muted hover:text-ink">+ Scene collection</button>
        </div>
        {set && (
          <>
            <div className="flex items-center gap-2">
              <input value={set.name} onChange={(e) => renameSet(set.id, e.target.value)} className="inset h-8 flex-1 border px-2 text-[13px] focus:border-accent focus:outline-none" aria-label="Collection name" />
              <button onClick={() => { removeSet(set.id); setCur(sets.find((x) => x.id !== set.id)?.id ?? ""); }} className="press btn-raised h-8 rounded-md px-3 text-[12px] !text-bad">Delete collection</button>
            </div>
            <p className="text-[12px] text-dim">{set.kind === "scene"
              ? "Right-click any CivitAI picture → Save as scene inspiration. Its setting, light, camera and finish are borrowed; its person never is."
              : "One pose per item, written limb by limb works best (weight, legs, hands, torso, head). Right-click a picture → Save its pose, or type them here."}</p>
            <div className="flex gap-2">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={set.kind === "pose" ? "Type a pose (one per line), e.g. sitting on a kitchen counter, one knee up, leaning back on both hands" : "Paste a prompt to use as a scene"}
                className="inset flex-1 resize-y border px-2 py-1.5 text-[12.5px] focus:border-accent focus:outline-none" />
              <button onClick={addTyped} disabled={!draft.trim()} className="press btn-primary chamfer-sm h-9 self-end rounded-lg px-4 text-[13px] font-semibold disabled:opacity-50">Add</button>
            </div>
            <div className="grid min-h-0 gap-1.5 overflow-y-auto pr-1">
              {set.items.map((it) => (
                <div key={it.id} className="flex items-start gap-2 border border-line2 p-2">
                  {it.thumb && <img src={it.thumb} alt="" className="h-14 w-11 shrink-0 object-cover" loading="lazy" />}
                  <p className="line-clamp-3 flex-1 text-[12px] leading-snug text-muted">{it.text}</p>
                  <button onClick={() => removeItem(set.id, it.id)} className="press shrink-0 text-[12px] text-dim hover:text-bad" aria-label="Remove">Remove</button>
                </div>
              ))}
              {!set.items.length && <p className="text-[12.5px] text-dim">Nothing here yet.</p>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
