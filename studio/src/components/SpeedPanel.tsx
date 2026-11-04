// ⋯ → Speed-ups: each speed-up's switch (all on by default), and what this rental can do.
import { createPortal } from "react-dom";
import { create } from "zustand";
import { SPEED_DEFAULTS, SPEED_INFO, setSpeed, useSpeed, type Speed } from "../lib/speed";
import { useCards } from "../lib/cards";
import { Icon, cx } from "./ui";

const useOpen = create<{ open: boolean }>(() => ({ open: false }));
export const openSpeed = () => useOpen.setState({ open: true });

export function SpeedHost() {
  const open = useOpen((s) => s.open);
  const sp = useSpeed();
  const cards = useCards();
  if (!open) return null;
  const close = () => useOpen.setState({ open: false });
  const keys = Object.keys(SPEED_INFO) as (keyof Speed)[];
  const allDefault = keys.every((k) => sp[k] === SPEED_DEFAULTS[k]);
  return createPortal(
    <div className="fade-in fixed inset-0 z-[85] flex items-start justify-center bg-black/55 px-4 pt-[12vh]" onMouseDown={close} role="dialog" aria-modal aria-label="Speed-ups">
      <div className="w-full max-w-lg rounded-xl border border-line bg-raised2 p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-[16px] font-semibold text-ink">Speed-ups</h2>
          <button onClick={close} aria-label="Close" className="press ml-auto flex h-8 w-8 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={16} /></button>
        </div>
        <p className="mt-1 text-[12.5px] text-muted">All on by default. If something fails or looks worse, switch the one it names off — the change applies to the next job.</p>
        <div className="mt-4 grid gap-2">
          {keys.map((k) => (
            <label key={k} className={cx("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5", sp[k] ? "border-accent/50 bg-accent/[.05]" : "border-line")}>
              <input type="checkbox" className="mt-1" checked={!!sp[k]} onChange={(e) => setSpeed({ [k]: e.target.checked } as Partial<Speed>)} />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-ink">{SPEED_INFO[k].title}</span>
                <span className="block text-[12px] leading-relaxed text-muted">{SPEED_INFO[k].sub}</span>
                {k === "fastAttn" && sp.kitchen === false && <span className="mt-0.5 block text-[12px] text-[#f0a845]">This rental's ComfyUI doesn't have it, so it isn't used here.</span>}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-dim">Cards: {cards.cards}{cards.cards > 1 ? ` — jobs go one per card${cards.raylight ? "; videos and single Krea 2 pictures can be split across them" : ""}` : ""}.</p>
        {!allDefault && <button onClick={() => setSpeed(SPEED_DEFAULTS)} className="mt-3 text-[12.5px] text-muted underline hover:text-ink">Back to the defaults (all on)</button>}
      </div>
    </div>, document.body);
}
