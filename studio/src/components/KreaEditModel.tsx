// Edit → which Krea 2 edit LoRA: V2 (Identity Edit for a person from another picture, General Edit for plain-words changes)
// once its download group is in, or the older v1.2 that does both.
import { useState } from "react";
import { syncKreaTE, useDownloads } from "../lib/downloads";
import { KREA_EDIT_KEY } from "../lib/models";
import { Seg } from "./ui";

export function KreaEditModel() {
  const g = useDownloads((st) => st.groups.find((x) => x.id === "kedit2"));
  const [v1, setV1] = useState(() => { try { return localStorage.getItem(KREA_EDIT_KEY) === "v1"; } catch { return false; } });
  const pick = (old: boolean) => { try { if (old) localStorage.setItem(KREA_EDIT_KEY, "v1"); else localStorage.removeItem(KREA_EDIT_KEY); } catch { /* private mode */ } setV1(old); syncKreaTE(); };
  const here = g?.state === "done";
  const note = v1 ? "The older v1.2 LoRA, one model for every edit."
    : here ? "V2: Identity Edit when a person comes from another picture (swaps, putting a character in), General Edit for changes to one picture. Better likeness and sharper skin."
    : !g ? "V2 isn't on this rental's image yet — v1.2 is used."
    : `V2 ${g.state === "downloading" ? `downloading, ${g.pct}%` : g.state === "error" ? "failed to download (status menu → Retry)" : "in line"} — v1.2 is used until then.`;
  return (
    <div className="flex flex-col gap-1">
      <Seg label="Edit model (Krea 2)" value={v1 ? "v1" : "v2"} onChange={(v) => pick(v === "v1")}
        options={[{ value: "v2", label: "V2" }, { value: "v1", label: "v1.2" }]} />
      <p className="-mt-1 text-[11.5px] leading-relaxed text-dim">{note}</p>
    </div>
  );
}
