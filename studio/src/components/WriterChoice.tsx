// Which writer writes every prompt (Create, Edit chat, "Change this part", Batch photo sets): the local 27B once it's
// downloaded, the fast local 9B, or your own Grok tab (copy & paste, no keys). One choice for the whole Studio.
import { useState } from "react";
import { bigWriterFits, useGroup } from "../lib/downloads";
import { WRITER_KEY } from "../lib/models";
import { Seg } from "./ui";
import { GrokConnect, useGrokLink } from "./OutsideHost";

type W = "big" | "fast" | "outside";
const read = (): W => { try { const v = localStorage.getItem(WRITER_KEY); return v === "fast" || v === "outside" ? v : "big"; } catch { return "big"; } };

export function WriterChoice() {
  const xl = useGroup("writer_xl");
  const [w, setW] = useState<W>(read);
  const pick = (v: W) => { try { if (v === "big") localStorage.removeItem(WRITER_KEY); else localStorage.setItem(WRITER_KEY, v); } catch { /* private mode */ } setW(v); };
  const linked = useGrokLink(w === "outside");
  const local = !bigWriterFits() ? "This card is too small for the 27B writer (it needs ~28 GB), so the 9B writes here." : "";
  return (
    <div className="flex flex-col gap-1">
      <Seg label="Prompt writer (everywhere)" value={w} onChange={pick}
        options={[{ value: "big", label: "27B · better" }, { value: "fast", label: "9B · fast" }, { value: "outside", label: "Grok tab", title: "Copy & paste with Grok in your own browser tab — no keys" }]} />
      {w === "outside" && <GrokConnect connected={linked} />}
      {w === "outside" && <GrokEyes />}
      <p className="-mt-1 text-[11.5px] leading-relaxed text-dim">{w === "outside"
        ? "Your Grok tab writes the prompts — by itself once connected, otherwise a panel copies each request for you to paste. A Batch's prompts go as one message. Steps that look at a picture still use the local writer."
        : local || (w === "fast" ? "The 9B writer everywhere: it stays loaded next to Krea 2, so prompts come in seconds." : xl.ready ? "The 27B writer everywhere: richer, more exact prompts. The picture model is moved off the card while it writes, so a new prompt adds about 30–60 s." : `The 27B writer ${xl.why ? `— ${xl.why}` : "is still downloading"}; the 9B writes until it's here, then it takes over by itself.`)} Its rules: Scenes → prompt files.</p>
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
