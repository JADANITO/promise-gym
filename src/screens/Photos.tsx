import { useState } from 'react';
import { useStore } from '../data/store';
import { fmtDate } from '../engine/dates';
import { PhotoThumb } from './WeeklyCheckIn';
import type { Photo } from '../types';

/** Side-by-side progress photo comparison. */
export function PhotosScreen({ go }: { go: (r: string) => void }) {
  const photos = useStore(s => s.photos);
  const del = useStore(s => s.deletePhoto);
  const [pose, setPose] = useState<Photo['pose']>('front');
  const list = photos.filter(p => p.pose === pose).sort((a, b) => a.date.localeCompare(b.date));
  const [aId, setA] = useState<string>();
  const [bId, setB] = useState<string>();
  const a = list.find(p => p.id === aId) ?? list[0];
  const b = list.find(p => p.id === bId) ?? list[list.length - 1];

  return (
    <div className="stack">
      <div className="row between">
        <button className="btn ghost sm" onClick={() => go('progress')}>‹ Back</button>
      </div>
      <h1 className="page-title">Progress photos</h1>
      <div className="tabs">
        {(['front', 'side', 'back'] as Photo['pose'][]).map(p => (
          <button key={p} className={pose === p ? 'on' : ''} onClick={() => { setPose(p); setA(undefined); setB(undefined); }}>{p[0].toUpperCase() + p.slice(1)}</button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="card muted">No {pose} photos yet — add them at your Sunday check-in.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[a, b].map((p, i) => (
              <div key={i} className="stack" style={{ gap: 6 }}>
                <PhotoThumb id={p.id} />
                <select className="input" value={p.id} onChange={e => (i === 0 ? setA : setB)(e.target.value)} aria-label={i === 0 ? 'Before photo' : 'After photo'}>
                  {list.map(x => <option key={x.id} value={x.id}>{fmtDate(x.date, { day: 'numeric', month: 'short', year: '2-digit' })}</option>)}
                </select>
              </div>
            ))}
          </div>
          <h2 className="section-title">All {pose} photos</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[...list].reverse().map(p => (
              <div key={p.id} className="stack" style={{ gap: 4 }}>
                <PhotoThumb id={p.id} />
                <div className="row between tiny"><span className="muted">{fmtDate(p.date)}</span>
                  <button className="btn ghost sm" style={{ minHeight: 28, padding: '0 6px' }} aria-label="Delete photo" onClick={() => { if (confirm('Delete this photo?')) void del(p.id); }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
