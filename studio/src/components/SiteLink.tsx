// Your site: Characters › one character (profile + content folders) › one folder. Everything is sent as a draft through
// the site's factory API; a person publishes it in the site's admin panel. Built for doing many at once: pick several
// characters, let the writer fill their profiles, send them all.
import { Thumb } from "./Thumb";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { viewUrl, type FileRef } from "../lib/api";
import { coverOf, DEFAULT_AGE, describe, isAdult, useCharacters, VIEWS, type Character, type SiteInfo, type SiteSet, type View } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { runWriter } from "../lib/writer";
import { hasAge, stripAges } from "../lib/siteAuto";
import { Btn, DropSelect, Icon, Slot, TextArea, TextIn, cx } from "./ui";
import { createPortal } from "react-dom";
import { copyText } from "../lib/copy";
import { isFav, toggleFav, useFavs } from "../lib/favs";

const StarIcon = ({ on, size = 15 }: { on: boolean; size?: number }) =>
  <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? "#F0A845" : "none"} stroke={on ? "#F0A845" : "currentColor"} strokeWidth="2" aria-hidden><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>;

const useSite = create<{ open: boolean; charId: string | null; folder: number | null }>(() => ({ open: false, charId: null, folder: null }));
/** what each character is doing right now (writing, sending…) — kept when you close Your site, shown as a chip until done */
const useSiteBusy = create<{ busy: Record<string, string>; total: number; done: number }>(() => ({ busy: {}, total: 0, done: 0 }));
const mark = (id: string, t: string | null) => useSiteBusy.setState((s) => { const n = { ...s.busy }; if (t == null) delete n[id]; else n[id] = t; return { busy: n }; });
export const openSiteLink = (charId?: string) => useSite.setState({ open: true, charId: charId ?? null, folder: null });
const go = (charId: string | null, folder: number | null = null) => useSite.setState({ charId, folder });

type Cfg = { url: string; set: boolean; source: string | null };
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `set-${Date.now().toString(36)}`;
const RATINGS = [["sfw", "SFW", "safe for everyone"], ["suggestive", "Suggestive", "teasing, covered"], ["explicit", "Explicit", "age-gated"]] as const;
/** what the site last got, as a fingerprint — "changed since sent" when this no longer matches */
const fp = (c: Character) => JSON.stringify([c.name, c.site?.name, c.age, c.site?.bio, c.site?.greeting, c.site?.backstory, c.site?.personality, c.site?.persona, c.site?.voice, c.site?.quirks, c.site?.tags, c.site?.sets, c.site?.avatar, c.site?.cover, c.site?.avatarFile, c.site?.coverFile, c.cover?.v ?? c.cover?.filename, c.site?.loopFile]);
const status = (c: Character) => !c.site?.sent ? "new" : !c.site.sent.ok ? "failed" : c.site.sent.hash && c.site.sent.hash !== fp(c) ? "changed" : "sent";
const STATUS: Record<string, [string, string]> = { new: ["Not sent", "text-dim"], sent: ["Draft on the site", "text-good"], changed: ["Changed since sent", "text-hot"], failed: ["Last send failed", "text-bad"] };
const hasProfile = (c: Character) => !!(c.site?.bio && c.site?.persona);

/** the writer fills the profile from their look, their pictures' prompts and set titles; what you wrote stays unless `all` */
async function writeProfile(c: Character, all = false, onStep?: (t: string) => void) {
  const { fillProfile } = await import("../lib/siteAuto");
  return fillProfile(c, { all, onStep });
}

/** a believable adult age when she still has the default one: 21–30, mostly early twenties */
const randomAge = () => 21 + Math.floor(Math.random() ** 1.6 * 10);

/** everything for one character, in order: (named already by the batch) an age, her profile, her hover loop, sent as a
 *  draft. Her pictures aren't sorted into sets here — for now sets are made by hand in her folders. */
async function doItAll(c: Character, connected: boolean, step: (t: string) => void, loopMade?: Promise<unknown>): Promise<string> {
  const { fillProfile } = await import("../lib/siteAuto");
  const now0 = useCharacters.getState().list.find((x) => x.id === c.id)!;
  if (!(Number(now0.age) >= 21) || Number(now0.age) === DEFAULT_AGE) useCharacters.getState().save({ ...now0, age: randomAge() });
  step("Writing her profile…");
  await fillProfile(useCharacters.getState().list.find((x) => x.id === c.id)!, { onStep: step });
  // no hover loop picked yet: her newest loop (Video board / Animate), so the card moves on the site
  const now = useCharacters.getState().list.find((x) => x.id === c.id)!;
  // her hover loop, being made from her card in the queue since the start: waited for before she's sent
  if (loopMade && !now.site?.loopFile) { step("Waiting for her hover loop (made from her card)…"); await loopMade; }
  if (!useCharacters.getState().list.find((x) => x.id === c.id)?.site?.loopFile) {
    step("Looking for her hover loop…");
    const best = (await loopCandidates(now).catch(() => [])).find((x) => x.loop);
    if (best) useCharacters.getState().save({ ...now, site: { ...now.site, loopFile: best.file } });
  }
  if (!connected) return "named and written — connect your site to send";
  step("Sending…");
  const r = await sendOne(useCharacters.getState().list.find((x) => x.id === c.id)!, step);
  if (!r.ok) throw new Error(r.note);
  return `sent as a draft (${r.note})`;
}

/** after their cover photo changes: when they're already on your site (sent before), send the update as a draft again, in
 *  the background — so the site's cover follows the Studio. Returns what happened, or null when there was nothing to do. */
export async function resendIfSent(id: string): Promise<string | null> {
  const c = useCharacters.getState().list.find((x) => x.id === id);
  if (!c?.site?.sent?.ok) return null;
  try {
    const cfg: Cfg = await (await fetch("/studio-api/site/config")).json();
    if (!cfg?.set) return null;
    const r = await sendOne(c);
    return r.ok ? `Sent ${c.name}'s update to your site (as a draft — publish it there)` : `Couldn't update your site: ${r.note}`;
  } catch (e) { return `Couldn't update your site: ${(e as Error).message}`; }
}

/** send one character as a draft; returns the job's end state */
/** urgf.ai Chat v4.1: her typing settings, sample chats, voice examples and hot lines — written with her profile, or here */
function ChatPanel({ c, up, busy }: { c: Character; up: (p: Partial<SiteInfo>) => void; busy: boolean }) {
  const ch = c.site?.chat ?? {};
  const set = (p: Partial<NonNullable<SiteInfo["chat"]>>) => up({ chat: { ...ch, ...p } });
  const hot = ch.hot ?? { tease: [], explicit: [], after: [] };
  const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 15);
  const write = async () => {
    mark(c.id, "Writing her chat lines…");
    try {
      const { writeChatLines } = await import("../lib/chatLines");
      const notes = await writeChatLines(c, { onStep: (t) => mark(c.id, t) });
      useJobs.getState().toast(notes.length ? `Chat lines written — ${notes.length} note${notes.length === 1 ? "" : "s"} below` : "Chat lines written — every check passed", notes.length ? "info" : "good");
    } catch (e) { useJobs.getState().toast((e as Error).message, "bad"); } finally { mark(c.id, null); }
  };
  const n = (k: "tease" | "explicit" | "after") => hot[k].length;
  return (
    <details className="card rounded-lg border border-line p-2.5 text-[12.5px]">
      <summary className="cursor-pointer text-ink">Chat v4.1 · casing, emoji rate, heat holds, sample chats, voice examples, hot lines {ch.at ? `· tease ${n("tease")} · explicit ${n("explicit")} · after ${n("after")}` : "· not written yet"}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[12px] text-muted">Casing
            <DropSelect className="h-8 border border-line bg-panel px-2 text-ink" value={ch.casing ?? ""} onChange={(e) => set({ casing: (e.target.value || undefined) as never })}>
              <option value="">—</option><option value="lower">lower</option><option value="proper">proper</option><option value="custom">custom</option></DropSelect></label>
          {ch.casing === "custom" && <TextIn className="min-w-[220px] flex-1" label="Her quirk" value={ch.casingCustom ?? ""} onChange={(v) => set({ casingCustom: v })} placeholder="lowercase, CAPS for emphasis, stretches words" />}
          <label className="flex flex-col gap-1 text-[12px] text-muted">Emoji rate
            <DropSelect className="h-8 border border-line bg-panel px-2 text-ink" value={ch.emojiRate ?? ""} onChange={(e) => set({ emojiRate: (e.target.value || undefined) as never })}>
              <option value="">—</option>{["none", "rare", "some", "often"].map((x) => <option key={x} value={x}>{x}</option>)}</DropSelect></label>
          <label className="flex flex-col gap-1 text-[12px] text-muted" title="Blank = the site's default. 1–2 only for a guarded or slow-burn girl">Heat holds
            <DropSelect className="h-8 border border-line bg-panel px-2 text-ink" value={ch.heatHolds ?? ""} onChange={(e) => set({ heatHolds: e.target.value ? Number(e.target.value) : null })}>
              <option value="">site default</option><option value="1">1</option><option value="2">2</option></DropSelect></label>
          <TextIn className="min-w-[160px] flex-1" label="Level emojis · 7, lowest first" value={(ch.levelEmojis ?? []).join(" ")} onChange={(v) => set({ levelEmojis: v.split(/\s+/).filter(Boolean).slice(0, 7) })} />
          <Btn small disabled={busy || !c.site?.persona} onClick={write} title="Sample chats for the 11 core situations, the paid and free voice examples and her hot lines — from her profile; checked against the site's rules and other characters' lines (about a minute)">
            <Icon name="script" size={13} /> {ch.at ? "Write them again" : "Write chat lines"}</Btn>
        </div>
        <p className="text-dim">Facts sent with them: {["job", "city", "home", "wearing"].map((k) => `${k} ${(c.site?.facts as Record<string, string> | undefined)?.[k] || "—"}`).join(" · ")} · signature words and emoji are above.</p>
        <TextArea label="Examples · <START> / him: / her name: — blank line between her bubbles" rows={10} value={ch.examples ?? ""} onChange={(v) => set({ examples: v })} />
        <div className="grid grid-cols-2 gap-2">
          <TextArea label="Voice example (paid) · sends [voice note: …], 30 words max" rows={4} value={ch.voicePaid ?? ""} onChange={(v) => set({ voicePaid: v })} />
          <TextArea label="Voice example (free) · teases in text, no voice note" rows={4} value={ch.voiceFree ?? ""} onChange={(v) => set({ voiceFree: v })} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["tease", "explicit", "after"] as const).map((k) => (
            <TextArea key={k} label={`Hot lines · ${k} (${n(k)}, 8–15) · one per line, 14 words max`} rows={8} value={hot[k].join("\n")} onChange={(v) => set({ hot: { ...hot, [k]: lines(v) } })} />))}
        </div>
        {!!ch.notes?.length && <ul className="list-disc pl-4 text-dim">{ch.notes.slice(0, 12).map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </div>
    </details>
  );
}

async function sendOne(c: Character, onStep?: (t: string) => void, short = false): Promise<{ ok: boolean; note: string }> {
  // example messages in the persona ("You: …") are refused by the site: described instead, before sending
  { const { describeNotDemonstrate } = await import("../lib/siteAuto"); if (await describeNotDemonstrate(c, onStep).catch(() => false)) c = useCharacters.getState().list.find((x) => x.id === c.id) ?? c; }
  const start = await (await fetch("/studio-api/site/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ char_id: c.id, short_persona: short }) })).json();
  const { watchServerJob } = await import("../lib/serverJob");
  type Push = { status: string; id: string; step?: string; total?: number; done?: number; uploaded?: number; error?: string; chat_note?: string };
  let j: Push;
  try {
    j = await watchServerJob<Push & { [k: string]: unknown }>(`/studio-api/site/push/${start.id}`, { what: "the send", every: 1500,
      onUpdate: (x) => onStep?.(`${x.step}${x.total ? ` · ${x.done ?? 0}/${x.total} files` : ""}`) });
  } catch (e) { j = { status: "error", id: start.id, error: (e as Error).message }; }
  // the site refused the deep persona for its length: sent again with the short one (the deep one stays in the Studio)
  if (j.status !== "done" && !short && c.site?.personaCore && /persona/i.test(String(j.error)) && /long|length|characters|max|exceed|too many/i.test(String(j.error))) {
    onStep?.("The site wants a shorter persona — sending the short one…");
    const r = await sendOne(c, onStep, true);
    return r.ok ? { ok: true, note: `${r.note} · short persona (the site refused the deep one: ${String(j.error).slice(0, 120)})` } : r;
  }
  const ok = j.status === "done";
  const note = ok ? `${j.uploaded ?? 0} new file${j.uploaded === 1 ? "" : "s"}${j.chat_note ? ` · ${j.chat_note}` : ""}` : String(j.error);
  const cur = useCharacters.getState().list.find((x) => x.id === c.id)!;
  // which files the site has now (ON SITE in the folder picker, so a picture isn't put in a second set by accident)
  const sentKeys = ok ? [...new Set([...(cur.site?.sentKeys ?? []), ...(cur.site?.sets ?? []).flatMap((x) => x.items.map((it) => `${it.subfolder}/${it.filename}`))])] : cur.site?.sentKeys;
  useCharacters.getState().save({ ...cur, site: { ...cur.site, sent: { at: Date.now(), ok, note, hash: fp(cur) }, ...(sentKeys ? { sentKeys } : {}) } });
  return { ok, note };
}

const isVideo = (f: FileRef) => /\.(mp4|webm|mov)$/i.test(f.filename);
type LoopPick = { file: FileRef; loop: boolean; at: number; label?: string };
/** her videos that could be the hover loop: Video board / Animate loops first (they start and end on her picture), then
 *  her other videos; newest first. From this browser's results and everything of hers on the rental. */
export async function loopCandidates(c: Character): Promise<LoopPick[]> {
  const out = new Map<string, LoopPick>();
  const looks = (label?: string, mode?: unknown) => mode === "loop" || /\bloop\b/i.test(label ?? "");
  for (const j of useJobs.getState().jobs) {
    if (j.status !== "done" || (j.meta?.project !== c.id && !(c.name && j.label.startsWith(`${c.name} ·`)))) continue;
    const mode = (j.meta?.opts as { mode?: string } | undefined)?.mode;
    for (const o of j.outputs) if (o.type === "output" && isVideo(o)) out.set(`${o.subfolder}/${o.filename}`, { file: { filename: o.filename, subfolder: o.subfolder, type: o.type }, loop: looks(j.label, mode), at: j.endedAt ?? j.queuedAt, label: j.label });
  }
  try {
    const { charPictures } = await import("../lib/siteAuto");
    for (const p of await charPictures(c)) {
      const k = `${p.file.subfolder}/${p.file.filename}`;
      if (!isVideo(p.file) || out.has(k)) continue;
      out.set(k, { file: p.file, loop: looks(p.label), at: 0, label: p.label });
    }
  } catch { /* the rental's list is optional */ }
  return [...out.values()].sort((a, b) => Number(b.loop) - Number(a.loop) || b.at - a.at);
}

/** hover loops for many characters at once: each one's loop candidates in a row, click to choose; "Newest loop for all" */
function BulkLoops({ chars, onClose }: { chars: Character[]; onClose: () => void }) {
  const save = useCharacters((s) => s.save);
  const toast = useJobs((s) => s.toast);
  const live = useCharacters((s) => s.list);
  const [cands, setCands] = useState<Record<string, LoopPick[]>>({});
  const favs = useFavs((s) => s.set);
  // your ★ ones first, then loops, then the rest (newest first within each)
  const ordered = (l: LoopPick[] | undefined) => l && [...l].sort((a, b) => Number(isFav(favs, b.file)) - Number(isFav(favs, a.file)));
  useEffect(() => { chars.forEach((c) => loopCandidates(c).then((l) => setCands((m) => ({ ...m, [c.id]: l }))).catch(() => setCands((m) => ({ ...m, [c.id]: [] })))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (id: string, f: FileRef | undefined) => { const cur = useCharacters.getState().list.find((x) => x.id === id); if (cur) save({ ...cur, site: { ...cur.site, loopFile: f ? { filename: f.filename, subfolder: f.subfolder, type: f.type } : undefined } }); };
  const [takes, setTakes] = useState(1);
  const pinned = live.filter((x) => chars.some((c) => c.id === x.id) && x.site?.coverVideoPin);
  const autoAll = (onlyEmpty: boolean) => {
    let n = 0;
    for (const c of chars) {
      const cur = useCharacters.getState().list.find((x) => x.id === c.id);
      const l = cands[c.id] ?? [];
      const first = l.find((x) => isFav(favs, x.file) && x.loop) ?? l.find((x) => isFav(favs, x.file)) ?? l.find((x) => x.loop) ?? l[0];
      if (!cur || !first || (onlyEmpty && cur.site?.loopFile)) continue;
      choose(c.id, first.file); n++;
    }
    toast(n ? `Animated cover set for ${n} — check them, then Send as drafts` : "Nothing to set — no videos found for the ones without one", n ? "good" : "info");
  };
  return createPortal(
    <div className="fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onMouseDown={onClose}>
      <div className="flex max-h-full w-full max-w-[1200px] flex-col border border-line bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <b className="text-[14px]">Animated covers · {chars.length} character{chars.length === 1 ? "" : "s"}</b>
          <span className="text-[12px] text-muted">The video her card plays when someone hovers it on your site. Pin the ones that need one, make the pinned ones in one go (on a multi-GPU rental they run side by side), then click the video you want for each — or let ★ / newest pick for all. Each video stays with its character.</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Btn onClick={async () => { const { pinCoverVideo } = await import("../lib/siteMedia"); let n = 0; for (const c of chars) { const x = useCharacters.getState().list.find((y) => y.id === c.id); if (x && !x.site?.loopFile && !x.site?.coverVideoPin && (x.cover || x.views.front)) { pinCoverVideo(x.id); n++; } } toast(n ? `Pinned ${n} without an animated cover` : "Every one has one or is pinned already", "info"); }}
              title="Pin every one without an animated cover (made from her card)">Pin all without one</Btn>
            <DropSelect value={String(takes)} onChange={(e) => setTakes(Number(e.target.value))} aria-label="Takes per character" className="inset h-9 border border-line bg-raised px-2 text-[12.5px]">
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n} take{n > 1 ? "s" : ""} each</option>)}</DropSelect>
            <Btn kind="primary" disabled={!pinned.length} onClick={async () => { const { makePinned } = await import("../lib/hoverLoop"); toast(`Making ${pinned.length * takes} animated cover${pinned.length * takes > 1 ? "s" : ""} — they're queued; each shows up here when done`, "good"); makePinned(pinned.map((c) => c.id), takes).then(() => chars.forEach((c) => loopCandidates(c).then((l) => setCands((m) => ({ ...m, [c.id]: l }))).catch(() => {}))); }}
              title="Make every pinned one now, from the picture it was pinned with (her card)">Make the pinned ones · {pinned.length}</Btn>
            <Btn onClick={() => autoAll(true)} title="Her newest loop, only for characters without a hover loop yet">Newest loop where empty</Btn>
            <Btn kind="primary" onClick={() => autoAll(false)} title="Her newest loop for every one of them (replaces the ones you picked)">Newest loop for all</Btn>
            <button aria-label="Close" className="ml-2 text-muted hover:text-ink" onClick={onClose}><Icon name="x" size={16} /></button>
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
          {chars.map((c0) => {
            const c = live.find((x) => x.id === c0.id) ?? c0;
            const cur = c.site?.loopFile;
            const list = ordered(cands[c.id]);
            return (
              <div key={c.id} className="flex items-stretch gap-3 border-b border-line/60 pb-3">
                <div className="flex w-28 shrink-0 flex-col gap-1">
                  <img src={viewUrl((c.cover ?? c.views.front)!)} alt="" className="aspect-[3/4] w-full border border-line object-cover" />
                  <span className="truncate text-[12.5px] font-semibold">{c.name}</span>
                  <span className={cx("text-[11px]", cur ? "text-good" : c.site?.coverVideoPin ? "text-accent" : "text-dim")}>{cur ? "Cover video set" : c.site?.coverVideoPin ? "Pinned — not made yet" : "None"}</span>
                  <button className="self-start text-[11px] text-muted hover:text-ink" onClick={async () => { const m = await import("../lib/siteMedia"); if (c.site?.coverVideoPin) m.unpinCoverVideo(c.id); else m.pinCoverVideo(c.id); }}>{c.site?.coverVideoPin ? "Unpin" : "Pin for one"}</button>
                  {cur && <button className="self-start text-[11px] text-muted hover:text-bad" onClick={() => choose(c.id, undefined)}>Clear</button>}
                </div>
                <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
                  {!list ? <span className="self-center text-[12px] text-muted">Finding her videos…</span>
                    : !list.length ? <span className="self-center text-[12px] text-muted">No videos of {c.name} yet — pin her, then Make the pinned ones.</span>
                    : list.slice(0, 12).map((x) => {
                      const on = !!cur && cur.filename === x.file.filename && (cur.subfolder || "") === (x.file.subfolder || "");
                      return (
                        <button key={`${x.file.subfolder}/${x.file.filename}`} onClick={() => choose(c.id, x.file)} title={x.label ?? x.file.filename}
                          className={cx("group/tile press relative aspect-[3/4] h-44 shrink-0 overflow-hidden border-2 bg-black", on ? "border-accent" : isFav(favs, x.file) ? "border-[#F0A845]/60" : "border-transparent hover:border-muted")}>
                          <video src={viewUrl(x.file)} muted loop playsInline preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} className="h-full w-full object-cover" />
                          <span className={cx("micro absolute left-1 top-1 px-1", x.loop ? "bg-accent text-accentink" : "bg-black/70 text-white")}>{x.loop ? "LOOP" : "VIDEO"}</span>
                          {on && <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center bg-accent text-accentink"><Icon name="check" size={13} /></span>}
                          {/* ★ your favourites (click the star to change it) */}
                          <span role="button" tabIndex={0} aria-label={isFav(favs, x.file) ? "Remove from favourites" : "Add to favourites"} title={isFav(favs, x.file) ? "Favourite — click to remove" : "Add to favourites"}
                            onClick={(e) => { e.stopPropagation(); toggleFav(x.file); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); toggleFav(x.file); } }}
                            className={cx("absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center bg-black/70", isFav(favs, x.file) ? "text-[#F0A845]" : "text-white/70 opacity-0 hover:text-white group-hover/tile:opacity-100")}>
                            <StarIcon on={isFav(favs, x.file)} />
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>, document.body);
}

// ------------------------------------------------------------------ bulk names: a first name for each, from their look
type NameIdea = { id: string; name: string; alt: string[]; why: string; on: boolean };
export const autoNamed = (c: Character) => c.name.includes("·") || /\b(hair|bob|braid|ponytail|bangs|top|tank|dress|outfit)\b/i.test(c.name);
const okName = (n: string) => /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’-]{1,23}$/.test(n.trim()) && !/\b(teen|kid|child|loli|minor|young|baby)\b/i.test(n);

export async function suggestNames(chars: Character[], avoid: string[] = []): Promise<NameIdea[]> {
  const chosen = new Set(chars.map((c) => c.id));
  const taken = useCharacters.getState().list.filter((x) => !chosen.has(x.id) && !autoNamed(x)).map((x) => x.name.trim()).filter(Boolean);
  const out: NameIdea[] = [];
  for (let i = 0; i < chars.length; i += 12) {
    const part = chars.slice(i, i + 12);
    const lines = part.map((c, k) => {
      const site = c.site ?? {};
      return [`#${k + 1}:`, stripAges(describe(c)), c.block && `Look: ${stripAges(c.block).slice(0, 400)}`, c.frame?.prompt && `Her picture's prompt: ${stripAges(c.frame.prompt).slice(0, 400)}`,
        site.direction && `Owner says: ${site.direction}`, site.backstory && `Profile: ${stripAges(site.backstory).slice(0, 300)}`, !autoNamed(c) && `KEEP ALLOWED: ${c.name}`].filter(Boolean).join(" ");
    });
    const used = [...taken, ...avoid, ...out.flatMap((x) => [x.name, ...x.alt])];
    const raw = await runWriter("name", { taken: used.join(", ") || "(none)", characters: lines.join("\n") }, { tab: "characters", label: `Naming ${part.length} character${part.length === 1 ? "" : "s"}` });
    const d = (await import("../lib/looseJson")).looseJson<{ names?: { n: number; name: string; alt?: string[]; why?: string }[] }>(raw);
    const seen = new Set(used.map((x) => x.toLowerCase()));
    part.forEach((c, k) => {
      const r = d.names?.find((x) => Number(x.n) === k + 1);
      // the first suggestion that's a clean first name nobody else has; the writer's other picks become the alternatives
      const all = [r?.name, ...(r?.alt ?? [])].map((x) => String(x ?? "").trim()).filter((x) => okName(x) && !seen.has(x.toLowerCase()));
      const name = all[0] ?? "";
      if (name) seen.add(name.toLowerCase());
      out.push({ id: c.id, name, alt: all.slice(1, 3), why: String(r?.why ?? ""), on: !!name && name !== c.name });
    });
  }
  return out;
}

function BulkNames({ chars, onClose }: { chars: Character[]; onClose: () => void }) {
  const save = useCharacters((s) => s.save);
  const toast = useJobs((s) => s.toast);
  const [ideas, setIdeas] = useState<NameIdea[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = (avoid: string[] = []) => { setIdeas(null); setErr(null); suggestNames(chars, avoid).then(setIdeas).catch((e) => setErr((e as Error).message)); };
  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const put = (id: string, p: Partial<NameIdea>) => setIdeas((l) => l && l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const picked = (ideas ?? []).filter((x) => x.on && okName(x.name));
  const dupes = new Set(picked.map((x) => x.name.toLowerCase()).filter((n, i, a) => a.indexOf(n) !== i));
  const apply = () => {
    let n = 0;
    for (const x of picked) {
      if (dupes.has(x.name.toLowerCase())) continue;
      const cur = useCharacters.getState().list.find((c) => c.id === x.id);
      if (!cur || cur.name === x.name.trim()) continue;
      save({ ...cur, name: x.name.trim() }); n++;
    }
    toast(`Renamed ${n} — their pictures stay theirs under the old names too${n ? ". Already on your site? Send again to update the name" : ""}`, "good");
    onClose();
  };
  return createPortal(
    <div className="fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onMouseDown={onClose}>
      <div className="flex max-h-full w-full max-w-[860px] flex-col border border-line bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <b className="text-[14px]">Name them · {chars.length}</b>
          <span className="text-[12px] text-muted">From each one's look, picture prompt and profile — all different from each other and your other characters.</span>
          <button aria-label="Close" className="ml-auto text-muted hover:text-ink" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
          {err && <p className="text-[13px] text-bad">{err}</p>}
          {!ideas && !err && <p className="text-[13px] text-muted"><span className="pulse">●</span> Thinking of names…</p>}
          {ideas?.map((x) => {
            const c = chars.find((y) => y.id === x.id)!;
            return (
              <div key={x.id} className={cx("flex items-center gap-3 border px-2 py-2", x.on ? "border-line" : "border-line/40 opacity-60")}>
                <input type="checkbox" checked={x.on} onChange={(e) => put(x.id, { on: e.target.checked })} aria-label={`Rename ${c.name}`} />
                <img src={viewUrl(coverOf(c)!)} alt="" className="h-16 w-12 shrink-0 border border-line object-cover" />
                <div className="flex w-56 min-w-0 shrink-0 flex-col"><span className="truncate text-[12px] text-muted" title={c.name}>{c.name}</span>
                  {x.why && <span className="line-clamp-2 text-[11px] text-dim">{x.why}</span>}</div>
                <Icon name="chev" size={12} className="-rotate-90 shrink-0 text-dim" />
                <input value={x.name} onChange={(e) => put(x.id, { name: e.target.value, on: true })} className={cx("h-9 w-40 border bg-raised px-2 text-[14px] font-semibold", !okName(x.name) || dupes.has(x.name.toLowerCase()) ? "border-bad" : "border-line")} />
                <div className="flex flex-wrap gap-1">{x.alt.map((a) => <button key={a} onClick={() => put(x.id, { name: a, alt: [x.name, ...x.alt.filter((y) => y !== a)].filter(okName).slice(0, 2), on: true })} className="press tag-btn !h-7 !px-2.5 !text-[12px]">{a}</button>)}</div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          {dupes.size > 0 && <span className="text-[12px] text-bad">Two of them have the same name</span>}
          <Btn className="ml-auto" onClick={() => run((ideas ?? []).flatMap((x) => [x.name, ...x.alt]))} disabled={!ideas} why="Thinking…" title="New names for all of them (not these ones again)">Other names</Btn>
          <Btn kind="primary" onClick={apply} disabled={!picked.length || dupes.size > 0} why={dupes.size ? "Two of them have the same name" : "Nothing ticked"}>Rename {picked.length}</Btn>
        </div>
      </div>
    </div>, document.body);
}

export function SiteLink() {
  const open = useSite((s) => s.open);
  const busy = useSiteBusy((s) => s.busy);
  const names = useCharacters((s) => s.list);
  const ids = Object.keys(busy);
  // closed while it's still working: a chip that says what it's doing, click to look
  if (!open) {
    if (!ids.length) return null;
    const active = ids.find((id) => !/^Waiting/.test(busy[id])) ?? ids[0];
    const who = names.find((c) => c.id === active)?.name ?? "";
    return createPortal(
      <button onClick={() => openSiteLink()} title="Your site is still working — click to see"
        className="press fixed bottom-4 left-1/2 z-[56] flex max-w-[90vw] -translate-x-1/2 items-center gap-2 border border-accent bg-panel px-3.5 py-2 text-[12.5px] shadow-xl">
        <span className="pulse text-accent">●</span><b>Your site</b><span className="truncate text-muted">{who}: {busy[active]}</span>
        {ids.length > 1 && <span className="shrink-0 text-dim">· {ids.length - 1} more waiting</span>}
      </button>, document.body);
  }
  return createPortal(<Shell />, document.body);
}

function Shell() {
  const { charId, folder } = useSite();
  const close = () => useSite.setState({ open: false });
  const c = useCharacters((s) => s.list.find((x) => x.id === charId) ?? null);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [showCfg, setShowCfg] = useState(false);
  const loadCfg = () => fetch("/studio-api/site/config").then((r) => r.json()).then(setCfg).catch(() => {});
  useEffect(() => { loadCfg(); }, []);
  // connected = a key AND the site's address; either one missing opens the box where you add it
  const ready = !!cfg?.set && !!cfg?.url;
  useEffect(() => { if (cfg && (!cfg.set || !cfg.url)) setShowCfg(true); }, [cfg]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); if (folder != null) go(charId); else if (charId) go(null); else close(); } };
    window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
  }, [charId, folder]);
  const set = c?.site?.sets?.[folder ?? -1];
  const crumbs: [string, () => void][] = [["Characters", () => go(null)], ...(c ? [[c.name, () => go(c.id)] as [string, () => void]] : []), ...(c && set ? [[set.title || "Folder", () => {}] as [string, () => void]] : [])];

  return (
    <div className="fade-in fixed inset-0 z-[57] flex items-center justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={close} role="dialog" aria-modal aria-label="Your site">
      <div className="zoom-in ticks frame relative flex h-full max-h-[940px] w-full max-w-[1320px] flex-col overflow-hidden border border-line bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-4 border-b border-line px-5 pb-3 pt-4">
          <div className="shrink-0"><div className="micro text-dim">CHARACTER FACTORY → SITE</div><h2 className="display text-[24px] leading-none">Your site</h2></div>
          <nav aria-label="Where you are" className="ml-4 flex min-w-0 items-center gap-1.5 text-[13.5px]">
            {crumbs.map(([label, fn], i) => (
              <span key={i} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <Icon name="chev" size={12} className="-rotate-90 text-dim" />}
                <button onClick={fn} disabled={i === crumbs.length - 1} className={cx("truncate", i === crumbs.length - 1 ? "font-semibold text-ink" : "text-muted hover:text-ink")}>{label}</button>
              </span>
            ))}
          </nav>
          <button onClick={() => setShowCfg((v) => !v)} className={cx("press ml-auto flex h-9 items-center gap-2 border px-3 text-[12.5px]", ready ? "border-line text-muted hover:text-ink" : "border-hot text-hot")}>
            <span className={cx("h-2 w-2 rounded-full", ready ? "bg-good" : "bg-bad")} />{ready ? "Connected" : cfg?.set ? "Add your site's address" : "Connect your site"}</button>
          <button aria-label="Close" onClick={close} className="press btn-raised flex h-10 w-10 shrink-0 items-center justify-center text-muted hover:text-ink"><Icon name="x" size={16} /></button>
        </header>
        {showCfg && <Connection cfg={cfg} onSaved={loadCfg} />}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!c ? <Characters connected={ready} /> : folder != null && set ? <Folder c={c} index={folder} /> : <CharacterPage c={c} connected={ready} />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ connection
function Connection({ cfg, onSaved }: { cfg: Cfg | null; onSaved: () => void }) {
  const toast = useJobs((s) => s.toast);
  const [url, setUrl] = useState(cfg?.url ?? "");
  const [key, setKey] = useState("");
  const [test, setTest] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (cfg) setUrl(cfg.url); }, [cfg?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const r = await fetch("/studio-api/site/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, ...(key.trim() ? { key: key.trim() } : {}) }) });
    if (!r.ok) { toast(await r.text(), "bad"); return; }
    setKey(""); onSaved(); toast("Saved", "good");
  };
  const runTest = async () => {
    setBusy(true); setTest(null);
    try { setTest(await (await fetch(`/studio-api/site/test?char=${encodeURIComponent(useSite.getState().charId ?? "")}`)).json()); } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  return (
    <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3 border-b border-line bg-raised/40 px-5 py-3">
      <TextIn label={cfg?.url ? "API address" : "API address — needed: paste your site's factory address"} value={url} onChange={setUrl} placeholder="https://actions.your-site/api/factory" />
      {cfg?.source === "template" ? <p className="pb-2 text-[12.5px] text-muted">Key: from your Vast template (SITE_FACTORY_TOKEN)</p>
        : <TextIn label={cfg?.set ? "API key — saved (paste to replace)" : "API key"} value={key} onChange={setKey} placeholder="Paste your site key" />}
      <div className="flex gap-2 pb-0.5"><Btn onClick={save}>Save</Btn><Btn onClick={runTest} disabled={busy || !cfg?.set} why={!cfg?.set ? "Add the key first" : "Testing…"}>{busy ? "Testing…" : "Test"}</Btn></div>
      {test && (
        <div className="col-span-3 flex items-start gap-3">
          <span className="mt-1 flex flex-col gap-1">
            <span className={cx("text-[12.5px] font-semibold", test.ok ? "text-good" : "text-bad")}>{test.ok ? "The site answered" : "Not as expected"}</span>
            {!!test.upload && <span className={cx("max-w-40 text-[11.5px] leading-snug", uploadOk(test.upload as UpTest) ? "text-good" : "text-bad")}>{uploadVerdict(test.upload as UpTest)}</span>}
          </span>
          <pre className="max-h-40 flex-1 overflow-auto whitespace-pre-wrap border border-line bg-raised p-2 font-mono text-[10.5px] leading-snug text-ink/85">{JSON.stringify(test, null, 1)}</pre>
          <button className="mt-1 text-[12px] text-accent hover:underline" onClick={() => copyText(JSON.stringify(test, null, 1), "Copied — paste it to Claude")}>Copy for Claude</button>
        </div>
      )}
    </div>
  );
}

/** Deep profile on/off (on by default): her life, reactions, sample texts and an editor pass after the profile */
function DeepToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => { import("../lib/siteAuto").then((m) => setOn(m.deepOn())); }, []);
  const flip = () => import("../lib/siteAuto").then((m) => { m.setDeepOn(!on); setOn(!on); });
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-muted" title="After her profile: her life between chats, how she reacts in 13 situations, sample texts in her style, then an editor pass that rewrites anything generic — about 2–3 minutes per character instead of 40 seconds. Off: the short profile only.">
      <input type="checkbox" checked={on} onChange={flip} /> Deep profile
    </label>
  );
}

// ------------------------------------------------------------------ level 1: every character, many at once
function Characters({ connected }: { connected: boolean }) {
  const list = useCharacters((s) => s.list).filter((c) => isAdult(c) && c.views.front);
  const toast = useJobs((s) => s.toast);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const busy = useSiteBusy((s) => s.busy);
  // drag across the tick boxes to tick (or untick) many at once
  const drag = useRef<boolean | null>(null);
  useEffect(() => { const up = () => { drag.current = null; }; window.addEventListener("mouseup", up); return () => window.removeEventListener("mouseup", up); }, []);
  const tick = (id: string, v: boolean) => setSel((s) => { const n = new Set(s); v ? n.add(id) : n.delete(id); return n; });
  const chosen = list.filter((c) => sel.has(c.id));
  const [loops, setLoops] = useState(false);
  const [naming, setNaming] = useState(false);
  const writeAll = async (all = false) => {
    if (all && !window.confirm(`Rewrite every field of ${chosen.length} character${chosen.length > 1 ? "s" : ""}? What you wrote yourself in their profiles is replaced (their names, pictures and sets stay).`)) return;
    for (const c of chosen) {
      mark(c.id, all ? "Rewriting profile…" : "Writing profile…");
      try { await writeProfile(c, all, (t) => mark(c.id, t)); } catch (e) { toast(`${c.name}: ${(e as Error).message}`, "bad"); }
      mark(c.id, null);
    }
    toast(`Profiles written for ${chosen.length} — check them, then send`, "good");
  };
  const allInOne = async () => {
    let ok = 0;
    const ids = chosen.map((c) => c.id);
    ids.forEach((id) => mark(id, "Waiting…"));
    // 1. names for every one still named after her look, all at once (so they're all different), used as suggested
    const unnamed = chosen.filter(autoNamed);
    if (unnamed.length) {
      unnamed.forEach((c) => mark(c.id, "Thinking of a name…"));
      try {
        for (const x of await suggestNames(unnamed)) {
          const cur = useCharacters.getState().list.find((c) => c.id === x.id);
          if (cur && x.name) useCharacters.getState().save({ ...cur, name: x.name });
        }
      } catch (e) { toast(`Names: ${(e as Error).message} — kept the old ones`, "bad"); }
      unnamed.forEach((c) => mark(c.id, "Waiting…"));
    }
    // 2. no animated cover yet: pinned for one (made later, in Animated covers — the video work waits for a GPU rental)
    const { pinCoverVideo } = await import("../lib/siteMedia");
    for (const id of ids) { const x = useCharacters.getState().list.find((y) => y.id === id); if (x && !x.site?.loopFile && !x.site?.coverVideoPin) pinCoverVideo(id); }
    for (const id of ids) {
      const c = useCharacters.getState().list.find((x) => x.id === id);
      if (!c) { mark(id, null); continue; }
      mark(c.id, "Starting…");
      try { const note = await doItAll(useCharacters.getState().list.find((x) => x.id === c.id)!, connected, (t) => mark(c.id, t)); ok++; toast(`${c.name}: ${note}`, "good"); }
      catch (e) { toast(`${c.name}: ${(e as Error).message}`, "bad"); }
      mark(c.id, null);
    }
    toast(`Done: ${ok} of ${chosen.length} — check them on the site before publishing`, ok === chosen.length ? "good" : "info");
  };
  // the site has newer names / profiles than this Studio (e.g. the drive was full and the Studio's copy wasn't saved): take them back
  const pullAll = async () => {
    // every ticked one (or all): the Studio may not remember sending them (its save was lost), the site knows
    const pick = chosen.length ? chosen : list;
    if (!pick.length) return;
    try {
      const r = await fetch(`/studio-api/site/pull?ids=${pick.map((c) => c.id).join(",")}`);
      if (!r.ok) throw new Error(`the Studio answered ${r.status}`);
      const got = await r.json() as Record<string, { name?: string; age?: number; tags?: string[]; bio?: string; personality?: string; backstory?: string; greeting?: string; persona?: string; voice_notes?: string; missing?: boolean; error?: string }>;
      let n = 0; const missing: string[] = [];
      for (const c of pick) {
        const g = got[c.id];
        if (!g || g.missing || g.error) { missing.push(c.name); continue; }
        const cur = useCharacters.getState().list.find((x) => x.id === c.id)!;
        const site = { ...cur.site };
        const take = (k: "bio" | "personality" | "backstory" | "greeting" | "persona", v?: string) => { if (v && v.trim() && v !== site[k]) { site[k] = v; return true; } return false; };
        let ch = false;
        for (const k of ["bio", "personality", "backstory", "greeting", "persona"] as const) ch = take(k, g[k]) || ch;
        if (g.voice_notes) { const [voice, habits] = g.voice_notes.split(/\s*Habits:\s*/); if (voice && voice !== site.voice) { site.voice = voice.trim(); ch = true; } if (habits) site.quirks = habits.replace(/\.$/, "").trim(); }
        if (Array.isArray(g.tags) && g.tags.length) site.tags = g.tags;
        const name = g.name && g.name.trim() && g.name !== cur.name ? g.name.trim() : cur.name;
        const age = Number(g.age) >= 18 ? Number(g.age) : cur.age;
        if (ch || name !== cur.name || age !== cur.age) { useCharacters.getState().save({ ...cur, name, age, site }); n++; }
      }
      const errs = pick.filter((c) => got[c.id]?.error).length;
      toast(`${n ? `Took the site's name and profile for ${n}` : "Nothing new from your site"} · ${pick.length - missing.length - n} already matched${missing.length ? ` · ${missing.length} not found on the site under this Studio's id (made again here, or never sent): ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}` : ""}${errs ? ` · ${errs} couldn't be read` : ""}`, n ? "good" : "info");
    } catch (e) { toast(`Couldn't read your site: ${(e as Error).message}`, "bad"); }
  };
  const sendAll = async () => {
    let ok = 0;
    for (const c of chosen) {
      const cur = useCharacters.getState().list.find((x) => x.id === c.id)!;
      if (!hasProfile(cur)) { mark(c.id, "Writing profile…"); try { await writeProfile(cur, false, (t) => mark(c.id, t)); } catch (e) { toast(`${c.name}: ${(e as Error).message}`, "bad"); mark(c.id, null); continue; } }
      mark(c.id, "Sending…");
      const r = await sendOne(useCharacters.getState().list.find((x) => x.id === c.id)!, (t) => mark(c.id, t));
      if (r.ok) ok++; else toast(`${c.name}: ${r.note}`, "bad");
      mark(c.id, null);
    }
    toast(`${ok} of ${chosen.length} sent as drafts`, ok === chosen.length ? "good" : "info");
  };
  if (!list.length) return <p className="text-[13px] text-muted">No characters with an adult age and a front picture yet — make one in Characters first.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[13px] text-muted">Pick one to open it, or tick several (drag across the boxes) to do them together.</p>
        <button className="text-[12.5px] text-muted hover:text-ink" onClick={() => setSel(sel.size === list.length ? new Set() : new Set(list.map((c) => c.id)))}>{sel.size === list.length ? "Select none" : "Select all"}</button>
        {list.some(autoNamed) && <button className="text-[12.5px] text-muted hover:text-ink" title="Tick every character still named after her look (“Black Bob Bangs · Maid Outfit”)" onClick={() => setSel(new Set(list.filter(autoNamed).map((c) => c.id)))}>Select unnamed ({list.filter(autoNamed).length})</button>}
        <Btn onClick={() => setNaming(true)} disabled={!chosen.length || Object.keys(busy).length > 0} why="Tick characters first" title="A first name for each, from her look, picture prompt and profile — you check them before anything is renamed"><Icon name="script" size={14} /> Name them{chosen.length ? ` · ${chosen.length}` : ""}</Btn>
        <Btn onClick={() => setLoops(true)} disabled={Object.keys(busy).length > 0} title="Animated covers: the video her card plays when someone hovers it on your site. See who has one, who's pinned for one, make the pinned ones (best on a multi-GPU rental) and pick each one's video — for the ticked ones, or everyone"><Icon name="play" size={14} /> Animated covers{(() => { const n = (chosen.length ? chosen : list).filter((c) => c.site?.coverVideoPin).length; return n ? ` · ${n} pinned` : ""; })()}</Btn>
        <DeepToggle />
        <Btn onClick={pullAll} disabled={Object.keys(busy).length > 0} why="Wait for the current work to finish" title="Take the names, ages and profiles your site has back into the Studio (ticked ones, or all you've sent) — for when the Studio lost changes it made"><Icon name="down" size={14} /> Pull from site</Btn>
        <Btn onClick={() => writeAll(false)} disabled={!chosen.length || Object.keys(busy).length > 0} why="Tick characters first" title="Write only the empty fields; what's there stays"><Icon name="script" size={14} /> Fill profiles{chosen.length ? ` · ${chosen.length}` : ""}</Btn>
        <Btn onClick={() => writeAll(true)} disabled={!chosen.length || Object.keys(busy).length > 0} why="Tick characters first" title="Rewrite every profile field with the current writer (greeting, persona, tagline, levels, texting…) — names, pictures and sets stay"><Icon name="script" size={14} /> Rewrite profiles{chosen.length ? ` · ${chosen.length}` : ""}</Btn>
        <Btn onClick={allInOne} disabled={!chosen.length || Object.keys(busy).length > 0} why="Tick characters first" title="All of it, in order: a name for the ones still named after their look, an age (21+) for the ones still on the default, their profile written (bio, persona, greeting…), their newest loop as the hover loop, then sent as drafts"><Icon name="sparkle" size={14} /> Name, write &amp; send{chosen.length ? ` · ${chosen.length}` : ""}</Btn>
        <Btn kind="primary" onClick={sendAll} disabled={!chosen.length || !connected || Object.keys(busy).length > 0} why={!connected ? "Connect your site first (top right)" : "Tick characters first"}><Icon name="up" size={14} /> Send as drafts{chosen.length ? ` · ${chosen.length}` : ""}</Btn>
      </div>
      {naming && <BulkNames chars={chosen} onClose={() => setNaming(false)} />}
      {loops && <BulkLoops chars={chosen.length ? chosen : list} onClose={() => setLoops(false)} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {list.map((c) => {
          const st = status(c);
          const sets = c.site?.sets ?? [];
          const on = sel.has(c.id);
          return (
            <div key={c.id} onMouseEnter={() => { if (drag.current != null) tick(c.id, drag.current); }} className={cx("group relative flex flex-col overflow-hidden border transition-colors", on ? "border-accent" : "border-line hover:border-muted")}>
              <button onClick={() => go(c.id)} className="relative aspect-[3/4] overflow-hidden bg-raised" aria-label={`Open ${c.name}`}>
                <img src={viewUrl((c.cover ?? c.views.front)!)} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                {/* her hover loop, played on hover the way the site's card does */}
                {c.site?.loopFile && <video src={viewUrl(c.site.loopFile)} muted loop playsInline preload="none" onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.play().catch(() => {}); }} onMouseLeave={(e) => { e.currentTarget.style.opacity = "0"; e.currentTarget.pause(); }} className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity" />}
                {c.site?.loopFile && <span className="micro pointer-events-none absolute right-2 top-2 bg-black/70 px-1 text-white">LOOP</span>}
                {busy[c.id] && <span className="absolute inset-x-0 bottom-0 bg-black/80 px-2 py-1.5 text-[11.5px] text-ink"><span className="pulse">●</span> {busy[c.id]}</span>}
              </button>
              {/* a big tick area: press and drag across the cards to tick (or untick) a row at once */}
              <button role="checkbox" aria-checked={on} aria-label={`Select ${c.name}`} title="Select — press and drag across others to select them too"
                onMouseDown={(e) => { e.preventDefault(); drag.current = !on; tick(c.id, !on); }} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); tick(c.id, !on); } }}
                className="absolute left-0 top-0 z-10 flex h-12 w-12 cursor-pointer items-start justify-start p-2">
                <span className={cx("flex h-7 w-7 items-center justify-center border", on ? "border-accent bg-accent text-accentink" : "border-line bg-black/70 text-transparent group-hover:text-white/60")}><Icon name="check" size={14} /></span>
              </button>
              <div className="flex flex-col gap-0.5 px-2.5 py-2">
                <span className="truncate text-[13.5px] font-semibold">{c.name}</span>
                <span className="text-[11.5px] text-muted">{hasProfile(c) ? "Profile ready" : "No profile yet"} · {sets.length} folder{sets.length === 1 ? "" : "s"}{c.site?.loopFile ? " · loop" : ""}</span>
                <span className={cx("text-[11.5px]", STATUS[st][1])}>{STATUS[st][0]}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ level 2: one character — profile + content folders
function CharacterPage({ c, connected }: { c: Character; connected: boolean }) {
  const save = useCharacters((s) => s.save);
  const toast = useJobs((s) => s.toast);
  const site: SiteInfo = c.site ?? {};
  const up = (p: Partial<SiteInfo>) => save({ ...c, site: { ...site, ...p } });
  // an age in the profile (the site refuses it — it sets the age itself): taken out by itself, wherever it came from
  useEffect(() => {
    const keys = ["bio", "persona", "greeting", "backstory", "personality"] as const;
    const bad = keys.filter((k) => hasAge(site[k]));
    if (!bad.length) return;
    up(Object.fromEntries(bad.map((k) => [k, stripAges(site[k]!)])) as Partial<SiteInfo>);
    toast(`Took the stated age out of the ${bad.join(" and ")} — the site sets the age itself`, "info");
  }, [c.id, site.bio, site.persona, site.greeting, site.backstory, site.personality]); // eslint-disable-line react-hooks/exhaustive-deps
  // not marked as a cosplay: her pictures are read once when she's opened — when they say whose cosplay she is, it's filled in
  useEffect(() => {
    if (c.source) return;
    let on = true;
    import("../lib/siteAuto").then((m) => m.guessCosplay(c)).then((g) => {
      if (!on || !g) return;
      const cur = useCharacters.getState().list.find((x) => x.id === c.id);
      if (cur && !cur.source) { save({ ...cur, source: g }); toast(`${c.name}: her pictures say ${g.toLowerCase()} — filled in "Cosplays as" (clear it if that's wrong)`, "info"); }
    }).catch(() => {});
    return () => { on = false; };
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [writing, setWriting] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [picking, setPicking] = useState<"avatar" | "cover" | null>(null);
  const [pickLoop, setPickLoop] = useState(false);
  const views = VIEWS.filter((v) => v.id !== "sheet" && v.id !== "faces" && v.id !== "cutout" && c.views[v.id]);
  const sets = site.sets ?? [];
  const step = useSiteBusy((s) => s.busy[c.id]);
  const deep = async () => {
    mark(c.id, "Starting the deep profile…");
    try { const { deepProfile } = await import("../lib/siteAuto"); await deepProfile(c, { onStep: (t) => mark(c.id, t) }); toast(`${c.name}'s deep persona is written — read it below`, "good"); }
    catch (e) { toast((e as Error).message, "bad"); } finally { mark(c.id, null); }
  };
  const write = async (all: boolean) => {
    setWriting(true); mark(c.id, "Writing her profile…");
    try { const { fillProfile } = await import("../lib/siteAuto"); const r = await fillProfile(c, { all, onStep: (t) => mark(c.id, t) }); toast(`${all ? "Profile rewritten" : `Filled ${r.filled} blank field${r.filled === 1 ? "" : "s"}`} from their look${r.pictures ? ` and ${r.pictures} pictures` : ""} — change anything you like`, "good"); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setWriting(false); mark(c.id, null); }
  };
  const [sorting, setSorting] = useState<string | null>(null);
  const sort = async () => {
    setSorting("Starting…");
    try {
      const { sortIntoSets } = await import("../lib/siteAuto");
      const r = await sortIntoSets(c, { onStep: setSorting });
      toast(`Sorted ${r.pictures} pictures into ${r.sets} sets (free = sfw, premium = suggestive / explicit)${r.skipped ? ` — ${r.skipped} had no prompt and stayed where they were` : ""}`, "good");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setSorting(null); }
  };
  const send = async () => {
    setSending("Starting…");
    const r = await sendOne(c, setSending);
    setSending(null);
    toast(r.ok ? `${c.name} is on the site as a draft (${r.note})` : `Couldn't send ${c.name}: ${r.note}`, r.ok ? "good" : "bad");
  };
  const addFolder = (tier: "free" | "premium") => {
    const n = sets.length + 1;
    up({ sets: [...sets, { set_key: slug(`${tier}-${n}-${Date.now().toString(36)}`), title: tier === "premium" ? `Premium set ${n}` : `Free set ${n}`, description: "", tier, rating: tier === "premium" ? "suggestive" : "sfw", items: [] }] });
    go(c.id, sets.length);
  };
  const st = status(c);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <img src={viewUrl(coverOf(c)!)} alt="" className="h-14 w-14 border border-line object-cover" />
          <div className="min-w-0"><h3 className="display truncate text-[20px]">{c.name}</h3><p className="text-[12.5px] text-muted">{c.age} · {c.gender} · {/^Cosplay of /.test(c.source ?? "") ? <span className="text-accent" title={`Goes in your site's Cosplay section · ${c.source}`}>cosplay</span> : c.style} · <span className={STATUS[st][1]}>{STATUS[st][0]}</span></p></div>
          <Btn className="ml-auto" onClick={() => write(false)} disabled={writing || !!step} title="Write only the empty fields; what you wrote stays"><Icon name="script" size={14} /> {writing || step ? "Writing…" : "Fill the blanks"}</Btn>
          {hasProfile(c) && <Btn onClick={() => write(true)} disabled={writing || !!step} title="Rewrite every field">Rewrite all</Btn>}
          <Btn onClick={() => import("./LivePack").then((m) => m.openLivePack(c.id))} title="Her Live Stream and Live Action clips: a still, idle loops and actions (tips / call buttons), made with H3 and checked join by join"><Icon name="play" size={14} /> Live pack</Btn>
          {!!site.persona && <Btn onClick={deep} disabled={writing || !!step} title="Her life, how she reacts in 15 situations, sample texts in her style, then an editor pass — from her current profile, about 2–3 minutes"><Icon name="sparkle" size={14} /> {site.deepAt ? "Redo deep" : "Make it deep"}</Btn>}
        </div>
        {step && <p className="border border-accent/40 bg-accent/5 px-3 py-2 text-[12.5px]"><span className="pulse text-accent">●</span> {step}</p>}
        <div className="flex items-end gap-2">
          <TextIn className="flex-1" label={`Name on the site · blank = “${c.name}”`} value={site.name ?? ""} onChange={(v) => up({ name: v })} placeholder={c.name} />
          <Btn small onClick={async () => { try { const { siteAlias } = await import("../lib/newChar"); const a = await siteAlias([c.name]); if (a[0]) { up({ name: a[0] }); toast(`Site name: ${a[0]}`, "good"); } } catch (e) { toast((e as Error).message, "bad"); } }}
            title="A site name fans connect to the character: a near-twin, the meaning translated (Sakura → Blossom) or a shortening (Makima → Maki)">New name</Btn>
        </div>
        <TextIn label="Cosplays as · character (series) — her personality follows them, her life and name stay her own; she goes in your site's Cosplay section. Blank = an original"
          value={/^Cosplay of /.test(c.source ?? "") ? c.source!.replace(/^Cosplay of /, "") : ""} placeholder="e.g. Makima (Chainsaw Man)"
          onChange={(v) => save({ ...c, source: v.trim() ? `Cosplay of ${v.trim()}` : /^Cosplay of /.test(c.source ?? "") ? undefined : c.source })} />
        {/^Cosplay of /.test(c.source ?? "") && <Btn small className="self-start" disabled={writing || !!step} onClick={async () => {
          // one press: the adult check and what the source says (as Batch → Cosplay does), a name of her own, her profile rewritten
          const src = c.source!;
          try {
            mark(c.id, "Looking the character up (adult check)…");
            await (await import("../lib/cosplay")).canonFacts(src);
            const { siteAlias } = await import("../lib/newChar");
            const name = (await siteAlias([src.replace(/^Cosplay of /, "").replace(/\s*\(.*$/, "")]))[0];
            const cur = useCharacters.getState().list.find((x) => x.id === c.id) ?? c;
            if (name) save({ ...cur, site: { ...(cur.site ?? {}), name } });
            mark(c.id, null);
            await write(true);
            toast(`${name ? `Her site name is ${name}. ` : ""}Profile rewritten as a cosplay of ${src.replace(/^Cosplay of /, "")} — check it, then send`, "good");
          } catch (e) { mark(c.id, null); toast((e as Error).message, "bad"); }
        }} title="Checks the character is an adult in the source, reads what the source says about her personality, gives her a name of her own, then rewrites her whole profile">Make her this cosplay · name + rewrite</Btn>}
        <TextIn label="Who is she? · a few words, optional — the writer builds on them" value={site.direction ?? ""} onChange={(v) => up({ direction: v })} placeholder="e.g. goth night owl, tattoo apprentice, dry humor, secretly soft" />
        <p className="text-[12px] leading-relaxed text-dim">The writer looks at a few of their pictures (with Grok: when “Grok also looks at pictures” is on), reads the prompts of everything made of them, your words above and their set titles — and makes them clearly different from your other characters. Fill the blanks keeps what you wrote; Rewrite all starts over.</p>
        <TextIn label="Tagline · under her name: one complete sentence — who she is to him, her situation, a challenge (140 max)" value={site.tagline ?? ""} onChange={(v) => up({ tagline: v.slice(0, 140) })} />
        <TextIn label="Bio · on their profile" value={site.bio ?? ""} onChange={(v) => up({ bio: v })} />
        <TextIn label="First message" value={site.greeting ?? ""} onChange={(v) => up({ greeting: v })} />
        <TextIn label="Personality traits" value={site.personality ?? ""} onChange={(v) => up({ personality: v })} placeholder="teasing, upbeat, competitive" />
        <TextIn label="How she texts · typing style, sent to the site as voice notes" value={site.voice ?? ""} onChange={(v) => up({ voice: v })} placeholder="all lowercase, no full stops, 'lmao' a lot, one emoji max" />
        <TextIn label="Texting habits · added to the voice notes" value={site.quirks ?? ""} onChange={(v) => up({ quirks: v })} placeholder="sends ? on its own, trailing lol, corrects typos with *" />
        <TextIn label="Opinions she'll argue about · fuel for pushback" value={site.opinions ?? ""} onChange={(v) => up({ opinions: v })} placeholder="pineapple on pizza is fine, voice notes over 1 min are a crime…" />
        <TextIn label="Her flaw" value={site.flaw ?? ""} onChange={(v) => up({ flaw: v })} placeholder="flaky with plans" />
        <details className="card rounded-lg border border-line p-2.5 text-[12.5px]">
          <summary className="cursor-pointer text-ink">Her details for the site · job, status, setting, how you know each other, in bed, people, levels, texting, voice</summary>
          <div className="mt-2 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <TextIn label="Job (40 max)" value={site.occupation ?? ""} onChange={(v) => up({ occupation: v.slice(0, 40) })} />
              <TextIn label="Status line · what she's doing now, no clock times" value={site.statusLine ?? ""} onChange={(v) => up({ statusLine: v.slice(0, 40) })} />
              <TextIn label="Hobbies (80 max)" value={site.hobbies ?? ""} onChange={(v) => up({ hobbies: v.slice(0, 80) })} />
              <TextIn label="Language" value={site.language ?? ""} onChange={(v) => up({ language: v.slice(0, 40) })} />
            </div>
            <TextIn label="A line in her voice · sets her tone, never sent" value={site.voiceLine ?? ""} onChange={(v) => up({ voiceLine: v })} />
            <TextIn label="Signature words · only she uses them" value={(site.signatureWords ?? []).join(", ")} onChange={(v) => up({ signatureWords: v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 6) })} />
            <TextIn label="Signature emoji" value={(site.signatureEmojis ?? []).join(" ")} onChange={(v) => up({ signatureEmojis: v.split(/\s+/).filter(Boolean).slice(0, 3) })} />
            <TextArea label="How you know each other · her role in his life first" rows={2} value={site.relationship ?? ""} onChange={(v) => up({ relationship: v })} />
            <TextArea label="Right now · where she is, what she's wearing, what's going on" rows={2} value={site.scenario ?? ""} onChange={(v) => up({ scenario: v })} />
            <TextArea label="Her world · the city and places she goes" rows={2} value={site.setting ?? ""} onChange={(v) => up({ setting: v })} />
            <TextArea label="Likes" rows={2} value={site.likes ?? ""} onChange={(v) => up({ likes: v })} />
            <TextArea label="In bed" rows={2} value={site.inBed ?? ""} onChange={(v) => up({ inBed: v })} />
            <TextArea label="People in her life · one per line: name — relation — note" rows={3} value={(site.people ?? []).map((x) => [x.name, x.relation, x.note].join(" — ")).join("\n")}
              onChange={(v) => up({ people: v.split("\n").map((l) => l.split(/\s+[—-]\s+/)).filter((x) => x[0]?.trim()).slice(0, 3).map(([name, relation = "", ...note]) => ({ name: name.trim(), relation: relation.trim(), note: note.join(" — ").trim() })) })} />
            <TextIn label="Her 7 level names, lowest first · blank = the site's ladder" value={(site.levels ?? []).join(", ")} onChange={(v) => { const l = v.split(",").map((x) => x.trim().slice(0, 24)).filter(Boolean); up({ levels: l.length ? l.slice(0, 7) : undefined }); }} />
            <p className="text-dim">Texting style: {site.texting && Object.keys(site.texting).length ? Object.entries(site.texting).map(([k, v]) => `${k} ${v.replace(/_/g, " ")}`).join(" · ") : "the site's house style"} · Voice notes: {site.speechVoice ?? "the site's default"}. Level names and the voice are sent only once there are seven names / a voice; the site keeps an admin's own change when they're left out.</p>
          </div>
        </details>
        <ChatPanel c={c} up={up} busy={writing || !!step} />
        <TextIn label="Tags" value={(site.tags ?? []).join(", ")} onChange={(v) => up({ tags: v.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="fitness, playful, gym" />
        <TextArea label="Backstory" rows={3} value={site.backstory ?? ""} onChange={(v) => up({ backstory: v })} />
        <TextArea label={`Chat persona · private, the site's chat model reads it${site.deepAt ? ` · deep, ${site.persona?.split(/\s+/).length ?? 0} words` : ""}`} rows={site.deepAt ? 14 : 6} value={site.persona ?? ""} onChange={(v) => up({ persona: v })} />
        {site.deepAt && site.personaCore && site.personaCore !== site.persona && <button className="self-start text-[12px] text-muted hover:text-ink" title="The short persona from the first pass — sent instead automatically if the site ever refuses the long one" onClick={() => up({ persona: site.personaCore, deepAt: 0 })}>Back to the short persona</button>}
        <span className="lbl mt-1">Profile pictures</span>
        <div className="grid grid-cols-2 gap-3">
          {(["avatar", "cover"] as const).map((role) => {
            const fileKey = role === "avatar" ? "avatarFile" : "coverFile";
            const own = site[fileKey];
            const viewId = site[role] ?? (role === "avatar" ? (c.views.face ? "face" : "front") : "front");
            // the cover follows their cover photo unless you picked a different one just for the site
            const cur = own ?? (role === "cover" && !site.cover && c.cover ? c.cover : c.views[viewId as View]) ?? c.views.front;
            return (
              <div key={role} className="flex flex-col gap-1.5">
                <span className="flex items-center text-[12px] text-muted">{role === "avatar" ? "Avatar" : "Cover"}
                  <button className="ml-auto text-[11.5px] text-accent hover:underline" onClick={() => setPicking(role)}>Pick from their pictures</button></span>
                {/* any picture: drop one from the tray (or a file), pick from their pictures, or use a sheet view below */}
                <Slot className="h-44" value={cur ? { name: cur.filename, kind: "image", url: viewUrl(cur), label: role } : null}
                  hint="drop from the tray or a file — or pick below"
                  onChange={(m) => up(m ? { [fileKey]: { filename: m.name, subfolder: "", type: "input" } } as Partial<SiteInfo> : { [fileKey]: undefined } as Partial<SiteInfo>)} />
                <div className="flex flex-wrap gap-1">
                  {views.map((v) => {
                    const on = !own && viewId === v.id && !(role === "cover" && !site.cover && c.cover);
                    return <button key={v.id} onClick={() => up({ [role]: v.id as View, [fileKey]: undefined } as Partial<SiteInfo>)} title={`Sheet: ${v.label}`} className={cx("press h-12 w-9 overflow-hidden border", on ? "border-accent" : "border-line opacity-50 hover:opacity-90")}><img src={viewUrl(c.views[v.id]!)} alt={v.label} className="h-full w-full object-cover" /></button>;
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center text-[12px] text-muted">Animated cover <span className="ml-1.5 text-dim">· the video her card plays when someone hovers it{site.coverVideoPin ? " · pinned" : ""}</span>
            <button className="ml-auto text-[11.5px] text-accent hover:underline" title="Pin her: an animated cover is made from her card when you make the pinned ones (Your site → Animated covers)"
              onClick={async () => { const m = await import("../lib/siteMedia"); if (site.coverVideoPin) m.unpinCoverVideo(c.id); else m.pinCoverVideo(c.id); }}>{site.coverVideoPin ? "Unpin" : "Pin for later"}</button>
            <button className="ml-3 text-[11.5px] text-accent hover:underline" title="Make it now from her card (a 5 s seamless loop, a few minutes in the queue)"
              onClick={async () => { try { await (await import("../lib/hoverLoop")).makeHoverLoop(c.id); } catch (e) { toast((e as Error).message, "bad"); } }}>Make now</button>
            <button className="ml-3 text-[11.5px] text-accent hover:underline" onClick={() => setPickLoop(true)}>Pick from their videos</button></span>
          <Slot className="h-44" accept={["video"]} value={site.loopFile ? { name: site.loopFile.filename, kind: "video", url: viewUrl(site.loopFile), label: "hover loop" } : null}
            hint="a short video of her — sent 540 px wide, the card's shape, no sound, ~1 MB"
            onChange={(m) => up({ loopFile: m ? { filename: m.name, subfolder: "", type: "input" } : undefined } as Partial<SiteInfo>)} />
          <span className="text-[11.5px] leading-relaxed text-dim">Made from this when sent: cropped to her cover's shape (not stretched), 24 fps, sound off. Animate → Loop of her cover picture fits best.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted">Profile carousel <span className="text-dim">· after her card on her profile, up to 12, seen by everyone (no nudity) · {site.galleryFiles?.length ?? 0}/12 · add from the Catalog (tick → Carousel) or right-click a picture</span></span>
          {site.galleryFiles?.length ? <div className="flex flex-wrap gap-1.5">{site.galleryFiles.map((f, i) => (
            <span key={`${f.subfolder}/${f.filename}`} className="relative h-20 w-14 overflow-hidden border border-line">
              <Thumb f={f} className="h-full w-full object-cover" />
              <button aria-label="Take out of the carousel" className="absolute right-0 top-0 bg-black/60 px-1 text-[11px] text-white hover:bg-bad" onClick={async () => { await (await import("../lib/siteMedia")).removeFromCarousel(c.id, f); }}>✕</button>
            </span>))}</div> : <span className="text-[12px] text-dim">None yet.</span>}
          <span className="text-[12px] text-muted">Banner <span className="text-dim">· the wide picture at the top of the explore page · {site.bannerFile ? "set" : "none — your site keeps what it has"}</span>
            {site.bannerFile && <button className="ml-2 text-[11.5px] text-accent hover:underline" onClick={async () => (await import("../lib/siteMedia")).setBanner(c.id, null)}>Clear</button>}</span>
          {site.bannerFile && <img src={viewUrl(site.bannerFile)} alt="Banner" className="h-20 w-auto self-start border border-line object-cover" />}
        </div>
        {pickLoop && <PicPick c={c} videos title="Pick her hover loop" onClose={() => setPickLoop(false)} onPick={(f) => { up({ loopFile: { filename: f.filename, subfolder: f.subfolder, type: f.type } } as Partial<SiteInfo>); setPickLoop(false); }} />}
        {picking && <PicPick c={c} title={picking === "avatar" ? "Pick the avatar" : "Pick the cover"} onClose={() => setPicking(null)}
          onPick={(f) => { up({ [picking === "avatar" ? "avatarFile" : "coverFile"]: { filename: f.filename, subfolder: f.subfolder, type: f.type } } as Partial<SiteInfo>); setPicking(null); }} />}
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={site.send_reference !== false} onChange={(e) => up({ send_reference: e.target.checked })} /> Also send their reference sheet ({views.length} pictures)</label>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="lbl flex-1">Content folders</span>
          <Btn onClick={sort} disabled={!!sorting} title="Group all their pictures into themed sets by what each shows; sfw → free, suggestive / explicit → premium"><Icon name="sparkle" size={14} /> {sorting ?? "Sort into sets"}</Btn>
          <Btn kind="primary" onClick={send} disabled={!connected || !!sending} why={!connected ? "Connect your site first (top right)" : "Sending…"}><Icon name="up" size={14} /> {sending ?? "Send as draft"}</Btn>
        </div>
        {sitePreflight(c).length > 0 && (
          <div className="border border-hot/50 bg-hot/5 px-3 py-2 text-[12px] leading-relaxed text-ink">
            <b className="font-medium text-hot">The site will refuse this until you fix:</b>
            <ul className="mt-1 list-disc pl-4 text-muted">{sitePreflight(c).map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        )}
        {c.site?.sent && <p className={cx("text-[12px]", c.site.sent.ok ? "text-muted" : "text-bad")}>Last sent {new Date(c.site.sent.at).toLocaleString()} — {c.site.sent.note}</p>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {sets.map((s, i) => <FolderCard key={s.set_key} s={s} onOpen={() => go(c.id, i)} />)}
          {(["free", "premium"] as const).map((t) => (
            <button key={t} onClick={() => addFolder(t)} className="press flex aspect-[4/5] flex-col items-center justify-center gap-1.5 border border-dashed border-line text-muted hover:border-accent hover:text-ink">
              <Icon name="plus" size={20} /><span className="text-[13px] font-semibold">New {t} folder</span>
              <span className="px-4 text-center text-[11.5px] text-dim">{t === "free" ? "Teasers anyone can see" : "Behind the paywall"}</span>
            </button>
          ))}
        </div>
        <p className="text-[12px] leading-relaxed text-dim">A folder is one scene — place, outfit, light — in several pictures and clips, picked from what you made in {c.name}'s project. Add folders any time; sending again updates the draft and only uploads new files.</p>
      </section>
    </div>
  );
}

/** pick one of the character's pictures (everything of theirs on the rental) */
export function PicPick({ c, title, onPick, onClose, videos }: { c: Character; title: string; onPick: (f: FileRef) => void; onClose: () => void; videos?: boolean }) {
  const [list, setList] = useState<FileRef[] | null>(null);
  useEffect(() => { import("../lib/siteAuto").then(({ charPictures }) => charPictures(c)).then((l) => setList(l.map((x) => x.file).filter((f) => /\.(mp4|webm|mov)$/i.test(f.filename) === !!videos))).catch(() => setList([])); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div className="fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onMouseDown={onClose}>
      <div className="flex max-h-full w-full max-w-[1000px] flex-col border border-line bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center border-b border-line px-4 py-3"><b className="text-[14px]">{title}</b><span className="ml-2 text-[12px] text-muted">{list ? `${list.length} ${videos ? "videos" : "pictures"} of ${c.name}` : `Finding their ${videos ? "videos" : "pictures"}…`}</span>
          <button aria-label="Close" className="ml-auto text-muted hover:text-ink" onClick={onClose}><Icon name="x" size={16} /></button></div>
        <div className="grid min-h-0 grid-cols-3 gap-2 overflow-y-auto p-3 md:grid-cols-5">
          {(list ?? []).map((f) => (
            <button key={`${f.subfolder}/${f.filename}`} onClick={() => onPick(f)} className="press group aspect-[3/4] overflow-hidden border border-line bg-black hover:border-accent">
              <Thumb f={f} video={videos} className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.06]" /></button>
          ))}
        </div>
        {list && !list.length && <p className="p-4 text-[13px] text-muted">No {videos ? "videos" : "pictures"} of {c.name} found yet — drop one from the tray into the box instead.</p>}
      </div>
    </div>, document.body);
}

function FolderCard({ s, onOpen }: { s: SiteSet; onOpen: () => void }) {
  const pics = s.items.slice(0, 4);
  return (
    <button onClick={onOpen} className="press group flex aspect-[4/5] flex-col overflow-hidden border border-line text-left hover:border-accent">
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-px bg-line">
        {Array.from({ length: 4 }, (_, i) => pics[i]
          ? (/\.(mp4|webm|mov)$/i.test(pics[i].filename) ? <Thumb key={i} f={pics[i]} video play={false} className="h-full w-full object-cover" /> : <Thumb key={i} f={pics[i]} className="h-full w-full object-cover" />)
          : <span key={i} className="hatch block h-full w-full" />)}
      </div>
      <div className="flex flex-col gap-0.5 px-2.5 py-2">
        <span className="flex items-center gap-1.5"><span className={cx("micro px-1 py-px", s.tier === "premium" ? "bg-hot/20 text-hot" : "bg-good/15 text-good")}>{s.tier === "premium" ? "PREMIUM" : "FREE"}</span><span className="truncate text-[13px] font-semibold">{s.title || "Untitled"}</span></span>
        <span className="text-[11.5px] text-muted">{s.items.length} item{s.items.length === 1 ? "" : "s"} · {s.tier === "premium" ? (s.price ? `$${s.price}` : "site sets the price") : "free"} · {s.rating}</span>
      </div>
    </button>
  );
}

// ------------------------------------------------------------------ level 3: one folder
function Folder({ c, index }: { c: Character; index: number }) {
  const save = useCharacters((s) => s.save);
  const sets = c.site?.sets ?? [];
  const s = sets[index];
  const put = (p: Partial<SiteSet>) => save({ ...c, site: { ...c.site, sets: sets.map((x, j) => (j === index ? { ...x, ...p } : x)) } });
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const [every, setEvery] = useState(false);
  const outs = useJobs(useShallow((st) => st.jobs.filter((j) => j.status === "done" && (every || j.meta?.project === c.id))
    .flatMap((j) => j.outputs.filter((o) => o.type === "output" && (o.kind === "image" || o.kind === "video")))));
  // everything on the rental's disk too (the catalog): older results the feeds no longer hold are still here
  const [disk, setDisk] = useState<(FileRef & { kind: string })[]>([]);
  useEffect(() => {
    if (every) { fetch(`/studio-api/catalog?limit=500`).then((r) => r.json()).then((d) => setDisk(Array.isArray(d.items) ? d.items : [])).catch(() => {}); return; }
    // everything of theirs on the rental: their project folder under every name they've had, and files noted as theirs
    import("../lib/siteAuto").then(({ charPictures }) => charPictures(c)).then((l) => setDisk(l.map((x) => ({ ...x.file, kind: /\.(mp4|webm|mov)$/i.test(x.file.filename) ? "video" : "image" })))).catch(() => {});
  }, [every, c.id, c.name]); // eslint-disable-line react-hooks/exhaustive-deps
  // how big the pictures show (whole picture, not cropped) — remembered
  const [size, setSize] = useState<"s" | "m" | "l">(() => { try { return (localStorage.getItem("h3.site.thumb") as "s" | "m" | "l") || "m"; } catch { return "m"; } });
  const pickSize = (v: "s" | "m" | "l") => { setSize(v); try { localStorage.setItem("h3.site.thumb", v); } catch { /* */ } };
  const merged = useMemo(() => { const seen = new Set<string>(); return [...outs, ...disk].filter((o) => { const k = `${o.subfolder}/${o.filename}`; if (seen.has(k)) return false; seen.add(k); return true; }); }, [outs, disk]);
  // pictures already in another of their folders (free or premium) or already on the site: marked, and hidden with "Hide used"
  const elsewhere = useMemo(() => { const m = new Map<string, string[]>(); sets.forEach((x, j) => { if (j === index) return; for (const it of x.items) { const k = `${it.subfolder}/${it.filename}`; m.set(k, [...(m.get(k) ?? []), `${x.tier === "premium" ? "Premium" : "Free"}: ${x.title || "Untitled"}`]); } }); return m; }, [sets, index]);
  const onSite = useMemo(() => new Set(c.site?.sentKeys ?? []), [c.site?.sentKeys]);
  const [hideUsed, setHideUsed] = useState(false);
  const shown = merged.filter((o) => (kind === "all" || o.kind === kind) && (!hideUsed || s.items.some((x) => x.filename === o.filename && x.subfolder === o.subfolder) || (!elsewhere.has(`${o.subfolder}/${o.filename}`) && !onSite.has(`${o.subfolder}/${o.filename}`))));
  const usedN = merged.filter((o) => elsewhere.has(`${o.subfolder}/${o.filename}`) || onSite.has(`${o.subfolder}/${o.filename}`)).length;
  const order = useMemo(() => new Map(s.items.map((x, i) => [`${x.subfolder}/${x.filename}`, i])), [s.items]);
  /** add (want = true) or take out one picture — from the latest saved folder, so a fast drag never loses one */
  const setOne = (o: FileRef, want: boolean) => {
    const cur = useCharacters.getState().list.find((x) => x.id === c.id) ?? c;
    const all = cur.site?.sets ?? [];
    const items = all[index]?.items ?? [];
    const k = `${o.subfolder}/${o.filename}`;
    const has = items.some((x) => `${x.subfolder}/${x.filename}` === k);
    if (has === want) return;
    const next = want ? [...items, { filename: o.filename, subfolder: o.subfolder, type: o.type }] : items.filter((x) => `${x.subfolder}/${x.filename}` !== k);
    save({ ...cur, site: { ...cur.site, sets: all.map((x, j) => (j === index ? { ...x, items: next } : x)) } });
  };
  // drag across pictures to add (or, starting on a picked one, take out) many at once; Shift+click picks a whole run
  const drag = useRef<{ want: boolean } | null>(null);
  const last = useRef<number | null>(null);
  useEffect(() => { const up = () => { drag.current = null; }; window.addEventListener("mouseup", up); return () => window.removeEventListener("mouseup", up); }, []);
  const down = (o: FileRef, i: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const want = !order.has(`${o.subfolder}/${o.filename}`);
    if (e.shiftKey && last.current != null) {
      const [a, b] = [Math.min(last.current, i), Math.max(last.current, i)];
      shown.slice(a, b + 1).forEach((x) => setOne(x, true));
    } else { setOne(o, want); drag.current = { want }; }
    last.current = i;
  };
  const enter = (o: FileRef) => { if (drag.current) setOne(o, drag.current.want); };
  const siteDecides = !s.price;
  return (
    <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-6">
      <section className="flex flex-col gap-3">
        <TextIn label="Folder name" value={s.title} onChange={(v) => put({ title: v })} placeholder="Morning gym session" />
        {!s.title?.trim() && <p className="-mt-2 text-[11.5px] text-hot">The site needs a name for every folder — it's sent as “{s.tier === "premium" ? "Premium" : "Free"} set …” if you leave this empty.</p>}
        <TextArea label="Description" rows={2} value={s.description} onChange={(v) => put({ description: v })} placeholder="Dumbbell curls in a sunlit gym" />
        <span className="lbl">Who can see it</span>
        <div className="grid grid-cols-2 gap-2">
          {([["free", "Free", "Teaser for everyone"], ["premium", "Premium", "Behind the paywall"]] as const).map(([v, l, sub]) => (
            <button key={v} onClick={() => put({ tier: v })} className={cx("press flex flex-col items-start gap-0.5 border px-3 py-2.5 text-left", s.tier === v ? "border-accent bg-accent/10" : "border-line hover:border-muted")}>
              <span className="text-[13.5px] font-semibold">{l}</span><span className="text-[11.5px] text-muted">{sub}</span></button>
          ))}
        </div>
        {s.tier === "premium" && <>
          <span className="lbl">Price</span>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => put({ price: undefined })} className={cx("press flex flex-col items-start gap-0.5 border px-3 py-2.5 text-left", siteDecides ? "border-accent bg-accent/10" : "border-line hover:border-muted")}>
              <span className="text-[13.5px] font-semibold">Let the site decide</span><span className="text-[11.5px] text-muted">Its own pricing</span></button>
            <button onClick={() => put({ price: s.price || 9.99 })} className={cx("press flex flex-col items-start gap-0.5 border px-3 py-2.5 text-left", !siteDecides ? "border-accent bg-accent/10" : "border-line hover:border-muted")}>
              <span className="text-[13.5px] font-semibold">Suggest a price</span><span className="text-[11.5px] text-muted">The site can still change it</span></button>
          </div>
          {!siteDecides && <TextIn label="Suggested price (USD)" value={String(s.price ?? "")} onChange={(v) => put({ price: Number(v.replace(/[^\d.]/g, "")) || undefined })} />}
        </>}
        <span className="lbl">Rating</span>
        <div className="grid grid-cols-3 gap-2">
          {RATINGS.map(([v, l, sub]) => (
            <button key={v} onClick={() => put({ rating: v })} className={cx("press flex flex-col items-start gap-0.5 border px-2.5 py-2 text-left", s.rating === v ? "border-accent bg-accent/10" : "border-line hover:border-muted")}>
              <span className="text-[13px] font-semibold">{l}</span><span className="text-[11px] text-muted">{sub}</span></button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Btn className="flex-1" onClick={() => go(c.id)}><Icon name="back" size={14} /> Back to {c.name}</Btn>
          <Btn kind="danger" onClick={() => { save({ ...c, site: { ...c.site, sets: sets.filter((_, j) => j !== index) } }); go(c.id); }} title="Delete this folder (the pictures stay in your results)"><Icon name="trash" size={14} /></Btn>
        </div>
      </section>
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-muted"><b className="text-ink">{s.items.length}</b> in this folder · click, or drag across several, to add or remove — the number is the order on the site</span>
          <div className="ml-auto flex gap-1">
            {(usedN > 0 || hideUsed) && <button onClick={() => setHideUsed((v) => !v)} className={cx("press tag-btn !h-7 whitespace-nowrap !px-2.5 !text-[12px]", hideUsed && "on")} title="Pictures already in another of their folders, or already sent to the site">{hideUsed ? "New only" : `Hide used (${usedN})`}</button>}
            <button onClick={() => setEvery((v) => !v)} className={cx("press tag-btn !h-7 whitespace-nowrap !px-2.5 !text-[12px]", every && "on")} title="Also pick from results made outside this character's project">{every ? "All my results" : `${c.name}'s project`}</button>
            <span className="mx-1 w-px bg-line" />
            {(["all", "image", "video"] as const).map((k) => <button key={k} onClick={() => setKind(k)} className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", kind === k && "on")}>{k === "all" ? "All" : k === "image" ? "Pictures" : "Videos"}</button>)}
            <span className="mx-1 w-px bg-line" />
            {(["s", "m", "l"] as const).map((k) => <button key={k} onClick={() => pickSize(k)} title={k === "s" ? "Small" : k === "m" ? "Medium" : "Large"} className={cx("press tag-btn !h-7 !w-7 !px-0 !text-[12px] uppercase", size === k && "on")}>{k}</button>)}</div>
        </div>
        <div className={cx("grid gap-2", size === "s" ? "grid-cols-4 md:grid-cols-6 xl:grid-cols-8" : size === "m" ? "grid-cols-3 md:grid-cols-4 xl:grid-cols-5" : "grid-cols-2 md:grid-cols-3")}>
          {shown.slice(0, 600).map((o, i) => {
            const k = `${o.subfolder}/${o.filename}`;
            const n = order.get(k);
            return (
              <div key={k} className={cx("group relative aspect-[3/4] select-none overflow-hidden border-2 bg-black", n != null ? "border-accent" : "border-transparent")}>
                <button onMouseDown={(e) => down(o, i, e)} onMouseEnter={() => enter(o)} onDragStart={(e) => e.preventDefault()} className={cx("press h-full w-full", n == null && "opacity-85 hover:opacity-100")} title="Click to add or remove · drag across several · Shift+click picks everything in between">
                  {/* the whole picture (not cropped), a little bigger on hover */}
                  <Thumb f={o} video={o.kind === "video"} className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.06]" />
                </button>
                {n != null && <span className="pointer-events-none absolute left-1 top-1 flex h-6 min-w-6 items-center justify-center bg-accent px-1 font-mono text-[12px] font-bold text-accentink">{n + 1}</span>}
                {o.kind === "video" && <span className="micro pointer-events-none absolute bottom-1 right-1 bg-black/70 px-1 text-white">VIDEO</span>}
                {(elsewhere.has(k) || onSite.has(k)) && <span title={[...(elsewhere.get(k) ?? []).map((t) => `Also in ${t}`), onSite.has(k) ? "Already sent to the site" : ""].filter(Boolean).join("\n")}
                  className="pointer-events-auto absolute bottom-1 left-1 flex max-w-[85%] flex-wrap gap-0.5">
                  {onSite.has(k) && <span className="micro bg-good/90 px-1 text-black">ON SITE</span>}
                  {(elsewhere.get(k) ?? []).slice(0, 2).map((t) => <span key={t} className={cx("micro truncate px-1", t.startsWith("Premium") ? "bg-hot/90 text-black" : "bg-white/80 text-black")}>{t.toUpperCase()}</span>)}
                </span>}
                <button aria-label="See it full size" title="See it full size" onClick={() => import("./Viewer").then((v) => v.openViewer(shown.map((x) => ({ url: viewUrl(x), kind: x.kind === "video" ? "video" : "image", label: x.filename })), shown.indexOf(o)))}
                  className="absolute right-1 top-1 hidden h-7 w-7 items-center justify-center bg-black/75 text-white hover:text-accent group-hover:flex"><Icon name="search" size={14} /></button>
              </div>
            );
          })}
        </div>
        {!shown.length && <p className="text-[13px] text-muted">{every ? "No results yet." : <>Nothing in {c.name}'s project yet — make pictures in Create and videos in Animate with {c.name} selected, or press “{c.name}'s project” above to pick from all your results.</>}</p>}
      </section>
    </div>
  );
}


type UpTest = { slot?: { status: number }; link_host?: string; put?: { status?: number; error?: string }; error?: string; file?: string; seconds?: number };
const uploadOk = (u: UpTest) => !!u.put?.status && u.put.status >= 200 && u.put.status < 300;
/** the upload test in plain words: which step failed, and whose side it's on */
function uploadVerdict(u: UpTest): string {
  if (uploadOk(u)) return `Uploads work — ${u.file ?? "a real picture"} in ${u.seconds ?? "?"} s`;
  if (u.error) return `Uploads: ${u.error}`;
  if (!u.slot || u.slot.status >= 300) return `Uploads: the site refused an upload slot (${u.slot?.status ?? "no answer"})`;
  if (!u.link_host) return "Uploads: the site gave no upload link";
  if (u.put?.error) return `Uploads: couldn't reach ${u.link_host} (${u.put.error})`;
  return `Uploads: ${u.link_host} answered ${u.put?.status} — ${u.put?.status === 502 || u.put?.status === 504 ? "its server is down or timing out (site side)" : "it refused the file"}`;
}

/** what the site refuses (it answers 422), shown before sending — the same checks the rental makes */
export function sitePreflight(c: Character): string[] {
  const out: string[] = [];
  const site = c.site ?? {};
  if (/\d/.test(c.name)) out.push(`The name “${c.name}” has numbers in it — the site refuses names with numbers. Rename them (Characters → their page).`);
  if (/\b(teen|teenage|kid|child|loli|minor|young|underage|year[- ]?old)\b/i.test(c.name)) out.push(`The name “${c.name}” sounds like an age or a minor.`);
  if (c.gender && c.gender !== "female") out.push("The site takes female characters only (male characters go on urbf.ai).");
  const age = /\b\d{2}\s*-?\s*(year|yr)s?[- ]?old\b|\baged? \d{2}\b|\b\d{2} ?y\/?o\b/i;
  if (!site.bio?.trim()) out.push("The bio is empty — press Write it for me.");
  else if (age.test(site.bio)) out.push(`The bio states an age (“${site.bio.match(age)![0]}”) — the site sets the age itself; take it out.`);
  if (!site.persona?.trim()) out.push("The persona is empty — press Write it for me.");
  else if (age.test(site.persona)) out.push(`The persona states an age (“${site.persona.match(age)![0]}”) — take it out.`);
  return out;
}
