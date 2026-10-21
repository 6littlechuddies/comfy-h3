import { useState } from "react";
import { viewUrl } from "../lib/api";
import { buildCreate } from "../lib/graphs";
import { useJobs } from "../lib/jobs";
import { DEFAULTS, modelArgs, modelOf, useSettings } from "../lib/settings";
import { SAMPLE, STYLES, useStylePreviews } from "../lib/styles";
import { Btn, Help, cx } from "./ui";

export const styleAdd = (style: "anime" | "realistic", id: string) => STYLES[style].find((s) => s.id === id)?.add ?? "";

/** a grid of looks with example pictures (made once on your GPU, then kept) */
export function StylePicker({ style, value, onChange }: { style: "anime" | "realistic"; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const map = useStylePreviews((s) => s.map);
  const run = useJobs((s) => s.run);
  const toast = useJobs((s) => s.toast);
  const list = STYLES[style];
  const current = list.find((s) => s.id === value) ?? list[0];
  const missing = list.filter((s) => !map[`${style}/${s.id}`]);
  const makeExamples = async () => {
    try {
      for (const st of missing) {
        const cs = useSettings.getState().s.create;
        const mi = modelOf(cs, style);
        const adv = mi.adv;
        const positive = style === "anime" ? `${SAMPLE.anime}${st.add ? ", " + st.add : ""}` : `${SAMPLE.realistic} ${st.add}`;
        const g = buildCreate({ ...adv, steps: mi.model === "noob" ? 22 : adv.steps, seed: 4242, ...modelArgs(cs, mi), positive, negative: DEFAULTS.create.negative, loras: [],
          width: style === "anime" ? 640 : 768, height: style === "anime" ? 832 : 1024, count: 1, cutout: false, prefix: `studio/styles/${style}_${st.id}` });
        await run("create", `Style example: ${st.name}`, g, "styles", { styleKey: `${style}/${st.id}` });
      }
      toast(`Making ${missing.length} examples — they're kept for every future rental.`, "info", "create");
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  const thumb = (id: string) => map[`${style}/${id}`];
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-raised p-2 text-left hover:bg-hover">
        <div className="hatch h-10 w-10 shrink-0 overflow-hidden rounded-md">{thumb(current.id) && <img src={viewUrl(thumb(current.id)!)} alt="" className="h-full w-full object-cover" />}</div>
        <div className="min-w-0 flex-1"><div className="lbl !text-[11px]">Look</div><div className="truncate text-sm">{current.name}</div></div>
        <span className="text-xs text-muted">{open ? "close" : "change"}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-[10px] border border-line bg-panel2 p-2">
          <div className="grid grid-cols-3 gap-1.5">
            {list.map((st) => (
              <button key={st.id} type="button" onClick={() => { onChange(st.id); setOpen(false); }} title={st.add || "No extra style words"}
                className={cx("flex flex-col overflow-hidden rounded-md border text-left", st.id === value ? "border-accent" : "border-line hover:border-muted")}>
                <div className="hatch aspect-[3/4] w-full">{thumb(st.id) && <img src={viewUrl(thumb(st.id)!)} alt="" className="h-full w-full object-cover" />}</div>
                <span className="truncate px-1.5 py-1 text-[11px]">{st.name}</span>
              </button>
            ))}
          </div>
          {missing.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <Btn small className="flex-1" onClick={makeExamples}>Make {missing.length} example pictures</Btn>
              <Help text="Each look is tried once on your GPU with the same test character, so you can compare. They're saved with your settings and come back on every rental." />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
