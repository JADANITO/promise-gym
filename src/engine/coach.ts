import type { BodyMeasurement, CoachReport, DailyCheckIn, Exercise, LifeEvent, Measurement, NutritionPhase, Phase, Profile, Settings, WeeklyCheckIn, WeeklyTarget, WorkoutSession, WorkoutTemplate } from '../types';
import { achievedReps, computeProgress } from './progression';
import { analyzePlateau, phaseWeek, plateauCheckDue } from './phases';
import { addDays, daysBetween, weekStart, ymd } from './dates';
import { mean } from './stats';
import { composition, excludeDisrupted, phaseStatus, targetFor } from './body';
import { promisesFor, setsPerMuscle, volumeRange } from './schedule';
import { TRACKED_MUSCLES, muscleLabel } from '../data/library';

export interface CoachInput {
  sessions: WorkoutSession[];
  templates: WorkoutTemplate[];
  checkIns: Record<string, DailyCheckIn>;
  profile: Profile;
  measurements: Measurement[];
  weeklyTargets: WeeklyTarget[];
  weeklyCheckIns: WeeklyCheckIn[];
  settings: Settings;
  trainingBlock?: Phase;
  nutritionPhase?: NutritionPhase;
  exercises: Exercise[];
  events?: LifeEvent[];
  circumferences?: BodyMeasurement[];
  name: (id: string) => string;
}

/** Everything the coach looks at for one week, as plain data (also what's sent to the AI). */
export interface WeekStats {
  weekStart: string;
  weekEnd: string;
  workoutsDone: number;
  workoutsPlanned: number;
  trainingBlock: string;
  deloadDue: boolean;
  rampUp: boolean;
  exercises: { name: string; outcome: 'progressed' | 'weight-up' | 'held' | 'failed' | 'not trained'; detail: string; failedStreak: number }[];
  nutritionPhase: { type: string; week: number; targetRateKgPerWeek: number; actualRateKgPerWeek: number | null; status: string; advice: string } | null;
  body: { weight: number | null; bodyFatEstimate: number | null; waistChangeSincePhaseStartCm: number | null; goalWeight: number; goalBodyFat: number };
  calories: { target: number | null; maintenanceEstimate: number | null; average: number | null; daysLogged: number };
  protein: { target: number | null; average: number | null; daysLogged: number; daysHit: number };
  recovery: { avgSleepHours: number | null; nightsLogged: number; nightsUnder6h: number };
  volume: { muscle: string; sets: number; range: [number, number] }[];
  promisesKept: { kept: number; total: number };
  /** Illness or time away overlapping this week, e.g. "Ill 3 days". */
  disruptions: string[];
  /** Full weeks on the current program. */
  weeksOnProgram: number;
  /** Tape changes (cm) between the latest monthly measurement and one 3+ weeks earlier. */
  tape: { weeks: number; fresh: boolean; arm: number | null; chest: number | null; shoulders: number | null; thigh: number | null; waist: number | null } | null;
  notes: string[];
}

export function buildWeekStats(input: CoachInput, today: string): WeekStats {
  const { sessions, checkIns, settings, trainingBlock, nutritionPhase, profile, name } = input;
  const from = addDays(today, -6);
  const inWeek = (at: number) => ymd(at) >= from && ymd(at) <= today;
  const week = sessions.filter(s => inWeek(s.startedAt));
  const before = sessions.filter(s => ymd(s.startedAt) < from);
  const ci = Object.values(checkIns);
  const ciTrend = excludeDisrupted(ci, input.events);
  const disruptions = (input.events ?? [])
    .filter(e => e.to >= from && e.from <= today && e.type !== 'sore')
    .map(e => {
      const days = Math.min(daysBetween(e.from, e.to), daysBetween(e.from, today)) + 1;
      return `${e.type === 'ill' ? 'Ill' : e.type === 'away' ? 'Away' : 'Off'} ${days} day${days > 1 ? 's' : ''}`;
    });
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));

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
      name: name(id), outcome, failedStreak: now.failedCount,
      detail: `${+w.toFixed(2)}kg × ${reps} (range ${last.repMin}–${last.repMax})${prev.last ? `, previously ${+prev.last.weight.toFixed(2)}kg × ${prev.last.achieved}` : ''}`,
    });
  }

  const comp = composition(profile, ciTrend, input.measurements, today);
  const target = targetFor(input.weeklyTargets, today) ?? null;
  const ps = nutritionPhase ? phaseStatus(nutritionPhase, ciTrend, today) : null;
  const lastWaist = [...input.measurements].sort((a, b) => b.date.localeCompare(a.date))[0];
  const kc = days.map(d => checkIns[d]?.calories).filter((v): v is number => v != null);
  const pr = days.map(d => checkIns[d]?.protein).filter((v): v is number => v != null);
  const sleep = days.map(d => checkIns[d]?.sleepHours).filter((v): v is number => v != null);
  const vol = setsPerMuscle(sessions, input.exercises, from, today);
  const promises = promisesFor({ settings, sessions, checkIns, weekly: input.weeklyCheckIns, target: target ?? undefined, today, weekOf: weekStart(today), events: input.events });
  const r1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);
  const notes = [
    ...week.flatMap(s => s.exercises.flatMap(e => e.sets.filter(x => x.note).map(x => `${name(e.exerciseId)}: ${x.note}`))),
    ...ci.filter(c => c.notes && c.date >= from).map(c => `${c.date}: ${c.notes}`),
  ];

  return {
    weekStart: from,
    weekEnd: today,
    workoutsDone: week.length,
    workoutsPlanned: settings.workoutsPerWeek,
    trainingBlock: trainingBlock ? `${trainingBlock.type === 'deload' ? 'Deload week' : `Training block ${trainingBlock.number}`}, week ${phaseWeek(trainingBlock, today)}` : 'None',
    deloadDue: plateauCheckDue(trainingBlock, today) && analyzePlateau(sessions, ci, settings.basis, today, 14, nutritionPhase?.type === 'cut').recommendDeload,
    rampUp: !!settings.rampUntil && today <= settings.rampUntil,
    exercises,
    nutritionPhase: nutritionPhase && ps ? {
      type: nutritionPhase.type,
      week: Math.floor(daysBetween(nutritionPhase.startDate, today) / 7) + 1,
      targetRateKgPerWeek: nutritionPhase.targetRate,
      actualRateKgPerWeek: r1(ps.actual),
      status: ps.status,
      advice: ps.advice,
    } : null,
    body: {
      weight: r1(comp?.weight),
      bodyFatEstimate: r1(comp?.bodyFat),
      waistChangeSincePhaseStartCm: lastWaist && nutritionPhase?.startWaistCm != null ? r1(lastWaist.waistCm - nutritionPhase.startWaistCm) : null,
      goalWeight: profile.goalWeight,
      goalBodyFat: profile.goalBodyFat,
    },
    calories: { target: target?.kcal ?? null, maintenanceEstimate: target?.maintenance ?? null, average: kc.length ? Math.round(mean(kc)!) : null, daysLogged: kc.length },
    protein: { target: target?.protein ?? null, average: pr.length ? Math.round(mean(pr)!) : null, daysLogged: pr.length, daysHit: target ? pr.filter(p => p >= target.protein * 0.9).length : 0 },
    recovery: { avgSleepHours: r1(mean(sleep)), nightsLogged: sleep.length, nightsUnder6h: sleep.filter(x => x < 6).length },
    volume: TRACKED_MUSCLES.map(m => ({ muscle: muscleLabel(m), sets: Math.round((vol[m] ?? 0) * 10) / 10, range: volumeRange(m) })),
    promisesKept: { kept: promises.kept, total: promises.total },
    disruptions,
    tape: tapeChange(input, from),
    weeksOnProgram: settings.programLoadedOn ? Math.floor(daysBetween(settings.programLoadedOn, today) / 7) : 0,
    notes,
  };
}

function tapeChange(input: CoachInput, weekFrom: string): WeekStats['tape'] {
  const rows = input.circumferences ?? [];
  const last = rows[rows.length - 1];
  if (!last) return null;
  const base = [...rows].reverse().find(r => daysBetween(r.date, last.date) >= 21);
  if (!base) return null;
  const waistAt = (date: string) => [...input.measurements].filter(m => m.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0]?.waistCm;
  const d = (a?: number, b?: number) => (a != null && b != null ? Math.round((b - a) * 10) / 10 : null);
  return {
    weeks: Math.round(daysBetween(base.date, last.date) / 7),
    fresh: last.date >= weekFrom,
    arm: d(base.armCm, last.armCm),
    chest: d(base.chestCm, last.chestCm),
    shoulders: d(base.shouldersCm, last.shouldersCm),
    thigh: d(base.thighCm, last.thighCm),
    waist: d(waistAt(base.date), waistAt(last.date)),
  };
}

type Advice = Pick<CoachReport, 'summary' | 'wins' | 'changes' | 'focus'>;

/** Offline coach: deterministic rules over the week's stats. */
export function rulesReport(s: WeekStats): Advice {
  const trained = s.exercises.filter(e => e.outcome !== 'not trained');
  const up = trained.filter(e => e.outcome === 'progressed' || e.outcome === 'weight-up');
  const failed = trained.filter(e => e.failedStreak >= 2);
  const cutting = s.nutritionPhase?.type === 'cut';
  const heldInCut = cutting ? trained.filter(e => e.outcome === 'held') : [];

  const parts = [`${s.workoutsDone} of ${s.workoutsPlanned} workouts`];
  if (trained.length) parts.push(cutting ? `${up.length + heldInCut.length} of ${trained.length} lifts held or improved` : `${up.length} of ${trained.length} exercises progressed`);
  if (s.nutritionPhase?.actualRateKgPerWeek != null) parts.push(`weight ${s.nutritionPhase.actualRateKgPerWeek >= 0 ? '+' : ''}${s.nutritionPhase.actualRateKgPerWeek}kg/week`);
  const good = s.workoutsDone >= s.workoutsPlanned && (up.length + heldInCut.length) >= trained.length / 2;
  const summary = `${good ? 'Solid week' : s.workoutsDone === 0 ? 'Quiet week' : 'Mixed week'}: ${parts.join(', ')}.`;

  const wins: string[] = [];
  s.exercises.filter(e => e.outcome === 'weight-up').slice(0, 2).forEach(e => wins.push(`${e.name}: moved up in weight — ${e.detail.split(',')[0]}.`));
  s.exercises.filter(e => e.outcome === 'progressed').slice(0, 2).forEach(e => wins.push(`${e.name}: more reps — ${e.detail.split(',')[0]}.`));
  if (cutting && heldInCut.length) wins.push(`Held strength on ${heldInCut.length} lifts while dieting — that's muscle kept.`);
  if (s.workoutsDone >= s.workoutsPlanned) wins.push(`Hit all ${s.workoutsPlanned} planned sessions. Promise kept.`);
  if (s.nutritionPhase?.status === 'on-track') wins.push('Bodyweight is moving exactly as planned.');
  const { avgSleepHours: hrs, nightsLogged, nightsUnder6h } = s.recovery;
  if (hrs != null && nightsLogged >= 5 && hrs >= 7.5) wins.push(`Averaged ${hrs}h of sleep — that's where the muscle gets built.`);
  // Monthly tape: arms/chest up with a steady waist is muscle; a growing waist alone is fat.
  const t = s.tape;
  const sign = (n: number | null) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n}cm`);
  if (t?.fresh) {
    const gain = Math.max(t.arm ?? -9, t.chest ?? -9);
    if (gain >= 0.5 && (t.waist ?? 0) <= 1) {
      wins.push(`Tape over ${t.weeks} weeks: arms ${sign(t.arm)}, chest ${sign(t.chest)}, waist ${sign(t.waist)} — that's muscle, not fat.`);
    }
  }
  if (s.protein.target && s.protein.daysHit >= 6) wins.push(`Protein target hit ${s.protein.daysHit} of 7 days.`);
  if (!wins.length) wins.push(s.workoutsDone ? 'You showed up. Build on it this week.' : 'Nothing logged yet — this week is a clean slate.');

  const changes: string[] = [];
  const disrupted = s.disruptions.length > 0;
  if (t?.fresh && s.nutritionPhase?.type === 'bulk' && (t.waist ?? 0) >= 1.5 && Math.max(t.arm ?? 0, t.chest ?? 0) < 0.5) {
    changes.push(`Waist ${sign(t.waist)} in ${t.weeks} weeks but arms and chest barely moved — the extra is mostly fat. Trim about 150 kcal/day and keep pushing the lifts.`);
  }
  if (disrupted) {
    changes.push(`${s.disruptions.join(', ')} this week — no catching up and no crash dieting. Straight back to the normal plan; the scale will read high for a few days (water), so ignore it.`);
  }
  for (const e of failed.slice(0, 2)) {
    changes.push(`${e.name} has been below your rep range ${e.failedStreak} sessions running. Drop the weight 5–10% and rebuild to the top of the range.`);
  }
  if (s.deloadDue) changes.push('Most lifts have stalled over two weeks. Take the deload week — you will come back stronger.');
  if (s.workoutsDone < s.workoutsPlanned && !disrupted) {
    changes.push(`You trained ${s.workoutsDone} of ${s.workoutsPlanned} times. If a day doesn't work, move it on the week planner rather than skipping it.`);
  }
  if (!disrupted && s.nutritionPhase && s.nutritionPhase.status !== 'on-track' && s.nutritionPhase.status !== 'unknown') changes.push(s.nutritionPhase.advice);
  if (s.protein.target && s.protein.daysLogged >= 3 && (s.protein.average ?? 0) < s.protein.target * 0.9) {
    changes.push(`Protein averaged ${s.protein.average}g vs ${s.protein.target}g. Add a shake or an extra portion of meat/Greek yoghurt daily — it's the cheapest muscle insurance there is.`);
  }
  const low = s.volume.filter(v => v.sets < v.range[0] && s.workoutsDone >= Math.max(1, s.workoutsPlanned - 1));
  if (low.length) changes.push(`Low volume this week: ${low.slice(0, 3).map(v => `${v.muscle} ${v.sets} sets (aim ${v.range[0]}+)`).join(', ')}. Add a set or two to those exercises.`);
  const high = s.volume.filter(v => v.sets > v.range[1]);
  if (high.length) changes.push(`Very high volume: ${high.map(v => `${v.muscle} ${v.sets} sets`).join(', ')}. More isn't better past ~20 — trim a set and push intensity.`);
  if (hrs != null && nightsLogged >= 3 && (hrs < 7 || nightsUnder6h >= 2)) {
    const short = nightsUnder6h ? ` with ${nightsUnder6h} night${nightsUnder6h > 1 ? 's' : ''} under 6h` : '';
    changes.push(`Sleep averaged ${hrs}h${short}. Muscle is built while you sleep — get to 7–9 hours before chasing more weight. Set a fixed bedtime 8 hours before your alarm.`);
  }
  if (s.calories.daysLogged < 4 && s.calories.target) changes.push(`Calories logged on ${s.calories.daysLogged} of 7 days. Even rough logs let me fine-tune your target — I'm steering by the scale until then.`);
  // After ~8 solid weeks, add volume where it pays most: fast-recovering muscles, on days they aren't trained.
  const solid = s.weeksOnProgram >= 8 && s.workoutsDone >= s.workoutsPlanned && !failed.length && !disrupted && !s.deloadDue;
  if (solid && changes.length < 3) {
    const extra: Record<string, string> = {
      'Side delts': '2–3 sets of cable lateral raises at the end of Legs or Pull',
      Biceps: '2 sets of incline DB curls at the end of Push',
      'Rear delts': '2 sets of rear delt flyes at the end of Push or Legs',
      Calves: 'a 4th set of calf raises on Lower and Legs',
    };
    const pick = s.volume.filter(v => extra[v.muscle]).sort((a, b) => a.sets / a.range[0] - b.sets / b.range[0])[0];
    if (pick) changes.push(`${s.weeksOnProgram} solid weeks in — you've earned a specialisation block. ${pick.muscle} is at ${pick.sets} sets: add ${extra[pick.muscle]}. Keep it for 4–6 weeks, then reassess.`);
  }
  if (s.rampUp) changes.push('You are still in the ramp-up weeks: beat your targets and the app jumps 2 reps at a time. Leave 1–2 reps in the tank.');
  if (!changes.length) changes.push('Keep everything the same. The plan is working — beat last week by one rep.');

  const focus = failed.length
    ? 'Reset the stuck lifts, nail sleep and protein, and the numbers will move again.'
    : cutting
      ? 'Hold the weights, hit protein, trust the deficit. The muscle stays.'
      : up.length
        ? 'Momentum is on your side. One more rep, every session.'
        : 'Show up for every planned session this week. Nothing else matters until that is done.';

  return { summary, wins: wins.slice(0, 4), changes: changes.slice(0, 4), focus };
}
