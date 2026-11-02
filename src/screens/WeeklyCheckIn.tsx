import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useStore } from '../data/store';
import { LengthInput } from '../components/ui';
import { PHASE_LABEL, planSnapshot, targetWeekFor } from '../data/plan';
import { bodyFatFromWaist, composition, nextTargets, rateFor, recommendPhase, targetFor } from '../engine/body';
import { addDays, weekStart, ymd } from '../engine/dates';
import { mean } from '../engine/stats';
import { promisesFor } from '../engine/schedule';
import { compressImage, loadPhotoBlob } from '../data/photos';
import { backupToGist } from '../data/backup';
import { fmtBw, fmtLen, fmtRateW } from '../format';
import type { ClothesFit, NutritionPhaseType, Photo } from '../types';
import { generateReport } from './Coach';

const POSES: Photo['pose'][] = ['front', 'side', 'back'];

export function PhotoThumb({ id, style }: { id: string; style?: CSSProperties }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let u: string | undefined;
    void loadPhotoBlob(id).then(b => { if (b) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id]);
  return url ? <img src={url} alt="" style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 12, ...style }} /> : <div style={{ aspectRatio: '3 / 4', background: 'var(--surface-2)', borderRadius: 12, ...style }} />;
}

export function WeeklyCheckInScreen({ go }: { go: (r: string) => void }) {
  const s = useStore();
  const today = ymd();
  const { comp, phase, weeksIn, status } = planSnapshot(s, today);
  const u = s.settings.units;
  const lu = s.settings.lengthUnits;
  const lastWaist = [...s.measurements].sort((a, b) => b.date.localeCompare(a.date))[0];
  const [waistCm, setWaist] = useState<number | undefined>(lastWaist?.waistCm);
  const [clothes, setClothes] = useState<ClothesFit>();
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [decision, setDecision] = useState<'accept' | 'decline' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const ci = Object.values(s.checkIns);
  const thisWeek = mean(ci.filter(c => c.bodyweight != null && c.date > addDays(today, -7)).map(c => c.bodyweight!));
  const lastWeek = mean(ci.filter(c => c.bodyweight != null && c.date > addDays(today, -14) && c.date <= addDays(today, -7)).map(c => c.bodyweight!));
  const promises = promisesFor({ settings: s.settings, sessions: s.sessions, checkIns: s.checkIns, weekly: s.weeklyCheckIns, target: targetFor(s.weeklyTargets, today), today, weekOf: today });
  const bfNow = waistCm ? bodyFatFromWaist(s.profile, waistCm) : comp?.bodyFat ?? null;

  const rec = useMemo(() => {
    if (!phase || !comp) return null;
    const c = waistCm ? composition(s.profile, ci, [...s.measurements, { date: today, waistCm }], today)! : comp;
    const pastClothes = [...s.weeklyCheckIns].reverse().map(w => w.clothes).filter((x): x is ClothesFit => !!x);
    return { comp: c, ...recommendPhase({ phase, comp: c, profile: s.profile, clothes: clothes ? [clothes, ...pastClothes] : pastClothes, waistCm, today }) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waistCm, clothes, phase?.id]);

  const switching = rec && rec.action !== 'stay' && decision === 'accept';
  const nextType: NutritionPhaseType | undefined = switching ? (rec!.action as NutritionPhaseType) : phase?.type;
  const nextRate = switching && rec ? rateFor(nextType!, rec.comp, s.profile) : phase?.targetRate ?? 0;
  const targets = rec && nextType ? nextTargets({ phase: { type: nextType, targetRate: nextRate }, comp: rec.comp, checkIns: ci, previous: targetFor(s.weeklyTargets, today), today, weekStart: targetWeekFor(today) }) : null;

  const addPhoto = async (pose: Photo['pose'], file?: File) => {
    if (!file) return;
    const p = await s.addPhoto(await compressImage(file), pose, today);
    setPhotoIds(ids => [...ids.filter(i => s.photos.find(x => x.id === i)?.pose !== pose), p.id]);
  };

  const finish = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (waistCm) s.addMeasurement({ date: today, waistCm });
      let decisionText = rec?.reason;
      if (switching && nextType) {
        s.startNutritionPhase(nextType, nextRate, rec!.reason, rec!.comp.weight, waistCm);
        decisionText = `Switched to ${PHASE_LABEL[nextType]}: ${rec!.reason}`;
      }
      if (targets) s.setWeeklyTarget(targets);
      s.completeWeeklyCheckIn({ date: today, waistCm, clothes, photoIds, decision: decisionText });
      await generateReport();
      const st = useStore.getState();
      if (st.settings.gistToken && navigator.onLine) {
        try {
          const id = await backupToGist(st.settings.gistToken, st.exportData(), st.settings.gistId);
          st.setSettings({ gistId: id, lastBackupAt: Date.now() });
        } catch (e) { setError(`Saved, but cloud backup failed: ${(e as Error).message}`); }
      }
      go('coach');
    } finally {
      setBusy(false);
    }
  };

  if (!phase || !comp) {
    return (
      <div className="stack">
        <h1 className="page-title">Sunday check-in</h1>
        <div className="card stack"><p>Set up your PT plan first.</p><button className="btn primary" onClick={() => go('setup')}>Set up plan</button></div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row between">
        <button className="btn ghost sm" onClick={() => go('home')}>‹ Home</button>
        <span className="pill">{PHASE_LABEL[phase.type]} · week {weeksIn + 1}</span>
      </div>
      <h1 className="page-title">Sunday check-in</h1>

      <h2 className="section-title">Your week</h2>
      <div className="stats">
        <div className="stat"><div className="v">{thisWeek != null ? fmtBw(thisWeek, u) : '—'}</div><div className="l">Avg weight{lastWeek != null && thisWeek != null ? ` (${thisWeek - lastWeek >= 0 ? '+' : ''}${(thisWeek - lastWeek).toFixed(1)})` : ''}</div></div>
        <div className="stat"><div className="v" style={{ fontSize: 16 }}>{status?.actual != null ? fmtRateW(status.actual, u) : '—'}</div><div className="l">vs {fmtRateW(phase.targetRate, u)} plan</div></div>
        <div className="stat"><div className="v">{promises.kept}/{promises.total}</div><div className="l">Promises kept</div></div>
      </div>
      {status && <div className={`card tight ${status.status === 'on-track' ? 'accent' : status.status === 'unknown' ? '' : 'warn'}`}><span className="small">{status.advice}</span></div>}

      <h2 className="section-title">Measure</h2>
      <div className="card stack">
        <div className="field">
          <label>Waist at the belly button, relaxed, morning</label>
          <LengthInput cm={waistCm} onChange={setWaist} />
          {lastWaist && waistCm && <p className="tiny muted">Last: {fmtLen(lastWaist.waistCm, lu)} on {lastWaist.date} · change {waistCm - lastWaist.waistCm >= 0 ? '+' : ''}{fmtLen(waistCm - lastWaist.waistCm, lu)}</p>}
        </div>
        {bfNow != null && <p className="small">Body fat estimate: <b>~{bfNow.toFixed(1)}%</b> <span className="muted">(calibrated to you — watch the trend, not the exact number)</span></p>}
        <div className="field">
          <label>How do your clothes fit vs last week?</label>
          <div className="tabs">
            {(['looser', 'same', 'tighter'] as ClothesFit[]).map(c => <button key={c} className={clothes === c ? 'on' : ''} onClick={() => setClothes(c)}>{c[0].toUpperCase() + c.slice(1)}</button>)}
          </div>
        </div>
      </div>

      <h2 className="section-title">Progress photos (optional)</h2>
      <div className="card stack">
        <p className="tiny muted">Same spot, same light, same time of day. Stays on your phone.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {POSES.map(pose => {
            const id = photoIds.find(i => s.photos.find(p => p.id === i)?.pose === pose);
            return (
              <label key={pose} className="stack center" style={{ gap: 4, cursor: 'pointer' }}>
                {id ? <PhotoThumb id={id} /> : <div style={{ aspectRatio: '3 / 4', borderRadius: 12, border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: 'var(--muted)' }}>+</div>}
                <span className="small bold">{pose[0].toUpperCase() + pose.slice(1)}</span>
                <input type="file" accept="image/*" capture="environment" hidden onChange={e => void addPhoto(pose, e.target.files?.[0])} />
              </label>
            );
          })}
        </div>
        {s.photos.length > 0 && <button className="btn sm" onClick={() => go('photos')}>Compare photos</button>}
      </div>

      {rec && (
        <>
          <h2 className="section-title">PT decision</h2>
          <div className={`card stack ${rec.action === 'stay' ? '' : 'warn'}`}>
            <p className="bold">{rec.action === 'stay' ? `Stay in your ${PHASE_LABEL[phase.type].toLowerCase()}` : `Time to switch: ${PHASE_LABEL[rec.action as NutritionPhaseType]}`}</p>
            <p className="small">{rec.reason}</p>
            {rec.action !== 'stay' && (
              <div className="row">
                <button className={`btn grow ${decision === 'accept' ? 'primary' : ''}`} onClick={() => setDecision('accept')}>Switch</button>
                <button className={`btn grow ${decision === 'decline' ? 'primary' : ''}`} onClick={() => setDecision('decline')}>Not yet</button>
              </div>
            )}
          </div>
        </>
      )}

      {targets && (
        <>
          <h2 className="section-title">Next week</h2>
          <div className="card accent stack">
            <div className="stats">
              <div className="stat"><div className="v">{targets.kcal.toLocaleString()}</div><div className="l">kcal / day</div></div>
              <div className="stat"><div className="v">{targets.protein}g</div><div className="l">protein / day</div></div>
              <div className="stat"><div className="v" style={{ fontSize: 16 }}>{fmtRateW(nextRate, u)}</div><div className="l">target rate</div></div>
            </div>
            <p className="tiny muted">{targets.note}</p>
          </div>
        </>
      )}

      {error && <p className="small" style={{ color: 'var(--warn)' }}>{error}</p>}
      <button className="btn primary big block" disabled={busy || (rec?.action !== 'stay' && decision == null)} onClick={() => void finish()}>
        {busy ? 'Saving…' : 'Finish check-in'}
      </button>
      <p className="tiny muted center">Finishing saves your targets for the week of {weekStart(targetWeekFor(today))}, writes your coach report{s.settings.gistToken ? ' and backs up to GitHub' : ''}.</p>
    </div>
  );
}
