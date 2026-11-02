import { useRef, useState } from 'react';
import { useStore } from '../data/store';
import { NumberField, WeightInput } from '../components/ui';
import { download, notificationsSupported, reminderIcs, requestNotifications } from '../alerts';
import { ymd } from '../engine/dates';
import type { GoalDirection, ProgressionBasis, Units } from '../types';
import { PlateauSheet } from './Home';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function SettingsScreen({ go }: { go: (r: string) => void }) {
  const s = useStore();
  const st = s.settings;
  const set = s.setSettings;
  const [quote, setQuote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [deloadOpen, setDeloadOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const phase = s.currentPhase();

  const exportCsv = () => {
    const rows = [['date', 'workout', 'deload', 'exercise', 'set', 'warmup', 'weight_kg', 'target_reps', 'reps', 'completed', 'rpe', 'note']];
    for (const ses of [...s.sessions].sort((a, b) => a.startedAt - b.startedAt)) {
      for (const e of ses.exercises) {
        e.sets.forEach((x, i) => rows.push([ymd(ses.startedAt), ses.templateName, String(ses.deload), s.exerciseName(e.exerciseId), String(i + 1), String(x.warmup), String(x.weight), String(x.targetReps), String(x.reps), String(x.completed), x.rpe != null ? String(x.rpe) : '', x.note ?? '']));
      }
    }
    const csv = (r: string[][]) => r.map(l => l.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    download(`promise-workouts-${ymd()}.csv`, csv(rows), 'text/csv');
    const daily = [['date', 'bodyweight_kg', 'calories', 'notes'], ...Object.values(s.checkIns).sort((a, b) => a.date.localeCompare(b.date)).map(c => [c.date, c.bodyweight != null ? String(c.bodyweight) : '', c.calories != null ? String(c.calories) : '', c.notes ?? ''])];
    download(`promise-daily-${ymd()}.csv`, csv(daily), 'text/csv');
  };

  return (
    <div className="stack">
      <h1 className="page-title">Settings</h1>

      <h2 className="section-title">Goal</h2>
      <div className="card stack">
        <div className="field">
          <label>Direction</label>
          <div className="tabs">
            {(['lose', 'maintain', 'gain'] as GoalDirection[]).map(d => (
              <button key={d} className={s.goals.direction === d ? 'on' : ''} onClick={() => s.setGoals({ direction: d })}>{d === 'lose' ? 'Cut' : d === 'gain' ? 'Bulk' : 'Maintain'}</button>
            ))}
          </div>
        </div>
        {s.goals.direction !== 'maintain' && <>
          <div className="field"><label>Goal weight</label><WeightInput kg={s.goals.goalWeight} onChange={kg => s.setGoals({ goalWeight: kg })} /></div>
          <div className="field"><label>Goal date</label><input type="date" className="input" value={s.goals.goalDate ?? ''} onChange={e => s.setGoals({ goalDate: e.target.value || undefined })} /></div>
        </>}
        <div className="field"><label>Daily calorie target (optional)</label><NumberField value={s.goals.calorieTarget} suffix="kcal" onChange={n => s.setGoals({ calorieTarget: n || undefined })} /></div>
      </div>

      <h2 className="section-title">Training</h2>
      <div className="card stack">
        <div className="field">
          <label>Units</label>
          <div className="tabs">{(['kg', 'lb'] as Units[]).map(u => <button key={u} className={st.units === u ? 'on' : ''} onClick={() => set({ units: u })}>{u}</button>)}</div>
        </div>
        <div className="field">
          <label>Progression is judged on</label>
          <div className="tabs">
            {([['lowest', 'Lowest set'], ['first', 'First set'], ['average', 'Average']] as [ProgressionBasis, string][]).map(([k, l]) => (
              <button key={k} className={st.basis === k ? 'on' : ''} onClick={() => set({ basis: k })}>{l}</button>
            ))}
          </div>
          <p className="tiny muted">“Lowest set” means every working set must hit the target before you move on.</p>
        </div>
        <div className="row">
          <div className="field grow"><label>Workouts / week</label><NumberField value={st.workoutsPerWeek} min={1} onChange={n => set({ workoutsPerWeek: n ?? 3 })} /></div>
          <div className="field grow"><label>Default rest</label><NumberField value={st.defaultRestSec} suffix="sec" onChange={n => set({ defaultRestSec: n ?? 90 })} /></div>
        </div>
        <div className="row">
          <div className="field grow"><label>Min phase length</label><NumberField value={st.minPhaseWeeks} min={1} suffix="wks" onChange={n => set({ minPhaseWeeks: n ?? 4 })} /></div>
          <div className="field grow"><label>Weight rounding</label><NumberField value={st.weightRounding} step={0.5} suffix="kg" onChange={n => set({ weightRounding: n ?? 2.5 })} /></div>
        </div>
        <div className="row">
          <div className="field grow"><label>Deload weight</label><NumberField value={Math.round(st.deloadWeightPct * 1000) / 10} step={0.5} suffix="%" onChange={n => set({ deloadWeightPct: Math.min(100, n ?? 87.5) / 100 })} /></div>
          <div className="field grow"><label>Deload sets</label><NumberField value={Math.round(st.deloadSetFactor * 100)} suffix="%" onChange={n => set({ deloadSetFactor: Math.min(100, Math.max(10, n ?? 50)) / 100 })} /></div>
        </div>
        <label className="row"><input type="checkbox" checked={st.keepAwake} onChange={e => set({ keepAwake: e.target.checked })} style={{ width: 22, height: 22 }} /> Keep screen on during workouts</label>
        <label className="row"><input type="checkbox" checked={st.timerSound} onChange={e => set({ timerSound: e.target.checked })} style={{ width: 22, height: 22 }} /> Beep when rest is over</label>
        {phase?.type === 'gaining' && <button className="btn" onClick={() => setDeloadOpen(true)}>Start a deload week now</button>}
      </div>

      <h2 className="section-title">Reminders</h2>
      <div className="card stack">
        <div className="row">
          <div className="field grow"><label>Weigh-in</label><input type="time" className="input" value={st.weighInTime} onChange={e => set({ weighInTime: e.target.value })} /></div>
          <div className="field grow"><label>Calories</label><input type="time" className="input" value={st.caloriesTime} onChange={e => set({ caloriesTime: e.target.value })} /></div>
        </div>
        <div className="row">
          <div className="field grow"><label>Coach report day</label>
            <select className="input" value={st.coachDay} onChange={e => set({ coachDay: +e.target.value })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          </div>
          <div className="field grow"><label>at</label><input type="time" className="input" value={st.coachTime} onChange={e => set({ coachTime: e.target.value })} /></div>
        </div>
        {notificationsSupported() && (
          <button className="btn" onClick={async () => setMsg((await requestNotifications()) ? 'Notifications on' : 'Notifications blocked — enable them in your browser settings')}>
            Enable notifications
          </button>
        )}
        <p className="tiny muted">Web apps can only notify reliably while open. For guaranteed daily reminders, add them to your phone's calendar:</p>
        <div className="row">
          <button className="btn sm grow" onClick={() => download('promise-weigh-in.ics', reminderIcs('Log your weight', st.weighInTime, 'Open Promise and log your morning weight.'), 'text/calendar')}>📅 Weigh-in</button>
          <button className="btn sm grow" onClick={() => download('promise-calories.ics', reminderIcs('Log your calories', st.caloriesTime, 'Open Promise and log today\'s calories.'), 'text/calendar')}>📅 Calories</button>
        </div>
      </div>

      <h2 className="section-title">AI coach</h2>
      <div className="card stack">
        <div className="field">
          <label>Anthropic API key (optional)</label>
          <input className="input" type="password" autoComplete="off" placeholder="sk-ant-…" value={st.anthropicKey ?? ''} onChange={e => set({ anthropicKey: e.target.value.trim() || undefined })} />
        </div>
        <p className="tiny muted">With a key, weekly reports are written by Claude. Without one — or offline — the built-in rules coach writes them. The key is stored only on this device and is never included in exports.</p>
      </div>

      <h2 className="section-title">Motivation</h2>
      <div className="card stack">
        <div className="row">
          <input className="input grow" placeholder="Add your own message" value={quote} onChange={e => setQuote(e.target.value)} />
          <button className="btn primary" disabled={!quote.trim()} onClick={() => { set({ customQuotes: [...st.customQuotes, quote.trim()] }); setQuote(''); }}>Add</button>
        </div>
        {st.customQuotes.map((q, i) => (
          <div key={i} className="row">
            <span className="grow small">“{q}”</span>
            <button className="icon-btn" aria-label="Remove message" onClick={() => set({ customQuotes: st.customQuotes.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
      </div>

      <h2 className="section-title">Data</h2>
      <div className="card stack">
        <button className="btn" onClick={() => download(`promise-backup-${ymd()}.json`, s.exportData(), 'application/json')}>Export backup (JSON)</button>
        <button className="btn" onClick={exportCsv}>Export CSV</button>
        <button className="btn" onClick={() => file.current?.click()}>Import backup</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={async e => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (!confirm('Importing replaces all data on this device. Continue?')) return;
          try { s.importData(await f.text()); setMsg('Backup imported'); } catch (err) { setMsg((err as Error).message); }
          e.target.value = '';
        }} />
        <button className="btn danger" onClick={() => { if (confirm('Delete ALL data on this device? Export a backup first.') && confirm('Really delete everything?')) { s.resetAll(); go('home'); } }}>Reset all data</button>
      </div>
      {msg && <p className="center small">{msg}</p>}
      <p className="center tiny muted">Promise · all data stays on this device</p>
      <PlateauSheet open={deloadOpen} onClose={() => setDeloadOpen(false)} />
    </div>
  );
}

export function Onboarding() {
  const s = useStore();
  const [step, setStep] = useState(0);
  const [kg, setKg] = useState<number | undefined>();
  return (
    <div className="stack" style={{ paddingTop: 24 }}>
      <p className="quote">Don't you want your muscle back? Don't you want to keep the promise to yourself?</p>
      {step === 0 && (
        <div className="card stack">
          <h2 className="bold">Let's set you up</h2>
          <div className="field">
            <label>Units</label>
            <div className="tabs">{(['kg', 'lb'] as Units[]).map(u => <button key={u} className={s.settings.units === u ? 'on' : ''} onClick={() => s.setSettings({ units: u })}>{u}</button>)}</div>
          </div>
          <div className="field"><label>Today's bodyweight</label><WeightInput kg={kg} onChange={setKg} /></div>
          <div className="field">
            <label>Goal</label>
            <div className="tabs">
              {(['lose', 'maintain', 'gain'] as GoalDirection[]).map(d => (
                <button key={d} className={s.goals.direction === d ? 'on' : ''} onClick={() => s.setGoals({ direction: d })}>{d === 'lose' ? 'Cut' : d === 'gain' ? 'Bulk' : 'Maintain'}</button>
              ))}
            </div>
          </div>
          {s.goals.direction !== 'maintain' && <>
            <div className="field"><label>Goal weight</label><WeightInput kg={s.goals.goalWeight} onChange={g => s.setGoals({ goalWeight: g })} /></div>
            <div className="field"><label>Goal date</label><input type="date" className="input" value={s.goals.goalDate ?? ''} onChange={e => s.setGoals({ goalDate: e.target.value || undefined })} /></div>
          </>}
          <div className="field"><label>Daily calorie target (optional)</label><NumberField value={s.goals.calorieTarget} suffix="kcal" onChange={n => s.setGoals({ calorieTarget: n || undefined })} /></div>
          <div className="field"><label>Workouts per week</label><NumberField value={s.settings.workoutsPerWeek} min={1} onChange={n => s.setSettings({ workoutsPerWeek: n ?? 3 })} /></div>
          <button className="btn primary big block" onClick={() => { if (kg) s.setCheckIn(ymd(), { bodyweight: kg }); setStep(1); }}>Next</button>
        </div>
      )}
      {step === 1 && (
        <div className="card stack">
          <h2 className="bold">Reminders</h2>
          <p className="muted small">I'll ask for your weight each morning and your calories each evening.</p>
          {notificationsSupported() && <button className="btn" onClick={() => void requestNotifications()}>Allow notifications</button>}
          <button className="btn primary big block" onClick={() => s.setSettings({ onboarded: true })}>Let's go</button>
        </div>
      )}
    </div>
  );
}
