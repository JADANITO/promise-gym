import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from './store';
import { plannedFor } from '../engine/schedule';

const at = (date: string, hour = 18) => vi.setSystemTime(new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`));
const S = () => useStore.getState();
const tpl = (name: string) => S().templates.find(t => t.name === name && !t.archived)!;
const activeEx = (exerciseId: string) => S().active!.session.exercises.find(e => e.exerciseId === exerciseId)!;
const working = (exerciseId: string) => activeEx(exerciseId).sets.filter(s => !s.warmup);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-11-09'); // a Monday
  S().resetAll();
  S().setSettings({ onboarded: true });
  S().loadProgram();
});
afterEach(() => vi.useRealTimers());

describe('your program', () => {
  it('loads Upper Mon, Lower Tue, Pull Thu, Push Fri, Legs Sat', () => {
    expect(S().settings.schedule.map(id => S().templates.find(t => t.id === id)?.name ?? '-')).toEqual(['-', 'Upper', 'Lower', '-', 'Pull', 'Push', 'Legs']);
    expect(S().settings.basis).toBe('first');
  });

  it('carries over your logged numbers and plans per-set targets that expect the drop-off', () => {
    S().startWorkout(tpl('Upper').id, false);
    // Assisted pull-up: 14kg assist, last 8,7,6 in 8–10 → set 1 aims for 9, then 8, 7.
    const pull = activeEx('assisted-wide-grip-pull-up');
    expect(pull.kind).toBe('assisted');
    expect(pull.workingWeight).toBe(14);
    expect(working('assisted-wide-grip-pull-up').map(s => s.targetReps)).toEqual([9, 8, 7]);
    // Exercises whose old range didn't match start fresh.
    expect(activeEx('45-incline-barbell-press').firstWeight).toBe(true);
    expect(activeEx('decline-cable-fly').station).toBe('small');
  });

  it('re-aims later sets once set 1 is logged', () => {
    S().startWorkout(tpl('Upper').id, false);
    const row = activeEx('chest-supported-machine-row'); // 50kg, last 9,8,7 → drops 1,2
    const [s1] = working(row.exerciseId);
    S().updateActive(a => { a.session.exercises.find(e => e.id === row.id)!.sets.find(s => s.id === s1.id)!.reps = 8; });
    S().completeSet(row.id, s1.id);
    expect(working(row.exerciseId).map(s => s.targetReps)).toEqual([10, 7, 6]);
  });

  it('myo-rep match: later sets match set 1', () => {
    S().startWorkout(tpl('Push').id, false);
    const lat = activeEx('seated-db-lateral-raise');
    S().setIncreaseWeight(lat.id, 8);
    const [s1] = working(lat.exerciseId);
    S().updateActive(a => { a.session.exercises.find(e => e.id === lat.id)!.sets.find(s => s.id === s1.id)!.reps = 14; });
    S().completeSet(lat.id, s1.id);
    expect(working(lat.exerciseId).slice(1).map(s => s.targetReps)).toEqual([14, 14]);
  });

  it('big and small cables keep separate weights', () => {
    S().startWorkout(tpl('Pull').id, false);
    const curl = activeEx('rope-hammer-curl');
    expect(curl.workingWeight).toBe(23.75);
    S().setStation(curl.id, 'big');
    expect(activeEx('rope-hammer-curl').station).toBe('big');
    expect(activeEx('rope-hammer-curl').firstWeight).toBe(true);
  });

  it('first leg session back is 2 sets during the ramp', () => {
    S().setSettings({ rampUntil: '2026-11-30' });
    S().startWorkout(tpl('Lower').id, false);
    expect(working('back-squat')).toHaveLength(2);
    expect(working('cable-crunch')).toHaveLength(3);
  });
});

describe('swapping an exercise with a later day', () => {
  it('trades this week only, then reverts', () => {
    S().startWorkout(tpl('Upper').id, false);
    const fly = activeEx('decline-cable-fly');
    const pecDeck = S().swapOptions().find(o => o.te.exerciseId === 'pec-deck' && o.templateName === 'Push')!;
    expect(pecDeck.date).toBe('2026-11-13');
    S().swapAcrossWeek(fly.id, pecDeck);
    expect(activeEx('pec-deck').swappedFrom).toBe('Push (Fri)');
    S().discardWorkout();

    at('2026-11-13');
    S().startWorkout(tpl('Push').id, false);
    expect(S().active!.session.exercises.some(e => e.exerciseId === 'decline-cable-fly')).toBe(true);
    expect(S().active!.session.exercises.some(e => e.exerciseId === 'pec-deck')).toBe(false);
    S().discardWorkout();

    at('2026-11-20');
    S().startWorkout(tpl('Push').id, false);
    expect(S().active!.session.exercises.some(e => e.exerciseId === 'pec-deck')).toBe(true);
  });
});

describe('assisted pull-ups', () => {
  it('switch to bodyweight pull-ups when assistance reaches zero', () => {
    S().startWorkout(tpl('Upper').id, false);
    const pull = activeEx('assisted-wide-grip-pull-up');
    S().applyWeight(pull.id, 0, 'working');
    for (const s of working(pull.exerciseId)) S().completeSet(pull.id, s.id);
    S().finishWorkout({ saveToTemplate: false });
    const te = tpl('Upper').exercises.find(e => e.exerciseId === 'wide-grip-pull-up');
    expect(te).toBeTruthy();
    expect(te!.startWeight).toBe(0);
    expect(S().exercise('wide-grip-pull-up')?.kind).toBe('bodyweight');
  });
});

describe('days off', () => {
  it('ill for 3 days: those days are rest and plan timelines move back', () => {
    S().startNutritionPhase('bulk', 0.35, 'test', 74);
    const phaseStart = S().currentNutritionPhase()!.startDate;
    S().addLifeEvent({ type: 'ill', from: '2026-11-09', to: '2026-11-11' });
    expect(plannedFor(S().settings, '2026-11-10', S().lifeEvents)).toBeNull();
    expect(S().currentNutritionPhase()!.startDate > phaseStart).toBe(true);
  });

  it('away today: offers to move the session to the next rest day', () => {
    const moved = S().addLifeEvent({ type: 'away', from: '2026-11-09', to: '2026-11-09' }, { moveToday: true });
    expect(moved).toBe('2026-11-11'); // Wednesday
    expect(plannedFor(S().settings, '2026-11-11', S().lifeEvents)).toBe(tpl('Upper').id);
  });
});

describe('warm-ups, later and short on time', () => {
  it('leg press (85kg per side) gets a warm-up ramp', () => {
    S().startWorkout(tpl('Legs').id, false);
    const warm = activeEx('leg-press').sets.filter(s => s.warmup);
    expect(warm.map(s => s.weight)).toEqual([42.5, 60, 72.5]);
  });

  it('incline press warm-ups appear once you pick the working weight', () => {
    S().startWorkout(tpl('Upper').id, false);
    const press = activeEx('45-incline-barbell-press');
    expect(press.sets.filter(s => s.warmup)).toHaveLength(0);
    S().setIncreaseWeight(press.id, 70);
    expect(activeEx(press.exerciseId).sets.filter(s => s.warmup).map(s => s.weight)).toEqual([20, 35, 50, 60]);
  });

  it('"Later" moves an exercise to the end', () => {
    S().startWorkout(tpl('Push').id, false);
    const pec = activeEx('pec-deck');
    S().doLater(pec.id);
    const list = S().active!.session.exercises;
    expect(list[list.length - 1].id).toBe(pec.id);
  });

  it('short on time keeps compounds whole and pairs isolations next to each other', () => {
    S().startWorkout(tpl('Push').id, false);
    const plan = S().applyTimeCut(45)!;
    expect(plan.afterMin).toBeLessThanOrEqual(45);
    const list = S().active!.session.exercises;
    expect(working('incline-db-press')).toHaveLength(3);
    for (const e of list.filter(x => x.pairWith)) {
      const i = list.indexOf(e), j = list.findIndex(x => x.id === e.pairWith);
      expect(Math.abs(i - j)).toBe(1);
    }
  });
});

describe('fixing the start', () => {
  it('corrects the starting waist without changing the body fat estimate', () => {
    S().setProfile({ heightCm: 181, baseline: { date: '2026-11-09', weight: 74, bodyFat: 14, waistCm: 81.28 } });
    S().addMeasurement({ date: '2026-11-09', waistCm: 81.28 });
    S().startNutritionPhase('bulk', 0.3, 'test', 74, 81.28);
    S().correctStartingWaist(80.01);
    expect(S().profile.baseline!.waistCm).toBe(80.01);
    expect(S().measurements.find(m => m.date === '2026-11-09')!.waistCm).toBe(80.01);
    expect(S().currentNutritionPhase()!.startWaistCm).toBe(80.01);
    expect(S().profile.baseline!.bodyFat).toBe(14);
  });

  it('start week 1 today restarts the phase, block and program dates', () => {
    at('2026-11-02');
    S().startNutritionPhase('bulk', 0.3, 'test', 74);
    S().setSettings({ rampUntil: '2026-11-23', programLoadedOn: '2026-11-02' });
    at('2026-11-09');
    S().restartFromToday();
    expect(S().currentNutritionPhase()!.startDate).toBe('2026-11-09');
    expect(S().settings.programLoadedOn).toBe('2026-11-09');
    expect(S().settings.rampUntil).toBe('2026-11-30');
  });
});
