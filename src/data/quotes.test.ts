import { describe, expect, it } from 'vitest';
import { QUOTES, dayPart, greeting, missedWeighInQuote, quoteFor } from './quotes';

const at = (h: number) => new Date(2026, 10, 6, h, 0);

describe('time of day', () => {
  it('says good evening at 6pm, not good morning', () => {
    expect(dayPart(at(18))).toBe('evening');
    expect(greeting('Jaden', at(18))).toBe('Good evening, Jaden');
    expect(greeting('Jaden', at(7))).toBe('Good morning, Jaden');
    expect(greeting('Jaden', at(14))).toBe('Good afternoon, Jaden');
    expect(greeting('', at(1))).toBe('Still up?');
  });
});

describe('motivation', () => {
  it('fills in your name and goal', () => {
    const all = QUOTES.map((_, i) => quoteFor(`2024-01-${String(1 + (i % 28)).padStart(2, '0')}`, [], { name: 'Jaden', goal: '82kg at 12%' }));
    expect(all.some(q => q === 'Would future Jaden be proud of today?')).toBe(true);
    expect(all.join(' ')).not.toMatch(/\{name\}|\{goal\}/);
  });
  it('falls back to "you" without a name', () => {
    expect(quoteFor('2024-01-01', [], {})).toBe('Would future you be proud of today?');
  });
  it('has a missed weigh-in message', () => {
    expect(missedWeighInQuote('2026-11-06', { name: 'Jaden' })).not.toContain('{');
  });
});
