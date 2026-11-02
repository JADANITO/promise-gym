import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../data/store';
import { fromUnit, toUnit } from '../format';

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

/** Weight input that shows and accepts the user's units but reports kg. */
export function WeightInput({ kg, onChange, autoFocus, id }: { kg: number | undefined; onChange: (kg: number | undefined) => void; autoFocus?: boolean; id?: string }) {
  const units = useStore(s => s.settings.units);
  const [text, setText] = useState(kg == null ? '' : String(toUnit(kg, units)));
  useEffect(() => {
    const current = text === '' ? undefined : fromUnit(parseFloat(text), units);
    if (kg == null ? text !== '' : current == null || Math.abs(current - kg) > 0.01) setText(kg == null ? '' : String(toUnit(kg, units)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kg, units]);
  return (
    <div className="row">
      <input
        id={id}
        className="input num"
        inputMode="decimal"
        autoFocus={autoFocus}
        value={text}
        placeholder="0"
        onChange={e => {
          const v = e.target.value.replace(',', '.');
          setText(v);
          const n = parseFloat(v);
          onChange(isNaN(n) ? undefined : fromUnit(n, units));
        }}
      />
      <span className="muted bold">{units}</span>
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => exercises(), [custom]);
  const filtered = all.filter(e => e.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = all.some(e => e.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <Sheet open={open} onClose={onClose} title="Choose exercise">
      <input className="input" placeholder="Search or type a new exercise" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      {q.trim() && !exact && (
        <button className="btn primary block mt" onClick={() => { onPick(addCustom(q).id); setQ(''); }}>
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
