import { useEffect, useState } from 'react';
import { trackHistory, useStore } from '../data/store';
import { computeProgress, e1rm, planExercise } from '../engine/progression';
import { daysBetween, fmtDate, ymd } from '../engine/dates';
import { returningFromBreak } from '../engine/phases';
import { fmtDuration, fmtLoad, fmtW } from '../format';
import type { TemplateExercise, WorkoutSession } from '../types';
import { REBUILD_WEEK, rebuildHash } from '../engine/rebuildLink';

/** Decides whether to ask about repeating targets after a break, then starts the workout. */
export function StartWorkout({ templateId, go }: { templateId: string; go: (r: string) => void }) {
  const sessions = useStore(s => s.sessions);
  const start = useStore(s => s.startWorkout);
  const active = useStore(s => s.active);
  const t = useStore(s => s.templates.find(x => x.id === templateId));
  const today = ymd();
  const onBreak = returningFromBreak(sessions, today);

  useEffect(() => {
    if (active) { go('workout'); return; }
    if (!onBreak && t) { start(t.id, false); go('workout'); }
  }, [active, onBreak, t, start, go]);

  if (!t) return <p className="muted">Workout not found.</p>;
  if (!onBreak || active) return null;
  const lastDay = ymd(Math.max(...sessions.map(s => s.startedAt)));
  return (
    <div className="stack">
      <h1 className="page-title">Welcome back</h1>
      <div className="card stack">
        <p>It's been <b>{daysBetween(lastDay, today)} days</b> since your last workout. Coming back after a break, it's smart to repeat last session's targets instead of pushing for more.</p>
        <button className="btn primary big block" onClick={() => { start(t.id, true); go('workout'); }}>Repeat last targets</button>
        <button className="btn block" onClick={() => { start(t.id, false); go('workout'); }}>Progress as normal</button>
      </div>
    </div>
  );
}

export function Summary({ id, go }: { id: string; go: (r: string) => void }) {
  const sessions = useStore(s => s.sessions);
  const templates = useStore(s => s.templates);
  const settings = useStore(s => s.settings);
  const name = useStore(s => s.exerciseName);
  const events = useStore(s => s.lifeEvents);
  const session = sessions.find(s => s.id === id);
  if (!session) return <p className="muted">Session not found.</p>;
  const u = settings.units;

  const volume = session.exercises.flatMap(e => e.sets.filter(s => s.completed && !s.warmup)).reduce((v, s) => v + s.weight * s.reps, 0);
  const before = sessions.filter(s => s.startedAt < session.startedAt);
  const prs = session.exercises.filter(e => !e.skipped).flatMap(e => {
    const best = Math.max(0, ...e.sets.filter(s => s.completed && !s.warmup).map(s => e1rm(s.weight, s.reps)));
    const prev = Math.max(0, ...before.flatMap(b => b.exercises.filter(x => x.exerciseId === e.exerciseId)).flatMap(x => x.sets.filter(s => s.completed && !s.warmup).map(s => e1rm(s.weight, s.reps))));
    return best > prev && prev > 0 ? [`${name(e.exerciseId)} — est. 1RM ${fmtW(best, u)}`] : [];
  });

  const template = templates.find(t => t.id === session.templateId);
  const next = session.exercises.filter(e => !e.skipped).map(e => {
    const te: TemplateExercise = template?.exercises.find(x => x.exerciseId === e.exerciseId)
      ?? { id: e.id, exerciseId: e.exerciseId, sets: e.sets.length, repMin: e.repMin, repMax: e.repMax, restSec: e.restSec, startWeight: e.workingWeight, cable: !!e.station };
    const track = trackHistory(sessions, te, e.station);
    const kind = e.kind ?? 'weighted';
    const state = computeProgress(e.exerciseId, track.sessions.map(x => ({ ...x, exercises: x.exercises.map(le => ({ ...le, kind })) })), settings.basis, te.startWeight, te.repMin);
    const plan = planExercise(state, te, { kind });
    return { name: name(e.exerciseId), plan, kind };
  });

  return (
    <div className="stack">
      <h1 className="page-title">{session.deload ? 'Deload done' : 'Workout saved'} 💪</h1>
      <div className="stats">
        <div className="stat"><div className="v">{fmtDuration((session.endedAt ?? Date.now()) - session.startedAt)}</div><div className="l">Duration</div></div>
        <div className="stat"><div className="v">{Math.round(u === 'lb' ? volume * 2.20462 : volume).toLocaleString()}</div><div className="l">Volume ({u})</div></div>
        <div className="stat"><div className="v">{prs.length}</div><div className="l">PRs</div></div>
      </div>
      {prs.length > 0 && (
        <div className="card accent"><h3 className="bold">New PRs</h3><ul className="clean">{prs.map(p => <li key={p}>{p}</li>)}</ul></div>
      )}
      <h2 className="section-title">Next session</h2>
      <div className="card">
        {session.deload && <p className="muted small" style={{ marginBottom: 8 }}>Deload sessions don't change progression — these are your targets for the next gaining session.</p>}
        {next.map(n => (
          <div key={n.name} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <span className="bold">{n.name}</span>
            <span className="num">{n.plan.increaseDue
              ? <span className="pill accent">{n.kind === 'assisted' ? 'Less assistance' : n.kind === 'bodyweight' ? 'Add weight' : 'Increase the weight'}</span>
              : `${fmtLoad(n.plan.weight, n.kind, u)} × ${n.plan.target}`}</span>
          </div>
        ))}
      </div>
      {/* Rebuild Week ticks that day's gym and takes the latest plan from this link. */}
      <a className="btn primary block big" href={REBUILD_WEEK + rebuildHash(settings, templates, events, ymd(), ymd(session.startedAt))} target="_blank" rel="noopener"
        style={{ textDecoration: 'none' }} onClick={() => go('home')}>✓ Tick gym in Rebuild Week</a>
      <button className="btn block" onClick={() => go('home')}>Done</button>
    </div>
  );
}

/** View or correct a past session. Progression recalculates automatically from history. */
export function SessionDetail({ id, go }: { id: string; go: (r: string) => void }) {
  const original = useStore(s => s.sessions.find(x => x.id === id));
  const update = useStore(s => s.updateSession);
  const del = useStore(s => s.deleteSession);
  const name = useStore(s => s.exerciseName);
  const units = useStore(s => s.settings.units);
  const [draft, setDraft] = useState<WorkoutSession | undefined>(() => original && structuredClone(original));
  if (!draft || !original) return <p className="muted">Session not found.</p>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);

  return (
    <div className="stack">
      <div className="row between">
        <button className="btn ghost sm" onClick={() => go('workouts')}>‹ Back</button>
        <button className="btn primary sm" disabled={!dirty} onClick={() => { update(draft); go('workouts'); }}>Save changes</button>
      </div>
      <h1 className="page-title">{draft.templateName} {draft.deload && <span className="pill deload">DELOAD</span>}</h1>
      <p className="muted small">{fmtDate(ymd(draft.startedAt), { weekday: 'long', day: 'numeric', month: 'long' })}. Fix any typos below — your targets recalculate from history.</p>
      {draft.exercises.map((e, ei) => (
        <div key={e.id} className="card stack">
          <div className="row between">
            <h3 className="bold">{name(e.exerciseId)}</h3>
            <span className="pill num">{fmtW(e.workingWeight, units)} · {e.repMin}–{e.repMax}</span>
          </div>
          {e.skipped ? <p className="muted small">Skipped</p> : e.sets.map((s, si) => (
            <div key={s.id} className="row">
              <span className="muted bold" style={{ width: 24 }}>{s.warmup ? 'W' : si + 1 - e.sets.filter((x, j) => x.warmup && j < si).length}</span>
              <span className="grow num small">{fmtW(s.weight, units)}</span>
              <input className="input num" style={{ width: 80 }} inputMode="numeric" value={s.reps} aria-label="Reps"
                onChange={ev => { const v = parseInt(ev.target.value, 10); setDraft(d => { const c = structuredClone(d)!; c.exercises[ei].sets[si].reps = isNaN(v) ? 0 : v; return c; }); }} />
              <label className="row small"><input type="checkbox" checked={s.completed} style={{ width: 20, height: 20 }}
                onChange={ev => setDraft(d => { const c = structuredClone(d)!; c.exercises[ei].sets[si].completed = ev.target.checked; return c; })} />done</label>
            </div>
          ))}
        </div>
      ))}
      <button className="btn danger ghost block" onClick={() => { if (confirm('Delete this session from your history?')) { del(id); go('workouts'); } }}>Delete session</button>
    </div>
  );
}
