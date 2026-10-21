import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { planExactRows, planRows } from "../lib/batch";
import { isAdult, useCharacters } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { useInspo } from "../lib/inspo";
import { InspoManager } from "./InspoManager";
import { Btn, DropSelect, Seg, cx } from "./ui";

const THEMES = "beach at dusk\ncozy bedroom with warm lamp light\ngym with mirrors\ncity street at night with neon signs";
const POSES = "standing, hand on hip, looking at the camera\nsitting on the edge of the bed, legs crossed\nover-the-shoulder glance, from behind\nclose-up portrait, soft smile";

/** Batch → Content plan: characters × backgrounds × poses → a row each, sorted into site sets by background */
export function ContentPlan() {
  const chars = useCharacters(useShallow((s) => s.list.filter(isAdult)));
  const sel = useCharacters((s) => s.sel);
  const toast = useJobs((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<string[]>(sel ? [sel] : []);
  const [themes, setThemes] = useState(THEMES);
  const [poses, setPoses] = useState(POSES);
  const [takes, setTakes] = useState(1);
  const [tier, setTier] = useState<"free" | "premium">("premium");
  const [face, setFace] = useState(true);
  const sets = useInspo((s) => s.sets);
  const [sceneSet, setSceneSet] = useState("");
  const [poseSet, setPoseSet] = useState("");
  const [per, setPer] = useState(0);
  const [vary, setVary] = useState(true);
  const [manage, setManage] = useState(false);
  const [exact, setExact] = useState(false);
  const [filling, setFilling] = useState<string | null>(null);
  const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
  const scSet = sets.find((x) => x.id === sceneSet && x.kind === "scene");
  const poSet = sets.find((x) => x.id === poseSet && x.kind === "pose");
  const scenes = scSet ? scSet.items.map((it, i) => ({ text: it.text, title: `${scSet.name} ${i + 1}` })) : undefined;
  const poseList = poSet ? poSet.items.map((x) => x.text) : lines(poses);
  const nPlaces = scenes ? scenes.length : Math.max(1, lines(themes).length);
  const nPoses = Math.max(1, per ? Math.min(per, poseList.length || 1) : poseList.length);
  const n = who.length * nPlaces * nPoses;
  const fill = async () => {
    if (scSet && exact) {
      setFilling("Starting…");
      try {
        const n2 = await planExactRows({ charIds: who, items: scSet.items.map((it, i) => ({ url: it.url || it.thumb || "", title: `${scSet.name} ${i + 1}` })).filter((x) => x.url), tier, faceFix: face, onStep: setFilling });
        toast(`${n2} rows: each saved picture with your character swapped in (exact pose, their sheet view at the same angle). Press Queue — they run one by one, keep this page open.`, "good", "batch");
        setOpen(false);
      } catch (e) { toast((e as Error).message, "bad", "batch"); } finally { setFilling(null); }
      return;
    }
    const rows = planRows({ charIds: who, themes: lines(themes), poses: poseList, takes, tier, faceFix: face, scenes, vary, posesPer: per });
    toast(`${rows} rows in the queue (${rows * takes} pictures) — check them, then Queue. Each lands in the character's “<background>” ${tier} set as it's done.`, "good", "batch");
    setOpen(false);
  };
  if (!open) return (
    <div className="flex flex-col gap-2">
      <AutoPlanBox />
      <Btn onClick={() => setOpen(true)} className="w-full">Content plan · pick backgrounds × poses yourself</Btn>
    </div>
  );
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-accent/40 bg-raised/50 p-3 text-[12.5px]">
      <div className="flex items-center"><b className="font-medium">Content plan</b><button className="ml-auto text-[12px] text-muted hover:text-ink" onClick={() => setOpen(false)}>close</button></div>
      <div className="flex flex-wrap gap-1">
        {chars.map((c) => (
          <button key={c.id} onClick={() => setWho((w) => (w.includes(c.id) ? w.filter((x) => x !== c.id) : [...w, c.id]))} aria-pressed={who.includes(c.id)}
            className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", who.includes(c.id) && "on")}>{c.name}</button>
        ))}
      </div>
      <label className="flex flex-col gap-1"><span className="text-muted">Backgrounds</span>
        <DropSelect value={sceneSet} onChange={(e) => setSceneSet(e.target.value)} className="inset h-9 border px-2 text-[12.5px]">
          <option value="">Typed below</option>
          {sets.filter((x) => x.kind === "scene").map((x) => <option key={x.id} value={x.id}>Saved scenes · {x.name} ({x.items.length})</option>)}
        </DropSelect></label>
      {scSet
        ? <p className="-mt-1 text-[11.5px] leading-relaxed text-dim">{scSet.items.length ? `Each saved CivitAI prompt lends its setting, light, camera and photo finish — never its person. Your character's own look goes in. Each scene is its own site set.` : "No scenes saved yet — right-click a CivitAI picture → Save as scene inspiration."}</p>
        : null}
      {scSet && scSet.items.length > 0 && (
        <Seg label="Use each saved picture" value={exact ? "exact" : "inspired"} onChange={(v) => setExact(v === "exact")}
          options={[{ value: "inspired", label: "New picture inspired by it" }, { value: "exact", label: "Exact pose — put them in it" }]} />
      )}
      {scSet && exact && <p className="-mt-1 text-[11.5px] leading-relaxed text-dim">The saved picture itself is used: your character replaces the person in it — same pose, framing, light and place — using their sheet picture at the same angle (a back shot gets their back view). Poses below are ignored.</p>}
      {!scSet && <label className="flex flex-col gap-1"><span className="text-muted">One per line (each becomes a site set)</span>
          <textarea value={themes} onChange={(e) => setThemes(e.target.value)} rows={4} className="inset resize-y border px-2 py-1.5 text-[12.5px] focus:border-accent focus:outline-none" /></label>}
      <label className="flex flex-col gap-1"><span className="text-muted">Poses</span>
        <DropSelect value={poseSet} onChange={(e) => setPoseSet(e.target.value)} className="inset h-9 border px-2 text-[12.5px]">
          <option value="">Typed below</option>
          {sets.filter((x) => x.kind === "pose").map((x) => <option key={x.id} value={x.id}>{x.name} ({x.items.length})</option>)}
        </DropSelect></label>
      {!poSet && <textarea value={poses} onChange={(e) => setPoses(e.target.value)} rows={4} className="inset resize-y border px-2 py-1.5 text-[12.5px] focus:border-accent focus:outline-none" />}
      <Seg label="Poses per background" value={per} onChange={setPer} options={[{ value: 0, label: "All" }, ...[1, 2, 3, 4].map((x) => ({ value: x, label: String(x) }))]} />
      <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted"><input type="checkbox" className="mt-0.5" checked={vary} onChange={(e) => setVary(e.target.checked)} />
        <span>A different expression and head angle in every picture (laughing, smirking, looking away, profile…) — no same-face sets</span></label>
      <button className="self-start text-[12px] text-muted underline decoration-dotted hover:text-ink" onClick={() => setManage(true)}>Manage scenes &amp; pose collections</button>
      {manage && <InspoManager onClose={() => setManage(false)} />}
      <Seg label="Pictures of each" value={takes} onChange={setTakes} options={[1, 2, 3, 4].map((x) => ({ value: x, label: `×${x}` }))} />
      <Seg label="Site sets" value={tier} onChange={setTier} options={[{ value: "premium", label: "Premium" }, { value: "free", label: "Free" }]} />
      <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted"><input type="checkbox" className="mt-0.5" checked={face} onChange={(e) => setFace(e.target.checked)} />
        <span>Sharpen each face as that character (SAM 3 face pass) before it goes into the set</span></label>
      <Btn kind="primary" onClick={fill} disabled={!who.length || !n || !!filling} why={filling ?? "Pick at least one character"}>{filling ?? (scSet && exact ? `Fill the queue · ${who.length * scSet.items.length} pictures (exact pose)` : `Fill the queue · ${n} row${n === 1 ? "" : "s"} · ${n * takes} pictures`)}</Btn>
      <p className="text-[11.5px] leading-relaxed text-dim">Queue it before bed: everything runs on the rental with this page closed, and your phone gets one alert when it's all done (set alerts below). In the morning, ⋯ → Your site shows the new sets to check and send as drafts.</p>
    </div>
  );
}

/** one click: the writer (or your Grok tab) plans sets that fit each picked character, writes every prompt, queues it all */
function AutoPlanBox() {
  const chars = useCharacters(useShallow((s) => s.list.filter((c) => isAdult(c) && c.style === "realistic" && c.views.front)));
  const sel = useCharacters((s) => s.sel);
  const sets = useInspo((s) => s.sets);
  const toast = useJobs((s) => s.toast);
  const [who, setWho] = useState<string[]>(sel ? [sel] : []);
  const [n, setN] = useState(4);
  const [per, setPer] = useState(6);
  const [mix, setMix] = useState<"sfw" | "mixed" | "bold">("mixed");
  const [backdrop, setBackdrop] = useState<"places" | "plain">("places");
  const [poseSet, setPoseSet] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState(() => { try { return localStorage.getItem("h3.autoplan.review") !== "off"; } catch { return true; } });
  const go = async () => {
    setBusy("Starting…");
    try {
      const { planAndQueue } = await import("../lib/autoPlan");
      const r = await planAndQueue(chars.filter((c) => who.includes(c.id)), { sets: n, per, mix, backdrop, poseSet: poseSet || undefined, faceFix: true }, setBusy, review);
      toast(review ? `${r.rows} prompts written into the rows below — read or edit any of them, then press Queue.` : `Planned and queued ${r.jobs} pictures in ${n * who.length} sets — each lands in its site set as it's done.`, "good", "batch");
    } catch (e) { toast((e as Error).message, "bad", "batch"); } finally { setBusy(null); }
  };
  const total = who.length * n * per;
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-accent/50 bg-accent/[.04] p-3 text-[12.5px]">
      <b className="font-medium">Plan it for me</b>
      <p className="-mt-1.5 text-[11.5px] leading-relaxed text-dim">Pick characters — the writer (or your Grok tab) plans sets that fit who they are, a different pose and angle per picture, writes every prompt and queues it. Pictures come from their sheet, so back and side shots use their back and side views.</p>
      <div className="flex flex-wrap gap-1">
        {chars.map((c) => (
          <button key={c.id} onClick={() => setWho((w) => (w.includes(c.id) ? w.filter((x) => x !== c.id) : [...w, c.id]))} aria-pressed={who.includes(c.id)}
            className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", who.includes(c.id) && "on")}>{c.name}</button>
        ))}
        {!chars.length && <span className="text-dim">No realistic characters with a front picture yet.</span>}
      </div>
      <Seg label="Sets each" value={n} onChange={setN} options={[2, 3, 4, 6].map((x) => ({ value: x, label: String(x) }))} />
      <Seg label="Pictures per set" value={per} onChange={setPer} options={[4, 6, 8, 10].map((x) => ({ value: x, label: String(x) }))} />
      <Seg label="How bold" value={mix} onChange={setMix} options={[{ value: "sfw", label: "All free" }, { value: "mixed", label: "Half premium" }, { value: "bold", label: "Mostly premium" }]} />
      <Seg label="Backgrounds" value={backdrop} onChange={setBackdrop} options={[{ value: "places", label: "Places that fit them" }, { value: "plain", label: "Plain backdrop" }]} />
      <label className="flex flex-col gap-1"><span className="text-muted">Pose ideas (optional)</span>
        <DropSelect value={poseSet} onChange={(e) => setPoseSet(e.target.value)} className="inset h-9 border px-2 text-[12.5px]">
          <option value="">The writer's own</option>
          {sets.filter((x) => x.kind === "pose").map((x) => <option key={x.id} value={x.id}>{x.name} ({x.items.length})</option>)}
        </DropSelect></label>
      <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted"><input type="checkbox" className="mt-0.5" checked={review} onChange={(e) => { setReview(e.target.checked); try { localStorage.setItem("h3.autoplan.review", e.target.checked ? "on" : "off"); } catch { /* */ } }} />
        <span>Let me read the prompts before anything is made (they appear in each row below; then press Queue)</span></label>
      <Btn kind="primary" onClick={go} disabled={!who.length || !!busy} why={busy ?? "Pick at least one character"}>{busy ?? (review ? `Plan & write · ${total} prompts` : `Plan, write & queue · ${total} pictures`)}</Btn>
    </div>
  );
}
