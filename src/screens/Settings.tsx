import { useRef, useState } from 'react';
import { useStore } from '../data/store';
import { NumberField, WeightInput } from '../components/ui';
import { download, notificationsSupported, reminderIcs, requestNotifications } from '../alerts';
import { addDays, ymd } from '../engine/dates';
import { DAY_NAMES } from '../engine/schedule';
import { PHASE_LABEL, planSnapshot } from '../data/plan';
import { rateFor } from '../engine/body';
import { backupToGist, restoreFromGist } from '../data/backup';
import { fmtRateW } from '../format';
import type { LengthUnits, NutritionPhaseType, ProgressionBasis, Units } from '../types';
import { PlateauSheet } from './Home';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function SettingsScreen({ go }: { go: (r: string) => void }) {
  const s = useStore();
  const st = s.settings;
  const set = s.setSettings;
  const p = s.profile;
  const [quote, setQuote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [deloadOpen, setDeloadOpen] = useState(false);
  const [bfNow, setBfNow] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const block = s.currentPhase();
  const plan = planSnapshot(s);
  const today = ymd();

  const exportCsv = () => {
    const rows = [['date', 'workout', 'deload', 'exercise', 'set', 'warmup', 'weight_kg', 'target_reps', 'reps', 'completed', 'rpe', 'note']];
    for (const ses of [...s.sessions].sort((a, b) => a.startedAt - b.startedAt)) {
      for (const e of ses.exercises) {
        e.sets.forEach((x, i) => rows.push([ymd(ses.startedAt), ses.templateName, String(ses.deload), s.exerciseName(e.exerciseId), String(i + 1), String(x.warmup), String(x.weight), String(x.targetReps), String(x.reps), String(x.completed), x.rpe != null ? String(x.rpe) : '', x.note ?? '']));
      }
    }
    const csv = (r: string[][]) => r.map(l => l.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    download(`promise-workouts-${ymd()}.csv`, csv(rows), 'text/csv');
    const daily = [['date', 'bodyweight_kg', 'calories', 'protein_g', 'sleep_hours', 'waist_cm', 'notes'], ...Object.values(s.checkIns).sort((a, b) => a.date.localeCompare(b.date)).map(c => [
      c.date, c.bodyweight != null ? String(c.bodyweight) : '', c.calories != null ? String(c.calories) : '', c.protein != null ? String(c.protein) : '',
      c.sleepHours != null ? String(c.sleepHours) : '', String(s.measurements.find(m => m.date === c.date)?.waistCm ?? ''), c.notes ?? '',
    ])];
    download(`promise-daily-${ymd()}.csv`, csv(daily), 'text/csv');
  };

  const backupNow = async () => {
    if (!st.gistToken) return;
    setBusy(true);
    try {
      const id = await backupToGist(st.gistToken, s.exportData(), st.gistId);
      set({ gistId: id, lastBackupAt: Date.now() });
      setMsg('Backed up to GitHub ✓');
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const restore = async () => {
    if (!st.gistToken || !st.gistId) return;
    if (!confirm('Replace everything on this phone with the cloud backup?')) return;
    setBusy(true);
    try { s.importData(await restoreFromGist(st.gistToken, st.gistId)); setMsg('Restored from GitHub ✓'); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const switchPhase = (type: NutritionPhaseType) => {
    if (!plan.comp) return;
    if (!confirm(`Start a ${PHASE_LABEL[type].toLowerCase()} today?`)) return;
    s.startNutritionPhase(type, rateFor(type, plan.comp, p), 'Started manually', plan.comp.weight, plan.lastWaist?.waistCm);
    setMsg(`${PHASE_LABEL[type]} started — new targets at your next check-in.`);
  };

  return (
    <div className="stack">
      <h1 className="page-title">Settings</h1>

      <h2 className="section-title">You & your goal</h2>
      <div className="card stack">
        <div className="row">
          <div className="field grow"><label>Weight units</label>
            <div className="tabs">{(['kg', 'lb'] as Units[]).map(x => <button key={x} className={st.units === x ? 'on' : ''} onClick={() => set({ units: x })}>{x}</button>)}</div>
          </div>
          <div className="field grow"><label>Waist units</label>
            <div className="tabs">{(['in', 'cm'] as LengthUnits[]).map(x => <button key={x} className={st.lengthUnits === x ? 'on' : ''} onClick={() => set({ lengthUnits: x })}>{x}</button>)}</div>
          </div>
        </div>
        <div className="row">
          <div className="field grow"><label>Height</label><NumberField value={p.heightCm} suffix="cm" onChange={n => s.setProfile({ heightCm: n })} /></div>
          <div className="field grow"><label>Goal weight</label><WeightInput kg={p.goalWeight || undefined} onChange={kg => s.setProfile({ goalWeight: kg ?? 0 })} /></div>
        </div>
        <div className="row">
          <div className="field grow"><label>Goal body fat</label><NumberField value={p.goalBodyFat} suffix="%" step={0.5} onChange={n => s.setProfile({ goalBodyFat: n ?? 12 })} /></div>
          <div className="field grow"><label>Bulk ceiling</label><NumberField value={p.bulkCeiling} suffix="%" step={0.5} onChange={n => s.setProfile({ bulkCeiling: n ?? 16 })} /></div>
        </div>
        <div className="field">
          <label>Recalibrate body fat (e.g. after a DEXA scan)</label>
          <div className="row">
            <div className="grow"><NumberField value={bfNow} suffix="% now" step={0.5} onChange={setBfNow} /></div>
            <button className="btn" disabled={!bfNow || !plan.comp || !plan.lastWaist} onClick={() => {
              s.setProfile({ baseline: { date: today, weight: plan.comp!.weight, bodyFat: bfNow!, waistCm: plan.lastWaist!.waistCm } });
              setBfNow(undefined); setMsg('Body fat recalibrated ✓');
            }}>Save</button>
          </div>
          <p className="tiny muted">Uses today's weight trend and your latest waist measurement.</p>
        </div>
        <button className="btn" onClick={() => go('setup')}>Redo PT intake & plan</button>
      </div>

      <h2 className="section-title">Nutrition phase</h2>
      <div className="card stack">
        {plan.phase ? (
          <p className="small">Now: <b>{PHASE_LABEL[plan.phase.type]}</b> since {plan.phase.startDate} at {fmtRateW(plan.phase.targetRate, st.units)}.</p>
        ) : <p className="small muted">No plan yet.</p>}
        <div className="row wrap">
          {(['bulk', 'cut', 'maintain'] as NutritionPhaseType[]).filter(t => t !== plan.phase?.type).map(t => (
            <button key={t} className="btn sm" disabled={!plan.comp} onClick={() => switchPhase(t)}>Start {PHASE_LABEL[t].toLowerCase()}</button>
          ))}
        </div>
        <label className="row small">
          <input type="checkbox" checked={!!st.rampUntil && st.rampUntil >= today} onChange={e => set({ rampUntil: e.target.checked ? addDays(today, 21) : undefined })} style={{ width: 22, height: 22 }} />
          Return-to-training ramp {st.rampUntil && st.rampUntil >= today ? `(until ${st.rampUntil})` : '(3 weeks of +2 rep jumps)'}
        </label>
        <p className="tiny muted">The PT switches phases at your Sunday check-in. Use these only to override.</p>
      </div>

      <h2 className="section-title">Training split</h2>
      <div className="card stack">
        {ORDER.map(d => (
          <div key={d} className="row">
            <span className="bold" style={{ width: 48 }}>{DAY_NAMES[d]}</span>
            <select className="input grow" value={st.schedule[d] ?? ''} onChange={e => s.setScheduleDay(d, e.target.value || null)} aria-label={`${DAYS[d]} workout`}>
              <option value="">Rest</option>
              {s.templates.filter(t => !t.archived).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        ))}
        <button className="btn" onClick={() => { if (confirm('Add the PT program (Upper/Lower/Pull/Legs/Push) and set it as your split?')) { s.loadStarterProgram(); setMsg('PT program loaded ✓'); } }}>Load PT program</button>
        <p className="tiny muted">Move a single session from the week strip on Home — it won't change this.</p>
      </div>

      <h2 className="section-title">Training</h2>
      <div className="card stack">
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
          <div className="field grow"><label>Default rest</label><NumberField value={st.defaultRestSec} suffix="sec" onChange={n => set({ defaultRestSec: n ?? 90 })} /></div>
          <div className="field grow"><label>Min block length</label><NumberField value={st.minPhaseWeeks} min={1} suffix="wks" onChange={n => set({ minPhaseWeeks: n ?? 4 })} /></div>
        </div>
        <div className="row">
          <div className="field grow"><label>Deload weight</label><NumberField value={Math.round(st.deloadWeightPct * 1000) / 10} step={0.5} suffix="%" onChange={n => set({ deloadWeightPct: Math.min(100, n ?? 87.5) / 100 })} /></div>
          <div className="field grow"><label>Deload sets</label><NumberField value={Math.round(st.deloadSetFactor * 100)} suffix="%" onChange={n => set({ deloadSetFactor: Math.min(100, Math.max(10, n ?? 50)) / 100 })} /></div>
        </div>
        <div className="field"><label>Deload weight rounding</label><NumberField value={st.weightRounding} step={0.5} suffix="kg" onChange={n => set({ weightRounding: n ?? 2.5 })} /></div>
        <label className="row"><input type="checkbox" checked={st.keepAwake} onChange={e => set({ keepAwake: e.target.checked })} style={{ width: 22, height: 22 }} /> Keep screen on during workouts</label>
        <label className="row"><input type="checkbox" checked={st.timerSound} onChange={e => set({ timerSound: e.target.checked })} style={{ width: 22, height: 22 }} /> Beep when rest is over</label>
        {block?.type === 'gaining' && <button className="btn" onClick={() => setDeloadOpen(true)}>Start a deload week now</button>}
      </div>

      <h2 className="section-title">Reminders</h2>
      <div className="card stack">
        <div className="row">
          <div className="field grow"><label>Weigh-in</label><input type="time" className="input" value={st.weighInTime} onChange={e => set({ weighInTime: e.target.value })} /></div>
          <div className="field grow"><label>Food log</label><input type="time" className="input" value={st.caloriesTime} onChange={e => set({ caloriesTime: e.target.value })} /></div>
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
        <div className="row wrap">
          <button className="btn sm grow" onClick={() => download('promise-weigh-in.ics', reminderIcs('Weigh in', st.weighInTime, 'Open Promise: weigh in and log hours slept.'), 'text/calendar')}>📅 Weigh-in</button>
          <button className="btn sm grow" onClick={() => download('promise-food.ics', reminderIcs('Log protein & calories', st.caloriesTime, "Open Promise and log today's protein and calories."), 'text/calendar')}>📅 Food log</button>
        </div>
      </div>

      <h2 className="section-title">Cloud backup</h2>
      <div className="card stack">
        <p className="tiny muted">
          Backs up to a private (secret) GitHub Gist after every Sunday check-in. Create a token at github.com → Settings → Developer settings → Personal access tokens (classic) with only the <b>gist</b> scope, then paste it here. It's stored only on this phone. Photos stay on the phone.
        </p>
        <input className="input" type="password" autoComplete="off" placeholder="GitHub token (ghp_…)" value={st.gistToken ?? ''} onChange={e => set({ gistToken: e.target.value.trim() || undefined })} />
        <div className="row">
          <button className="btn grow" disabled={!st.gistToken || busy} onClick={() => void backupNow()}>Back up now</button>
          <button className="btn grow" disabled={!st.gistToken || !st.gistId || busy} onClick={() => void restore()}>Restore</button>
        </div>
        <div className="field">
          <label>Backup gist ID (to restore on a new phone)</label>
          <input className="input" value={st.gistId ?? ''} placeholder="filled in after the first backup" onChange={e => set({ gistId: e.target.value.trim() || undefined })} />
        </div>
        {st.lastBackupAt && <p className="tiny muted">Last backup: {new Date(st.lastBackupAt).toLocaleString()}</p>}
      </div>

      <h2 className="section-title">AI coach</h2>
      <div className="card stack">
        <div className="field">
          <label>Anthropic API key (optional)</label>
          <input className="input" type="password" autoComplete="off" placeholder="sk-ant-…" value={st.anthropicKey ?? ''} onChange={e => set({ anthropicKey: e.target.value.trim() || undefined })} />
        </div>
        <p className="tiny muted">With a key, weekly reports are written by Claude. Without one — or offline — the built-in rules coach writes them. The key is stored only on this device and never included in backups.</p>
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
      <p className="center tiny muted">Promise · your data stays on this device</p>
      <PlateauSheet open={deloadOpen} onClose={() => setDeloadOpen(false)} />
    </div>
  );
}
