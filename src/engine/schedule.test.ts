import { describe, expect, it } from 'vitest';
import { buildProgram } from '../data/program';
import { BUILT_IN_EXERCISES, TRACKED_MUSCLES } from '../data/library';
import type { WorkoutSession } from '../types';
import { plannedFor, promisesFor, setsPerMuscle, volumeRange, weekPlan } from './schedule';
import { parseYmd } from './dates';

const { templates, schedule } = buildProgram();
const settings = { schedule, scheduleOverrides: {} as Record<string, string | null> };
const byName = (n: string) => templates.find(t => t.name === n)!.id;

function fullSession(templateId: string, date: string): WorkoutSession {
  const t = templates.find(x => x.id === templateId)!;
  return {
    id: date + templateId, templateId, templateName: t.name, startedAt: parseYmd(date).getTime() + 18 * 3_600_000, phaseId: 'p', deload: false,
    exercises: t.exercises.map(te => ({
      id: te.id, exerciseId: te.exerciseId, repMin: te.repMin, repMax: te.repMax, restSec: te.restSec, workingWeight: 20, targetReps: te.repMin,
      increasePrompted: false, countsForProgression: true, skipped: false,
      sets: Array.from({ length: te.sets }, (_, i) => ({ id: `${i}`, weight: 20, targetReps: te.repMin, reps: te.repMin, completed: true, warmup: false })),
    })),
  };
}

describe('weekly split', () => {
  it('maps Upper Mon, Lower Tue, rest Wed, Pull Thu, Push Fri, Legs Sat, rest Sun', () => {
    // 2026-11-02 is a Monday
    expect(plannedFor(settings, '2026-11-02')).toBe(byName('Upper'));
    expect(plannedFor(settings, '2026-11-03')).toBe(byName('Lower'));
    expect(plannedFor(settings, '2026-11-04')).toBeNull();
    expect(plannedFor(settings, '2026-11-05')).toBe(byName('Pull'));
    expect(plannedFor(settings, '2026-11-06')).toBe(byName('Push'));
    expect(plannedFor(settings, '2026-11-07')).toBe(byName('Legs'));
    expect(plannedFor(settings, '2026-11-08')).toBeNull();
  });

  it('one-off overrides move a session', () => {
    const moved = { schedule, scheduleOverrides: { '2026-11-04': byName('Pull'), '2026-11-05': null } };
    expect(plannedFor(moved, '2026-11-04')).toBe(byName('Pull'));
    expect(plannedFor(moved, '2026-11-05')).toBeNull();
  });

  it('marks missed, done and upcoming days', () => {
    const plan = weekPlan(settings, [fullSession(byName('Upper'), '2026-11-02')], '2026-11-04');
    expect(plan.map(d => d.status)).toEqual(['done', 'missed', 'rest', 'upcoming', 'upcoming', 'upcoming', 'rest']);
  });
});

describe('program volume', () => {
  const week = ['Upper', 'Lower', 'Pull', 'Push', 'Legs'].map((n, i) => fullSession(byName(n), `2026-11-0${[2, 3, 5, 6, 7][i]}`));
  const vol = setsPerMuscle(week, BUILT_IN_EXERCISES, '2026-11-02', '2026-11-08');
  it('prints weekly hard sets per muscle', () => {
    console.table(Object.fromEntries(TRACKED_MUSCLES.concat(['forearms', 'traps', 'front-delts'] as never[]).map(m => [m, { sets: vol[m] ?? 0, range: volumeRange(m).join('–') }])));
  });
  it('hits abs on every training day', () => {
    for (const t of templates) expect(t.exercises.some(e => BUILT_IN_EXERCISES.find(x => x.id === e.exerciseId)?.primary?.includes('abs')), t.name).toBe(true);
  });
  it('every exercise is 3 sets', () => {
    for (const t of templates) for (const e of t.exercises) expect(e.sets, e.exerciseId).toBe(3);
  });
  it('every program exercise exists in the library', () => {
    for (const t of templates) for (const e of t.exercises) expect(BUILT_IN_EXERCISES.some(x => x.id === e.exerciseId), e.exerciseId).toBe(true);
  });

  it('promises kept counts workouts and weigh-ins', () => {
    const p = promisesFor({ settings, sessions: week.slice(0, 1), checkIns: { '2026-11-02': { date: '2026-11-02', bodyweight: 74 } }, weekly: [], today: '2026-11-04', weekOf: '2026-11-04' });
    expect(p.items.find(i => i.label === 'Workouts')).toMatchObject({ kept: 1, total: 2 });
    expect(p.items.find(i => i.label === 'Weigh-ins')).toMatchObject({ kept: 1, total: 3 });
  });
});
