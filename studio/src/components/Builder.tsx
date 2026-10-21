// Characters → Build a training set: many new pictures of the character from their one picture, each checked against
// their face, the good ones captioned and downloaded as a .zip for a LoRA trainer.
import { useState } from "react";
import { viewUrl } from "../lib/api";
import { buildTrainSet, downloadSet, editCaption, isBuilding, recheck, removeItem, setTrainOpts, toggleKeep, triggerOf, addToSet } from "../lib/builder";
import { faceView, useCharacters, type Character, type TrainItem } from "../lib/characters";
import { useGroup } from "../lib/downloads";
import { friendlyError, useJobs } from "../lib/jobs";
import { openViewer } from "./Viewer";
import { TrainHere } from "./TrainHere";
import { Btn, Label, Seg, Slider, Slot, TextIn, cx } from "./ui";

const SHOT_LABEL: Record<TrainItem["shot"], string> = { close: "close-up", half: "half-body", full: "full-body" };

export function TrainSetMaker({ c, back }: { c: Character; back: () => void }) {
  const toast = useJobs((s) => s.toast);
  const kedit = useGroup("kedit");
  const writer = useGroup("writer");
  const [count, setCount] = useState(24);
  const [open, setOpen] = useState<string | null>(null);
  const t = c.trainset;
  const items = t?.items ?? [];
  const kept = items.filter((x) => x.keep && x.file);
  const busy = items.some((x) => x.status === "making" || x.status === "checking") || isBuilding();
  const min = t?.minScore ?? 7;
  const scored = items.filter((x) => typeof x.score === "number");
  const avg = scored.length ? scored.reduce((a, x) => a + (x.score as number), 0) / scored.length : null;
  const mix = (["close", "half", "full"] as const).map((s) => `${kept.filter((x) => x.shot === s).length} ${SHOT_LABEL[s]}`).join(" · ");
  const sel = items.find((x) => x.id === open) ?? null;

  const start = async () => {
    try {
      toast(`Making ${count} pictures of ${c.name}, then checking each face — the pictures come first, the checks after.`, "info", "characters");
      await buildTrainSet(c, count);
      const now = useCharacters.getState().list.find((x) => x.id === c.id)?.trainset;
      const failed = now?.items.filter((x) => x.status === "failed").length ?? 0;
      toast(`${c.name}'s set is checked: ${now?.items.filter((x) => x.keep).length ?? 0} kept${failed ? `, ${failed} failed (click a tile to see why)` : ""}.`, failed ? "bad" : "good", "characters");
    } catch (e) { toast((e as Error).message, "bad", "characters"); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <button className="text-[13px] text-accent hover:underline" onClick={back}>‹ {c.name}</button>
        <h2 className="display text-[20px] leading-tight">Training set</h2>
        <span className="max-w-3xl text-[13px] text-muted">New pictures of {c.name} in many shots, made from their picture. Each one's face is checked against it, and the ones that match are captioned and ready to train a character LoRA with.</span>
      </div>
      {(c.sheet?.style ?? c.style) === "anime" && <p className="border border-hot/50 bg-hot/5 px-3 py-2 text-[12.5px]">
        <b className="font-medium">Before you start:</b> {c.name} is an anime character. Training here makes Krea 2 (realistic) LoRAs only — for {c.name}, make the set here, then press <b>Download the set (.zip)</b> and train it with an SDXL / Illustrious or Anima trainer.</p>}
      <div className="flex gap-5">
        <div className="flex w-72 shrink-0 flex-col gap-3.5">
          <div>
            <Label>Compared with</Label>
            <div className="flex h-44 items-center justify-center overflow-hidden rounded-lg border border-line hatch">
              {faceView(c) ? <img src={viewUrl(c.views[faceView(c)!]!)} alt="" className="h-full w-full object-contain" /> : <span className="text-xs text-dim">Add their front picture first</span>}
            </div>
            <p className="mt-1 text-[11.5px] text-dim">Their best face picture (set on their identity card) — every new picture's face is scored against it.</p>
          </div>
          <div className="border border-line2 p-2.5 text-[11.5px] leading-relaxed text-muted">
            <b className="font-medium text-ink/90">LoRAs</b> — these pictures are made with Krea 2 Edit + the Identity Edit LoRA{(c.loras ?? []).filter((l) => !l.off).length ? <>, plus {c.name}'s own: {(c.loras ?? []).filter((l) => !l.off).map((l) => `${l.name.split("/").pop()!.replace(/\.safetensors$/, "")} ${l.strength.toFixed(1)}`).join(", ")}</> : <> (no LoRA of {c.name} yet — that's what this set is for)</>}.
            {" "}The LoRA you train from them goes on {c.name}'s identity card (their page) and is then used by itself whenever {c.name} is picked: Create, Edit, Edit chat, the face pass.
          </div>
          <TextIn label="Trigger word" value={t?.trigger ?? triggerOf(c.name)} onChange={(v) => setTrainOpts(c, { trigger: v.replace(/\s+/g, "").toLowerCase() })} />
          <p className="-mt-2.5 text-[11.5px] text-dim">A made-up word that begins every caption. You type it in prompts to call the trained LoRA.</p>
          <Seg label="How many" value={count} onChange={setCount} options={[{ value: 12, label: "12" }, { value: 24, label: "24" }, { value: 36, label: "36" }]} />
          <Slider label="Keep when the face scores at least" min={5} max={9} step={1} value={min} show={`${min} / 10`} onChange={(v) => setTrainOpts(c, { minScore: v })} />
          <Btn kind="primary" className="w-full" onClick={start} disabled={busy || !c.views.front || !kedit.ready || !writer.ready}
            why={!c.views.front ? "Add their front picture first" : !kedit.ready ? kedit.why : !writer.ready ? writer.why : "Building — wait for the checks"}>
            {items.length ? `Make ${count} more` : `Make ${count} pictures`}
          </Btn>
          <p className="-mt-2 text-[11.5px] leading-relaxed text-dim">About {Math.round(count * 0.4)} close-ups, {Math.round(count * 0.3)} half-body and {count - Math.round(count * 0.4) - Math.round(count * 0.3)} full-body shots, with different angles, expressions, outfits and places. Roughly 20–30 seconds each, then a few seconds per check.</p>
          <div>
            <Label>Add your own pictures</Label>
            <Slot className="h-24" value={null} label="Drop a picture of them" hint="it's checked like the others"
              onChange={(m) => { if (m) addToSet(c, { filename: m.name, subfolder: "", type: "input" }).catch((e) => toast((e as Error).message, "bad")); }} />
          </div>
          <div className="border-t border-line pt-3">
            <p className="text-[13px]"><b className="font-medium">{kept.length} kept</b> <span className="text-muted">of {items.length}{avg != null ? ` · average face score ${avg.toFixed(1)}` : ""}</span></p>
            {kept.length > 0 && <p className="text-[12px] text-muted">{mix}</p>}
            <p className={cx("mt-1 text-[11.5px]", kept.length >= 15 ? "text-good" : "text-dim")}>{kept.length >= 15 ? "Enough for a first LoRA (15–40 is the usual range)." : `Guides suggest 15–40 good pictures, about 20 is enough — ${Math.max(0, 15 - kept.length)} more to go.`}</p>
            <Btn className="mt-2 w-full" onClick={() => downloadSet(c).then((n) => toast(`Downloaded ${n} pictures with captions and a README with training settings`, "good")).catch((e) => toast((e as Error).message, "bad"))}
              disabled={!kept.length} why="Keep at least one picture">Download the set (.zip)</Btn>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-dim">Pictures with matching caption files, plus the trigger word and the starting settings — to train somewhere else, or keep.</p>
          </div>
          <TrainHere c={c} kept={kept} />
        </div>
        <div className="min-w-0 flex-1">
          {!items.length ? (
            <div className="flex h-80 items-center justify-center rounded-lg border border-dashed border-line text-center text-[13px] text-dim">
              <p className="max-w-sm leading-relaxed">The pictures appear here as they're made. Click one to see it big, read its check, and fix its caption. The tick decides what goes in the .zip.</p>
            </div>
          ) : (<>
            {(() => {
              const bad = items.filter((x) => x.status === "failed");
              if (!bad.length) return null;
              const why = [...new Set(bad.map((x) => friendlyError(x.why || "no reason given")))];
              return (
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border border-bad/50 bg-bad/5 px-3 py-2 text-[12.5px]">
                  <b className="font-medium">{bad.length} failed</b>
                  <span className="min-w-0 flex-1 text-muted">{why.slice(0, 2).join(" · ")}</span>
                  <button className="press border border-line px-2.5 py-1 text-[12px] hover:border-accent disabled:opacity-40" disabled={isBuilding()}
                    onClick={() => { bad.forEach((x) => removeItem(c, x)); buildTrainSet(c, bad.length).catch((e) => toast((e as Error).message, "bad", "characters")); }}>Retry them</button>
                  <button className="text-[12px] text-muted hover:text-ink" onClick={() => bad.forEach((x) => removeItem(c, x))}>Clear them</button>
                </div>
              );
            })()}
            <div className="grid grid-cols-3 gap-2.5 lg:grid-cols-4 2xl:grid-cols-6">
              {items.map((it) => (
                <div key={it.id} className={cx("flex flex-col gap-1 rounded-lg border p-1", it.keep ? "border-good/60" : "border-line", open === it.id && "ring-2 ring-accent")}>
                  <button className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md bg-raised hatch" onClick={() => setOpen(open === it.id ? null : it.id)} aria-label="Details">
                    {it.file ? <img src={viewUrl(it.file)} alt="" className={cx("h-full w-full object-cover", !it.keep && it.status === "done" && "opacity-45")} />
                      : <span className="px-2 text-center text-[11px] text-dim" title={it.status === "failed" ? friendlyError(it.why || "") : undefined}>{it.status === "failed" ? "failed — see above" : "making…"}</span>}
                    {it.status === "checking" && it.file && <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10.5px]">checking the face…</span>}
                    {it.status === "done" && <span className={cx("absolute left-1 top-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium",
                      typeof it.score !== "number" ? "bg-black/70 text-muted" : it.score >= min ? "bg-good/85 text-black" : "bg-bad/85 text-white")}>{typeof it.score === "number" ? it.score : "–"}</span>}
                  </button>
                  <label className="flex items-center gap-1.5 px-0.5 text-[11.5px] text-muted">
                    <input type="checkbox" checked={!!it.keep} disabled={!it.file} onChange={() => toggleKeep(c, it)} />
                    <span className="flex-1 truncate">{SHOT_LABEL[it.shot]}</span>
                  </label>
                </div>
              ))}
            </div>
          </>)}
          {sel && (
            <div className="mt-4 flex gap-4 rounded-lg border border-line bg-raised/60 p-3">
              {sel.file && <img src={viewUrl(sel.file)} alt="" className="h-56 w-56 shrink-0 cursor-zoom-in rounded-md object-contain" onClick={() => openViewer([{ url: viewUrl(sel.file!), kind: "image", label: `${c.name} · ${SHOT_LABEL[sel.shot]}` }], 0)} />}
              <div className="flex min-w-0 flex-1 flex-col gap-2 text-[12.5px]">
                <p><b className="font-medium">Face check:</b> {sel.status !== "done" ? sel.status : typeof sel.score === "number" ? `${sel.score} / 10` : "not checked (face not visible)"}{sel.why ? ` — ${sel.why}` : ""}</p>
                <TextIn label="Caption (what the trainer reads with this picture)" value={sel.caption} onChange={(v) => editCaption(c, sel, v)} />
                <details className="text-[11.5px] text-dim"><summary className="cursor-pointer">What Krea 2 was told</summary><p className="mt-1 leading-relaxed">{sel.prompt}</p></details>
                <div className="mt-auto flex gap-2">
                  <Btn small onClick={() => recheck(c, sel).catch((e) => toast((e as Error).message, "bad"))} disabled={!sel.file || sel.status === "checking"} why="Checking…">Check again</Btn>
                  <Btn small kind="danger" onClick={() => { removeItem(c, sel); setOpen(null); }}>Remove</Btn>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
