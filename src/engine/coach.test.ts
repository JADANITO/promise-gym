import { describe, expect, it } from 'vitest';
import { rulesReport, type WeekStats } from './coach';

const base: WeekStats = {
  weekStart: '2026-10-27', weekEnd: '2026-11-02', workoutsDone: 5, workoutsPlanned: 5, trainingBlock: 'Training block 1, week 1',
  deloadDue: false, rampUp: false, exercises: [], nutritionPhase: null,
  body: { weight: 74, bodyFatEstimate: 14, waistChangeSincePhaseStartCm: 0, goalWeight: 82.5, goalBodyFat: 12 },
  calories: { target: 3000, maintenanceEstimate: 2700, average: 3000, daysLogged: 7 },
  protein: { target: 150, average: 150, daysLogged: 7, daysHit: 7 },
  recovery: { avgSleepHours: null, nightsLogged: 0, nightsUnder6h: 0 },
  volume: [], promisesKept: { kept: 10, total: 10 }, notes: [],
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
