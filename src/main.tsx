import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { useStore } from './data/store';
import { unlockAudio } from './alerts';
import './styles.css';

registerSW({ immediate: true });
// Any tap wakes the sound player, so the rest beep isn't lost after the screen locked or music changed.
document.addEventListener('pointerdown', unlockAudio, { capture: true });
if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore;
// Ask the browser not to evict our IndexedDB data under storage pressure.
void navigator.storage?.persist?.();

/** Shown instead of a black screen when something crashes or the saved data won't open. */
function Rescue({ title, detail, onHome }: { title: string; detail?: string; onHome?: () => void }) {
  const hasWorkout = !!useStore.getState().active;
  const [askCancel, setAskCancel] = useState(false);
  return (
    <div className="app stack">
      <h2 className="bold" style={{ fontSize: 22 }}>{title}</h2>
      <p className="muted">Your data is safe. Try these in order.</p>
      {onHome && <button className="btn primary big block" onClick={onHome}>Back to Home</button>}
      <button className="btn block" onClick={() => location.reload()}>Reload the app</button>
      {hasWorkout && onHome && (askCancel ? (
        <div className="row">
          <button className="btn danger grow" onClick={() => { useStore.getState().discardWorkout(); onHome(); }}>Yes, drop it</button>
          <button className="btn grow" onClick={() => setAskCancel(false)}>No</button>
        </div>
      ) : (
        <button className="btn ghost block" onClick={() => setAskCancel(true)}>Still broken? Drop this workout</button>
      ))}
      {detail && <p className="small muted" style={{ wordBreak: 'break-word', userSelect: 'text' }}>Error: {detail}</p>}
    </div>
  );
}

class Guard extends Component<{ children: ReactNode }, { error?: Error; key: number }> {
  state: { error?: Error; key: number } = { key: 0 };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return <div key={this.state.key} style={{ display: 'contents' }}>{this.props.children}</div>;
    const home = () => { location.hash = '#/home'; this.setState(s => ({ error: undefined, key: s.key + 1 })); };
    return <Rescue title="Something went wrong on this screen" detail={this.state.error.message} onHome={home} />;
  }
}

function Root() {
  const [ready, setReady] = useState(useStore.persist.hasHydrated());
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setStuck(true), 6000);
    const off = useStore.persist.onFinishHydration(() => setReady(true));
    return () => { clearTimeout(t); off(); };
  }, [ready]);
  if (ready) return <Guard><App /></Guard>;
  return stuck ? <Rescue title="Your data is taking too long to open" detail="Close the app fully (swipe it away) and open it again." /> : null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
