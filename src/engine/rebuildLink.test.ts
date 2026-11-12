import { describe, expect, it } from 'vitest';
import { planToken, rebuildHash } from './rebuildLink';

const templates = [{ id: 'u', name: 'Upper' }, { id: 'l', name: 'Lower' }, { id: 'p', name: 'Pull day 2' }];
// index 0 = Sunday: Mon Upper, Tue Lower, Thu Upper, Fri Lower
const schedule = [null, 'u', 'l', null, 'u', 'l', null];

describe('rebuild week link', () => {
  it('makes names link-safe', () => {
    expect(planToken('Upper')).toBe('Upper');
    expect(planToken('Pull day 2')).toBe('PullDay2');
    expect(planToken('5x5 legs')).toBe('Gym5x5Legs');
    expect(planToken(null)).toBe('0');
  });

  it('sends this week and next, Monday first, with one-off moves and days off', () => {
    const h = rebuildHash({ schedule, scheduleOverrides: { '2026-11-10': 'u', '2026-11-12': 'l', '2026-11-09': null } }, templates,
      [{ id: 'e', type: 'away', from: '2026-11-20', to: '2026-11-20' } as never], '2026-11-11');
    const p = h.split('-');
    expect(p[0]).toBe('#promise');
    expect(p[1]).toBe('20261109');
    expect(p.slice(2, 9)).toEqual(['0', 'Upper', '0', 'Lower', 'Lower', '0', '0']);
    expect(p[13]).toBe('0'); // Fri 20 Nov: away
    expect(p[16]).toBe('w');
    expect(p.slice(17, 24)).toEqual(['Upper', 'Lower', '0', 'Upper', 'Lower', '0', '0']);
    expect(p.length).toBe(24);
    expect(/^#[A-Za-z0-9-]+$/.test(h)).toBe(true);
  });

  it('adds the finished workout', () => {
    expect(rebuildHash({ schedule, scheduleOverrides: {} }, templates, [], '2026-11-12', '2026-11-12').endsWith('-done-20261112')).toBe(true);
  });
});
