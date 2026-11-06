import type { Exercise, Muscle } from '../types';

/** Rough timings: a hard set, moving between exercises, and a warm-up set with its short rest. */
export const SET_SEC = 45;
export const SETUP_SEC = 60;
export const WARMUP_SEC = 60;
export const SUPERSET_SWITCH_SEC = 15;
const ARM_MUSCLES: Muscle[] = ['biceps', 'triceps', 'forearms'];

/** Big multi-joint lifts are protected when time is short; isolation work is trimmed first. */
export function isCompound(ex: Pick<Exercise, 'primary' | 'secondary'> | undefined): boolean {
  if (!ex?.primary?.length) return false;
  if (ex.secondary?.length) return true;
  return ex.primary.length >= 2 && !ex.primary.every(m => ARM_MUSCLES.includes(m));
}

export interface CutItem {
  id: string;
  name: string;
  restSec: number;
  setsLeft: number;
  warmupsLeft: number;
  compound: boolean;
  primary: Muscle[];
  isAbs: boolean;
  started: boolean;
  pairWith?: string;
  skip?: boolean;
}

/** Estimated seconds for what's left. Supersetted pairs share one rest per round. */
export function estimateSec(items: CutItem[]): number {
  let sec = 0;
  const seen = new Set<string>();
  for (const it of items) {
    if (it.skip || seen.has(it.id)) continue;
    const partner = it.pairWith ? items.find(x => x.id === it.pairWith && !x.skip) : undefined;
    if (partner) {
      seen.add(partner.id);
      const rounds = Math.max(it.setsLeft, partner.setsLeft);
      sec += SETUP_SEC * 2 + (it.setsLeft + partner.setsLeft) * SET_SEC + rounds * (Math.max(it.restSec, partner.restSec) + SUPERSET_SWITCH_SEC);
      continue;
    }
    if (it.setsLeft + it.warmupsLeft === 0) continue;
    sec += SETUP_SEC + it.warmupsLeft * WARMUP_SEC + it.setsLeft * (SET_SEC + it.restSec);
  }
  return sec;
}

export interface CutPlan {
  items: CutItem[];
  beforeMin: number;
  afterMin: number;
  changes: string[];
  fits: boolean;
}

/**
 * Fit what's left of a session into `minutes`, in order of least cost to progress:
 * 1. superset non-competing isolation exercises, 2. shorten isolation rest to 60s,
 * 3. drop the last set of isolations (from the end), 4. drop isolations entirely (abs last).
 * Compounds are never touched.
 */
export function planTimeCut(input: CutItem[], minutes: number): CutPlan {
  const items = input.map(i => ({ ...i }));
  const budget = minutes * 60;
  const beforeMin = Math.round(estimateSec(items) / 60);
  const over = () => estimateSec(items) > budget;
  const iso = () => items.filter(i => !i.compound && !i.skip && !i.started);

  if (over()) {
    // 1. Supersets: adjacent isolation exercises that don't share a muscle.
    const pool = iso().filter(i => !i.pairWith);
    for (let k = 0; k + 1 < pool.length && over(); k++) {
      const a = pool[k], b = pool[k + 1];
      if (a.pairWith || b.pairWith || a.primary.some(m => b.primary.includes(m))) continue;
      a.pairWith = b.id; b.pairWith = a.id;
      k++;
    }
  }
  // 2. Shorter rest on isolation work.
  if (over()) iso().forEach(i => { if (i.restSec > 60) i.restSec = 60; });
  // 3–4. Fewer isolation sets, working back from the end of the session (abs last): 2 sets, then 1.
  const byPriority = () => [...iso()].reverse().sort((a, b) => Number(a.isAbs) - Number(b.isAbs));
  for (const floor of [2, 1]) {
    for (const it of byPriority()) {
      if (!over()) break;
      if (it.setsLeft > floor) it.setsLeft = floor;
    }
  }
  // 5. Only then drop isolation exercises entirely.
  for (const it of byPriority()) {
    if (!over()) break;
    it.skip = true;
    if (it.pairWith) {
      const partner = items.find(x => x.id === it.pairWith);
      if (partner) partner.pairWith = undefined;
      it.pairWith = undefined;
    }
  }

  // Describe the end result, not every intermediate step.
  const changes: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const was = input.find(i => i.id === it.id)!;
    if (it.skip && !was.skip) { changes.push(`Skip ${it.name}`); continue; }
    if (it.pairWith && !was.pairWith && !seen.has(it.id)) {
      const partner = items.find(x => x.id === it.pairWith)!;
      seen.add(partner.id);
      changes.push(`Superset ${it.name} + ${partner.name}`);
    }
    if (it.setsLeft < was.setsLeft) changes.push(`${it.name}: ${it.setsLeft} set${it.setsLeft > 1 ? 's' : ''}`);
  }
  if (items.some(it => !it.skip && it.restSec < (input.find(i => i.id === it.id)?.restSec ?? 0))) changes.push('Rest 60s on isolation work');
  const afterMin = Math.round(estimateSec(items) / 60);
  return { items, beforeMin, afterMin, changes, fits: afterMin <= minutes };
}
