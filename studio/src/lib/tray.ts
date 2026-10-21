// The tray: everything you made or uploaded this rental (plus recent outputs found on disk).
// Items can be dragged into any slot; outputs are copied into ComfyUI's input folder on first use.
import { create } from "zustand";
import { inputUrl, kindOf, recentOutputs, toInput, uploadFile, viewUrl, type FileRef, type InputFile, type Kind } from "./api";

export interface TrayItem {
  id: string;
  kind: Kind;
  label: string;
  src: FileRef; // where to show it from
  input?: InputFile; // set once it's in the input folder
  addedAt: number;
}
/** what a slot holds: a file in the input folder + how to preview it */
export interface Media extends InputFile { url: string; label: string; trayId?: string }

export const DRAG_TYPE = "application/x-h3-tray";

interface TrayState {
  items: TrayItem[];
  addOutput: (f: FileRef, label: string) => TrayItem | undefined;
  addUpload: (file: File) => Promise<Media>;
  /** a picture dragged in from another tab (Pinterest, any site): fetched on the rental */
  addUrl: (url: string) => Promise<Media>;
  remove: (id: string) => void;
  loadRecent: () => Promise<void>;
  asMedia: (id: string) => Promise<Media>;
}

const key = (f: FileRef) => `${f.type}/${f.subfolder}/${f.filename}`;
export const trayIdOf = key;

export const useTray = create<TrayState>((set, get) => ({
  items: [],
  addOutput: (f, label) => {
    const kind = kindOf(f.filename);
    if (!kind) return;
    const id = key(f);
    const existing = get().items.find((i) => i.id === id);
    if (existing) return existing;
    const item: TrayItem = { id, kind, label, src: f, addedAt: Date.now() };
    set((s) => ({ items: [item, ...s.items].slice(0, 800) }));
    return item;
  },
  addUpload: async (file) => {
    const input = await uploadFile(file);
    const src: FileRef = { filename: input.name, subfolder: "", type: "input" };
    const item: TrayItem = { id: key(src), kind: input.kind, label: file.name.replace(/\.[^.]+$/, ""), src, input, addedAt: Date.now() };
    set((s) => ({ items: [item, ...s.items.filter((i) => i.id !== item.id)] }));
    return { ...input, url: inputUrl(input.name), label: item.label, trayId: item.id };
  },
  addUrl: async (url) => {
    const r = await fetch("/studio-api/fetch-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    if (!r.ok) throw new Error((await r.text()) || "Couldn't get that picture");
    const input = (await r.json()) as InputFile;
    const src: FileRef = { filename: input.name, subfolder: "", type: "input" };
    let host = "web"; try { host = new URL(url).hostname.replace(/^www\./, "").split(".")[0]; } catch { /* */ }
    const item: TrayItem = { id: key(src), kind: input.kind, label: `${host} picture`, src, input, addedAt: Date.now() };
    set((s) => ({ items: [item, ...s.items.filter((i) => i.id !== item.id)] }));
    return { ...input, url: inputUrl(input.name), label: item.label, trayId: item.id };
  },
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  loadRecent: async () => {
    const rec = await recentOutputs(400);
    const have = new Set(get().items.map((i) => i.id));
    const add: TrayItem[] = rec
      .filter((r) => !have.has(key(r)))
      .map((r) => ({ id: key(r), kind: r.kind, label: labelFrom(r), src: { filename: r.filename, subfolder: r.subfolder, type: r.type }, addedAt: r.mtime * 1000 }));
    set((s) => ({ items: [...s.items, ...add].sort((a, b) => b.addedAt - a.addedAt) }));
  },
  asMedia: async (id) => {
    const item = get().items.find((i) => i.id === id);
    if (!item) throw new Error("That item is no longer in the tray");
    let input = item.input;
    if (!input) {
      input = await toInput(item.src);
      set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, input } : i)) }));
    }
    return { ...input, url: viewUrl(item.src), label: item.label, trayId: id };
  },
}));

function labelFrom(r: FileRef): string {
  const folder = r.subfolder.split("/").pop() || "";
  const map: Record<string, string> = { create: "Created", edit: "Edit", animate: "Video", finish: "Export" };
  return `${map[folder] ?? folder} ${r.filename.match(/(\d+)_?\.\w+$/)?.[1]?.replace(/^0+/, "") ?? ""}`.trim();
}

export const trayUrl = (i: TrayItem) => viewUrl(i.src);

/** the web link in a drop from another tab: the image's own address, a link, or the <img> in dragged HTML */
export function droppedUrl(dt: DataTransfer): string | null {
  const html = dt.getData("text/html");
  const img = html && html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
  if (img && /^https?:/i.test(img)) return img.replace(/&amp;/g, "&");
  const list = (dt.getData("text/uri-list") || dt.getData("text/plain") || "").split(/\r?\n/).map((x) => x.trim()).find((x) => /^https?:\/\//i.test(x));
  return list || null;
}
