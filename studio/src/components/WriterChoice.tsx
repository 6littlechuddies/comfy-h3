// Which writer writes every prompt (Create, Edit chat, "Change this part", Batch photo sets): the local 27B once it's
// downloaded, or your own Grok tab (copy & paste, no keys). One choice for the whole Studio.
import { useState } from "react";
import { bigWriterFits, useGroup } from "../lib/downloads";
import { WRITER_KEY } from "../lib/models";
import { Seg, cx } from "./ui";
import { GrokConnect, useGrokLink } from "./OutsideHost";

type W = "big" | "outside";
const read = (): W => { try { return localStorage.getItem(WRITER_KEY) === "outside" ? "outside" : "big"; } catch { return "big"; } };

export function WriterChoice() {
  const xl = useGroup("writer");
  const [w, setW] = useState<W>(read);
  const pick = (v: W) => { try { if (v === "big") localStorage.removeItem(WRITER_KEY); else localStorage.setItem(WRITER_KEY, v); } catch { /* private mode */ } setW(v); };
  const linked = useGrokLink(w === "outside");
  const local = !bigWriterFits() ? "This card is smaller than the 27B writer likes (~28 GB): it works, but slowly — the Grok tab is quicker here." : "";
  return (
    <div className="flex flex-col gap-1">
      <Seg label="Prompt writer (everywhere)" value={w} onChange={pick}
        options={[{ value: "big", label: "On the rental · 27B" }, { value: "outside", label: "Grok tab", title: "Your own Grok tab in your browser writes them — no keys" }]} />
      {/* is the 27B on this rental? */}
      {w === "big" && <p className={cx("-mt-1 text-[11.5px]", xl.ready ? "text-good" : "text-hot")}>{xl.ready ? "● The 27B writer is on this rental and ready" : `● The 27B writer isn't ready${xl.why ? ` — ${xl.why}` : ""}. Until it is, use the Grok tab.`}</p>}
      {w === "outside" && <GrokConnect connected={linked} />}
      {w === "outside" && <GrokEyes />}
      <p className="-mt-1 text-[11.5px] leading-relaxed text-dim">{w === "outside"
        ? "Your Grok tab writes the prompts — by itself once connected, otherwise a panel copies each request for you to paste. A Batch's prompts go as one message."
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
