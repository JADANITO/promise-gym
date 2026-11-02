import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { useStore } from './data/store';
import './styles.css';

registerSW({ immediate: true });
if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore;
// Ask the browser not to evict our IndexedDB data under storage pressure.
void navigator.storage?.persist?.();

function Root() {
  const [ready, setReady] = useState(useStore.persist.hasHydrated());
  useEffect(() => {
    if (ready) return;
    return useStore.persist.onFinishHydration(() => setReady(true));
  }, [ready]);
  return ready ? <App /> : null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
