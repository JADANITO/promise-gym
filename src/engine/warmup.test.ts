import { describe, expect, it } from 'vitest';
import { loadingText, platesPerSide, warmupRamp } from './warmup';
import { estimateSec, isCompound, planTimeCut, type CutItem } from './timecut';
import { BUILT_IN_EXERCISES } from '../data/library';

describe('warm-ups', () => {
  it('barbell: empty bar, then 50/70/85%', () => {
    expect(warmupRamp(70, { loading: 'barbell' })).toEqual([
      { weight: 20, reps: 10 }, { weight: 35, reps: 8 }, { weight: 50, reps: 4 }, { weight: 60, reps: 2 },
    ]);
  });
  it('light barbell: no steps below the bar or repeated', () => {
    expect(warmupRamp(30, { loading: 'barbell' })).toEqual([{ weight: 20, reps: 8 }, { weight: 25, reps: 2 }]);
  });
  it('dumbbells / machines: two steps', () => {
    expect(warmupRamp(24, { rounding: 2 })).toEqual([{ weight: 12, reps: 8 }, { weight: 18, reps: 4 }]);
  });
  it('heavy machines get three steps', () => {
    expect(warmupRamp(85, { loading: 'per-side' }).map(s => s.weight)).toEqual([42.5, 60, 72.5]);
  });
});

describe('plate calculator', () => {
  it('breaks a side into standard plates', () => {
    expect(platesPerSide(22.5).plates).toEqual([20, 2.5]);
    expect(platesPerSide(85).plates).toEqual([25, 25, 25, 10]);
  });
  it('reads naturally', () => {
    expect(loadingText(70, 'barbell')).toBe('20kg bar + 25 each side');
    expect(loadingText(60, 'barbell')).toBe('20kg bar + 20 each side');
    expect(loadingText(85, 'per-side')).toBe('25 + 25 + 25 + 10 each side');
    expect(loadingText(61, 'barbell')).toContain("can't make");
  });
});

describe('short on time', () => {
  const ex = (name: string) => BUILT_IN_EXERCISES.find(e => e.name === name)!;
  const item = (name: string, restSec = 90, sets = 3): CutItem => {
    const e = ex(name);
    return { id: name, name, restSec, setsLeft: sets, warmupsLeft: 0, compound: isCompound(e), primary: e.primary!, isAbs: e.primary!.includes('abs'), started: false };
  };
  const push = [
    item('Incline DB Press', 150), item('Chest Dips', 120), item('Machine Shoulder Press', 120), item('Pec Deck'),
    item('Cable Upright Row'), item('Cable Triceps Pushdown'), item('Seated DB Lateral Raise'), item('Overhead Cable Triceps Extension'),
    item('Roman Chair Leg Raise', 60),
  ];

  it('knows compounds from isolations', () => {
    expect(isCompound(ex('Incline DB Press'))).toBe(true);
    expect(isCompound(ex('Leg Press'))).toBe(true);
    expect(isCompound(ex('Pec Deck'))).toBe(false);
    expect(isCompound(ex('Rope Hammer Curl'))).toBe(false);
  });

  it('a full Push day is around 70–80 minutes', () => {
    const min = estimateSec(push) / 60;
    expect(min).toBeGreaterThan(65);
    expect(min).toBeLessThan(85);
  });

  it('fits 45 minutes without touching the compounds', () => {
    const plan = planTimeCut(push, 45);
    expect(plan.fits).toBe(true);
    for (const name of ['Incline DB Press', 'Chest Dips', 'Machine Shoulder Press']) {
      const it = plan.items.find(i => i.id === name)!;
      expect(it.setsLeft).toBe(3);
      expect(it.skip).toBeFalsy();
    }
    expect(plan.changes.some(c => c.startsWith('Superset'))).toBe(true);
  });

  it('supersets only muscles that do not compete', () => {
    const plan = planTimeCut(push, 60);
    for (const it of plan.items.filter(i => i.pairWith)) {
      const partner = plan.items.find(i => i.id === it.pairWith)!;
      expect(it.primary.some(m => partner.primary.includes(m))).toBe(false);
    }
  });

  it('changes nothing when there is time', () => {
    expect(planTimeCut(push, 120).changes).toEqual([]);
  });
});
