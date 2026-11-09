import type { Store } from './store';
import { composition, excludeDisrupted, nextTargets, phaseStatus, simulateRoadmap, targetFor } from '../engine/body';
import { addDays, daysBetween, parseYmd, weekStart, ymd } from '../engine/dates';

/** Everything the screens need to know about the body-composition plan right now. */
export function planSnapshot(s: Store, today = ymd()) {
  // Weigh-ins while ill or away (and 3 days after) don't count toward the trend.
  const ci = excludeDisrupted(Object.values(s.checkIns), s.lifeEvents);
  const comp = composition(s.profile, ci, s.measurements, today);
  const phase = s.currentNutritionPhase();
  const weeksIn = phase ? Math.floor(daysBetween(phase.startDate, today) / 7) : 0;
  const status = phase ? phaseStatus(phase, ci, today) : null;
  const target = targetFor(s.weeklyTargets, today);
  const roadmap = comp && s.profile.goalWeight ? simulateRoadmap(comp, s.profile, today, phase ? { type: phase.type, weeksIn } : undefined) : [];
  const lastWaist = [...s.measurements].sort((a, b) => b.date.localeCompare(a.date))[0];
  return { comp, phase, weeksIn, status, target, roadmap, lastWaist };
}

export const PHASE_LABEL = { bulk: 'Lean bulk', cut: 'Lean cut', maintain: 'Maintenance' } as const;

/** Make sure this week has calorie/protein targets (e.g. right after setup or if a check-in was missed). */
export function ensureWeeklyTargets(s: Store, today = ymd()) {
  const phase = s.currentNutritionPhase();
  if (!phase) return;
  const mon = weekStart(today);
  if (s.weeklyTargets.some(t => t.weekStart === mon)) return;
  const ci = excludeDisrupted(Object.values(s.checkIns), s.lifeEvents);
  const comp = composition(s.profile, ci, s.measurements, today);
  if (!comp) return;
  s.setWeeklyTarget(nextTargets({ phase, comp, checkIns: ci, previous: targetFor(s.weeklyTargets, today), today, weekStart: mon }));
}

/** The Sunday check-in is due on Sundays (and Monday as a catch-up) if not done in the last 5 days. */
export function weeklyCheckInDue(s: Store, today = ymd()): boolean {
  const phase = s.currentNutritionPhase();
  if (!phase) return false;
  // No check-in in the first 6 days of a phase: there's nothing to review yet.
  if (daysBetween(phase.startDate, today) < 6) return false;
  const dow = parseYmd(today).getDay();
  const recent = s.weeklyCheckIns.some(w => w.date > addDays(today, -5));
  if (recent) return false;
  const last = s.weeklyCheckIns[s.weeklyCheckIns.length - 1];
  return dow === 0 || dow === 1 || (!!last && daysBetween(last.date, today) >= 8);
}

/** Targets apply from the Monday after a Sunday check-in, or from this week's Monday otherwise. */
export function targetWeekFor(today = ymd()): string {
  return parseYmd(today).getDay() === 0 ? addDays(today, 1) : weekStart(today);
}
