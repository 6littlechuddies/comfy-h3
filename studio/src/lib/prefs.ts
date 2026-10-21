/**
 * Keeps the small "where I was" settings (selected character, each project's Create box, Assistant chat, sizes…)
 * on the rental itself, so the plain IP link and the secure https link (a different web address, so a different
 * browser storage) open looking exactly the same. Everything starting with "h3." except the big results list
 * (which already lives on the rental) is mirrored.
 */
const SKIP = (k: string) => !k.startsWith("h3.") || k.startsWith("h3.jobs.") || k === "h3.__pts";
type Blob = Record<string, [string | null, number]>;

const readPts = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem("h3.__pts") || "{}"); } catch { return {}; } };
const writePts = (p: Record<string, number>) => { try { rawSet.call(localStorage, "h3.__pts", JSON.stringify(p)); } catch { /* */ } };
const rawSet = Storage.prototype.setItem;
const rawRemove = Storage.prototype.removeItem;
const dirty = new Set<string>();
let timer: number | undefined;

const get = async (): Promise<Blob> => { try { const r = await fetch("/studio-api/state/prefs"); return (await r.json()) || {}; } catch { return {}; } };

async function push(keepalive = false) {
  timer = undefined;
  if (!dirty.size) return;
  const keys = [...dirty]; dirty.clear();
  const cur = await get(); const pts = readPts();
  for (const k of keys) cur[k] = [localStorage.getItem(k), pts[k] ?? Date.now()];
  try { await fetch("/studio-api/state/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cur), keepalive }); }
  catch { keys.forEach((k) => dirty.add(k)); }
}
const touch = (k: string) => {
  if (SKIP(k)) return;
  const p = readPts(); p[k] = Date.now(); writePts(p);
  dirty.add(k); window.clearTimeout(timer); timer = window.setTimeout(() => push(), 900);
};

/** pull the rental's copy into this browser (newer wins), then start mirroring changes back */
export async function startPrefs() {
  try {
    const server = await Promise.race([get(), new Promise<Blob>((r) => setTimeout(() => r({}), 2000))]);
    const pts = readPts();
    for (const [k, [v, ts]] of Object.entries(server)) {
      if (SKIP(k) || (pts[k] ?? 0) >= ts) continue;
      if (v === null) rawRemove.call(localStorage, k); else rawSet.call(localStorage, k, v);
      pts[k] = ts;
    }
    writePts(pts);
    // anything this browser has that the rental doesn't know yet
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (!SKIP(k) && !(k in server)) dirty.add(k); }
    if (dirty.size) timer = window.setTimeout(() => push(), 1500);
  } catch { /* storage blocked — nothing to sync */ }
  Storage.prototype.setItem = function (k: string, v: string) { rawSet.call(this, k, v); if (this === localStorage) touch(k); };
  Storage.prototype.removeItem = function (k: string) { rawRemove.call(this, k); if (this === localStorage) touch(k); };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") push(true); });
}
