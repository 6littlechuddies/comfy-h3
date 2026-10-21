import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { uploadFile, type InputFile } from "../lib/api";
import { Btn, Slider, cx } from "./ui";

/** paint over the part of the picture you want changed; returns a white-on-black mask in the input folder */
type PaintMask = InputFile & { url: string; box?: { x: number; y: number; width: number; height: number; W: number; H: number } };
/** onFix: the message box under the picture — paint, say what it should become, press Fix (Gemini-style) */
export function Painter({ src, onDone, onClose, onFix, onRemove }: { src: string; onDone: (mask: PaintMask) => void; onClose: () => void; onFix?: (mask: PaintMask, words: string) => void;
  /** there's a painted area already: nothing painted + "Use this area" (or the button) removes it — back to editing the whole picture */
  onRemove?: () => void }) {
  const [words, setWords] = useState("");
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [brush, setBrush] = useState(60);
  const [erase, setErase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const hist = useRef<ImageData[]>([]);
  const drawing = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
  }, [src]);

  const pt = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * cv.current!.width, y: ((e.clientY - r.top) / r.height) * cv.current!.height };
  };
  const stroke = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const ctx = cv.current!.getContext("2d")!;
    ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    ctx.strokeStyle = "rgba(240,123,107,1)"; ctx.lineWidth = brush; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  };
  const down = (e: React.PointerEvent) => {
    const ctx = cv.current!.getContext("2d")!;
    hist.current.push(ctx.getImageData(0, 0, cv.current!.width, cv.current!.height));
    if (hist.current.length > 30) hist.current.shift();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = pt(e); drawing.current = p; stroke(p, p);
  };
  const moveP = (e: React.PointerEvent) => { if (!drawing.current) return; const p = pt(e); stroke(drawing.current, p); drawing.current = p; };
  const up = () => { drawing.current = null; };
  const undo = () => { const h = hist.current.pop(); if (h) cv.current!.getContext("2d")!.putImageData(h, 0, 0); };
  const clear = () => { const c = cv.current!; hist.current.push(c.getContext("2d")!.getImageData(0, 0, c.width, c.height)); c.getContext("2d")!.clearRect(0, 0, c.width, c.height); };

  const done = async (fix?: boolean) => {
    const c = cv.current!;
    const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
    let any = false;
    const out = document.createElement("canvas"); out.width = c.width; out.height = c.height;
    const octx = out.getContext("2d")!;
    const m = octx.createImageData(c.width, c.height);
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let i = 0; i < data.data.length; i += 4) {
      const v = data.data[i + 3] > 20 ? 255 : 0;
      if (v) { any = true; const px = (i / 4) % c.width, py = Math.floor(i / 4 / c.width); if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
      m.data[i] = m.data[i + 1] = m.data[i + 2] = v; m.data[i + 3] = 255;
    }
    if (!any) { if (onRemove && !fix) { onRemove(); return; } setErr("Paint over the part you want changed first."); return; }
    octx.putImageData(m, 0, 0);
    setBusy(true);
    try {
      const blob: Blob = await new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error("render failed"))), "image/png"));
      const f = await uploadFile(blob, "mask.png");
      const mask = { ...f, url: URL.createObjectURL(blob), box: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, W: c.width, H: c.height } };
      if (fix && onFix) onFix(mask, words.trim()); else onDone(mask);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return createPortal(
    <div className="fade-in fixed inset-0 z-50 flex flex-col bg-black/85 p-6 backdrop-blur-sm" role="dialog" aria-label="Paint the area to change">
      <div className="mb-3 flex items-center gap-4">
        <h2 className="display text-lg">Paint over what you want changed</h2>
        <span className="text-[13px] text-muted">Only the painted area changes — everything else stays exactly the same.</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="w-48"><Slider label="Brush" min={8} max={300} value={brush} show={`${brush}px`} onChange={setBrush} /></div>
          <Btn className={cx(!erase && "!border-accent")} onClick={() => setErase(false)}>Brush</Btn>
          <Btn className={cx(erase && "!border-accent")} onClick={() => setErase(true)}>Eraser</Btn>
          <Btn onClick={undo}>Undo</Btn>
          <Btn onClick={clear}>Clear</Btn>
          <Btn onClick={onClose}>Cancel</Btn>
          {onRemove && <Btn onClick={onRemove} title="Edit the whole picture again (no painted area)">No painted area</Btn>}
          <Btn kind={onFix ? undefined : "primary"} className="!h-10" onClick={() => done()} disabled={busy} why="Saving…">{onFix ? "Just mark the area" : "Use this area"}</Btn>
        </div>
      </div>
      {err && <p className="mb-2 text-[13px] text-bad">{err}</p>}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {size && (
          <div className="relative max-h-full max-w-full" style={{ aspectRatio: `${size.w} / ${size.h}`, height: "100%" }}>
            <img src={src} alt="" className="absolute inset-0 h-full w-full select-none object-contain" draggable={false} />
            <canvas ref={cv} width={size.w} height={size.h} className="absolute inset-0 h-full w-full cursor-crosshair opacity-55" style={{ touchAction: "none" }}
              onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up} />
          </div>
        )}
      </div>
      {onFix && (
        <form className="mx-auto mt-3 flex w-full max-w-3xl items-center gap-2" onSubmit={(e) => { e.preventDefault(); done(true); }}>
          <input value={words} onChange={(e) => setWords(e.target.value)} autoFocus aria-label="What the painted area should become"
            placeholder="What should the painted area become? e.g. “no hand here — just her collarbone and skin”, “fix the fingers”, “remove the smudge”"
            className="inset h-11 flex-1 border border-line px-3 text-[14px] focus:border-accent focus:outline-none" />
          <Btn kind="primary" className="!h-11 !px-5" onClick={() => done(true)} disabled={busy} why="Saving…">Fix this area</Btn>
        </form>
      )}
      {onFix && <p className="mx-auto mt-1.5 max-w-3xl text-[11.5px] text-dim">Only the painted part is redrawn, starting from what's there now; everything else is kept pixel for pixel. Empty box = “fix what's wrong here, make it blend in”.</p>}
    </div>,
    document.body,
  );
}
