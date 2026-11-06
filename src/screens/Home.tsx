import { useState } from 'react';
import { useStore } from '../data/store';
import { quoteFor } from '../data/quotes';
import { PHASE_LABEL, planSnapshot, weeklyCheckInDue } from '../data/plan';
import { PROGRAM_VERSION } from '../data/program';
import { addDays, daysBetween, fmtDate, minutesOf, parseYmd, weekStart, ymd } from '../engine/dates';
import { DELOAD_DAYS, analyzePlateau, nextTemplate, phaseWeek, plateauCheckDue } from '../engine/phases';
import { DAY_NAMES, plannedFor, promisesFor, weekPlan, type PlanDay } from '../engine/schedule';
import { NumberField, Sheet, WeightInput } from '../components/ui';
import { PHASE_COLOR } from '../components/plan';
import { fmtBw, fmtRateW, fmtW } from '../format';
import type { LifeEvent } from '../types';

const EVENT_LABEL: Record<LifeEvent['type'], string> = { ill: 'Ill', away: 'Away', sore: 'Too sore', other: 'Off' };

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
  const event = s.eventToday();
  // Ill or away: no nagging about the scale or food. Just soreness still logs as normal.
  const offPlan = !!event && event.type !== 'sore';
  const yesterdayMissing = tracking && !offPlan && (ci[yesterday]?.calories == null && ci[yesterday]?.protein == null);
  const hasSchedule = s.settings.schedule.some(Boolean);
  const week = weekPlan(s.settings, s.sessions, today, s.lifeEvents);
  const promises = promisesFor({ settings: s.settings, sessions: s.sessions, checkIns: ci, weekly: s.weeklyCheckIns, target: plan.target, today, weekOf: today, events: s.lifeEvents });
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

      {s.settings.programVersion !== PROGRAM_VERSION && s.settings.onboarded && (
        <div className="card accent stack">
          <h3 className="bold">Your new program is ready</h3>
          <p className="small muted">Upper · Lower · Rest · Pull · Push · Legs · Rest, with your logged numbers carried over. Current workouts are archived; history stays.</p>
          <button className="btn primary block" onClick={() => s.loadProgram()}>Load my program</button>
        </div>
      )}

      {!plan.phase && (
        <div className="card accent stack">
          <h3 className="bold">Let your PT build your plan</h3>
          <p className="small muted">Height, waist, history and goal → lean bulk/cut roadmap, goal date, and weekly calorie & protein targets.</p>
          <button className="btn primary block" onClick={() => go('setup')}>Set up my plan</button>
        </div>
      )}

      {event && <OffPlanCard event={event} />}

      {weeklyCheckInDue(s, today) && !offPlan && (
        <div className="card accent stack">
          <h3 className="bold">Sunday check-in</h3>
          <p className="small muted">2 minutes: waist, clothes, photos, phase decision and next week's targets.</p>
          <button className="btn primary block" onClick={() => go('checkin')}>Start check-in</button>
        </div>
      )}

      {ci[today]?.bodyweight == null && !offPlan && <MorningCheckIn date={today} />}

      {plateauCheckDue(block, today) && (
        <div className="card warn stack">
          <h3 className="bold">Have you plateaued?</h3>
          <p className="small muted">{block!.minWeeks}+ weeks in this training block. Check your numbers and decide whether to deload.</p>
          <button className="btn primary block" onClick={() => setPlateauOpen(true)}>Review & answer</button>
        </div>
      )}

      <TodayCard go={go} week={week} />
      {hasSchedule && <WeekStrip week={week} />}

      {!offPlan && (plan.target || nowMin >= minutesOf(s.settings.caloriesTime)) && <NutritionCard date={today} title="Today's food" />}
      {yesterdayMissing && <NutritionCard date={yesterday} title="Yesterday's food (catch-up)" compact />}

      <div className="stats">
        <div className="stat">
          <div className="v">{plan.comp ? fmtBw(plan.comp.weight, u) : '—'}</div>
          <div className="l">{plan.status?.actual != null ? `${fmtRateW(plan.status.actual, u)} (plan ${fmtRateW(plan.status.target, u)})` : '7-day avg'}</div>
        </div>
        <div className="stat"><div className="v">{plan.comp ? `~${plan.comp.bodyFat.toFixed(1)}%` : '—'}</div><div className="l">Body fat est.{s.profile.goalBodyFat ? ` · goal ${s.profile.goalBodyFat}%` : ''}</div></div>
        <div className="stat"><div className="v">{promises.kept}/{promises.total}</div><div className="l">Promises kept this week</div></div>
      </div>
      {plan.status && plan.status.status !== 'unknown' && !offPlan && (
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

function OffPlanCard({ event }: { event: LifeEvent }) {
  const end = useStore(s => s.endLifeEvent);
  const advice = {
    ill: "Rest up. No training, no weigh-ins, no food targets — just eat enough protein and sleep. If it's only a head cold and you feel fine, a light session is OK; anything in your chest or a fever, stay home.",
    away: "Enjoy it. Scale readings from now until 3 days after you're back are ignored — holiday water weight isn't fat. When you're back, it's straight back to the plan, no compensating.",
    sore: "Soreness from a long layoff is normal and fades fast after the first sessions. Walk, stretch, eat your protein. Tomorrow you'll be fine.",
    other: 'Day off. Back to the plan tomorrow.',
  }[event.type];
  return (
    <div className="card warn stack">
      <div className="row between">
        <h3 className="bold">{EVENT_LABEL[event.type]}{event.to > event.from ? ` until ${fmtDate(event.to, { weekday: 'short', day: 'numeric', month: 'short' })}` : ' today'}</h3>
        <button className="btn sm" onClick={() => end(event.id)}>I'm back</button>
      </div>
      <p className="small">{advice}</p>
    </div>
  );
}

function CantTrainSheet({ open, onClose, hasSession }: { open: boolean; onClose: () => void; hasSession: boolean }) {
  const add = useStore(s => s.addLifeEvent);
  const today = ymd();
  const [type, setType] = useState<LifeEvent['type']>('ill');
  const [to, setTo] = useState(today);
  const [move, setMove] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  if (!open) return null;
  const save = () => {
    const movedTo = add({ type, from: today, to: to < today ? today : to }, { moveToday: hasSession && type !== 'ill' && move });
    setMsg(movedTo ? `Today's session moved to ${fmtDate(movedTo, { weekday: 'long' })}.` : null);
    if (!movedTo) onClose();
  };
  return (
    <Sheet open onClose={onClose} title="Can't train today">
      {msg ? (
        <div className="stack"><p>{msg}</p><button className="btn primary block" onClick={onClose}>OK</button></div>
      ) : (
        <div className="stack">
          <div className="chips">
            {(['ill', 'away', 'sore', 'other'] as LifeEvent['type'][]).map(t => (
              <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>{t === 'away' ? 'Away / holiday' : EVENT_LABEL[t]}</button>
            ))}
          </div>
          {(type === 'ill' || type === 'away') && (
            <div className="field">
              <label htmlFor="off-until">Until (last day off)</label>
              <input id="off-until" type="date" className="input" min={today} value={to} onChange={e => setTo(e.target.value || today)} />
            </div>
          )}
          {hasSession && type !== 'ill' && (
            <label className="row small"><input type="checkbox" checked={move} onChange={e => setMove(e.target.checked)} style={{ width: 22, height: 22 }} /> Move today's session to my next rest day this week</label>
          )}
          <p className="tiny muted">
            {type === 'ill' ? "Sessions are skipped, not crammed in later. Weigh-ins and food targets pause, and the scale is ignored until 3 days after you're better."
              : type === 'away' ? 'Weigh-ins and food targets pause. Trips of 3+ days push your plan timeline back; 2+ weeks away brings back the ramp-up when you return.'
                : "No penalty — it won't count against your promises."}
          </p>
          <button className="btn primary block" onClick={save}>Take the day{to > today ? 's' : ''} off</button>
        </div>
      )}
    </Sheet>
  );
}

function TodayCard({ go, week }: { go: (r: string) => void; week: PlanDay[] }) {
  const s = useStore();
  const today = ymd();
  const [cantTrain, setCantTrain] = useState(false);
  const name = (id: string) => s.templates.find(t => t.id === id)?.name ?? 'Workout';
  const block = s.currentPhase();
  const hasSchedule = s.settings.schedule.some(Boolean);
  const event = s.eventToday();
  const planned = hasSchedule ? plannedFor(s.settings, today, s.lifeEvents) : nextTemplate(s.templates.filter(x => !x.archived), s.sessions)?.id ?? null;
  const t = s.templates.find(x => x.id === planned);
  const doneToday = s.sessions.some(x => ymd(x.startedAt) === today);
  const missed = week.filter(d => d.status === 'missed');
  const absToday = t?.exercises.some(e => s.exercise(e.exerciseId)?.primary?.includes('abs'));

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
        <p className="muted small">Or load your program in Settings → Training split.</p>
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
      ) : event ? (
        <h2 className="bold" style={{ fontSize: 24 }}>Day off — {EVENT_LABEL[event.type].toLowerCase()}</h2>
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
          {!absToday && (
            <div className="card tight stack" style={{ gap: 4 }}>
              <b className="small">Optional 5-minute abs (at home)</b>
              <span className="small muted">2 rounds: 45s plank · 15 lying leg raises · 20 crunches · 30s side plank each side. Rest 60s between rounds.</span>
            </div>
          )}
        </>
      )}
      {!doneToday && !event && missed.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {missed.map(d => (
            <button key={d.date} className="btn sm" onClick={() => moveHere(d)}>Missed {DAY_NAMES[parseYmd(d.date).getDay()]}'s {name(d.planned!)} — do it today</button>
          ))}
        </div>
      )}
      {!t && !doneToday && !event && (
        <div className="chips">
          {s.templates.filter(x => !x.archived).map(x => <button key={x.id} className="chip" onClick={() => go(`start/${x.id}`)}>{x.name}</button>)}
        </div>
      )}
      {!doneToday && !event && <button className="btn sm ghost" onClick={() => setCantTrain(true)}>Can't train today?</button>}
      <CantTrainSheet open={cantTrain} onClose={() => setCantTrain(false)} hasSession={!!t} />
    </div>
  );
}

function WeekStrip({ week }: { week: PlanDay[] }) {
  const s = useStore();
  const [open, setOpen] = useState<PlanDay | null>(null);
  const name = (id: string | null) => (id ? s.templates.find(t => t.id === id)?.name ?? '?' : 'Rest');
  const color = { done: 'var(--accent)', missed: 'var(--bad)', today: 'var(--text)', upcoming: 'var(--muted)', rest: 'var(--border)', extra: 'var(--accent)', off: 'var(--warn)' };
  const swaps = s.exerciseOverrides.filter(o => o.date >= weekStart(ymd()));
  return (
    <div className="card tight">
      <div className="row between"><span className="small bold">This week</span><span className="tiny muted">Tap a day to move a session</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginTop: 8 }}>
        {week.map(d => (
          <button key={d.date} onClick={() => setOpen(d)} style={{ background: d.status === 'today' ? 'var(--surface-2)' : 'none', border: `1px solid ${d.status === 'today' ? 'var(--text)' : 'var(--border)'}`, borderRadius: 10, padding: '6px 2px', minHeight: 64 }}>
            <div className="tiny muted">{DAY_NAMES[parseYmd(d.date).getDay()]}</div>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: color[d.status], margin: '4px auto' }} />
            <div className="tiny" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.status === 'extra' ? '+' : d.event ? EVENT_LABEL[d.event.type] : name(d.planned)}</div>
          </button>
        ))}
      </div>
      {swaps.length > 0 && (
        <p className="tiny muted mt">{swaps.map(o => `${s.exerciseName(o.withTe.exerciseId)} → ${DAY_NAMES[parseYmd(o.date).getDay()]}`).join(' · ')} (this week only)</p>
      )}
      {open && (
        <Sheet open onClose={() => setOpen(null)} title={fmtDate(open.date, { weekday: 'long', day: 'numeric', month: 'short' })}>
          <div className="stack">
            <p className="small muted">Planned: <b>{open.event ? `Off (${EVENT_LABEL[open.event.type]})` : name(open.planned)}</b>{open.date in s.settings.scheduleOverrides ? ' (moved this week)' : ''}</p>
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
