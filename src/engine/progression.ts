import type { LoggedExercise, LoggedSet, ProgressionBasis, TemplateExercise, WorkoutSession } from '../types';

/**
 * Double progression, per exercise.
 *
 * The current state is never stored directly: it is rebuilt by replaying every
 * non-deload session in order. That way editing or deleting a past session,
 * or logging two sessions in one day, always yields the correct state.
 */

export interface ProgressState {
  weight: number;
  target: number;
  increaseDue: boolean;
  failedCount: number;
  flagged: boolean;
  sessions: number;
  lastIncreaseAt?: number;
  last?: {
    at: number;
    weight: number;
    target: number;
    achieved: number;
    reps: number[];
    repMin: number;
    repMax: number;
  };
}

export type Outcome = 'increase' | 'progressed' | 'repeat' | 'failed' | 'none';

export function workingSets(sets: LoggedSet[]): LoggedSet[] {
  return sets.filter(s => !s.warmup && s.completed);
}

/** The single rep number a session is judged on. Null when no working set was completed. */
export function achievedReps(sets: LoggedSet[], basis: ProgressionBasis): number | null {
  const ws = workingSets(sets);
  if (ws.length === 0) return null;
  const reps = ws.map(s => s.reps);
  if (basis === 'first') return reps[0];
  if (basis === 'average') return Math.floor(reps.reduce((a, b) => a + b, 0) / reps.length);
  return Math.min(...reps);
}

export function initialState(startWeight: number, repMin: number): ProgressState {
  return { weight: startWeight, target: repMin, increaseDue: false, failedCount: 0, flagged: false, sessions: 0 };
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** Classify one performance against the rules in the brief (section 5.1). */
export function evaluate(target: number, achieved: number, repMin: number, repMax: number): Outcome {
  if (achieved >= repMax) return 'increase';
  if (achieved >= target) return 'progressed';
  if (achieved >= repMin) return 'repeat';
  return 'failed';
}

export function applySession(
  prev: ProgressState,
  le: LoggedExercise,
  at: number,
  basis: ProgressionBasis,
): { state: ProgressState; outcome: Outcome } {
  if (le.skipped || !le.countsForProgression) return { state: prev, outcome: 'none' };
  const achieved = achievedReps(le.sets, basis);
  if (achieved === null) return { state: prev, outcome: 'none' };

  const { repMin, repMax } = le;
  const target = clamp(le.targetReps, repMin, repMax);
  const weight = le.workingWeight;
  const outcome = evaluate(target, achieved, repMin, repMax);
  const weightWentUp = prev.sessions > 0 && weight > prev.weight;

  const next: ProgressState = {
    weight,
    target,
    increaseDue: false,
    failedCount: 0,
    flagged: false,
    sessions: prev.sessions + 1,
    lastIncreaseAt: weightWentUp ? at : prev.lastIncreaseAt,
    last: {
      at,
      weight,
      target,
      achieved,
      reps: workingSets(le.sets).map(s => s.reps),
      repMin,
      repMax,
    },
  };

  switch (outcome) {
    case 'increase':
      next.target = repMax;
      next.increaseDue = true;
      break;
    case 'progressed':
      // During the return-to-training ramp, muscle memory lets you climb two reps at a time.
      next.target = Math.min(achieved + (le.ramp ? 2 : 1), repMax);
      break;
    case 'repeat':
      next.target = target;
      break;
    case 'failed':
      next.target = target;
      next.failedCount = prev.failedCount + 1;
      next.flagged = next.failedCount >= 2;
      break;
  }
  return { state: next, outcome };
}

/** Replay history to get the current state of one exercise. */
export function computeProgress(
  exerciseId: string,
  sessions: WorkoutSession[],
  basis: ProgressionBasis,
  startWeight: number,
  repMin: number,
): ProgressState {
  let state = initialState(startWeight, repMin);
  const ordered = sessions.filter(s => !s.deload).sort((a, b) => a.startedAt - b.startedAt);
  for (const s of ordered) {
    for (const le of s.exercises) {
      if (le.exerciseId !== exerciseId) continue;
      state = applySession(state, le, s.startedAt, basis).state;
    }
  }
  return state;
}

export interface ExercisePlan {
  weight: number;
  target: number;
  increaseDue: boolean;
  flagged: boolean;
  reason: string;
}

export type WeightFormatter = (kg: number) => string;
const defaultFmt: WeightFormatter = kg => `${+kg.toFixed(2)}kg`;

/** What to show for an exercise when a workout starts. */
export function planExercise(
  state: ProgressState,
  te: Pick<TemplateExercise, 'repMin' | 'repMax' | 'startWeight'>,
  opts: { holdTargets?: boolean; fmt?: WeightFormatter } = {},
): ExercisePlan {
  const fmt = opts.fmt ?? defaultFmt;
  const { repMin, repMax } = te;
  const last = state.last;

  if (!last) {
    return {
      weight: te.startWeight,
      target: repMin,
      increaseDue: false,
      flagged: false,
      reason: `First session — start at the bottom of the range (${repMin} reps).`,
    };
  }

  if (last.repMin !== repMin || last.repMax !== repMax) {
    return {
      weight: state.weight,
      target: repMin,
      increaseDue: false,
      flagged: false,
      reason: `Rep range changed to ${repMin}–${repMax} — target reset to ${repMin} at ${fmt(state.weight)}.`,
    };
  }

  if (opts.holdTargets) {
    return {
      weight: last.weight,
      target: last.target,
      increaseDue: false,
      flagged: state.flagged,
      reason: `Back after a break — repeating last session's target of ${last.target} at ${fmt(last.weight)}.`,
    };
  }

  if (state.increaseDue) {
    return {
      weight: state.weight,
      target: repMax,
      increaseDue: true,
      flagged: false,
      reason: `You hit ${last.achieved} reps at ${fmt(last.weight)} — the top of your range. Increase the weight today.`,
    };
  }

  let reason: string;
  if (state.failedCount > 0) {
    reason = `Last session you hit ${last.achieved} at ${fmt(last.weight)}, below your ${repMin}-rep minimum. Same weight, target ${state.target}.`;
    if (state.flagged) reason += ` That's ${state.failedCount} sessions in a row — check the coach's advice.`;
  } else if (last.achieved < last.target) {
    reason = `Last session you hit ${last.achieved} of ${last.target} at ${fmt(last.weight)} — same target again today.`;
  } else {
    reason = `Last session you hit ${last.achieved} reps at ${fmt(last.weight)} → today's target is ${state.target}.`;
  }
  return { weight: state.weight, target: state.target, increaseDue: false, flagged: state.flagged, reason };
}

/** Target after the user enters a weight for an exercise that was due an increase. */
export function targetAfterIncrease(newWeight: number, oldWeight: number, repMin: number, repMax: number): number {
  return newWeight > oldWeight ? repMin : repMax;
}

/** Epley estimated one-rep max. */
export const e1rm = (weight: number, reps: number) => (reps <= 0 ? 0 : weight * (1 + reps / 30));
