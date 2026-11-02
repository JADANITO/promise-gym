// All weights are stored in kg; conversion to lb happens only at display/input time.

export type ProgressionBasis = 'lowest' | 'first' | 'average';
export type Units = 'kg' | 'lb';
export type GoalDirection = 'lose' | 'gain' | 'maintain';

export interface Exercise {
  id: string;
  name: string;
  custom?: boolean;
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
  notes?: string;
}

export interface Goals {
  goalWeight?: number;
  goalDate?: string;
  direction: GoalDirection;
  calorieTarget?: number;
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
  weighInTime: string; // HH:MM
  caloriesTime: string;
  coachDay: number; // 0 = Sunday
  coachTime: string;
  keepAwake: boolean;
  timerSound: boolean;
  anthropicKey?: string;
  customQuotes: string[];
  onboarded: boolean;
}
