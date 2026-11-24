// Cosplays: one button finds every cosplay in your results and makes, names and writes each one (lib/cosplayRun.ts);
// then a card per character — her main picture big, the rest beside it: click one to make it her main picture. Send.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { viewUrl } from "../lib/api";
import { useCharacters, type Character } from "../lib/characters";
import { charFor, runCosplays, scanCosplays, setMain, useCosplays, type CosGroup } from "../lib/cosplayRun";
import { useJobs } from "../lib/jobs";
import { Thumb } from "./Thumb";
import { Icon, cx } from "./ui";
import { openViewer } from "./Viewer";

export function CosplaysHost() {
  const open = useCosplays((s) => s.open);
  return open ? <CosplaysPanel /> : null;
}

type Filter = "all" | "pick" | "write" | "test" | "ready" | "sent" | "problem";
const hotOk = (c?: Character) => { const h = c?.site?.chat?.hot; return !!h && h.tease.length >= 8 && h.explicit.length >= 8 && h.after.length >= 8; };
const bad = (t?: string) => !!t && /^(Didn't|Not sent)/.test(t);
/** where a character is: what's left for her */
function stage(c: Character | undefined, status?: string): Exclude<Filter, "all"> {
  if (bad(status)) return "problem";
  if (!c || !c.site?.persona) return "write";
  if (c.site.sent?.ok) return "sent";
  if (!c.site.chatTest?.pass) return "test";
  if (c.site.mainAuto || !c.site.mainFrom) return "pick";
  return "ready";
}

function CosplaysPanel() {
  const { groups, status, running, scanned, done, total, now } = useCosplays();
  const chars = useCharacters((s) => s.list);
  const toast = useJobs((s) => s.toast);
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const close = () => useCosplays.setState({ open: false });
  const [looking, setLooking] = useState(false);
  // opening: just look (nothing is made until you press the button)
  useEffect(() => {
    if (useCosplays.getState().running || useCosplays.getState().groups.length) return;
    setLooking(true);
    scanCosplays().then((g) => useCosplays.setState((s) => ({ groups: g, status: { ...s.status, _: "" } })))
      .catch((e) => useCosplays.setState((s) => ({ status: { ...s.status, _: `Couldn't look through your results: ${(e as Error).message}` } })))
      .finally(() => setLooking(false));
  }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[aria-label='Picture viewer']")) close(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);

  const rows = useMemo(() => groups.map((g) => { const c = charFor(g, chars); return { g, c, st: stage(c, status[g.key]) }; }), [groups, chars, status]);
  const count = (f: Filter) => (f === "all" ? rows.length : rows.filter((r) => r.st === f).length);
  const made = rows.filter((r) => r.c).length;
  const written = rows.filter((r) => r.c?.site?.persona).length;
  const passed = rows.filter((r) => r.c?.site?.chatTest?.pass).length;
  const sent = count("sent"), toPick = count("pick"), ready = count("ready");
  const shown = rows.filter((r) => (filter === "all" || r.st === filter) && (!q.trim() || `${r.g.name} ${r.g.series} ${r.c?.site?.name ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const current = now ? groups.find((g) => g.key === now) : undefined;
  const step = !groups.length || made < groups.length || written < groups.length || passed < written ? 1 : toPick ? 2 : 3;

  const sendAll = async () => {
    const cfg = await (await fetch("/studio-api/site/config")).json().catch(() => ({}));
    if (!cfg?.set) { toast("Connect your site first (Your site → the key and address)", "bad"); return; }
    setSending(true);
    const { sendOne } = await import("./SiteLink");
    let ok = 0;
    for (const { g } of rows) {
      const c = charFor(g, useCharacters.getState().list);
      if (!c?.site?.persona || !c.site.chatTest?.pass) continue; // only what passed the chat test goes to the site
      const say = (t: string) => useCosplays.setState((s) => ({ status: { ...s.status, [g.key]: t } }));
      say("Sending…");
      const r = await sendOne(c, say).catch((e) => ({ ok: false, note: (e as Error).message }));
      if (r.ok) ok++;
      say(r.ok ? `Sent as a draft · ${r.note}` : `Not sent: ${r.note}`);
    }
    setSending(false);
    toast(`Sent ${ok} as drafts`, ok ? "good" : "bad");
  };

  const STEPS = [
    { n: 1, title: "Make & chat-test them", sub: groups.length ? `${written} of ${groups.length} written · ${rows.filter((r) => r.c?.site?.chatTest?.pass).length} passed` : "find, name, write, test" },
    { n: 2, title: "Pick each main picture", sub: written ? (toPick ? `${toPick} still on the newest` : "all picked") : "after they're made" },
    { n: 3, title: "Send to your site", sub: sent ? `${sent} sent${ready ? ` · ${ready} ready` : ""}` : ready ? `${ready} ready` : "as drafts" },
  ];
  const FILTERS: [Filter, string][] = [["all", "All"], ["pick", "To pick"], ["write", "Not written"], ["test", "Failed test"], ["ready", "Ready"], ["sent", "Sent"], ["problem", "Problems"]];

  return createPortal(
    <div className="fade-in fixed inset-0 z-[82] flex flex-col bg-bg" role="dialog" aria-modal aria-label="Cosplays">
      {/* header: name, what this is, the actions */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-6 pb-3 pt-4">
        <div className="mr-auto min-w-0">
          <h2 className="display text-[22px] leading-none text-ink">Cosplays</h2>
          <p className="mt-1.5 text-[12.5px] text-muted">
            {looking ? "Looking through your results…" : groups.length ? `${groups.length} characters in ${groups.reduce((a, g) => a + g.pics.length, 0).toLocaleString()} pictures` : "Every cosplay in your results, made into characters for your site"}
          </p>
        </div>
        {running
          ? <button onClick={() => useCosplays.setState({ stop: true })} className="press flex h-10 items-center gap-2 border border-bad/50 px-4 text-[13px] font-semibold text-bad hover:bg-bad/10"><Icon name="stop" size={14} /> Stop after this one</button>
          : <>
            <button onClick={() => void runCosplays({ again: true })} disabled={!groups.length} title="Every profile and its chat lines written again — for when the writer has changed"
              className="press chip-raised flex h-10 items-center gap-2 px-3.5 text-[12.5px] text-muted hover:text-ink disabled:opacity-40"><Icon name="refresh" size={13} /> Write all again</button>
            <button disabled={sending || !passed} onClick={() => void sendAll()} title="Every one that passed her chat test, to your site as a draft"
              className={cx("press flex h-10 items-center gap-2 px-4 text-[13px] font-semibold disabled:opacity-40", step === 3 ? "btn-primary" : "btn-raised")}><Icon name="up" size={14} /> {sending ? "Sending…" : `Send ${passed || ""}`.trim()}</button>
            <button onClick={() => void runCosplays()} title="Makes every cosplay that doesn't exist yet, names her for your site, writes her profile and chat lines, and gives her the newest picture as main. Done ones are skipped; nothing is sent."
              className={cx("press flex h-10 items-center gap-2 px-5 text-[13px] font-semibold", step === 1 ? "btn-primary" : "btn-raised")}><Icon name="sparkle" size={14} /> {made && made === groups.length && written === groups.length ? "Find new ones" : "Make them all"}</button>
          </>}
        <button aria-label="Close" onClick={close} className="press btn-raised flex h-10 w-10 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={16} /></button>
      </div>

      {/* the three steps, with where you are */}
      <ol className="grid grid-cols-3 border-b border-line bg-panel">
        {STEPS.map((s) => (
          <li key={s.n} className={cx("flex items-center gap-3 border-r border-line px-6 py-3 last:border-r-0", step === s.n && "seg-on")}>
            <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center border font-mono text-[12px]", step > s.n ? "border-good/60 text-good" : step === s.n ? "border-accent text-accent" : "border-line text-dim")}>
              {step > s.n ? <Icon name="check" size={13} /> : s.n}</span>
            <span className="min-w-0">
              <span className={cx("block text-[13.5px] font-semibold", step >= s.n ? "text-ink" : "text-muted")}>{s.title}</span>
              <span className="block truncate text-[12px] text-dim">{s.sub}</span>
            </span>
          </li>))}
      </ol>

      {/* the run, while it goes */}
      {running && (
        <div className="border-b border-line bg-panel2 px-6 py-2.5">
          <div className="flex items-center gap-3 text-[12.5px]">
            <span className="pulse h-2 w-2 shrink-0 bg-accent" />
            <span className="min-w-0 flex-1 truncate text-ink">{current ? <><b>{charFor(current, chars)?.site?.name || current.name}</b> <span className="text-muted">· {status[current.key]}</span></> : status._ || "Starting…"}</span>
            <span className="font-mono text-[12px] text-muted">{total ? `${done} / ${total}` : scanned ? `${scanned.toLocaleString()} looked at` : ""}</span>
          </div>
          <div className="mt-2 h-[2px] bg-line"><div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${total ? (done / total) * 100 : 4}%` }} /></div>
        </div>)}
      {!running && status._ && <div className="border-b border-line bg-panel2 px-6 py-2.5 text-[12.5px] text-muted">{status._}</div>}

      {/* filters */}
      {!!groups.length && (
        <div className="flex flex-wrap items-center gap-1.5 px-6 pb-1 pt-4">
          {FILTERS.map(([f, l]) => { const n = count(f); if (f !== "all" && !n && filter !== f) return null; return (
            <button key={f} onClick={() => setFilter(f)} className={cx("press tag-btn !inline-flex !h-8 items-center gap-2 !px-3 !text-[12.5px]", filter === f && "on", f === "problem" && filter !== f && "!border-bad/50 !text-bad")}>
              {l}<span className={cx("font-mono text-[11px]", filter === f ? "opacity-70" : "text-dim")}>{n}</span></button>); })}
          <span className="ml-auto flex items-center gap-2 text-[12px] text-dim">
            <span className="hidden lg:inline">Click a picture to make it her main · double-click to see it big</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a character" aria-label="Find a character"
              className="inset h-8 w-52 border border-line px-2.5 text-[13px] text-ink focus:border-accent focus:outline-none" />
          </span>
        </div>)}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-3">
        {looking && !groups.length && <div className="grid gap-3 xl:grid-cols-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="shimmer h-[248px] border border-line" />)}</div>}
        {!looking && !groups.length && (
          <div className="mx-auto mt-16 max-w-md text-center">
            <p className="text-[15px] font-semibold text-ink">No cosplay pictures found</p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">They're found by their Batch label ("Batch 30 · Makima (Chainsaw Man) · 1/4"), by "cosplaying Makima from Chainsaw Man" in how they were made, or by a name on your Cosplay list.</p>
          </div>)}
        {!!groups.length && !shown.length && <p className="mt-10 text-center text-[13px] text-muted">Nothing here{q ? ` for “${q}”` : ""}.</p>}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {shown.map(({ g, c, st }) => <Card key={g.key} g={g} c={c} st={st} status={status[g.key]} working={now === g.key} />)}
        </div>
      </div>
    </div>, document.body);
}

const PIPS: [string, (c?: Character) => boolean][] = [["Made", (c) => !!c], ["Profile", (c) => !!c?.site?.persona], ["Chat lines", hotOk], ["Chat test", (c) => !!c?.site?.chatTest?.pass], ["Sent", (c) => !!c?.site?.sent?.ok]];

function Card({ g, c, st, status, working }: { g: CosGroup; c?: Character; st: ReturnType<typeof stage>; status?: string; working: boolean }) {
  const toast = useJobs((s) => s.toast);
  const main = c?.site?.mainFrom;
  const isMain = (p: { filename: string; subfolder: string }) => !!main && main.filename === p.filename && (main.subfolder ?? "") === (p.subfolder ?? "");
  const mainPic = g.pics.find(isMain) ?? g.pics[0];
  const rest = g.pics.filter((p) => p !== mainPic);
  const hot = c?.site?.chat?.hot;
  const view = (p: CosGroup["pics"][number]) => openViewer(g.pics.map((x) => ({ url: viewUrl(x), kind: "image" as const, label: x.label, download: x.filename })), g.pics.indexOf(p));
  const pick = async (p: CosGroup["pics"][number]) => {
    if (!c) { toast("Press Make them all first — her main picture can be picked once she's made", "info"); return; }
    try { await setMain(c.id, p); } catch (e) { toast((e as Error).message, "bad"); }
  };
  const keep = async () => { if (c && mainPic) await pick(mainPic); };
  return (
    <article className={cx("card fade-up flex min-w-0 gap-4 border p-3", working ? "border-accent/70" : st === "problem" ? "border-bad/50" : "border-line")}>
      {/* her main picture */}
      <div className="relative w-[168px] shrink-0">
        <button onDoubleClick={() => mainPic && view(mainPic)} title="Her main picture — her card on your site, and her animated cover later. Double-click to see it big"
          className="press block aspect-[3/4] w-full overflow-hidden border border-line bg-black">
          {mainPic ? <Thumb f={mainPic} className="h-full w-full object-cover" /> : <span className="hatch block h-full w-full" />}
        </button>
        <span className={cx("micro absolute left-0 top-0 px-1.5 py-1", c?.site?.mainAuto || !main ? "bg-black/75 text-muted" : "bg-accent text-accentink")}>
          {c?.site?.mainAuto || !main ? "Newest" : "Main"}</span>
        {c?.site?.mainAuto && (
          <button onClick={() => void keep()} className="press absolute inset-x-0 bottom-0 bg-black/80 py-1.5 text-[12px] font-semibold text-ink hover:bg-accent hover:text-accentink">Keep this one</button>)}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[17px] font-semibold leading-tight text-ink">{c?.site?.name || c?.name || g.name}</h3>
            <p className="truncate text-[12.5px] text-muted">{c?.site?.name && c.site.name !== g.name ? <>as {g.name}<span className="text-dim"> · </span></> : null}<span className="text-dim">{g.series || "cosplay"}</span></p>
          </div>
          <span className="font-mono text-[11px] text-dim">{g.pics.length} pic{g.pics.length === 1 ? "" : "s"}</span>
        </div>

        {/* where she is */}
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
          {PIPS.map(([l, ok]) => { const on = ok(c); return (
            <span key={l} className={cx("flex items-center gap-1.5 text-[12px]", on ? "text-good" : "text-dim")}>
              <span className={cx("flex h-3.5 w-3.5 items-center justify-center border", on ? "border-good/60 bg-good/10" : "border-line")}>{on && <Icon name="check" size={9} />}</span>
              {l}{l === "Chat lines" && hot ? <span className="font-mono text-[10.5px] opacity-75">{hot.tease.length}/{hot.explicit.length}/{hot.after.length}</span> : null}
              {l === "Chat test" && c?.site?.chatTest ? <span className={cx("font-mono text-[10.5px]", c.site.chatTest.pass ? "opacity-75" : "text-bad")}>{c.site.chatTest.score}</span> : null}
            </span>); })}
        </div>

        <p className={cx("mt-1.5 min-h-[18px] truncate text-[12.5px]", bad(status) ? "text-bad" : working ? "text-accent" : "text-muted")} title={status}>
          {status ?? (st === "pick" ? "Showing her newest picture — click another, or keep it" : st === "ready" ? "Ready to send" : st === "sent" ? "On your site as a draft" : st === "test" ? (c?.site?.chatTest ? `Failed the chat test (${c.site.chatTest.score}/100) — open her page to see why` : "Not chat-tested yet") : !c ? "Not made yet" : "")}</p>

        {/* the rest of her pictures */}
        <div className="mt-auto flex gap-1.5 overflow-x-auto pb-1 pt-2">
          {rest.map((p) => (
            <button key={`${p.subfolder}/${p.filename}`} onClick={() => void pick(p)} onDoubleClick={() => view(p)} title="Make this her main picture · double-click to see it big"
              className="press group relative h-[104px] w-[78px] shrink-0 overflow-hidden border border-line bg-black hover:border-accent">
              <Thumb f={p} w={192} className="h-full w-full object-cover transition-opacity group-hover:opacity-80" />
              <span className="micro absolute inset-x-0 bottom-0 translate-y-full bg-accent py-0.5 text-center text-accentink transition-transform group-hover:translate-y-0">Main</span>
            </button>))}
          {!rest.length && <span className="self-center text-[12px] text-dim">Her only picture</span>}
        </div>
      </div>
    </article>
  );
}
