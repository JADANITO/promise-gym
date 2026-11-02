import { useState } from 'react';
import { useStore } from '../data/store';
import { buildWeekStats, rulesReport } from '../engine/coach';
import { addDays, fmtDate, ymd } from '../engine/dates';
import { uid } from '../format';
import type { CoachReport } from '../types';

/** Build this week's report: Claude when a key is set and we're online, otherwise the rules coach. */
export async function generateReport(): Promise<{ report: CoachReport; warning?: string }> {
  const s = useStore.getState();
  const today = ymd();
  const stats = buildWeekStats({ sessions: s.sessions, templates: s.templates, checkIns: s.checkIns, goals: s.goals, settings: s.settings, phase: s.currentPhase(), name: s.exerciseName }, today);
  const statsSummary = {
    workouts: `${stats.workoutsDone}/${stats.workoutsPlanned}`,
    progressed: stats.exercises.filter(e => e.outcome === 'progressed' || e.outcome === 'weight-up').length,
    exercises: stats.exercises.filter(e => e.outcome !== 'not trained').length,
    avgCalories: stats.calories.average ?? '—',
    weightChange: stats.bodyweight.changeThisWeek ?? '—',
  };
  let warning: string | undefined;
  let advice = null;
  let source: CoachReport['source'] = 'rules';
  if (s.settings.anthropicKey && navigator.onLine) {
    try {
      const { aiReport } = await import('../engine/aiCoach');
      advice = await aiReport(stats, s.settings.anthropicKey);
      source = 'ai';
    } catch (e) {
      warning = `AI coach unavailable (${(e as Error).message}) — used the built-in coach instead.`;
    }
  }
  advice ??= rulesReport(stats);
  const report: CoachReport = { id: uid(), weekStart: stats.weekStart, createdAt: Date.now(), source, stats: statsSummary, ...advice };
  s.addReport(report);
  return { report, warning };
}

export function CoachScreen() {
  const reports = useStore(s => s.reports);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string>();
  const [openId, setOpenId] = useState<string | null>(null);
  const latest = reports[0];

  const run = async () => {
    setBusy(true);
    setWarning(undefined);
    try { setWarning((await generateReport()).warning); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="row between">
        <h1 className="page-title">Coach</h1>
        <button className="btn primary sm" disabled={busy} onClick={run}>{busy ? 'Thinking…' : 'Review my week'}</button>
      </div>
      {warning && <p className="small" style={{ color: 'var(--warn)' }}>{warning}</p>}
      {!latest && !busy && (
        <div className="card stack">
          <p className="bold">Your weekly review lands here</p>
          <p className="muted small">Every week I'll look at your lifts, bodyweight and calories and tell you what to change for the week ahead. Tap “Review my week” any time.</p>
        </div>
      )}
      {latest && <ReportCard r={latest} />}
      {reports.length > 1 && <h2 className="section-title">Past reports</h2>}
      {reports.slice(1).map(r => (
        <div key={r.id}>
          <button className="list-item" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
            <span className="grow"><b>Week of {fmtDate(r.weekStart)}</b><br /><span className="small muted">{r.summary}</span></span>
            <span className="muted">{openId === r.id ? '▾' : '›'}</span>
          </button>
          {openId === r.id && <ReportCard r={r} />}
        </div>
      ))}
    </div>
  );
}

function ReportCard({ r }: { r: CoachReport }) {
  return (
    <div className="card stack">
      <div className="row between">
        <span className="small muted bold">{fmtDate(r.weekStart)} – {fmtDate(addDays(r.weekStart, 6))}</span>
        <span className="pill">{r.source === 'ai' ? 'AI coach' : 'Built-in coach'}</span>
      </div>
      <p className="bold" style={{ fontSize: 19 }}>{r.summary}</p>
      <div>
        <h3 className="section-title">Wins</h3>
        <ul className="clean">{r.wins.map((w, i) => <li key={i}>{w}</li>)}</ul>
      </div>
      <div>
        <h3 className="section-title">Change this week</h3>
        <ul className="clean">{r.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
      </div>
      <div className="card tight accent"><b>Focus:</b> {r.focus}</div>
    </div>
  );
}
