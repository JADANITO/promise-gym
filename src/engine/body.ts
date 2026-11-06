import type { ClothesFit, DailyCheckIn, LifeEvent, Measurement, NutritionPhase, NutritionPhaseType, Profile, WeeklyTarget } from '../types';
import { addDays, daysBetween } from './dates';
import { KCAL_PER_KG, calories as calorieSeries, mean, movingAverage, slopePerDay, weights as weightSeries } from './stats';

/**
 * The PT brain for body composition: body fat from waist, lean/fat mass, the bulk/cut roadmap,
 * and weekly calorie/protein targets that adapt to what actually happens.
 */

export const BULK_MIN_WEEKS = 12;
export const CUT_MAX_WEEKS = 12;
export const MAINTAIN_WEEKS = 2;
/** Share of a lean bulk's weight gain that is lean tissue: higher while regaining old muscle. */
export const REGAIN_LEAN_SHARE = 0.7;
export const NEW_LEAN_SHARE = 0.5;
/** Share of weight lost on a lean cut (high protein, lifting) that is fat. */
export const CUT_FAT_SHARE = 0.85;
export const REGAIN_RATE = 0.35;
export const LEAN_BULK_RATE = 0.25;
export const CUT_RATE_PCT = 0.005;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Relative Fat Mass (men): needs only height and waist. Population formula, so we calibrate it per person. */
export function rfm(heightCm: number, waistCm: number): number {
  return 64 - (20 * heightCm) / waistCm;
}

/**
 * Body fat from waist, calibrated to the user's own baseline. Where someone stores fat shifts the
 * formula's absolute number, but changes in *your* waist track changes in *your* fat well.
 */
export function bodyFatFromWaist(profile: Profile, waistCm: number): number | null {
  if (!profile.heightCm) return null;
  const offset = profile.baseline ? profile.baseline.bodyFat - rfm(profile.heightCm, profile.baseline.waistCm) : 0;
  return Math.min(45, Math.max(4, rfm(profile.heightCm, waistCm) + offset));
}

/**
 * Drop scale readings from illness or time away (and 3 days after): holiday salt and carbs, or an
 * illness, swing water weight a kilo or two that isn't fat or muscle and would wreck the trend.
 */
export function excludeDisrupted(checkIns: DailyCheckIn[], events: LifeEvent[] = []): DailyCheckIn[] {
  const spans = events.filter(e => e.type === 'ill' || e.type === 'away').map(e => [e.from, addDays(e.to, 3)] as const);
  if (!spans.length) return checkIns;
  return checkIns.map(c => (spans.some(([a, b]) => c.date >= a && c.date <= b) ? { ...c, bodyweight: undefined, calories: undefined } : c));
}

export function trendWeight(checkIns: DailyCheckIn[]): number | null {
  const ma = movingAverage(weightSeries(checkIns));
  return ma.length ? ma[ma.length - 1].value : null;
}

/** kg/week from the last `days` of weigh-ins (needs at least 4). */
export function weeklyRate(checkIns: DailyCheckIn[], today: string, days = 14): number | null {
  const pts = weightSeries(checkIns).filter(p => p.date > addDays(today, -days) && p.date <= today);
  if (pts.length < 4) return null;
  const s = slopePerDay(pts);
  return s == null ? null : s * 7;
}

export interface Composition {
  weight: number;
  bodyFat: number;
  lean: number;
  fat: number;
  source: 'waist' | 'model' | 'baseline';
}

/** Best current estimate of weight, body fat, lean and fat mass. */
export function composition(profile: Profile, checkIns: DailyCheckIn[], measurements: Measurement[], today: string): Composition | null {
  const w = trendWeight(checkIns) ?? profile.baseline?.weight;
  if (w == null) return null;
  const recent = [...measurements].filter(m => m.date <= today).sort((a, b) => b.date.localeCompare(a.date))[0];
  let bf: number | null = null;
  let source: Composition['source'] = 'baseline';
  if (recent && daysBetween(recent.date, today) <= 21) {
    bf = bodyFatFromWaist(profile, recent.waistCm);
    source = 'waist';
  }
  if (bf == null && profile.baseline) {
    // Model it: gains on a lean bulk are ~40% fat, losses on a cut ~85% fat.
    const b = profile.baseline;
    const dw = w - b.weight;
    const fat = b.weight * (b.bodyFat / 100) + dw * (dw >= 0 ? 1 - REGAIN_LEAN_SHARE + 0.1 : CUT_FAT_SHARE);
    bf = (fat / w) * 100;
    source = dw === 0 ? 'baseline' : 'model';
  }
  if (bf == null) return null;
  return { weight: w, bodyFat: bf, lean: w * (1 - bf / 100), fat: (w * bf) / 100, source };
}

export function peakLean(profile: Profile): number | null {
  return profile.peak ? profile.peak.weight * (1 - profile.peak.bodyFat / 100) : null;
}

/** Bulk speed: faster while regaining muscle you've had before (muscle memory). */
export function bulkRate(lean: number, peak: number | null): { rate: number; leanShare: number; regaining: boolean } {
  const regaining = peak != null && lean < peak - 0.5;
  return regaining ? { rate: REGAIN_RATE, leanShare: REGAIN_LEAN_SHARE, regaining } : { rate: LEAN_BULK_RATE, leanShare: NEW_LEAN_SHARE, regaining };
}

export const cutRate = (weight: number) => -Math.round(weight * CUT_RATE_PCT * 20) / 20;

/** Weight you'd land at after cutting to the goal body fat from this lean mass (losing ~1% of lean). */
const landing = (lean: number, goalBf: number) => (lean * 0.99) / (1 - goalBf / 100);

export function goalReached(c: Pick<Composition, 'weight' | 'bodyFat' | 'lean'>, profile: Profile): boolean {
  return c.bodyFat <= profile.goalBodyFat + 0.75 && c.lean / (1 - profile.goalBodyFat / 100) >= profile.goalWeight - 0.75;
}

export interface RoadmapStep {
  type: NutritionPhaseType | 'goal';
  startDate: string;
  endDate: string;
  weeks: number;
  rate: number;
  startWeight: number;
  endWeight: number;
  startBf: number;
  endBf: number;
  note: string;
}

/**
 * Simulate week by week from today's composition to the goal using the phase rules.
 * The current phase continues from where it is; later phases follow the rules.
 */
export function simulateRoadmap(
  start: Composition,
  profile: Profile,
  today: string,
  current?: { type: NutritionPhaseType; weeksIn: number },
): RoadmapStep[] {
  const peak = peakLean(profile);
  let lean = start.lean, fat = start.fat;
  let type: NutritionPhaseType = current?.type ?? (start.bodyFat >= profile.bulkCeiling ? 'cut' : 'bulk');
  let weeksIn = current?.weeksIn ?? 0;
  let date = today;
  const steps: RoadmapStep[] = [];
  let step: RoadmapStep | null = null;
  const w = () => lean + fat;
  const bf = () => (fat / w()) * 100;

  const open = (t: NutritionPhaseType, rate: number, note: string) => {
    step = { type: t, startDate: date, endDate: date, weeks: 0, rate, startWeight: r1(w()), endWeight: r1(w()), startBf: r1(bf()), endBf: r1(bf()), note };
    steps.push(step);
  };
  const noteFor = (t: NutritionPhaseType) => {
    if (t === 'bulk') return bulkRate(lean, peak).regaining ? 'Lean bulk — regaining old muscle (muscle memory)' : 'Lean bulk — building new muscle';
    if (t === 'cut') return goalReachedAfterCut() ? 'Final cut to goal' : 'Lean cut back to lean';
    return 'Maintenance — consolidate before the next phase';
  };
  const goalReachedAfterCut = () => landing(lean, profile.goalBodyFat) >= profile.goalWeight - 0.75;
  open(type, type === 'bulk' ? bulkRate(lean, peak).rate : type === 'cut' ? cutRate(w()) : 0, noteFor(type));

  for (let week = 0; week < 52 * 6; week++) {
    if (goalReached({ weight: w(), bodyFat: bf(), lean }, profile) && type !== 'bulk') {
      const s = step as RoadmapStep | null;
      if (s) { s.endDate = date; s.endWeight = r1(w()); s.endBf = r1(bf()); }
      steps.push({ type: 'goal', startDate: date, endDate: date, weeks: 0, rate: 0, startWeight: r1(w()), endWeight: r1(w()), startBf: r1(bf()), endBf: r1(bf()), note: 'Goal reached — maintain' });
      break;
    }
    // Decide whether the current phase ends this week.
    let next: NutritionPhaseType | null = null;
    if (type === 'bulk') {
      const enough = weeksIn >= BULK_MIN_WEEKS || bf() >= profile.bulkCeiling + 1;
      if ((enough && bf() >= profile.bulkCeiling) || landing(lean, profile.goalBodyFat) >= profile.goalWeight + 0.25) next = 'cut';
    } else if (type === 'cut') {
      if (bf() <= profile.goalBodyFat || weeksIn >= CUT_MAX_WEEKS) next = 'maintain';
    } else if (weeksIn >= MAINTAIN_WEEKS) {
      next = 'bulk';
    }
    if (next) {
      const s = step as RoadmapStep | null;
      if (s) { s.endDate = date; s.endWeight = r1(w()); s.endBf = r1(bf()); }
      type = next;
      weeksIn = 0;
      open(type, type === 'bulk' ? bulkRate(lean, peak).rate : type === 'cut' ? cutRate(w()) : 0, noteFor(type));
      continue;
    }
    // Advance one week.
    if (type === 'bulk') {
      const { rate, leanShare } = bulkRate(lean, peak);
      lean += rate * leanShare;
      fat += rate * (1 - leanShare);
    } else if (type === 'cut') {
      const loss = -cutRate(w());
      fat -= loss * CUT_FAT_SHARE;
      lean -= loss * (1 - CUT_FAT_SHARE);
    }
    weeksIn++;
    date = addDays(date, 7);
    const s = step as RoadmapStep | null;
    if (s) { s.weeks++; s.endDate = date; s.endWeight = r1(w()); s.endBf = r1(bf()); }
  }
  for (const s of steps) if (s.weeks > 0) s.rate = r2((s.endWeight - s.startWeight) / s.weeks);
  return steps;
}

/** Katch–McArdle BMR × activity for ~5 lifting sessions a week. A starting guess until real data arrives. */
export function estimatedMaintenance(lean: number): number {
  return Math.round(((370 + 21.6 * lean) * 1.55) / 10) * 10;
}

/** Real maintenance from intake vs weight trend over the last 3 weeks. Null until there's enough data. */
export function adaptiveMaintenance(checkIns: DailyCheckIn[], today: string, days = 21): number | null {
  const from = addDays(today, -days);
  const kc = calorieSeries(checkIns).filter(p => p.date > from && p.date < today);
  const ws = weightSeries(checkIns).filter(p => p.date > from && p.date <= today);
  if (kc.length < 10 || ws.length < 8) return null;
  const slope = slopePerDay(ws);
  if (slope == null) return null;
  return Math.round(mean(kc.map(p => p.value))! - slope * KCAL_PER_KG);
}

export function proteinTarget(weight: number, type: NutritionPhaseType): number {
  return Math.round((weight * (type === 'cut' ? 2.2 : 2.0)) / 5) * 5;
}

/** Next week's calorie and protein targets. */
export function nextTargets(input: {
  phase: Pick<NutritionPhase, 'type' | 'targetRate'>;
  comp: Composition;
  checkIns: DailyCheckIn[];
  previous?: WeeklyTarget;
  today: string;
  weekStart: string;
}): WeeklyTarget {
  const { phase, comp, checkIns, previous, today, weekStart } = input;
  const surplus = (phase.targetRate * KCAL_PER_KG) / 7;
  const adaptive = adaptiveMaintenance(checkIns, today);
  const actual = weeklyRate(checkIns, today);
  let maintenance: number;
  let method: WeeklyTarget['method'];
  let note: string;

  if (adaptive != null) {
    // Smooth against last week's estimate so one odd week doesn't swing the target.
    maintenance = previous ? Math.round(previous.maintenance * 0.4 + adaptive * 0.6) : adaptive;
    method = 'adaptive';
    note = `Maintenance worked out from your last 3 weeks of intake and weight: ~${maintenance.toLocaleString()} kcal.`;
  } else if (previous && actual != null) {
    // Not enough food logs: steer by the scale instead, max ±250 kcal a week.
    const correction = Math.max(-250, Math.min(250, ((phase.targetRate - actual) * KCAL_PER_KG) / 7));
    maintenance = Math.round(previous.maintenance + correction);
    method = 'trend';
    note = `Adjusted from your weight trend (${actual >= 0 ? '+' : ''}${r2(actual)}kg/week vs ${phase.targetRate >= 0 ? '+' : ''}${phase.targetRate}kg/week planned).`;
  } else {
    maintenance = previous?.maintenance ?? estimatedMaintenance(comp.lean);
    method = 'estimate';
    note = 'Starting estimate from your lean mass. Log calories most days and this gets personal within 3 weeks.';
  }
  const kcal = Math.round((maintenance + surplus) / 25) * 25;
  return { weekStart, kcal, protein: proteinTarget(comp.weight, phase.type), maintenance, method, note };
}

export function targetFor(targets: WeeklyTarget[], date: string): WeeklyTarget | undefined {
  return [...targets].filter(t => t.weekStart <= date).sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
}

export interface PhaseStatus {
  actual: number | null;
  target: number;
  status: 'on-track' | 'fast' | 'slow' | 'unknown';
  advice: string;
}

/** Is the scale moving at the phase's planned rate? */
export function phaseStatus(phase: Pick<NutritionPhase, 'type' | 'targetRate'>, checkIns: DailyCheckIn[], today: string): PhaseStatus {
  const actual = weeklyRate(checkIns, today);
  const target = phase.targetRate;
  if (actual == null) return { actual, target, status: 'unknown', advice: 'A few more morning weigh-ins and I can see your trend.' };
  // A PT would act on being ~25% off pace; the 14-day trend is steady enough to judge that.
  const tol = Math.max(0.07, Math.abs(target) * 0.25);
  const diff = actual - target;
  const kcal = Math.round(Math.abs(diff * KCAL_PER_KG) / 7 / 25) * 25;
  const fmt = (n: number) => `${n >= 0 ? '+' : ''}${r2(n)}kg/wk`;
  if (Math.abs(diff) <= tol) return { actual, target, status: 'on-track', advice: `On track: ${fmt(actual)} vs ${fmt(target)} planned.` };
  if (diff > 0) {
    const advice = phase.type === 'bulk'
      ? `Gaining faster than planned (${fmt(actual)} vs ${fmt(target)}) — that's extra fat, not extra muscle. About ${kcal} kcal/day less.`
      : phase.type === 'cut' ? `Not losing fast enough (${fmt(actual)} vs ${fmt(target)}). About ${kcal} kcal/day less.`
        : `Drifting up ${fmt(actual)}. About ${kcal} kcal/day less.`;
    return { actual, target, status: phase.type === 'cut' ? 'slow' : 'fast', advice };
  }
  const advice = phase.type === 'bulk'
    ? `Gaining slower than planned (${fmt(actual)} vs ${fmt(target)}). About ${kcal} kcal/day more.`
    : phase.type === 'cut' ? `Losing faster than planned (${fmt(actual)}) — you risk losing muscle. About ${kcal} kcal/day more.`
      : `Drifting down ${fmt(actual)}. About ${kcal} kcal/day more.`;
  return { actual, target, status: phase.type === 'cut' ? 'fast' : 'slow', advice };
}

export interface PhaseRecommendation {
  action: 'stay' | 'cut' | 'maintain' | 'bulk';
  reason: string;
}

/** Should the current phase end? Used at the Sunday check-in; the user always confirms. */
export function recommendPhase(input: {
  phase: NutritionPhase;
  comp: Composition;
  profile: Profile;
  clothes: ClothesFit[]; // most recent first
  waistCm?: number;
  today: string;
}): PhaseRecommendation {
  const { phase, comp, profile, clothes, waistCm, today } = input;
  const weeks = Math.floor(daysBetween(phase.startDate, today) / 7);
  if (phase.type === 'bulk') {
    const tight = clothes.slice(0, 3).filter(c => c === 'tighter').length >= 2;
    const waistUp = waistCm != null && phase.startWaistCm != null && waistCm - phase.startWaistCm >= 4;
    const atCeiling = comp.bodyFat >= profile.bulkCeiling;
    const finalBulk = landing(comp.lean, profile.goalBodyFat) >= profile.goalWeight + 0.25;
    if (finalBulk) return { action: 'cut', reason: `You've built enough muscle to hit ${profile.goalWeight}kg at ${profile.goalBodyFat}% once you lean out. Time for the final cut.` };
    if (weeks >= BULK_MIN_WEEKS && (atCeiling || tight || waistUp)) {
      const why = atCeiling ? `body fat is ~${r1(comp.bodyFat)}%` : waistUp ? `your waist is up ${r1(waistCm! - phase.startWaistCm!)}cm` : 'your clothes have been getting tighter';
      return { action: 'cut', reason: `${weeks} weeks in and ${why}. Lean out now so the next bulk starts lean.` };
    }
    if (comp.bodyFat >= profile.bulkCeiling + 1.5) return { action: 'cut', reason: `Body fat is ~${r1(comp.bodyFat)}% — above your ${profile.bulkCeiling}% ceiling. Cut early.` };
    return { action: 'stay', reason: `Keep bulking — ~${r1(comp.bodyFat)}% body fat, ceiling ${profile.bulkCeiling}%.` };
  }
  if (phase.type === 'cut') {
    if (goalReached(comp, profile)) return { action: 'maintain', reason: `Goal reached: ~${r1(comp.weight)}kg at ~${r1(comp.bodyFat)}%. Switch to maintenance.` };
    if (comp.bodyFat <= profile.goalBodyFat + 0.5) return { action: 'maintain', reason: `You're lean (~${r1(comp.bodyFat)}%). Two weeks at maintenance, then build again.` };
    if (weeks >= CUT_MAX_WEEKS) return { action: 'maintain', reason: `${weeks} weeks of dieting is enough for now — take a maintenance break.` };
    return { action: 'stay', reason: `Keep cutting — ~${r1(comp.bodyFat)}% body fat, aiming for ~${profile.goalBodyFat}%.` };
  }
  if (goalReached(comp, profile)) return { action: 'stay', reason: 'At your goal — keep maintaining and keep getting stronger.' };
  if (weeks >= MAINTAIN_WEEKS) return { action: 'bulk', reason: 'Maintenance done. Time to build again.' };
  return { action: 'stay', reason: `Maintenance week ${weeks + 1} of ${MAINTAIN_WEEKS}.` };
}

/** Planned rate for a new phase. */
export function rateFor(type: NutritionPhaseType, comp: Composition, profile: Profile): number {
  if (type === 'bulk') return bulkRate(comp.lean, peakLean(profile)).rate;
  if (type === 'cut') return cutRate(comp.weight);
  return 0;
}
