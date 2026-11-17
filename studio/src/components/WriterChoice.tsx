// Which writer writes every prompt (Create, Edit chat, "Change this part", Batch photo sets): the local 27B once it's
// downloaded, or your own Grok tab (copy & paste, no keys). One choice for the whole Studio.
import { useState } from "react";
import { bigWriterFits, useGroup } from "../lib/downloads";
import { WRITER_KEY } from "../lib/models";
import { Seg, cx } from "./ui";
import { modelName, setDeepseekKey, useDeepseek } from "../lib/deepseek";
import { GrokConnect, useGrokLink } from "./OutsideHost";

type W = "big" | "outside";
const read = (): W => { try { return localStorage.getItem(WRITER_KEY) === "outside" ? "outside" : "big"; } catch { return "big"; } };

export function WriterChoice() {
  const xl = useGroup("writer");
  const [w, setW] = useState<W>(read);
  const pick = (v: W) => { try { if (v === "big") localStorage.removeItem(WRITER_KEY); else localStorage.setItem(WRITER_KEY, v); } catch { /* private mode */ } setW(v); };
  const linked = useGrokLink(w === "outside");
  const ds = useDeepseek();
  const local = !bigWriterFits() ? "This card is smaller than the 27B writer likes (~28 GB): it works, but slowly — the Grok tab is quicker here." : "";
  return (
    <div className="flex flex-col gap-1">
      <Seg label="Prompt writer (everywhere)" value={w} onChange={pick}
        options={[{ value: "big", label: ds.on ? "DeepSeek" : "On the rental · 27B" }, { value: "outside", label: "Grok tab", title: "Your own Grok tab in your browser writes them — no keys" }]} />
      {w === "big" && <DeepseekKey />}
      {/* is the 27B on this rental? */}
      {w === "big" && !ds.on && <p className={cx("-mt-1 text-[11.5px]", xl.ready ? "text-good" : "text-hot")}>{xl.ready ? "● The 27B writer is on this rental and ready" : `● The 27B writer isn't ready${xl.why ? ` — ${xl.why}` : ""}. Until it is, use the Grok tab.`}</p>}
      {w === "outside" && <GrokConnect connected={linked} />}
      {w === "outside" && <GrokEyes />}
      <p className="-mt-1 text-[11.5px] leading-relaxed text-dim">{w === "outside"
        ? "Your Grok tab writes the prompts — by itself once connected, otherwise a panel copies each request for you to paste. A Batch's prompts go as one message."
        : ds.on ? "DeepSeek writes everything: prompts, profiles, reading pictures and clips — through its API, so nothing loads on the card and pictures don't wait for it."
        : local || "The 27B writes everything: prompts, profiles, reading pictures and clips. The picture model moves off the card while it writes, so a prompt adds about 30–60 s."} Every writer job in the queue says which one wrote it. Its rules: Scenes → prompt files.</p>
    </div>
  );
}

/** let the connected Grok tab look at pictures too, instead of the local writer */
function GrokEyes() {
  const [on, setOn] = useState(() => { try { return localStorage.getItem("h3.grokSees") !== "off"; } catch { return true; } });
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[11.5px] leading-relaxed text-dim">
      <input type="checkbox" className="mt-0.5" checked={on} onChange={(e) => { setOn(e.target.checked); try { localStorage.setItem("h3.grokSees", e.target.checked ? "on" : "off"); } catch { /* */ } }} />
      <span>Grok also looks at pictures (reading a pose or angle, face checks, describing a picture): the helper attaches them to the chat. Off, or if Grok refuses one, the local writer does it.</span>
    </label>
  );
}

/** the local writer's files off this disk (they wait as "Later"; new rentals with a DeepSeek key never download them) */
async function freeLocal() {
  const { askConfirm } = await import("./Dialogs");
  if (!(await askConfirm("Delete the local writer from this disk?", "DeepSeek writes instead, so its model files (about 19 GB, more if the old 9B is here too) aren't used. Removing the DeepSeek key later downloads it again.", "Delete", true))) return;
  const { useJobs } = await import("../lib/jobs");
  let any = false;
  for (const group of ["writer", "writer_xl"]) {
    const r = await fetch("/studio-api/downloads/later", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group, remove: true }) }).catch(() => null);
    if (r?.ok) any = true;
  }
  useJobs.getState().toast(any ? "Removing the local writer — the space frees up in a few seconds" : "The local writer isn't on this disk", any ? "good" : "info");
}

/** DeepSeek's key: from the template, or pasted here (tested first). On = the local writer isn't used or downloaded. */
function DeepseekKey() {
  const ds = useDeepseek();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async (k: string) => {
    setBusy(true); setErr("");
    try { await setDeepseekKey(k); setKey(""); setOpen(false); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  if (ds.on && !open) return (
    <p className="-mt-1 text-[11.5px] text-good">● DeepSeek {modelName(ds.model)} writes — key {ds.source === "template" ? "from your Vast template" : "pasted on this rental"}.{" "}
      {ds.source !== "template" && <button className="text-dim underline hover:text-ink" onClick={() => setOpen(true)}>Change</button>}{" "}
      <button className="text-dim underline hover:text-ink" title="Deletes the local writer's model files from this rental (it's not used while DeepSeek writes)" onClick={freeLocal}>Free the local writer's disk space</button></p>
  );
  return (
    <div className="-mt-1 flex flex-col gap-1.5 rounded-lg border border-line p-2">
      <p className="text-[11.5px] text-dim">{ds.on ? "A new DeepSeek key:" : "Use DeepSeek instead of a local writer — paste its API key (platform.deepseek.com → API keys). For every rental, put it in your Vast template as DEEPSEEK_API_KEY."}</p>
      <div className="flex gap-1.5">
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-black/30 px-2.5 text-[12.5px] text-ink outline-none focus:border-accent" />
        <button disabled={busy || !key.trim()} onClick={() => go(key.trim())} className="press btn-primary h-8 rounded-lg px-3 text-[12px] font-semibold text-accentink disabled:opacity-40">{busy ? "Testing…" : "Test & use"}</button>
        {ds.on && <button onClick={() => go("")} disabled={busy} className="press h-8 px-2 text-[12px] text-muted">Remove</button>}
      </div>
      {err && <p className="text-[11.5px] text-bad">{err}</p>}
    </div>
  );
}
