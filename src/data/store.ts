import { ACTIVITY_FACTOR, LEAN_BULK_RATE, REGAIN_RATE } from '../engine/body';
import { KCAL_PER_KG } from '../engine/stats';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { del, get, set } from 'idb-keyval';
import type {
  BodyMeasurement, CableStation, CoachReport, DailyCheckIn, Exercise, ExerciseOverride, LifeEvent, LoggedExercise, LoggedSet, Measurement, Muscle,
  NutritionPhase, NutritionPhaseType, Phase, Photo, Profile, Settings, TemplateExercise, WeeklyCheckIn, WeeklyTarget, WorkoutSession,
  WorkoutTemplate,
} from '../types';
import { computeProgress, learnDrops, planExercise, setTargets, targetAfterIncrease } from '../engine/progression';
import { deloadFinished, deloadPrescription, roundTo } from '../engine/phases';
import { addDays, daysBetween, parseYmd, weekStart, ymd } from '../engine/dates';
import { DAY_NAMES, eventOn, plannedFor, plannedPerWeek } from '../engine/schedule';
import { BUILT_IN_EXERCISES, slug } from './library';
import { PROGRAM_VERSION, buildProgram, patchProgramTemplates } from './program';
import { warmupRamp, type WarmupStep } from '../engine/warmup';
import { estimateSec, isCompound, planTimeCut, type CutItem, type CutPlan } from '../engine/timecut';
import { deletePhotoBlob, savePhotoBlob } from './photos';
import { fmtLoad, uid } from '../format';

export interface ActiveExercise extends LoggedExercise {
  /** Working weight the engine suggested before any edits. */
  baseWeight: number;
  reason: string;
  flagged: boolean;
  /** The user has answered the "increase the weight" prompt for this session. */
  increaseHandled?: boolean;
  /** First time doing this exercise (or on this cable station): ask for a starting weight. */
  firstWeight?: boolean;
  increment?: number;
  /** Typical reps lost per set, learned from history (index 0 = 0). */
  drops: number[];
  /** The template exercise this came from, to rebuild it (e.g. on a station switch). */
  source: TemplateExercise;
  /** Superset partner (another exercise in this workout): alternate sets, rest after both. */
  pairWith?: string;
}

export interface ActiveWorkout {
  session: Omit<WorkoutSession, 'exercises'> & { exercises: ActiveExercise[] };
  holdTargets: boolean;
}

export interface RestTimer {
  endAt: number | null;
  pausedLeft: number | null; // ms left while paused
  total: number; // seconds
  label: string;
}

export const DEFAULT_SETTINGS: Settings = {
  units: 'kg',
  nutritionModel: 2,
  defaultRestSec: 90,
  basis: 'first',
  minPhaseWeeks: 4,
  deloadWeightPct: 0.875,
  deloadSetFactor: 0.5,
  weightRounding: 2.5,
  workoutsPerWeek: 5,
  schedule: [null, null, null, null, null, null, null],
  scheduleOverrides: {},
  lengthUnits: 'in',
  weighInTime: '07:30',
  caloriesTime: '21:00',
  coachDay: 0,
  coachTime: '19:00',
  keepAwake: true,
  timerSound: true,
  customQuotes: [],
  onboarded: false,
};

interface Data {
  customExercises: Exercise[];
  templates: WorkoutTemplate[];
  sessions: WorkoutSession[];
  phases: Phase[];
  checkIns: Record<string, DailyCheckIn>;
  profile: Profile;
  nutritionPhases: NutritionPhase[];
  measurements: Measurement[];
  weeklyTargets: WeeklyTarget[];
  weeklyCheckIns: WeeklyCheckIn[];
  photos: Photo[];
  circumferences: BodyMeasurement[];
  lifeEvents: LifeEvent[];
  exerciseOverrides: ExerciseOverride[];
  reports: CoachReport[];
  settings: Settings;
  active: ActiveWorkout | null;
  timer: RestTimer | null;
  notified: Record<string, string>; // reminder key → date last notified
}

export interface SwapOption {
  date: string;
  templateId: string;
  templateName: string;
  te: TemplateExercise;
  label: string;
}

interface Actions {
  // library
  exercises: () => Exercise[];
  exercise: (id: string) => Exercise | undefined;
  exerciseName: (id: string) => string;
  addCustomExercise: (name: string, primary?: Muscle[]) => Exercise;
  // templates
  saveTemplate: (t: WorkoutTemplate) => void;
  deleteTemplate: (id: string) => void;
  duplicateTemplate: (id: string) => void;
  // workout
  startWorkout: (templateId: string, holdTargets: boolean) => void;
  updateActive: (fn: (a: ActiveWorkout) => void) => void;
  completeSet: (exId: string, setId: string) => boolean;
  retarget: (exId: string) => void;
  setIncreaseWeight: (exId: string, kg: number) => void;
  applyWeight: (exId: string, kg: number, mode: 'working' | 'today') => void;
  setStation: (exId: string, station: CableStation) => void;
  addExerciseToActive: (exerciseId: string, kg: number) => void;
  swapExercise: (exId: string, exerciseId: string) => void;
  swapOptions: () => SwapOption[];
  swapAcrossWeek: (exId: string, option: SwapOption) => void;
  doLater: (exId: string) => void;
  minutesLeft: () => number;
  previewTimeCut: (minutes: number) => CutPlan | null;
  applyTimeCut: (minutes: number) => CutPlan | null;
  finishWorkout: (opts: { saveToTemplate: boolean }) => WorkoutSession | null;
  discardWorkout: () => void;
  deleteSession: (id: string) => void;
  updateSession: (s: WorkoutSession) => void;
  // timer
  startTimer: (sec: number, label: string) => void;
  adjustTimer: (deltaSec: number) => void;
  togglePauseTimer: () => void;
  clearTimer: () => void;
  // check-ins
  setCheckIn: (date: string, patch: Partial<DailyCheckIn>) => void;
  // phases
  tickPhases: () => void;
  answerPlateau: (plateaued: boolean) => void;
  endDeloadEarly: () => void;
  currentPhase: () => Phase | undefined;
  // body & plan
  setProfile: (p: Partial<Profile>) => void;
  currentNutritionPhase: () => NutritionPhase | undefined;
  startNutritionPhase: (type: NutritionPhaseType, targetRate: number, reason: string, startWeight?: number, startWaistCm?: number) => void;
  addMeasurement: (m: Measurement) => void;
  addCircumferences: (m: BodyMeasurement) => void;
  setWeeklyTarget: (t: WeeklyTarget) => void;
  completeWeeklyCheckIn: (c: WeeklyCheckIn) => void;
  addPhoto: (blob: Blob, pose: Photo['pose'], date: string) => Promise<Photo>;
  deletePhoto: (id: string) => Promise<void>;
  // schedule & life
  loadProgram: () => void;
  setScheduleDay: (dow: number, templateId: string | null) => void;
  setOverride: (date: string, templateId: string | null | undefined) => void;
  addLifeEvent: (e: Omit<LifeEvent, 'id'>, opts?: { moveToday?: boolean }) => string | null;
  endLifeEvent: (id: string) => void;
  eventToday: () => LifeEvent | undefined;
  // misc
  setSettings: (s: Partial<Settings>) => void;
  addReport: (r: CoachReport) => void;
  markNotified: (key: string, date: string) => void;
  exportData: () => string;
  importData: (json: string) => void;
  resetAll: () => void;
}

export type Store = Data & Actions;

const initialData: Data = {
  customExercises: [],
  templates: [],
  sessions: [],
  phases: [],
  checkIns: {},
  profile: { name: 'Jaden', goalWeight: 0, goalBodyFat: 12, bulkCeiling: 16 },
  nutritionPhases: [],
  measurements: [],
  weeklyTargets: [],
  weeklyCheckIns: [],
  photos: [],
  circumferences: [],
  lifeEvents: [],
  exerciseOverrides: [],
  reports: [],
  settings: DEFAULT_SETTINGS,
  active: null,
  timer: null,
  notified: {},
};

const idbStorage: StateStorage = {
  getItem: async name => (await get<string>(name)) ?? null,
  setItem: async (name, value) => set(name, value),
  removeItem: async name => del(name),
};

const LOWER_BODY: Muscle[] = ['quads', 'hamstrings', 'glutes', 'calves'];

function warmupSetsFor(steps: WarmupStep[]): LoggedSet[] {
  return steps.map(st => ({ id: uid(), weight: st.weight, targetReps: st.reps, reps: st.reps, completed: false, warmup: true }));
}

/** Warm-up steps for an exercise at a working weight: an auto ramp, or the template's fixed count at 50%. */
function warmupSteps(te: TemplateExercise, weight: number, kind: string, settings: Settings, firstReps: number): WarmupStep[] {
  if (kind !== 'weighted' || weight <= 0) return [];
  if (te.autoWarmup) {
    const rounding = te.increment && te.increment < settings.weightRounding ? te.increment : settings.weightRounding;
    return warmupRamp(weight, { loading: te.loading, barKg: settings.barKg ?? 20, rounding });
  }
  return Array.from({ length: te.warmupSets ?? 0 }, () => ({ weight: roundTo(weight * 0.5, settings.weightRounding), reps: firstReps }));
}

function makeSets(targets: number[], weight: number, warmups: WarmupStep[]): LoggedSet[] {
  const work: LoggedSet[] = targets.map(t => ({ id: uid(), weight, targetReps: t, reps: t, completed: false, warmup: false }));
  return [...warmupSetsFor(warmups), ...work];
}

/** Rebuild the not-yet-done warm-ups for a new working weight (done ones stay as logged). */
function refreshWarmups(e: ActiveExercise, settings: Settings) {
  const done = e.sets.filter(s => s.warmup && s.completed);
  const fresh = warmupSetsFor(warmupSteps(e.source, e.workingWeight, e.kind ?? 'weighted', settings, e.targetReps)).slice(done.length);
  e.sets = [...done, ...fresh, ...e.sets.filter(s => !s.warmup)];
}

function cutItems(a: ActiveWorkout, exercise: (id: string) => Exercise | undefined): CutItem[] {
  return a.session.exercises.filter(e => !e.skipped).map(e => {
    const ex = exercise(e.exerciseId);
    return {
      id: e.id,
      name: ex?.name ?? e.exerciseId,
      restSec: e.restSec,
      setsLeft: e.sets.filter(s => !s.warmup && !s.completed).length,
      warmupsLeft: e.sets.filter(s => s.warmup && !s.completed).length,
      compound: isCompound(ex),
      primary: ex?.primary ?? [],
      isAbs: !!ex?.primary?.includes('abs'),
      started: e.sets.some(s => s.completed),
      pairWith: e.pairWith,
    };
  });
}

function toLogged(e: ActiveExercise): LoggedExercise {
  const { baseWeight: _b, reason: _r, flagged: _f, increaseHandled: _h, firstWeight: _fw, increment: _i, drops: _d, source: _s, ...rest } = e;
  const anyDone = rest.sets.some(s => s.completed && !s.warmup);
  return { ...rest, skipped: rest.skipped || !anyDone };
}

/**
 * The history that counts for one exercise: same exercise and cable station, preferring sessions in the
 * same rep range (so an exercise done 8–10 on one day and 10–12 on another keeps two tracks).
 * Falls back to the pre-app log (seed) when there's no real history yet.
 */
export function trackHistory(sessions: WorkoutSession[], te: TemplateExercise, station?: CableStation): { sessions: WorkoutSession[]; real: boolean } {
  const match = (le: LoggedExercise) => le.exerciseId === te.exerciseId && (!te.cable || (le.station ?? 'small') === station);
  const filtered = sessions
    .filter(s => !s.deload)
    .map(s => ({ ...s, exercises: s.exercises.filter(match) }))
    .filter(s => s.exercises.length)
    .sort((a, b) => a.startedAt - b.startedAt);
  const sameRange = filtered
    .map(s => ({ ...s, exercises: s.exercises.filter(le => le.repMin === te.repMin && le.repMax === te.repMax) }))
    .filter(s => s.exercises.length);
  const use = sameRange.length ? sameRange : filtered;
  if (use.length) return { sessions: use, real: true };
  const defaultStation = te.station ?? 'small';
  if (te.seed && (!te.cable || station === defaultStation)) {
    const seedLe: LoggedExercise = {
      id: 'seed', exerciseId: te.exerciseId, repMin: te.repMin, repMax: te.repMax, restSec: te.restSec,
      workingWeight: te.seed.weight, targetReps: te.repMin, increasePrompted: false, countsForProgression: true, skipped: false,
      technique: te.technique, station, kind: undefined,
      sets: te.seed.reps.map((r, i) => ({ id: `seed${i}`, weight: te.seed!.weight, targetReps: te.repMin, reps: r, completed: true, warmup: false })),
    };
    return { sessions: [{ id: 'seed', templateId: '', templateName: 'Before the app', startedAt: 0, phaseId: '', deload: false, exercises: [seedLe] }], real: false };
  }
  return { sessions: [], real: false };
}

export const useStore = create<Store>()(
  persist(
    (setState, getState) => {
      const mutate = (fn: (d: Data) => void) =>
        setState(s => {
          const copy = structuredClone(pickData(s));
          fn(copy);
          return copy;
        });

      const buildExercise = (te: TemplateExercise, holdTargets: boolean, deload: boolean, opts: { station?: CableStation; swappedFrom?: string } = {}): ActiveExercise => {
        const { sessions, settings } = getState();
        const ex = getState().exercise(te.exerciseId);
        const kind = ex?.kind ?? 'weighted';
        const technique = te.technique ?? 'straight';
        const station = te.cable ? opts.station ?? te.station ?? 'small' : undefined;
        const track = trackHistory(sessions, te, station);
        const offDefaultStation = !!te.cable && station !== (te.station ?? 'small');
        const startWeight = offDefaultStation ? 0 : te.startWeight;
        const state = computeProgress(te.exerciseId, track.sessions.map(s => ({ ...s, exercises: s.exercises.map(le => ({ ...le, kind })) })), settings.basis, startWeight, te.repMin);
        const fmt = (kg: number) => fmtLoad(kg, kind, settings.units);
        const plan = planExercise(state, { ...te, startWeight }, { holdTargets, fmt, kind });
        let weight = plan.weight, target = plan.target, sets = te.sets, reason = plan.reason, increaseDue = plan.increaseDue;
        const ramp = !!settings.rampUntil && ymd() <= settings.rampUntil;
        const firstWeight = !state.last && !startWeight && kind !== 'bodyweight';
        if (firstWeight) {
          increaseDue = true;
          reason = offDefaultStation
            ? `First time on the ${station} cable — its numbers differ. Pick a weight you could do for ~2 more reps than ${target}.`
            : ramp
              ? `First session back: pick a weight you could do for ~3 more reps than ${target}. Muscle memory will move it up fast.`
              : `First time: pick a weight you could do for ~2 more reps than ${target}.`;
        } else if (ramp && !deload) {
          reason += ' Ramp-up: beat the target and you jump 2 reps next time.';
        }
        // First leg sessions after time off: fewer sets, short of failure, to keep soreness manageable.
        if (ramp && !deload && !track.real && ex?.primary?.some(m => LOWER_BODY.includes(m))) {
          sets = Math.min(sets, 2);
          reason += ' First leg session back: 2 sets, stop 2–3 reps short of failure to limit soreness.';
        }
        if (technique === 'myo-match') reason += ' Myo-rep match: set 1 to failure, then match it on the other sets with short rest-pauses.';
        if (deload) {
          const d = deloadPrescription(plan.weight, te.sets, settings);
          // Easier means less load — or, on an assisted machine, more assistance.
          weight = kind === 'bodyweight' ? 0 : kind === 'assisted' ? roundTo(Math.max(plan.weight * 1.3, plan.weight + 5), settings.weightRounding) : d.weight;
          sets = d.sets; target = te.repMin; increaseDue = false;
          reason = `Deload: lighter weight, ${sets} sets. Leave plenty in the tank — this week doesn't change your progression.`;
        }
        if (opts.swappedFrom) reason = `Swapped in from ${opts.swappedFrom}. ${reason}`;
        const drops = learnDrops(track.sessions.flatMap(s => s.exercises), sets);
        const targets = setTargets(target, drops, sets, technique);
        return {
          id: uid(),
          exerciseId: te.exerciseId,
          repMin: te.repMin,
          repMax: te.repMax,
          restSec: te.restSec,
          machineNote: te.machineNote,
          workingWeight: weight,
          targetReps: target,
          increasePrompted: increaseDue,
          countsForProgression: true,
          skipped: false,
          ramp: ramp && !deload ? true : undefined,
          technique: te.technique,
          station,
          kind,
          swappedFrom: opts.swappedFrom,
          sets: makeSets(targets, weight, deload ? [] : warmupSteps(te, weight, kind, settings, targets[0])),
          baseWeight: weight,
          reason,
          flagged: plan.flagged,
          firstWeight: firstWeight || undefined,
          increment: te.increment,
          drops,
          source: te,
        };
      };

      /** Re-aim sets 2+ once set 1 is done: myo-match copies it, straight sets expect the usual drop. */
      const retargetIn = (e: ActiveExercise) => {
        const working = e.sets.filter(s => !s.warmup);
        const first = working[0];
        const base = first?.completed ? first.reps : e.targetReps;
        const targets = setTargets(base, e.drops, working.length, e.technique ?? 'straight');
        working.forEach((s, i) => {
          if (i === 0 || s.completed) return;
          s.targetReps = targets[i] ?? targets[targets.length - 1];
          s.reps = s.targetReps;
        });
      };

      return {
        ...initialData,

        exercises: () => [...BUILT_IN_EXERCISES, ...getState().customExercises].sort((a, b) => a.name.localeCompare(b.name)),
        exercise: id => BUILT_IN_EXERCISES.find(e => e.id === id) ?? getState().customExercises.find(e => e.id === id),
        exerciseName: id => getState().exercise(id)?.name ?? id,
        addCustomExercise: (name, primary) => {
          const existing = getState().exercises().find(e => e.name.toLowerCase() === name.trim().toLowerCase());
          if (existing) return existing;
          const ex: Exercise = { id: `${slug(name)}-${uid().slice(-4)}`, name: name.trim(), custom: true, primary };
          mutate(d => { d.customExercises.push(ex); });
          return ex;
        },

        saveTemplate: t => mutate(d => {
          const i = d.templates.findIndex(x => x.id === t.id);
          if (i >= 0) d.templates[i] = t; else d.templates.push(t);
        }),
        deleteTemplate: id => mutate(d => { d.templates = d.templates.filter(t => t.id !== id); }),
        duplicateTemplate: id => mutate(d => {
          const t = d.templates.find(x => x.id === id);
          if (t) d.templates.push({ ...structuredClone(t), id: uid(), name: `${t.name} (copy)`, exercises: t.exercises.map(e => ({ ...e, id: uid() })) });
        }),

        startWorkout: (templateId, holdTargets) => {
          const s = getState();
          const t = s.templates.find(x => x.id === templateId);
          if (!t) return;
          const phase = s.currentPhase();
          const deload = phase?.type === 'deload';
          const today = ymd();
          const overrides = s.exerciseOverrides.filter(o => o.date === today && o.templateId === t.id);
          setState({
            active: {
              holdTargets,
              session: {
                id: uid(),
                templateId: t.id,
                templateName: t.name,
                startedAt: Date.now(),
                phaseId: phase?.id ?? '',
                deload,
                exercises: t.exercises.map(te => {
                  const o = overrides.find(x => x.replaceTeId === te.id);
                  return o ? buildExercise(o.withTe, holdTargets, deload, { swappedFrom: o.fromLabel }) : buildExercise(te, holdTargets, deload);
                }),
              },
            },
            timer: null,
          });
        },

        updateActive: fn => mutate(d => { if (d.active) fn(d.active); }),

        completeSet: (exId, setId) => {
          let nowDone = false;
          mutate(d => {
            const e = d.active?.session.exercises.find(x => x.id === exId);
            const s = e?.sets.find(x => x.id === setId);
            if (!e || !s) return;
            s.completed = !s.completed;
            nowDone = s.completed;
            if (!s.warmup && e.sets.filter(x => !x.warmup)[0]?.id === setId) retargetIn(e);
          });
          return nowDone;
        },
        retarget: exId => mutate(d => {
          const e = d.active?.session.exercises.find(x => x.id === exId);
          if (e) retargetIn(e);
        }),

        setIncreaseWeight: (exId, kg) => mutate(d => {
          const e = d.active?.session.exercises.find(x => x.id === exId);
          if (!e) return;
          e.increaseHandled = true;
          const kind = e.kind ?? 'weighted';
          const target = targetAfterIncrease(kg, e.baseWeight, e.repMin, e.repMax, kind);
          const harder = kind === 'assisted' ? kg < e.baseWeight : kg > e.baseWeight;
          const label = fmtLoad(kg, kind, d.settings.units);
          e.workingWeight = kg;
          e.targetReps = target;
          e.countsForProgression = true;
          e.reason = e.firstWeight
            ? `Starting at ${label} — aim for ${target} reps on set 1, with 2–3 left in the tank.`
            : harder
              ? `${kind === 'assisted' ? 'Less assistance' : 'New weight'}: ${label} — back to the bottom of the range: ${target} reps.`
              : `Same load — aim for ${target} reps again.`;
          const targets = setTargets(target, e.drops, e.sets.filter(s => !s.warmup).length, e.technique ?? 'straight');
          let i = 0;
          for (const s of e.sets) {
            if (s.warmup) continue;
            s.weight = kg;
            s.targetReps = targets[i++] ?? target;
            if (!s.completed) s.reps = s.targetReps;
          }
          if (!d.active!.session.deload) refreshWarmups(e, d.settings);
        }),

        applyWeight: (exId, kg, mode) => {
          const e0 = getState().active?.session.exercises.find(x => x.id === exId);
          if (e0?.increasePrompted && !e0.increaseHandled && mode === 'working') return getState().setIncreaseWeight(exId, kg);
          mutate(d => {
            const e = d.active?.session.exercises.find(x => x.id === exId);
            if (!e) return;
            e.workingWeight = kg;
            e.countsForProgression = mode === 'working' || kg === e.baseWeight;
            for (const s of e.sets) if (!s.warmup) s.weight = kg;
            if (!d.active!.session.deload) refreshWarmups(e, d.settings);
          });
        },

        setStation: (exId, station) => {
          const { active } = getState();
          const cur = active?.session.exercises.find(x => x.id === exId);
          if (!active || !cur || cur.station === station) return;
          const rebuilt = buildExercise(cur.source, active.holdTargets, active.session.deload, { station, swappedFrom: cur.swappedFrom });
          mutate(d => {
            const list = d.active!.session.exercises;
            list[list.findIndex(x => x.id === exId)] = { ...rebuilt, id: cur.id };
          });
        },

        addExerciseToActive: (exerciseId, kg) => {
          const { settings, templates, active } = getState();
          if (!active) return;
          const fromTemplate = templates.flatMap(t => t.exercises).find(x => x.exerciseId === exerciseId);
          const te: TemplateExercise = fromTemplate ?? { id: uid(), exerciseId, sets: 3, repMin: 8, repMax: 12, restSec: settings.defaultRestSec, startWeight: kg };
          const ex = buildExercise({ ...te, startWeight: fromTemplate?.startWeight || kg }, active.holdTargets, active.session.deload);
          mutate(d => { d.active!.session.exercises.push(ex); });
        },

        swapExercise: (exId, exerciseId) => {
          const { active } = getState();
          const cur = active?.session.exercises.find(x => x.id === exId);
          if (!active || !cur) return;
          const ex = buildExercise(
            { id: uid(), exerciseId, sets: cur.sets.filter(s => !s.warmup).length, repMin: cur.repMin, repMax: cur.repMax, restSec: cur.restSec, startWeight: 0 },
            active.holdTargets, false,
          );
          mutate(d => {
            const list = d.active!.session.exercises;
            list[list.findIndex(x => x.id === exId)] = { ...ex, sets: active.session.deload ? cur.sets.map(s => ({ ...s, id: uid() })) : ex.sets };
          });
        },

        swapOptions: () => {
          const s = getState();
          if (!s.active) return [];
          const today = ymd();
          const sunday = addDays(weekStart(today), 6);
          const inToday = new Set(s.active.session.exercises.map(e => e.exerciseId));
          const out: SwapOption[] = [];
          for (let d = addDays(today, 1); d <= sunday; d = addDays(d, 1)) {
            const tid = plannedFor(s.settings, d, s.lifeEvents);
            const t = s.templates.find(x => x.id === tid);
            if (!t) continue;
            const taken = new Set(s.exerciseOverrides.filter(o => o.date === d && o.templateId === t.id).map(o => o.replaceTeId));
            for (const te of t.exercises) {
              if (taken.has(te.id) || inToday.has(te.exerciseId)) continue;
              out.push({ date: d, templateId: t.id, templateName: t.name, te, label: `${t.name} (${DAY_NAMES[parseYmd(d).getDay()]})` });
            }
          }
          return out;
        },

        swapAcrossWeek: (exId, option) => {
          const { active } = getState();
          const cur = active?.session.exercises.find(x => x.id === exId);
          if (!active || !cur) return;
          const todayLabel = `${active.session.templateName} (${DAY_NAMES[new Date().getDay()]})`;
          const incoming = buildExercise(option.te, active.holdTargets, active.session.deload, { swappedFrom: option.label });
          mutate(d => {
            const list = d.active!.session.exercises;
            list[list.findIndex(x => x.id === exId)] = incoming;
            // The exercise you couldn't do today moves into that day's workout, this week only.
            d.exerciseOverrides = [
              ...d.exerciseOverrides.filter(o => o.date >= addDays(ymd(), -7)),
              { date: option.date, templateId: option.templateId, replaceTeId: option.te.id, withTe: cur.source, fromLabel: todayLabel },
            ];
          });
        },

        doLater: exId => mutate(d => {
          const list = d.active?.session.exercises;
          if (!list) return;
          const i = list.findIndex(x => x.id === exId);
          if (i < 0) return;
          const [ex] = list.splice(i, 1);
          // A superset moves as a pair.
          const j = ex.pairWith ? list.findIndex(x => x.id === ex.pairWith) : -1;
          const partner = j >= 0 ? list.splice(j, 1) : [];
          list.push(ex, ...partner);
        }),

        minutesLeft: () => {
          const s = getState();
          return s.active ? Math.round(estimateSec(cutItems(s.active, s.exercise)) / 60) : 0;
        },
        previewTimeCut: minutes => {
          const s = getState();
          return s.active ? planTimeCut(cutItems(s.active, s.exercise), minutes) : null;
        },
        applyTimeCut: minutes => {
          const plan = getState().previewTimeCut(minutes);
          if (!plan) return null;
          mutate(d => {
            const list = d.active!.session.exercises;
            for (const it of plan.items) {
              const e = list.find(x => x.id === it.id);
              if (!e) continue;
              e.restSec = it.restSec;
              e.pairWith = it.pairWith;
              if (it.skip) { e.skipped = true; continue; }
              // Remove surplus not-yet-done working sets from the end.
              let extra = e.sets.filter(s => !s.warmup && !s.completed).length - it.setsLeft;
              for (let k = e.sets.length - 1; k >= 0 && extra > 0; k--) {
                if (!e.sets[k].warmup && !e.sets[k].completed) { e.sets.splice(k, 1); extra--; }
              }
            }
            // Superset partners sit next to each other.
            for (const e of [...list]) {
              if (!e.pairWith) continue;
              const i = list.findIndex(x => x.id === e.id), j = list.findIndex(x => x.id === e.pairWith);
              if (j > i + 1) list.splice(i + 1, 0, ...list.splice(j, 1));
            }
          });
          return plan;
        },

        finishWorkout: ({ saveToTemplate }) => {
          const { active } = getState();
          if (!active) return null;
          const exercises = active.session.exercises.map(toLogged);
          const session: WorkoutSession = {
            ...active.session,
            endedAt: Date.now(),
            exercises,
            partial: exercises.some(e => e.skipped || e.sets.some(s => !s.completed && !s.warmup)),
          };
          const graduations = exercises
            .filter(le => le.kind === 'assisted' && !le.skipped && le.workingWeight <= 0 && le.countsForProgression)
            .map(le => ({ from: le.exerciseId, to: getState().exercise(le.exerciseId)?.graduatesTo, reps: le.sets.filter(s => s.completed && !s.warmup).map(s => s.reps) }))
            .filter((g): g is { from: string; to: string; reps: number[] } => !!g.to);
          mutate(d => {
            d.sessions.push(session);
            d.active = null;
            d.timer = null;
            // Zero assistance: it's a real pull-up now. Every template switches to the bodyweight version.
            for (const g of graduations) {
              for (const t of d.templates) for (const te of t.exercises) {
                if (te.exerciseId !== g.from) continue;
                te.exerciseId = g.to;
                te.startWeight = 0;
                te.seed = { weight: 0, reps: g.reps };
                te.increment = 2.5;
                te.machineNote = `Unassisted since ${ymd()} 💪 Belt on once set 1 hits ${te.repMax}.`;
              }
            }
            if (saveToTemplate && !session.deload) {
              const t = d.templates.find(x => x.id === session.templateId);
              if (t) {
                t.exercises = active.session.exercises.filter(e => !e.swappedFrom).map(ae => {
                  const le = toLogged(ae);
                  return {
                    ...ae.source,
                    id: ae.source.id ?? uid(),
                    exerciseId: le.exerciseId,
                    sets: le.sets.filter(s => !s.warmup).length,
                    warmupSets: le.sets.filter(s => s.warmup).length,
                    restSec: le.restSec,
                  };
                });
              }
            }
          });
          return session;
        },
        discardWorkout: () => setState({ active: null, timer: null }),
        deleteSession: id => mutate(d => { d.sessions = d.sessions.filter(s => s.id !== id); }),
        updateSession: s => mutate(d => { d.sessions = d.sessions.map(x => (x.id === s.id ? s : x)); }),

        startTimer: (sec, label) => setState({ timer: { endAt: Date.now() + sec * 1000, pausedLeft: null, total: sec, label } }),
        adjustTimer: delta => {
          const t = getState().timer;
          if (!t) return;
          if (t.pausedLeft != null) setState({ timer: { ...t, pausedLeft: Math.max(0, t.pausedLeft + delta * 1000) } });
          else if (t.endAt) setState({ timer: { ...t, endAt: Math.max(Date.now(), t.endAt + delta * 1000), total: Math.max(1, t.total + delta) } });
        },
        togglePauseTimer: () => {
          const t = getState().timer;
          if (!t) return;
          if (t.pausedLeft != null) setState({ timer: { ...t, endAt: Date.now() + t.pausedLeft, pausedLeft: null } });
          else if (t.endAt) setState({ timer: { ...t, pausedLeft: Math.max(0, t.endAt - Date.now()), endAt: null } });
        },
        clearTimer: () => setState({ timer: null }),

        setCheckIn: (date, patch) => mutate(d => {
          const merged = { ...(d.checkIns[date] ?? { date }), ...patch };
          d.checkIns[date] = merged;
        }),

        currentPhase: () => getState().phases.find(p => p.status === 'active'),
        tickPhases: () => {
          const today = ymd();
          const s = getState();
          const cur = s.currentPhase();
          if (!cur) {
            mutate(d => { d.phases.push({ id: uid(), type: 'gaining', number: 1, startDate: today, minWeeks: d.settings.minPhaseWeeks, status: 'active' }); });
          } else if (deloadFinished(cur, today)) {
            mutate(d => {
              const p = d.phases.find(x => x.id === cur.id)!;
              p.status = 'completed'; p.endDate = today;
              const n = Math.max(0, ...d.phases.filter(x => x.type === 'gaining').map(x => x.number)) + 1;
              d.phases.push({ id: uid(), type: 'gaining', number: n, startDate: today, minWeeks: d.settings.minPhaseWeeks, status: 'active' });
            });
          }
        },
        answerPlateau: plateaued => mutate(d => {
          const today = ymd();
          const p = d.phases.find(x => x.status === 'active');
          if (!p) return;
          if (!plateaued) { p.lastPlateauNo = today; return; }
          p.status = 'completed'; p.endDate = today;
          d.phases.push({ id: uid(), type: 'deload', number: p.number, startDate: today, minWeeks: 1, status: 'active' });
        }),
        endDeloadEarly: () => mutate(d => {
          const today = ymd();
          const p = d.phases.find(x => x.status === 'active' && x.type === 'deload');
          if (!p) return;
          p.status = 'completed'; p.endDate = today;
          const n = Math.max(0, ...d.phases.filter(x => x.type === 'gaining').map(x => x.number)) + 1;
          d.phases.push({ id: uid(), type: 'gaining', number: n, startDate: today, minWeeks: d.settings.minPhaseWeeks, status: 'active' });
        }),

        setProfile: p => mutate(d => { d.profile = { ...d.profile, ...p }; }),
        currentNutritionPhase: () => getState().nutritionPhases.find(p => p.status === 'active'),
        startNutritionPhase: (type, targetRate, reason, startWeight, startWaistCm) => mutate(d => {
          const today = ymd();
          d.nutritionPhases.forEach(p => { if (p.status === 'active') { p.status = 'completed'; p.endDate = today; } });
          d.nutritionPhases.push({ id: uid(), type, startDate: today, status: 'active', targetRate, reason, startWeight, startWaistCm });
        }),
        addCircumferences: m => mutate(d => { d.circumferences = [...d.circumferences.filter(x => x.date !== m.date), m].sort((a, b) => a.date.localeCompare(b.date)); }),
        addMeasurement: m => mutate(d => { d.measurements = [...d.measurements.filter(x => x.date !== m.date), m].sort((a, b) => a.date.localeCompare(b.date)); }),
        setWeeklyTarget: t => mutate(d => { d.weeklyTargets = [...d.weeklyTargets.filter(x => x.weekStart !== t.weekStart), t].sort((a, b) => a.weekStart.localeCompare(b.weekStart)); }),
        completeWeeklyCheckIn: c => mutate(d => { d.weeklyCheckIns = [...d.weeklyCheckIns.filter(x => x.date !== c.date), c].sort((a, b) => a.date.localeCompare(b.date)); }),
        addPhoto: async (blob, pose, date) => {
          const photo: Photo = { id: uid(), date, pose };
          await savePhotoBlob(photo.id, blob);
          mutate(d => { d.photos.push(photo); });
          return photo;
        },
        deletePhoto: async id => {
          await deletePhotoBlob(id);
          mutate(d => { d.photos = d.photos.filter(p => p.id !== id); });
        },

        loadProgram: () => mutate(d => {
          const { templates, schedule } = buildProgram();
          // Old workouts are archived, not deleted, so their history and charts stay.
          d.templates.forEach(t => { t.archived = true; });
          d.templates.push(...templates);
          d.settings.schedule = schedule;
          d.settings.scheduleOverrides = {};
          d.settings.workoutsPerWeek = plannedPerWeek(schedule);
          d.settings.basis = 'first';
          d.settings.programVersion = PROGRAM_VERSION;
          d.settings.programLoadedOn = ymd();
          patchProgramTemplates(d.templates);
          d.exerciseOverrides = [];
        }),
        setScheduleDay: (dow, templateId) => mutate(d => {
          d.settings.schedule[dow] = templateId;
          d.settings.workoutsPerWeek = Math.max(1, plannedPerWeek(d.settings.schedule));
        }),
        setOverride: (date, templateId) => mutate(d => {
          if (templateId === undefined) delete d.settings.scheduleOverrides[date];
          else d.settings.scheduleOverrides[date] = templateId;
        }),

        addLifeEvent: (e, opts = {}) => {
          const s = getState();
          const today = ymd();
          let movedTo: string | null = null;
          const todayPlan = plannedFor(s.settings, today, s.lifeEvents);
          if (opts.moveToday && todayPlan && e.from <= today && today <= e.to) {
            // Next free rest day this week after the time off.
            const sunday = addDays(weekStart(today), 6);
            for (let d = addDays(e.to, 1); d <= sunday; d = addDays(d, 1)) {
              if (!plannedFor(s.settings, d, s.lifeEvents) && !eventOn(s.lifeEvents, d)) { movedTo = d; break; }
            }
          }
          const length = daysBetween(e.from, e.to) + 1;
          mutate(d => {
            d.lifeEvents.push({ ...e, id: uid() });
            if (movedTo) d.settings.scheduleOverrides[movedTo] = todayPlan;
            // Longer illness or time away: timelines move by the time lost, and training ramps back in.
            if ((e.type === 'ill' || e.type === 'away') && length >= 3) {
              const shift = (date: string) => addDays(date, length);
              d.nutritionPhases.forEach(p => { if (p.status === 'active') p.startDate = shift(p.startDate); });
              d.phases.forEach(p => { if (p.status === 'active') p.startDate = shift(p.startDate); });
              if (length >= 14) d.settings.rampUntil = addDays(e.to, 21);
            }
          });
          return movedTo;
        },
        endLifeEvent: id => mutate(d => {
          const today = ymd();
          const e = d.lifeEvents.find(x => x.id === id);
          if (!e) return;
          if (e.from >= today) d.lifeEvents = d.lifeEvents.filter(x => x.id !== id);
          else e.to = addDays(today, -1);
        }),
        eventToday: () => eventOn(getState().lifeEvents, ymd()),

        setSettings: s => mutate(d => {
          d.settings = { ...d.settings, ...s };
          if (s.minPhaseWeeks) d.phases.forEach(p => { if (p.status === 'active' && p.type === 'gaining') p.minWeeks = s.minPhaseWeeks!; });
        }),
        addReport: r => mutate(d => { d.reports = [r, ...d.reports.filter(x => x.weekStart !== r.weekStart)]; }),
        markNotified: (key, date) => mutate(d => { d.notified[key] = date; }),

        exportData: () => {
          const d = pickData(getState());
          return JSON.stringify({ app: 'promise', version: 3, exportedAt: new Date().toISOString(), data: { ...d, active: null, timer: null, settings: { ...d.settings, anthropicKey: undefined, gistToken: undefined } } }, null, 2);
        },
        importData: json => {
          const parsed = JSON.parse(json);
          const data = parsed?.data;
          if (parsed?.app !== 'promise' || !data || !Array.isArray(data.sessions) || !Array.isArray(data.templates)) {
            throw new Error("That file isn't a Promise backup.");
          }
          const { anthropicKey, gistToken, gistId } = getState().settings;
          setState({
            ...initialData, ...data,
            profile: { ...initialData.profile, ...data.profile },
            settings: { ...DEFAULT_SETTINGS, ...data.settings, anthropicKey, gistToken, gistId: data.settings?.gistId ?? gistId },
            active: null, timer: null,
          });
        },
        resetAll: () => setState({ ...structuredClone(initialData) }),
      };
    },
    {
      name: 'promise-v1',
      storage: createJSONStorage(() => idbStorage),
      partialize: s => pickData(s),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Data>;
        // Templates from an earlier program version pick up warm-ups and plate loading.
        if (p.templates) patchProgramTemplates(p.templates);
        migrateNutrition(p);
        return {
          ...current, ...p,
          circumferences: p.circumferences ?? [],
          lifeEvents: p.lifeEvents ?? [],
          exerciseOverrides: p.exerciseOverrides ?? [],
          profile: { ...initialData.profile, ...p.profile },
          settings: { ...DEFAULT_SETTINGS, ...p.settings },
        };
      },
    },
  ),
);

/**
 * Nutrition model 2: lean bulks at 0.3/0.2 kg a week (was 0.35/0.25), a lower starting maintenance
 * guess (activity ×1.45, was ×1.55) and protein at 1g/lb. Rewrites the active phase and any targets
 * that were still based on the old starting guess; targets learned from your own data are kept.
 */
function migrateNutrition(p: Partial<Data>) {
  if (!p.settings || (p.settings.nutritionModel ?? 1) >= 2) return;
  p.settings.nutritionModel = 2;
  const active = p.nutritionPhases?.find(x => x.status === 'active');
  if (active?.type === 'bulk') {
    if (active.targetRate === 0.35) active.targetRate = REGAIN_RATE;
    else if (active.targetRate === 0.25) active.targetRate = LEAN_BULK_RATE;
  }
  for (const t of p.weeklyTargets ?? []) {
    if (t.method !== 'estimate') continue;
    t.maintenance = Math.round((t.maintenance * ACTIVITY_FACTOR) / 1.55 / 10) * 10;
    const rate = active?.targetRate ?? 0;
    t.kcal = Math.round((t.maintenance + (rate * KCAL_PER_KG) / 7) / 25) * 25;
    if (active?.type !== 'cut') t.protein = Math.round((t.protein / 2.0) * 2.2 / 5) * 5;
    t.note = 'Starting estimate from your lean mass, set on the low side for a lean bulk. Log calories most days and this gets personal within 3 weeks.';
  }
}

function pickData(s: Data): Data {
  return {
    customExercises: s.customExercises,
    templates: s.templates,
    sessions: s.sessions,
    phases: s.phases,
    checkIns: s.checkIns,
    profile: s.profile,
    nutritionPhases: s.nutritionPhases,
    measurements: s.measurements,
    weeklyTargets: s.weeklyTargets,
    weeklyCheckIns: s.weeklyCheckIns,
    photos: s.photos,
    circumferences: s.circumferences,
    lifeEvents: s.lifeEvents,
    exerciseOverrides: s.exerciseOverrides,
    reports: s.reports,
    settings: s.settings,
    active: s.active,
    timer: s.timer,
    notified: s.notified,
  };
}
