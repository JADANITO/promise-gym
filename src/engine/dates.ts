export const DAY = 86_400_000;

/** Local calendar date as YYYY-MM-DD. */
export function ymd(d: Date | number = new Date()): string {
  const x = typeof d === 'number' ? new Date(d) : d;
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as local midnight. */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / DAY);
}

/** Monday of the week containing the date. */
export function weekStart(s: string): string {
  const d = parseYmd(s);
  const offset = (d.getDay() + 6) % 7;
  return addDays(s, -offset);
}

export function fmtDate(s: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return parseYmd(s).toLocaleDateString(undefined, opts);
}

/** Minutes since midnight for an HH:MM string. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
