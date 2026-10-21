// Scene presets: save a scene's shape (its shots, lengths, types, notes, video settings) and start new scenes from it —
// right-click a scene or a character in the project list. Kept with your settings and in project .zip exports.
import { create } from "zustand";
import { loadState, saveState } from "./api";
import { newScene, newShot, useScenes, type Scene } from "./scenes";

export interface ScenePreset {
  id: string; name: string; createdAt: number;
  aspect: Scene["aspect"]; writer: Scene["writer"]; video: Scene["video"];
  shots: { description: string; seconds: number; mode: Scene["shots"][number]["mode"]; frameNotes: string }[];
}
const uid = () => Math.random().toString(36).slice(2, 10);

export const useScenePresets = create<{ list: ScenePreset[]; loaded: boolean }>(() => ({ list: [], loaded: false }));
loadState<ScenePreset[]>("scene_presets").then((l) => useScenePresets.setState({ list: Array.isArray(l) ? l : [], loaded: true }));
const persist = () => saveState("scene_presets", useScenePresets.getState().list).catch(() => {});

export function savePreset(s: Scene, name: string): ScenePreset {
  const p: ScenePreset = {
    id: uid(), name, createdAt: Date.now(), aspect: s.aspect, writer: s.writer, video: s.video,
    shots: s.shots.map((x) => ({ description: x.description, seconds: x.seconds, mode: x.mode, frameNotes: x.frameNotes })),
  };
  useScenePresets.setState((st) => ({ list: [p, ...st.list] }));
  persist();
  return p;
}
export function removePreset(id: string) {
  useScenePresets.setState((st) => ({ list: st.list.filter((x) => x.id !== id) }));
  persist();
}
/** a new scene from a preset, with this cast */
export function sceneFromPreset(p: ScenePreset, cast: string[], name?: string): Scene {
  const s = useScenes.getState().add({
    ...newScene(name ?? p.name), cast, aspect: p.aspect, writer: p.writer, video: { ...newScene().video, ...p.video },
    shots: p.shots.map((x) => newShot({ ...x, cast })),
  });
  return s;
}
/** a copy of a scene (its shots and settings, not its pictures and videos) */
export function duplicateScene(s: Scene): Scene {
  return useScenes.getState().add({
    ...newScene(`${s.name} (copy)`), cast: s.cast, aspect: s.aspect, writer: s.writer, video: s.video,
    shots: s.shots.map((x) => newShot({ description: x.description, seconds: x.seconds, mode: x.mode, frameNotes: x.frameNotes, cast: x.cast, kreaPrompt: x.kreaPrompt, blueprint: x.blueprint, h3: x.h3 })),
  });
}
