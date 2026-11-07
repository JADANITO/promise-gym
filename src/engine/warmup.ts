/**
 * Warm-up ramps and plate maths for the first big lift of a session.
 * 'barbell' = the number is the total on a bar; 'per-side' = the number is what goes on each side.
 */
export type Loading = 'barbell' | 'per-side';

export interface WarmupStep {
  weight: number;
  reps: number;
}

const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

const round = (n: number, step: number) => Math.round(n / step) * step;

/**
 * Ramp to the working weight without tiring you out: more reps when light, fewer as it gets heavy.
 * Barbell lifts start with the empty bar; steps that land on the same weight are merged.
 */
export function warmupRamp(working: number, opts: { loading?: Loading; barKg?: number; rounding?: number } = {}): WarmupStep[] {
  const { loading, barKg = 20, rounding = 2.5 } = opts;
  if (working <= 0) return [];
  const floor = loading === 'barbell' ? barKg : 0;
  const steps: WarmupStep[] = [];
  if (loading === 'barbell' && working > barKg * 1.5) steps.push({ weight: barKg, reps: 10 });
  const pcts: [number, number][] = working >= 60 || loading === 'barbell' ? [[0.5, 8], [0.7, 4], [0.85, 2]] : [[0.5, 8], [0.75, 4]];
  for (const [pct, reps] of pcts) {
    const w = Math.max(floor, round(working * pct, rounding));
    if (w <= 0 || w >= working) continue;
    if (steps.length && steps[steps.length - 1].weight >= w) continue;
    steps.push({ weight: w, reps });
  }
  return steps;
}

/** Plates for one side, biggest first. Whatever can't be made from standard plates is reported as leftover. */
export function platesPerSide(perSide: number): { plates: number[]; leftover: number } {
  const plates: number[] = [];
  let left = Math.round(perSide * 100) / 100;
  for (const p of PLATES) {
    while (left >= p - 1e-9) {
      plates.push(p);
      left = Math.round((left - p) * 100) / 100;
    }
  }
  return { plates, leftover: left };
}

/** "20kg bar + 20 + 2.5 each side" / "25 + 25 + 25 + 10 each side". */
export function loadingText(weight: number, loading: Loading | undefined, barKg = 20): string | null {
  if (!loading || weight <= 0) return null;
  const perSide = loading === 'barbell' ? (weight - barKg) / 2 : weight;
  if (perSide < 0) return `Lighter than the ${barKg}kg bar`;
  const { plates, leftover } = platesPerSide(perSide);
  const extra = leftover > 0 ? ` (+${leftover} that standard plates can't make)` : '';
  if (!plates.length) return loading === 'barbell' ? `Bar only (${barKg}kg)${extra}` : `No plates${extra}`;
  const side = `${plates.join(' + ')} each side`;
  return loading === 'barbell' ? `${barKg}kg bar + ${side}${extra}` : `${side}${extra}`;
}
