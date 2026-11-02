import type { Exercise } from '../types';

const names = [
  // Chest
  'Bench Press', 'Incline Bench Press', 'Incline Dumbbell Press', 'Dumbbell Bench Press', 'Machine Chest Press',
  'Incline Machine Press', 'Pec Deck', 'Cable Fly', 'Dips', 'Push-ups',
  // Back
  'Lat Pulldown', 'Close-Grip Lat Pulldown', 'Pull-ups', 'Chin-ups', 'Seated Cable Row', 'Barbell Row',
  'Dumbbell Row', 'Chest-Supported Row', 'Machine Row', 'T-Bar Row', 'Straight-Arm Pulldown', 'Deadlift', 'Rack Pull',
  // Shoulders
  'Overhead Press', 'Seated Dumbbell Shoulder Press', 'Machine Shoulder Press', 'Lateral Raise', 'Cable Lateral Raise',
  'Machine Lateral Raise', 'Rear Delt Fly', 'Reverse Pec Deck', 'Face Pull', 'Upright Row', 'Shrugs',
  // Arms
  'Barbell Curl', 'Dumbbell Curl', 'Hammer Curl', 'Preacher Curl', 'Cable Curl', 'Incline Dumbbell Curl',
  'Tricep Pushdown', 'Overhead Tricep Extension', 'Skull Crushers', 'Close-Grip Bench Press', 'Machine Tricep Extension',
  // Legs
  'Back Squat', 'Front Squat', 'Hack Squat', 'Leg Press', 'Bulgarian Split Squat', 'Walking Lunges', 'Romanian Deadlift',
  'Leg Extension', 'Lying Leg Curl', 'Seated Leg Curl', 'Hip Thrust', 'Glute Bridge', 'Hip Abduction', 'Hip Adduction',
  'Standing Calf Raise', 'Seated Calf Raise', 'Smith Machine Squat',
  // Core
  'Cable Crunch', 'Hanging Leg Raise', 'Ab Wheel', 'Plank',
];

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export const BUILT_IN_EXERCISES: Exercise[] = names.map(name => ({ id: slug(name), name }));
