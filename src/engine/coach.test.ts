import { describe, expect, it } from 'vitest';
import { rulesReport, type WeekStats } from './coach';

const base: WeekStats = {
  weekStart: '2026-10-27', weekEnd: '2026-11-02', workoutsDone: 5, workoutsPlanned: 5, trainingBlock: 'Training block 1, week 1',
  deloadDue: false, rampUp: false, exercises: [], nutritionPhase: null,
  body: { weight: 74, bodyFatEstimate: 14, waistChangeSincePhaseStartCm: 0, goalWeight: 82.5, goalBodyFat: 12 },
  calories: { target: 3000, maintenanceEstimate: 2700, average: 3000, daysLogged: 7 },
  protein: { target: 150, average: 150, daysLogged: 7, daysHit: 7 },
  recovery: { avgSleepHours: null, nightsLogged: 0, nightsUnder6h: 0 },
  volume: [], promisesKept: { kept: 10, total: 10 }, disruptions: [], weeksOnProgram: 1, tape: null, notes: [],
};

describe('sleep coaching', () => {
  it('flags short sleep in hours', () => {
    const r = rulesReport({ ...base, recovery: { avgSleepHours: 6.2, nightsLogged: 6, nightsUnder6h: 2 } });
    expect(r.changes.join(' ')).toContain('Sleep averaged 6.2h with 2 nights under 6h');
  });
  it('praises consistently good sleep', () => {
    const r = rulesReport({ ...base, recovery: { avgSleepHours: 7.8, nightsLogged: 7, nightsUnder6h: 0 } });
    expect(r.wins.join(' ')).toContain('7.8h');
    expect(r.changes.join(' ')).not.toContain('Sleep averaged');
  });
  it('says nothing when sleep is not logged', () => {
    const r = rulesReport(base);
    expect([...r.wins, ...r.changes].join(' ')).not.toMatch(/sleep/i);
  });
});

describe('time off', () => {
  it('tells you not to compensate after illness and skips missed-workout nagging', () => {
    const r = rulesReport({ ...base, workoutsDone: 2, disruptions: ['Ill 3 days'] });
    expect(r.changes[0]).toContain('Ill 3 days');
    expect(r.changes.join(' ')).not.toContain('You trained 2 of 5');
  });
});

describe('specialisation', () => {
  const volume = [
    { muscle: 'Side delts', sets: 10.5, range: [10, 20] as [number, number] },
    { muscle: 'Rear delts', sets: 9, range: [10, 20] as [number, number] },
    { muscle: 'Biceps', sets: 15, range: [10, 20] as [number, number] },
  ];
  it('suggests extra volume for the weakest fast-recovering muscle after 8 solid weeks', () => {
    const r = rulesReport({ ...base, weeksOnProgram: 9, volume });
    expect(r.changes.join(' ')).toContain('Rear delts is at 9 sets');
  });
  it('waits until you have 8 weeks in', () => {
    expect(rulesReport({ ...base, weeksOnProgram: 3, volume }).changes.join(' ')).not.toContain('specialisation');
  });
});

describe('tape measurements', () => {
  const bulk = { type: 'bulk', week: 6, targetRateKgPerWeek: 0.35, actualRateKgPerWeek: 0.3, status: 'on-track', advice: '' };
  it('arms and chest up with a steady waist reads as muscle', () => {
    const r = rulesReport({ ...base, nutritionPhase: bulk, tape: { weeks: 4, fresh: true, arm: 0.8, chest: 1.2, shoulders: 0.5, thigh: 0.6, waist: 0.4 } });
    expect(r.wins.join(' ')).toContain("that's muscle");
  });
  it('a growing waist without arm or chest gains reads as fat', () => {
    const r = rulesReport({ ...base, nutritionPhase: bulk, tape: { weeks: 4, fresh: true, arm: 0.1, chest: 0.2, shoulders: 0, thigh: 0.3, waist: 2 } });
    expect(r.changes.join(' ')).toContain('mostly fat');
  });
  it('stays quiet in weeks without a new measurement', () => {
    const r = rulesReport({ ...base, nutritionPhase: bulk, tape: { weeks: 4, fresh: false, arm: 0.8, chest: 1.2, shoulders: 0, thigh: 0, waist: 0 } });
    expect(r.wins.join(' ')).not.toContain('Tape');
  });
});
