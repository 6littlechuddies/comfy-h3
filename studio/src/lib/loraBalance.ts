// Balancing a LoRA stack. Strengths add up, and past a point every model smears (patchy, watercolour-like, lost detail) —
// Krea 2 Turbo (8 steps) first. The usual practice: one lead LoRA (the character) at ~0.8–1.0, the others as support at
// ~0.3–0.6, and sliders (one attribute each, signed strength, trained to move only that) left out of the count.
// We start from each creator's recommended strength (read from the LoRA's description) when there is one.
import type { LoraInfo } from "./api";
import type { LoraPick } from "./graphs";

export type Role = "slider" | "character" | "style" | "detail" | "concept";
export const ROLE_LABEL: Record<Role, string> = { slider: "slider", character: "character", style: "style", detail: "detail", concept: "concept" };

/** how much each model holds in total (sliders not counted) before it smears; kreaEdit = on top of the identity-edit LoRA */
export const BUDGET = { krea2: 1.4, anima: 2.0, sdxl: 2.2, h3: 1.8, kreaEdit: 0.9 } as const;
export type BudgetKey = keyof typeof BUDGET;

export function roleOf(l: LoraPick, inf?: LoraInfo): Role {
  const r = inf?.role as Role | undefined;
  if (r) return r;
  return /slider/i.test(`${l.name} ${inf?.title ?? ""}`) ? "slider" : "concept";
}
const on = (l: LoraPick) => !l.off && l.strength !== 0;

/** the stack's total strength, sliders left out */
export function stackTotal(ls: LoraPick[], lib: LoraInfo[] = []): number {
  const info = (n: string) => lib.find((x) => x.name === n);
  return Math.round(ls.filter(on).filter((l) => roleOf(l, info(l.name)) !== "slider").reduce((a, l) => a + Math.abs(l.strength), 0) * 100) / 100;
}

const r05 = (x: number) => Math.round(x * 20) / 20;

/** fit the stack into the budget: the character (or the strongest) leads at its recommended strength (max 1.0), the rest
 *  share what's left in proportion to their recommended strengths (never below 0.2); sliders untouched */
export function balanceLoras(ls: LoraPick[], lib: LoraInfo[], budget: number): { loras: LoraPick[]; changed: string[] } {
  const info = (n: string) => lib.find((x) => x.name === n);
  const rest = ls.filter(on).filter((l) => roleOf(l, info(l.name)) !== "slider");
  if (stackTotal(ls, lib) <= budget + 0.001 || !rest.length) return { loras: ls, changed: [] };
  const rec = (l: LoraPick) => Math.min(1.2, Math.max(0.2, info(l.name)?.tips?.weight ?? Math.abs(l.strength)));
  const lead = rest.find((l) => roleOf(l, info(l.name)) === "character") ?? [...rest].sort((a, b) => rec(b) - rec(a))[0];
  const others = rest.filter((l) => l !== lead);
  let leadS = Math.min(rec(lead), 1.0);
  const floor = 0.2;
  if (leadS + others.length * floor > budget) leadS = Math.max(0.4, budget - others.length * floor);
  const room = Math.max(others.length * floor, budget - leadS);
  const sum = others.reduce((a, l) => a + rec(l), 0) || 1;
  const k = Math.min(1, room / sum);
  const target = new Map<string, number>([[lead.name, r05(leadS)], ...others.map((l) => [l.name, r05(Math.max(floor, rec(l) * k))] as [string, number])]);
  const changed: string[] = [];
  const loras = ls.map((l) => {
    const t = target.get(l.name);
    if (t == null || !on(l)) return l;
    const s = Math.sign(l.strength || 1) * t;
    if (Math.abs(s - l.strength) >= 0.05) changed.push(`${(info(l.name)?.title ?? l.name).replace(/\.safetensors$/, "")} ${l.strength.toFixed(2)}→${s.toFixed(2)}`);
    return { ...l, strength: s };
  });
  return { loras, changed };
}
