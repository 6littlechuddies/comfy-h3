// Cosplays: one button finds every cosplay in your results and makes, names and writes each one (lib/cosplayRun.ts);
// then one row per character with all her pictures — click the one you want as her main picture, and Send them all.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useCharacters } from "../lib/characters";
import { charFor, runCosplays, scanCosplays, setMain, useCosplays, type CosGroup } from "../lib/cosplayRun";
import { useJobs } from "../lib/jobs";
import { openViewer } from "./Viewer";
import { viewUrl } from "../lib/api";
import { Thumb } from "./Thumb";
import { Icon, cx } from "./ui";

export function CosplaysHost() {
  const open = useCosplays((s) => s.open);
  return open ? <CosplaysPanel /> : null;
}

function CosplaysPanel() {
  const { groups, status, running, scanned } = useCosplays();
  const chars = useCharacters((s) => s.list);
  const toast = useJobs((s) => s.toast);
  const [sending, setSending] = useState(false);
  const close = () => useCosplays.setState({ open: false });
  // opening: just look (nothing is made until you press the button)
  useEffect(() => {
    if (useCosplays.getState().running || useCosplays.getState().groups.length) return;
    useCosplays.setState((s) => ({ status: { ...s.status, _: "Looking through your results…" } }));
    scanCosplays().then((g) => useCosplays.setState((s) => ({ groups: g, status: { ...s.status, _: g.length ? "" : "No cosplay pictures found — they're found by their Batch label (\"Batch 30 · Makima (Chainsaw Man) · 1/4\")" } })))
      .catch((e) => useCosplays.setState((s) => ({ status: { ...s.status, _: `Couldn't look: ${(e as Error).message}` } })));
  }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[aria-label='Picture viewer']")) close(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);

  const made = groups.map((g) => charFor(g, chars)).filter(Boolean);
  const written = made.filter((c) => c!.site?.persona).length;
  const sendAll = async () => {
    const cfg = await (await fetch("/studio-api/site/config")).json().catch(() => ({}));
    if (!cfg?.set) { toast("Connect your site first (Your site → the key and address)", "bad"); return; }
    setSending(true);
    const { sendOne } = await import("./SiteLink");
    let ok = 0;
    for (const g of groups) {
      const c = charFor(g, useCharacters.getState().list);
      if (!c?.site?.persona) continue;
      useCosplays.setState((s) => ({ status: { ...s.status, [g.key]: "Sending…" } }));
      const r = await sendOne(c, (t) => useCosplays.setState((s) => ({ status: { ...s.status, [g.key]: t } }))).catch((e) => ({ ok: false, note: (e as Error).message }));
      if (r.ok) ok++;
      useCosplays.setState((s) => ({ status: { ...s.status, [g.key]: r.ok ? `Sent as a draft · ${r.note}` : `Not sent: ${r.note}` } }));
    }
    setSending(false);
    toast(`Sent ${ok} as drafts`, ok ? "good" : "bad");
  };

  return createPortal(
    <div className="fade-in fixed inset-0 z-[82] flex flex-col bg-bg/95 backdrop-blur-[2px]" role="dialog" aria-modal aria-label="Cosplays">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <b className="display text-[20px]">Cosplays</b>
        <span className="text-[12.5px] text-muted">{groups.length} found · {made.length} made · {written} written{running && scanned ? ` · ${scanned.toLocaleString()} results looked at` : ""}</span>
        <span className="ml-auto flex items-center gap-2">
          {running
            ? <button onClick={() => useCosplays.setState({ stop: true })} className="press flex h-9 items-center gap-1.5 rounded-sm border border-bad/50 px-3 text-[13px] text-bad hover:bg-bad/10"><Icon name="stop" size={13} /> Stop after this one</button>
            : <>
              <button onClick={() => void runCosplays()} title="Finds every cosplay in your results, makes the ones that don't exist yet, names them for your site, writes their profiles and chat lines, and gives each her newest picture as main. Already-done ones are skipped. Nothing is sent."
                className="press btn-primary flex h-9 items-center gap-1.5 rounded-sm px-4 text-[13px] font-semibold"><Icon name="sparkle" size={14} /> Make them all</button>
              <button onClick={() => void runCosplays({ again: true })} title="The same, but every profile is written again" className="press chip-raised flex h-9 items-center gap-1.5 rounded-sm px-3 text-[12.5px]"><Icon name="refresh" size={13} /> Write all again</button>
              <button disabled={sending || !written} onClick={() => void sendAll()} title="Every written one to your site as a draft" className="press chip-raised flex h-9 items-center gap-1.5 rounded-sm px-3 text-[12.5px] disabled:opacity-40"><Icon name="up" size={13} /> {sending ? "Sending…" : `Send ${written}`}</button>
            </>}
          <button aria-label="Close" onClick={close} className="press btn-raised flex h-9 w-9 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={15} /></button>
        </span>
      </div>
      {status._ && <div className="border-b border-line bg-panel px-5 py-2 text-[13px] text-muted">{status._}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        <p className="mb-3 text-[12.5px] text-dim">Click a picture to make it her main picture (her card, and the animated cover made later). Double-click to see it big.</p>
        <div className="flex flex-col gap-3">{groups.map((g) => <Row key={g.key} g={g} status={status[g.key]} />)}</div>
      </div>
    </div>, document.body);
}

function Row({ g, status }: { g: CosGroup; status?: string }) {
  const c = useCharacters((s) => charFor(g, s.list));
  const toast = useJobs((s) => s.toast);
  const main = c?.site?.mainFrom;
  const isMain = (p: { filename: string; subfolder: string }) => !!main && main.filename === p.filename && (main.subfolder ?? "") === (p.subfolder ?? "");
  const hot = c?.site?.chat?.hot;
  const pick = async (i: number) => {
    if (!c) { toast("Press Make them all first — she's made then", "info"); return; }
    try { await setMain(c.id, g.pics[i]); } catch (e) { toast((e as Error).message, "bad"); }
  };
  return (
    <div className="card flex gap-3 rounded-lg border border-line p-2.5">
      <div className="flex w-56 shrink-0 flex-col gap-1 text-[12.5px]">
        <b className="text-[15px] text-ink">{c?.site?.name || c?.name || g.name}</b>
        <span className="text-muted">Cosplay of {g.name}{g.series ? ` (${g.series})` : ""}</span>
        <span className="flex flex-wrap gap-1">
          <Chip on={!!c}>{c ? "made" : "not made"}</Chip>
          <Chip on={!!c?.site?.persona}>profile</Chip>
          <Chip on={!!hot && hot.tease.length >= 8 && hot.explicit.length >= 8 && hot.after.length >= 8}>chat lines{hot ? ` ${hot.tease.length}/${hot.explicit.length}/${hot.after.length}` : ""}</Chip>
          <Chip on={!!c?.site?.sent?.ok}>sent</Chip>
        </span>
        <span className="text-dim">{g.pics.length} picture{g.pics.length === 1 ? "" : "s"}</span>
        {status && <span className={cx("text-[12px]", /^(Didn't|Not sent)/.test(status) ? "text-bad" : "text-accent")}>{status}</span>}
      </div>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
        {g.pics.map((p, i) => (
          <button key={`${p.subfolder}/${p.filename}`} onClick={() => void pick(i)} onDoubleClick={() => openViewer(g.pics.map((x) => ({ url: viewUrl(x), kind: "image", label: x.label, download: x.filename })), i)}
            title={isMain(p) ? "Her main picture" : "Make this her main picture"}
            className={cx("press relative h-36 w-[108px] shrink-0 overflow-hidden border bg-black", isMain(p) ? "border-accent ring-2 ring-accent" : "border-line hover:border-accent/60")}>
            <Thumb f={p} className="h-full w-full object-cover" />
            {isMain(p) && <span className="micro absolute left-1 top-1 bg-accent px-1 text-black">MAIN</span>}
          </button>))}
      </div>
    </div>
  );
}

const Chip = ({ on, children }: { on: boolean; children: React.ReactNode }) =>
  <span className={cx("micro rounded-sm border px-1.5 py-0.5", on ? "border-good/50 text-good" : "border-line text-dim")}>{on ? "✓ " : ""}{children}</span>;
