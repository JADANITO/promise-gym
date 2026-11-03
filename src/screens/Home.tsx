import { useState } from 'react';
import { useStore } from '../data/store';
import { quoteFor } from '../data/quotes';
import { PHASE_LABEL, planSnapshot, weeklyCheckInDue } from '../data/plan';
import { addDays, daysBetween, fmtDate, minutesOf, parseYmd, ymd } from '../engine/dates';
import { DELOAD_DAYS, analyzePlateau, nextTemplate, phaseWeek, plateauCheckDue } from '../engine/phases';
import { DAY_NAMES, plannedFor, promisesFor, weekPlan, type PlanDay } from '../engine/schedule';
import { NumberField, Sheet, WeightInput } from '../components/ui';
import { PHASE_COLOR } from '../components/plan';
import { fmtBw, fmtRateW, fmtW } from '../format';

export function Home({ go }: { go: (r: string) => void }) {
  const s = useStore();
  const today = ymd();
  const block = s.currentPhase();
  const plan = planSnapshot(s, today);
  const quote = quoteFor(today, s.settings.customQuotes);
  const ci = s.checkIns;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const yesterday = addDays(today, -1);
  const tracking = Object.keys(ci).some(d => d <= yesterday);
  const yesterdayMissing = tracking && (ci[yesterday]?.calories == null && ci[yesterday]?.protein == null);
  const hasSchedule = s.settings.schedule.some(Boolean);
  const week = weekPlan(s.settings, s.sessions, today);
  const promises = promisesFor({ settings: s.settings, sessions: s.sessions, checkIns: ci, weekly: s.weeklyCheckIns, target: plan.target, today, weekOf: today });
  const [plateauOpen, setPlateauOpen] = useState(false);
  const u = s.settings.units;

  return (
    <div className="stack">
      <div className="row between wrap" style={{ gap: 6 }}>
        <span className="muted small bold">{fmtDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <div className="row" style={{ gap: 6 }}>
          {plan.phase && <span className="pill" style={{ borderColor: PHASE_COLOR[plan.phase.type], color: PHASE_COLOR[plan.phase.type] }}>{PHASE_LABEL[plan.phase.type]} · wk {plan.weeksIn + 1}</span>}
          {block && (
            <span className={`pill ${block.type === 'deload' ? 'deload' : ''}`}>
              {block.type === 'deload' ? `Deload · day ${Math.min(daysBetween(block.startDate, today) + 1, DELOAD_DAYS)}/${DELOAD_DAYS}` : `Block ${block.number} · wk ${phaseWeek(block, today)}`}
            </span>
          )}
        </div>
      </div>

      <div className="card"><p className="quote">{quote}</p></div>

      {!plan.phase && (
        <div className="card accent stack">
          <h3 className="bold">Let your PT build your plan</h3>
          <p className="small muted">Height, waist, history and goal → lean bulk/cut roadmap, goal date, and weekly calorie & protein targets.</p>
          <button className="btn primary block" onClick={() => go('setup')}>Set up my plan</button>
        </div>
      )}

      {weeklyCheckInDue(s, today) && (
        <div className="card accent stack">
          <h3 className="bold">Sunday check-in</h3>
          <p className="small muted">2 minutes: waist, clothes, photos, phase decision and next week's targets.</p>
          <button className="btn primary block" onClick={() => go('checkin')}>Start check-in</button>
        </div>
      )}

      {ci[today]?.bodyweight == null && <MorningCheckIn date={today} />}

      {plateauCheckDue(block, today) && (
        <div className="card warn stack">
          <h3 className="bold">Have you plateaued?</h3>
          <p className="small muted">{block!.minWeeks}+ weeks in this training block. Check your numbers and decide whether to deload.</p>
          <button className="btn primary block" onClick={() => setPlateauOpen(true)}>Review & answer</button>
        </div>
      )}

      <TodayCard go={go} week={week} />
      {hasSchedule && <WeekStrip week={week} />}

      {(plan.target || nowMin >= minutesOf(s.settings.caloriesTime)) && <NutritionCard date={today} title="Today's food" />}
      {yesterdayMissing && <NutritionCard date={yesterday} title="Yesterday's food (catch-up)" compact />}

      <div className="stats">
        <div className="stat">
          <div className="v">{plan.comp ? fmtBw(plan.comp.weight, u) : '—'}</div>
          <div className="l">{plan.status?.actual != null ? `${fmtRateW(plan.status.actual, u)} (plan ${fmtRateW(plan.status.target, u)})` : '7-day avg'}</div>
        </div>
        <div className="stat"><div className="v">{plan.comp ? `~${plan.comp.bodyFat.toFixed(1)}%` : '—'}</div><div className="l">Body fat est.{s.profile.goalBodyFat ? ` · goal ${s.profile.goalBodyFat}%` : ''}</div></div>
        <div className="stat"><div className="v">{promises.kept}/{promises.total}</div><div className="l">Promises kept this week</div></div>
      </div>
      {plan.status && plan.status.status !== 'unknown' && (
        <div className="card tight row">
          <span className={`pill ${plan.status.status === 'on-track' ? 'good' : 'warn'}`}>{plan.status.status === 'on-track' ? 'On track' : plan.status.status === 'fast' ? 'Too fast' : 'Too slow'}</span>
          <span className="small grow">{plan.status.advice}</span>
        </div>
      )}

      {block?.type === 'deload' && <DeloadCard />}
      <PlateauSheet open={plateauOpen} onClose={() => setPlateauOpen(false)} />
    </div>
  );
}

function TodayCard({ go, week }: { go: (r: string) => void; week: PlanDay[] }) {
  const s = useStore();
  const today = ymd();
  const name = (id: string) => s.templates.find(t => t.id === id)?.name ?? 'Workout';
  const block = s.currentPhase();
  const hasSchedule = s.settings.schedule.some(Boolean);
  const planned = hasSchedule ? plannedFor(s.settings, today) : nextTemplate(s.templates, s.sessions)?.id ?? null;
  const t = s.templates.find(x => x.id === planned);
  const doneToday = s.sessions.some(x => ymd(x.startedAt) === today);
  const missed = week.filter(d => d.status === 'missed');

  if (s.active) {
    return (
      <div className="card accent stack">
        <p className="small muted bold">IN PROGRESS</p>
        <h2 className="bold" style={{ fontSize: 24 }}>{s.active.session.templateName}</h2>
        <button className="btn primary big block" onClick={() => go('workout')}>Resume workout</button>
      </div>
    );
  }
  if (!s.templates.length) {
    return (
      <div className="card accent stack center">
        <h2 className="bold">Build your first workout</h2>
        <p className="muted small">Or load the PT program in Settings → Training split.</p>
        <button className="btn primary big block" onClick={() => go('edit/new')}>Create workout</button>
      </div>
    );
  }
  const moveHere = (d: PlanDay) => { s.setOverride(today, d.planned); s.setOverride(d.date, null); };

  return (
    <div className={`card stack ${block?.type === 'deload' ? 'deload' : 'accent'}`}>
      <p className="small muted bold">TODAY {block?.type === 'deload' && <span className="pill deload">DELOAD</span>}</p>
      {doneToday ? (
        <>
          <h2 className="bold" style={{ fontSize: 24 }}>Done for today ✓</h2>
          <p className="small muted">Eat your protein, sleep 7–9 hours. That's where the muscle is built.</p>
        </>
      ) : t ? (
        <>
          <h2 className="bold" style={{ fontSize: 26 }}>{t.name}</h2>
          <p className="muted small">{t.exercises.map(e => s.exerciseName(e.exerciseId)).join(' · ')}</p>
          <button className="btn primary big block" disabled={!t.exercises.length} onClick={() => go(`start/${t.id}`)}>Start Workout</button>
        </>
      ) : (
        <>
          <h2 className="bold" style={{ fontSize: 24 }}>Rest day</h2>
          <p className="small muted">Recovery is part of the plan. Walk, stretch, hit your protein.</p>
        </>
      )}
      {!doneToday && missed.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {missed.map(d => (
            <button key={d.date} className="btn sm" onClick={() => moveHere(d)}>Missed {DAY_NAMES[parseYmd(d.date).getDay()]}'s {name(d.planned!)} — do it today</button>
          ))}
        </div>
      )}
      {!t && !doneToday && (
        <div className="chips">
          {s.templates.filter(x => !x.archived).map(x => <button key={x.id} className="chip" onClick={() => go(`start/${x.id}`)}>{x.name}</button>)}
        </div>
      )}
    </div>
  );
}

function WeekStrip({ week }: { week: PlanDay[] }) {
  const s = useStore();
  const [open, setOpen] = useState<PlanDay | null>(null);
  const name = (id: string | null) => (id ? s.templates.find(t => t.id === id)?.name ?? '?' : 'Rest');
  const color = { done: 'var(--accent)', missed: 'var(--bad)', today: 'var(--text)', upcoming: 'var(--muted)', rest: 'var(--border)', extra: 'var(--accent)' };
  return (
    <div className="card tight">
      <div className="row between"><span className="small bold">This week</span><span className="tiny muted">Tap a day to move a session</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginTop: 8 }}>
        {week.map(d => (
          <button key={d.date} onClick={() => setOpen(d)} style={{ background: d.status === 'today' ? 'var(--surface-2)' : 'none', border: `1px solid ${d.status === 'today' ? 'var(--text)' : 'var(--border)'}`, borderRadius: 10, padding: '6px 2px', minHeight: 64 }}>
            <div className="tiny muted">{DAY_NAMES[parseYmd(d.date).getDay()]}</div>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: color[d.status], margin: '4px auto' }} />
            <div className="tiny" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.status === 'extra' ? '+' : name(d.planned)}</div>
          </button>
        ))}
      </div>
      {open && (
        <Sheet open onClose={() => setOpen(null)} title={fmtDate(open.date, { weekday: 'long', day: 'numeric', month: 'short' })}>
          <div className="stack">
            <p className="small muted">Planned: <b>{name(open.planned)}</b>{open.date in s.settings.scheduleOverrides ? ' (moved this week)' : ''}</p>
            <div className="chips">
              {s.templates.filter(t => !t.archived).map(t => (
                <button key={t.id} className={`chip ${open.planned === t.id ? 'on' : ''}`} onClick={() => {
                  // Moving a session swaps days: wherever it was still to come this week gets this day's old plan.
                  const from = week.find(d => d.date !== open.date && d.planned === t.id && d.status !== 'done');
                  s.setOverride(open.date, t.id);
                  if (from) s.setOverride(from.date, open.planned);
                  setOpen(null);
                }}>{t.name}</button>
              ))}
              <button className={`chip ${open.planned == null ? 'on' : ''}`} onClick={() => { s.setOverride(open.date, null); setOpen(null); }}>Rest</button>
            </div>
            {open.date in s.settings.scheduleOverrides && <button className="btn sm" onClick={() => { s.setOverride(open.date, undefined); setOpen(null); }}>Reset to normal split</button>}
            <p className="tiny muted">Changes apply to this date only. Edit your regular split in Settings.</p>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function MorningCheckIn({ date }: { date: string }) {
  const s = useStore();
  const units = s.settings.units;
  const [kg, setKg] = useState<number | undefined>();
  const [sleepHours, setSleepHours] = useState<number | undefined>(s.checkIns[date]?.sleepHours);
  const [confirming, setConfirming] = useState(false);
  const last = Object.values(s.checkIns).filter(c => c.bodyweight != null && c.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];

  const save = () => {
    if (kg == null || kg <= 0) return;
    if (last && Math.abs(kg - last.bodyweight!) > 3 && !confirming) { setConfirming(true); return; }
    s.setCheckIn(date, { bodyweight: Math.round(kg * 100) / 100, sleepHours });
  };
  return (
    <div className="card stack">
      <h3 className="bold">Good morning — weigh in</h3>
      <p className="tiny muted">After the toilet, before food or water. Same time every day.</p>
      <WeightInput kg={kg} onChange={k => { setKg(k); setConfirming(false); }} />
      <div className="field">
        <label>Hours slept last night (optional)</label>
        <NumberField value={sleepHours} onChange={h => setSleepHours(h == null ? undefined : Math.min(16, h))} suffix="hrs" step={0.5} optional placeholder="e.g. 7.5" />
      </div>
      <button className="btn primary block" disabled={kg == null} onClick={save}>{confirming ? 'Yes, save' : 'Save'}</button>
      {confirming && last && (
        <p className="small" style={{ color: 'var(--warn)' }}>
          That's {fmtW(Math.abs(kg! - last.bodyweight!), units)} different from your last weigh-in ({fmtW(last.bodyweight!, units)}). Typo? Tap “Yes, save” if it's right.
        </p>
      )}
    </div>
  );
}

/** Today's calorie and protein targets, with quick logging. Calories are optional (light mode). */
export function NutritionCard({ date, title, compact }: { date: string; title: string; compact?: boolean }) {
  const s = useStore();
  const target = planSnapshot(s, date).target;
  const ci = s.checkIns[date];
  const [kcal, setKcal] = useState(ci?.calories != null ? String(ci.calories) : '');
  const [protein, setProtein] = useState(ci?.protein != null ? String(ci.protein) : '');
  const [saved, setSaved] = useState(false);
  const k = parseInt(kcal, 10), p = parseInt(protein, 10);
  const save = () => {
    s.setCheckIn(date, { calories: isNaN(k) ? undefined : k, protein: isNaN(p) ? undefined : p });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const bar = (v: number | undefined, t: number | undefined) => t && v != null ? <div className="progress" style={{ margin: '4px 0 0' }}><div style={{ width: `${Math.min(100, (v / t) * 100)}%`, background: v >= t * 0.9 ? 'var(--accent)' : 'var(--warn)' }} /></div> : null;
  return (
    <div className="card stack">
      <div className="row between">
        <h3 className="bold">{title}</h3>
        {target && !compact && <span className="small muted num">{target.kcal.toLocaleString()} kcal · {target.protein}g</span>}
      </div>
      <div className="row">
        <div className="field grow">
          <label>Protein (g){target ? ` / ${target.protein}` : ''}</label>
          <input className="input num" inputMode="numeric" placeholder={target ? String(target.protein) : 'e.g. 150'} value={protein} onChange={e => setProtein(e.target.value)} />
          {bar(ci?.protein, target?.protein)}
        </div>
        <div className="field grow">
          <label>Calories{target ? ` / ${target.kcal.toLocaleString()}` : ''}</label>
          <input className="input num" inputMode="numeric" placeholder="optional" value={kcal} onChange={e => setKcal(e.target.value)} />
          {bar(ci?.calories, target?.kcal)}
        </div>
      </div>
      <button className="btn primary block" disabled={isNaN(k) && isNaN(p)} onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
      {!compact && <p className="tiny muted">Rough is fine. Skip calories on busy days — I'll steer by your weight trend.</p>}
    </div>
  );
}

function DeloadCard() {
  const end = useStore(s => s.endDeloadEarly);
  return (
    <div className="card deload stack">
      <h3 className="bold">Deload week</h3>
      <p className="small muted">Same workouts, lighter weight and half the sets. Nothing you do this week changes your progression. A new training block starts automatically after 7 days, picking up your pre-deload weights and targets.</p>
      <button className="btn sm" onClick={() => { if (confirm('End the deload and start a new training block now?')) end(); }}>End deload early</button>
    </div>
  );
}

export function PlateauSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  if (!open) return null;
  const today = ymd();
  const cutting = s.currentNutritionPhase()?.type === 'cut';
  const a = analyzePlateau(s.sessions, Object.values(s.checkIns), s.settings.basis, today, 14, cutting);
  const u = s.settings.units;
  return (
    <Sheet open onClose={onClose} title="Have you plateaued?">
      <div className="stack">
        <div className="stats">
          <div className="stat"><div className="v">{a.progressedPct}%</div><div className="l">{cutting ? 'Lifts held or improved' : 'Exercises progressed'} (2 wks)</div></div>
          <div className="stat"><div className="v">{a.stalled.length}</div><div className="l">Stalled</div></div>
          <div className="stat"><div className="v">{a.avgRpe != null ? a.avgRpe.toFixed(1) : '—'}</div><div className="l">Avg RPE</div></div>
        </div>
        {a.stalled.length > 0 && <p className="small"><b>Stalled or failing:</b> {a.stalled.map(s.exerciseName).join(', ')}</p>}
        <p className="small muted">
          Bodyweight: {a.bodyweightPerWeek != null ? fmtRateW(a.bodyweightPerWeek, u) : 'not enough data'} ·
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
