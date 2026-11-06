import { useEffect, useMemo, useRef, useState } from 'react';
import { trackHistory, useStore, type ActiveExercise } from '../data/store';
import type { CableStation, LoggedSet } from '../types';
import { ExercisePicker, NumberField, Sheet, WeightInput } from '../components/ui';
import { fmtClock, fmtDuration, fmtLoad, fmtW, uid } from '../format';
import { beep, notify, unlockAudio, vibrate } from '../alerts';

export function ActiveWorkout({ go }: { go: (r: string) => void }) {
  const active = useStore(s => s.active);
  const timer = useStore(s => s.timer);
  const keepAwake = useStore(s => s.settings.keepAwake);
  const addExercise = useStore(s => s.addExerciseToActive);
  const [picking, setPicking] = useState(false);
  const [addWeightFor, setAddWeightFor] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [now, setNow] = useState(Date.now());

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
            <span>{fmtDuration(now - session.startedAt)} · {remainingSets} sets left</span>
          </div>
        </div>
        <button className="btn primary sm" onClick={() => setFinishing(true)}>Finish</button>
      </div>

      {session.exercises.map(e => <ExerciseCard key={e.id} ex={e} deload={session.deload} />)}

      <button className="btn block" onClick={() => setPicking(true)}>+ Add exercise</button>

      <ExercisePicker open={picking} onClose={() => setPicking(false)} onPick={id => { setPicking(false); setAddWeightFor(id); }} />
      <AddWeightSheet exerciseId={addWeightFor} onClose={() => setAddWeightFor(null)} onAdd={(id, kg) => { addExercise(id, kg); setAddWeightFor(null); }} />
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

function useLastTime(ex: ActiveExercise) {
  const sessions = useStore(s => s.sessions);
  return useMemo(() => {
    const track = trackHistory(sessions, ex.source, ex.station);
    const last = track.sessions[track.sessions.length - 1];
    const le = last?.exercises[last.exercises.length - 1];
    const ws = le?.sets.filter(x => !x.warmup && x.completed) ?? [];
    return le && ws.length ? { weight: le.workingWeight, reps: ws.map(x => x.reps), deload: last.deload, before: !track.real } : null;
  }, [sessions, ex.source, ex.station]);
}

function ExerciseCard({ ex, deload }: { ex: ActiveExercise; deload: boolean }) {
  const units = useStore(s => s.settings.units);
  const name = useStore(s => s.exerciseName);
  const update = useStore(s => s.updateActive);
  const completeSet = useStore(s => s.completeSet);
  const retarget = useStore(s => s.retarget);
  const setStation = useStore(s => s.setStation);
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

  const mutateEx = (fn: (e: ActiveExercise) => void) => update(a => {
    const e = a.session.exercises.find(x => x.id === ex.id);
    if (e) fn(e);
  });

  const toggle = (setId: string) => {
    unlockAudio();
    const set = ex.sets.find(s => s.id === setId)!;
    if (completeSet(ex.id, setId)) {
      const idx = working.findIndex(s => s.id === setId) + 1;
      const next = working[idx];
      const after = next ? ` · next: ${myo ? 'match' : 'aim for'} ${useStore.getState().active?.session.exercises.find(e => e.id === ex.id)?.sets.find(s => s.id === next.id)?.targetReps ?? next.targetReps}` : '';
      startTimer(ex.restSec, set.warmup ? `${title} · warm-up` : `${title} · set ${idx} done${after}`);
    }
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

  let n = 0;
  return (
    <div className={`card ex-card ${deload ? 'deload' : ''} ${ex.skipped ? 'muted' : ''}`} style={ex.skipped ? { opacity: 0.55 } : undefined}>
      <div className="ex-head">
        <div className="row between">
          <h2 className="ex-name grow">{title}</h2>
          {ex.skipped && <span className="pill">Skipped</span>}
        </div>
        {ex.machineNote && <p className="muted small">{ex.machineNote}</p>}
        <div className="ex-meta">
          <span className="pill accent num">{pickWeight ? 'Pick a weight' : load(ex.workingWeight)}</span>
          <span className="pill num">Set 1: {ex.targetReps} reps · Range {ex.repMin}–{ex.repMax}</span>
          <span className="pill num">Rest {fmtClock(ex.restSec)}</span>
          {myo && <span className="pill">Myo-rep match</span>}
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
        {last && (
          <p className="muted small mt num">
            {last.before ? 'Before the app' : 'Last'}: {load(last.weight)} × {last.reps.join(', ')}{last.deload ? ' (deload)' : ''}
          </p>
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

      {!ex.skipped && (
        <div>
          {ex.sets.map(s => {
            if (!s.warmup) n++;
            const isMatch = myo && !s.warmup && n > 1;
            return (
              <div key={s.id} className={`set-row ${s.completed ? 'done' : ''} ${s.warmup ? 'warmup' : ''}`}>
                <button className="set-idx" style={{ background: 'none', border: 0, padding: 0 }} aria-label="Set details" onClick={() => setSheet({ setId: s.id })}>
                  {s.warmup ? 'W' : n}
                  {s.rpe != null && <div className="tiny muted">@{s.rpe}</div>}
                </button>
                <button className="set-w num" onClick={() => setSheet({ setId: s.id })}>
                  <b>{pickWeight && !s.warmup ? '—' : load(s.weight)}</b><br />{isMatch ? 'match' : 'target'} {s.targetReps}
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
