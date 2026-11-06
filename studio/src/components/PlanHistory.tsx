// Planned prompts for one character (Characters tab), or for whoever is in Prompt's references: every plan the writer made,
// newest first, ★ ones on top — read it, copy it, send it to Animate again, or open it in Prompt to change it.
import { useMemo, useState } from "react";
import { plansFor, removePlan, updatePlan, usePlans, type Plan } from "../lib/plans";
import { useCharacters } from "../lib/characters";
import { useSettings } from "../lib/settings";
import { useJobs } from "../lib/jobs";
import { copyText } from "../lib/copy";
import { Btn, Icon, cx } from "./ui";

const when = (t: number) => {
  const d = new Date(t), now = new Date();
  const day = d.toDateString() === now.toDateString() ? "Today" : new Date(now.getTime() - 86400000).toDateString() === d.toDateString() ? "Yesterday" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
};
const MODE: Record<string, string> = { references: "References", "first-last": "First → last", image: "Image → video", text: "Text only", ref: "References", fl: "First → last", i2v: "Image → video" };

export function sendPlanToAnimate(p: Plan) {
  const mode = p.mode === "references" || p.mode === "ref" ? "ref" : p.mode === "first-last" || p.mode === "fl" ? "fl" : p.mode === "image" || p.mode === "i2v" ? "i2v" : undefined;
  // the plan goes in as it is (planning off for it: it's already planned)
  useSettings.getState().set("animate", { prompt: p.text, seconds: p.seconds, ...(mode ? { mode } : {}) });
  updatePlan(p.id, { sent: Date.now() });
  useSettings.getState().setTab("animate");
  useJobs.getState().toast("In Animate — add the references if they're not there, then Make video", "good");
}

function Row({ p, names }: { p: Plan; names: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(p.note ?? "");
  return (
    <li className="border-b border-line2 py-2.5 last:border-0">
      <div className="flex items-start gap-2">
        <button onClick={() => updatePlan(p.id, { fav: !p.fav })} aria-pressed={!!p.fav} title={p.fav ? "Un-star" : "Star: kept at the top, never cleared"}
          className={cx("press mt-0.5 shrink-0 text-[15px] leading-none", p.fav ? "text-accent" : "text-dim hover:text-muted")}>{p.fav ? "★" : "☆"}</button>
        <button onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <span className={cx("block text-[13px] text-ink", !open && "line-clamp-2")}>{p.idea.trim() || p.text.slice(0, 160)}</span>
          <span className="mt-0.5 block text-[11.5px] text-dim">
            {when(p.at)} · {p.seconds} s · {MODE[p.mode] ?? p.mode}{names ? ` · ${names}` : ""}{p.made ? ` · ${p.made} video${p.made > 1 ? "s" : ""} made` : ""}
          </span>
        </button>
      </div>
      {open && (
        <div className="ml-6 mt-2 flex flex-col gap-2">
          <p className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-line2 bg-black/20 p-2.5 text-[12.5px] leading-relaxed text-muted">{p.text}</p>
          <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (p.note ?? "") && updatePlan(p.id, { note })}
            placeholder="Your note on it (what worked, what to change)" aria-label="Note"
            className="h-8 rounded-md border border-line bg-transparent px-2 text-[12.5px] text-ink placeholder:text-dim focus:border-accent focus:outline-none" />
          <div className="flex flex-wrap gap-2">
            <Btn small kind="primary" onClick={() => sendPlanToAnimate(p)}>Send to Animate <Icon name="arrow" size={13} /></Btn>
            <Btn small onClick={async () => { await copyText(p.text); useJobs.getState().toast("Copied", "good"); }}>Copy</Btn>
            <Btn small kind="danger" onClick={() => removePlan(p.id)} title="Delete this plan"><Icon name="trash" size={13} /></Btn>
          </div>
        </div>
      )}
      {!open && p.note && <p className="ml-6 mt-1 text-[11.5px] italic text-muted">“{p.note}”</p>}
    </li>
  );
}

/** the plans of one or more characters (Characters tab: one; Prompt: everyone in the references) */
export function PlanHistory({ charIds, limit = 8, empty }: { charIds: string[]; limit?: number; empty?: string }) {
  const all = usePlans((s) => s.list);
  const chars = useCharacters((s) => s.list);
  const [q, setQ] = useState("");
  const [n, setN] = useState(limit);
  const list = useMemo(() => {
    const seen = new Set<string>();
    const mine = charIds.flatMap((id) => plansFor(all, id)).filter((p) => !seen.has(p.id) && seen.add(p.id))
      .sort((a, b) => Number(!!b.fav) - Number(!!a.fav) || b.at - a.at);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? mine.filter((p) => words.every((w) => `${p.idea} ${p.text} ${p.note ?? ""}`.toLowerCase().includes(w))) : mine;
  }, [all, charIds.join(","), q]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (p: Plan) => p.chars.map((id) => chars.find((c) => c.id === id)?.name).filter(Boolean).join(" & ");
  if (!list.length && !q) return <p className="text-[12.5px] text-muted">{empty ?? "No planned prompts yet — plan a video with them (Prompt tab, or Animate with planning on) and it shows up here."}</p>;
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search their plans" aria-label="Search plans"
        className="mb-1 h-8 w-full rounded-md border border-line bg-transparent px-2 text-[12.5px] text-ink placeholder:text-dim focus:border-accent focus:outline-none" />
      <ul>{list.slice(0, n).map((p) => <Row key={p.id} p={p} names={charIds.length > 1 || p.chars.length > 1 ? nameOf(p) : ""} />)}</ul>
      {list.length > n && <button onClick={() => setN((x) => x + 20)} className="mt-1 text-[12px] text-accent hover:underline">Show {Math.min(20, list.length - n)} more of {list.length - n}</button>}
    </div>
  );
}
