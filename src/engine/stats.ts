import type { DailyCheckIn, Goals } from '../types';
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

export type TrackStatus = 'on-track' | 'ahead' | 'behind' | 'too-fast' | 'unknown' | 'reached';

export interface GoalProgress {
  status: TrackStatus;
  current: number | null; // 7-day average
  actualPerWeek: number | null;
  neededPerWeek: number | null;
  weeksLeft: number | null;
  advice: string;
  calorieAdjust: number | null; // suggested daily kcal change
}

/** Compare the actual rate of weight change (last 14 days) with the rate needed to hit the goal. */
export function goalProgress(checkIns: DailyCheckIn[], goals: Goals, today: string): GoalProgress {
  const ws = weights(checkIns);
  const ma = movingAverage(ws);
  const current = ma.length ? ma[ma.length - 1].value : null;
  const recent = ws.filter(p => p.date >= addDays(today, -13));
  const slope = recent.length >= 4 ? slopePerDay(recent) : null;
  const actualPerWeek = slope == null ? null : slope * 7;
  const base: GoalProgress = { status: 'unknown', current, actualPerWeek, neededPerWeek: null, weeksLeft: null, advice: '', calorieAdjust: null };

  if (current == null) return { ...base, advice: 'Log your weight each morning to track your goal.' };

  if (goals.direction === 'maintain' || goals.goalWeight == null) {
    if (actualPerWeek == null) return { ...base, advice: 'A few more weigh-ins needed to see your trend.' };
    const ok = Math.abs(actualPerWeek) <= 0.2;
    const adj = ok ? null : Math.round((-actualPerWeek * KCAL_PER_KG) / 7 / 50) * 50;
    return {
      ...base,
      status: ok ? 'on-track' : 'behind',
      advice: ok ? 'Weight is stable. Keep doing what you are doing.' : `Weight is drifting ${actualPerWeek > 0 ? 'up' : 'down'} ${Math.abs(actualPerWeek).toFixed(2)}kg/week — adjust about ${adj! > 0 ? '+' : ''}${adj} kcal/day.`,
      calorieAdjust: adj,
    };
  }

  const remaining = goals.goalWeight - current;
  const towardGoal = goals.direction === 'lose' ? remaining >= 0 : remaining <= 0;
  if (towardGoal || Math.abs(remaining) < 0.3) return { ...base, status: 'reached', advice: 'Goal reached. Set a new one in Settings.' };

  const weeksLeft = goals.goalDate ? Math.max(daysBetween(today, goals.goalDate) / 7, 0.5) : null;
  const neededPerWeek = weeksLeft ? remaining / weeksLeft : goals.direction === 'lose' ? -0.5 : 0.25;
  const res = { ...base, neededPerWeek, weeksLeft };
  if (actualPerWeek == null) return { ...res, advice: `You need about ${fmtRate(neededPerWeek)}. Keep weighing in daily to see your trend.` };

  const tolerance = Math.max(0.15, Math.abs(neededPerWeek) * 0.3);
  const diff = actualPerWeek - neededPerWeek; // positive = heavier than plan
  const adj = Math.round((-diff * KCAL_PER_KG) / 7 / 50) * 50;

  if (Math.abs(diff) <= tolerance) {
    return { ...res, status: 'on-track', advice: `On track: ${fmtRate(actualPerWeek)} vs ${fmtRate(neededPerWeek)} needed.` };
  }
  // "Ahead" = moving toward the goal faster than planned.
  const faster = goals.direction === 'lose' ? diff < 0 : diff > 0;
  if (faster) {
    const tooFast = goals.direction === 'lose' && actualPerWeek < -1.0;
    return {
      ...res,
      status: tooFast ? 'too-fast' : 'ahead',
      calorieAdjust: tooFast ? adj : null,
      advice: tooFast
        ? `Losing ${fmtRate(actualPerWeek)} — faster than you need. Add about ${adj} kcal/day to protect muscle.`
        : `Ahead of plan: ${fmtRate(actualPerWeek)} vs ${fmtRate(neededPerWeek)} needed.`,
    };
  }
  return {
    ...res,
    status: 'behind',
    calorieAdjust: adj,
    advice: `Behind: ${fmtRate(actualPerWeek)} vs ${fmtRate(neededPerWeek)} needed. Adjust about ${adj > 0 ? '+' : ''}${adj} kcal/day.`,
  };
}

export function fmtRate(kgPerWeek: number): string {
  return `${kgPerWeek > 0 ? '+' : ''}${kgPerWeek.toFixed(2)}kg/week`;
}
