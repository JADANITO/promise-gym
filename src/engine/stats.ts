import type { DailyCheckIn } from '../types';
import { addDays, daysBetween } from './dates';

export const KCAL_PER_KG = 7700;

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Trailing moving average over calendar days (only days with a value count). */
export function movingAverage(points: { date: string; value: number }[], days = 7): { date: string; value: number }[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map(p => {
    const from = addDays(p.date, -(days - 1));
    const win = sorted.filter(q => q.date >= from && q.date <= p.date).map(q => q.value);
    return { date: p.date, value: mean(win)! };
  });
}

/** Least-squares slope in units per day. */
export function slopePerDay(points: { date: string; value: number }[]): number | null {
  if (points.length < 2) return null;
  const x0 = points[0].date;
  const xs = points.map(p => daysBetween(x0, p.date));
  const ys = points.map(p => p.value);
  const mx = mean(xs)!, my = mean(ys)!;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return den === 0 ? null : num / den;
}

export function weights(checkIns: DailyCheckIn[]) {
  return checkIns
    .filter(c => c.bodyweight != null)
    .map(c => ({ date: c.date, value: c.bodyweight! }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function calories(checkIns: DailyCheckIn[]) {
  return checkIns
    .filter(c => c.calories != null)
    .map(c => ({ date: c.date, value: c.calories! }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function fmtRate(kgPerWeek: number): string {
  return `${kgPerWeek > 0 ? '+' : ''}${kgPerWeek.toFixed(2)}kg/week`;
}
