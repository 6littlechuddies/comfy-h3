// "Final size" in Create and Edit: as made (~2 MP) or 4K (enlarged ×2 by the NVIDIA upscaler at the end of the same job)
import { Chip } from "./Workspace";
import { setFourK, useFourK } from "../lib/fourk";
import { rtxInstalled } from "../lib/downloads";

export function FourKChip() {
  const on = useFourK((s) => s.on);
  if (rtxInstalled() === false) return null;
  return <Chip title="Final size — 4K: every result enlarged ×2 by the NVIDIA upscaler at the end of its job (1088×1920 → 2176×3840), a second or two more" value={on ? 1 : 0} onChange={(v) => setFourK(v === 1)}
    options={[{ value: 0, label: "Final: as made" }, { value: 1, label: "Final: 4K" }]} />;
}
