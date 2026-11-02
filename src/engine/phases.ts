import type { DailyCheckIn, Phase, ProgressionBasis, Settings, WorkoutSession, WorkoutTemplate } from '../types';
import { achievedReps, computeProgress } from './progression';
import { addDays, daysBetween, ymd } from './dates';
import { calories, mean, slopePerDay, weights } from './stats';

export const DELOAD_DAYS = 7;

export function phaseWeek(phase: Phase, today: string): number {
  return Math.floor(Math.max(daysBetween(phase.startDate, today), 0) / 7) + 1;
}

export function plateauCheckDue(phase: Phase | undefined, today: string): boolean {
  if (!phase || phase.type !== 'gaining' || phase.status !== 'active') return false;
  if (daysBetween(phase.startDate, today) < phase.minWeeks * 7) return false;
  return !phase.lastPlateauNo || daysBetween(phase.lastPlateauNo, today) >= 7;
}

export function deloadFinished(phase: Phase | undefined, today: string): boolean {
  return !!phase && phase.type === 'deload' && phase.status === 'active' && daysBetween(phase.startDate, today) >= DELOAD_DAYS;
}

export function roundTo(n: number, step: number): number {
  if (step <= 0) return n;
  return Math.round(n / step) * step;
}

export function deloadPrescription(weight: number, sets: number, s: Pick<Settings, 'deloadWeightPct' | 'deloadSetFactor' | 'weightRounding'>) {
  return {
    weight: Math.max(roundTo(weight * s.deloadWeightPct, s.weightRounding), 0),
    sets: Math.max(1, Math.ceil(sets * s.deloadSetFactor)),
  };
}

interface Entry { at: number; weight: number; achieved: number; repMax: number }

function entriesFor(exerciseId: string, sessions: WorkoutSession[], basis: ProgressionBasis): Entry[] {
  const out: Entry[] = [];
  for (const s of [...sessions].filter(x => !x.deload).sort((a, b) => a.startedAt - b.startedAt)) {
    for (const le of s.exercises) {
      if (le.exerciseId !== exerciseId || le.skipped || !le.countsForProgression) continue;
      const a = achievedReps(le.sets, basis);
      if (a != null) out.push({ at: s.startedAt, weight: le.workingWeight, achieved: a, repMax: le.repMax });
    }
  }
  return out;
}

export interface PlateauAnalysis {
  total: number;
  progressed: string[];
  stalled: string[];
  progressedPct: number;
  bodyweightPerWeek: number | null;
  avgCalories: number | null;
  avgRpe: number | null;
  recommendDeload: boolean;
  recommendation: string;
}

/** Look at the last 14 days to help answer "have you plateaued?". */
export function analyzePlateau(
  sessions: WorkoutSession[],
  checkIns: DailyCheckIn[],
  basis: ProgressionBasis,
  today: string,
  windowDays = 14,
): PlateauAnalysis {
  const from = addDays(today, -(windowDays - 1));
  const inWindow = (at: number) => ymd(at) >= from;
  const ids = new Set<string>();
  sessions.filter(s => !s.deload && inWindow(s.startedAt)).forEach(s => s.exercises.forEach(e => !e.skipped && ids.add(e.exerciseId)));

  const progressed: string[] = [];
  const stalled: string[] = [];
  for (const id of ids) {
    const es = entriesFor(id, sessions, basis);
    const win = es.filter(e => inWindow(e.at));
    if (!win.length) continue;
    const before = es.filter(e => !inWindow(e.at));
    const baseline = before.length ? before[before.length - 1] : win[0];
    const latest = win[win.length - 1];
    const didProgress =
      latest.weight > baseline.weight ||
      (latest.weight === baseline.weight && latest.achieved > baseline.achieved) ||
      latest.achieved >= latest.repMax;
    if (didProgress) progressed.push(id);

    const state = computeProgress(id, sessions, basis, 0, 0);
    const lastTwo = es.slice(-2);
    const noChange = lastTwo.length === 2 && lastTwo[1].weight === lastTwo[0].weight && lastTwo[1].achieved <= lastTwo[0].achieved;
    if (state.failedCount >= 2 || (noChange && !didProgress)) stalled.push(id);
  }

  const total = ids.size;
  const progressedPct = ids.size ? Math.round((progressed.length / ids.size) * 100) : 0;
  const bw = weights(checkIns).filter(p => p.date >= from);
  const slope = bw.length >= 4 ? slopePerDay(bw) : null;
  const kcal = calories(checkIns).filter(p => p.date >= from).map(p => p.value);
  const rpes = sessions
    .filter(s => inWindow(s.startedAt))
    .flatMap(s => s.exercises.flatMap(e => e.sets.filter(x => x.completed && !x.warmup && x.rpe != null).map(x => x.rpe!)));

  const recommendDeload = ids.size > 0 && (progressedPct < 50 || stalled.length >= Math.max(2, Math.ceil(ids.size / 3)));
  return {
    total,
    progressed,
    stalled,
    progressedPct,
    bodyweightPerWeek: slope == null ? null : slope * 7,
    avgCalories: mean(kcal),
    avgRpe: mean(rpes),
    recommendDeload,
    recommendation: ids.size === 0
      ? 'Not enough training data in the last 2 weeks to judge.'
      : recommendDeload
        ? 'Looks like a plateau — deload recommended.'
        : "You're still progressing — keep going.",
  };
}

/** Suggest the template after the one trained most recently. */
export function nextTemplate(templates: WorkoutTemplate[], sessions: WorkoutSession[]): WorkoutTemplate | undefined {
  const active = templates.filter(t => !t.archived);
  if (!active.length) return undefined;
  const last = [...sessions].sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!last) return active[0];
  const i = active.findIndex(t => t.id === last.templateId);
  return active[(i + 1) % active.length];
}

/** True when it has been more than a week since the last workout. */
export function returningFromBreak(sessions: WorkoutSession[], today: string): boolean {
  if (!sessions.length) return false;
  const last = Math.max(...sessions.map(s => s.startedAt));
  return daysBetween(ymd(last), today) > 7;
}
