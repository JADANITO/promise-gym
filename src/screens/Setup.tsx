import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { LengthInput, NumberField, WeightInput } from '../components/ui';
import { Roadmap } from '../components/plan';
import { PHASE_LABEL } from '../data/plan';
import { nextTargets, peakLean, rateFor, simulateRoadmap, type Composition } from '../engine/body';
import { addDays, weekStart, ymd } from '../engine/dates';
import { notificationsSupported, requestNotifications } from '../alerts';
import { fmtBw, fmtRateW } from '../format';
import type { LengthUnits, Profile, Units } from '../types';

/** PT intake: who you are, where you've been, where you're going — then the plan. */
export function Setup({ go, first = false }: { go: (r: string) => void; first?: boolean }) {
  const s = useStore();
  const today = ymd();
  const [step, setStep] = useState(0);
  const [weight, setWeight] = useState<number | undefined>(s.checkIns[today]?.bodyweight ?? s.profile.baseline?.weight);
  const [heightCm, setHeight] = useState<number | undefined>(s.profile.heightCm);
  const [waistCm, setWaist] = useState<number | undefined>(s.profile.baseline?.waistCm);
  const [bodyFat, setBf] = useState<number | undefined>(s.profile.baseline?.bodyFat);
  const [bigger, setBigger] = useState(!!s.profile.peak);
  const [peakW, setPeakW] = useState<number | undefined>(s.profile.peak?.weight);
  const [peakBf, setPeakBf] = useState<number | undefined>(s.profile.peak?.bodyFat);
  const [goalW, setGoalW] = useState<number | undefined>(s.profile.goalWeight || undefined);
  const [goalBf, setGoalBf] = useState<number | undefined>(s.profile.goalBodyFat);
  const [ceiling, setCeiling] = useState<number | undefined>(s.profile.bulkCeiling);
  const [ramp, setRamp] = useState(true);
  const [program, setProgram] = useState<'pt' | 'own'>(s.templates.length ? 'own' : 'pt');
  const u = s.settings.units;

  const step0Ok = weight && heightCm && waistCm && bodyFat;
  const draft: Profile | null = step0Ok && goalW ? {
    heightCm, goalWeight: goalW, goalBodyFat: goalBf ?? 12, bulkCeiling: ceiling ?? 16,
    baseline: { date: today, weight: weight!, bodyFat: bodyFat!, waistCm: waistCm! },
    peak: bigger && peakW && peakBf ? { weight: peakW, bodyFat: peakBf } : undefined,
  } : null;

  const plan = useMemo(() => {
    if (!draft) return null;
    const comp: Composition = { weight: weight!, bodyFat: bodyFat!, lean: weight! * (1 - bodyFat! / 100), fat: weight! * bodyFat! / 100, source: 'baseline' };
    const roadmap = simulateRoadmap(comp, draft, today);
    const first = roadmap[0];
    const type = first.type === 'goal' ? 'maintain' : first.type;
    const rate = rateFor(type, comp, draft);
    const targets = nextTargets({ phase: { type, targetRate: rate }, comp, checkIns: Object.values(s.checkIns), today, weekStart: weekStart(today) });
    return { comp, roadmap, type, rate, targets };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(draft)]);

  const finish = () => {
    if (!draft || !plan) return;
    s.setSettings({ rampUntil: ramp ? addDays(today, 21) : undefined, onboarded: true });
    s.setProfile(draft);
    s.setCheckIn(today, { bodyweight: weight });
    s.addMeasurement({ date: today, waistCm: waistCm! });
    s.startNutritionPhase(plan.type, plan.rate, plan.roadmap[0].note, weight, waistCm);
    s.setWeeklyTarget(plan.targets);
    s.completeWeeklyCheckIn({ date: today, waistCm, photoIds: [], decision: `Plan created: ${PHASE_LABEL[plan.type]}` });
    if (program === 'pt') s.loadStarterProgram();
    go('home');
  };

  return (
    <div className="stack" style={{ paddingTop: first ? 24 : 0 }}>
      {first ? <p className="quote">Don't you want your muscle back? Don't you want to keep the promise to yourself?</p> : <h1 className="page-title">Your PT plan</h1>}
      <div className="row small muted">{['You', 'Goal', 'Plan', 'Training'].map((l, i) => <span key={l} className={`pill ${i === step ? 'accent' : ''}`}>{i + 1}. {l}</span>)}</div>

      {step === 0 && (
        <div className="card stack">
          <h2 className="bold">Where you are now</h2>
          <div className="row">
            <div className="field grow"><label>Weight units</label>
              <div className="tabs">{(['kg', 'lb'] as Units[]).map(x => <button key={x} className={u === x ? 'on' : ''} onClick={() => s.setSettings({ units: x })}>{x}</button>)}</div>
            </div>
            <div className="field grow"><label>Waist units</label>
              <div className="tabs">{(['in', 'cm'] as LengthUnits[]).map(x => <button key={x} className={s.settings.lengthUnits === x ? 'on' : ''} onClick={() => s.setSettings({ lengthUnits: x })}>{x}</button>)}</div>
            </div>
          </div>
          <div className="field"><label>Height</label><NumberField value={heightCm} suffix="cm" onChange={setHeight} /></div>
          <div className="field"><label>This morning's weight</label><WeightInput kg={weight} onChange={setWeight} /></div>
          <div className="field">
            <label>Waist (at the belly button, relaxed)</label>
            <LengthInput cm={waistCm} onChange={setWaist} />
            <p className="tiny muted">Your jeans size is a decent first guess. Measure properly with a tape at your first Sunday check-in.</p>
          </div>
          <div className="field">
            <label>Body fat estimate</label>
            <NumberField value={bodyFat} suffix="%" step={0.5} onChange={setBf} />
            <p className="tiny muted">Your best guess is fine — the app calibrates your waist against it, then tracks changes from there.</p>
          </div>
          <button className="btn primary big block" disabled={!step0Ok} onClick={() => setStep(1)}>Next</button>
        </div>
      )}

      {step === 1 && (
        <div className="card stack">
          <h2 className="bold">Where you're going</h2>
          <label className="row"><input type="checkbox" checked={bigger} onChange={e => setBigger(e.target.checked)} style={{ width: 22, height: 22 }} /> I've been bigger before (muscle memory)</label>
          {bigger && (
            <div className="row">
              <div className="field grow"><label>Heaviest weight</label><WeightInput kg={peakW} onChange={setPeakW} /></div>
              <div className="field grow"><label>Body fat then</label><NumberField value={peakBf} suffix="%" step={0.5} onChange={setPeakBf} /></div>
            </div>
          )}
          <div className="row">
            <div className="field grow"><label>Goal weight</label><WeightInput kg={goalW} onChange={setGoalW} /></div>
            <div className="field grow"><label>Goal body fat</label><NumberField value={goalBf} suffix="%" step={0.5} onChange={setGoalBf} /></div>
          </div>
          <div className="field">
            <label>End a lean bulk at about</label>
            <NumberField value={ceiling} suffix="% body fat" step={0.5} onChange={setCeiling} />
            <p className="tiny muted">16% keeps bulks lean and cuts short. You'll also be prompted to cut if your waist grows ~4cm or your clothes get tight.</p>
          </div>
          <div className="row">
            <button className="btn grow" onClick={() => setStep(0)}>Back</button>
            <button className="btn primary grow" disabled={!goalW} onClick={() => setStep(2)}>See my plan</button>
          </div>
        </div>
      )}

      {step === 2 && plan && draft && (
        <>
          <div className="card accent stack">
            <p className="small muted bold">YOUR PT SAYS</p>
            <h2 className="bold" style={{ fontSize: 22 }}>Start with a {PHASE_LABEL[plan.type].toLowerCase()} at {fmtRateW(plan.rate, u)}</h2>
            <p className="small">
              Lean mass now ~{fmtBw(plan.comp.lean, u)}. Goal needs ~{fmtBw(draft.goalWeight * (1 - draft.goalBodyFat / 100), u)}.
              {peakLean(draft) && plan.comp.lean < peakLean(draft)! ? ` You've carried ~${fmtBw(peakLean(draft)!, u)} of lean mass before, so the first ${fmtBw(peakLean(draft)! - plan.comp.lean, u)} should come back fast.` : ''}
            </p>
            <div className="stats">
              <div className="stat"><div className="v">{plan.targets.kcal.toLocaleString()}</div><div className="l">kcal / day</div></div>
              <div className="stat"><div className="v">{plan.targets.protein}g</div><div className="l">protein / day</div></div>
              <div className="stat"><div className="v" style={{ fontSize: 16 }}>{plan.roadmap[plan.roadmap.length - 1]?.type === 'goal' ? new Date(plan.roadmap[plan.roadmap.length - 1].startDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—'}</div><div className="l">Goal date</div></div>
            </div>
            <p className="tiny muted">{plan.targets.note} Targets update every Sunday from your real data.</p>
          </div>
          <div className="card"><h3 className="section-title" style={{ marginTop: 0 }}>Roadmap</h3><Roadmap steps={plan.roadmap} /></div>
          <label className="row card tight">
            <input type="checkbox" checked={ramp} onChange={e => setRamp(e.target.checked)} style={{ width: 22, height: 22 }} />
            <span className="small"><b>Ease back in for 3 weeks.</b> Start lighter, progress 2 reps at a time — muscle memory does the rest without beating up your joints.</span>
          </label>
          <div className="row">
            <button className="btn grow" onClick={() => setStep(1)}>Back</button>
            <button className="btn primary grow" onClick={() => setStep(3)}>Next</button>
          </div>
        </>
      )}

      {step === 3 && (
        <div className="card stack">
          <h2 className="bold">Training</h2>
          <button className={`card tight stack ${program === 'pt' ? 'accent' : ''}`} style={{ textAlign: 'left' }} onClick={() => setProgram('pt')}>
            <b>Load my PT program</b>
            <span className="small muted">Upper (Mon) · Lower (Tue) · Rest · Pull (Thu) · Legs (Fri) · Push (Sat) · Rest. ~10–14 hard sets per muscle a week, all editable.{s.templates.length ? ' Keeps your existing workouts too.' : ''}</span>
          </button>
          <button className={`card tight stack ${program === 'own' ? 'accent' : ''}`} style={{ textAlign: 'left' }} onClick={() => setProgram('own')}>
            <b>I'll build my own</b>
            <span className="small muted">Create workouts and set your weekly split in Settings.</span>
          </button>
          {notificationsSupported() && <button className="btn" onClick={() => void requestNotifications()}>Allow reminders</button>}
          <div className="row">
            <button className="btn grow" onClick={() => setStep(2)}>Back</button>
            <button className="btn primary grow big" onClick={finish}>Start the plan</button>
          </div>
        </div>
      )}
    </div>
  );
}
