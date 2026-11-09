import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./index.css";
import { startPrefs } from "./lib/prefs";
import { Crash, reportCrash } from "./components/Crash";

window.addEventListener("error", (e) => reportCrash("page", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => { if (e.reason instanceof Error) reportCrash("promise", e.reason); });

// the rental's copy of your remembered bits comes in first, so everything that reads them at load sees the same thing
// on the plain link and the secure link
startPrefs().finally(async () => {
  const [{ default: App }, { useJobs }, { useTray }] = await Promise.all([import("./App"), import("./lib/jobs"), import("./lib/tray")]);
  // handy for debugging from the browser console: open /studio/?debug
  if (location.search.includes("debug")) Promise.all([import("./lib/batch"), import("./lib/work"), import("./lib/characters"), import("./lib/scenes"), import("./lib/packs"), import("./lib/machines"), import("./lib/board")]).then(([{ useBatch }, { useWork }, { useCharacters }, { useScenes }, { usePacks }, { machineRows }, { useBoard }]) =>
    Object.assign(window, { studio: { jobs: useJobs, tray: useTray, batch: useBatch, work: useWork, characters: useCharacters, scenes: useScenes, packs: usePacks, board: useBoard,
      /** every state machine in this page that isn't idle (docs/STATE_MACHINES.md) — the rental's own: GET /studio-api/machines */
      machines: () => { const r = machineRows(); console.table(r); return r; } } }));
  import("./lib/usage").then(({ startUsageLog }) => startUsageLog()).catch(() => {});
  import("./lib/projectWork").then(({ startProjectWork }) => startProjectWork()).catch(() => {});
  import("./lib/machines").then(({ startMachineReports }) => startMachineReports()).catch(() => {});
  createRoot(document.getElementById("root")!).render(<StrictMode><Crash where="studio" full><App /></Crash></StrictMode>);
});
