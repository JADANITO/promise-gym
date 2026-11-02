import type { TemplateExercise, WorkoutTemplate } from '../types';
import { slug } from './library';
import { uid } from '../format';

type Ex = [name: string, sets: number, repMin: number, repMax: number, restSec: number, increment: number];

/**
 * PT starter program for an Upper / Lower / Rest / Pull / Legs / Push / Rest week.
 * Roughly 10–14 hard sets per muscle per week (calves 8, abs 6); start weights are entered on day one.
 */
const PROGRAM: { name: string; day: number; exercises: Ex[] }[] = [
  {
    name: 'Upper', day: 1, exercises: [
      ['Incline Dumbbell Press', 3, 8, 12, 120, 2],
      ['Chest-Supported Row', 3, 8, 12, 120, 2.5],
      ['Seated Dumbbell Shoulder Press', 2, 8, 12, 120, 2],
      ['Lat Pulldown', 3, 10, 12, 90, 2.5],
      ['Lateral Raise', 4, 12, 15, 60, 1],
      ['Hammer Curl', 2, 10, 12, 60, 1],
      ['Tricep Pushdown', 2, 10, 12, 60, 2.5],
    ],
  },
  {
    name: 'Lower', day: 2, exercises: [
      ['Hack Squat', 3, 8, 12, 150, 5],
      ['Romanian Deadlift', 3, 8, 10, 120, 2.5],
      ['Leg Extension', 2, 12, 15, 90, 2.5],
      ['Seated Leg Curl', 3, 10, 12, 90, 2.5],
      ['Standing Calf Raise', 4, 10, 15, 60, 5],
      ['Cable Crunch', 3, 10, 15, 60, 2.5],
    ],
  },
  {
    name: 'Pull', day: 4, exercises: [
      ['Close-Grip Lat Pulldown', 3, 8, 12, 120, 2.5],
      ['Seated Cable Row', 3, 8, 12, 120, 2.5],
      ['Reverse Pec Deck', 4, 12, 15, 60, 2.5],
      ['Face Pull', 3, 12, 15, 60, 2.5],
      ['Incline Dumbbell Curl', 3, 8, 12, 90, 1],
      ['Preacher Curl', 2, 10, 12, 60, 2.5],
    ],
  },
  {
    name: 'Legs', day: 5, exercises: [
      ['Leg Press', 3, 10, 12, 150, 5],
      ['Bulgarian Split Squat', 2, 8, 12, 120, 2],
      ['Lying Leg Curl', 3, 10, 12, 90, 2.5],
      ['Hip Thrust', 3, 8, 12, 120, 5],
      ['Seated Calf Raise', 4, 12, 15, 60, 5],
      ['Hanging Leg Raise', 3, 10, 15, 60, 0],
    ],
  },
  {
    name: 'Push', day: 6, exercises: [
      ['Machine Chest Press', 3, 8, 12, 120, 2.5],
      ['Incline Machine Press', 3, 8, 12, 120, 2.5],
      ['Cable Fly', 2, 12, 15, 60, 2.5],
      ['Machine Shoulder Press', 2, 8, 12, 120, 2.5],
      ['Cable Lateral Raise', 4, 12, 15, 60, 1],
      ['Overhead Tricep Extension', 3, 10, 12, 60, 2.5],
    ],
  },
];

export function buildStarterProgram(): { templates: WorkoutTemplate[]; schedule: (string | null)[] } {
  const schedule: (string | null)[] = [null, null, null, null, null, null, null];
  const templates = PROGRAM.map(p => {
    const t: WorkoutTemplate = {
      id: uid(),
      name: p.name,
      notes: 'PT starter program — edit freely.',
      exercises: p.exercises.map(([name, sets, repMin, repMax, restSec, increment]): TemplateExercise => ({
        id: uid(), exerciseId: slug(name), sets, repMin, repMax, restSec, startWeight: 0, increment, warmupSets: 0,
      })),
    };
    schedule[p.day] = t.id;
    return t;
  });
  return { templates, schedule };
}
