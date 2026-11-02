import { useState } from 'react';
import { useStore } from '../data/store';
import { buildWeekStats, rulesReport } from '../engine/coach';
import { addDays, fmtDate, ymd } from '../engine/dates';
import { PHASE_LABEL, planSnapshot } from '../data/plan';
import { PHASE_COLOR, Roadmap } from '../components/plan';
import { fmtBw, fmtRateW, uid } from '../format';
import type { CoachReport } from '../types';

/** Build this week's report: Claude when a key is set and we're online, otherwise the rules coach. */
export async function generateReport(): Promise<{ report: CoachReport; warning?: string }> {
  const s = useStore.getState();
  const today = ymd();
  const stats = buildWeekStats({
    sessions: s.sessions, templates: s.templates, checkIns: s.checkIns, profile: s.profile, measurements: s.measurements,
    weeklyTargets: s.weeklyTargets, weeklyCheckIns: s.weeklyCheckIns, settings: s.settings, trainingBlock: s.currentPhase(),
    nutritionPhase: s.currentNutritionPhase(), exercises: s.exercises(), name: s.exerciseName,
  }, today);
  const statsSummary = {
    workouts: `${stats.workoutsDone}/${stats.workoutsPlanned}`,
    progressed: stats.exercises.filter(e => e.outcome === 'progressed' || e.outcome === 'weight-up').length,
    exercises: stats.exercises.filter(e => e.outcome !== 'not trained').length,
    avgCalories: stats.calories.average ?? '—',
    avgProtein: stats.protein.average ?? '—',
    weightRate: stats.nutritionPhase?.actualRateKgPerWeek ?? '—',
    promises: `${stats.promisesKept.kept}/${stats.promisesKept.total}`,
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

export function CoachScreen({ go }: { go: (r: string) => void }) {
  const s = useStore();
  const reports = s.reports;
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string>();
  const [openId, setOpenId] = useState<string | null>(null);
  const [showRoadmap, setShowRoadmap] = useState(false);
  const latest = reports[0];
  const plan = planSnapshot(s);
  const u = s.settings.units;
  const goal = plan.roadmap[plan.roadmap.length - 1];
  const currentStep = plan.roadmap[0];

  const run = async () => {
    setBusy(true);
    setWarning(undefined);
    try { setWarning((await generateReport()).warning); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <h1 className="page-title">Coach</h1>

      {plan.phase ? (
        <div className="card stack" style={{ borderColor: PHASE_COLOR[plan.phase.type] }}>
          <div className="row between">
            <p className="small muted bold">MY PLAN</p>
            {goal?.type === 'goal' && <span className="pill accent">Goal ~{new Date(goal.startDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>}
          </div>
          <h2 className="bold" style={{ fontSize: 22 }}>
            {PHASE_LABEL[plan.phase.type]} · week {plan.weeksIn + 1}{currentStep && currentStep.type === plan.phase.type ? ` of ~${plan.weeksIn + currentStep.weeks}` : ''}
          </h2>
          <p className="small muted">{plan.phase.reason}</p>
          <div className="stats">
            <div className="stat"><div className="v">{plan.target ? plan.target.kcal.toLocaleString() : '—'}</div><div className="l">kcal / day</div></div>
            <div className="stat"><div className="v">{plan.target ? `${plan.target.protein}g` : '—'}</div><div className="l">protein / day</div></div>
            <div className="stat"><div className="v" style={{ fontSize: 16 }}>{fmtRateW(plan.phase.targetRate, u)}</div><div className="l">target rate</div></div>
          </div>
          {plan.target && <p className="tiny muted">{plan.target.note}</p>}
          {plan.status && <p className="small">{plan.status.advice}</p>}
          {plan.comp && (
            <p className="small">
              Now ~{fmtBw(plan.comp.weight, u)} at ~{plan.comp.bodyFat.toFixed(1)}% · lean mass ~{fmtBw(plan.comp.lean, u)}
              {s.profile.goalWeight ? ` · goal ${fmtBw(s.profile.goalWeight, u)} at ${s.profile.goalBodyFat}%` : ''}
            </p>
          )}
          <div className="row">
            <button className="btn sm grow" onClick={() => setShowRoadmap(v => !v)}>{showRoadmap ? 'Hide roadmap' : 'Show roadmap'}</button>
            <button className="btn sm grow" onClick={() => go('checkin')}>Weekly check-in</button>
          </div>
          {showRoadmap && <Roadmap steps={plan.roadmap} />}
        </div>
      ) : (
        <div className="card accent stack">
          <p className="bold">No plan yet</p>
          <p className="small muted">Tell me where you are and where you want to be, and I'll plan your bulks, cuts, goal date and weekly targets.</p>
          <button className="btn primary" onClick={() => go('setup')}>Set up my plan</button>
        </div>
      )}

      <div className="row between">
        <h2 className="section-title">Weekly reports</h2>
        <button className="btn primary sm" disabled={busy} onClick={run}>{busy ? 'Thinking…' : 'Review my week'}</button>
      </div>
      {warning && <p className="small" style={{ color: 'var(--warn)' }}>{warning}</p>}
      {!latest && !busy && (
        <div className="card stack">
          <p className="bold">Your weekly review lands here</p>
          <p className="muted small">Every Sunday check-in I'll look at your lifts, volume, bodyweight, protein, sleep and calories and tell you what to change for the week ahead.</p>
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
