import { describe, expect, it } from 'vitest';
import type { Phase, WorkoutSession } from '../types';
import { analyzePlateau, deloadFinished, deloadPrescription, nextTemplate, phaseWeek, plateauCheckDue, returningFromBreak } from './phases';
import { movingAverage } from './stats';
import { addDays, parseYmd } from './dates';

const gaining = (start: string, extra: Partial<Phase> = {}): Phase => ({ id: 'p', type: 'gaining', number: 1, startDate: start, minWeeks: 4, status: 'active', ...extra });

describe('phases', () => {
  it('reports the phase week', () => {
    expect(phaseWeek(gaining('2026-01-05'), '2026-01-05')).toBe(1);
    expect(phaseWeek(gaining('2026-01-05'), '2026-01-25')).toBe(3);
  });

  it('asks about plateau only after the minimum weeks, then weekly after a "no"', () => {
    expect(plateauCheckDue(gaining('2026-01-05'), '2026-02-01')).toBe(false); // day 27
    expect(plateauCheckDue(gaining('2026-01-05'), '2026-02-02')).toBe(true); // day 28
    const said = gaining('2026-01-05', { lastPlateauNo: '2026-02-02' });
    expect(plateauCheckDue(said, '2026-02-08')).toBe(false);
    expect(plateauCheckDue(said, '2026-02-09')).toBe(true);
  });

  it('respects a custom minimum phase length', () => {
    expect(plateauCheckDue(gaining('2026-01-05', { minWeeks: 6 }), '2026-02-02')).toBe(false);
  });

  it('ends a deload after 7 days', () => {
    const d: Phase = { ...gaining('2026-02-02'), type: 'deload' };
    expect(deloadFinished(d, '2026-02-08')).toBe(false);
    expect(deloadFinished(d, '2026-02-09')).toBe(true);
  });

  it('deload: ~87.5% weight rounded, half the sets', () => {
    const s = { deloadWeightPct: 0.875, deloadSetFactor: 0.5, weightRounding: 2.5 };
    expect(deloadPrescription(40, 3, s)).toEqual({ weight: 35, sets: 2 });
    expect(deloadPrescription(100, 4, s)).toEqual({ weight: 87.5, sets: 2 });
    expect(deloadPrescription(10, 1, s).sets).toBe(1);
  });
});

function sess(day: string, exerciseId: string, weight: number, reps: number[], deload = false): WorkoutSession {
  return {
    id: day + exerciseId,
    templateId: 't',
    templateName: 'T',
    startedAt: parseYmd(day).getTime() + 18 * 3_600_000,
    phaseId: 'p',
    deload,
    exercises: [{
      id: 'e', exerciseId, repMin: 10, repMax: 12, restSec: 90, workingWeight: weight, targetReps: 10,
      increasePrompted: false, countsForProgression: true, skipped: false,
      sets: reps.map((r, i) => ({ id: `${i}`, weight, targetReps: 10, reps: r, completed: true, warmup: false })),
    }],
  };
}

describe('plateau analysis', () => {
  const today = '2026-02-02';
  it('recommends continuing when lifts progress', () => {
    const s = [sess('2026-01-15', 'a', 35, [10, 10]), sess('2026-01-26', 'a', 35, [11, 11]), sess('2026-02-01', 'a', 35, [12, 12])];
    const r = analyzePlateau(s, [], 'lowest', today);
    expect(r.progressedPct).toBe(100);
    expect(r.recommendDeload).toBe(false);
  });

  it('recommends a deload when lifts stall', () => {
    const s = [
      sess('2026-01-10', 'a', 40, [9, 9]), sess('2026-01-24', 'a', 40, [9, 9]), sess('2026-01-31', 'a', 40, [8, 8]),
      sess('2026-01-10', 'b', 20, [11, 11]), sess('2026-01-24', 'b', 20, [11, 11]), sess('2026-01-31', 'b', 20, [11, 10]),
    ];
    const r = analyzePlateau(s, [], 'lowest', today);
    expect(r.progressedPct).toBe(0);
    expect(r.stalled.sort()).toEqual(['a', 'b']);
    expect(r.recommendDeload).toBe(true);
  });
});

describe('rotation and breaks', () => {
  const templates = [{ id: 'a', name: 'A', exercises: [] }, { id: 'b', name: 'B', exercises: [] }];
  it('suggests the next template in order', () => {
    expect(nextTemplate(templates, [])?.id).toBe('a');
    expect(nextTemplate(templates, [{ ...sess('2026-01-01', 'x', 1, [1]), templateId: 'a' }])?.id).toBe('b');
    expect(nextTemplate(templates, [{ ...sess('2026-01-01', 'x', 1, [1]), templateId: 'b' }])?.id).toBe('a');
  });

  it('detects returning after more than a week off', () => {
    expect(returningFromBreak([sess('2026-01-01', 'x', 1, [1])], '2026-01-08')).toBe(false);
    expect(returningFromBreak([sess('2026-01-01', 'x', 1, [1])], '2026-01-09')).toBe(true);
  });
});

it('7-day moving average', () => {
  const ma = movingAverage([1, 2, 3, 4, 5, 6, 7, 8].map((v, i) => ({ date: addDays('2026-01-01', i), value: v })));
  expect(ma[6].value).toBe(4);
  expect(ma[7].value).toBe(5);
});
