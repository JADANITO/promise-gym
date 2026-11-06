import type { DailyCheckIn, Exercise, LifeEvent, Muscle, Settings, WeeklyCheckIn, WeeklyTarget, WorkoutSession } from '../types';
import { addDays, parseYmd, weekStart, ymd } from './dates';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The life event (ill, away, sore…) covering a date, if any. */
export function eventOn(events: LifeEvent[] | undefined, date: string): LifeEvent | undefined {
  return events?.find(e => e.from <= date && date <= e.to);
}

/** Template planned for a date (null = rest). Days off win, then one-off overrides, then the weekly split. */
export function plannedFor(settings: Pick<Settings, 'schedule' | 'scheduleOverrides'>, date: string, events?: LifeEvent[]): string | null {
  if (eventOn(events, date)) return null;
  if (date in settings.scheduleOverrides) return settings.scheduleOverrides[date];
  return settings.schedule[parseYmd(date).getDay()] ?? null;
}

export interface PlanDay {
  date: string;
  planned: string | null;
  sessions: WorkoutSession[];
  status: 'done' | 'missed' | 'today' | 'upcoming' | 'rest' | 'extra' | 'off';
  event?: LifeEvent;
}

/** Monday–Sunday for the week containing `today`. */
export function weekPlan(settings: Pick<Settings, 'schedule' | 'scheduleOverrides'>, sessions: WorkoutSession[], today: string, events?: LifeEvent[]): PlanDay[] {
  const mon = weekStart(today);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(mon, i);
    const planned = plannedFor(settings, date, events);
    const event = eventOn(events, date);
    const done = sessions.filter(s => ymd(s.startedAt) === date);
    let status: PlanDay['status'];
    if (done.length) status = planned ? 'done' : 'extra';
    else if (event) status = 'off';
    else if (!planned) status = 'rest';
    else if (date < today) status = 'missed';
    else if (date === today) status = 'today';
    else status = 'upcoming';
    return { date, planned, sessions: done, status, event };
  });
}

export function plannedPerWeek(schedule: (string | null)[]): number {
  return schedule.filter(Boolean).length;
}

/** Hard sets per muscle: completed working sets, primary = 1, secondary = 0.5. Deloads excluded. */
export function setsPerMuscle(sessions: WorkoutSession[], exercises: Exercise[], from: string, to: string): Record<Muscle, number> {
  const out = {} as Record<Muscle, number>;
  const byId = new Map(exercises.map(e => [e.id, e]));
  for (const s of sessions) {
    const d = ymd(s.startedAt);
    if (s.deload || d < from || d > to) continue;
    for (const le of s.exercises) {
      if (le.skipped) continue;
      const ex = byId.get(le.exerciseId);
      if (!ex) continue;
      const n = le.sets.filter(x => x.completed && !x.warmup).length;
      ex.primary?.forEach(m => (out[m] = (out[m] ?? 0) + n));
      ex.secondary?.forEach(m => (out[m] = (out[m] ?? 0) + n * 0.5));
    }
  }
  return out;
}

/** Weekly volume target range per muscle. */
export function volumeRange(m: Muscle): [number, number] {
  if (m === 'calves') return [8, 16];
  if (m === 'abs') return [6, 16];
  return [10, 20];
}

export interface Promises {
  kept: number;
  total: number;
  items: { label: string; kept: number; total: number }[];
}

/** "Promises kept" for a Mon–Sun week: sessions, weigh-ins, protein, and the Sunday check-in. */
export function promisesFor(input: {
  settings: Pick<Settings, 'schedule' | 'scheduleOverrides'>;
  sessions: WorkoutSession[];
  checkIns: Record<string, DailyCheckIn>;
  weekly: WeeklyCheckIn[];
  target?: WeeklyTarget;
  today: string;
  weekOf: string;
  events?: LifeEvent[];
}): Promises {
  const { settings, sessions, checkIns, weekly, target, today, weekOf, events } = input;
  const mon = weekStart(weekOf);
  // Days off (ill, away) aren't promises you could keep.
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i)).filter(d => d <= today && !(eventOn(events, d) && eventOn(events, d)!.type !== 'sore'));
  const plan = weekPlan(settings, sessions, mon, events).filter(d => d.date <= today);
  const trainingDue = plan.filter(d => d.planned && (d.date < today || d.status === 'done')).length;
  const trainingDone = Math.min(trainingDue, plan.filter(d => d.sessions.length > 0).length);
  const weighDue = days.length;
  const weighed = days.filter(d => checkIns[d]?.bodyweight != null).length;
  const proteinDue = days.filter(d => d < today || checkIns[d]?.protein != null).length;
  const proteinHit = target ? days.filter(d => (checkIns[d]?.protein ?? 0) >= target.protein * 0.9).length : 0;
  const sunday = addDays(mon, 6);
  const checkInDue = today >= sunday ? 1 : 0;
  const checkInDone = weekly.some(w => w.date >= mon && w.date <= addDays(sunday, 1)) ? 1 : 0;
  const items = [
    { label: 'Workouts', kept: trainingDone, total: trainingDue },
    { label: 'Weigh-ins', kept: weighed, total: weighDue },
    ...(target ? [{ label: 'Protein target', kept: proteinHit, total: proteinDue }] : []),
    ...(checkInDue ? [{ label: 'Sunday check-in', kept: checkInDone, total: 1 }] : []),
  ];
  return { kept: items.reduce((n, i) => n + i.kept, 0), total: items.reduce((n, i) => n + i.total, 0), items };
}
