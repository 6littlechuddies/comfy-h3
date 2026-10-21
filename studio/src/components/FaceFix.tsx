import { useGroup } from "../lib/downloads";
import { Slider } from "./ui";

/** "Sharpen the face after": SAM 3 finds the face, Krea 2 Edit redraws it sharper looking at the character's own picture */
export function FaceFix({ on, strength, onChange }: { on: boolean; strength: number; onChange: (p: { on?: boolean; strength?: number }) => void }) {
  const sam = useGroup("sam");
  const kedit = useGroup("kedit");
  const ready = sam.ready && kedit.ready;
  return (
    <div className="-mt-2 flex flex-col gap-2">
      <label className="flex cursor-pointer items-start gap-2 text-[12px] leading-relaxed text-muted" title="After each picture of a person, the face is found by SAM 3 and redrawn at full size, then pasted back. With a character picked, their own picture shows the model who it is.">
        <input type="checkbox" className="mt-0.5" checked={on} onChange={(e) => onChange({ on: e.target.checked })} />
        <span><b className="font-medium text-ink">Sharpen the face after</b> — a second pass on the face only: crisper eyes, skin and lashes, still their face. Adds about half a minute per picture.</span>
      </label>
      {on && !ready && <p className="text-[11.5px] text-muted">{!sam.ready ? sam.why : kedit.ready ? "" : kedit.why} — the face pass starts working once it's in.</p>}
      {on && <Slider label="How much the face is redrawn" min={0.2} max={0.7} step={0.05} value={strength} show={`${Math.round(strength * 100)}%`} onChange={(v) => onChange({ strength: v })} />}
    </div>
  );
}
