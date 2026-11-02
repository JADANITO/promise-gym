import { describe, expect, it } from 'vitest';
import type { DailyCheckIn, NutritionPhase, Profile } from '../types';
import {
  adaptiveMaintenance, bodyFatFromWaist, bulkRate, composition, cutRate, estimatedMaintenance, nextTargets,
  peakLean, phaseStatus, proteinTarget, recommendPhase, rfm, simulateRoadmap,
} from './body';
import { addDays } from './dates';

// The user's real numbers: 181cm, 74kg, ~14%, 32in waist; previously 83kg at ~16%; goal 82.5kg at 12%.
const profile: Profile = {
  heightCm: 181,
  baseline: { date: '2026-11-02', weight: 74, bodyFat: 14, waistCm: 81.3 },
  peak: { weight: 83, bodyFat: 16 },
  goalWeight: 82.5,
  goalBodyFat: 12,
  bulkCeiling: 16,
};
const TODAY = '2026-11-02';

const series = (days: number, start: number, perDay: number, kcal?: number): DailyCheckIn[] =>
  Array.from({ length: days }, (_, i) => ({ date: addDays(TODAY, i - days + 1), bodyweight: start + perDay * i, calories: kcal }));

describe('body fat from waist', () => {
  it('is calibrated to the baseline', () => {
    expect(bodyFatFromWaist(profile, 81.3)).toBeCloseTo(14, 5);
  });
  it('rises about 1.4% per extra inch of waist', () => {
    const plusInch = bodyFatFromWaist(profile, 81.3 + 2.54)!;
    expect(plusInch - 14).toBeGreaterThan(1.1);
    expect(plusInch - 14).toBeLessThan(1.7);
  });
  it('raw RFM without calibration', () => {
    expect(rfm(181, 81.3)).toBeCloseTo(19.47, 1);
  });
});

describe('composition', () => {
  it('uses the baseline on day one', () => {
    const c = composition(profile, [{ date: TODAY, bodyweight: 74 }], [], TODAY)!;
    expect(c.lean).toBeCloseTo(63.64, 1);
    expect(c.fat).toBeCloseTo(10.36, 1);
  });
  it('uses a recent waist measurement', () => {
    const c = composition(profile, [{ date: TODAY, bodyweight: 76 }], [{ date: TODAY, waistCm: 83 }], TODAY)!;
    expect(c.source).toBe('waist');
    expect(c.bodyFat).toBeGreaterThan(14);
  });
});

describe('muscle memory', () => {
  it('bulks faster while below previous peak lean mass', () => {
    const peak = peakLean(profile)!;
    expect(peak).toBeCloseTo(69.72, 1);
    expect(bulkRate(63.6, peak)).toMatchObject({ rate: 0.35, regaining: true });
    expect(bulkRate(70, peak)).toMatchObject({ rate: 0.25, regaining: false });
  });
});

describe('roadmap', () => {
  const start = composition(profile, [{ date: TODAY, bodyweight: 74 }], [], TODAY)!;
  const steps = simulateRoadmap(start, profile, TODAY);

  it('starts with a lean bulk, alternates with cuts and maintenance, and reaches the goal', () => {
    expect(steps[0].type).toBe('bulk');
    expect(steps[0].note).toContain('muscle memory');
    expect(steps.some(s => s.type === 'cut')).toBe(true);
    expect(steps[steps.length - 1].type).toBe('goal');
    const goal = steps[steps.length - 1];
    expect(goal.endWeight).toBeGreaterThanOrEqual(81.5);
    expect(goal.endBf).toBeLessThanOrEqual(12.8);
    // Realistic: 1–3 years, not months.
    const years = (new Date(goal.startDate).getTime() - new Date(TODAY).getTime()) / (365 * 86_400_000);
    expect(years).toBeGreaterThan(1);
    expect(years).toBeLessThan(3);
  });

  it('never bulks past the body fat ceiling by much', () => {
    for (const s of steps.filter(x => x.type === 'bulk')) expect(s.endBf).toBeLessThanOrEqual(profile.bulkCeiling + 0.6);
  });

  it('prints the plan', () => {
    console.table(steps.map(s => ({ type: s.type, from: s.startDate, to: s.endDate, weeks: s.weeks, rate: s.rate, kg: `${s.startWeight}→${s.endWeight}`, bf: `${s.startBf}→${s.endBf}` })));
  });
});

describe('nutrition targets', () => {
  it('starting estimate from lean mass', () => {
    expect(estimatedMaintenance(63.6)).toBeGreaterThan(2500);
    expect(estimatedMaintenance(63.6)).toBeLessThan(2900);
  });

  it('adaptive maintenance: flat weight on 2600 kcal means maintenance ≈ 2600', () => {
    expect(adaptiveMaintenance(series(21, 74, 0, 2600), TODAY)).toBeCloseTo(2600, -1);
  });

  it('adaptive maintenance: gaining 0.5kg/wk on 3000 kcal means maintenance ≈ 2450', () => {
    expect(adaptiveMaintenance(series(21, 74, 0.5 / 7, 3000), TODAY)).toBeCloseTo(2450, -1);
  });

  it('bulk target adds the surplus for the planned rate', () => {
    const comp = composition(profile, [{ date: TODAY, bodyweight: 74 }], [], TODAY)!;
    const t = nextTargets({ phase: { type: 'bulk', targetRate: 0.35 }, comp, checkIns: series(21, 74, 0, 2600), today: TODAY, weekStart: addDays(TODAY, 7) });
    expect(t.method).toBe('adaptive');
    expect(t.kcal).toBeCloseTo(2600 + 385, -2);
    expect(t.protein).toBe(150);
  });

  it('falls back to steering by the scale when calories are not logged', () => {
    const comp = composition(profile, [{ date: TODAY, bodyweight: 74 }], [], TODAY)!;
    const prev = { weekStart: addDays(TODAY, -6), kcal: 3000, protein: 150, maintenance: 2600, method: 'estimate' as const, note: '' };
    // Gaining 0 instead of 0.35/wk → raise maintenance estimate.
    const t = nextTargets({ phase: { type: 'bulk', targetRate: 0.35 }, comp, checkIns: series(14, 74, 0), previous: prev, today: TODAY, weekStart: addDays(TODAY, 1) });
    expect(t.method).toBe('trend');
    expect(t.maintenance).toBe(2850);
  });

  it('protein: 2g/kg in a bulk, 2.2g/kg in a cut', () => {
    expect(proteinTarget(74, 'bulk')).toBe(150);
    expect(proteinTarget(80, 'cut')).toBe(175);
  });

  it('cut rate is 0.5% of bodyweight per week', () => {
    expect(cutRate(80)).toBe(-0.4);
  });
});

describe('phase status and recommendations', () => {
  const bulk: NutritionPhase = { id: 'b', type: 'bulk', startDate: '2026-06-01', status: 'active', targetRate: 0.35, startWaistCm: 81.3 };

  it('flags a bulk that is going too fast', () => {
    const s = phaseStatus(bulk, series(14, 74, 0.8 / 7), TODAY);
    expect(s.status).toBe('fast');
    expect(s.advice).toContain('less');
  });

  it('recommends a cut when clothes get tight after the minimum weeks', () => {
    const comp = composition(profile, [{ date: TODAY, bodyweight: 79 }], [], TODAY)!;
    expect(recommendPhase({ phase: bulk, comp, profile, clothes: ['tighter', 'same', 'tighter'], today: TODAY }).action).toBe('cut');
  });

  it('keeps bulking early on even if clothes are tighter', () => {
    const early = { ...bulk, startDate: addDays(TODAY, -21) };
    const comp = composition(profile, [{ date: TODAY, bodyweight: 75 }], [], TODAY)!;
    expect(recommendPhase({ phase: early, comp, profile, clothes: ['tighter', 'tighter'], today: TODAY }).action).toBe('stay');
  });

  it('recommends maintenance once a cut reaches the goal body fat', () => {
    const cut: NutritionPhase = { id: 'c', type: 'cut', startDate: addDays(TODAY, -56), status: 'active', targetRate: -0.4 };
    const comp = { weight: 78, bodyFat: 12.2, lean: 68.5, fat: 9.5, source: 'waist' as const };
    expect(recommendPhase({ phase: cut, comp, profile, clothes: [], today: TODAY }).action).toBe('maintain');
  });
});
