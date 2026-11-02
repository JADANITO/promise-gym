import { useState } from 'react';
import { useStore } from '../data/store';
import { quoteFor } from '../data/quotes';
import { addDays, daysBetween, fmtDate, minutesOf, weekStart, ymd } from '../engine/dates';
import { DELOAD_DAYS, analyzePlateau, nextTemplate, phaseWeek, plateauCheckDue } from '../engine/phases';
import { goalProgress } from '../engine/stats';
import { Sheet, WeightInput } from '../components/ui';
import { fmtW, toUnit } from '../format';

export function Home({ go }: { go: (r: string) => void }) {
  const s = useStore();
  const today = ymd();
  const phase = s.currentPhase();
  const next = nextTemplate(s.templates, s.sessions);
  const quote = quoteFor(today, s.settings.customQuotes);
  const ci = s.checkIns;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const yesterday = addDays(today, -1);
  const askTodayKcal = ci[today]?.calories == null && nowMin >= minutesOf(s.settings.caloriesTime);
  const askYesterdayKcal = ci[yesterday]?.calories == null && Object.keys(ci).some(d => d <= yesterday);
  const gp = goalProgress(Object.values(ci), s.goals, today);
  const thisWeek = s.sessions.filter(x => ymd(x.startedAt) >= weekStart(today)).length;
  const streak = weekStreak(s.sessions.map(x => ymd(x.startedAt)), s.settings.workoutsPerWeek, today);
  const [plateauOpen, setPlateauOpen] = useState(false);
  const u = s.settings.units;

  return (
    <div className="stack">
      <div className="row between">
        <span className="muted small bold">{fmtDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        {phase && (
          <span className={`pill ${phase.type === 'deload' ? 'deload' : ''}`}>
            {phase.type === 'deload'
              ? `Deload · day ${Math.min(daysBetween(phase.startDate, today) + 1, DELOAD_DAYS)} of ${DELOAD_DAYS}`
              : `Gaining Phase ${phase.number} · Week ${phaseWeek(phase, today)} of ${phase.minWeeks}+`}
          </span>
        )}
      </div>

      <div className="card"><p className="quote">{quote}</p></div>

      {ci[today]?.bodyweight == null && <WeightCheckIn date={today} title="Good morning — log your weight" />}
      {askYesterdayKcal && <CaloriesCheckIn date={yesterday} title="How many calories did you eat yesterday?" />}
      {askTodayKcal && <CaloriesCheckIn date={today} title="How many calories did you eat today?" />}

      {plateauCheckDue(phase, today) && (
        <div className="card warn stack">
          <h3 className="bold">Have you plateaued?</h3>
          <p className="small muted">You've done {phase!.minWeeks}+ weeks in this phase. Check your numbers and decide whether to deload.</p>
          <button className="btn primary block" onClick={() => setPlateauOpen(true)}>Review & answer</button>
        </div>
      )}

      {s.active ? (
        <div className="card accent stack">
          <p className="small muted bold">IN PROGRESS</p>
          <h2 className="bold" style={{ fontSize: 24 }}>{s.active.session.templateName}</h2>
          <button className="btn primary big block" onClick={() => go('workout')}>Resume workout</button>
        </div>
      ) : next ? (
        <div className={`card stack ${phase?.type === 'deload' ? 'deload' : 'accent'}`}>
          <p className="small muted bold">TODAY'S WORKOUT {phase?.type === 'deload' && <span className="pill deload">DELOAD</span>}</p>
          <h2 className="bold" style={{ fontSize: 26 }}>{next.name}</h2>
          <p className="muted small">{next.exercises.map(e => s.exerciseName(e.exerciseId)).join(' · ')}</p>
          <button className="btn primary big block" disabled={!next.exercises.length} onClick={() => go(`start/${next.id}`)}>Start Workout</button>
          {s.templates.filter(t => !t.archived).length > 1 && (
            <div className="chips">
              {s.templates.filter(t => t.id !== next.id && !t.archived).map(t => (
                <button key={t.id} className="chip" onClick={() => go(`start/${t.id}`)}>{t.name}</button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="card accent stack center">
          <h2 className="bold">Build your first workout</h2>
          <p className="muted small">Name it, add your exercises, sets, rep ranges and rest times.</p>
          <button className="btn primary big block" onClick={() => go('edit/new')}>Create workout</button>
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <div className="v">{gp.current != null ? `${toUnit(gp.current, u).toFixed(1)}${u}` : '—'}</div>
          <div className="l">{s.goals.goalWeight ? `Goal ${fmtW(s.goals.goalWeight, u)}` : '7-day avg'}</div>
        </div>
        <div className="stat"><div className="v">{thisWeek}/{s.settings.workoutsPerWeek}</div><div className="l">Workouts this week</div></div>
        <div className="stat"><div className="v">{streak}🔥</div><div className="l">Week streak</div></div>
      </div>
      {gp.status !== 'unknown' && (
        <div className="card tight row">
          <span className={`pill ${gp.status === 'on-track' || gp.status === 'ahead' || gp.status === 'reached' ? 'good' : 'warn'}`}>{statusLabel(gp.status)}</span>
          <span className="small grow">{gp.advice}</span>
        </div>
      )}

      {phase?.type === 'deload' && <DeloadCard />}
      <PlateauSheet open={plateauOpen} onClose={() => setPlateauOpen(false)} />
    </div>
  );
}

export function statusLabel(s: string) {
  return ({ 'on-track': 'On track', ahead: 'Ahead', behind: 'Behind', 'too-fast': 'Too fast', reached: 'Goal reached', unknown: '—' } as Record<string, string>)[s];
}

function weekStreak(days: string[], perWeek: number, today: string): number {
  const counts = new Map<string, number>();
  days.forEach(d => counts.set(weekStart(d), (counts.get(weekStart(d)) ?? 0) + 1));
  let wk = weekStart(today);
  let streak = (counts.get(wk) ?? 0) >= perWeek ? 1 : 0;
  wk = addDays(wk, -7);
  while ((counts.get(wk) ?? 0) >= perWeek) { streak++; wk = addDays(wk, -7); }
  return streak;
}

function DeloadCard() {
  const end = useStore(s => s.endDeloadEarly);
  return (
    <div className="card deload stack">
      <h3 className="bold">Deload week</h3>
      <p className="small muted">Same workouts, lighter weight and half the sets. Nothing you do this week changes your progression. A new gaining phase starts automatically after 7 days, picking up your pre-deload weights and targets.</p>
      <button className="btn sm" onClick={() => { if (confirm('End the deload and start a new gaining phase now?')) end(); }}>End deload early</button>
    </div>
  );
}

export function WeightCheckIn({ date, title }: { date: string; title: string }) {
  const set = useStore(s => s.setCheckIn);
  const checkIns = useStore(s => s.checkIns);
  const units = useStore(s => s.settings.units);
  const [kg, setKg] = useState<number | undefined>();
  const [confirming, setConfirming] = useState(false);
  const last = Object.values(checkIns).filter(c => c.bodyweight != null && c.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];

  const save = () => {
    if (kg == null || kg <= 0) return;
    if (last && Math.abs(kg - last.bodyweight!) > 3 && !confirming) { setConfirming(true); return; }
    set(date, { bodyweight: Math.round(kg * 100) / 100 });
  };
  return (
    <div className="card stack">
      <h3 className="bold">{title}</h3>
      <div className="row">
        <div className="grow"><WeightInput kg={kg} onChange={k => { setKg(k); setConfirming(false); }} /></div>
        <button className="btn primary" disabled={kg == null} onClick={save}>{confirming ? 'Yes, save' : 'Save'}</button>
      </div>
      {confirming && last && (
        <p className="small" style={{ color: 'var(--warn)' }}>
          That's {fmtW(Math.abs(kg! - last.bodyweight!), units)} different from your last weigh-in ({fmtW(last.bodyweight!, units)}). Typo? Tap “Yes, save” if it's right.
        </p>
      )}
    </div>
  );
}

export function CaloriesCheckIn({ date, title }: { date: string; title: string }) {
  const set = useStore(s => s.setCheckIn);
  const [v, setV] = useState('');
  const n = parseInt(v, 10);
  return (
    <div className="card stack">
      <h3 className="bold">{title}</h3>
      <div className="row">
        <input className="input num grow" inputMode="numeric" placeholder="e.g. 2200" value={v} onChange={e => setV(e.target.value)} />
        <span className="muted bold">kcal</span>
        <button className="btn primary" disabled={isNaN(n) || n <= 0} onClick={() => set(date, { calories: n })}>Save</button>
      </div>
    </div>
  );
}

export function PlateauSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  if (!open) return null;
  const today = ymd();
  const a = analyzePlateau(s.sessions, Object.values(s.checkIns), s.settings.basis, today);
  const u = s.settings.units;
  return (
    <Sheet open onClose={onClose} title="Have you plateaued?">
      <div className="stack">
        <div className="stats">
          <div className="stat"><div className="v">{a.progressedPct}%</div><div className="l">Exercises progressed (2 wks)</div></div>
          <div className="stat"><div className="v">{a.stalled.length}</div><div className="l">Stalled</div></div>
          <div className="stat"><div className="v">{a.avgRpe != null ? a.avgRpe.toFixed(1) : '—'}</div><div className="l">Avg RPE</div></div>
        </div>
        {a.stalled.length > 0 && <p className="small"><b>Stalled or failing:</b> {a.stalled.map(s.exerciseName).join(', ')}</p>}
        <p className="small muted">
          Bodyweight: {a.bodyweightPerWeek != null ? `${a.bodyweightPerWeek > 0 ? '+' : ''}${fmtW(a.bodyweightPerWeek, u)}/week` : 'not enough data'} ·
          Calories: {a.avgCalories != null ? `${Math.round(a.avgCalories).toLocaleString()} kcal/day` : 'not enough data'}
        </p>
        <div className={`card tight ${a.recommendDeload ? 'warn' : 'accent'}`}><b>App recommendation:</b> {a.recommendation}</div>
        <button className="btn primary block big" onClick={() => { s.answerPlateau(true); onClose(); }}>Yes — start a deload week</button>
        <button className="btn block" onClick={() => { s.answerPlateau(false); onClose(); }}>No — keep progressing</button>
        <p className="muted tiny center">If you say no, I'll ask again in a week.</p>
      </div>
    </Sheet>
  );
}
