// Animate → which H3 model makes the video: the official files, or H3 Eros Max (a community merge built for LoRA stacks)
import { useState } from "react";
import { setLater, syncKreaTE, useDownloads } from "../lib/downloads";
import { H3_MODEL_KEY } from "../lib/models";
import { Seg } from "./ui";

export function VideoModel() {
  const g = useDownloads((st) => st.groups.find((x) => x.id === "eros"));
  const [eros, setEros] = useState(() => { try { return localStorage.getItem(H3_MODEL_KEY) === "eros"; } catch { return false; } });
  const pick = (on: boolean) => {
    try { if (on) localStorage.setItem(H3_MODEL_KEY, "eros"); else localStorage.removeItem(H3_MODEL_KEY); } catch { /* private mode */ }
    setEros(on); syncKreaTE();
    if (on && g && g.state !== "done") void setLater("eros", "next"); // fetch it now
  };
  const note = !eros ? "The official MiniMax H3 files (int8 ConvRot)."
    : !g ? "Eros Max isn't on this rental's image yet — the official model is used."
    : g.state === "done" ? "H3 Eros Max beta6: richer motion and bodies, made to take many LoRAs (keep each at 0.2–0.6). Works best with references — first-frame videos can drift from the picture's style."
    : `Eros Max ${g.state === "downloading" ? `downloading, ${g.pct}%` : g.state === "error" ? `failed to download${g.error ? ` (${g.error})` : ""} — status menu → Retry` : g.why ? `waiting: ${g.why}` : "in line"} — 20 GB; the official model is used until then.`;
  return (
    <div className="flex flex-col gap-1">
      <Seg label="Video model" value={eros ? "eros" : "official"} onChange={(v) => pick(v === "eros")}
        options={[{ value: "official", label: "Official H3" }, { value: "eros", label: "Eros Max" }]} />
      <p className="-mt-1 text-[11.5px] leading-relaxed text-dim">{note}</p>
    </div>
  );
}
