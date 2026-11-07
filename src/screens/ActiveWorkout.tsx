import { useEffect, useMemo, useRef, useState } from 'react';
import { trackHistory, useStore, type ActiveExercise } from '../data/store';
import type { CableStation, LoggedSet, WorkoutSession } from '../types';
import { ExercisePicker, NumberField, Sheet, WeightInput } from '../components/ui';
import { fmtClock, fmtDuration, fmtLoad, fmtLoadShort, fmtW, uid } from '../format';
import { beep, notify, unlockAudio, vibrate } from '../alerts';
import { loadingText } from '../engine/warmup';
import { SUPERSET_SWITCH_SEC } from '../engine/timecut';

export function ActiveWorkout({ go }: { go: (r: string) => void }) {
  const active = useStore(s => s.active);
  const timer = useStore(s => s.timer);
  const keepAwake = useStore(s => s.settings.keepAwake);
  const addExercise = useStore(s => s.addExerciseToActive);
  const [picking, setPicking] = useState(false);
  const [addWeightFor, setAddWeightFor] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [short, setShort] = useState(false);
  const [now, setNow] = useState(Date.now());
  const minutesLeft = useStore(s => (s.active ? s.minutesLeft() : 0));
  const sessions = useStore(s => s.sessions);
  const beaten = useMemo(() => (active ? active.session.exercises.reduce((n, e) => {
    const last = lastTimeOf(sessions, e);
    return n + e.sets.filter(x => !x.warmup).filter((x, i) => x.completed && beatBy(e, x, last, i) != null).length;
  }, 0) : 0), [active, sessions]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Keep the screen on during the workout.
  useEffect(() => {
    if (!keepAwake || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const req = async () => { try { lock = await navigator.wakeLock.request('screen'); } catch { /* denied */ } };
    const onVis = () => { if (document.visibilityState === 'visible') void req(); };
    void req();
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); void lock?.release(); };
  }, [keepAwake]);

  if (!active) return null;
  const { session } = active;
  const remainingSets = session.exercises.filter(e => !e.skipped).flatMap(e => e.sets.filter(s => !s.warmup && !s.completed)).length;

  return (
    <div className="stack">
      <div className="row between">
        <div className="grow">
          <h1 className="page-title" style={{ marginBottom: 0 }}>{session.templateName}</h1>
          <div className="row small muted">
            {session.deload && <span className="pill deload">DELOAD</span>}
            {active.holdTargets && <span className="pill warn">Repeating last targets</span>}
            <span>{fmtDuration(now - session.startedAt)} · {remainingSets} sets · ~{minutesLeft} min left{beaten > 0 ? ` · beat last week on ${beaten}` : ''}</span>
          </div>
        </div>
        <button className="btn primary sm" onClick={() => setFinishing(true)}>Finish</button>
      </div>
      {remainingSets > 0 && <button className="btn sm ghost" onClick={() => setShort(true)}>Short on time?</button>}

      {session.exercises.map(e => <ExerciseCard key={e.id} ex={e} deload={session.deload} />)}

      <button className="btn block" onClick={() => setPicking(true)}>+ Add exercise</button>

      <ExercisePicker open={picking} onClose={() => setPicking(false)} onPick={id => { setPicking(false); setAddWeightFor(id); }} />
      <AddWeightSheet exerciseId={addWeightFor} onClose={() => setAddWeightFor(null)} onAdd={(id, kg) => { addExercise(id, kg); setAddWeightFor(null); }} />
      <ShortOnTimeSheet open={short} onClose={() => setShort(false)} />
      <FinishSheet open={finishing} onClose={() => setFinishing(false)} remainingSets={remainingSets} onDone={id => go(id ? `summary/${id}` : 'home')} />
      {timer && <RestTimerBar />}
    </div>
  );
}

function AddWeightSheet({ exerciseId, onClose, onAdd }: { exerciseId: string | null; onClose: () => void; onAdd: (id: string, kg: number) => void }) {
  const name = useStore(s => s.exerciseName);
  const [kg, setKg] = useState<number | undefined>(20);
  return (
    <Sheet open={!!exerciseId} onClose={onClose} title={exerciseId ? name(exerciseId) : ''}>
      <div className="stack">
        <div className="field"><label>Weight to use</label><WeightInput kg={kg} onChange={setKg} autoFocus /></div>
        <p className="muted small">If you've done this exercise before, your progression carries on from last time.</p>
        <button className="btn primary block" disabled={kg == null} onClick={() => exerciseId && onAdd(exerciseId, kg ?? 0)}>Add</button>
      </div>
    </Sheet>
  );
}

type LastTime = { weight: number; reps: number[]; deload?: boolean; before: boolean } | null;

/** Last session's working sets on this exercise (same station and rep range). */
function lastTimeOf(sessions: WorkoutSession[], ex: ActiveExercise): LastTime {
  const track = trackHistory(sessions, ex.source, ex.station);
  const last = track.sessions[track.sessions.length - 1];
  const le = last?.exercises[last.exercises.length - 1];
  const ws = le?.sets.filter(x => !x.warmup && x.completed) ?? [];
  return le && ws.length ? { weight: le.workingWeight, reps: ws.map(x => x.reps), deload: last.deload, before: !track.real } : null;
}

function useLastTime(ex: ActiveExercise) {
  const sessions = useStore(s => s.sessions);
  return useMemo(() => lastTimeOf(sessions, ex), [sessions, ex]);
}

/** +1 heavier than last time, 0 the same, −1 lighter (less assistance counts as heavier). */
function loadVs(kind: string, today: number, last: number): number {
  const d = Math.round((today - last) * 100);
  if (d === 0) return 0;
  return (kind === 'assisted' ? -d : d) > 0 ? 1 : -1;
}

/** How a logged set beat the same set last week: '↑' for a heavier load, '+N' for more reps, null otherwise. */
function beatBy(ex: ActiveExercise, set: LoggedSet, last: LastTime, i: number): string | null {
  if (!last || last.deload || last.reps[i] == null) return null;
  const vs = loadVs(ex.kind ?? 'weighted', set.weight, last.weight);
  if (vs > 0) return '↑';
  if (vs === 0 && set.reps > last.reps[i]) return `+${set.reps - last.reps[i]}`;
  return null;
}

function ExerciseCard({ ex, deload }: { ex: ActiveExercise; deload: boolean }) {
  const units = useStore(s => s.settings.units);
  const name = useStore(s => s.exerciseName);
  const update = useStore(s => s.updateActive);
  const completeSet = useStore(s => s.completeSet);
  const retarget = useStore(s => s.retarget);
  const setStation = useStore(s => s.setStation);
  const doLater = useStore(s => s.doLater);
  const startTimer = useStore(s => s.startTimer);
  const setIncrease = useStore(s => s.setIncreaseWeight);
  const last = useLastTime(ex);
  const [sheet, setSheet] = useState<null | 'weight' | 'rest' | 'swap' | { setId: string }>(null);
  const kind = ex.kind ?? 'weighted';
  const step = ex.increment ?? (kind === 'bodyweight' ? 2.5 : undefined);
  // Pre-fill the next load from this machine's step; the user can always change it.
  const [incKg, setIncKg] = useState<number | undefined>(() => {
    if (ex.firstWeight || step == null) return undefined;
    return kind === 'assisted' ? Math.max(0, ex.baseWeight - step) : ex.baseWeight + step;
  });
  const title = name(ex.exerciseId);
  const working = ex.sets.filter(s => !s.warmup);
  const needsNewWeight = ex.increasePrompted && !ex.increaseHandled;
  const pickWeight = needsNewWeight && ex.firstWeight;
  const load = (kg: number) => fmtLoad(kg, kind, units);
  const myo = ex.technique === 'myo-match';
  const firstSetId = working[0]?.id;
  const barKg = useStore(s => s.settings.barKg ?? 20);
  const partner = useStore(s => (ex.pairWith ? s.active?.session.exercises.find(e => e.id === ex.pairWith) : undefined));
  const plates = pickWeight ? null : loadingText(ex.workingWeight, ex.source.loading, barKg);
  const warmups = ex.sets.filter(s => s.warmup);
  const warmDone = warmups.length > 0 && warmups.every(s => s.completed);
  const allDone = working.length > 0 && working.every(s => s.completed);
  // Finished warm-ups and finished exercises fold to one line; tap to open them again.
  const [warmOpen, setWarmOpen] = useState(false);
  const [opened, setOpened] = useState(false);

  const mutateEx = (fn: (e: ActiveExercise) => void) => update(a => {
    const e = a.session.exercises.find(x => x.id === ex.id);
    if (e) fn(e);
  });

  const toggle = (setId: string) => {
    unlockAudio();
    const set = ex.sets.find(s => s.id === setId)!;
    if (!completeSet(ex.id, setId)) return;
    if (set.warmup) setWarmOpen(false);
    else if (working.every(s => s.completed || s.id === setId)) setOpened(false);
    if (set.warmup) {
      const nextWarm = ex.sets.filter(s => s.warmup && !s.completed && s.id !== setId).length;
      startTimer(nextWarm ? 45 : 90, nextWarm ? `${title} · next warm-up` : `${title} · warm-ups done — first working set next`);
      return;
    }
    const idx = working.findIndex(s => s.id === setId) + 1;
    // Superset: go straight to the partner if it's behind, rest after both.
    if (partner && !partner.skipped) {
      const mine = working.filter(s => s.completed || s.id === setId).length;
      const theirs = partner.sets.filter(s => !s.warmup && s.completed).length;
      const partnerLeft = partner.sets.some(s => !s.warmup && !s.completed);
      if (partnerLeft && theirs < mine) {
        startTimer(SUPERSET_SWITCH_SEC, `${title} · set ${idx} done → ${name(partner.exerciseId)} now`);
        return;
      }
      startTimer(Math.max(ex.restSec, partner.restSec), `Superset round ${idx} done — rest, then ${name(ex.exerciseId)}`);
      return;
    }
    const next = working[idx];
    const list = useStore.getState().active?.session.exercises ?? [];
    const upNext = list.slice(list.findIndex(e => e.id === ex.id) + 1).find(e => !e.skipped && e.sets.some(s => !s.warmup && !s.completed));
    const after = next ? ` · next: ${myo ? 'match' : 'aim for'} ${list.find(e => e.id === ex.id)?.sets.find(s => s.id === next.id)?.targetReps ?? next.targetReps}`
      : upNext ? ` · next up: ${name(upNext.exerciseId)}` : '';
    startTimer(ex.restSec, `${title} · set ${idx} done${after}`);
  };
  const setReps = (setId: string, fn: (r: number) => number) => {
    mutateEx(e => { const x = e.sets.find(y => y.id === setId)!; x.reps = Math.max(0, fn(x.reps)); });
    const s = ex.sets.find(y => y.id === setId);
    if (setId === firstSetId && s?.completed) retarget(ex.id);
  };
  const increaseText = kind === 'assisted'
    ? 'You hit the top of your range last time, so drop the assistance today.'
    : kind === 'bodyweight'
      ? 'You hit the top of your range last time, so add weight with the belt today.'
      : 'You hit the top of your range last time, so increase the weight today.';

  const beats = working.map((s, i) => (s.completed ? beatBy(ex, s, last, i) : null));
  if (allDone && !opened && !ex.skipped) {
    const lastSame = last && !last.deload && loadVs(kind, ex.workingWeight, last.weight) === 0;
    const repGain = lastSame ? working.reduce((d, s, i) => d + s.reps - (last!.reps[i] ?? s.reps), 0) : 0;
    const summary = last && !last.deload && loadVs(kind, ex.workingWeight, last.weight) > 0 ? 'New weight' : repGain > 0 ? `+${repGain} rep${repGain > 1 ? 's' : ''}` : null;
    return (
      <button className={`card ex-done ${deload ? 'deload' : ''}`} onClick={() => setOpened(true)} aria-label={`${title} done. Open it`}>
        <span className="ex-check" aria-hidden>✓</span>
        <span className="ex-text">
          <b>{title}</b>
          <span className="num">{working.map(s => s.reps).join(' · ')} at {load(ex.workingWeight)}</span>
        </span>
        {summary && <span className="ex-beat num">{summary}<br /><span>vs last week</span></span>}
      </button>
    );
  }

  let n = 0;
  return (
    <div className={`card ex-card ${deload ? 'deload' : ''} ${ex.skipped ? 'muted' : ''}`} style={ex.skipped ? { opacity: 0.55 } : undefined}>
      <div className="ex-head">
        <div className="lb-title">
          <h2 className="ex-name">{title}</h2>
          {allDone && opened ? <button className="btn sm ghost" onClick={() => setOpened(false)}>Fold</button>
            : <span className="muted small num lb-range">{ex.repMin}–{ex.repMax} · {pickWeight ? 'pick a weight' : load(ex.workingWeight)}</span>}
        </div>
        {ex.machineNote && <p className="muted small">{ex.machineNote}</p>}
        {plates && <p className="small"><b>Load:</b> {plates}</p>}
        <div className="ex-meta">
          {ex.skipped && <span className="pill">Skipped</span>}
          <span className="pill num">Rest {fmtClock(ex.restSec)}</span>
          {myo && <span className="pill">Myo-rep match</span>}
          {partner && <span className="pill accent">Superset with {name(partner.exerciseId)}</span>}
          {ex.swappedFrom && <span className="pill warn">From {ex.swappedFrom}</span>}
          {!ex.countsForProgression && <span className="pill warn">One-off weight</span>}
        </div>
        {ex.station && (
          <div className="row mt" role="group" aria-label="Cable station">
            <span className="small muted">Cable:</span>
            {(['small', 'big'] as CableStation[]).map(st => (
              <button key={st} className={`chip ${ex.station === st ? 'on' : ''}`} onClick={() => {
                if (ex.sets.some(s => s.completed) && !confirm('Switch station? Logged sets on this exercise will be cleared.')) return;
                setStation(ex.id, st);
              }}>{st === 'small' ? 'Small' : 'Big'}</button>
            ))}
          </div>
        )}
      </div>

      {needsNewWeight ? (
        <div className="banner stack">
          <div>{ex.firstWeight ? ex.reason : increaseText}</div>
          {!ex.firstWeight && step ? <div className="small">Pre-filled {kind === 'assisted' ? '−' : '+'}{fmtW(step, units)} — change it if needed.</div> : null}
          <div className="row">
            <div className="grow" style={{ color: 'var(--text)' }}><WeightInput kg={incKg} onChange={setIncKg} placeholder={ex.firstWeight ? (kind === 'assisted' ? 'Assistance' : 'Starting weight') : undefined} /></div>
            <button className="btn" style={{ background: 'var(--bg)', color: 'var(--text)' }} disabled={incKg == null} onClick={() => incKg != null && setIncrease(ex.id, incKg)}>Set</button>
          </div>
          {!ex.firstWeight && (
            <button className="btn sm ghost" style={{ color: 'var(--accent-ink)', borderColor: 'var(--accent-ink)' }} onClick={() => setIncrease(ex.id, ex.workingWeight)}>
              Keep {load(ex.workingWeight)} for now
            </button>
          )}
        </div>
      ) : (
        <div className="reason">{ex.reason}</div>
      )}
      {ex.flagged && !deload && (
        <div className="banner flag small">Stuck below your range for 2+ sessions. Consider dropping the weight 5–10% — see the Coach tab.</div>
      )}

      {!ex.skipped && warmups.length > 0 && (warmDone && !warmOpen ? (
        <button className="wu-done" onClick={() => setWarmOpen(true)}>
          <span><b>✓ Warm-up done</b> <span className="muted num">{warmups.map(s => fmtLoadShort(s.weight, kind, units).main.replace(/kg$/, '')).join(' · ')}</span></span>
          <span className="muted small" style={{ textDecoration: 'underline' }}>Show</span>
        </button>
      ) : (
        <div className="wu-box">
          <div className="wu-top">
            <b>Warm-up</b>
            <span className="num">{warmups.filter(s => s.completed).length}/{warmups.length} · not counted{warmDone && <> · <button className="link-btn" onClick={() => setWarmOpen(false)}>Hide</button></>}</span>
          </div>
          {warmups.map((s, k) => (
            <div key={s.id} className="wu-row">
              <button className="wu-idx" aria-label="Warm-up set details" onClick={() => setSheet({ setId: s.id })}>W{k + 1}</button>
              <button className="wu-what num" onClick={() => setSheet({ setId: s.id })}>
                <b>{fmtLoadShort(s.weight, kind, units).main} × {s.targetReps}</b>
                {ex.source.loading && <span>{loadingText(s.weight, ex.source.loading, barKg)}</span>}
              </button>
              <button className={`check wu ${s.completed ? 'on' : ''}`} aria-label={s.completed ? 'Mark warm-up not done' : 'Mark warm-up done'} aria-pressed={s.completed} onClick={() => toggle(s.id)}>✓</button>
            </div>
          ))}
        </div>
      ))}

      {!ex.skipped && (
        <div>
          <div className="lb-row lb-thead" aria-hidden>
            <span>Set</span><span>Last</span><span>Target</span><span style={{ textAlign: 'center' }}>Reps</span><span />
          </div>
          {working.map((s, i) => {
            n++;
            const isMatch = myo && n > 1;
            const lr = last?.reps[i];
            const lastDiffW = last && loadVs(kind, s.weight, last.weight) !== 0;
            const tag = fmtLoadShort(s.weight, kind, units);
            return (
              <div key={s.id} className={`lb-row ${s.completed ? 'done' : ''}`}>
                <button className="lb-idx" aria-label="Set details" onClick={() => setSheet({ setId: s.id })}>
                  {n}
                  {s.rpe != null && <span className="tiny muted" style={{ display: 'block' }}>@{s.rpe}</span>}
                </button>
                <button className="lb-last num" onClick={() => setSheet({ setId: s.id })} aria-label="Set details">
                  {lr != null ? <>{lr}{lastDiffW && <small>{fmtLoadShort(last!.weight, kind, units).main}</small>}{last!.deload && <small>deload</small>}</> : '—'}
                </button>
                <button className="lb-target num" onClick={() => setSheet({ setId: s.id })} aria-label="Set details">
                  <b>{s.targetReps}</b>
                  {beats[i] ? <span className="beat">{beats[i]}</span>
                    : <span>{isMatch ? 'match' : (Math.abs(s.weight - ex.workingWeight) > 0.001 && !pickWeight) ? `${tag.main}${tag.tag ? ' ' + tag.tag : ''}` : 'reps'}</span>}
                </button>
                <div className="stepper">
                  <button aria-label="One less rep" onClick={() => setReps(s.id, r => r - 1)}>−</button>
                  <input className="num" inputMode="numeric" aria-label="Reps" value={s.reps}
                    onChange={ev => { const v = parseInt(ev.target.value, 10); setReps(s.id, () => (isNaN(v) ? 0 : v)); }} />
                  <button aria-label="One more rep" onClick={() => setReps(s.id, r => r + 1)}>+</button>
                </div>
                <button className={`check ${s.completed ? 'on' : ''}`} aria-label={s.completed ? 'Mark set not done' : 'Mark set done'} aria-pressed={s.completed} onClick={() => toggle(s.id)}>✓</button>
              </div>
            );
          })}
          {!myo && working.length > 1 && !working[0].completed && (
            <p className="tiny muted" style={{ padding: '6px 16px' }}>Later sets expect your usual drop-off ({ex.drops.slice(1).map(d => `−${d}`).join(', ')}). They re-aim when set 1 is logged.</p>
          )}
        </div>
      )}

      <div className="ex-foot">
        {!ex.skipped && <>
          <button className="btn sm" onClick={() => mutateEx(e => {
            const lastSet = [...e.sets].reverse().find(x => !x.warmup);
            const t = Math.max(1, (lastSet?.targetReps ?? e.targetReps) - 1);
            e.sets.push({ id: uid(), weight: lastSet?.weight ?? e.workingWeight, targetReps: t, reps: t, completed: false, warmup: false });
          })}>+ Set</button>
          <button className="btn sm" disabled={working.length <= 1} onClick={() => mutateEx(e => {
            const idx = e.sets.map(x => !x.warmup && !x.completed).lastIndexOf(true);
            if (idx >= 0) e.sets.splice(idx, 1);
          })}>− Set</button>
          <button className="btn sm" onClick={() => setSheet('weight')}>Weight</button>
          <button className="btn sm" onClick={() => setSheet('rest')}>Rest</button>
          <button className="btn sm" onClick={() => setSheet('swap')}>Swap</button>
          {working.some(s => !s.completed) && <button className="btn sm" onClick={() => doLater(ex.id)}>Later</button>}
        </>}
        <button className="btn sm ghost" onClick={() => mutateEx(e => { e.skipped = !e.skipped; })}>{ex.skipped ? 'Unskip' : 'Skip'}</button>
      </div>

      <WeightSheet open={sheet === 'weight'} ex={ex} onClose={() => setSheet(null)} />
      <RestSheet open={sheet === 'rest'} ex={ex} onClose={() => setSheet(null)} onSave={sec => mutateEx(e => { e.restSec = sec; })} />
      <SwapSheet open={sheet === 'swap'} ex={ex} title={title} onClose={() => setSheet(null)} />
      {typeof sheet === 'object' && sheet && <SetSheet ex={ex} setId={sheet.setId} onClose={() => setSheet(null)} />}
    </div>
  );
}

/** Fit the rest of the session into the time you have, protecting the big lifts. */
function ShortOnTimeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const [minutes, setMinutes] = useState(45);
  if (!open || !s.active) return null;
  const plan = s.previewTimeCut(minutes);
  return (
    <Sheet open onClose={onClose} title="Short on time?">
      <div className="stack">
        <p className="small muted">How long have you got left? Big compound lifts stay as they are; isolation work gets paired, shortened or dropped.</p>
        <div className="chips">
          {[30, 45, 60, 75].map(m => <button key={m} className={`chip ${minutes === m ? 'on' : ''}`} onClick={() => setMinutes(m)}>{m} min</button>)}
        </div>
        {plan && (plan.changes.length ? (
          <div className="card tight stack" style={{ gap: 4 }}>
            <b className="small">~{plan.beforeMin} min → ~{plan.afterMin} min</b>
            <ul className="clean small">{plan.changes.map(c => <li key={c}>{c}</li>)}</ul>
            {!plan.fits && <p className="small" style={{ color: 'var(--warn)' }}>Even trimmed it runs over — consider moving this session to another day from Home.</p>}
          </div>
        ) : <p className="small">You've got time — about {plan.beforeMin} minutes left as planned.</p>)}
        <button className="btn primary block" disabled={!plan?.changes.length} onClick={() => { s.applyTimeCut(minutes); onClose(); }}>Apply</button>
        <p className="tiny muted">Supersets: do a set of the first, go straight to the second, then rest. Dropped sets don't count against your progression.</p>
      </div>
    </Sheet>
  );
}

/** Machine taken? Trade with an exercise from later this week (it moves to that day), or pick any replacement. */
function SwapSheet({ open, ex, title, onClose }: { open: boolean; ex: ActiveExercise; title: string; onClose: () => void }) {
  const s = useStore();
  const [picking, setPicking] = useState(false);
  if (!open) return null;
  if (picking) return <ExercisePicker open onClose={() => { setPicking(false); onClose(); }} onPick={id => { s.swapExercise(ex.id, id); setPicking(false); onClose(); }} />;
  const options = s.swapOptions();
  const days = [...new Set(options.map(o => o.label))];
  return (
    <Sheet open onClose={onClose} title={`Swap ${title}`}>
      <div className="stack">
        {options.length ? (
          <>
            <p className="small muted">Do one of these instead. <b>{title}</b> moves into that day's workout this week, and everything goes back to normal next week.</p>
            {days.map(day => (
              <div key={day}>
                <h3 className="section-title">{day}</h3>
                {options.filter(o => o.label === day).map(o => (
                  <button key={o.te.id} className="list-item" onClick={() => { s.swapAcrossWeek(ex.id, o); onClose(); }}>
                    <span className="grow">{s.exerciseName(o.te.exerciseId)}</span>
                    <span className="small muted">{o.te.sets} × {o.te.repMin}–{o.te.repMax}</span>
                  </button>
                ))}
              </div>
            ))}
          </>
        ) : <p className="small muted">No workouts left this week to swap with.</p>}
        <button className="btn block" onClick={() => setPicking(true)}>Replace with a different exercise (today only)</button>
      </div>
    </Sheet>
  );
}

function WeightSheet({ open, ex, onClose }: { open: boolean; ex: ActiveExercise; onClose: () => void }) {
  const units = useStore(s => s.settings.units);
  const apply = useStore(s => s.applyWeight);
  const [kg, setKg] = useState<number | undefined>(ex.workingWeight);
  useEffect(() => { if (open) setKg(ex.workingWeight); }, [open, ex.workingWeight]);
  const changed = kg != null && Math.abs(kg - ex.baseWeight) > 0.001;
  return (
    <Sheet open={open} onClose={onClose} title="Change weight">
      <div className="stack">
        <WeightInput kg={kg} onChange={setKg} autoFocus />
        <p className="muted small">Planned: {fmtW(ex.baseWeight, units)}. Changing machine or the rack was taken? Choose whether this becomes your new working weight.</p>
        {changed ? (
          <>
            <button className="btn primary block" onClick={() => { apply(ex.id, kg!, 'working'); onClose(); }}>Use {fmtW(kg!, units)} as my new working weight</button>
            <button className="btn block" onClick={() => { apply(ex.id, kg!, 'today'); onClose(); }}>Just today (don't count for progression)</button>
          </>
        ) : (
          <button className="btn primary block" disabled={kg == null} onClick={() => { apply(ex.id, kg!, 'working'); onClose(); }}>Save</button>
        )}
      </div>
    </Sheet>
  );
}

function RestSheet({ open, ex, onClose, onSave }: { open: boolean; ex: ActiveExercise; onClose: () => void; onSave: (sec: number) => void }) {
  const [sec, setSec] = useState<number | undefined>(ex.restSec);
  useEffect(() => { if (open) setSec(ex.restSec); }, [open, ex.restSec]);
  return (
    <Sheet open={open} onClose={onClose} title="Rest time">
      <div className="stack">
        <div className="chips">
          {[60, 90, 120, 150, 180, 240].map(v => <button key={v} className={`chip ${sec === v ? 'on' : ''}`} onClick={() => setSec(v)}>{fmtClock(v)}</button>)}
        </div>
        <NumberField value={sec} suffix="sec" onChange={setSec} />
        <button className="btn primary block" onClick={() => { onSave(sec ?? 90); onClose(); }}>Save for this workout</button>
      </div>
    </Sheet>
  );
}

function SetSheet({ ex, setId, onClose }: { ex: ActiveExercise; setId: string; onClose: () => void }) {
  const update = useStore(s => s.updateActive);
  const set = ex.sets.find(s => s.id === setId);
  if (!set) return null;
  const mutate = (fn: (s: LoggedSet) => void) => update(a => {
    const s = a.session.exercises.find(x => x.id === ex.id)?.sets.find(x => x.id === setId);
    if (s) fn(s);
  });
  return (
    <Sheet open onClose={onClose} title={set.warmup ? 'Warm-up set' : 'Set details'}>
      <div className="stack">
        <div className="field"><label>Weight for this set only</label><WeightInput kg={set.weight} onChange={kg => kg != null && mutate(s => { s.weight = kg; })} /></div>
        <div className="field">
          <label>RPE (how hard, 1–10)</label>
          <div className="chips">
            {[6, 7, 7.5, 8, 8.5, 9, 9.5, 10].map(v => (
              <button key={v} className={`chip ${set.rpe === v ? 'on' : ''}`} onClick={() => mutate(s => { s.rpe = s.rpe === v ? undefined : v; })}>{v}</button>
            ))}
          </div>
        </div>
        <div className="field"><label>Note</label><input className="input" value={set.note ?? ''} placeholder="e.g. left shoulder twinge" onChange={e => mutate(s => { s.note = e.target.value || undefined; })} /></div>
        <label className="row"><input type="checkbox" checked={set.warmup} onChange={e => mutate(s => { s.warmup = e.target.checked; })} style={{ width: 22, height: 22 }} /> Warm-up set (ignored by progression)</label>
        <div className="row">
          <button className="btn danger grow" onClick={() => { update(a => { const e = a.session.exercises.find(x => x.id === ex.id)!; e.sets = e.sets.filter(x => x.id !== setId); }); onClose(); }}>Delete set</button>
          <button className="btn primary grow" onClick={onClose}>Done</button>
        </div>
      </div>
    </Sheet>
  );
}

function FinishSheet({ open, onClose, remainingSets, onDone }: { open: boolean; onClose: () => void; remainingSets: number; onDone: (sessionId: string | null) => void }) {
  const finish = useStore(s => s.finishWorkout);
  const discard = useStore(s => s.discardWorkout);
  const deload = useStore(s => s.active?.session.deload);
  const [saveToTemplate, setSave] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={remainingSets ? 'Leave this workout?' : 'Finish workout?'}>
      <div className="stack">
        {remainingSets > 0 && <p className="muted">{remainingSets} working sets aren't ticked off. Exercises you didn't do won't change your progression.</p>}
        {!deload && (
          <label className="row small">
            <input type="checkbox" checked={saveToTemplate} onChange={e => setSave(e.target.checked)} style={{ width: 22, height: 22 }} />
            Save today's changes (exercises, sets, rest, order) to the template
          </label>
        )}
        <button className="btn primary block big" onClick={() => { const s = finish({ saveToTemplate }); onDone(s?.id ?? null); }}>
          {remainingSets ? 'Save as partial' : 'Finish & save'}
        </button>
        <button className="btn block" onClick={onClose}>Keep going</button>
        <button className="btn danger ghost block" onClick={() => { if (confirm('Discard this workout? Nothing will be saved.')) { discard(); onDone(null); } }}>Discard workout</button>
      </div>
    </Sheet>
  );
}

function RestTimerBar() {
  const timer = useStore(s => s.timer)!;
  const sound = useStore(s => s.settings.timerSound);
  const adjust = useStore(s => s.adjustTimer);
  const toggle = useStore(s => s.togglePauseTimer);
  const clear = useStore(s => s.clearTimer);
  const [, force] = useState(0);
  const alerted = useRef<number | null>(null);

  const leftMs = timer.pausedLeft ?? Math.max(0, (timer.endAt ?? Date.now()) - Date.now());
  const done = timer.pausedLeft == null && leftMs <= 0;

  useEffect(() => {
    const t = setInterval(() => force(x => x + 1), 250);
    return () => clearInterval(t);
  }, []);

  // Fire the end-of-rest alert once per timer, even if the tab was in the background.
  useEffect(() => {
    if (timer.endAt == null) return;
    const fire = () => {
      if (alerted.current === timer.endAt) return;
      alerted.current = timer.endAt;
      vibrate();
      if (sound) beep();
      if (document.visibilityState !== 'visible') void notify('Rest over — next set', timer.label, 'rest-timer');
    };
    const ms = timer.endAt - Date.now();
    if (ms <= 0) { fire(); return; }
    const t = setTimeout(fire, ms);
    return () => clearTimeout(t);
  }, [timer.endAt, timer.label, sound]);

  // Auto-hide a finished timer after a while.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(clear, 20_000);
    return () => clearTimeout(t);
  }, [done, clear]);

  const pct = timer.total ? Math.min(100, 100 - (leftMs / 1000 / timer.total) * 100) : 100;
  return (
    <div className="timer-bar" role="timer" aria-live="polite">
      <div className="timer-inner">
        <div className="row between">
          <div>
            <div className="small muted">{done ? 'Rest over — go!' : timer.pausedLeft != null ? 'Paused' : 'Resting'} · {timer.label}</div>
            <div className={`timer-clock ${done ? 'done' : ''}`}>{fmtClock(leftMs / 1000)}</div>
          </div>
          <button className="btn sm" onClick={clear}>{done ? 'Close' : 'Skip'}</button>
        </div>
        <div className="progress"><div style={{ width: `${pct}%` }} /></div>
        {!done && (
          <div className="row">
            <button className="btn grow" onClick={() => adjust(-15)}>−15s</button>
            <button className="btn grow" onClick={toggle}>{timer.pausedLeft != null ? 'Resume' : 'Pause'}</button>
            <button className="btn grow" onClick={() => adjust(15)}>+15s</button>
          </div>
        )}
      </div>
    </div>
  );
}
