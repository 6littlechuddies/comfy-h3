// Copy text to the clipboard. The rental's address is plain http, where browsers switch off navigator.clipboard —
// so this falls back to the old copy command (still allowed on http after a click), and if even that is blocked it
// shows the text in a box, already selected, to copy by hand. Never silently does nothing.
import { useJobs } from "./jobs";

function oldCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text; ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
  document.body.appendChild(ta);
  const sel = document.getSelection(); const prev = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  if (prev && sel) { sel.removeAllRanges(); sel.addRange(prev); }
  return ok;
}

/** a box with the text selected, for when the browser won't copy at all */
function showToCopy(text: string) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;";
  const box = document.createElement("div");
  box.style.cssText = "background:#16181b;border:1px solid #3a3f46;max-width:720px;width:100%;padding:14px;display:flex;flex-direction:column;gap:10px;color:#e8e6e1;font:13px system-ui;";
  box.innerHTML = "<div>Your browser blocked copying here. The text is selected below — press Ctrl+C (⌘C on a Mac), then close.</div>";
  const ta = document.createElement("textarea");
  ta.value = text; ta.readOnly = true;
  ta.style.cssText = "width:100%;height:280px;background:#0d0f11;color:#e8e6e1;border:1px solid #3a3f46;padding:8px;font:12px ui-monospace,monospace;";
  const close = document.createElement("button");
  close.textContent = "Close"; close.style.cssText = "align-self:flex-end;padding:6px 14px;background:#2a2e34;color:#e8e6e1;border:1px solid #3a3f46;cursor:pointer;";
  const done = () => { wrap.remove(); window.removeEventListener("keydown", esc); };
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape") done(); };
  close.onclick = done; wrap.onclick = (e) => { if (e.target === wrap) done(); };
  window.addEventListener("keydown", esc);
  box.append(ta, close); wrap.append(box); document.body.append(wrap);
  ta.focus(); ta.select();
}

/** copy, then say so ("Copied" by default; pass "" for no message) */
export async function copyText(text: string, msg = "Copied"): Promise<boolean> {
  const toast = useJobs.getState().toast;
  let ok = false;
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
  }
  if (!ok) ok = oldCopy(text);
  if (ok) { if (msg) toast(msg, "good"); return true; }
  showToCopy(text);
  return false;
}
