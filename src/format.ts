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

export const CM_PER_IN = 2.54;

export function toLen(cm: number, units: 'cm' | 'in'): number {
  return units === 'in' ? Math.round((cm / CM_PER_IN) * 10) / 10 : Math.round(cm * 10) / 10;
}

export function fromLen(v: number, units: 'cm' | 'in'): number {
  return units === 'in' ? v * CM_PER_IN : v;
}

export function fmtLen(cm: number, units: 'cm' | 'in'): string {
  return `${toLen(cm, units)}${units === 'in' ? '"' : 'cm'}`;
}

/** Bodyweight with one decimal. */
export function fmtBw(kg: number, units: 'kg' | 'lb'): string {
  return `${toUnit(kg, units).toFixed(1)}${units}`;
}

export function fmtRateW(kgPerWeek: number, units: 'kg' | 'lb'): string {
  const v = units === 'lb' ? kgPerWeek * LB_PER_KG : kgPerWeek;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}${units}/wk`;
}

/** Load as the user thinks of it: plain weight, assistance, or bodyweight plus belt. */
export function fmtLoad(kg: number, kind: 'weighted' | 'assisted' | 'bodyweight' | undefined, units: Units): string {
  if (kind === 'bodyweight') return kg > 0 ? `BW + ${fmtW(kg, units)}` : 'Bodyweight';
  if (kind === 'assisted') return kg > 0 ? `${fmtW(kg, units)} assist` : 'Bodyweight';
  return fmtW(kg, units);
}
