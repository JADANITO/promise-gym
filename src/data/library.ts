import type { Exercise, Muscle } from '../types';

type Row = [name: string, primary: Muscle[], secondary?: Muscle[]];

const rows: Row[] = [
  // Chest
  ['Bench Press', ['chest'], ['triceps', 'front-delts']],
  ['Incline Bench Press', ['chest'], ['front-delts', 'triceps']],
  ['Incline Dumbbell Press', ['chest'], ['front-delts', 'triceps']],
  ['Dumbbell Bench Press', ['chest'], ['triceps', 'front-delts']],
  ['Machine Chest Press', ['chest'], ['triceps', 'front-delts']],
  ['Incline Machine Press', ['chest'], ['front-delts', 'triceps']],
  ['Pec Deck', ['chest']],
  ['Cable Fly', ['chest']],
  ['Dips', ['chest', 'triceps'], ['front-delts']],
  ['Push-ups', ['chest'], ['triceps', 'front-delts']],
  // Back
  ['Lat Pulldown', ['back'], ['biceps']],
  ['Close-Grip Lat Pulldown', ['back'], ['biceps']],
  ['Pull-ups', ['back'], ['biceps']],
  ['Chin-ups', ['back'], ['biceps']],
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
  ['Upright Row', ['side-delts'], ['traps']],
  ['Shrugs', ['traps']],
  // Arms
  ['Barbell Curl', ['biceps'], ['forearms']],
  ['Dumbbell Curl', ['biceps'], ['forearms']],
  ['Hammer Curl', ['biceps', 'forearms']],
  ['Preacher Curl', ['biceps']],
  ['Cable Curl', ['biceps']],
  ['Incline Dumbbell Curl', ['biceps']],
  ['Tricep Pushdown', ['triceps']],
  ['Overhead Tricep Extension', ['triceps']],
  ['Skull Crushers', ['triceps']],
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
  // Core
  ['Cable Crunch', ['abs']],
  ['Hanging Leg Raise', ['abs']],
  ['Ab Wheel', ['abs']],
  ['Plank', ['abs']],
];

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export const BUILT_IN_EXERCISES: Exercise[] = rows.map(([name, primary, secondary]) => ({ id: slug(name), name, primary, secondary }));

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
