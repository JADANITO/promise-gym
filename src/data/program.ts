import type { TemplateExercise, Technique, WorkoutTemplate } from '../types';
import { slug } from './library';
import { uid } from '../format';

export const PROGRAM_VERSION = 'ulppl-v1';

interface Ex {
  name: string;
  reps: [number, number];
  rest: number;
  sets?: number;
  /** Last logged weight and reps in this same rep range — carried over as history. */
  seed?: [weight: number, reps: number[]];
  /** Starting weight with no reps logged. */
  start?: number;
  inc?: number;
  cable?: boolean;
  myo?: boolean;
  note?: string;
}

/**
 * Upper / Lower / Rest / Pull / Push / Legs / Rest. Every exercise is 3 sets; abs on every training day.
 * Where a previous log used a different rep range, the old number is only shown as a hint.
 */
const PROGRAM: { name: string; day: number; exercises: Ex[] }[] = [
  {
    name: 'Upper', day: 1, exercises: [
      { name: '45° Incline Barbell Press', reps: [6, 8], rest: 180, inc: 2.5, note: 'Fresh start — try ~70kg for 6–8.' },
      { name: 'Decline Cable Fly', reps: [8, 10], rest: 90, cable: true, note: 'Last log 10.2kg × 10 (for 10–12) — go a little heavier.' },
      { name: 'Assisted Wide-Grip Pull-Up', reps: [8, 10], rest: 150, seed: [14, [8, 7, 6]], note: 'Weight = assistance. Less is progress; at 0 it becomes bodyweight pull-ups.' },
      { name: 'High-Cable Lateral Raise', reps: [8, 10], rest: 90, cable: true, myo: true, note: 'Last log 5.7kg × 11 (for 10–12).' },
      { name: 'Chest-Supported Machine Row', reps: [8, 10], rest: 120, seed: [50, [9, 8, 7]], inc: 2.5 },
      { name: 'EZ-Bar Skull Crusher', reps: [8, 10], rest: 90, inc: 2.5 },
      { name: 'EZ-Bar Reverse Curl', reps: [8, 10], rest: 90, seed: [7.5, [9, 8, 7]], inc: 1.25, note: 'kg per side.' },
      { name: 'Roman Chair Leg Raise', reps: [10, 20], rest: 60 },
    ],
  },
  {
    name: 'Lower', day: 2, exercises: [
      { name: 'Back Squat', reps: [6, 8], rest: 180, inc: 2.5 },
      { name: 'Lying Leg Curl', reps: [8, 10], rest: 90, inc: 2.5 },
      { name: 'Leg Extension', reps: [8, 10], rest: 90, start: 50, inc: 2.5 },
      { name: 'DB RDL', reps: [8, 10], rest: 120, inc: 2, note: 'kg per DB.' },
      { name: 'Smith Machine Calf Raise', reps: [8, 10], rest: 60, inc: 5 },
      { name: 'Cable Crunch', reps: [8, 10], rest: 60, cable: true, note: 'Last log 32.9kg small / 59kg big (for 10–12).' },
    ],
  },
  {
    name: 'Pull', day: 4, exercises: [
      { name: 'Barbell Row', reps: [6, 8], rest: 150, inc: 2.5 },
      { name: 'Neutral-Grip Lat Pulldown', reps: [8, 10], rest: 120, inc: 2.5, note: 'Last log 52kg × 10 (for 10–12).' },
      { name: 'Single-Arm Cable Pulldown', reps: [10, 12], rest: 90, cable: true, seed: [16.5, [11, 8, 7]], note: 'kg per arm.' },
      { name: 'Dual-Handle Seated Cable Row', reps: [10, 12], rest: 120, cable: true, seed: [16.5, [11, 9, 8]], note: 'One handle on each pulley.' },
      { name: '1-Arm Cable Rear Delt Flye', reps: [10, 12], rest: 60, cable: true, seed: [6.25, [12, 9, 8]] },
      { name: 'DB Shrug', reps: [10, 12], rest: 90, inc: 2, note: 'Last log 25kg × 10 (for 8–10). kg per DB.' },
      { name: 'Rope Hammer Curl', reps: [10, 12], rest: 90, cable: true, seed: [23.75, [10, 8, 7]] },
      { name: 'Incline DB Curl', reps: [12, 15], rest: 90, inc: 1, note: 'Last log 8kg × 10 (for 8–10). kg per DB.' },
      { name: 'Cable Crunch', reps: [8, 10], rest: 60, cable: true },
    ],
  },
  {
    name: 'Push', day: 5, exercises: [
      { name: 'Incline DB Press', reps: [8, 10], rest: 150, inc: 2, note: 'kg per DB.' },
      { name: 'Chest Dips', reps: [8, 10], rest: 120, seed: [0, [8, 7, 6]], inc: 2.5, note: 'Lean forward for chest. Belt on once set 1 hits 10.' },
      { name: 'Machine Shoulder Press', reps: [8, 10], rest: 120, seed: [25, [9, 7, 6]], inc: 2.5, note: 'Plate-loaded, kg per side.' },
      { name: 'Pec Deck', reps: [10, 12], rest: 90, inc: 2.5, note: 'Last log 66kg × 8 (for 8–10).' },
      { name: 'Cable Upright Row', reps: [8, 10], rest: 90, cable: true, seed: [37.5, [9, 8, 7]] },
      { name: 'Cable Triceps Pushdown', reps: [8, 10], rest: 90, cable: true, note: 'Last log 26.1kg × 10 (for 10–12) — go heavier.' },
      { name: 'Seated DB Lateral Raise', reps: [12, 15], rest: 90, myo: true, inc: 1, note: 'Last log 8kg × 12, 12, 12 (for 10–12).' },
      { name: 'Overhead Cable Triceps Extension', reps: [8, 10], rest: 90, cable: true, seed: [33.75, [10, 9, 8]], note: 'EZ-bar attachment.' },
      { name: 'Roman Chair Leg Raise', reps: [10, 20], rest: 60 },
    ],
  },
  {
    name: 'Legs', day: 6, exercises: [
      { name: 'Leg Press', reps: [8, 10], rest: 150, seed: [85, [8, 7, 6]], inc: 5, note: 'kg per side.' },
      { name: 'Seated Leg Curl', reps: [10, 12], rest: 90, inc: 2.5, note: 'Last log 42.5kg × 12 (for 8–10).' },
      { name: 'Hack Squat', reps: [8, 10], rest: 150, inc: 5 },
      { name: 'Lying Leg Curl', reps: [8, 10], rest: 90, inc: 2.5 },
      { name: 'DB Bulgarian Split Squat', reps: [8, 10], rest: 120, seed: [15, [8, 5]], inc: 2, note: 'kg per DB.' },
      { name: 'Back Extension', reps: [10, 15], rest: 90, inc: 2.5, note: '45° hyperextension. Hold a plate once 15 is easy.' },
      { name: 'Smith Machine Standing Calf Raise', reps: [10, 12], rest: 60, inc: 5 },
      { name: 'Roman Chair Leg Raise', reps: [10, 20], rest: 60 },
    ],
  },
];

function toTemplateExercise(e: Ex): TemplateExercise {
  const technique: Technique | undefined = e.myo ? 'myo-match' : undefined;
  return {
    id: uid(),
    exerciseId: slug(e.name),
    sets: e.sets ?? 3,
    repMin: e.reps[0],
    repMax: e.reps[1],
    restSec: e.rest,
    startWeight: e.seed?.[0] ?? e.start ?? 0,
    increment: e.inc,
    warmupSets: 0,
    machineNote: e.note,
    technique,
    cable: e.cable || undefined,
    station: e.cable ? 'small' : undefined,
    seed: e.seed ? { weight: e.seed[0], reps: e.seed[1] } : undefined,
  };
}

export function buildProgram(): { templates: WorkoutTemplate[]; schedule: (string | null)[] } {
  const schedule: (string | null)[] = [null, null, null, null, null, null, null];
  const templates = PROGRAM.map(p => {
    const t: WorkoutTemplate = { id: uid(), name: p.name, notes: 'RPE 8–9 on early sets, last set to failure.', exercises: p.exercises.map(toTemplateExercise) };
    schedule[p.day] = t.id;
    return t;
  });
  return { templates, schedule };
}

export const PROGRAM_EXERCISE_NAMES = PROGRAM.flatMap(p => p.exercises.map(e => e.name));
