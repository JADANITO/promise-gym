import type { Units } from './types';

export const LB_PER_KG = 2.20462;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** kg → number in the user's units, rounded for display. */
export function toUnit(kg: number, units: Units): number {
  return units === 'lb' ? Math.round(kg * LB_PER_KG * 10) / 10 : Math.round(kg * 100) / 100;
}

/** Number typed in the user's units → kg. */
export function fromUnit(v: number, units: Units): number {
  return units === 'lb' ? v / LB_PER_KG : v;
}

export function fmtW(kg: number, units: Units): string {
  return `${toUnit(kg, units)}${units}`;
}

export function fmtKcal(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.round(n).toLocaleString()} kcal`;
}

export function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
