import { daysBetween } from '../engine/dates';

/**
 * Daily messages, all aimed at the physique and the person you're building.
 * `{name}` is your name ("you" if unset); `{goal}` is your goal, e.g. "82kg at 12%".
 */
export const QUOTES = [
  'Would future {name} be proud of today?',
  'Would the ideal {name} have skipped that last set?',
  "Don't you want your muscle back? Don't you want to keep the promise to yourself?",
  'Would future {name} trade places with you right now?',
  'Future {name} looks back at this exact day. Did you show up?',
  "You told yourself who you'd become. Was that a lie?",
  "Comfortable now, or proud later? Future {name} only gets one of them.",
  "Future {name} already has the physique. Don't be the one who cancels it.",
  "You've had this body before. Go and take it back.",
  'Would future {name} be proud, or embarrassed?',
  'Would future {name} skip this? Then neither do you.',
  'If future {name} watched today back, would it be a thank-you or an apology?',
  "Future {name} won't remember how tired you were. Only whether you went.",
  'Is this what the {name} you promised yourself would do?',
  "Don't let today's {name} cost future {name} the physique.",
  'You say you want {goal}. Does today prove it?',
  'Future {name} is built in the reps you want to skip.',
  'Would the ideal {name} recognise you today?',
  'What would the best version of {name} do right now? Do that.',
  'Skip today and who pays for it? Future {name}.',
  'Every rep is a vote for the {name} you said you\'d become.',
  'Would you hand future {name} this day and say it was your best?',
  'Every skipped session is a vote against the {name} you want to be.',
  'Would future {name} look at this session and call it enough?',
  'The ideal {name} doesn\'t negotiate with the plan. Neither do you.',
  "In six months you'll have the physique or the excuses. Decide which today.",
  'Keep the promise. Future {name} is the one who collects.',
  'Future {name} is counting on the decision you make in the next ten minutes.',
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
