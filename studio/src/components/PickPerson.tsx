import { useState } from "react";
import { useGroup } from "../lib/downloads";
import { useJobs } from "../lib/jobs";
import type { InputFile } from "../lib/api";
import type { Media } from "../lib/tray";
import type { Box } from "../lib/faceBox";

type Mask = InputFile & { url: string; box?: { x: number; y: number; width: number; height: number; W: number; H: number } };

/** Edit's prompt bar: "Pick a person" — SAM 3 finds everyone in picture 1 and draws a numbered box on each; click one and
 *  only that person is changed (their exact outline). With one person it picks them straight away. */
export function PickPerson({ pic, onMask }: { pic: Media; onMask: (m: Mask, note: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [found, setFound] = useState<{ boxes: Box[]; W: number; H: number } | null>(null);
  const toast = useJobs((s) => s.toast);
  const sam = useGroup("sam");
  const pick = async (b: Box, i: number, all: { W: number; H: number }, n: number) => {
    setBusy(`Outlining person ${i + 1}…`);
    try {
      const { selectPerson } = await import("../lib/faceDetail");
      const r = await selectPerson(pic.name, b, all.W, all.H);
      onMask({ ...r.mask, box: r.box }, n > 1 ? `Person ${i + 1} of ${n} picked — only they change` : "Picked the person — only they change");
      setFound(null);
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(null); }
  };
  const find = async () => {
    setBusy("Finding people…");
    try {
      const { findPeople } = await import("../lib/faceDetail");
      const r = await findPeople(pic.name);
      if (!r.boxes.length) { toast("SAM 3 didn't find a person in picture 1 — paint them instead", "bad"); return; }
      if (r.boxes.length === 1) { await pick(r.boxes[0], 0, r, 1); return; }
      setFound(r);
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(null); }
  };
  return (
    <>
      <button onClick={find} disabled={!sam.ready || !!busy} title={sam.ready ? "Find everyone in picture 1 and pick who changes" : sam.why}
        className="press inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-raised2/70 px-3 text-[12.5px] font-medium text-ink hover:bg-hover disabled:opacity-50">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="7" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
        {busy ?? "Pick a person"}</button>
      {found && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setFound(null)} role="dialog" aria-label="Pick a person">
          <div className="max-h-full max-w-3xl rounded-md border border-line bg-raised p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-4 text-[13px]">
              <span>Found {found.boxes.length} people. Click the one to change.</span>
              <button onClick={() => setFound(null)} className="text-muted hover:text-ink" aria-label="Close">✕</button>
            </div>
            <div className="relative inline-block">
              <img src={pic.url} alt="Picture 1" className="block max-h-[70vh] w-auto" />
              {found.boxes.map((b, i) => (
                <button key={i} onClick={() => pick(b, i, found, found.boxes.length)} disabled={!!busy}
                  className="group absolute rounded-sm border-2 border-[#ff8a1f] bg-[#ff8a1f]/10 hover:bg-[#ff8a1f]/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                  style={{ left: `${(b.x / found.W) * 100}%`, top: `${(b.y / found.H) * 100}%`, width: `${(b.width / found.W) * 100}%`, height: `${(b.height / found.H) * 100}%` }}
                  aria-label={`Person ${i + 1}`}>
                  <span className="absolute left-1 top-1 rounded-sm bg-[#ff8a1f] px-1.5 text-[12px] font-bold text-black">{i + 1}</span>
                </button>
              ))}
            </div>
            {busy && <p className="mt-2 text-[12px] text-dim">{busy}</p>}
          </div>
        </div>
      )}
    </>
  );
}
