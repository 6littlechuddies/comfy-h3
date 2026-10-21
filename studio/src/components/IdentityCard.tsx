import { viewUrl } from "../lib/api";
import { faceView, useCharacters, VIEWS, type Character, type View } from "../lib/characters";
import { cx } from "./ui";

const FACES: View[] = ["face", "front", "threeq", "smile", "left", "right"];

/** a character's identity card: the face picture every face pass and face check uses, their LoRAs and trigger word, and
 *  whether Edit fills in their picture and LoRAs by itself */
export function IdentityCard({ c }: { c: Character }) {
  const save = (p: Partial<NonNullable<Character["identity"]>>) => useCharacters.getState().save({ ...c, identity: { ...c.identity, ...p } });
  const have = FACES.filter((v) => c.views[v]);
  const best = faceView(c);
  const loras = (c.loras ?? []).filter((l) => !l.off);
  const auto = c.identity?.auto !== false;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-raised/40 p-3 text-[12.5px]">
      <div className="flex items-baseline gap-2"><b className="font-medium">Identity card</b><span className="text-[11.5px] text-dim">what the Studio uses for {c.name} by itself</span></div>
      <div className="flex flex-wrap items-end gap-1.5">
        <span className="w-full text-[11.5px] text-muted">Best face picture — the face pass, face checks and training sets match to it</span>
        {have.length ? have.map((v) => (
          <button key={v} onClick={() => save({ face: v })} aria-pressed={best === v} title={VIEWS.find((x) => x.id === v)?.label}
            className={cx("press relative h-14 w-11 overflow-hidden border", best === v ? "border-accent" : "border-line opacity-50 hover:opacity-90")}>
            <img src={viewUrl(c.views[v]!)} alt={v} className="h-full w-full object-cover" />
            <span className="micro absolute inset-x-0 bottom-0 bg-black/70 text-center text-[8px] text-white/85">{(VIEWS.find((x) => x.id === v)?.label ?? v).split(" ")[0]}</span>
          </button>
        )) : <span className="text-dim">Add their front picture first</span>}
      </div>
      <p className="text-[11.5px] text-muted"><b className="font-medium text-ink/85">LoRAs:</b> {loras.length ? loras.map((l) => `${l.name.split("/").pop()!.replace(/\.safetensors$/, "")} ${l.strength.toFixed(2)}`).join(" · ") : "none yet — a trained character LoRA goes here"}
        {c.trainset?.trigger ? <> · <b className="font-medium text-ink/85">trigger</b> {c.trainset.trigger}</> : null}</p>
      <label className="flex cursor-pointer items-start gap-2 text-[11.5px] leading-relaxed text-muted">
        <input type="checkbox" className="mt-0.5" checked={auto} onChange={(e) => save({ auto: e.target.checked })} />
        <span>Use automatically — in Edit, “Copy the pose” and “Put in the scene” get {c.name}'s picture as picture 2 and their LoRAs, without you adding them.</span>
      </label>
    </div>
  );
}
