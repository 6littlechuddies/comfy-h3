// Your site: Characters › one character (profile + content folders) › one folder. Everything is sent as a draft through
// the site's factory API; a person publishes it in the site's admin panel. Built for doing many at once: pick several
// characters, let the writer fill their profiles, send them all.
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { viewUrl, type FileRef } from "../lib/api";
import { describe, isAdult, useCharacters, VIEWS, type Character, type SiteInfo, type SiteSet, type View } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { runWriter } from "../lib/writer";
import { hasAge, stripAges } from "../lib/siteAuto";
import { Btn, Icon, Slot, TextArea, TextIn, cx } from "./ui";
import { createPortal } from "react-dom";
import { copyText } from "../lib/copy";

const useSite = create<{ open: boolean; charId: string | null; folder: number | null }>(() => ({ open: false, charId: null, folder: null }));
export const openSiteLink = (charId?: string) => useSite.setState({ open: true, charId: charId ?? null, folder: null });
const go = (charId: string | null, folder: number | null = null) => useSite.setState({ charId, folder });

type Cfg = { url: string; set: boolean; source: string | null };
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `set-${Date.now().toString(36)}`;
const RATINGS = [["sfw", "SFW", "safe for everyone"], ["suggestive", "Suggestive", "teasing, covered"], ["explicit", "Explicit", "age-gated"]] as const;
/** what the site last got, as a fingerprint — "changed since sent" when this no longer matches */
const fp = (c: Character) => JSON.stringify([c.name, c.age, c.site?.bio, c.site?.greeting, c.site?.backstory, c.site?.personality, c.site?.persona, c.site?.tags, c.site?.sets, c.site?.avatar, c.site?.cover, c.site?.avatarFile, c.site?.coverFile]);
const status = (c: Character) => !c.site?.sent ? "new" : !c.site.sent.ok ? "failed" : c.site.sent.hash && c.site.sent.hash !== fp(c) ? "changed" : "sent";
const STATUS: Record<string, [string, string]> = { new: ["Not sent", "text-dim"], sent: ["Draft on the site", "text-good"], changed: ["Changed since sent", "text-hot"], failed: ["Last send failed", "text-bad"] };
const hasProfile = (c: Character) => !!(c.site?.bio && c.site?.persona);

/** the writer fills the profile from their look, their pictures' prompts and set titles; what you wrote stays unless `all` */
async function writeProfile(c: Character, all = false) {
  const { fillProfile } = await import("../lib/siteAuto");
  return fillProfile(c, { all });
}

/** everything for one character: sort their pictures into sets, fill the blanks in their profile, send as a draft */
async function doItAll(c: Character, connected: boolean, step: (t: string) => void): Promise<string> {
  const { sortIntoSets, fillProfile } = await import("../lib/siteAuto");
  const sorted = await sortIntoSets(c, { onStep: step }).catch((e) => { if (/No pictures/.test((e as Error).message)) return null; throw e; });
  await fillProfile(useCharacters.getState().list.find((x) => x.id === c.id)!, { onStep: step });
  if (!connected) return `${sorted ? `${sorted.sets} sets, ` : ""}profile filled — connect your site to send`;
  step("Sending…");
  const r = await sendOne(useCharacters.getState().list.find((x) => x.id === c.id)!, step);
  if (!r.ok) throw new Error(r.note);
  return `${sorted ? `${sorted.sets} sets · ` : ""}sent as a draft (${r.note})`;
}

/** send one character as a draft; returns the job's end state */
async function sendOne(c: Character, onStep?: (t: string) => void): Promise<{ ok: boolean; note: string }> {
  let j = await (await fetch("/studio-api/site/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ char_id: c.id }) })).json();
  while (j.status === "running") {
    onStep?.(`${j.step}${j.total ? ` · ${j.done ?? 0}/${j.total} files` : ""}`);
    await new Promise((ok) => setTimeout(ok, 1500));
    j = await (await fetch(`/studio-api/site/push/${j.id}`)).json();
  }
  const ok = j.status === "done";
  const note = ok ? `${j.uploaded ?? 0} new file${j.uploaded === 1 ? "" : "s"}` : String(j.error);
  const cur = useCharacters.getState().list.find((x) => x.id === c.id)!;
  useCharacters.getState().save({ ...cur, site: { ...cur.site, sent: { at: Date.now(), ok, note, hash: fp(cur) } } });
  return { ok, note };
}

export function SiteLink() {
  const open = useSite((s) => s.open);
  if (!open) return null;
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

// ------------------------------------------------------------------ level 1: every character, many at once
function Characters({ connected }: { connected: boolean }) {
  const list = useCharacters((s) => s.list).filter((c) => isAdult(c) && c.views.front);
  const toast = useJobs((s) => s.toast);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Record<string, string>>({});
  const mark = (id: string, t: string | null) => setBusy((b) => { const n = { ...b }; if (t == null) delete n[id]; else n[id] = t; return n; });
  const chosen = list.filter((c) => sel.has(c.id));
  const writeAll = async () => {
    for (const c of chosen) {
      mark(c.id, "Writing profile…");
      try { await writeProfile(c); } catch (e) { toast(`${c.name}: ${(e as Error).message}`, "bad"); }
      mark(c.id, null);
    }
    toast(`Profiles written for ${chosen.length} — check them, then send`, "good");
  };
  const allInOne = async () => {
    let ok = 0;
    for (const c of chosen) {
      mark(c.id, "Starting…");
      try { const note = await doItAll(useCharacters.getState().list.find((x) => x.id === c.id)!, connected, (t) => mark(c.id, t)); ok++; toast(`${c.name}: ${note}`, "good"); }
      catch (e) { toast(`${c.name}: ${(e as Error).message}`, "bad"); }
      mark(c.id, null);
    }
    toast(`Done: ${ok} of ${chosen.length} — check them on the site before publishing`, ok === chosen.length ? "good" : "info");
  };
  const sendAll = async () => {
    let ok = 0;
    for (const c of chosen) {
      const cur = useCharacters.getState().list.find((x) => x.id === c.id)!;
      if (!hasProfile(cur)) { mark(c.id, "Writing profile…"); try { await writeProfile(cur); } catch (e) { toast(`${c.name}: ${(e as Error).message}`, "bad"); mark(c.id, null); continue; } }
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
        <p className="mr-auto text-[13px] text-muted">Pick one to open it, or tick several to do them together.</p>
        <button className="text-[12.5px] text-muted hover:text-ink" onClick={() => setSel(sel.size === list.length ? new Set() : new Set(list.map((c) => c.id)))}>{sel.size === list.length ? "Select none" : "Select all"}</button>
        <Btn onClick={writeAll} disabled={!chosen.length || Object.keys(busy).length > 0} why="Tick characters first"><Icon name="script" size={14} /> Write profiles{chosen.length ? ` · ${chosen.length}` : ""}</Btn>
        <Btn onClick={allInOne} disabled={!chosen.length || Object.keys(busy).length > 0} why="Tick characters first" title="Sort their pictures into sets, fill the blanks in their profile from their pictures, and send as drafts"><Icon name="sparkle" size={14} /> Sort, fill &amp; send{chosen.length ? ` · ${chosen.length}` : ""}</Btn>
        <Btn kind="primary" onClick={sendAll} disabled={!chosen.length || !connected || Object.keys(busy).length > 0} why={!connected ? "Connect your site first (top right)" : "Tick characters first"}><Icon name="up" size={14} /> Send as drafts{chosen.length ? ` · ${chosen.length}` : ""}</Btn>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {list.map((c) => {
          const st = status(c);
          const sets = c.site?.sets ?? [];
          const on = sel.has(c.id);
          return (
            <div key={c.id} className={cx("group relative flex flex-col overflow-hidden border transition-colors", on ? "border-accent" : "border-line hover:border-muted")}>
              <button onClick={() => go(c.id)} className="relative aspect-[3/4] overflow-hidden bg-raised" aria-label={`Open ${c.name}`}>
                <img src={viewUrl(c.views.front!)} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                {busy[c.id] && <span className="absolute inset-x-0 bottom-0 bg-black/80 px-2 py-1.5 text-[11.5px] text-ink"><span className="pulse">●</span> {busy[c.id]}</span>}
              </button>
              <label className="absolute left-2 top-2 flex h-6 w-6 cursor-pointer items-center justify-center border border-line bg-black/70" title="Select">
                <input type="checkbox" className="sr-only" checked={on} onChange={() => setSel((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
                {on && <Icon name="check" size={13} className="text-accent" />}
              </label>
              <div className="flex flex-col gap-0.5 px-2.5 py-2">
                <span className="truncate text-[13.5px] font-semibold">{c.name}</span>
                <span className="text-[11.5px] text-muted">{hasProfile(c) ? "Profile ready" : "No profile yet"} · {sets.length} folder{sets.length === 1 ? "" : "s"}</span>
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
  const [writing, setWriting] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [picking, setPicking] = useState<"avatar" | "cover" | null>(null);
  const views = VIEWS.filter((v) => v.id !== "sheet" && v.id !== "cutout" && c.views[v.id]);
  const sets = site.sets ?? [];
  const write = async (all: boolean) => {
    setWriting(true);
    try { const r = await writeProfile(c, all); toast(`${all ? "Profile rewritten" : `Filled ${r.filled} blank field${r.filled === 1 ? "" : "s"}`} from their look${r.pictures ? ` and ${r.pictures} pictures` : ""} — change anything you like`, "good"); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setWriting(false); }
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
          <img src={viewUrl(c.views.face || c.views.front!)} alt="" className="h-14 w-14 border border-line object-cover" />
          <div className="min-w-0"><h3 className="display truncate text-[20px]">{c.name}</h3><p className="text-[12.5px] text-muted">{c.age} · {c.gender} · {c.style} · <span className={STATUS[st][1]}>{STATUS[st][0]}</span></p></div>
          <Btn className="ml-auto" onClick={() => write(false)} disabled={writing} title="Write only the empty fields; what you wrote stays"><Icon name="script" size={14} /> {writing ? "Writing…" : "Fill the blanks"}</Btn>
          {hasProfile(c) && <Btn onClick={() => write(true)} disabled={writing} title="Rewrite every field">Rewrite all</Btn>}
        </div>
        <TextIn label="Who is she? · a few words, optional — the writer builds on them" value={site.direction ?? ""} onChange={(v) => up({ direction: v })} placeholder="e.g. goth night owl, tattoo apprentice, dry humor, secretly soft" />
        <p className="text-[12px] leading-relaxed text-dim">The writer looks at a few of their pictures (with Grok: when “Grok also looks at pictures” is on), reads the prompts of everything made of them, your words above and their set titles — and makes them clearly different from your other characters. Fill the blanks keeps what you wrote; Rewrite all starts over.</p>
        <TextIn label="Bio · on their profile" value={site.bio ?? ""} onChange={(v) => up({ bio: v })} />
        <TextIn label="First message" value={site.greeting ?? ""} onChange={(v) => up({ greeting: v })} />
        <TextIn label="Personality traits" value={site.personality ?? ""} onChange={(v) => up({ personality: v })} placeholder="teasing, upbeat, competitive" />
        <TextIn label="Tags" value={(site.tags ?? []).join(", ")} onChange={(v) => up({ tags: v.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="fitness, playful, gym" />
        <TextArea label="Backstory" rows={3} value={site.backstory ?? ""} onChange={(v) => up({ backstory: v })} />
        <TextArea label="Chat persona · private, the site's chat model reads it" rows={6} value={site.persona ?? ""} onChange={(v) => up({ persona: v })} />
        <span className="lbl mt-1">Profile pictures</span>
        <div className="grid grid-cols-2 gap-3">
          {(["avatar", "cover"] as const).map((role) => {
            const fileKey = role === "avatar" ? "avatarFile" : "coverFile";
            const own = site[fileKey];
            const viewId = site[role] ?? (role === "avatar" ? (c.views.face ? "face" : "front") : "front");
            const cur = own ?? c.views[viewId as View] ?? c.views.front;
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
                    const on = !own && viewId === v.id;
                    return <button key={v.id} onClick={() => up({ [role]: v.id as View, [fileKey]: undefined } as Partial<SiteInfo>)} title={`Sheet: ${v.label}`} className={cx("press h-12 w-9 overflow-hidden border", on ? "border-accent" : "border-line opacity-50 hover:opacity-90")}><img src={viewUrl(c.views[v.id]!)} alt={v.label} className="h-full w-full object-cover" /></button>;
                  })}
                </div>
              </div>
            );
          })}
        </div>
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
function PicPick({ c, title, onPick, onClose }: { c: Character; title: string; onPick: (f: FileRef) => void; onClose: () => void }) {
  const [list, setList] = useState<FileRef[] | null>(null);
  useEffect(() => { import("../lib/siteAuto").then(({ charPictures }) => charPictures(c)).then((l) => setList(l.map((x) => x.file).filter((f) => !/\.(mp4|webm|mov)$/i.test(f.filename)))).catch(() => setList([])); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div className="fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onMouseDown={onClose}>
      <div className="flex max-h-full w-full max-w-[1000px] flex-col border border-line bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center border-b border-line px-4 py-3"><b className="text-[14px]">{title}</b><span className="ml-2 text-[12px] text-muted">{list ? `${list.length} pictures of ${c.name}` : "Finding their pictures…"}</span>
          <button aria-label="Close" className="ml-auto text-muted hover:text-ink" onClick={onClose}><Icon name="x" size={16} /></button></div>
        <div className="grid min-h-0 grid-cols-3 gap-2 overflow-y-auto p-3 md:grid-cols-5">
          {(list ?? []).map((f) => (
            <button key={`${f.subfolder}/${f.filename}`} onClick={() => onPick(f)} className="press group aspect-[3/4] overflow-hidden border border-line bg-black hover:border-accent">
              <img src={viewUrl(f)} alt="" loading="lazy" className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.06]" /></button>
          ))}
        </div>
        {list && !list.length && <p className="p-4 text-[13px] text-muted">No pictures of {c.name} found yet — drop one from the tray into the box instead.</p>}
      </div>
    </div>, document.body);
}

function FolderCard({ s, onOpen }: { s: SiteSet; onOpen: () => void }) {
  const pics = s.items.slice(0, 4);
  return (
    <button onClick={onOpen} className="press group flex aspect-[4/5] flex-col overflow-hidden border border-line text-left hover:border-accent">
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-px bg-line">
        {Array.from({ length: 4 }, (_, i) => pics[i]
          ? (/\.(mp4|webm|mov)$/i.test(pics[i].filename) ? <video key={i} src={viewUrl(pics[i])} muted className="h-full w-full object-cover" /> : <img key={i} src={viewUrl(pics[i])} alt="" loading="lazy" className="h-full w-full object-cover" />)
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
  const shown = merged.filter((o) => kind === "all" || o.kind === kind);
  const order = useMemo(() => new Map(s.items.map((x, i) => [`${x.subfolder}/${x.filename}`, i])), [s.items]);
  const toggle = (o: FileRef) => {
    const k = `${o.subfolder}/${o.filename}`;
    put({ items: order.has(k) ? s.items.filter((x) => `${x.subfolder}/${x.filename}` !== k) : [...s.items, { filename: o.filename, subfolder: o.subfolder, type: o.type }] });
  };
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
          <span className="text-[13px] text-muted"><b className="text-ink">{s.items.length}</b> in this folder · click to add or remove — the number is the order on the site</span>
          <div className="ml-auto flex gap-1">
            <button onClick={() => setEvery((v) => !v)} className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", every && "on")} title="Also pick from results made outside this character's project">{every ? "All my results" : `${c.name}'s project`}</button>
            <span className="mx-1 w-px bg-line" />
            {(["all", "image", "video"] as const).map((k) => <button key={k} onClick={() => setKind(k)} className={cx("press tag-btn !h-7 !px-2.5 !text-[12px]", kind === k && "on")}>{k === "all" ? "All" : k === "image" ? "Pictures" : "Videos"}</button>)}
            <span className="mx-1 w-px bg-line" />
            {(["s", "m", "l"] as const).map((k) => <button key={k} onClick={() => pickSize(k)} title={k === "s" ? "Small" : k === "m" ? "Medium" : "Large"} className={cx("press tag-btn !h-7 !w-7 !px-0 !text-[12px] uppercase", size === k && "on")}>{k}</button>)}</div>
        </div>
        <div className={cx("grid gap-2", size === "s" ? "grid-cols-4 md:grid-cols-6 xl:grid-cols-8" : size === "m" ? "grid-cols-3 md:grid-cols-4 xl:grid-cols-5" : "grid-cols-2 md:grid-cols-3")}>
          {shown.slice(0, 600).map((o) => {
            const k = `${o.subfolder}/${o.filename}`;
            const n = order.get(k);
            return (
              <div key={k} className={cx("group relative aspect-[3/4] overflow-hidden border-2 bg-black", n != null ? "border-accent" : "border-transparent")}>
                <button onClick={() => toggle(o)} className={cx("press h-full w-full", n == null && "opacity-85 hover:opacity-100")} title="Click to add or remove">
                  {/* the whole picture (not cropped), a little bigger on hover */}
                  {o.kind === "video" ? <video src={viewUrl(o)} muted loop onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.06]" />
                    : <img src={viewUrl(o)} alt="" loading="lazy" className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.06]" />}
                </button>
                {n != null && <span className="pointer-events-none absolute left-1 top-1 flex h-6 min-w-6 items-center justify-center bg-accent px-1 font-mono text-[12px] font-bold text-accentink">{n + 1}</span>}
                {o.kind === "video" && <span className="micro pointer-events-none absolute bottom-1 right-1 bg-black/70 px-1 text-white">VIDEO</span>}
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
