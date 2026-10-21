// Talk instead of typing: record in the browser, turn it into text on the rental (Whisper — nothing leaves your rental).
import { useEffect, useRef, useState } from "react";

export type MicState = "idle" | "recording" | "working";

export function useDictation(onText: (text: string) => void, onError: (msg: string) => void) {
  const [state, setState] = useState<MicState>("idle");
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cb = useRef({ onText, onError });
  cb.current = { onText, onError };
  useEffect(() => () => { rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  const starting = useRef(false);
  const start = async () => {
    if (state !== "idle" || starting.current) return;
    starting.current = true;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      cb.current.onError("The microphone needs the secure link — ⋯ menu → Secure link");
      starting.current = false;
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("working");
        try {
          const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
          const res = await fetch("/studio-api/transcribe", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(d.error || `Speech to text failed (${res.status})`);
          if (d.text) cb.current.onText(d.text);
        } catch (e) { cb.current.onError((e as Error).message); } finally { setState("idle"); }
      };
      rec.current = r;
      r.start(250);
      setState("recording");
      starting.current = false;
    } catch (e) {
      cb.current.onError((e as Error).name === "NotAllowedError" ? "Allow the microphone for this page (the icon left of the address)" : (e as Error).message);
      setState("idle");
      starting.current = false;
    }
  };
  const stop = () => { if (rec.current && rec.current.state === "recording") rec.current.stop(); };
  const toggle = () => (state === "recording" ? stop() : state === "idle" ? start() : undefined);
  return { state, start, stop, toggle };
}
