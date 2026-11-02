import { useState } from 'react';
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../data/store';
import type { TemplateExercise, WorkoutTemplate } from '../types';
import { ExercisePicker, NumberField, WeightInput } from '../components/ui';
import { fmtW, uid } from '../format';
import { fmtDate, ymd } from '../engine/dates';

export function WorkoutList({ go }: { go: (r: string) => void }) {
  const templates = useStore(s => s.templates);
  const sessions = useStore(s => s.sessions);
  const name = useStore(s => s.exerciseName);
  const duplicate = useStore(s => s.duplicateTemplate);
  const units = useStore(s => s.settings.units);
  const recent = [...sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, 15);

  return (
    <div className="stack">
      <div className="row between">
        <h1 className="page-title">Workouts</h1>
        <button className="btn primary sm" onClick={() => go('edit/new')}>+ New</button>
      </div>
      {templates.length === 0 && (
        <div className="card center stack">
          <p className="bold">No workouts yet</p>
          <p className="muted small">Create your first workout, e.g. “Push Day”, and add the exercises you do.</p>
          <button className="btn primary" onClick={() => go('edit/new')}>Create a workout</button>
        </div>
      )}
      {templates.map(t => (
        <div key={t.id} className="card stack">
          <div className="row between">
            <div className="grow">
              <h3 className="bold">{t.name}</h3>
              <p className="muted small">{t.exercises.length} exercises · {t.exercises.reduce((n, e) => n + e.sets, 0)} sets</p>
            </div>
          </div>
          <p className="small muted">{t.exercises.map(e => name(e.exerciseId)).join(' · ') || 'No exercises'}</p>
          <div className="row wrap">
            <button className="btn primary sm" disabled={!t.exercises.length} onClick={() => go(`start/${t.id}`)}>Start</button>
            <button className="btn sm" onClick={() => go(`edit/${t.id}`)}>Edit</button>
            <button className="btn sm" onClick={() => duplicate(t.id)}>Duplicate</button>
          </div>
        </div>
      ))}

      {recent.length > 0 && <h2 className="section-title">History</h2>}
      {recent.map(s => (
        <button key={s.id} className="list-item" onClick={() => go(`session/${s.id}`)}>
          <div className="grow">
            <div className="bold">{s.templateName} {s.deload && <span className="pill deload">DELOAD</span>} {s.partial && <span className="pill">partial</span>}</div>
            <div className="muted small">
              {fmtDate(ymd(s.startedAt), { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
              {s.exercises.filter(e => !e.skipped).map(e => `${name(e.exerciseId)} ${fmtW(e.workingWeight, units)}`).slice(0, 2).join(', ')}
            </div>
          </div>
          <span className="muted">›</span>
        </button>
      ))}
    </div>
  );
}

function blankExercise(exerciseId: string, restSec: number): TemplateExercise {
  return { id: uid(), exerciseId, sets: 3, repMin: 10, repMax: 12, restSec, startWeight: 20, warmupSets: 0 };
}

export function TemplateEditor({ id, go }: { id: string; go: (r: string) => void }) {
  const existing = useStore(s => s.templates.find(t => t.id === id));
  const save = useStore(s => s.saveTemplate);
  const del = useStore(s => s.deleteTemplate);
  const name = useStore(s => s.exerciseName);
  const restDefault = useStore(s => s.settings.defaultRestSec);
  const [draft, setDraft] = useState<WorkoutTemplate>(() => existing ? structuredClone(existing) : { id: uid(), name: '', exercises: [] });
  const [picking, setPicking] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }));

  const patch = (exId: string, p: Partial<TemplateExercise>) =>
    setDraft(d => ({ ...d, exercises: d.exercises.map(e => (e.id === exId ? { ...e, ...p } : e)) }));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setDraft(d => {
      const from = d.exercises.findIndex(x => x.id === e.active.id);
      const to = d.exercises.findIndex(x => x.id === e.over!.id);
      return { ...d, exercises: arrayMove(d.exercises, from, to) };
    });
  };

  const valid = draft.name.trim() && draft.exercises.every(e => e.repMin > 0 && e.repMax >= e.repMin && e.sets > 0);

  return (
    <div className="stack">
      <div className="row between">
        <button className="btn ghost sm" onClick={() => go('workouts')}>‹ Back</button>
        <button className="btn primary sm" disabled={!valid} onClick={() => { save({ ...draft, name: draft.name.trim() }); go('workouts'); }}>Save</button>
      </div>
      <div className="field">
        <label htmlFor="tname">Workout name</label>
        <input id="tname" className="input" placeholder="e.g. Push Day" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
      </div>
      <p className="muted small">Drag ⋮⋮ to reorder. Changes apply to future sessions only — your history is never rewritten.</p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={draft.exercises.map(e => e.id)} strategy={verticalListSortingStrategy}>
          {draft.exercises.map(e => (
            <SortableExercise key={e.id} ex={e} title={name(e.exerciseId)} onPatch={p => patch(e.id, p)}
              onRemove={() => setDraft(d => ({ ...d, exercises: d.exercises.filter(x => x.id !== e.id) }))} />
          ))}
        </SortableContext>
      </DndContext>

      <button className="btn block" onClick={() => setPicking(true)}>+ Add exercise</button>
      {existing && (
        <button className="btn danger ghost block" onClick={() => { if (confirm(`Delete “${existing.name}”? Past sessions are kept.`)) { del(existing.id); go('workouts'); } }}>
          Delete workout
        </button>
      )}
      <ExercisePicker open={picking} onClose={() => setPicking(false)} onPick={exId => {
        setDraft(d => ({ ...d, exercises: [...d.exercises, blankExercise(exId, restDefault)] }));
        setPicking(false);
      }} />
    </div>
  );
}

function SortableExercise({ ex, title, onPatch, onRemove }: { ex: TemplateExercise; title: string; onPatch: (p: Partial<TemplateExercise>) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ex.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.7 : 1, zIndex: isDragging ? 5 : undefined, position: 'relative' as const };
  const badRange = ex.repMax < ex.repMin;
  return (
    <div ref={setNodeRef} style={style} className="card stack">
      <div className="row">
        <button className="drag-handle" aria-label="Drag to reorder" {...attributes} {...listeners}>⋮⋮</button>
        <h3 className="bold grow">{title}</h3>
        <button className="icon-btn" aria-label={`Remove ${title}`} onClick={onRemove}>✕</button>
      </div>
      <div className="row">
        <div className="field grow"><label>Sets</label><NumberField value={ex.sets} min={1} onChange={n => onPatch({ sets: n ?? 1 })} /></div>
        <div className="field grow"><label>Reps min</label><NumberField value={ex.repMin} min={1} onChange={n => onPatch({ repMin: n ?? 1 })} /></div>
        <div className="field grow"><label>Reps max</label><NumberField value={ex.repMax} min={1} onChange={n => onPatch({ repMax: n ?? 1 })} /></div>
      </div>
      {badRange && <p className="small" style={{ color: 'var(--bad)' }}>Max reps must be at least min reps.</p>}
      <div className="row">
        <div className="field grow"><label>Rest</label><NumberField value={ex.restSec} suffix="sec" onChange={n => onPatch({ restSec: n ?? 60 })} /></div>
        <div className="field grow"><label>Warm-up sets</label><NumberField value={ex.warmupSets ?? 0} onChange={n => onPatch({ warmupSets: n ?? 0 })} /></div>
      </div>
      <div className="field"><label>Starting weight (used until you've logged it once)</label><WeightInput kg={ex.startWeight} onChange={kg => onPatch({ startWeight: kg ?? 0 })} /></div>
      <div className="field"><label>Machine / equipment note</label><input className="input" placeholder="e.g. Hammer Strength, seat 4" value={ex.machineNote ?? ''} onChange={e => onPatch({ machineNote: e.target.value || undefined })} /></div>
    </div>
  );
}
