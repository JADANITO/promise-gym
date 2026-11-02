import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { del, get, set } from 'idb-keyval';
import type {
  CoachReport, DailyCheckIn, Exercise, LoggedExercise, LoggedSet, Measurement, Muscle, NutritionPhase,
  NutritionPhaseType, Phase, Photo, Profile, Settings, TemplateExercise, WeeklyCheckIn, WeeklyTarget, WorkoutSession, WorkoutTemplate,
} from '../types';
import { computeProgress, planExercise, targetAfterIncrease } from '../engine/progression';
import { deloadFinished, deloadPrescription, roundTo } from '../engine/phases';
import { ymd } from '../engine/dates';
import { plannedPerWeek } from '../engine/schedule';
import { BUILT_IN_EXERCISES, slug } from './library';
import { buildStarterProgram } from './program';
import { deletePhotoBlob, savePhotoBlob } from './photos';
import { fmtW, uid } from '../format';

export interface ActiveExercise extends LoggedExercise {
  /** Working weight the engine suggested before any edits. */
  baseWeight: number;
  reason: string;
  flagged: boolean;
  /** The user has answered the "increase the weight" prompt for this session. */
  increaseHandled?: boolean;
  /** First time doing this exercise: ask for a starting weight. */
  firstWeight?: boolean;
  increment?: number;
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
  defaultRestSec: 90,
  basis: 'lowest',
  minPhaseWeeks: 4,
  deloadWeightPct: 0.875,
  deloadSetFactor: 0.5,
  weightRounding: 2.5,
  workoutsPerWeek: 4,
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
  reports: CoachReport[];
  settings: Settings;
  active: ActiveWorkout | null;
  timer: RestTimer | null;
  notified: Record<string, string>; // reminder key → date last notified
}

interface Actions {
  // library
  exercises: () => Exercise[];
  exerciseName: (id: string) => string;
  addCustomExercise: (name: string, primary?: Muscle[]) => Exercise;
  // templates
  saveTemplate: (t: WorkoutTemplate) => void;
  deleteTemplate: (id: string) => void;
  duplicateTemplate: (id: string) => void;
  // workout
  startWorkout: (templateId: string, holdTargets: boolean) => void;
  updateActive: (fn: (a: ActiveWorkout) => void) => void;
  setIncreaseWeight: (exId: string, kg: number) => void;
  applyWeight: (exId: string, kg: number, mode: 'working' | 'today') => void;
  addExerciseToActive: (exerciseId: string, kg: number) => void;
  swapExercise: (exId: string, exerciseId: string) => void;
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
  setWeeklyTarget: (t: WeeklyTarget) => void;
  completeWeeklyCheckIn: (c: WeeklyCheckIn) => void;
  addPhoto: (blob: Blob, pose: Photo['pose'], date: string) => Promise<Photo>;
  deletePhoto: (id: string) => Promise<void>;
  // schedule
  loadStarterProgram: () => void;
  setScheduleDay: (dow: number, templateId: string | null) => void;
  setOverride: (date: string, templateId: string | null | undefined) => void;
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
  profile: { goalWeight: 0, goalBodyFat: 12, bulkCeiling: 16 },
  nutritionPhases: [],
  measurements: [],
  weeklyTargets: [],
  weeklyCheckIns: [],
  photos: [],
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

function makeSets(count: number, weight: number, target: number, warmups = 0, rounding = 2.5): LoggedSet[] {
  const warm: LoggedSet[] = Array.from({ length: warmups }, () => ({
    id: uid(), weight: roundTo(weight * 0.5, rounding), targetReps: target, reps: target, completed: false, warmup: true,
  }));
  const work: LoggedSet[] = Array.from({ length: count }, () => ({
    id: uid(), weight, targetReps: target, reps: target, completed: false, warmup: false,
  }));
  return [...warm, ...work];
}

function toLogged(e: ActiveExercise): LoggedExercise {
  const { baseWeight: _b, reason: _r, flagged: _f, increaseHandled: _h, firstWeight: _fw, increment: _i, ...rest } = e;
  const anyDone = rest.sets.some(s => s.completed && !s.warmup);
  return { ...rest, skipped: rest.skipped || !anyDone };
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

      const buildExercise = (te: Pick<TemplateExercise, 'exerciseId' | 'sets' | 'repMin' | 'repMax' | 'restSec' | 'startWeight' | 'machineNote' | 'warmupSets' | 'increment'>, holdTargets: boolean, deload: boolean): ActiveExercise => {
        const { sessions, settings } = getState();
        const state = computeProgress(te.exerciseId, sessions, settings.basis, te.startWeight, te.repMin);
        const plan = planExercise(state, te, { holdTargets, fmt: kg => fmtW(kg, settings.units) });
        let weight = plan.weight, target = plan.target, sets = te.sets, reason = plan.reason, increaseDue = plan.increaseDue;
        const ramp = !!settings.rampUntil && ymd() <= settings.rampUntil;
        const firstWeight = !state.last && !te.startWeight;
        if (firstWeight) {
          increaseDue = true;
          reason = ramp
            ? `First session back: pick a weight you could do for ~3 more reps than ${target}. Muscle memory will move it up fast.`
            : `First time: pick a weight you could do for ~2 more reps than ${target}.`;
        } else if (ramp && !deload) {
          reason += ' Ramp-up: beat the target and you jump 2 reps next time.';
        }
        if (deload) {
          const d = deloadPrescription(plan.weight, te.sets, settings);
          weight = d.weight; sets = d.sets; target = te.repMin; increaseDue = false;
          reason = `Deload: ${Math.round(settings.deloadWeightPct * 100)}% weight, ${sets} sets. Leave plenty in the tank — this week doesn't change your progression.`;
        }
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
          sets: makeSets(sets, weight, target, te.warmupSets ?? 0, settings.weightRounding),
          baseWeight: weight,
          reason,
          flagged: plan.flagged,
          firstWeight: firstWeight || undefined,
          increment: te.increment,
        };
      };

      return {
        ...initialData,

        exercises: () => [...BUILT_IN_EXERCISES, ...getState().customExercises].sort((a, b) => a.name.localeCompare(b.name)),
        exerciseName: id => getState().exercises().find(e => e.id === id)?.name ?? id,
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
                exercises: t.exercises.map(te => buildExercise(te, holdTargets, deload)),
              },
            },
            timer: null,
          });
        },

        updateActive: fn => mutate(d => { if (d.active) fn(d.active); }),

        setIncreaseWeight: (exId, kg) => mutate(d => {
          const e = d.active?.session.exercises.find(x => x.id === exId);
          if (!e) return;
          e.increaseHandled = true;
          const target = targetAfterIncrease(kg, e.baseWeight, e.repMin, e.repMax);
          e.workingWeight = kg;
          e.targetReps = target;
          e.countsForProgression = true;
          e.reason = e.firstWeight
            ? `Starting at ${fmtW(kg, d.settings.units)} — aim for ${target} reps on every set, with 2–3 left in the tank.`
            : kg > e.baseWeight
              ? `New weight ${fmtW(kg, d.settings.units)} — back to the bottom of the range: ${target} reps.`
              : `Same weight — aim for ${target} reps again.`;
          for (const s of e.sets) {
            if (s.warmup) { if (!s.completed) s.weight = roundTo(kg * 0.5, d.settings.weightRounding); continue; }
            s.weight = kg;
            s.targetReps = target;
            if (!s.completed) s.reps = target;
          }
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
          });
        },

        addExerciseToActive: (exerciseId, kg) => {
          const { settings, templates, active } = getState();
          if (!active) return;
          const fromTemplate = templates.flatMap(t => t.exercises).find(x => x.exerciseId === exerciseId);
          const te = fromTemplate ?? { exerciseId, sets: 3, repMin: 8, repMax: 12, restSec: settings.defaultRestSec, startWeight: kg };
          const ex = buildExercise({ ...te, startWeight: fromTemplate?.startWeight ?? kg }, active.holdTargets, active.session.deload);
          mutate(d => { d.active!.session.exercises.push(ex); });
        },

        swapExercise: (exId, exerciseId) => {
          const { active } = getState();
          const cur = active?.session.exercises.find(x => x.id === exId);
          if (!active || !cur) return;
          const ex = buildExercise(
            { exerciseId, sets: cur.sets.filter(s => !s.warmup).length, repMin: cur.repMin, repMax: cur.repMax, restSec: cur.restSec, startWeight: cur.workingWeight },
            active.holdTargets, false,
          );
          mutate(d => {
            const list = d.active!.session.exercises;
            list[list.findIndex(x => x.id === exId)] = { ...ex, sets: active.session.deload ? cur.sets.map(s => ({ ...s, id: uid() })) : ex.sets };
          });
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
          mutate(d => {
            d.sessions.push(session);
            d.active = null;
            d.timer = null;
            if (saveToTemplate && !session.deload) {
              const t = d.templates.find(x => x.id === session.templateId);
              if (t) {
                t.exercises = session.exercises.map(le => {
                  const old = t.exercises.find(x => x.exerciseId === le.exerciseId);
                  return {
                    id: old?.id ?? uid(),
                    exerciseId: le.exerciseId,
                    sets: le.sets.filter(s => !s.warmup).length,
                    warmupSets: le.sets.filter(s => s.warmup).length,
                    repMin: le.repMin,
                    repMax: le.repMax,
                    restSec: le.restSec,
                    startWeight: old?.startWeight ?? le.workingWeight,
                    machineNote: le.machineNote,
                    increment: old?.increment,
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

        loadStarterProgram: () => mutate(d => {
          const { templates, schedule } = buildStarterProgram();
          d.templates.push(...templates);
          d.settings.schedule = schedule;
          d.settings.workoutsPerWeek = plannedPerWeek(schedule);
        }),
        setScheduleDay: (dow, templateId) => mutate(d => {
          d.settings.schedule[dow] = templateId;
          d.settings.workoutsPerWeek = Math.max(1, plannedPerWeek(d.settings.schedule));
        }),
        setOverride: (date, templateId) => mutate(d => {
          if (templateId === undefined) delete d.settings.scheduleOverrides[date];
          else d.settings.scheduleOverrides[date] = templateId;
        }),
        setSettings: s => mutate(d => {
          d.settings = { ...d.settings, ...s };
          if (s.minPhaseWeeks) d.phases.forEach(p => { if (p.status === 'active' && p.type === 'gaining') p.minWeeks = s.minPhaseWeeks!; });
        }),
        addReport: r => mutate(d => { d.reports = [r, ...d.reports.filter(x => x.weekStart !== r.weekStart)]; }),
        markNotified: (key, date) => mutate(d => { d.notified[key] = date; }),

        exportData: () => {
          const d = pickData(getState());
          return JSON.stringify({ app: 'promise', version: 2, exportedAt: new Date().toISOString(), data: { ...d, active: null, timer: null, settings: { ...d.settings, anthropicKey: undefined, gistToken: undefined } } }, null, 2);
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
        return { ...current, ...p, profile: { ...initialData.profile, ...p.profile }, settings: { ...DEFAULT_SETTINGS, ...p.settings } };
      },
    },
  ),
);

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
    reports: s.reports,
    settings: s.settings,
    active: s.active,
    timer: s.timer,
    notified: s.notified,
  };
}
