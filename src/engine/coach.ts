import type { CoachReport, DailyCheckIn, Goals, Phase, Settings, WorkoutSession, WorkoutTemplate } from '../types';
import { achievedReps, computeProgress } from './progression';
import { analyzePlateau, phaseWeek, plateauCheckDue } from './phases';
import { addDays, ymd } from './dates';
import { calories, goalProgress, mean } from './stats';

/** Everything the coach looks at for one week, as plain data (also what's sent to the AI). */
export interface WeekStats {
  weekStart: string;
  weekEnd: string;
  workoutsDone: number;
  workoutsPlanned: number;
  phase: string;
  deloadDue: boolean;
  exercises: {
    name: string;
    outcome: 'progressed' | 'weight-up' | 'held' | 'failed' | 'not trained';
    detail: string;
    failedStreak: number;
  }[];
  bodyweight: { current: number | null; changeThisWeek: number | null; goal?: number; goalDate?: string; direction: string; status: string; advice: string; calorieAdjust: number | null };
  calories: { average: number | null; target?: number; daysLogged: number; daysOnTarget: number };
  avgRpe: number | null;
  notes: string[];
}

export function buildWeekStats(
  input: { sessions: WorkoutSession[]; templates: WorkoutTemplate[]; checkIns: Record<string, DailyCheckIn>; goals: Goals; settings: Settings; phase?: Phase; name: (id: string) => string },
  today: string,
): WeekStats {
  const { sessions, checkIns, goals, settings, phase, name } = input;
  const weekStart = addDays(today, -6);
  const inWeek = (at: number) => ymd(at) >= weekStart && ymd(at) <= today;
  const week = sessions.filter(s => inWeek(s.startedAt));
  const before = sessions.filter(s => ymd(s.startedAt) < weekStart);
  const ci = Object.values(checkIns);

  const ids = new Set<string>();
  input.templates.filter(t => !t.archived).forEach(t => t.exercises.forEach(e => ids.add(e.exerciseId)));
  week.forEach(s => s.exercises.forEach(e => ids.add(e.exerciseId)));

  const exercises: WeekStats['exercises'] = [];
  for (const id of ids) {
    const done = week.filter(s => !s.deload).flatMap(s => s.exercises.filter(e => e.exerciseId === id && !e.skipped && e.countsForProgression));
    const prev = computeProgress(id, before, settings.basis, 0, 0);
    const now = computeProgress(id, sessions.filter(s => ymd(s.startedAt) <= today), settings.basis, 0, 0);
    if (!done.length) {
      if (week.some(s => s.deload && s.exercises.some(e => e.exerciseId === id))) continue;
      exercises.push({ name: name(id), outcome: 'not trained', detail: 'Not trained this week', failedStreak: now.failedCount });
      continue;
    }
    const last = done[done.length - 1];
    const reps = achievedReps(last.sets, settings.basis) ?? 0;
    const w = last.workingWeight;
    let outcome: WeekStats['exercises'][number]['outcome'];
    if (prev.last && w > prev.last.weight) outcome = 'weight-up';
    else if (now.failedCount > 0) outcome = 'failed';
    else if (!prev.last || reps > prev.last.achieved || now.increaseDue) outcome = 'progressed';
    else outcome = 'held';
    exercises.push({
      name: name(id),
      outcome,
      detail: `${+w.toFixed(2)}kg × ${reps} (range ${last.repMin}–${last.repMax})${prev.last ? `, previously ${+prev.last.weight.toFixed(2)}kg × ${prev.last.achieved}` : ''}`,
      failedStreak: now.failedCount,
    });
  }

  const gp = goalProgress(ci, goals, today);
  const ws = ci.filter(c => c.bodyweight != null && c.date >= addDays(weekStart, -7)).sort((a, b) => a.date.localeCompare(b.date));
  const thisWeek = ws.filter(c => c.date >= weekStart).map(c => c.bodyweight!);
  const lastWeek = ws.filter(c => c.date < weekStart).map(c => c.bodyweight!);
  const change = thisWeek.length && lastWeek.length ? mean(thisWeek)! - mean(lastWeek)! : null;

  const kc = calories(ci).filter(p => p.date >= weekStart && p.date <= today);
  const target = goals.calorieTarget;
  const rpes = week.flatMap(s => s.exercises.flatMap(e => e.sets.filter(x => x.completed && !x.warmup && x.rpe != null).map(x => x.rpe!)));
  const notes = [
    ...week.flatMap(s => s.exercises.flatMap(e => e.sets.filter(x => x.note).map(x => `${name(e.exerciseId)}: ${x.note}`))),
    ...ci.filter(c => c.notes && c.date >= weekStart).map(c => `${c.date}: ${c.notes}`),
  ];

  return {
    weekStart,
    weekEnd: today,
    workoutsDone: week.length,
    workoutsPlanned: settings.workoutsPerWeek,
    phase: phase ? `${phase.type === 'deload' ? 'Deload week' : `Gaining phase ${phase.number}`}, week ${phaseWeek(phase, today)}` : 'No phase',
    deloadDue: plateauCheckDue(phase, today) && analyzePlateau(sessions, ci, settings.basis, today).recommendDeload,
    exercises,
    bodyweight: {
      current: gp.current == null ? null : +gp.current.toFixed(1),
      changeThisWeek: change == null ? null : +change.toFixed(2),
      goal: goals.goalWeight,
      goalDate: goals.goalDate,
      direction: goals.direction,
      status: gp.status,
      advice: gp.advice,
      calorieAdjust: gp.calorieAdjust,
    },
    calories: {
      average: mean(kc.map(p => p.value)) == null ? null : Math.round(mean(kc.map(p => p.value))!),
      target,
      daysLogged: kc.length,
      daysOnTarget: target ? kc.filter(p => Math.abs(p.value - target) <= target * 0.1).length : 0,
    },
    avgRpe: mean(rpes) == null ? null : +mean(rpes)!.toFixed(1),
    notes,
  };
}

type Advice = Pick<CoachReport, 'summary' | 'wins' | 'changes' | 'focus'>;

/** Offline coach: deterministic rules over the week's stats. */
export function rulesReport(s: WeekStats): Advice {
  const trained = s.exercises.filter(e => e.outcome !== 'not trained');
  const up = trained.filter(e => e.outcome === 'progressed' || e.outcome === 'weight-up');
  const failed = trained.filter(e => e.failedStreak >= 2);
  const held = trained.filter(e => e.outcome === 'held' || e.outcome === 'failed');

  const parts = [`${s.workoutsDone} of ${s.workoutsPlanned} workouts`];
  if (trained.length) parts.push(`${up.length} of ${trained.length} exercises progressed`);
  if (s.bodyweight.changeThisWeek != null) parts.push(`weight ${s.bodyweight.changeThisWeek <= 0 ? 'down' : 'up'} ${Math.abs(s.bodyweight.changeThisWeek)}kg`);
  const good = s.workoutsDone >= s.workoutsPlanned && up.length >= trained.length / 2;
  const summary = `${good ? 'Solid week' : s.workoutsDone === 0 ? 'Quiet week' : 'Mixed week'}: ${parts.join(', ')}.`;

  const wins: string[] = [];
  s.exercises.filter(e => e.outcome === 'weight-up').forEach(e => wins.push(`${e.name}: moved up in weight — ${e.detail.split(',')[0]}.`));
  s.exercises.filter(e => e.outcome === 'progressed').slice(0, 3).forEach(e => wins.push(`${e.name}: more reps — ${e.detail.split(',')[0]}.`));
  if (s.workoutsDone >= s.workoutsPlanned) wins.push(`Hit all ${s.workoutsPlanned} planned sessions. That's the promise kept.`);
  if (s.bodyweight.status === 'on-track') wins.push('Bodyweight is on track for your goal.');
  if (!wins.length) wins.push(s.workoutsDone ? 'You showed up. Build on it this week.' : 'Nothing logged yet — this week is a clean slate.');

  const changes: string[] = [];
  for (const e of failed.slice(0, 2)) {
    changes.push(`${e.name} has been below your rep range ${e.failedStreak} sessions running. Drop the weight 5–10% and rebuild to the top of the range — or check sleep and food first.`);
  }
  if (s.deloadDue) changes.push('Most lifts have stalled over two weeks. Take the deload week — you will come back stronger.');
  if (s.workoutsDone < s.workoutsPlanned) {
    changes.push(`You trained ${s.workoutsDone} of ${s.workoutsPlanned} times. Put the sessions in your calendar now — treat them like appointments.`);
  }
  const { average, target, daysLogged } = s.calories;
  if (target && average != null) {
    const off = average - target;
    if (Math.abs(off) > target * 0.1) {
      const stalling = held.length > up.length;
      changes.push(`You averaged ${average.toLocaleString()} kcal against a ${target.toLocaleString()} target. ${off < 0 && stalling ? 'Strength is stalling, so eat closer to target.' : off < 0 ? 'Eat closer to target to fuel your training.' : 'Tighten up to hit your target.'}`);
    }
  }
  if (daysLogged < 5) changes.push(`Calories logged on only ${daysLogged} of 7 days. Log every evening — you can't adjust what you don't track.`);
  if (s.bodyweight.calorieAdjust && (s.bodyweight.status === 'behind' || s.bodyweight.status === 'too-fast')) {
    const adj = s.bodyweight.calorieAdjust;
    changes.push(s.bodyweight.status === 'too-fast'
      ? `You're losing weight faster than planned — add about ${adj} kcal/day to protect muscle.`
      : `To get back on track for your goal, ${adj > 0 ? 'add' : 'cut'} about ${Math.abs(adj)} kcal/day.`);
  }
  if (s.avgRpe != null && s.avgRpe >= 9.5) changes.push(`Average RPE was ${s.avgRpe}. You are grinding every set — leave 1 rep in the tank on the first sets.`);
  if (!changes.length) changes.push('Keep everything the same. The plan is working — beat last week by one rep.');

  const focus = failed.length
    ? 'Reset the stuck lifts, nail the basics, and the numbers will move again.'
    : up.length
      ? 'Momentum is on your side. One more rep, every session.'
      : 'Show up for every planned session this week. Nothing else matters until that is done.';

  return { summary, wins: wins.slice(0, 4), changes: changes.slice(0, 4), focus };
}
