import { daysBetween } from '../engine/dates';

export const QUOTES = [
  "Don't you want your muscle back? Don't you want to keep the promise to yourself?",
  "Nobody's coming to do this for you. Show up.",
  "The version of you that you're chasing is built in sessions like today's.",
  "You said you'd do this. Prove yourself right.",
  'Discipline is remembering what you want.',
  'One more rep than last time. That is the whole game.',
  "You don't need motivation. You need to walk through the door.",
  'Every rep you skip is a promise you break to yourself.',
  "The bar doesn't care how you feel. Lift it anyway.",
  "You've started over enough times. This time you finish.",
  'Small wins, stacked daily, become a body you are proud of.',
  "The hardest part is getting there. You've done harder things.",
  'Future you is watching. Make them grateful.',
  'Consistency beats intensity. Be here again today.',
  "Remember why you started. That reason hasn't gone anywhere.",
  'Earn the weight on the bar. Then earn the next plate.',
  "You're not tired, you're comfortable. Get uncomfortable.",
  "Show up on the days you don't feel like it. Those are the days that count.",
  'Strength is built one session at a time. This is one of them.',
  "You can have results or excuses. Not both.",
  "Your muscle is waiting for you. Go get it back.",
  "No one remembers the workouts they skipped. They remember the body they built.",
  "Keep your word to yourself — it's the only one that really matters.",
  'Progress is quiet. Keep stacking it.',
  'Beat last week. That is all today asks of you.',
  'The weight feels heavy because you are getting stronger.',
  "Rest when the timer says. Work when it doesn't.",
  'You are one workout away from a better mood.',
  "Don't negotiate with yourself. The plan is the plan.",
  "Be the person who does what they said they'd do.",
  'Track it. Beat it. Repeat it.',
  'Today is a chance to be stronger than you were on Monday.',
];

/** Quote for a given day. Consecutive days always get different quotes. */
export function quoteFor(today: string, custom: string[]): string {
  const all = [...QUOTES, ...custom.filter(Boolean)];
  const n = daysBetween('2024-01-01', today);
  return all[((n % all.length) + all.length) % all.length];
}
