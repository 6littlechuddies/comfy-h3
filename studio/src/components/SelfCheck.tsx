// "Check everything" — runs a tiny job through every downloaded model and shows pass / fail with the exact error.
import { create } from "zustand";
import { checkReport, runSelfCheck, useSelfCheck, type CheckState } from "../lib/selfcheck";
import { useJobs } from "../lib/jobs";
import { Modal } from "./Dialogs";
import { Btn, Icon, cx } from "./ui";
import { copyText } from "../lib/copy";

const useOpen = create<{ open: boolean }>(() => ({ open: false }));
export const openSelfCheck = () => useOpen.setState({ open: true });
const MARK: Record<CheckState, { t: string; c: string }> = {
  waiting: { t: "IN LINE", c: "text-dim" }, running: { t: "RUNNING", c: "text-accent" }, pass: { t: "PASS", c: "text-good" },
  fail: { t: "FAIL", c: "text-bad" }, skipped: { t: "SKIPPED", c: "text-dim" },
};

export function SelfCheck() {
  const open = useOpen((s) => s.open);
  const { running, checks, video } = useSelfCheck();
  const toast = useJobs((s) => s.toast);
  if (!open) return null;
  const failed = checks.filter((c) => c.state === "fail").length;
  const done = checks.filter((c) => c.state === "pass" || c.state === "fail" || c.state === "skipped").length;
  return (
    <Modal label="Check everything" width={640} onClose={() => useOpen.setState({ open: false })}>
      <div className="flex flex-col gap-3 p-5">
        <div>
          <h2 className="display text-[20px] leading-tight">Check everything</h2>
          <p className="mt-1 text-[13px] text-muted">A tiny job through every model that's downloaded (pictures at 512 px, 2 steps). A broken piece shows its exact error here — copy the report and send it to Claude.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn kind="primary" disabled={running} why="Checking…" onClick={() => runSelfCheck(false)}>{running ? `Checking… ${done}/${checks.length}` : checks.length ? "Check again" : "Start the check"}</Btn>
          <Btn disabled={running} why="Checking…" onClick={() => runSelfCheck(true)} title="Also makes a 1-second H3 clip — loads the 47 GB video model, a few minutes">+ include video</Btn>
          {checks.length > 0 && !running && <Btn onClick={() => copyText(checkReport(), "Report copied — paste it to Claude")}><Icon name="script" size={13} /> Copy report</Btn>}
          {checks.length > 0 && !running && <span className={cx("micro ml-auto", failed ? "text-bad" : "text-good")}>{failed ? `${failed} FAILED` : "ALL GOOD"}{video ? " · WITH VIDEO" : ""}</span>}
        </div>
        {checks.length > 0 && (
          <div className="flex max-h-[52vh] flex-col overflow-y-auto border border-line">
            {checks.map((c) => (
              <div key={c.id} className="flex flex-col gap-1 border-b border-line2 px-3 py-2 last:border-b-0">
                <div className="flex items-center gap-3 text-[13px]">
                  <span className={cx("micro w-16 shrink-0", MARK[c.state].c)}>{MARK[c.state].t}</span>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  <span className="micro shrink-0 text-dim">{c.ms ? `${Math.round(c.ms / 1000)} S` : c.state === "running" && c.note ? c.note.toUpperCase() : ""}{c.state === "pass" && c.id === "sam" && c.note ? ` · ${c.note.toUpperCase()}` : ""}</span>
                </div>
                {c.error && <p className={cx("ml-[76px] whitespace-pre-wrap break-words font-mono text-[11.5px] leading-snug", c.state === "fail" ? "text-bad" : "text-dim")}>{c.error}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
