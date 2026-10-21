// Edit → Chat: change a picture one message at a time. The thread shows what you asked, how it was done (which route) and
// the takes; click a take to carry on from it. Pictures you add get a short @name you can type in any message.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useHandoffInto, usePrimaryAction } from "../App";
import { viewUrl } from "../lib/api";
import { isAdult, useCharacters } from "../lib/characters";
import { setLater, useDownloads, useGroup } from "../lib/downloads";
import { pickFromCivitai } from "./ImageImport";
import { useEditChars, useEditPick, useEditWords } from "../lib/editPick";
import { qwenFast, addCharacter, addPic, canvasOf, continueFrom, inProject, send, takeAsPic, useEditChat, type Chat, type ChatPic, type Engine, type Turn } from "../lib/editchat";
import { useJobs } from "../lib/jobs";
import { useSettings } from "../lib/settings";
import { droppedUrl, useTray } from "../lib/tray";
import type { MentionTarget } from "./Mention";
import { openViewer } from "./Viewer";
import { openPictureMenu } from "./PictureMenu";
import { Feed } from "./Feed";
import { KreaEditModel } from "./KreaEditModel";
import { WriterChoice } from "./WriterChoice";
import { Chip, GoButton, PromptBar, Workspace } from "./Workspace";
import { Btn, Icon, Label, LoraList, cx } from "./ui";
import { editKeys, useSection } from "../lib/settings";

const ROUTE_LABEL: Record<Turn["route"], string> = { krea: "Krea 2", part: "One part · Krea 2", background: "New background · Krea 2", hybrid: "Qwen → Krea 2" };

export function EditChat() {
  const st = useEditChat();
  const project = useCharacters((s) => s.sel ?? null);
  const chat = useEditChat((s) => s.chats.find((c) => c.id === s.cur && inProject(c, project)) ?? null);
  // switching project: open that project's latest chat (or none) — chats never mix between characters
  useEffect(() => {
    const st = useEditChat.getState();
    const cur = st.chats.find((c) => c.id === st.cur);
    if (cur && inProject(cur, project)) return;
    const last = [...st.chats].filter((c) => inProject(c, project) && !c.batch).sort((a, b) => b.updated - a.updated)[0];
    st.set({ cur: last?.id ?? null });
  }, [project]);
  const chars = useCharacters(useShallow((s) => s.list.filter((c) => isAdult(c) && c.views.front)));
  const selChar = useCharacters((s) => s.list.find((x) => x.id === s.sel) ?? null);
  const toast = useJobs((s) => s.toast);
  const kedit = useGroup("kedit");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { st.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [chat?.turns.length, chat?.turns.at(-1)?.status]);
  const ensure = () => useEditChat.getState().current() ?? useEditChat.getState().newChat();

  // pictures sent here from anywhere (right-click → Use in Edit, a result's Edit button, a drop) join the chat
  useHandoffInto("edit", (items) => { const c = ensure(); for (const { media } of items) if (media.kind === "image") addPic(c.id, media); });
  const addFiles = async (fs: FileList | null) => {
    const c = ensure();
    for (const f of Array.from(fs ?? []).filter((x) => x.type.startsWith("image/"))) {
      try { const m = await useTray.getState().addUpload(f); const p = addPic(c.id, m); insert(`@${p.key}`); } catch (e) { toast((e as Error).message, "bad"); }
    }
  };
  const addDrop = async (dt: DataTransfer) => {
    if (dt.files?.length) return addFiles(dt.files);
    const c = ensure();
    try {
      const tray = dt.getData("application/x-h3-tray");
      const m = tray ? await useTray.getState().asMedia(tray) : droppedUrl(dt) ? await useTray.getState().addUrl(droppedUrl(dt)!) : null;
      if (m) { const p = addPic(c.id, m); insert(`@${p.key}`); }
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  // a picture picked on CivitAI for Edit joins this chat
  const picked = useEditPick((x) => x.pending);
  useEffect(() => {
    if (!picked.length) return;
    useEditPick.setState({ pending: [] });
    const c = ensure();
    for (const { media } of picked) { const p = addPic(c.id, media); insert(`@${p.key}`); }
  }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps
  // a character dragged in from the left rail: joins as @name (their sheet views come along when your words ask for an angle)
  const droppedChars = useEditChars((x) => x.ids);
  useEffect(() => {
    if (!droppedChars.length) return;
    useEditChars.setState({ ids: [] });
    const chat = ensure();
    for (const id of droppedChars) {
      const ch = useCharacters.getState().list.find((x) => x.id === id);
      if (ch) addCharacter(chat.id, ch).then((p) => insert(`@${p.key}`)).catch((e) => toast((e as Error).message, "bad"));
    }
  }, [droppedChars]); // eslint-disable-line react-hooks/exhaustive-deps
  // pieces of a CivitAI prompt sent here ("Use in Edit chat")
  const handed = useEditWords((s) => s.words);
  useEffect(() => { if (handed) { setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, "")} ${handed}` : handed)); useEditWords.setState({ words: "" }); } }, [handed]);
  const insert = (w: string) => setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, "")} ${w} ` : `${w} `));

  const mention: MentionTarget = {
    hint: { character: "joins this chat as @name — their face is kept", picture: "joins this chat as @name" },
    pick: async (p) => {
      const c = ensure();
      const pic = p.kind === "character" ? await addCharacter(c.id, p.c) : addPic(c.id, await useTray.getState().asMedia(p.item.id));
      return `@${pic.key}`;
    },
  };
  const go = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    const text = draft;
    try { setDraft(""); await send(text).catch((e) => { setDraft(text); throw e; }); }
    catch (e) { toast((e as Error).message, "bad"); }
    finally { setBusy(false); }
  };
  usePrimaryAction("edit", go);
  const running = chat?.turns.some((t) => t.status === "running");
  const canvas = chat ? canvasOf(chat) : null;
  const why = !kedit.ready ? kedit.why : !draft.trim() ? "Say what to change" : undefined;

  const chips = (
    <>
      <Chip title="How each message is done" value={st.engine} onChange={(v: Engine) => st.set({ engine: v })}
        options={[{ value: "auto", label: "Auto route" }, { value: "krea", label: "Krea only" }, { value: "hybrid", label: "Qwen + Krea" }]} />
      <Chip title="The writer turns each message into one precise instruction first — it looks at the pictures (like the cloud editors do)" value={st.refine ? 1 : 0} onChange={(v) => st.set({ refine: v === 1 })}
        options={[{ value: 1, label: "Refine my words", hint: "The writer makes it precise: what changes, what stays, which picture is which" }, { value: 0, label: "Words as typed", hint: "Only @names are turned into Picture 1/2/3" }]} />
      {st.engine !== "krea" && <Chip title="Qwen's quality" value={st.quality} onChange={(v: "auto" | "best" | "fast") => st.set({ quality: v })}
        options={[{ value: "auto", label: `Qwen: auto (${qwenFast("auto") ? "fast" : "best"})`, hint: "Fast on cards under 24 GB — best takes about 10 minutes per picture there — best on bigger cards" }, { value: "best", label: "Qwen: best", hint: "Qwen's own settings — 40 steps (about 10 min per picture on a 16 GB card)" }, { value: "fast", label: "Qwen: fast", hint: "4-step Lightning LoRA — under a minute, a little less precise" }]} />}
      <Chip title="Takes per message" value={st.takes} onChange={(v: 1 | 2) => st.set({ takes: v })} options={[{ value: 1, label: "1 take" }, { value: 2, label: "2 takes, best shown" }]} />
      <Chip title="Score each take against the character's face (and try once more if none match)" value={st.check ? 1 : 0} onChange={(v) => st.set({ check: v === 1 })}
        options={[{ value: 1, label: "Face check on" }, { value: 0, label: "Face check off" }]} />
      <button onClick={() => useSettings.getState().set("edit", { chat: false })} className="press chip-raised inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-[12.5px] text-muted hover:text-ink">
        <Icon name="brush" size={13} />Classic edit</button>
    </>
  );
  return (
    <Workspace needs="kedit" tab="edit" title="Edit" sub="Chat · talk to the picture"
      bar={<PromptBar value={draft} onChange={setDraft} chips={chips} minRows={2} mention={mention} pose="instruct"
        lead={canvas ? <span className="group relative block h-14 w-11 overflow-hidden rounded-[3px] border border-line" title={`Working on: ${canvas.label}`}><img src={canvas.url} alt="" className="h-full w-full object-cover" /><span className="micro absolute inset-x-0 bottom-0 bg-black/70 text-center text-[9px] text-white">{chat?.head ? "NOW" : "START"}</span>
          <button aria-label="Stop working on this picture" title="Stop working on this picture — the next message starts from the first picture you name with @" onClick={() => chat && useEditChat.getState().patch(chat.id, (c) => ({ ...c, head: null, start: null }))}
            className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center bg-black/80 text-[11px] text-white opacity-0 group-hover:opacity-100">×</button></span> : undefined}
        placeholder={canvas ? "What should change? e.g. “her right hand open, palm up”, “@sweater on her, keep the background”, “keep the clothes from the original”…"
          : "Start with a picture: drop one here, or type @ — e.g. “@faery replaces the woman in @pinterest”"}
        action={<GoButton onClick={go} disabled={!!why || busy} why={why ?? "Sending…"}>{running ? "Send · queued" : "Send"}</GoButton>} />}
      drawer={<ChatSide chat={chat} chars={chars} onPick={insert} onFiles={() => file.current?.click()} />}>
      <div className="flex flex-col gap-4 pt-1" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addDrop(e.dataTransfer); }}>
        <input ref={file} type="file" multiple accept="image/*" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        {!chat || (!chat.turns.length && !chat.pics.length) ? (
          <Starters who={selChar?.name} onUse={(t) => setDraft(t)} onFiles={() => file.current?.click()} />
        ) : (
          <>
            <StartCard chat={chat} />
            {chat.turns.map((t, i) => <TurnCard key={t.id} chat={chat} turn={t} n={i} onRetry={() => { setDraft(t.text); }} />)}
            <div ref={end} />
          </>
        )}
        <div className="mt-4 border-t border-line pt-3"><Feed tab="edit" empty={<span>Every picture Edit makes — chat and classic — shows up here, with the usual buttons: favourite, edit, remix, animate, brush, delete.</span>} /></div>
      </div>
    </Workspace>
  );
}

/** the empty chat: three ways in, like HeliosGen's starter cards — each fills the box with a message to finish */
function Starters({ who, onUse, onFiles }: { who?: string; onUse: (t: string) => void; onFiles: () => void }) {
  const at = who ? `@${who.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "")}` : "@yourcharacter";
  const cards: { icon: string; title: string; text: string; fill: string }[] = [
    { icon: "user", title: "Put your character in a picture", text: "Drop a Pinterest or CivitAI picture, then name them.", fill: `${at} replaces the woman in @` },
    { icon: "brush", title: "Fix one part", text: "Only that part is redrawn; the rest stays exactly the same.", fill: "her right hand: open, palm up, relaxed fingers" },
    { icon: "image", title: "New background", text: "The person stays; the place changes and the light is blended.", fill: "a realistic bedroom background, warm lamp light, evening" },
  ];
  return (
    <div className="fade-in flex min-h-[420px] flex-col items-center justify-center gap-6 border border-dashed border-line px-6 py-12 text-center">
      <div>
        <h2 className="display text-[22px]">Talk to the picture</h2>
        <p className="mx-auto mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted">Each message changes the latest picture. Name pictures with @ — your character, a photo, a sweater — and say what you want in plain words.</p>
      </div>
      <div className="grid w-full max-w-3xl gap-3 md:grid-cols-3">
        {cards.map((c) => (
          <button key={c.title} onClick={() => onUse(c.fill)} className="press card group flex flex-col items-start gap-2 border border-line p-4 text-left hover:border-accent">
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-accent/40 bg-accent/10 text-accent"><Icon name={c.icon} size={16} /></span>
            <span className="text-[13.5px] font-medium text-ink">{c.title}</span>
            <span className="text-[12px] leading-relaxed text-dim">{c.text}</span>
          </button>
        ))}
      </div>
      <button onClick={onFiles} className="text-[12.5px] text-muted hover:text-ink"><Icon name="up" size={13} className="mr-1 inline" />or drop a picture anywhere here</button>
    </div>
  );
}

function StartCard({ chat }: { chat: Chat }) {
  const start = chat.pics.find((p) => p.key === chat.start);
  const others = chat.pics.filter((p) => p.key !== chat.start);
  return (
    <div className="flex items-start gap-3">
      {start ? <Thumb pic={start} big /> : <span className="flex h-40 w-32 items-center justify-center border border-dashed border-line text-center text-[11.5px] text-dim">No starting picture yet</span>}
      <div className="flex min-w-0 flex-col gap-1.5 pt-1 text-[12.5px]">
        <span className="text-muted">{start ? <>Starting from <b className="font-medium text-ink">@{start.key}</b></> : "The first picture you name becomes the start"}</span>
        {others.length > 0 && <div className="flex flex-wrap gap-1.5">{others.map((p) => <Thumb key={p.key} pic={p} />)}</div>}
      </div>
    </div>
  );
}

function Thumb({ pic, big }: { pic: ChatPic; big?: boolean }) {
  return (
    <button onClick={() => openViewer([{ url: pic.url, kind: "image", label: `@${pic.key}` }], 0)} title={`@${pic.key} — ${pic.label}`}
      className={cx("group relative shrink-0 overflow-hidden border border-line bg-raised", big ? "h-40 w-32" : "h-14 w-11", pic.charId ? "rounded-full" : "rounded-[3px]")}>
      <img src={pic.url} alt="" className="h-full w-full object-cover" />
      {big && <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-center text-[11px] text-white">@{pic.key}</span>}
    </button>
  );
}

/** "@faery" → a highlighted chip in the message */
function Words({ text, pics }: { text: string; pics: ChatPic[] }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/@([a-z0-9]+)/gi)) {
    const p = pics.find((x) => x.key === m[1].toLowerCase());
    parts.push(text.slice(last, m.index));
    parts.push(p ? <span key={m.index} className="mx-0.5 inline-flex items-center gap-1 rounded-sm bg-accent/15 px-1 align-middle text-accent"><img src={p.url} alt="" className={cx("h-4 w-4 object-cover", p.charId ? "rounded-full" : "rounded-[2px]")} />@{p.key}</span> : m[0]);
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function TurnCard({ chat, turn, n, onRetry }: { chat: Chat; turn: Turn; n: number; onRetry: () => void }) {
  const toast = useJobs((s) => s.toast);
  const from = turn.from.head ? `step ${chat.turns.findIndex((t) => t.id === turn.from.head!.turn) + 1}` : turn.from.pic ? `@${turn.from.pic}` : "";
  const prevStep = n > 0 && turn.from.head && chat.turns[n - 1]?.id !== turn.from.head.turn;
  return (
    <div className="fade-up flex flex-col gap-2">
      <div className="ml-auto max-w-[80%] border border-line bg-raised2 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink">
        <Words text={turn.text} pics={chat.pics} />
      </div>
      <div className={cx("card flex flex-col gap-2.5 border p-3", turn.status === "failed" ? "border-bad/50" : "border-line", turn.status === "running" && "run-border")}>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="micro text-dim">STEP {n + 1}</span>
          <span className="rounded-sm border border-line px-1.5 py-0.5 text-muted">{ROUTE_LABEL[turn.route]}</span>
          <span className="min-w-0 truncate text-dim" title={turn.note}>{turn.note}</span>
          {from && <span className={cx("ml-auto text-dim", prevStep && "text-accent")}>{prevStep ? "↳ branched from " : "on "}{from}</span>}
        </div>
        {turn.told && <details className="text-[12px] text-dim"><summary className="cursor-pointer hover:text-muted">What it was told</summary><p className="mt-1 border border-line bg-raised p-2 leading-relaxed text-muted">{turn.told}</p></details>}
        {turn.status === "running" && <RunningNow chatId={chat.id} step={turn.step} />}
        {turn.error && <p className={cx("text-[12.5px]", turn.status === "failed" ? "text-bad" : "text-muted")}>{turn.error}</p>}
        {turn.status === "failed" && <div><Btn small onClick={onRetry}>Put it back in the box</Btn></div>}
        {turn.takes.length > 0 && (
          <div className="flex flex-wrap gap-2.5">
            {turn.takes.map((t, i) => {
              const on = chat.head?.turn === turn.id && chat.head.take === i;
              return (
                <div key={i} className={cx("group relative w-[220px] overflow-hidden border bg-black", on ? "border-accent ring-2 ring-accent" : "border-line")}>
                  <button className="block w-full" onClick={() => openViewer(turn.takes.map((x, k) => ({ url: x.url, kind: "image" as const, label: `Step ${n + 1} · take ${k + 1}` })), i)} aria-label="Open full screen"
                    onContextMenu={(e) => openPictureMenu(e, { output: { ...t.file, type: "output" }, label: `Step ${n + 1} · take ${i + 1}` })} title="Click: full screen · right-click: the usual menu (use in Create / Classic edit, animate, face, site…)">
                    <img src={t.url} alt="" className="block w-full" />
                  </button>
                  {typeof t.score === "number" && <span title={t.why || "face check"} className={cx("absolute left-1.5 top-1.5 rounded-sm px-1.5 py-0.5 text-[11px] font-medium", t.score >= 7 ? "bg-good/85 text-black" : t.score >= 5 ? "bg-black/75 text-ink" : "bg-bad/85 text-white")}>face {t.score}/10</span>}
                  {on && <span className="micro absolute right-1.5 top-1.5 bg-accent px-1.5 py-0.5 text-accentink">NOW</span>}
                  <div className="flex items-center gap-1 border-t border-line bg-raised p-1">
                    <button disabled={on} onClick={() => continueFrom(chat.id, { turn: turn.id, take: i })} className="press flex-1 px-2 py-1 text-left text-[12px] text-accent hover:underline disabled:text-dim disabled:no-underline">{on ? "Working on this" : "Continue here"}</button>
                    <button title="Give it an @name to use in a later message (e.g. bring this outfit back)" onClick={() => takeAsPic(chat.id, n, t).then((p) => toast(`Named @${p.key} — type it in any message`, "good")).catch((e) => toast((e as Error).message, "bad"))}
                      className="press px-1.5 py-1 text-[12px] text-muted hover:text-ink">@</button>
                    {t.draft && <button title="See Qwen's draft (before Krea repainted it)" onClick={() => openViewer([{ url: t.draft!, kind: "image", label: "Qwen draft" }, { url: t.url, kind: "image", label: "After Krea's repaint" }], 0)} className="press px-1.5 py-1 text-[12px] text-muted hover:text-ink">draft</button>}
                    <a href={t.url} download title="Download" className="press px-1.5 py-1 text-muted hover:text-ink"><Icon name="down" size={13} /></a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** the settings column: chats, this chat's pictures (click = insert @name), your characters, the helper models */
function ChatSide({ chat, chars, onPick, onFiles }: { chat: Chat | null; chars: ReturnType<typeof useCharacters.getState>["list"]; onPick: (w: string) => void; onFiles: () => void }) {
  const st = useEditChat();
  const toast = useJobs((s) => s.toast);
  const q = useDownloads((s) => s.groups.find((g) => g.id === "qwen"));
  const qf = useDownloads((s) => s.groups.find((g) => g.id === "qwen_full"));
  const gpu = useDownloads((s) => s.gpu);
  const big = (gpu?.vram_mb ?? 0) >= 46000;
  const qReady = !q || q.state === "done";
  const project = useCharacters((x) => x.sel ?? null);
  const chats = useMemo(() => [...st.chats].filter((c) => inProject(c, project) && !c.batch).sort((a, b) => b.updated - a.updated), [st.chats, project]);
  const ensure = () => useEditChat.getState().current() ?? useEditChat.getState().newChat();
  return (
    <>
      <div className="flex items-center gap-2">
        <Btn small kind="primary" className="flex-1" onClick={() => useEditChat.getState().newChat()}><Icon name="plus" size={13} /> New chat</Btn>
        <Btn small onClick={onFiles}><Icon name="up" size={13} /> Add picture</Btn>
        <Btn small onClick={() => pickFromCivitai({ kind: "edit", slot: "1" })} title="Pick a picture from your CivitAI collections (or a post link) — it joins this chat"><Icon name="search" size={13} /> CivitAI</Btn>
      </div>
      <div>
        <Label>In this chat</Label>
        {!chat?.pics.length ? <p className="text-[12px] leading-relaxed text-dim">Pictures you drop in, pick with @ or send here from a result get a short @name. Click one to put its name in your message.</p> : (
          <div className="flex flex-wrap gap-2">
            {chat.pics.map((p) => (
              <div key={p.key} className="flex w-[64px] flex-col items-center gap-1">
                <button onClick={() => onPick(`@${p.key}`)} title={`Insert @${p.key}`} className="press flex w-full flex-col items-center gap-1">
                  <span className={cx("h-14 w-14 overflow-hidden border", p.key === chat.start && !chat.head ? "border-accent" : "border-line", p.charId ? "rounded-full" : "rounded-[3px]")}><img src={p.url} alt="" className="h-full w-full object-cover" /></span>
                  <span className="w-full truncate text-center text-[11.5px] text-muted">@{p.key}</span>
                </button>
                {!p.charId && !(p.key === chat.start && !chat.head) && <button className="text-[10.5px] text-accent hover:underline" title="The next message changes this picture (instead of the one you're on)"
                  onClick={() => useEditChat.getState().patch(chat.id, (c) => ({ ...c, start: p.key, head: null }))}>work on this</button>}
              </div>
            ))}
          </div>
        )}
      </div>
      {chars.length > 0 && (
        <div>
          <Label>Your characters</Label>
          <div className="flex flex-wrap gap-2">
            {chars.map((c) => (
              <button key={c.id} onClick={() => addCharacter(ensure().id, c).then((p) => onPick(`@${p.key}`)).catch((e) => toast((e as Error).message, "bad"))} title={`Add ${c.name} to this chat`} className="press flex w-[64px] flex-col items-center gap-1">
                <span className="h-12 w-12 overflow-hidden rounded-full border border-line"><img src={viewUrl((c.views.face || c.views.front)!)} alt="" className="h-full w-full object-cover" /></span>
                <span className="w-full truncate text-center text-[11.5px] text-muted">{c.name.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <ChatLoras />
      <div className="border-t border-line pt-3"><KreaEditModel /></div>
      <div className="border-t border-line pt-3"><WriterChoice /></div>
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <Label>How messages are done</Label>
        <ul className="flex flex-col gap-1 text-[12px] leading-relaxed text-dim">
          <li><b className="font-medium text-muted">One part</b> — name a part (“her right hand”, “the sweater”): SAM 3 outlines it and only it is redrawn.</li>
          <li><b className="font-medium text-muted">New background</b> — the person stays, the place changes, the light is blended.</li>
          <li><b className="font-medium text-muted">Qwen → Krea 2</b> — big changes (a character in, a new pose, clothes from another picture): Qwen-Image-Edit 2511 makes it (up to 3 pictures), Krea 2 repaints it with their face.</li>
          <li><b className="font-medium text-muted">Krea 2</b> — everything else.</li>
        </ul>
        <div className={cx("mt-1 border px-3 py-2 text-[12px]", qReady ? "border-line" : "border-accent/50 bg-accent/5")}>
          {qReady ? <span className="text-muted"><Icon name="check" size={12} className="mr-1 inline text-good" />Qwen-Image-Edit 2511 is here</span> : (
            <div className="flex flex-col gap-1.5">
              <span className="text-ink">Qwen + Krea needs Qwen-Image-Edit 2511 (≈30 GB).</span>
              <span className="text-dim">{q?.state === "downloading" ? `Downloading — ${q.pct}%` : q?.state === "waiting" ? "In line to download" : "Until then, big changes go through Krea 2 alone."}</span>
              {(q?.state === "later" || q?.state === "skipped" || q?.state === "error") && <Btn small onClick={() => setLater("qwen", false).then(() => toast("Downloading Qwen-Image-Edit 2511", "info")).catch((e) => toast((e as Error).message, "bad"))}><Icon name="down" size={13} /> Download now</Btn>}
            </div>
          )}
          {qReady && big && qf && qf.state !== "done" && (
            <div className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2">
              <span className="text-dim">This card has {Math.round((gpu?.vram_mb ?? 0) / 1024)} GB — the full-precision Qwen (38 GB) fits{qf.state === "downloading" ? ` · downloading ${qf.pct}%` : ""}.</span>
              {(qf.state === "later" || qf.state === "skipped" || qf.state === "error") && <Btn small onClick={() => setLater("qwen_full", false).then(() => toast("Downloading the full-precision Qwen", "info")).catch((e) => toast((e as Error).message, "bad"))}><Icon name="down" size={13} /> Get the full-precision model</Btn>}
            </div>
          )}
        </div>
      </div>
      {chats.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <Label>Chats</Label>
          {chats.slice(0, 12).map((c) => (
            <div key={c.id} className={cx("group flex items-center gap-2 px-2 py-1.5 text-[12.5px]", c.id === st.cur ? "bg-hover text-ink" : "text-muted hover:text-ink")}>
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => st.set({ cur: c.id })}>{c.title} <span className="text-dim">· {c.turns.length}</span></button>
              <button aria-label="Delete chat" onClick={() => st.remove(c.id)} className="opacity-0 hover:text-bad group-hover:opacity-100"><Icon name="x" size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** the Krea 2 LoRAs every Edit chat picture is made with (the same list as Classic edit's), on top of the character's own */
function ChatLoras() {
  const [e, set] = useSection("edit");
  const k = editKeys("krea");
  const sel = useCharacters((x) => x.list.find((c) => c.id === x.sel) ?? null);
  const own = (sel?.loras ?? []).filter((l) => !l.off);
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <LoraList family={k.family} label="LoRAs · Krea 2 (optional)" value={e[k.loras] ?? []} onChange={(v) => set({ [k.loras]: v } as Partial<typeof e>)} />
      <p className="text-[11.5px] leading-relaxed text-dim">Added to every Krea 2 step of every message (Qwen's step doesn't use LoRAs).{own.length ? ` ${sel!.name}'s own — ${own.map((l) => l.name.split("/").pop()!.replace(/\.safetensors$/, "")).join(", ")} — come along by themselves whenever they're in the picture.` : ""}</p>
    </div>
  );
}

/** a message being worked on: the step, the picture as it forms (when the model sends previews) and Cancel */
function RunningNow({ chatId, step }: { chatId: string; step?: string }) {
  const job = useJobs((s) => s.jobs.find((j) => j.meta?.chat === chatId && (j.status === "running" || j.status === "queued")));
  const cancel = useJobs((s) => s.cancel);
  return (
    <div className="flex items-start gap-3">
      {job?.preview && <img src={job.preview} alt="Forming" className="h-40 w-auto border border-line object-contain" />}
      <div className="flex flex-col gap-1.5 text-[12.5px] text-muted">
        <span><span className="pulse mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />{step ?? "Working"}…{job?.status === "queued" ? " (waiting for the GPU)" : ""}</span>
        {job && <button className="self-start text-[12px] text-muted hover:text-bad" onClick={() => cancel(job.id)}>Cancel this step</button>}
      </div>
    </div>
  );
}
