import { useBatch } from "../lib/batch";
import type { Character } from "../lib/characters";
import { Seg, TextIn, cx } from "./ui";
import { useGroup } from "../lib/downloads";
import { stopSwaps, useSwapRun } from "../lib/batchSwap";

/** Batch (pictures): a photo set from pictures you found — each picture × each ticked character, face only or the whole
 *  person, filed into a site set */
export function PhotoSet({ chars }: { chars: Character[] }) {
  const b = useBatch();
  const stars = b.stars ?? [];
  const toggle = (id: string) => b.set({ stars: stars.includes(id) ? stars.filter((x) => x !== id) : [...stars, id] });
  const pics = b.rows.filter((r) => r.imitate?.kind === "image").length;
  const qwen = useGroup("qwen");
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-raised/40 p-3 text-[12.5px]">
      <b className="font-medium">Put your character into pictures you found</b>
      <span className="-mt-1.5 text-[11.5px] text-dim">Drop pictures on the right — files, a downloaded set, or drag them straight from a Pinterest tab — or pick several in CivitAI → “Pick several → Batch”. Each one is made with every character you tick.</span>
      <div className="flex flex-wrap gap-1">
        {chars.map((c) => <button key={c.id} onClick={() => toggle(c.id)} aria-pressed={stars.includes(c.id)} className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", stars.includes(c.id) && "on")}>{c.name}</button>)}
      </div>
      <Seg label="What happens to each picture" value={b.take ?? "swap"} onChange={(v) => b.set({ take: v })}
        options={[{ value: "swap", label: "Swap in" }, { value: "face", label: "Face only" }, { value: "person", label: "Whole person" }]} />
      <p className="-mt-1.5 text-[11.5px] text-dim">{(b.take ?? "swap") === "swap"
        ? "Best. The person in each picture becomes your character — pose, hands, framing, light and place stay. The same steps as Edit chat's swap: the writer reads the picture (no prompt needed — Pinterest and any photo work), Qwen swaps, Krea 2 repaints with their LoRA, then the face pass and face check. One picture at a time, run from this page: keep it open until it's done."
        : (b.take ?? "swap") === "face" ? "Fast. The picture stays — body, outfit, pose, place; only the face and hair become theirs. Queued on the rental at once (the page can close)." : "Fast. The picture's pose and place; the person becomes yours, in their own outfit. Krea 2 Edit with two pictures — quicker, but a second person can appear. Queued at once."}</p>
      {(b.take ?? "swap") === "swap" && <>
        <Seg label="Outfit" value={b.swapOutfit ?? "theirs"} onChange={(v) => b.set({ swapOutfit: v })} options={[{ value: "theirs", label: "Their own" }, { value: "picture", label: "The picture's" }]} />
        {!qwen.ready && <p className="text-[11.5px] text-hot">Swap in needs the Edit chat helper (Qwen-Image-Edit): {qwen.why ?? "not downloaded yet"}. Until then use Face only or Whole person.</p>}
        <SwapProgress />
        <span className="text-[11.5px] text-dim">A picture with several people: write which one in its row ("the woman on the left"). Anything else you write in a row is added to that picture's instruction.</span>
      </>}
      <TextIn label="Put them in the site set (optional)" value={b.setTitle ?? ""} onChange={(v) => b.set({ setTitle: v })} placeholder="e.g. Pinterest picks · October" />
      {(b.setTitle ?? "").trim() && <Seg label="Set" value={b.tier ?? "premium"} onChange={(v) => b.set({ tier: v })} options={[{ value: "premium", label: "Premium" }, { value: "free", label: "Free" }]} />}
      {(b.take ?? "swap") !== "swap" && <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted"><input type="checkbox" className="mt-0.5" checked={!!b.faceFix} onChange={(e) => b.set({ faceFix: e.target.checked })} />
        <span>Sharpen each face as that character afterwards (SAM 3 face pass)</span></label>}
      <span className="text-[11.5px] text-muted">{pics} picture{pics === 1 ? "" : "s"} × {stars.length || (b.characterId ? 1 : 0)} character{stars.length === 1 ? "" : "s"} = {pics * (stars.length || (b.characterId ? 1 : 0))} results{stars.length ? " (the Star above is ignored while characters are ticked here)" : ""}</span>
    </div>
  );
}

/** the swap run: which picture it's on, how many are done, Stop */
function SwapProgress() {
  const r = useSwapRun();
  if (!r.running && !r.done && !r.failed) return null;
  const pct = r.total ? Math.round(((r.done + r.failed) / r.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5 border border-accent/50 bg-accent/5 p-2">
      <div className="flex items-center gap-2 text-[12px]">
        <b className="font-medium">{r.running ? r.now || "Starting…" : `Done: ${r.done} of ${r.total}`}</b>
        {r.running && <button className="ml-auto text-[11.5px] text-muted hover:text-bad" onClick={stopSwaps} title="Finishes the picture it's on, then stops">{r.stopAsked ? "Stopping after this one…" : "Stop"}</button>}
      </div>
      <div className="h-1.5 bg-raised2"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
      <span className="text-[11px] text-dim">{r.done} done{r.failed ? ` · ${r.failed} failed` : ""} of {r.total}{r.running ? " · keep this page open" : ""}</span>
    </div>
  );
}
