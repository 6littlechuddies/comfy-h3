import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { planExactRows, planRows } from "../lib/batch";
import { isAdult, useCharacters } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { useInspo } from "../lib/inspo";
import { ALL_MASTER_PACK_KEYS, MASTER_PACKS, SOLO_MASTER_PACK_KEYS, masterPackRef, v9PackStatus, type MasterPackKey } from "../lib/masterPack";
import type { Media } from "../lib/tray";
import { InspoManager } from "./InspoManager";
import { Btn, DropSelect, Seg, Slot, cx } from "./ui";

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
      <V9MasterPackBox />
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
  const chars = useCharacters(useShallow((s) => s.list.filter((c) => isAdult(c) && (c.views.front || c.cover))));
  const sel = useCharacters((s) => s.sel);
  const sets = useInspo((s) => s.sets);
  const toast = useJobs((s) => s.toast);
  const [who, setWho] = useState<string[]>(sel ? [sel] : []);
  const [n, setN] = useState(3);
  const [per, setPer] = useState(10);
  const [mix, setMix] = useState<"progression" | "sfw" | "mixed" | "bold">("progression");
  const [backdrop, setBackdrop] = useState<"places" | "plain">("places");
  const [poseSet, setPoseSet] = useState("");
  const [usePoseWear, setUsePoseWear] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState(() => { try { return localStorage.getItem("h3.autoplan.review") !== "off"; } catch { return true; } });
  const go = async () => {
    setBusy("Starting…");
    try {
      const { planAndQueue } = await import("../lib/autoPlan");
      const r = await planAndQueue(chars.filter((c) => who.includes(c.id)), { sets: n, per, mix, backdrop, poseSet: poseSet || undefined, faceFix: false, usePoseWear }, setBusy, review);
      toast(review ? `${r.rows} prompts written into the rows below — read or edit any of them, then press Queue.` : `Planned and queued ${r.jobs} pictures in ${n * who.length} sets — each lands in its site set as it's done.`, "good", "batch");
    } catch (e) { toast((e as Error).message, "bad", "batch"); } finally { setBusy(null); }
  };
  const total = who.length * n * per;
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-accent/50 bg-accent/[.04] p-3 text-[12.5px]">
      <div className="flex items-center gap-2">
        <b className="font-medium">Photo packs · Plan it for me</b>
        {chars.length > 1 && (
          <button onClick={() => setWho(who.length === chars.length ? [] : chars.map((c) => c.id))}
            className="ml-auto text-[11.5px] text-accent hover:underline">{who.length === chars.length ? "Clear all" : `Select all (${chars.length})`}</button>
        )}
      </div>
      <p className="-mt-1.5 text-[11.5px] leading-relaxed text-dim">Plans non-repetitive sets from each character's world &amp; facts (SFW → Suggestive → Explicit), auto-pairs PoseWear depth poses, keeps her face &amp; LoRAs, and sorts each finished shot into her site sets.</p>
      <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
        {chars.map((c) => (
          <button key={c.id} onClick={() => setWho((w) => (w.includes(c.id) ? w.filter((x) => x !== c.id) : [...w, c.id]))} aria-pressed={who.includes(c.id)}
            className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", who.includes(c.id) && "on")}>{c.site?.name || c.name}</button>
        ))}
        {!chars.length && <span className="text-dim">No characters with a front picture yet.</span>}
      </div>
      <Seg label="Sets each" value={n} onChange={setN} options={[2, 3, 4, 6].map((x) => ({ value: x, label: String(x) }))} />
      <Seg label="Pictures per set" value={per} onChange={setPer} options={[4, 6, 8, 10].map((x) => ({ value: x, label: String(x) }))} />
      <Seg label="Progression" value={mix} onChange={setMix} options={[{ value: "progression", label: "SFW → Explicit" }, { value: "sfw", label: "All free" }, { value: "mixed", label: "Half premium" }, { value: "bold", label: "Mostly premium" }]} />
      <Seg label="Backgrounds" value={backdrop} onChange={setBackdrop} options={[{ value: "places", label: "Places that fit them" }, { value: "plain", label: "Plain backdrop" }]} />
      <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted"><input type="checkbox" className="mt-0.5" checked={usePoseWear} onChange={(e) => setUsePoseWear(e.target.checked)} />
        <span>Auto-pick unique PoseWear depth poses per shot (non-repeating poses, depth silhouette only)</span></label>
      <label className="flex flex-col gap-1"><span className="text-muted">Extra pose ideas (optional)</span>
        <DropSelect value={poseSet} onChange={(e) => setPoseSet(e.target.value)} className="inset h-9 border px-2 text-[12.5px]">
          <option value="">The writer's own</option>
          {sets.filter((x) => x.kind === "pose").map((x) => <option key={x.id} value={x.id}>{x.name} ({x.items.length})</option>)}
        </DropSelect></label>
      <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted"><input type="checkbox" className="mt-0.5" checked={review} onChange={(e) => { setReview(e.target.checked); try { localStorage.setItem("h3.autoplan.review", e.target.checked ? "on" : "off"); } catch { /* */ } }} />
        <span>Let me read the prompts before anything is made (they appear in each row below; then press Queue)</span></label>
      <Btn kind="primary" onClick={go} disabled={!who.length || !total || !!busy} why={busy ?? "Pick at least one character"}>{busy ?? (review ? `Plan & write · ${total} prompts` : `Plan, write & queue · ${total} pictures`)}</Btn>
    </div>
  );
}

const V9_SETS_KEY = "h3.v9pack.sets";
function loadV9Sets(): MasterPackKey[] {
  try {
    const raw = JSON.parse(localStorage.getItem(V9_SETS_KEY) || "null");
    if (Array.isArray(raw)) {
      const valid = raw.filter((k): k is MasterPackKey => ALL_MASTER_PACK_KEYS.includes(k));
      if (valid.length) return valid;
    }
  } catch { /* private mode */ }
  return [...ALL_MASTER_PACK_KEYS];
}

/** 1-click UrGF V9 Master Demand Pack: pick any character(s) (new uploads OR linked UrGF characters) + choose which of the 5 sets to build */
function V9MasterPackBox() {
  const chars = useCharacters(useShallow((s) => s.list.filter((c) => isAdult(c) && !!masterPackRef(c))));
  const sel = useCharacters((s) => s.sel);
  const toast = useJobs((s) => s.toast);
  const [who, setWho] = useState<string[]>(sel ? [sel] : []);
  const [quickMedia, setQuickMedia] = useState<Media | null>(null);
  const [quickVibe, setQuickVibe] = useState("");
  const [packs, setPacks] = useState<MasterPackKey[]>(loadV9Sets);
  const [saveToLocalSets, setSaveToLocalSets] = useState(true);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [faceOnlyCutout, setFaceOnlyCutout] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const setAndSavePacks = (next: MasterPackKey[]) => {
    setPacks(next);
    try { localStorage.setItem(V9_SETS_KEY, JSON.stringify(next)); } catch { /* */ }
  };
  const togglePack = (k: MasterPackKey) => {
    setAndSavePacks(packs.includes(k) ? packs.filter((x) => x !== k) : [...packs, k]);
  };

  const pickedChars = chars.filter((c) => who.includes(c.id));
  const targetCount = pickedChars.length + (quickMedia ? 1 : 0);
  const missingV9Ids = chars.filter((c) => v9PackStatus(c).missing.length > 0).map((c) => c.id);
  const shotsPerChar = MASTER_PACKS.filter((p) => packs.includes(p.key)).reduce((sum, p) => sum + p.shots, 0);
  const totalPics = targetCount * shotsPerChar;
  const totalSets = targetCount * packs.length;

  const go = async () => {
    setBusy("Starting V9 Master Pack…");
    try {
      const { planAndQueueMasterPack } = await import("../lib/masterPack");
      const r = await planAndQueueMasterPack(
        pickedChars,
        {
          packs,
          quick: quickMedia ? { media: quickMedia, vibe: quickVibe } : null,
          saveToLocalSets,
          replaceExisting,
          faceOnlyCutout,
          review,
        },
        setBusy,
      );
      const warn = r.failed.length ? ` (${r.failed.length} failed: ${r.failed[0]})` : "";
      toast(
        review
          ? `Planned ${r.rows} V9 prompts across ${r.sets} set${r.sets === 1 ? "" : "s"} — edit any row below, then press Queue.${warn}`
          : pickedChars.length && saveToLocalSets
            ? `Queued ${r.jobs} V9 pictures across ${r.sets} set${r.sets === 1 ? "" : "s"} — saved characters stage locally in Your site (nothing auto-sends to UrGF).${warn}`
            : `Queued ${r.jobs} V9 pictures — kept only in Batch results & Catalog (no project or site sets touched).${warn}`,
        r.failed.length ? "info" : "good",
        "batch",
      );
    } catch (e) {
      toast((e as Error).message, "bad", "batch");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-good/50 bg-good/[.04] p-3 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <b className="font-medium text-ink">V9 Master Pack · UrGF sets</b>
        <span className="ml-auto flex items-center gap-2 text-[11.5px]">
          {missingV9Ids.length > 0 && missingV9Ids.length < chars.length && (
            <button onClick={() => setWho(missingV9Ids)} className="text-muted hover:text-ink hover:underline" title="Select characters missing one or more V9 sets">
              Missing V9 ({missingV9Ids.length})
            </button>
          )}
          {chars.length > 0 && (
            <button onClick={() => setWho(who.length === chars.length ? [] : chars.map((c) => c.id))} className="text-accent hover:underline">
              {who.length === chars.length ? "Clear all" : `Select all (${chars.length})`}
            </button>
          )}
        </span>
      </div>
      <p className="-mt-1.5 text-[11.5px] leading-relaxed text-dim">
        1-click 8-step Krea 2 Identity Edit pipeline with hole-free BiRefNet cutout &amp; tier LoRAs — drop any photo directly (no project needed) or pick saved characters. Nothing is ever uploaded to UrGF automatically.
      </p>

      <div className="flex items-start gap-2.5 rounded-md border border-dashed border-line bg-black/20 p-2">
        <Slot
          value={quickMedia}
          onChange={setQuickMedia}
          accept={["image"]}
          label="Quick photo"
          className="h-20 w-16 shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] font-medium text-ink">Quick photo <span className="font-normal text-dim">(no project needed)</span></span>
            {quickMedia && (
              <button
                type="button"
                onClick={async () => {
                  const { useWork, makeRef } = await import("../lib/work");
                  const { useSettings } = await import("../lib/settings");
                  const cur = useWork.getState().animateRefs.filter((r) => r.media.kind !== "image");
                  useWork.getState().set({ animateRefs: [makeRef(quickMedia), ...cur] });
                  useSettings.getState().set("animate", { mode: "swap", swapEngine: "bfs" } as never);
                  useSettings.getState().setTab("animate");
                }}
                className="text-[11px] text-accent hover:underline"
                title="Jump straight to 05 Animate → Swap the person (BFS H3 v1.1) with this photo"
              >
                Use in BFS Video →
              </button>
            )}
          </div>
          <input
            value={quickVibe}
            onChange={(e) => setQuickVibe(e.target.value)}
            placeholder="Optional vibe / room (e.g. cozy dimly lit bedroom, alt goth)"
            className="inset h-8 border px-2 text-[12px] text-ink placeholder:text-dim focus:border-accent focus:outline-none"
          />
          <span className="text-[10.5px] leading-snug text-dim">
            Drop or click to attach any adult photo. Runs directly into Batch results &amp; Catalog without creating a character.
          </span>
        </div>
      </div>

      <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
        {chars.map((c) => {
          const st = v9PackStatus(c);
          const on = who.includes(c.id);
          const disp = c.site?.name || c.name;
          const title = st.have.length
            ? `Has ${st.have.length}/5 V9 sets (${st.have.join(", ")})${st.missing.length ? ` · missing: ${st.missing.join(", ")}` : ""}`
            : "No V9 sets yet";
          return (
            <button
              key={c.id}
              title={title}
              onClick={() => setWho((w) => (w.includes(c.id) ? w.filter((x) => x !== c.id) : [...w, c.id]))}
              aria-pressed={on}
              className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", on && "on")}
            >
              <span>{disp}</span>
              {st.have.length > 0 && (
                <span className={cx("ml-1 text-[10.5px]", st.have.length === MASTER_PACKS.length ? "text-good" : "opacity-65")}>
                  {st.have.length}/{MASTER_PACKS.length}
                </span>
              )}
            </button>
          );
        })}
        {!chars.length && <span className="text-dim">Add a character with a front or cover picture first.</span>}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-[11.5px]">
          <span className="text-muted">Sets to create ({packs.length}/{MASTER_PACKS.length})</span>
          <span className="ml-auto flex items-center gap-2">
            <button onClick={() => setAndSavePacks([...ALL_MASTER_PACK_KEYS])} className={cx("hover:underline", packs.length === ALL_MASTER_PACK_KEYS.length ? "text-ink" : "text-muted")}>All 5</button>
            <button onClick={() => setAndSavePacks([...SOLO_MASTER_PACK_KEYS])} className={cx("hover:underline", packs.length === SOLO_MASTER_PACK_KEYS.length && !packs.includes("cuckold_pov") ? "text-ink" : "text-muted")}>Solo only (4)</button>
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {MASTER_PACKS.map((p) => {
            const on = packs.includes(p.key);
            return (
              <button
                key={p.key}
                type="button"
                title={p.hint}
                onClick={() => togglePack(p.key)}
                aria-pressed={on}
                className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", on && "on")}
              >
                <span>{p.shortLabel}</span>
                <span className="ml-1 text-[10.5px] opacity-65">{p.tier === "free" ? "free" : "prem"} · {p.shots}</span>
              </button>
            );
          })}
        </div>
      </div>

      {pickedChars.length > 0 && (
        <>
          <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
            <input type="checkbox" className="mt-0.5" checked={saveToLocalSets} onChange={(e) => setSaveToLocalSets(e.target.checked)} />
            <span>Sort saved characters' shots into local <b>Your site</b> staging sets (never auto-sends to UrGF; uncheck to keep only in Batch results &amp; Catalog)</span>
          </label>
          {saveToLocalSets && (
            <label className="flex cursor-pointer items-start gap-2 pl-5 text-[12px] text-muted">
              <input type="checkbox" className="mt-0.5" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
              <span>Replace older V9 sets of the chosen types (leaves unselected sets untouched)</span>
            </label>
          )}
        </>
      )}
      <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
        <input type="checkbox" className="mt-0.5" checked={faceOnlyCutout} onChange={(e) => setFaceOnlyCutout(e.target.checked)} />
        <span>Head-only cutout (FaceSegment) — tick if the photo has a hand or peace sign near her face</span>
      </label>
      <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
        <input type="checkbox" className="mt-0.5" checked={review} onChange={(e) => setReview(e.target.checked)} />
        <span>Let me read or edit prompts before queueing</span>
      </label>

      <Btn
        kind="primary"
        onClick={go}
        disabled={!targetCount || !packs.length || !!busy}
        why={busy ?? (!targetCount ? "Attach a quick photo or pick at least one character" : "Pick at least one V9 set")}
      >
        {busy ?? (review ? `Plan V9 prompts · ${totalPics} shots (${totalSets} sets)` : `Build & queue V9 Master Pack · ${totalPics} pictures (${totalSets} sets)`)}
      </Btn>
    </div>
  );
}
