// Characters → Reference sheet → "Build a starting frame": model (+ your own checkpoint), LoRAs, a full prompt written
// for you from the profile / a picture / a saved CivitAI post, a batch of candidates, and "Use as their front".
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { viewUrl, type FileRef } from "../lib/api";
import { useCharacters, type Character } from "../lib/characters";
import { FRAME_SHAPES, frameFromCivitai, frameOf, makeFrames, saveFrame, writeFramePrompt } from "../lib/frame";
import { useJobs } from "../lib/jobs";
import { queueFullSheet } from "../lib/sheet";
import { CREATE_MODELS, modelOf, useSettings, type CreateModel } from "../lib/settings";
import type { Media } from "../lib/tray";
import { CheckpointPicker } from "./Checkpoint";
import { openPictureMenu } from "./PictureMenu";
import { ModelsNotice } from "./Workspace";
import { Btn, Help, JobBar, LoraList, Select, Slot, TextArea, cx } from "./ui";
import { useGroup } from "../lib/downloads";

export function StartingFrame({ c, onPicked }: { c: Character; onPicked: () => void }) {
  const live = useCharacters((s) => s.list.find((x) => x.id === c.id)) ?? c;
  const f = frameOf(live);
  const set = (p: Parameters<typeof saveFrame>[1]) => saveFrame(live, p);
  const toast = useJobs((s) => s.toast);
  const mi = modelOf(useSettings.getState().s.create, undefined, f.model);
  const dl = useGroup(mi.group);
  const [what, setWhat] = useState("Full body, standing naturally, front three-quarter view, plain light grey studio background, soft even light.");
  const [pic, setPic] = useState<Media | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const txt = useRef<HTMLInputElement>(null);
  const jobs = useJobs(useShallow((s) => s.jobs.filter((j) => j.meta?.charFrame === c.id)));
  const making = jobs.filter((j) => j.meta?.kind === "frames" && (j.status === "running" || j.status === "queued"));
  const writing = jobs.some((j) => j.meta?.kind === "frameprompt" && (j.status === "running" || j.status === "queued"));
  const candidates = jobs.filter((j) => j.meta?.kind === "frames" && j.status === "done").flatMap((j) => j.outputs.filter((o) => o.kind === "image"));
  const aspect = (() => { const s = FRAME_SHAPES[f.shape]; return s.w > s.h ? "16:9" : s.w === s.h ? "1:1" : s.h / s.w > 1.6 ? "9:16" : "2:3"; })();

  const step = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(null); } };
  const write = () => step("write", async () => { set({ prompt: await writeFramePrompt(live, what, aspect) }); toast("Prompt written — edit anything, then make the batch.", "good"); });
  const fromPic = () => step("pic", async () => {
    if (!pic) throw new Error("Drop a picture first");
    set({ prompt: await writeFramePrompt(live, `Recreate exactly what the attached picture shows — the pose, outfit, setting, lighting, camera angle and framing — with this character as the person in it. ${what}`, aspect, [pic.name]) });
    toast("Prompt written from the picture.", "good");
  });
  const fromCivit = () => step("civ", async () => {
    const r = await frameFromCivitai(live, link.trim(), (m) => toast(m, "info"));
    setLink("");
    toast(`Copied the post's prompt, model and LoRAs${r.failed.length ? ` (${r.failed.length} LoRA(s) couldn't be added)` : ""}. Swap in this character's look where it describes the person.`, "good");
  });
  const use = (o: FileRef, sheet: boolean) => step(`use:${o.filename}`, async () => {
    await useCharacters.getState().setView(c.id, "front", o);
    if (sheet) { await queueFullSheet(useCharacters.getState().list.find((x) => x.id === c.id) ?? live); toast("Front set — making the angles, face close-up and cut-out.", "good"); }
    else toast("That's their front picture now.", "good");
    onPicked();
  });
  useEffect(() => { if (!f.prompt && live.block) set({ prompt: live.block }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-3.5 border border-line bg-raised/40 p-4">
      <div className="flex items-baseline gap-2"><p className="lbl">Starting frame</p><span className="text-[12.5px] text-dim">Pick the model, LoRAs and prompt, make a batch, and click the one that looks right — it becomes their front picture and the sheet is made from it.</span></div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-3">
          <Select label="Model" value={f.model} onChange={(v) => set({ model: v as CreateModel, checkpoint: "", loras: [] })} options={CREATE_MODELS.map((m) => ({ value: m.model, label: m.label }))} />
          <CheckpointPicker model={f.model} value={f.checkpoint} onChange={(v) => set({ checkpoint: v })} />
          <LoraList family={mi.family} value={f.loras} onChange={(v) => set({ loras: v })} />
          <Select label="Shape" value={f.shape} onChange={(v) => set({ shape: v as keyof typeof FRAME_SHAPES })} options={Object.entries(FRAME_SHAPES).map(([k, s]) => ({ value: k, label: s.label }))} />
          <Select label="How many" value={String(f.count)} onChange={(v) => set({ count: Number(v) })} options={[1, 2, 4, 6, 8].map((n) => ({ value: String(n), label: `×${n}` }))} />
          <ModelsNotice id={mi.group} />
        </div>
        <div className="flex flex-col gap-2.5">
          <TextArea label="Prompt" rows={9} value={f.prompt} onChange={(v) => set({ prompt: v })}
            placeholder="The full picture prompt — e.g. “Photorealistic candid photograph of an adult woman in her mid-twenties… Vertical full-body composition, 50mm lens…”" />
          <div className="flex flex-wrap items-center gap-2">
            <Btn kind="primary" onClick={() => step("make", () => makeFrames(useCharacters.getState().list.find((x) => x.id === c.id) ?? live))} disabled={!f.prompt.trim() || !dl.ready || !!busy} why={!dl.ready ? dl.why : !f.prompt.trim() ? "Write the prompt first" : "Working…"}>
              Make ×{f.count}
            </Btn>
            <Btn onClick={() => txt.current?.click()}>Load .txt</Btn>
            <input ref={txt} type="file" accept=".txt,.md,text/plain" hidden onChange={async (e) => { const fl = e.target.files?.[0]; e.target.value = ""; if (fl) set({ prompt: (await fl.text()).trim() }); }} />
          </div>
          <details className="border-t border-line pt-2.5" open={!f.prompt}>
            <summary className="cursor-pointer text-[13px] text-muted hover:text-ink">Write the prompt for me<Help text="The local writer turns this character's look into a full Krea 2-style prompt, using your Krea 2 frame builder prompt file (Scenes → prompt files)." /></summary>
            <div className="mt-2.5 flex flex-col gap-2.5">
              <TextArea label="What this frame should show" rows={2} value={what} onChange={setWhat} />
              <div className="flex flex-wrap gap-2">
                <Btn onClick={write} disabled={!!busy || writing} why="Writing…">{busy === "write" ? "Writing…" : "From their profile"}</Btn>
              </div>
              <div className="grid grid-cols-[140px_1fr] items-start gap-2.5">
                <Slot className="h-36" value={pic} onChange={setPic} label="A picture" hint="its pose and setting" />
                <div className="flex flex-col gap-2 text-[12.5px] text-dim">
                  <span>Drop a picture to copy its pose, outfit, setting and framing with this character in it.</span>
                  <Btn small onClick={fromPic} disabled={!pic || !!busy || writing} why={!pic ? "Drop a picture first" : "Writing…"}>{busy === "pic" ? "Writing…" : "From this picture"}</Btn>
                </div>
              </div>
              <div className="flex gap-1.5">
                <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or a civitai.com/images link (copies its prompt, model and LoRAs)" aria-label="CivitAI picture link"
                  className="inset h-9 min-w-0 flex-1 border border-line px-2.5 text-[12.5px] focus:border-accent focus:outline-none" />
                <Btn small onClick={fromCivit} disabled={!/civitai\.(com|green|red)\/images\/\d+/i.test(link) || !!busy} why="Paste a civitai.com/images link">{busy === "civ" ? "Reading…" : "Use this post"}</Btn>
              </div>
            </div>
          </details>
        </div>
      </div>
      {(making.length > 0 || candidates.length > 0) && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="lbl">Pick one</p>
          {making.map((j) => <div key={j.id} className="rounded border border-line p-2"><p className="mb-1 text-xs">{j.label}</p><JobBar job={j} compact /></div>)}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {candidates.map((o) => (
              <div key={`${o.subfolder}/${o.filename}`} className="group relative overflow-hidden border border-line bg-black">
                <img src={viewUrl(o)} alt="Candidate" className="aspect-[2/3] w-full object-contain" onContextMenu={(e) => openPictureMenu(e, { url: viewUrl(o), label: o.filename })} />
                <div className={cx("absolute inset-x-0 bottom-0 flex gap-1 bg-black/75 p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100")}>
                  <Btn small className="flex-1" onClick={() => use(o, false)} disabled={!!busy} why="Working…">Use as front</Btn>
                  <Btn small kind="primary" className="flex-1" onClick={() => use(o, true)} disabled={!!busy} why="Working…">+ make sheet</Btn>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
