import { useState, type MouseEvent } from "react";
import { thumbUrl, viewUrl, type FileRef } from "../lib/api";

/** a grid tile's picture: a small WebP preview (sharper one on high-density screens) instead of the full file, which only
 *  loads when you open it. A video shows a still frame and plays itself only while hovered (`play`). If the preview
 *  can't be had, the full file is shown. */
export function Thumb({ f, className, video, play = true, w = 384, onError }: { f: FileRef; className?: string; video?: boolean; play?: boolean; w?: 192 | 384; onError?: () => void }) {
  const [full, setFull] = useState(false);
  const [hover, setHover] = useState(false);
  const isVid = video ?? /\.(mp4|webm|mov|mkv)$/i.test(f.filename);
  if (isVid && hover && play)
    return <video src={viewUrl(f)} muted loop autoPlay playsInline onMouseLeave={() => setHover(false)} className={className} />;
  const src = full ? viewUrl(f) : thumbUrl(f, w);
  return (
    <img src={src} srcSet={full ? undefined : `${thumbUrl(f, w)} 1x, ${thumbUrl(f, w === 192 ? 384 : 768)} 2x`} alt="" loading="lazy" decoding="async" draggable={false}
      onMouseEnter={isVid && play ? (_e: MouseEvent) => setHover(true) : undefined}
      onError={() => { if (!full && !isVid) setFull(true); else onError?.(); }} className={className} />
  );
}
