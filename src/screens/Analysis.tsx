import { useMemo, useState, type ReactNode } from 'react';
import {
  Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea,
  ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useStore } from '../data/store';
import { achievedReps, computeProgress, e1rm } from '../engine/progression';
import { addDays, fmtDate, parseYmd, weekStart, ymd } from '../engine/dates';
import { mean, movingAverage, weights as weightSeries } from '../engine/stats';
import { bodyFatFromWaist, targetFor } from '../engine/body';
import { setsPerMuscle, volumeRange } from '../engine/schedule';
import { TRACKED_MUSCLES, muscleLabel } from '../data/library';
import { planSnapshot } from '../data/plan';
import { PHASE_COLOR } from '../components/plan';
import { fmtLen, fmtRateW, toLen, toUnit } from '../format';

// Validated (dataviz validator, dark surface #15181d): blue + orange, all checks pass.
const C1 = '#3987e5';
const C2 = '#d95926';
const INK = '#9aa3ae';
const GRID = '#2a2f38';

type Range = '4w' | '12w' | '6m' | 'all';
const RANGES: [Range, string][] = [['4w', '4 wks'], ['12w', '12 wks'], ['6m', '6 mo'], ['all', 'All']];
const rangeStart = (r: Range, today: string) => (r === 'all' ? '0000-00-00' : addDays(today, r === '4w' ? -27 : r === '12w' ? -83 : -182));
const ts = (d: string) => parseYmd(d).getTime();
const tick = (t: number) => fmtDate(ymd(t));

const axisProps = { stroke: INK, tick: { fill: INK, fontSize: 12 }, tickLine: false, axisLine: { stroke: GRID } };

function ChartTip({ active, payload, label, fmt }: { active?: boolean; payload?: { name: string; value: number; color?: string; payload: Record<string, unknown> }[]; label?: number; fmt: (name: string, v: number) => string }) {
  if (!active || !payload?.length) return null;
  const extra = payload[0].payload.note as string | undefined;
  return (
    <div style={{ background: '#1d2128', border: `1px solid ${GRID}`, borderRadius: 10, padding: '8px 10px', fontSize: 13 }}>
      <div className="bold">{tick((payload[0].payload.t as number) ?? label)}</div>
      {payload.filter(p => p.value != null).map(p => (
        <div key={p.name} className="row" style={{ gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color ?? C1, display: 'inline-block' }} />
          <span className="muted">{p.name}</span><span className="num bold">{fmt(p.name, p.value)}</span>
        </div>
      ))}
      {extra && <div className="tiny" style={{ color: INK }}>{extra}</div>}
    </div>
  );
}

function TableToggle({ children }: { children: ReactNode }) {
  return (
    <details className="small">
      <summary className="muted" style={{ cursor: 'pointer', padding: '6px 0' }}>Show as table</summary>
      <div style={{ maxHeight: 240, overflowY: 'auto' }}>{children}</div>
    </details>
  );
}

const tableStyle = { width: '100%', borderCollapse: 'collapse' as const, fontVariantNumeric: 'tabular-nums' };

export function AnalysisScreen({ go }: { go: (r: string) => void }) {
  const [tab, setTab] = useState<'strength' | 'body' | 'food' | 'muscles'>('strength');
  const [range, setRange] = useState<Range>('12w');
  return (
    <div className="stack">
      <h1 className="page-title">Progress</h1>
      <div className="tabs">
        <button className={tab === 'strength' ? 'on' : ''} onClick={() => setTab('strength')}>Strength</button>
        <button className={tab === 'body' ? 'on' : ''} onClick={() => setTab('body')}>Body</button>
        <button className={tab === 'food' ? 'on' : ''} onClick={() => setTab('food')}>Food</button>
        <button className={tab === 'muscles' ? 'on' : ''} onClick={() => setTab('muscles')}>Muscles</button>
      </div>
      {tab !== 'muscles' && (
        <div className="chips">
          {RANGES.map(([k, l]) => <button key={k} className={`chip ${range === k ? 'on' : ''}`} onClick={() => setRange(k)}>{l}</button>)}
        </div>
      )}
      {tab === 'strength' && <Strength range={range} />}
      {tab === 'body' && <Body range={range} go={go} />}
      {tab === 'food' && <Food range={range} />}
      {tab === 'muscles' && <Muscles />}
    </div>
  );
}

type Metric = 'e1rm' | 'weight' | 'reps' | 'volume';
const METRICS: [Metric, string][] = [['e1rm', 'Est. 1RM'], ['weight', 'Weight'], ['reps', 'Reps'], ['volume', 'Volume']];

function Strength({ range }: { range: Range }) {
  const sessions = useStore(s => s.sessions);
  const phases = useStore(s => s.phases);
  const settings = useStore(s => s.settings);
  const name = useStore(s => s.exerciseName);
  const u = settings.units;
  const today = ymd();
  const from = rangeStart(range, today);

  const exerciseIds = useMemo(() => {
    const counts = new Map<string, number>();
    sessions.forEach(s => s.exercises.forEach(e => !e.skipped && counts.set(e.exerciseId, (counts.get(e.exerciseId) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [sessions]);
  const [picked, setPicked] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('e1rm');
  const exId = picked && exerciseIds.includes(picked) ? picked : exerciseIds[0];

  const series = useMemo(() => {
    if (!exId) return [];
    let best = 0;
    let prevWeight: number | null = null;
    const out: { t: number; date: string; e1rm: number; weight: number; reps: number; volume: number; deload: boolean; pr: boolean; up: boolean; note?: string }[] = [];
    for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
      const le = s.exercises.find(e => e.exerciseId === exId && !e.skipped);
      if (!le) continue;
      const ws = le.sets.filter(x => x.completed && !x.warmup);
      if (!ws.length) continue;
      const top = Math.max(...ws.map(x => e1rm(x.weight, x.reps)));
      const pr = !s.deload && best > 0 && top > best;
      if (!s.deload) best = Math.max(best, top);
      const up = !s.deload && prevWeight != null && le.workingWeight > prevWeight;
      if (!s.deload && le.countsForProgression) prevWeight = le.workingWeight;
      const date = ymd(s.startedAt);
      out.push({
        t: ts(date), date,
        e1rm: toUnit(top, u),
        weight: toUnit(le.workingWeight, u),
        reps: achievedReps(le.sets, settings.basis) ?? 0,
        volume: Math.round(toUnit(ws.reduce((v, x) => v + x.weight * x.reps, 0), u)),
        deload: s.deload, pr, up,
        note: [s.deload && 'Deload', up && 'Weight increased', pr && 'New PR'].filter(Boolean).join(' · ') || undefined,
      });
    }
    return out.filter(p => p.date >= from);
  }, [sessions, exId, from, u, settings.basis]);

  const deloads = phases.filter(p => p.type === 'deload').map(p => ({ x1: ts(p.startDate), x2: ts(p.endDate ?? addDays(p.startDate, 6)) }));

  // Summary across all exercises
  const summary = useMemo(() => {
    const phase = phases.find(p => p.status === 'active' && p.type === 'gaining') ?? [...phases].reverse().find(p => p.type === 'gaining');
    return exerciseIds.map(id => {
      const pts = sessions.filter(s => !s.deload).sort((a, b) => a.startedAt - b.startedAt).flatMap(s => {
        const le = s.exercises.find(e => e.exerciseId === id && !e.skipped);
        const ws = le?.sets.filter(x => x.completed && !x.warmup) ?? [];
        return ws.length ? [{ date: ymd(s.startedAt), v: Math.max(...ws.map(x => e1rm(x.weight, x.reps))) }] : [];
      });
      const inPhase = phase ? pts.filter(p => p.date >= phase.startDate) : pts;
      const st = computeProgress(id, sessions, settings.basis, 0, 0);
      return {
        id,
        best: Math.max(0, ...pts.map(p => p.v)),
        gain: inPhase.length >= 2 ? inPhase[inPhase.length - 1].v - inPhase[0].v : 0,
        stalled: st.failedCount >= 2,
      };
    });
  }, [exerciseIds, sessions, phases, settings.basis]);

  if (!exerciseIds.length) return <div className="card muted">Finish a workout and your strength charts appear here.</div>;
  const unitFor = (m: Metric) => (m === 'reps' ? 'reps' : u);
  const label = METRICS.find(m => m[0] === metric)![1];

  return (
    <div className="stack">
      <select className="input" value={exId} onChange={e => setPicked(e.target.value)} aria-label="Exercise">
        {exerciseIds.map(id => <option key={id} value={id}>{name(id)}</option>)}
      </select>
      <div className="tabs">
        {METRICS.map(([k, l]) => <button key={k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>{l}</button>)}
      </div>
      <div className="card">
        <div className="row between"><h3 className="bold">{name(exId)} · {label}</h3><span className="muted small">{unitFor(metric)}</span></div>
        {series.length === 0 ? <p className="muted small mt">No sessions in this range.</p> : (
          <div className="chart">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 20, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                {deloads.map((d, i) => <ReferenceArea key={i} x1={d.x1} x2={d.x2} fill="#6ea8ff" fillOpacity={0.08} ifOverflow="hidden" />)}
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tick} {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} domain={['auto', 'auto']} width={48} />
                <Tooltip cursor={{ stroke: INK, strokeDasharray: '3 3' }} content={<ChartTip fmt={(_, v) => `${v} ${unitFor(metric)}`} />} />
                <Line type="monotone" dataKey={metric} name={label} stroke={C1} strokeWidth={2} isAnimationActive={false}
                  dot={(p: { cx?: number; cy?: number; payload?: { deload: boolean; pr: boolean; up: boolean }; index?: number }) => {
                    const { cx = 0, cy = 0, payload, index } = p;
                    const marker = payload?.pr ? 'PR' : payload?.up ? '▲' : null;
                    return (
                      <g key={index}>
                        <circle cx={cx} cy={cy} r={payload?.pr || payload?.up ? 5 : 4} fill={payload?.deload ? '#15181d' : C1} stroke={payload?.deload ? C1 : '#15181d'} strokeWidth={2} />
                        {marker && <text x={cx} y={cy - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill="#f4f6f8">{marker}</text>}
                      </g>
                    );
                  }}
                  activeDot={{ r: 6, stroke: '#15181d', strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="tiny muted">▲ weight increase · PR new estimated 1RM · hollow dot = deload · shaded = deload week</p>
        <TableToggle>
          <table style={tableStyle}><thead><tr><th align="left">Date</th><th align="right">Weight</th><th align="right">Reps</th><th align="right">e1RM</th><th align="right">Volume</th></tr></thead>
            <tbody>{[...series].reverse().map(p => <tr key={`${p.t}-${p.weight}-${p.reps}`}><td>{fmtDate(p.date)}{p.deload ? ' (deload)' : ''}</td><td align="right">{p.weight}</td><td align="right">{p.reps}</td><td align="right">{p.e1rm.toFixed(1)}</td><td align="right">{p.volume}</td></tr>)}</tbody>
          </table>
        </TableToggle>
      </div>

      <h2 className="section-title">Strongest lifts (est. 1RM)</h2>
      <div className="card tight">
        {[...summary].sort((a, b) => b.best - a.best).slice(0, 5).map(x => (
          <div key={x.id} className="row between" style={{ padding: '6px 0' }}><span>{name(x.id)}</span><span className="num bold">{toUnit(x.best, u).toFixed(1)}{u}</span></div>
        ))}
      </div>
      <h2 className="section-title">Biggest gains this phase</h2>
      <div className="card tight">
        {summary.filter(x => x.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 5).map(x => (
          <div key={x.id} className="row between" style={{ padding: '6px 0' }}><span>{name(x.id)}</span><span className="num bold" style={{ color: 'var(--good)' }}>+{toUnit(x.gain, u).toFixed(1)}{u}</span></div>
        ))}
        {!summary.some(x => x.gain > 0) && <p className="muted small">No gains logged in this phase yet.</p>}
      </div>
      {summary.some(x => x.stalled) && <>
        <h2 className="section-title">Stalled</h2>
        <div className="card tight warn">
          {summary.filter(x => x.stalled).map(x => <div key={x.id} style={{ padding: '6px 0' }}>⚠ {name(x.id)} — below range 2+ sessions</div>)}
        </div>
      </>}
    </div>
  );
}

function Body({ range, go }: { range: Range; go: (r: string) => void }) {
  const s = useStore();
  const u = s.settings.units;
  const lu = s.settings.lengthUnits;
  const today = ymd();
  const from = rangeStart(range, today);
  const all = weightSeries(Object.values(s.checkIns));
  const ma = movingAverage(all);
  const plan = planSnapshot(s, today);
  const phase = plan.phase;

  const rows: { t: number; date?: string; daily?: number; avg?: number; pace?: number }[] = all.filter(p => p.date >= from).map(p => ({
    t: ts(p.date), date: p.date, daily: toUnit(p.value, u), avg: toUnit(ma.find(m => m.date === p.date)!.value, u),
  }));
  // The planned pace for the current phase, from its start to 4 weeks ahead.
  if (phase?.startWeight != null) {
    const start = phase.startDate >= from ? phase.startDate : from;
    const end = addDays(today, 28);
    for (const d of [start, end]) {
      const wk = (ts(d) - ts(phase.startDate)) / (7 * 86_400_000);
      const pace = +toUnit(phase.startWeight + phase.targetRate * wk, u).toFixed(1);
      const hit = rows.find(r => r.t === ts(d));
      if (hit) hit.pace = pace; else rows.push({ t: ts(d), pace });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  const tMin = rows[0]?.t ?? 0, tMax = rows[rows.length - 1]?.t ?? 0;
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round(tMin + ((tMax - tMin) * i) / 4));
  const bands = s.nutritionPhases.filter(p => (p.endDate ?? today) >= from);

  const waist = s.measurements.filter(m => m.date >= from).map(m => ({
    t: ts(m.date), date: m.date, waist: toLen(m.waistCm, lu), bf: bodyFatFromWaist(s.profile, m.waistCm),
  }));
  const avgOf = (a: string, b: string) => mean(all.filter(p => p.date >= a && p.date <= b).map(p => p.value));
  const thisWk = avgOf(addDays(today, -6), today);
  const lastWk = avgOf(addDays(today, -13), addDays(today, -7));
  const fmtChange = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${toUnit(v, u).toFixed(1)}${u}`);
  const waistStart = phase?.startWaistCm;

  if (!all.length) return <div className="card muted">Log your weight each morning and your trend shows up here.</div>;

  return (
    <div className="stack">
      <div className="card">
        <div className="row between"><h3 className="bold">Bodyweight</h3><span className="muted small">{u}</span></div>
        <div className="legend mt">
          <span style={{ ['--c' as string]: C1 }}>Daily weigh-in</span>
          <span style={{ ['--c' as string]: C2 }}>7-day average</span>
          {phase?.startWeight != null && <span style={{ ['--c' as string]: INK }}>Planned pace</span>}
        </div>
        <div className="chart">
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 16, right: 16, left: -12, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              {bands.map(p => (
                <ReferenceArea key={p.id} x1={Math.max(ts(p.startDate), tMin)} x2={Math.min(ts(p.endDate ?? today), tMax)} fill={PHASE_COLOR[p.type]} fillOpacity={0.07} ifOverflow="hidden" />
              ))}
              <XAxis dataKey="t" type="number" scale="time" domain={[tMin, tMax]} ticks={ticks} tickFormatter={tick} {...axisProps} />
              <YAxis {...axisProps} domain={[(min: number) => Math.floor(min - 1), (max: number) => Math.ceil(max + 1)]} allowDecimals={false} width={48} />
              <Tooltip cursor={{ stroke: INK, strokeDasharray: '3 3' }} content={<ChartTip fmt={(_, v) => `${v}${u}`} />} />
              <Scatter data={rows.filter(r => r.daily != null)} dataKey="daily" name="Daily" fill={C1} shape={(p: { cx?: number; cy?: number }) => <circle cx={p.cx} cy={p.cy} r={4} fill={C1} stroke="#15181d" strokeWidth={2} />} isAnimationActive={false} />
              <Line dataKey="avg" name="7-day avg" stroke={C2} strokeWidth={2} dot={false} type="monotone" connectNulls isAnimationActive={false} />
              {phase?.startWeight != null && <Line dataKey="pace" name="Planned pace" stroke={INK} strokeDasharray="4 4" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="tiny muted">Shaded: blue = lean bulk, orange = lean cut, grey = maintenance.</p>
        <TableToggle>
          <table style={tableStyle}><thead><tr><th align="left">Date</th><th align="right">Weight</th><th align="right">7-day avg</th></tr></thead>
            <tbody>{rows.filter(r => r.date).reverse().map(p => <tr key={p.date}><td>{fmtDate(p.date!)}</td><td align="right">{p.daily}</td><td align="right">{p.avg?.toFixed(1)}</td></tr>)}</tbody>
          </table>
        </TableToggle>
      </div>
      <div className="stats">
        <div className="stat"><div className="v">{fmtChange(thisWk != null && lastWk != null ? thisWk - lastWk : null)}</div><div className="l">This week</div></div>
        <div className="stat"><div className="v">{fmtChange(thisWk != null && phase?.startWeight != null ? thisWk - phase.startWeight : null)}</div><div className="l">This phase</div></div>
        <div className="stat"><div className="v" style={{ fontSize: 16 }}>{phase ? fmtRateW(phase.targetRate, u) : '—'}</div><div className="l">Planned rate</div></div>
      </div>
      {plan.status && plan.status.status !== 'unknown' && <div className="card tight small">{plan.status.advice}</div>}

      <div className="card">
        <div className="row between"><h3 className="bold">Waist</h3><span className="muted small">{lu}</span></div>
        {waist.length < 2 ? <p className="muted small mt">Measure your waist at each Sunday check-in to see the trend.</p> : (
          <div className="chart" style={{ height: 180 }}>
            <ResponsiveContainer>
              <LineChart data={waist} margin={{ top: 16, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tick} {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} domain={['auto', 'auto']} width={48} />
                <Tooltip cursor={{ stroke: INK, strokeDasharray: '3 3' }} content={<ChartTip fmt={(_, v) => `${v}${lu}`} />} />
                <Line dataKey="waist" name="Waist" stroke={C1} strokeWidth={2} dot={{ r: 4, fill: C1, stroke: '#15181d', strokeWidth: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="stats mt">
          <div className="stat"><div className="v">{plan.lastWaist ? fmtLen(plan.lastWaist.waistCm, lu) : '—'}</div><div className="l">Latest</div></div>
          <div className="stat"><div className="v">{plan.lastWaist && waistStart != null ? `${plan.lastWaist.waistCm - waistStart >= 0 ? '+' : ''}${fmtLen(plan.lastWaist.waistCm - waistStart, lu)}` : '—'}</div><div className="l">This phase</div></div>
          <div className="stat"><div className="v">{plan.comp ? `~${plan.comp.bodyFat.toFixed(1)}%` : '—'}</div><div className="l">Body fat est.</div></div>
        </div>
        <TableToggle>
          <table style={tableStyle}><thead><tr><th align="left">Date</th><th align="right">Waist</th><th align="right">BF est.</th></tr></thead>
            <tbody>{[...waist].reverse().map(p => <tr key={p.date}><td>{fmtDate(p.date)}</td><td align="right">{p.waist}</td><td align="right">{p.bf != null ? `${p.bf.toFixed(1)}%` : '—'}</td></tr>)}</tbody>
          </table>
        </TableToggle>
      </div>
      <button className="btn block" onClick={() => go('photos')}>📷 Progress photos ({s.photos.length})</button>
    </div>
  );
}

function Food({ range }: { range: Range }) {
  const s = useStore();
  const u = s.settings.units;
  const today = ymd();
  const from = rangeStart(range, today);
  const ci = Object.values(s.checkIns).filter(c => c.date >= from && c.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const data = ci.filter(c => c.calories != null || c.protein != null).map(c => {
    const t = targetFor(s.weeklyTargets, c.date);
    return { t: ts(c.date), date: c.date, kcal: c.calories, protein: c.protein, kcalTarget: t?.kcal, proteinTarget: t?.protein };
  });
  const ws = weightSeries(Object.values(s.checkIns));
  const weeks = [...new Set(data.map(p => weekStart(p.date)))].sort().reverse().map(w => {
    const inW = data.filter(p => weekStart(p.date) === w);
    const thisW = mean(ws.filter(p => weekStart(p.date) === w).map(p => p.value));
    const prevW = mean(ws.filter(p => weekStart(p.date) === addDays(w, -7)).map(p => p.value));
    return {
      w,
      kcal: mean(inW.map(p => p.kcal).filter((v): v is number => v != null)),
      protein: mean(inW.map(p => p.protein).filter((v): v is number => v != null)),
      change: thisW != null && prevW != null ? thisW - prevW : null,
      maintenance: s.weeklyTargets.find(t => t.weekStart === w)?.maintenance,
    };
  });
  const target = targetFor(s.weeklyTargets, today);

  if (!data.length) return <div className="card muted">Log protein (and calories if you can) each day and your intake shows up here.</div>;

  const chart = (key: 'protein' | 'kcal', tKey: 'proteinTarget' | 'kcalTarget', title: string, unit: string) => (
    <div className="card">
      <div className="row between"><h3 className="bold">{title}</h3><span className="muted small">{unit}</span></div>
      <div className="legend mt"><span style={{ ['--c' as string]: C1 }}>Logged</span><span style={{ ['--c' as string]: '#f4f6f8' }}>Weekly target</span></div>
      <div className="chart" style={{ height: 200 }}>
        <ResponsiveContainer>
          <ComposedChart data={data.filter(d => d[key] != null || d[tKey] != null)} margin={{ top: 16, right: 12, left: -4, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={d => fmtDate(d)} {...axisProps} minTickGap={24} />
            <YAxis {...axisProps} width={52} />
            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} content={<ChartTip fmt={(_, v) => `${v.toLocaleString()} ${unit}`} />} />
            <Bar dataKey={key} name={title} fill={C1} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            <Line dataKey={tKey} name="Target" type="stepAfter" stroke="#f4f6f8" strokeDasharray="6 4" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  return (
    <div className="stack">
      {target && (
        <div className="card tight accent small">
          This week: <b>{target.kcal.toLocaleString()} kcal</b> and <b>{target.protein}g protein</b>. Maintenance ~{target.maintenance.toLocaleString()} kcal ({target.method === 'adaptive' ? 'learned from your data' : target.method === 'trend' ? 'steered by your weight trend' : 'starting estimate'}).
        </div>
      )}
      {chart('protein', 'proteinTarget', 'Protein', 'g')}
      {chart('kcal', 'kcalTarget', 'Calories', 'kcal')}
      <h2 className="section-title">By week</h2>
      <div className="card tight">
        <table style={tableStyle}>
          <thead><tr><th align="left">Week of</th><th align="right">kcal</th><th align="right">Protein</th><th align="right">Weight Δ</th><th align="right">Maint.</th></tr></thead>
          <tbody>
            {weeks.map(w => (
              <tr key={w.w}>
                <td style={{ padding: '6px 0' }}>{fmtDate(w.w)}</td>
                <td align="right">{w.kcal != null ? Math.round(w.kcal).toLocaleString() : '—'}</td>
                <td align="right">{w.protein != null ? `${Math.round(w.protein)}g` : '—'}</td>
                <td align="right">{w.change != null ? `${w.change > 0 ? '+' : ''}${toUnit(w.change, u).toFixed(1)}` : '—'}</td>
                <td align="right">{w.maintenance != null ? w.maintenance.toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Muscles() {
  const s = useStore();
  const today = ymd();
  const [which, setWhich] = useState<'this' | 'last' | '7d'>('7d');
  const mon = weekStart(today);
  const [from, to] = which === 'this' ? [mon, today] : which === 'last' ? [addDays(mon, -7), addDays(mon, -1)] : [addDays(today, -6), today];
  const vol = setsPerMuscle(s.sessions, s.exercises(), from, to);
  const max = 24;
  return (
    <div className="stack">
      <div className="chips">
        {([['7d', 'Last 7 days'], ['this', 'This week'], ['last', 'Last week']] as const).map(([k, l]) => <button key={k} className={`chip ${which === k ? 'on' : ''}`} onClick={() => setWhich(k)}>{l}</button>)}
      </div>
      <div className="card stack" style={{ gap: 10 }}>
        <div className="row between"><h3 className="bold">Hard sets per muscle</h3><span className="tiny muted">shaded = target range</span></div>
        {TRACKED_MUSCLES.map(m => {
          const v = Math.round((vol[m] ?? 0) * 10) / 10;
          const [lo, hi] = volumeRange(m);
          const state = v < lo ? 'low' : v > hi ? 'high' : 'ok';
          return (
            <div key={m}>
              <div className="row between small"><span>{muscleLabel(m)}</span><span className="num bold">{v} <span className={`pill ${state === 'ok' ? 'good' : 'warn'}`} style={{ padding: '0 6px' }}>{state === 'ok' ? 'in range' : state}</span></span></div>
              <div style={{ position: 'relative', height: 10, background: 'var(--surface-2)', borderRadius: 5, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: `${(lo / max) * 100}%`, width: `${((hi - lo) / max) * 100}%`, top: 0, bottom: 0, background: 'rgba(255,255,255,0.08)' }} />
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, (v / max) * 100)}%`, background: C1, borderRadius: 5 }} />
              </div>
            </div>
          );
        })}
        <p className="tiny muted">Primary muscles count a full set, secondary muscles half. Aim for 10–20 hard sets (calves 8+, abs 6+). Deload weeks aren't counted.</p>
      </div>
    </div>
  );
}
