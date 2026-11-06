import { daysBetween } from '../engine/dates';

/**
 * Daily messages, all aimed at the physique and the person you're building.
 * `{name}` is your name ("you" if unset); `{goal}` is your goal, e.g. "82kg at 12%".
 */
export const QUOTES = [
  'Would future {name} be proud of today?',
  "Don't you want your muscle back? Don't you want to keep the promise to yourself?",
  'Every rep is a vote for the {name} you said you\'d become.',
  'Future {name} looks back at this exact day. Did you show up?',
  'Picture {goal}, lean, shirts fitting right. That is what\'s on the bar today.',
  "Comfortable now, or proud later? Future {name} only gets one of them.",
  "Future {name} won't remember how tired you were. Only whether you went.",
  'Close the gap between who you are and who you promised to be.',
  'The ideal {name} isn\'t more motivated than you. Just more consistent.',
  "You've had this body before. Go and take it back.",
  'Would future {name} skip this? Then neither do you.',
  "Don't let today's {name} cost future {name} the physique.",
  'Future {name} is built in the reps you want to skip.',
  'What would the best version of {name} do right now? Do that.',
  'The physique you want is on the other side of the sessions you don\'t feel like doing.',
  'Keep the promise. Future {name} is the one who collects.',
  'Be the {name} you would look up to.',
  "You're not training for today. You're training for {name} in the mirror next summer.",
  'Every skipped session is a vote against the {name} you want to be.',
  'One more rep than last time. That is how future {name} gets built.',
  'Somewhere ahead is the strongest, leanest {name} yet. Today moves you closer.',
  'Your dream physique isn\'t built on good days. It\'s built on days like this one.',
  'Make today a day future {name} thanks you for.',
  'Shoulders, arms, a waist that still fits your jeans. Earned one session at a time.',
  'The ideal {name} doesn\'t negotiate with the plan. Neither do you.',
  "In six months you'll have the physique or the excuses. Decide which today.",
  'Future {name} is counting on the decision you make in the next ten minutes.',
  'Future {name} will thank you most for the boring days.',
  'Look in the mirror a year from now. Make it the body you promised yourself.',
  '{goal} lean doesn\'t happen to people. It happens to people who turn up.',
];

/** Shown when you tell the app you missed this morning's weigh-in. */
export const MISSED_WEIGH_IN = [
  "Missed one. Future {name} doesn't miss two. Scale first thing tomorrow.",
  'One missed weigh-in is nothing. Two in a row is a habit forming. Not this time.',
  'The physique is built on boring consistency. Back on the scale tomorrow morning.',
  'Future {name} steps on the scale before the kettle goes on. Be that person tomorrow.',
  "You can't steer to {goal} without the numbers. Tomorrow, scale before anything else.",
  'Would future {name} let one missed morning become a missed week? No. Tomorrow, then.',
];

export interface QuoteVars { name?: string; goal?: string }

/** Fill in `{name}` and `{goal}`. */
export function fillQuote(q: string, v: QuoteVars): string {
  const name = v.name?.trim() || 'you';
  return q.replace(/\{name\}/g, name).replace(/\{goal\}/g, v.goal || 'your goal');
}

const pick = (list: string[], today: string, offset = 0) => {
  const n = daysBetween('2024-01-01', today) + offset;
  return list[((n % list.length) + list.length) % list.length];
};

/** Quote for a given day. Consecutive days always get different quotes. */
export function quoteFor(today: string, custom: string[], v: QuoteVars = {}): string {
  return fillQuote(pick([...QUOTES, ...custom.filter(Boolean)], today), v);
}

export function missedWeighInQuote(today: string, v: QuoteVars = {}): string {
  return fillQuote(pick(MISSED_WEIGH_IN, today), v);
}

export type DayPart = 'night' | 'morning' | 'afternoon' | 'evening';

/** Time of day from the device clock: morning 5–12, afternoon 12–17, evening 17–23. */
export function dayPart(d = new Date()): DayPart {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 23) return 'evening';
  return 'night';
}

export function greeting(name?: string, d = new Date()): string {
  const n = name?.trim() ? `, ${name.trim()}` : '';
  return { morning: `Good morning${n}`, afternoon: `Good afternoon${n}`, evening: `Good evening${n}`, night: `Still up${n}?` }[dayPart(d)];
}
