import type { LifeEvent, Settings, WorkoutTemplate } from '../types';
import { addDays, weekStart } from './dates';
import { plannedFor } from './schedule';

/** Jaden's planner (a Claude page). It reads the gym plan from the link, so there's no server between the two. */
export const REBUILD_WEEK = 'https://claude.ai/artifact/JuTHHVCBrQcZ2ev4UWr3dq';

/** A template name as one link-safe word: "Upper A" → "UpperA". Rebuild Week puts the spaces back. Rest is "0". */
export function planToken(name: string | null): string {
  if (name == null) return '0';
  const w = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean)
    .map(x => x[0].toUpperCase() + x.slice(1)).join('').slice(0, 20);
  return /^[A-Za-z]/.test(w) ? w : 'Gym' + w;
}

/**
 * The link fragment Rebuild Week reads: this week and next (Monday first, overrides and days off included),
 * the regular split (Monday first), and optionally a workout just finished.
 * #promise-YYYYMMDD-<14 days>-w-<7 split days>[-done-YYYYMMDD]
 */
export function rebuildHash(
  settings: Pick<Settings, 'schedule' | 'scheduleOverrides'>,
  templates: Pick<WorkoutTemplate, 'id' | 'name'>[],
  events: LifeEvent[] | undefined,
  today: string,
  doneDate?: string,
): string {
  const name = (id: string | null) => planToken(id ? templates.find(t => t.id === id)?.name ?? 'Gym' : null);
  const mon = weekStart(today);
  const days = Array.from({ length: 14 }, (_, i) => name(plannedFor(settings, addDays(mon, i), events)));
  const split = [1, 2, 3, 4, 5, 6, 0].map(d => name(settings.schedule[d] ?? null));
  return `#promise-${mon.replace(/-/g, '')}-${days.join('-')}-w-${split.join('-')}${doneDate ? '-done-' + doneDate.replace(/-/g, '') : ''}`;
}
