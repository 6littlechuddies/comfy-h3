// Interactive controlled Chat, Trigger-Pack, Haggle & Simulated Credit Simulator inside H3 Studio.
// Tests UrGF's exact pack routing, haggling math, credit deductions, and Tier 3 pack upsells against local character sets.
import { useMemo, useState, type FormEvent } from "react";
import type { Character } from "../lib/characters";
import { splitReply, type SimState } from "../lib/chatScore";
import { cardOf, runInteractiveSimTurn } from "../lib/chatTest";
import {
  extractPhotoFromBubbles,
  findLocalPackUpsell,
  floorPrice,
  haggle,
  hagglePhotoNote,
  isSfwPhotoDescription,
  localSetsFor,
  readOffer,
  resolveLocalFreeSfw,
  resolveLocalPhotoTrigger,
  SIM_PLAN_IMAGES,
  simChargePhoto,
  withPrice,
  type HaggleDecision,
  type LocalPhotoResolution,
  type PackKey,
  type SimPlan,
  type SimViewer,
} from "../lib/packSim";
import { cx } from "./ui";

type LockedLocalPhoto = {
  id: string;
  description: string;
  userPrompt: string;
  listCredits: number;
  floorCredits: number;
  askCredits: number;
  haggleRounds: number;
};

type SimEvent =
  | { id: string; kind: "user"; content: string; haggleDecision?: HaggleDecision | null }
  | { id: string; kind: "assistant"; bubbles: string[]; notes: string[]; regens: number; pushes: number; maxHolds: number }
  | {
      id: string;
      kind: "locked_photo";
      photo: LockedLocalPhoto;
      unlocked?: { paidFrom: "plan" | "credits"; creditsSpent: number; resolution: LocalPhotoResolution };
    }
  | { id: string; kind: "photo_result"; prompt: string; paidFrom: "free" | "plan" | "credits"; creditsSpent: number; resolution: LocalPhotoResolution };

type LedgerItem = { id: string; label: string; delta: number; planDelta: number };

const QUICK_TESTS = [
  { label: "Selfie (Tier 1)", text: "send me a quick selfie right now?" },
  { label: "Lingerie", text: "show me your lingerie and thighs" },
  { label: "Boobs / Ass", text: "send me a topless pic from behind" },
  { label: "Explicit Solo", text: "show me completely naked touching yourself" },
  { label: "Cuckold", text: "send a hotwife cuckold pic" },
  { label: "Custom → Wiro", text: "send a pic holding a sign on Mars" },
  { label: "Haggle: Too pricey", text: "that's too expensive, can you go lower?" },
  { label: "Haggle: Half", text: "how about half price?" },
  { label: "Haggle: Free?", text: "come on make it free?" },
];

const mkId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export function LiveChatSim({ c }: { c: Character }) {
  const localSets = useMemo(() => localSetsFor(c), [c]);
  const card = useMemo(() => cardOf(c), [c]);
  const name = c.site?.name || c.name;

  const [viewer, setViewer] = useState<SimViewer>({ plan: "guest", credits: 100, planImagesLeft: 0 });
  const [haggleOn, setHaggleOn] = useState(true);
  const [listPrice, setListPrice] = useState(10);
  const [maxDiscount, setMaxDiscount] = useState(30);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [simState, setSimState] = useState<SimState>(() => ({ pushes: 0, maxHolds: card.holds, asleep: false }));
  const [freeSfwUsed, setFreeSfwUsed] = useState(false);
  const [shownIds, setShownIds] = useState<string[]>([]);
  const [unlocks, setUnlocks] = useState<{ packKey: PackKey; setId?: string; createdAt: number }[]>([]);
  const [ownedSetIds, setOwnedSetIds] = useState<string[]>([]);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const hardFloor = floorPrice(Math.max(1, listPrice), Math.max(0, Math.min(90, maxDiscount)));

  const activeLocked = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.kind === "locked_photo" && !ev.unlocked) return ev.photo;
    }
    return null;
  }, [events]);

  const upsell = useMemo(
    () => findLocalPackUpsell({ unlocks, sets: localSets, ownedSetIds: new Set(ownedSetIds) }),
    [unlocks, localSets, ownedSetIds],
  );

  const pushLedger = (label: string, delta: number, planDelta = 0) =>
    setLedger((prev) => [{ id: mkId("led"), label, delta, planDelta }, ...prev]);

  const reset = () => {
    setEvents([]);
    setSimState({ pushes: 0, maxHolds: card.holds, asleep: false });
    setFreeSfwUsed(false);
    setShownIds([]);
    setUnlocks([]);
    setOwnedSetIds([]);
    setLedger([]);
    setErr(null);
  };

  const changePlan = (plan: SimPlan) =>
    setViewer((v) => ({ plan, credits: v.credits, planImagesLeft: SIM_PLAN_IMAGES[plan] }));

  async function sendTurn(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);

    let locked = activeLocked;
    let haggleDecision: HaggleDecision | null = null;
    if (locked && haggleOn) {
      const offer = readOffer(text, locked.askCredits);
      if (offer) {
        haggleDecision = haggle(
          { list: locked.listCredits, floor: locked.floorCredits, ask: locked.askCredits, rounds: locked.haggleRounds },
          offer,
        );
        const updated: LockedLocalPhoto = { ...locked, askCredits: haggleDecision.ask, haggleRounds: haggleDecision.rounds };
        locked = updated;
        setEvents((prev) =>
          prev.map((ev) => (ev.kind === "locked_photo" && ev.photo.id === updated.id ? { ...ev, photo: updated } : ev)),
        );
        pushLedger(`Haggle r${haggleDecision.rounds}: ${haggleDecision.verdict} → ${haggleDecision.ask} cr`, 0);
      }
    }

    const history: { role: "user" | "assistant"; content: string }[] = [];
    const prevBubbles: string[][] = [];
    if (c.site?.greeting) {
      history.push({ role: "assistant", content: c.site.greeting });
      prevBubbles.push(splitReply(c.site.greeting, name));
    }
    let userTurns = 0;
    for (const ev of events) {
      if (ev.kind === "user") {
        userTurns++;
        history.push({ role: "user", content: ev.content });
      } else if (ev.kind === "assistant" && ev.bubbles.length) {
        history.push({ role: "assistant", content: ev.bubbles.join("\n") });
        prevBubbles.push(ev.bubbles);
      }
    }

    setEvents((prev) => [...prev, { id: mkId("usr"), kind: "user", content: text, haggleDecision }]);

    try {
      const extraNotes =
        locked && haggleOn
          ? [hagglePhotoNote({ description: locked.description, ask: locked.askCredits, decision: haggleDecision })]
          : [];
      const res = await runInteractiveSimTurn({
        c,
        history,
        prevBubbles,
        simState,
        turnNumber: userTurns + 1,
        userMessage: text,
        extraNotes,
      });
      setSimState(res.nextState);
      const extracted = extractPhotoFromBubbles(res.bubbles);
      const finalBubbles =
        locked && haggleOn
          ? extracted.textBubbles.map((b) => withPrice(b, locked!.askCredits))
          : extracted.textBubbles;

      const added: SimEvent[] = [
        {
          id: mkId("ast"),
          kind: "assistant",
          bubbles: finalBubbles,
          notes: res.notes,
          regens: res.regens,
          pushes: res.nextState.pushes,
          maxHolds: res.nextState.maxHolds,
        },
      ];

      if (extracted.photoDescription && !locked) {
        if (!freeSfwUsed && isSfwPhotoDescription(extracted.photoDescription)) {
          setFreeSfwUsed(true);
          const resolution = resolveLocalFreeSfw(localSets, new Set(shownIds), extracted.photoDescription);
          if (resolution.source === "studio_pack") {
            setShownIds((p) => [...p, resolution.item.id]);
            pushLedger(`Tier 1 Free SFW hit (${resolution.packKey})`, 0);
          } else {
            pushLedger("Tier 1 Free SFW → Wiro fallback", 0);
          }
          added.push({
            id: mkId("img"),
            kind: "photo_result",
            prompt: extracted.photoDescription,
            paidFrom: "free",
            creditsSpent: 0,
            resolution,
          });
        } else {
          const lockedPhoto: LockedLocalPhoto = {
            id: mkId("lck"),
            description: extracted.photoDescription,
            userPrompt: text,
            listCredits: Math.max(1, listPrice),
            floorCredits: hardFloor,
            askCredits: Math.max(1, listPrice),
            haggleRounds: 0,
          };
          added.push({ id: mkId("lckev"), kind: "locked_photo", photo: lockedPhoto });
        }
      }
      setEvents((prev) => [...prev, ...added]);
    } catch (e) {
      setErr((e as Error).message || "Simulated turn failed.");
    } finally {
      setBusy(false);
    }
  }

  function unlockPhoto(photo: LockedLocalPhoto) {
    setErr(null);
    const charge = simChargePhoto(viewer, photo.askCredits);
    if (!charge.ok) {
      setErr(charge.reason);
      return;
    }
    const resolution = resolveLocalPhotoTrigger({
      sets: localSets,
      viewer,
      prompt: photo.description,
      fallbackUserPrompt: photo.userPrompt,
      shownIds: new Set(shownIds),
    });
    setViewer(charge.nextViewer);
    if (resolution.source === "studio_pack") {
      setShownIds((p) => [...p, resolution.item.id]);
      setUnlocks((p) => [...p, { packKey: resolution.packKey, setId: resolution.setId, createdAt: Date.now() }]);
      pushLedger(`Unlocked (${resolution.packKey})`, -charge.credits, charge.paidFrom === "plan" ? -1 : 0);
    } else {
      if (resolution.matchedPackKey) {
        setUnlocks((p) => [...p, { packKey: resolution.matchedPackKey!, createdAt: Date.now() }]);
      }
      pushLedger(`Unlock → Wiro dry-run`, -charge.credits, charge.paidFrom === "plan" ? -1 : 0);
    }
    setEvents((prev) =>
      prev.map((ev) =>
        ev.kind === "locked_photo" && ev.photo.id === photo.id
          ? { ...ev, unlocked: { paidFrom: charge.paidFrom, creditsSpent: charge.credits, resolution } }
          : ev,
      ),
    );
  }

  function directTrigger(promptText: string, surprise: boolean) {
    setErr(null);
    const charge = simChargePhoto(viewer, 1);
    if (!charge.ok) {
      setErr(charge.reason);
      return;
    }
    const resolution = resolveLocalPhotoTrigger({
      sets: localSets,
      viewer,
      prompt: promptText,
      shownIds: new Set(shownIds),
      surprise,
    });
    setViewer(charge.nextViewer);
    if (resolution.source === "studio_pack") {
      setShownIds((p) => [...p, resolution.item.id]);
      setUnlocks((p) => [...p, { packKey: resolution.packKey, setId: resolution.setId, createdAt: Date.now() }]);
      pushLedger(`${surprise ? "Surprise" : "Direct"} → ${resolution.packKey}`, -charge.credits, charge.paidFrom === "plan" ? -1 : 0);
    } else {
      pushLedger(`${surprise ? "Surprise" : "Direct"} → Wiro dry-run`, -charge.credits, charge.paidFrom === "plan" ? -1 : 0);
    }
    setEvents((prev) => [
      ...prev,
      { id: mkId("dir"), kind: "photo_result", prompt: surprise ? "(Surprise Me)" : promptText, paidFrom: charge.paidFrom, creditsSpent: charge.credits, resolution },
    ]);
  }

  function unlockUpsell() {
    if (!upsell) return;
    setErr(null);
    const price = upsell.set.priceCredits;
    if (viewer.credits < price) {
      setErr(`That set costs ${price} credits and you have ${viewer.credits}.`);
      return;
    }
    setViewer((v) => ({ ...v, credits: v.credits - price }));
    setOwnedSetIds((p) => [...p, upsell.set.id]);
    pushLedger(`Tier 3 Pack Upsell unlocked: "${upsell.set.title}"`, -price);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    void sendTurn(t);
  }

  function copyJson() {
    void navigator.clipboard.writeText(
      JSON.stringify({ character: name, viewer, haggleOn, listPrice, maxDiscount, hardFloor, localSets: localSets.map((s) => ({ setKey: s.setKey, packKey: s.packKey, count: s.items.length })), ledger, events }, null, 2),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line bg-panel2 p-3 text-[12.5px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-ink">Interactive Trigger-Pack, Haggle &amp; Credit Simulator</p>
          <p className="text-[11.5px] text-muted">
            Tests UrGF&apos;s exact pack router &amp; haggle math against {name}&apos;s {localSets.length} local set{localSets.length === 1 ? "" : "s"} — $0 Wiro, simulated credits.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => directTrigger(draft.trim() || "show me your lingerie", false)} className="press chip-raised h-7 px-2.5 text-[11.5px]">Test Photo Trigger</button>
          <button type="button" onClick={() => directTrigger("", true)} className="press chip-raised h-7 px-2.5 text-[11.5px]">Test Surprise</button>
          <button type="button" onClick={copyJson} className="press chip-raised h-7 px-2.5 text-[11.5px]">{copied ? "Copied!" : "Copy JSON"}</button>
          <button type="button" onClick={reset} className="press h-7 px-2 text-[11.5px] text-muted hover:text-ink">Reset</button>
        </div>
      </div>

      {/* Controls bar */}
      <div className="grid gap-2 border border-line bg-panel p-2.5 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-muted">Simulated viewer plan</label>
          <select value={viewer.plan} onChange={(e) => changePlan(e.target.value as SimPlan)} className="inset h-8 border px-2 text-ink">
            <option value="guest">Guest (spends credits)</option>
            <option value="trial">Trial (suggestive cap)</option>
            <option value="regular">Regular (100 plan pics)</option>
            <option value="resident">Resident (400 plan pics)</option>
            <option value="keyholder">Keyholder (1500 plan pics)</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted">Wallet: <b className="font-mono text-ink">{viewer.credits} cr</b> · <b className="font-mono text-ink">{viewer.planImagesLeft} plan</b></span>
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => { setViewer((v) => ({ ...v, credits: v.credits + 50 })); pushLedger("Sim +50 cr", 50); }} className="press chip-raised h-7 px-2 text-[11px]">+50</button>
            <button type="button" onClick={() => { setViewer((v) => ({ ...v, credits: v.credits + 200 })); pushLedger("Sim +200 cr", 200); }} className="press chip-raised h-7 px-2 text-[11px]">+200</button>
            <button type="button" onClick={() => setViewer((v) => ({ ...v, credits: 0, planImagesLeft: 0 }))} className="press chip-raised h-7 px-2 text-[11px]">Zero</button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-1.5 text-[11.5px] text-ink">
            <input type="checkbox" checked={haggleOn} onChange={(e) => setHaggleOn(e.target.checked)} className="accent-[var(--color-accent)]" />
            Haggling ON <span className="font-mono text-[11px] text-muted">(floor {hardFloor} cr)</span>
          </label>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <label className="flex items-center gap-1">List <input type="number" min={1} value={listPrice} onChange={(e) => setListPrice(Math.max(1, Number(e.target.value) || 10))} className="inset h-7 w-12 border px-1.5 font-mono text-ink" /></label>
            <label className="flex items-center gap-1">Max% <input type="number" min={0} max={90} value={maxDiscount} onChange={(e) => setMaxDiscount(Math.max(0, Math.min(90, Number(e.target.value) || 0)))} className="inset h-7 w-12 border px-1.5 font-mono text-ink" /></label>
          </div>
        </div>
      </div>

      {/* Local set routing map */}
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {localSets.length === 0 ? (
          <span className="text-muted">No local sets yet — triggers will show Wiro dry-run fallback.</span>
        ) : (
          localSets.map((s) => (
            <span key={s.id} className={cx("border px-2 py-0.5 font-mono", s.packKey ? "border-good/40 text-good" : "border-line text-muted")}>
              {s.setKey} → {s.packKey ?? "gallery-only"} ({s.items.length})
            </span>
          ))
        )}
      </div>

      {err && <p className="border border-bad/50 bg-bad/10 px-2.5 py-1.5 text-bad">{err}</p>}

      {/* Chat & Ledger */}
      <div className="grid gap-3 md:grid-cols-12">
        <div className="flex flex-col gap-2 md:col-span-8">
          <div className="inset flex max-h-[380px] min-h-[200px] flex-col gap-2 overflow-y-auto border p-2.5">
            {c.site?.greeting && (
              <div className="max-w-[80%] border border-line px-2.5 py-1.5 whitespace-pre-line text-ink">
                <span className="micro mb-0.5 block text-dim">opener</span>
                {c.site.greeting}
              </div>
            )}
            {events.map((ev) => {
              if (ev.kind === "user") {
                return (
                  <div key={ev.id} className="ml-auto flex max-w-[75%] flex-col items-end gap-0.5">
                    <div className="bg-hover px-2.5 py-1.5 text-ink">{ev.content}</div>
                    {ev.haggleDecision && (
                      <span className="font-mono text-[10.5px] text-accent">
                        haggle → {ev.haggleDecision.verdict} (ask {ev.haggleDecision.ask} cr, r{ev.haggleDecision.rounds})
                      </span>
                    )}
                  </div>
                );
              }
              if (ev.kind === "assistant") {
                return (
                  <div key={ev.id} className="flex flex-col gap-1">
                    {ev.bubbles.map((b, i) => (
                      <div key={i} className="max-w-[80%] border border-line px-2.5 py-1.5 text-ink">{b}</div>
                    ))}
                    <span className="font-mono text-[10px] text-dim">
                      heat {ev.pushes}/{ev.maxHolds} · regens {ev.regens}
                    </span>
                  </div>
                );
              }
              if (ev.kind === "locked_photo") {
                if (!ev.unlocked) {
                  return (
                    <div key={ev.id} className="max-w-[85%] border border-accent/50 bg-panel p-2.5">
                      <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                        <span className="text-accent">LOCKED PHOTO</span>
                        <span className="text-ink">list {ev.photo.listCredits} → ask <b>{ev.photo.askCredits} cr</b> (floor {ev.photo.floorCredits})</span>
                      </div>
                      <p className="mt-1 italic text-muted">[photo: {ev.photo.description}]</p>
                      <button type="button" onClick={() => unlockPhoto(ev.photo)} className="press btn-primary mt-2 h-7 px-3 text-[11.5px] font-semibold">
                        Unlock ({ev.photo.askCredits} cr)
                      </button>
                    </div>
                  );
                }
                return <LocalPhotoBox key={ev.id} prompt={ev.photo.description} paidFrom={ev.unlocked.paidFrom} credits={ev.unlocked.creditsSpent} resolution={ev.unlocked.resolution} />;
              }
              return <LocalPhotoBox key={ev.id} prompt={ev.prompt} paidFrom={ev.paidFrom} credits={ev.creditsSpent} resolution={ev.resolution} />;
            })}

            {upsell && (
              <div className="border border-good/50 bg-good/10 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="micro text-good">TIER 3 PACK UPSELL · {upsell.packKey}</span>
                    <p className="font-semibold text-ink">{upsell.set.title} ({upsell.set.items.length} items · {upsell.set.priceCredits} cr)</p>
                  </div>
                  <button type="button" onClick={unlockUpsell} className="press btn-primary h-7 px-2.5 text-[11.5px] font-semibold">
                    Sim Unlock ({upsell.set.priceCredits} cr)
                  </button>
                </div>
              </div>
            )}
            {busy && <span className="text-muted">Waiting on {name}…</span>}
          </div>

          <div className="flex flex-wrap gap-1">
            {QUICK_TESTS.map((q) => (
              <button key={q.label} type="button" disabled={busy || !c.site?.persona} onClick={() => void sendTurn(q.text)} className="press chip-raised h-6 px-2 text-[11px] disabled:opacity-40">
                {q.label}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="flex gap-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask for a pic (EN/ES), haggle a locked photo, or chat…"
              className="inset h-8 min-w-0 flex-1 border px-2.5 text-ink"
            />
            <button type="submit" disabled={busy || !draft.trim() || !c.site?.persona} className="press btn-primary h-8 px-3 text-[12px] font-semibold disabled:opacity-40">Send</button>
          </form>
        </div>

        <div className="inset flex max-h-[380px] flex-col gap-1.5 overflow-y-auto border p-2.5 md:col-span-4">
          <p className="micro text-dim">Simulated credit &amp; trigger ledger</p>
          {ledger.length === 0 ? (
            <p className="text-[11.5px] text-muted">No events yet.</p>
          ) : (
            ledger.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2 border-b border-line/60 pb-1 text-[11.5px]">
                <span className="truncate text-ink">{row.label}</span>
                <span className={cx("shrink-0 font-mono", row.delta < 0 ? "text-bad" : row.delta > 0 ? "text-good" : "text-muted")}>
                  {row.delta !== 0 ? `${row.delta > 0 ? "+" : ""}${row.delta} cr` : row.planDelta !== 0 ? `${row.planDelta} plan` : "0 cr"}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function LocalPhotoBox({ prompt, paidFrom, credits, resolution }: { prompt: string; paidFrom: string; credits: number; resolution: LocalPhotoResolution }) {
  const isPack = resolution.source === "studio_pack";
  return (
    <div className={cx("max-w-[85%] border p-2", isPack ? "border-good/50 bg-panel" : "border-accent/50 bg-panel")}>
      <div className="flex items-center justify-between gap-2 font-mono text-[10.5px]">
        <span className={isPack ? "text-good" : "text-accent"}>{isPack ? `PACK HIT · ${resolution.packKey}` : "WIRO FALLBACK (dry-run)"}</span>
        <span className="text-muted">{paidFrom === "free" ? "FREE SFW" : paidFrom === "plan" ? "1 plan pic" : `${credits} cr`}</span>
      </div>
      {isPack && <img src={resolution.item.url} alt={prompt} className="mt-1.5 max-h-56 w-full object-cover" />}
      <p className="mt-1 text-[11.5px] text-ink">{resolution.reason}</p>
    </div>
  );
}
