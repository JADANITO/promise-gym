// All weights are stored in kg; conversion to lb happens only at display/input time.

export type ProgressionBasis = 'lowest' | 'first' | 'average';
export type Units = 'kg' | 'lb';
export type LengthUnits = 'cm' | 'in';

export type Muscle =
  | 'chest' | 'back' | 'side-delts' | 'rear-delts' | 'front-delts' | 'biceps' | 'triceps'
  | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'abs' | 'traps' | 'forearms';

/**
 * How load works: 'weighted' = the number is the load; 'assisted' = the number is assistance
 * (lower is progress); 'bodyweight' = the number is extra load on a belt/held (0 = bodyweight).
 */
export type LoadKind = 'weighted' | 'assisted' | 'bodyweight';
/** 'straight' = normal sets; 'myo-match' = set 1 to failure, later sets rest-pause to match it. */
export type Technique = 'straight' | 'myo-match';
export type CableStation = 'small' | 'big';

export interface Exercise {
  id: string;
  name: string;
  custom?: boolean;
  kind?: LoadKind;
  /** For assisted exercises: the bodyweight version it graduates to at zero assistance. */
  graduatesTo?: string;
  /** Muscles worked: primary count as 1 set, secondary as half a set. */
  primary?: Muscle[];
  secondary?: Muscle[];
}

export interface TemplateExercise {
  id: string;
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  restSec: number;
  startWeight: number;
  machineNote?: string;
  warmupSets?: number;
  /** Smallest weight jump on this machine/implement (kg), used to pre-fill weight increases. */
  increment?: number;
  technique?: Technique;
  /** Done on a cable stack: choose big or small station in the workout (separate weights). */
  cable?: boolean;
  /** Default station for cable exercises. */
  station?: CableStation;
  /** Last logged numbers from before the app, used until real history exists. */
  seed?: { weight: number; reps: number[] };
  /** Generate warm-up sets from the working weight (first big lift of the day). */
  autoWarmup?: boolean;
  /** How the number is loaded, for the plate calculator. */
  loading?: 'barbell' | 'per-side';
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  exercises: TemplateExercise[];
  notes?: string;
  archived?: boolean;
}

export interface LoggedSet {
  id: string;
  weight: number;
  targetReps: number;
  reps: number;
  completed: boolean;
  warmup: boolean;
  rpe?: number;
  note?: string;
}

/** One exercise as performed in a session — a snapshot, so template edits never rewrite history. */
export interface LoggedExercise {
  id: string;
  exerciseId: string;
  repMin: number;
  repMax: number;
  restSec: number;
  machineNote?: string;
  /** Weight the progression engine evaluates this session against. */
  workingWeight: number;
  /** Target reps shown for this session. */
  targetReps: number;
  /** The engine asked for a weight increase going into this session. */
  increasePrompted: boolean;
  /** False when a one-off machine/weight override was used and declined as the new working weight. */
  countsForProgression: boolean;
  skipped: boolean;
  /** Logged during the return-to-training ramp: progress two reps at a time. */
  ramp?: boolean;
  technique?: Technique;
  station?: CableStation;
  kind?: LoadKind;
  /** Moved here from another day this week (exercise swap). */
  swappedFrom?: string;
  sets: LoggedSet[];
}

export interface WorkoutSession {
  id: string;
  templateId: string;
  templateName: string;
  startedAt: number;
  endedAt?: number;
  phaseId: string;
  deload: boolean;
  partial?: boolean;
  exercises: LoggedExercise[];
}

/** A stretch of days off plan: no training, no nagging, and scale data ignored for the trend. */
export interface LifeEvent {
  id: string;
  type: 'ill' | 'away' | 'sore' | 'other';
  from: string;
  to: string;
  note?: string;
}

/** One-week exercise swap: on `date`, in `templateId`, replace template exercise `replaceTeId` with `withTe`. */
export interface ExerciseOverride {
  date: string;
  templateId: string;
  replaceTeId: string;
  withTe: TemplateExercise;
  fromLabel: string;
}

export interface Phase {
  id: string;
  type: 'gaining' | 'deload';
  number: number;
  startDate: string; // YYYY-MM-DD
  endDate?: string;
  minWeeks: number;
  status: 'active' | 'completed';
  /** Date the user last answered "not plateaued" — re-ask a week later. */
  lastPlateauNo?: string;
}

export interface DailyCheckIn {
  date: string; // YYYY-MM-DD
  bodyweight?: number;
  calories?: number;
  protein?: number;
  /** Hours slept the night before. */
  sleepHours?: number;
  /** You told the app you didn't weigh in this morning. */
  weighInMissed?: boolean;
  notes?: string;
}

export type NutritionPhaseType = 'bulk' | 'cut' | 'maintain';

/** Body-composition phase (lean bulk / lean cut / maintenance), separate from training blocks. */
export interface NutritionPhase {
  id: string;
  type: NutritionPhaseType;
  startDate: string;
  endDate?: string;
  status: 'active' | 'completed';
  /** Planned bodyweight change in kg/week (negative for a cut). */
  targetRate: number;
  startWeight?: number;
  startWaistCm?: number;
  reason?: string;
}

export interface Profile {
  /** Used in greetings and motivation ("Would future Jaden be proud?"). */
  name?: string;
  heightCm?: number;
  /** Self-estimate used to calibrate the waist-based body fat estimate. */
  baseline?: { date: string; weight: number; bodyFat: number; waistCm: number };
  /** Heaviest previous build — used for muscle-memory (faster regain) planning. */
  peak?: { weight: number; bodyFat: number };
  goalWeight: number;
  goalBodyFat: number;
  /** End a lean bulk around this body fat. */
  bulkCeiling: number;
}

export interface Measurement {
  date: string;
  waistCm: number;
}

/** Monthly tape measurements that show whether a lean bulk is adding muscle. */
export interface BodyMeasurement {
  date: string;
  armCm?: number;
  chestCm?: number;
  shouldersCm?: number;
  thighCm?: number;
}

export type ClothesFit = 'looser' | 'same' | 'tighter';

export interface WeeklyTarget {
  weekStart: string; // Monday the targets apply from
  kcal: number;
  protein: number;
  maintenance: number;
  method: 'adaptive' | 'estimate' | 'trend';
  note: string;
}

export interface WeeklyCheckIn {
  date: string;
  waistCm?: number;
  clothes?: ClothesFit;
  photoIds: string[];
  decision?: string;
}

export interface Photo {
  id: string;
  date: string;
  pose: 'front' | 'side' | 'back';
}

export interface CoachReport {
  id: string;
  weekStart: string;
  createdAt: number;
  source: 'ai' | 'rules';
  summary: string;
  wins: string[];
  changes: string[];
  focus: string;
  stats: Record<string, string | number>;
}

export interface Settings {
  units: Units;
  defaultRestSec: number;
  basis: ProgressionBasis;
  minPhaseWeeks: number;
  deloadWeightPct: number; // e.g. 0.875
  deloadSetFactor: number; // e.g. 0.5
  weightRounding: number; // kg increment for deload rounding
  workoutsPerWeek: number;
  /** Template id (or null = rest) for each weekday, index 0 = Sunday. */
  schedule: (string | null)[];
  /** One-off changes for specific dates: template id, or null for rest. */
  scheduleOverrides: Record<string, string | null>;
  lengthUnits: LengthUnits;
  /** Return-to-training ramp: faster rep progression until this date. */
  rampUntil?: string;
  gistToken?: string;
  gistId?: string;
  lastBackupAt?: number;
  weighInTime: string; // HH:MM
  caloriesTime: string;
  coachDay: number; // 0 = Sunday
  coachTime: string;
  keepAwake: boolean;
  timerSound: boolean;
  anthropicKey?: string;
  customQuotes: string[];
  /** Which built-in program was last loaded (to offer upgrades once). */
  programVersion?: string;
  /** Version of the calorie/protein rules the stored targets were made with. */
  nutritionModel?: number;
  /** Date the current program was loaded, for "time to specialise" advice. */
  programLoadedOn?: string;
  /** Olympic bar weight for the plate calculator. */
  barKg?: number;
  onboarded: boolean;
}
