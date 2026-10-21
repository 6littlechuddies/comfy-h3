import { useEffect, useState } from "react";
import { useCharacters } from "../lib/characters";
import { useJobs } from "../lib/jobs";
import { carryLikeness, promptOfPicture, SOURCE_LABEL, type Source } from "../lib/likeness";
import type { Media } from "../lib/tray";
import { Btn, Seg } from "./ui";

/** Edit: picture 1's prompt in one click, and "carry picture 2's look into it" (the merge you did by hand with the rewriter) */
export function LikenessCard({ pic1, pic2, anime, onPrompt, onPic2 }: { pic1: Media | null; pic2: Media | null; anime: boolean; onPrompt: (text: string, note: string) => void; onPic2: (m: Media) => void }) {
  const toast = useJobs((s) => s.toast);
  const ch = useCharacters((s) => s.list.find((x) => x.id === s.sel) ?? null);
  const [known, setKnown] = useState<{ prompt: string; source: Source } | null | undefined>(undefined);
  const [outfit, setOutfit] = useState<"new person" | "scene">("new person");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setKnown(undefined);
    if (pic1) promptOfPicture(pic1).then((k) => { if (live) setKnown(k); }).catch(() => live && setKnown(null));
    return () => { live = false; };
  }, [pic1?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pic1) return null;
  const who = pic2 ? "picture 2's person" : ch ? ch.name : null;
  const carry = async () => {
    setBusy("Starting…");
    try {
      // no picture 2: your character's own picture goes in, so the edit sees their face as well as reading about it
      let p2 = pic2;
      if (!p2 && ch?.views.front) { p2 = await useCharacters.getState().asMedia(ch.id, "front") /* the whole person: face, body, outfit */; if (p2) onPic2(p2); }
      const r = await carryLikeness({ pic1, pic2: p2, character: ch, anime, outfit, progress: setBusy });
      onPrompt(r.prompt, `Picture 1: ${SOURCE_LABEL[r.scene]} · person: ${SOURCE_LABEL[r.person]}`);
      toast(`Merged prompt is in the box — ${who ?? "the person"} in picture 1's scene. Press Make edit.`, "good");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(null); }
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-raised/50 p-2.5 text-[12.5px]">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-muted">{known === undefined ? "Looking for picture 1's prompt…" : known ? `Picture 1 has ${SOURCE_LABEL[known.source]} (${known.prompt.split(/\s+/).length} words)` : "Picture 1 has no prompt — it will be read off the picture in detail"}</span>
        {known && <button className="text-accent hover:underline" onClick={() => onPrompt(known.prompt.replace(/<lora:[^>]+>/gi, "").trim(), `Picture 1: ${SOURCE_LABEL[known.source]}`)}>Use it</button>}
      </div>
      <Seg label="Outfit" value={outfit} onChange={setOutfit} options={[{ value: "new person", label: who ? `${who.length > 18 ? "Their" : who + "'s"} own` : "Their own" }, { value: "scene", label: "Picture 1's" }]} />
      <Btn kind="primary" small onClick={carry} disabled={!!busy || !who} why={busy ?? "Add picture 2 (the person), or pick a character on the left"}>
        {busy ?? `Carry ${who ?? "picture 2's person"}'s look into picture 1`}
      </Btn>
      <p className="text-[11.5px] leading-relaxed text-dim">The writer rewrites picture 1's prompt with {who ?? "the person"} in it, keeping its pose, framing, light and style word for word{pic2 ? ` (their look comes from picture 2's own prompt, or a detailed read of it${ch ? `, plus ${ch.name}'s profile` : ""})` : ch ? ` (from ${ch.name}'s profile)` : ""}. Then Make edit sends both pictures with it.</p>
    </div>
  );
}
