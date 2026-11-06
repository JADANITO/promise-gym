import type { Exercise, LoadKind, Muscle } from '../types';

type Row = [name: string, primary: Muscle[], secondary?: Muscle[], kind?: LoadKind];

const rows: Row[] = [
  // Chest
  ['Bench Press', ['chest'], ['triceps', 'front-delts']],
  ['Incline Bench Press', ['chest'], ['front-delts', 'triceps']],
  ['Incline Dumbbell Press', ['chest'], ['front-delts', 'triceps']],
  ['Incline DB Press', ['chest'], ['front-delts', 'triceps']],
  ['Dumbbell Bench Press', ['chest'], ['triceps', 'front-delts']],
  ['Machine Chest Press', ['chest'], ['triceps', 'front-delts']],
  ['Incline Machine Press', ['chest'], ['front-delts', 'triceps']],
  ['Pec Deck', ['chest']],
  ['Cable Fly', ['chest']],
  ['Dips', ['chest', 'triceps'], ['front-delts'], 'bodyweight'],
  ['Push-ups', ['chest'], ['triceps', 'front-delts'], 'bodyweight'],
  ['45° Incline Barbell Press', ['chest'], ['front-delts', 'triceps']],
  ['Decline Cable Fly', ['chest']],
  ['Chest Dips', ['chest', 'triceps'], ['front-delts'], 'bodyweight'],
  // Back
  ['Lat Pulldown', ['back'], ['biceps']],
  ['Close-Grip Lat Pulldown', ['back'], ['biceps']],
  ['Pull-ups', ['back'], ['biceps'], 'bodyweight'],
  ['Chin-ups', ['back'], ['biceps'], 'bodyweight'],
  ['Wide-Grip Pull-Up', ['back'], ['biceps', 'rear-delts'], 'bodyweight'],
  ['Assisted Wide-Grip Pull-Up', ['back'], ['biceps', 'rear-delts'], 'assisted'],
  ['Neutral-Grip Lat Pulldown', ['back'], ['biceps']],
  ['Single-Arm Cable Pulldown', ['back'], ['biceps']],
  ['Dual-Handle Seated Cable Row', ['back'], ['biceps', 'rear-delts']],
  ['Chest-Supported Machine Row', ['back'], ['rear-delts', 'biceps']],
  ['Seated Cable Row', ['back'], ['biceps', 'rear-delts']],
  ['Barbell Row', ['back'], ['biceps', 'rear-delts']],
  ['Dumbbell Row', ['back'], ['biceps', 'rear-delts']],
  ['Chest-Supported Row', ['back'], ['rear-delts', 'biceps']],
  ['Machine Row', ['back'], ['biceps', 'rear-delts']],
  ['T-Bar Row', ['back'], ['biceps', 'rear-delts']],
  ['Straight-Arm Pulldown', ['back']],
  ['Deadlift', ['back', 'hamstrings', 'glutes'], ['traps', 'forearms']],
  ['Rack Pull', ['back', 'traps'], ['glutes']],
  // Shoulders
  ['Overhead Press', ['front-delts'], ['triceps', 'side-delts']],
  ['Seated Dumbbell Shoulder Press', ['front-delts'], ['triceps', 'side-delts']],
  ['Machine Shoulder Press', ['front-delts'], ['triceps', 'side-delts']],
  ['Lateral Raise', ['side-delts']],
  ['Cable Lateral Raise', ['side-delts']],
  ['Machine Lateral Raise', ['side-delts']],
  ['Rear Delt Fly', ['rear-delts']],
  ['Reverse Pec Deck', ['rear-delts']],
  ['Face Pull', ['rear-delts'], ['traps']],
  ['1-Arm Cable Rear Delt Flye', ['rear-delts']],
  ['High-Cable Lateral Raise', ['side-delts']],
  ['Seated DB Lateral Raise', ['side-delts']],
  ['Cable Upright Row', ['side-delts'], ['traps']],
  ['DB Shrug', ['traps']],
  ['Upright Row', ['side-delts'], ['traps']],
  ['Shrugs', ['traps']],
  // Arms
  ['Barbell Curl', ['biceps'], ['forearms']],
  ['Dumbbell Curl', ['biceps'], ['forearms']],
  ['Hammer Curl', ['biceps', 'forearms']],
  ['Rope Hammer Curl', ['biceps', 'forearms']],
  ['EZ-Bar Reverse Curl', ['forearms', 'biceps']],
  ['Preacher Curl', ['biceps']],
  ['Cable Curl', ['biceps']],
  ['Incline Dumbbell Curl', ['biceps']],
  ['Incline DB Curl', ['biceps']],
  ['Tricep Pushdown', ['triceps']],
  ['Overhead Tricep Extension', ['triceps']],
  ['Skull Crushers', ['triceps']],
  ['EZ-Bar Skull Crusher', ['triceps']],
  ['Cable Triceps Pushdown', ['triceps']],
  ['Overhead Cable Triceps Extension', ['triceps']],
  ['Close-Grip Bench Press', ['triceps', 'chest'], ['front-delts']],
  ['Machine Tricep Extension', ['triceps']],
  // Legs
  ['Back Squat', ['quads', 'glutes'], ['hamstrings']],
  ['Front Squat', ['quads'], ['glutes']],
  ['Hack Squat', ['quads'], ['glutes']],
  ['Leg Press', ['quads', 'glutes']],
  ['Bulgarian Split Squat', ['quads', 'glutes']],
  ['Walking Lunges', ['quads', 'glutes'], ['hamstrings']],
  ['Romanian Deadlift', ['hamstrings', 'glutes'], ['back']],
  ['DB RDL', ['hamstrings', 'glutes'], ['back']],
  ['Back Extension', ['glutes', 'hamstrings'], ['back'], 'bodyweight'],
  ['DB Bulgarian Split Squat', ['quads', 'glutes']],
  ['Leg Extension', ['quads']],
  ['Lying Leg Curl', ['hamstrings']],
  ['Seated Leg Curl', ['hamstrings']],
  ['Hip Thrust', ['glutes'], ['hamstrings']],
  ['Glute Bridge', ['glutes']],
  ['Hip Abduction', ['glutes']],
  ['Hip Adduction', ['quads']],
  ['Standing Calf Raise', ['calves']],
  ['Seated Calf Raise', ['calves']],
  ['Smith Machine Squat', ['quads', 'glutes']],
  ['Smith Machine Calf Raise', ['calves']],
  ['Smith Machine Standing Calf Raise', ['calves']],
  // Core
  ['Cable Crunch', ['abs']],
  ['Hanging Leg Raise', ['abs'], undefined, 'bodyweight'],
  ['Roman Chair Leg Raise', ['abs'], undefined, 'bodyweight'],
  ['Ab Wheel', ['abs'], undefined, 'bodyweight'],
  ['Plank', ['abs'], undefined, 'bodyweight'],
];

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const GRADUATES: Record<string, string> = { 'assisted-wide-grip-pull-up': 'wide-grip-pull-up' };

export const BUILT_IN_EXERCISES: Exercise[] = rows.map(([name, primary, secondary, kind]) => {
  const id = slug(name);
  return { id, name, primary, secondary, kind, graduatesTo: GRADUATES[id] };
});

export const MUSCLES: { id: Muscle; label: string }[] = [
  { id: 'chest', label: 'Chest' },
  { id: 'back', label: 'Back (lats & mid)' },
  { id: 'front-delts', label: 'Front delts' },
  { id: 'side-delts', label: 'Side delts' },
  { id: 'rear-delts', label: 'Rear delts' },
  { id: 'traps', label: 'Traps' },
  { id: 'biceps', label: 'Biceps' },
  { id: 'triceps', label: 'Triceps' },
  { id: 'forearms', label: 'Forearms' },
  { id: 'quads', label: 'Quads' },
  { id: 'hamstrings', label: 'Hamstrings' },
  { id: 'glutes', label: 'Glutes' },
  { id: 'calves', label: 'Calves' },
  { id: 'abs', label: 'Abs' },
];

/** Muscles that should get 10–20 hard sets a week. The rest are covered by compounds. */
export const TRACKED_MUSCLES: Muscle[] = ['chest', 'back', 'side-delts', 'rear-delts', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'];

export const muscleLabel = (m: Muscle) => MUSCLES.find(x => x.id === m)?.label ?? m;
