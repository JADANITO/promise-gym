import { describe, expect, it } from 'vitest';
import type { LoggedExercise, WorkoutSession } from '../types';
import {
  achievedReps,
  computeProgress,
  e1rm,
  planExercise,
  targetAfterIncrease,
} from './progression';

const EX = 'chest-press';
const TE = { repMin: 10, repMax: 12, startWeight: 35 };
let t = Date.UTC(2026, 0, 5, 18);

function le(weight: number, target: number, reps: number[], extra: Partial<LoggedExercise> = {}): LoggedExercise {
  return {
    id: Math.random().toString(36),
    exerciseId: EX,
    repMin: 10,
    repMax: 12,
    restSec: 90,
    workingWeight: weight,
    targetReps: target,
    increasePrompted: false,
    countsForProgression: true,
    skipped: false,
    sets: reps.map((r, i) => ({ id: `s${i}`, weight, targetReps: target, reps: r, completed: true, warmup: false })),
    ...extra,
  };
}

function session(e: LoggedExercise, extra: Partial<WorkoutSession> = {}): WorkoutSession {
  t += 3 * 86_400_000;
  return { id: Math.random().toString(36), templateId: 'push', templateName: 'Push', startedAt: t, phaseId: 'p1', deload: false, exercises: [e], ...extra };
}

/** Plan the next session from the history so far. */
const plan = (history: WorkoutSession[], basis: 'lowest' | 'first' | 'average' = 'lowest') =>
  planExercise(computeProgress(EX, history, basis, TE.startWeight, TE.repMin), TE);

describe('worked example from the brief (range 10–12)', () => {
  it('runs exactly as specified', () => {
    const h: WorkoutSession[] = [];

    // Session 1: first ever — 35kg × 10 target
    let p = plan(h);
    expect([p.weight, p.target]).toEqual([35, 10]);
    h.push(session(le(35, 10, [10, 10, 10])));

    // Session 2 target: 35kg × 11
    p = plan(h);
    expect([p.weight, p.target, p.increaseDue]).toEqual([35, 11, false]);
    expect(p.reason).toBe("Last session you hit 10 reps at 35kg → today's target is 11.");
    h.push(session(le(35, 11, [11, 11, 11])));

    // Session 3 target: 35kg × 12
    p = plan(h);
    expect([p.weight, p.target]).toEqual([35, 12]);
    h.push(session(le(35, 12, [12, 12, 12])));

    // Session 4: increase the weight; user enters 40kg → target resets to 10
    p = plan(h);
    expect(p.increaseDue).toBe(true);
    const newTarget = targetAfterIncrease(40, p.weight, 10, 12);
    expect(newTarget).toBe(10);
    h.push(session(le(40, newTarget, [8, 8, 7], { increasePrompted: true })));

    // Session 5: below min at 40kg → 40kg × 10 again, failed count = 1
    const state = computeProgress(EX, h, 'lowest', 35, 10);
    expect(state.failedCount).toBe(1);
    expect(state.flagged).toBe(false);
    p = plan(h);
    expect([p.weight, p.target, p.increaseDue]).toEqual([40, 10, false]);
    expect(state.lastIncreaseAt).toBe(h[3].startedAt);
  });
});

describe('rules', () => {
  it('target is never above the top of the range', () => {
    const p = plan([session(le(35, 11, [14, 14, 14]))]);
    expect(p.increaseDue).toBe(true);
    expect(p.target).toBe(12);
  });

  it('jumps more than one rep when you beat the target', () => {
    expect(plan([session(le(35, 10, [11, 11, 11]))]).target).toBe(12);
  });

  it('hitting max on only some sets does not trigger an increase (lowest basis)', () => {
    const p = plan([session(le(35, 12, [12, 12, 11]))]);
    expect(p.increaseDue).toBe(false);
    expect(p.target).toBe(12);
  });

  it('below target but within range repeats the same target', () => {
    const p = plan([session(le(35, 11, [10, 10, 10]))]);
    expect([p.weight, p.target]).toEqual([35, 11]);
    expect(p.reason).toContain('same target again');
  });

  it('two failed sessions in a row flags the exercise', () => {
    const h = [session(le(40, 10, [8, 8, 8])), session(le(40, 10, [9, 8, 8]))];
    const s = computeProgress(EX, h, 'lowest', 35, 10);
    expect(s.failedCount).toBe(2);
    expect(s.flagged).toBe(true);
    expect(plan(h).flagged).toBe(true);
  });

  it('a successful session resets the failure streak', () => {
    const h = [session(le(40, 10, [8, 8, 8])), session(le(40, 10, [10, 10, 10])), session(le(40, 11, [8, 8, 8]))];
    expect(computeProgress(EX, h, 'lowest', 35, 10).failedCount).toBe(1);
  });

  it('keeping the same weight when an increase was due keeps the target at max', () => {
    expect(targetAfterIncrease(35, 35, 10, 12)).toBe(12);
  });
});

describe('progression basis', () => {
  const sets = [12, 11, 10].map((r, i) => ({ id: `${i}`, weight: 35, targetReps: 11, reps: r, completed: true, warmup: false }));
  it('lowest / first / average', () => {
    expect(achievedReps(sets, 'lowest')).toBe(10);
    expect(achievedReps(sets, 'first')).toBe(12);
    expect(achievedReps(sets, 'average')).toBe(11);
  });

  it('ignores warm-up and incomplete sets', () => {
    const withWarmup = [
      { id: 'w', weight: 20, targetReps: 10, reps: 3, completed: true, warmup: true },
      { id: 'x', weight: 35, targetReps: 10, reps: 2, completed: false, warmup: false },
      ...sets,
    ];
    expect(achievedReps(withWarmup, 'lowest')).toBe(10);
  });

  it('first-set basis can trigger an increase when later sets drop', () => {
    expect(plan([session(le(35, 12, [12, 11, 10]))], 'first').increaseDue).toBe(true);
  });
});

describe('history handling', () => {
  it('deload sessions do not change progression', () => {
    const h = [session(le(35, 10, [10, 10, 10])), session(le(30, 10, [10, 10]), { deload: true })];
    const p = plan(h);
    expect([p.weight, p.target]).toEqual([35, 11]);
  });

  it('skipped exercises and declined one-off overrides do not change progression', () => {
    const h = [
      session(le(35, 10, [10, 10, 10])),
      session(le(35, 11, [], { skipped: true })),
      session(le(50, 11, [6, 6, 6], { countsForProgression: false })),
    ];
    const p = plan(h);
    expect([p.weight, p.target]).toEqual([35, 11]);
  });

  it('replays in chronological order even if stored out of order (two sessions in a day)', () => {
    const a = session(le(35, 10, [10, 10, 10]));
    const b = session(le(35, 11, [11, 11, 11]));
    b.startedAt = a.startedAt + 3_600_000;
    expect(plan([b, a]).target).toBe(12);
  });

  it('editing a past session recalculates the current state', () => {
    const s1 = session(le(35, 10, [10, 10, 10]));
    const h = [s1];
    expect(plan(h).target).toBe(11);
    s1.exercises[0].sets.forEach(s => (s.reps = 12));
    expect(plan(h).increaseDue).toBe(true);
  });

  it('a changed rep range resets the target to the new minimum at the current weight', () => {
    const h = [session(le(35, 10, [11, 11, 11]))];
    const p = planExercise(computeProgress(EX, h, 'lowest', 35, 10), { repMin: 6, repMax: 8, startWeight: 35 });
    expect([p.weight, p.target]).toEqual([35, 6]);
  });

  it('returning from a break repeats the last targets instead of progressing', () => {
    const h = [session(le(35, 11, [11, 11, 11]))];
    const p = planExercise(computeProgress(EX, h, 'lowest', 35, 10), TE, { holdTargets: true });
    expect([p.weight, p.target]).toEqual([35, 11]);
  });
});

it('Epley e1RM', () => {
  expect(e1rm(100, 10)).toBeCloseTo(133.33, 1);
  expect(e1rm(100, 0)).toBe(0);
});
