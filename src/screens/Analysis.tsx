import { useMemo, useState, type ReactNode } from 'react';
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useStore } from '../data/store';
import { achievedReps, computeProgress, e1rm } from '../engine/progression';
import { addDays, fmtDate, parseYmd, weekStart, ymd } from '../engine/dates';
import { goalProgress, mean, movingAverage, weights as weightSeries, calories as calorieSeries, fmtRate } from '../engine/stats';
import { toUnit } from '../format';
import { statusLabel } from './Home';

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

export function AnalysisScreen() {
  const [tab, setTab] = useState<'strength' | 'body' | 'kcal'>('strength');
  const [range, setRange] = useState<Range>('12w');
  return (
    <div className="stack">
      <h1 className="page-title">Progress</h1>
      <div className="tabs">
        <button className={tab === 'strength' ? 'on' : ''} onClick={() => setTab('strength')}>Strength</button>
        <button className={tab === 'body' ? 'on' : ''} onClick={() => setTab('body')}>Bodyweight</button>
        <button className={tab === 'kcal' ? 'on' : ''} onClick={() => setTab('kcal')}>Calories</button>
      </div>
      <div className="chips">
        {RANGES.map(([k, l]) => <button key={k} className={`chip ${range === k ? 'on' : ''}`} onClick={() => setRange(k)}>{l}</button>)}
      </div>
      {tab === 'strength' && <Strength range={range} />}
      {tab === 'body' && <Bodyweight range={range} />}
      {tab === 'kcal' && <Calories range={range} />}
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

function Bodyweight({ range }: { range: Range }) {
  const checkIns = useStore(s => s.checkIns);
  const goals = useStore(s => s.goals);
  const phase = useStore(s => s.phases.find(p => p.status === 'active'));
  const u = useStore(s => s.settings.units);
  const today = ymd();
  const from = rangeStart(range, today);
  const all = weightSeries(Object.values(checkIns));
  const ma = movingAverage(all);
  const gp = goalProgress(Object.values(checkIns), goals, today);

  const data = all.filter(p => p.date >= from).map(p => ({
    t: ts(p.date), date: p.date,
    daily: toUnit(p.value, u),
    avg: toUnit(ma.find(m => m.date === p.date)!.value, u),
  }));
  const goalW = goals.goalWeight != null && goals.direction !== 'maintain' ? toUnit(goals.goalWeight, u) : null;
  // Show the pace needed to reach the goal over the next 4 weeks (projecting all the way to the goal date squashes the real data).
  const projection: { t: number; pace: number }[] = [];
  if (gp.current != null && gp.neededPerWeek != null && goalW != null && goals.goalDate && goals.goalDate > today) {
    const end = goals.goalDate < addDays(today, 28) ? goals.goalDate : addDays(today, 28);
    const weeks = (ts(end) - ts(today)) / (7 * 86_400_000);
    projection.push({ t: ts(today), pace: toUnit(gp.current, u) }, { t: ts(end), pace: +toUnit(gp.current + gp.neededPerWeek * weeks, u).toFixed(1) });
  }
  const rows: { t: number; date?: string; daily?: number; avg?: number; pace?: number }[] = [...data];
  for (const p of projection) {
    const hit = rows.find(r => r.t === p.t);
    if (hit) hit.pace = p.pace; else rows.push(p);
  }
  rows.sort((a, b) => a.t - b.t);
  const tMin = rows[0]?.t ?? 0, tMax = rows[rows.length - 1]?.t ?? 0;
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round(tMin + ((tMax - tMin) * i) / 4));

  const avgOf = (fromD: string, toD: string) => mean(all.filter(p => p.date >= fromD && p.date <= toD).map(p => p.value));
  const thisWk = avgOf(addDays(today, -6), today);
  const lastWk = avgOf(addDays(today, -13), addDays(today, -7));
  const phaseStart = phase ? avgOf(phase.startDate, addDays(phase.startDate, 6)) : null;
  const fmtChange = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${toUnit(v, u).toFixed(1)}${u}`);

  if (!all.length) return <div className="card muted">Log your weight each morning and your trend shows up here.</div>;

  return (
    <div className="stack">
      <div className="card">
        <div className="row between"><h3 className="bold">Bodyweight</h3><span className="muted small">{u}</span></div>
        <div className="legend mt">
          <span style={{ ['--c' as string]: C1 }}>Daily weigh-in</span>
          <span style={{ ['--c' as string]: C2 }}>7-day average</span>
          {projection.length > 0 && <span style={{ ['--c' as string]: INK }}>Needed pace</span>}
        </div>
        <div className="chart">
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 16, right: 16, left: -12, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={[tMin, tMax]} ticks={ticks} tickFormatter={tick} {...axisProps} />
              <YAxis {...axisProps} domain={[(min: number) => Math.floor(min - 1), (max: number) => Math.ceil(max + 1)]} allowDecimals={false} width={48} />
              <Tooltip cursor={{ stroke: INK, strokeDasharray: '3 3' }} content={<ChartTip fmt={(_, v) => `${v}${u}`} />} />
              {goalW != null && <ReferenceLine y={goalW} ifOverflow="extendDomain" stroke="#f4f6f8" strokeDasharray="6 4" label={{ value: `Goal ${goalW}${u}`, fill: '#f4f6f8', fontSize: 12, position: 'insideBottomLeft' }} />}
              <Scatter data={rows.filter(r => r.daily != null)} dataKey="daily" name="Daily" fill={C1} shape={(p: { cx?: number; cy?: number }) => <circle cx={p.cx} cy={p.cy} r={4} fill={C1} stroke="#15181d" strokeWidth={2} />} isAnimationActive={false} />
              <Line dataKey="avg" name="7-day avg" stroke={C2} strokeWidth={2} dot={false} type="monotone" connectNulls isAnimationActive={false} />
              {projection.length > 0 && <Line dataKey="pace" name="Needed pace" stroke={INK} strokeDasharray="4 4" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <TableToggle>
          <table style={tableStyle}><thead><tr><th align="left">Date</th><th align="right">Weight</th><th align="right">7-day avg</th></tr></thead>
            <tbody>{[...data].reverse().map(p => <tr key={p.date}><td>{fmtDate(p.date)}</td><td align="right">{p.daily}</td><td align="right">{p.avg.toFixed(1)}</td></tr>)}</tbody>
          </table>
        </TableToggle>
      </div>
      <div className="stats">
        <div className="stat"><div className="v">{fmtChange(thisWk != null && lastWk != null ? thisWk - lastWk : null)}</div><div className="l">This week</div></div>
        <div className="stat"><div className="v">{fmtChange(thisWk != null && phaseStart != null ? thisWk - phaseStart : null)}</div><div className="l">This phase</div></div>
        <div className="stat"><div className="v" style={{ fontSize: 16 }}>{gp.neededPerWeek != null ? fmtRate(gp.neededPerWeek) : '—'}</div><div className="l">Rate needed</div></div>
      </div>
      {gp.status !== 'unknown' && (
        <div className="card tight row">
          <span className={`pill ${['on-track', 'ahead', 'reached'].includes(gp.status) ? 'good' : 'warn'}`}>{statusLabel(gp.status)}</span>
          <span className="small grow">{gp.advice}</span>
        </div>
      )}
    </div>
  );
}

function Calories({ range }: { range: Range }) {
  const checkIns = useStore(s => s.checkIns);
  const target = useStore(s => s.goals.calorieTarget);
  const u = useStore(s => s.settings.units);
  const today = ymd();
  const from = rangeStart(range, today);
  const kc = calorieSeries(Object.values(checkIns)).filter(p => p.date >= from);
  const data = kc.map(p => ({ t: ts(p.date), date: p.date, kcal: p.value }));
  const onTarget = target ? kc.filter(p => Math.abs(p.value - target) <= target * 0.1).length : 0;
  const ws = weightSeries(Object.values(checkIns));

  // Weekly view: average calories next to that week's change in average bodyweight.
  const weeks = [...new Set(kc.map(p => weekStart(p.date)))].sort().reverse().map(w => {
    const avg = mean(kc.filter(p => weekStart(p.date) === w).map(p => p.value));
    const thisW = mean(ws.filter(p => weekStart(p.date) === w).map(p => p.value));
    const prevW = mean(ws.filter(p => weekStart(p.date) === addDays(w, -7)).map(p => p.value));
    return { w, avg, change: thisW != null && prevW != null ? thisW - prevW : null };
  });

  if (!kc.length) return <div className="card muted">Log your calories each day and your intake shows up here.</div>;

  return (
    <div className="stack">
      <div className="card">
        <div className="row between"><h3 className="bold">Daily calories</h3><span className="muted small">kcal</span></div>
        <div className="chart">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 16, right: 12, left: -4, bottom: 0 }} barCategoryGap={2}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tickFormatter={d => fmtDate(d)} {...axisProps} minTickGap={24} />
              <YAxis {...axisProps} width={52} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} content={<ChartTip fmt={(_, v) => `${v.toLocaleString()} kcal`} />} />
              <Bar dataKey="kcal" name="Calories" fill={C1} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              {target && <ReferenceLine y={target} stroke="#f4f6f8" strokeDasharray="6 4" ifOverflow="extendDomain" label={{ value: `Target ${target.toLocaleString()}`, fill: '#f4f6f8', fontSize: 12, position: 'insideTopRight' }} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <TableToggle>
          <table style={tableStyle}><thead><tr><th align="left">Date</th><th align="right">kcal</th></tr></thead>
            <tbody>{[...kc].reverse().map(p => <tr key={p.date}><td>{fmtDate(p.date)}</td><td align="right">{p.value.toLocaleString()}</td></tr>)}</tbody>
          </table>
        </TableToggle>
      </div>
      <div className="stats">
        <div className="stat"><div className="v">{Math.round(mean(kc.slice(-7).map(p => p.value)) ?? 0).toLocaleString()}</div><div className="l">Last 7 days avg</div></div>
        <div className="stat"><div className="v">{target ? onTarget : '—'}</div><div className="l">Days on target (±10%)</div></div>
        <div className="stat"><div className="v">{target ? kc.length - onTarget : '—'}</div><div className="l">Days off target</div></div>
      </div>
      <h2 className="section-title">Calories vs bodyweight, by week</h2>
      <div className="card tight">
        <table style={tableStyle}>
          <thead><tr><th align="left">Week of</th><th align="right">Avg kcal</th><th align="right">Weight change</th></tr></thead>
          <tbody>
            {weeks.map(w => (
              <tr key={w.w}>
                <td style={{ padding: '6px 0' }}>{fmtDate(w.w)}</td>
                <td align="right">{w.avg != null ? Math.round(w.avg).toLocaleString() : '—'}</td>
                <td align="right">{w.change != null ? `${w.change > 0 ? '+' : ''}${toUnit(w.change, u).toFixed(1)}${u}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
