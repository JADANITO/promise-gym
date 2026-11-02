import type { RoadmapStep } from '../engine/body';
import { fmtDate, parseYmd } from '../engine/dates';
import { useStore } from '../data/store';
import { fmtBw, fmtRateW } from '../format';

export const PHASE_COLOR = { bulk: '#3987e5', cut: '#d95926', maintain: '#9aa3ae', goal: '#c6f432' } as const;
const NAMES = { bulk: 'Lean bulk', cut: 'Lean cut', maintain: 'Maintenance', goal: 'Goal' } as const;

const monthYear = (d: string) => parseYmd(d).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

/** Vertical timeline of the simulated plan to the goal. */
export function Roadmap({ steps }: { steps: RoadmapStep[] }) {
  const units = useStore(s => s.settings.units);
  if (!steps.length) return <p className="muted small">Add your height, weight, waist and goal to see the roadmap.</p>;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {steps.map((s, i) => (
        <li key={i} style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 10, paddingBottom: i === steps.length - 1 ? 0 : 14, position: 'relative' }}>
          <span aria-hidden style={{ position: 'relative' }}>
            <span style={{ display: 'block', width: 14, height: 14, borderRadius: 7, background: PHASE_COLOR[s.type], marginTop: 3, border: '2px solid #15181d' }} />
            {i < steps.length - 1 && <span style={{ position: 'absolute', left: 6, top: 18, bottom: -14, width: 2, background: '#2a2f38' }} />}
          </span>
          <div>
            <div className="row between wrap">
              <b>{NAMES[s.type]}{i === 0 && s.type !== 'goal' ? ' (now)' : ''}</b>
              <span className="small muted">{s.type === 'goal' ? monthYear(s.startDate) : `${fmtDate(s.startDate, { month: 'short', year: '2-digit' })} → ${fmtDate(s.endDate, { month: 'short', year: '2-digit' })}`}</span>
            </div>
            <div className="small num">
              {s.type === 'goal'
                ? <>~{fmtBw(s.endWeight, units)} at ~{s.endBf}% body fat</>
                : <>{fmtBw(s.startWeight, units)} → {fmtBw(s.endWeight, units)} · {s.startBf}% → {s.endBf}% · {s.weeks} wks{s.rate ? ` · ${fmtRateW(s.rate, units)}` : ''}</>}
            </div>
            <div className="tiny muted">{s.note}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
