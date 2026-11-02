import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../data/store';
import { MUSCLES } from '../data/library';
import type { Muscle } from '../types';
import { fromLen, fromUnit, toLen, toUnit } from '../format';

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

/** Numeric input shown in display units but reporting a base unit (kg or cm). */
function UnitInput({ value, onChange, to, from, suffix, autoFocus, id, placeholder = '0' }: {
  value: number | undefined; onChange: (v: number | undefined) => void; to: (v: number) => number; from: (v: number) => number;
  suffix: string; autoFocus?: boolean; id?: string; placeholder?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(to(value)));
  useEffect(() => {
    const current = text === '' ? undefined : from(parseFloat(text));
    if (value == null ? text !== '' : current == null || Math.abs(current - value) > 0.01) setText(value == null ? '' : String(to(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, suffix]);
  return (
    <div className="row">
      <input
        id={id}
        className="input num"
        inputMode="decimal"
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        onChange={e => {
          const v = e.target.value.replace(',', '.');
          setText(v);
          const n = parseFloat(v);
          onChange(isNaN(n) ? undefined : from(n));
        }}
      />
      <span className="muted bold">{suffix}</span>
    </div>
  );
}

/** Weight input that shows and accepts the user's units but reports kg. */
export function WeightInput({ kg, onChange, autoFocus, id, placeholder }: { kg: number | undefined; onChange: (kg: number | undefined) => void; autoFocus?: boolean; id?: string; placeholder?: string }) {
  const units = useStore(s => s.settings.units);
  return <UnitInput value={kg} onChange={onChange} to={v => toUnit(v, units)} from={v => fromUnit(v, units)} suffix={units} autoFocus={autoFocus} id={id} placeholder={placeholder} />;
}

/** Length input (waist etc.) in inches or cm, reporting cm. */
export function LengthInput({ cm, onChange, autoFocus, id, placeholder }: { cm: number | undefined; onChange: (cm: number | undefined) => void; autoFocus?: boolean; id?: string; placeholder?: string }) {
  const units = useStore(s => s.settings.lengthUnits);
  return <UnitInput value={cm} onChange={onChange} to={v => toLen(v, units)} from={v => fromLen(v, units)} suffix={units === 'in' ? 'in' : 'cm'} autoFocus={autoFocus} id={id} placeholder={placeholder} />;
}

/** 1–5 rating chips. */
export function Rating({ value, onChange, low, high }: { value: number | undefined; onChange: (v: number) => void; low: string; high: string }) {
  return (
    <div>
      <div className="chips">
        {[1, 2, 3, 4, 5].map(v => <button key={v} className={`chip ${value === v ? 'on' : ''}`} style={{ minWidth: 48 }} onClick={() => onChange(v)}>{v}</button>)}
      </div>
      <div className="row between tiny muted mt"><span>{low}</span><span>{high}</span></div>
    </div>
  );
}

export function NumberField({ value, onChange, suffix, step = 1, min = 0, id }: { value: number | undefined; onChange: (n: number | undefined) => void; suffix?: string; step?: number; min?: number; id?: string }) {
  return (
    <div className="row">
      <input
        id={id}
        className="input num"
        inputMode={step < 1 ? 'decimal' : 'numeric'}
        value={value ?? ''}
        onChange={e => {
          const n = parseFloat(e.target.value.replace(',', '.'));
          onChange(isNaN(n) ? undefined : Math.max(min, n));
        }}
      />
      {suffix && <span className="muted bold">{suffix}</span>}
    </div>
  );
}

export function ExercisePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (exerciseId: string) => void }) {
  const exercises = useStore(s => s.exercises);
  const custom = useStore(s => s.customExercises);
  const addCustom = useStore(s => s.addCustomExercise);
  const [q, setQ] = useState('');
  const [muscles, setMuscles] = useState<Muscle[] | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => exercises(), [custom]);
  const filtered = all.filter(e => e.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = all.some(e => e.name.toLowerCase() === q.trim().toLowerCase());
  if (muscles) {
    return (
      <Sheet open={open} onClose={() => { setMuscles(null); onClose(); }} title={`“${q.trim()}” works…`}>
        <p className="muted small">Pick the main muscles so your weekly volume counts it.</p>
        <div className="chips mt">
          {MUSCLES.map(m => (
            <button key={m.id} className={`chip ${muscles.includes(m.id) ? 'on' : ''}`} onClick={() => setMuscles(muscles.includes(m.id) ? muscles.filter(x => x !== m.id) : [...muscles, m.id])}>{m.label}</button>
          ))}
        </div>
        <button className="btn primary block mt2" onClick={() => { onPick(addCustom(q, muscles).id); setQ(''); setMuscles(null); }}>Add exercise</button>
      </Sheet>
    );
  }
  return (
    <Sheet open={open} onClose={onClose} title="Choose exercise">
      <input className="input" placeholder="Search or type a new exercise" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      {q.trim() && !exact && (
        <button className="btn primary block mt" onClick={() => setMuscles([])}>
          + Add “{q.trim()}”
        </button>
      )}
      <div className="mt">
        {filtered.map(e => (
          <button key={e.id} className="list-item" onClick={() => { onPick(e.id); setQ(''); }}>
            <span className="grow">{e.name}</span>
            {e.custom && <span className="pill">custom</span>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function Toast({ text, onDone }: { text: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [text, onDone]);
  return text ? <div className="toast" role="status">{text}</div> : null;
}

const paths: Record<string, ReactNode> = {
  home: <path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />,
  dumbbell: <><path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  coach: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
};

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[name]}
    </svg>
  );
}
