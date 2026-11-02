import { useCallback, useEffect, useState } from 'react';
import { useStore } from './data/store';
import { Icon } from './components/ui';
import { Home } from './screens/Home';
import { TemplateEditor, WorkoutList } from './screens/Workouts';
import { ActiveWorkout } from './screens/ActiveWorkout';
import { SessionDetail, StartWorkout, Summary } from './screens/Session';
import { AnalysisScreen } from './screens/Analysis';
import { CoachScreen, generateReport } from './screens/Coach';
import { Onboarding, SettingsScreen } from './screens/Settings';
import { addDays, minutesOf, ymd } from './engine/dates';
import { notify } from './alerts';

function useHashRoute(): [string, (r: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '') || 'home';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r: string) => {
    if (read() === r) return;
    window.location.hash = `/${r}`;
    window.scrollTo(0, 0);
  }, []);
  return [route, go];
}

/** Daily housekeeping: phase transitions, reminders, and the weekly coach report. */
function useBackgroundChecks() {
  useEffect(() => {
    const check = async () => {
      const s = useStore.getState();
      s.tickPhases();
      const now = new Date();
      const today = ymd(now);
      const min = now.getHours() * 60 + now.getMinutes();
      const ci = s.checkIns[today];

      if (min >= minutesOf(s.settings.weighInTime) && ci?.bodyweight == null && s.notified.weight !== today) {
        s.markNotified('weight', today);
        void notify('Good morning — log your weight', 'One tap to keep your goal on track.', 'weigh-in');
      }
      if (min >= minutesOf(s.settings.caloriesTime) && ci?.calories == null && s.notified.calories !== today) {
        s.markNotified('calories', today);
        void notify('How many calories today?', 'Log it before bed — it takes five seconds.', 'calories');
      }
      const weekOf = addDays(today, -6);
      const due = now.getDay() === s.settings.coachDay && min >= minutesOf(s.settings.coachTime);
      if (due && !s.reports.some(r => r.weekStart === weekOf) && s.notified.coach !== today) {
        s.markNotified('coach', today);
        try {
          await generateReport();
          void notify('Your weekly coach report is ready', 'See what to change for the week ahead.', 'coach');
        } catch { /* try again next open */ }
      }
    };
    void check();
    const t = setInterval(check, 60_000);
    const onVis = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);
}

const TABS: { id: string; label: string; icon: Parameters<typeof Icon>[0]['name']; match: (r: string) => boolean }[] = [
  { id: 'home', label: 'Home', icon: 'home', match: r => r === 'home' },
  { id: 'workouts', label: 'Workouts', icon: 'dumbbell', match: r => /^(workouts|edit|session|start|summary)/.test(r) },
  { id: 'progress', label: 'Progress', icon: 'chart', match: r => r === 'progress' },
  { id: 'coach', label: 'Coach', icon: 'coach', match: r => r === 'coach' },
  { id: 'settings', label: 'Settings', icon: 'settings', match: r => r === 'settings' },
];

export default function App() {
  const [route, go] = useHashRoute();
  const onboarded = useStore(s => s.settings.onboarded);
  const active = useStore(s => !!s.active);
  useBackgroundChecks();

  if (!onboarded) return <div className="app"><Onboarding /></div>;

  const [head, arg] = [route.split('/')[0], route.split('/').slice(1).join('/')];
  const inWorkout = head === 'workout' && active;

  let screen;
  switch (head) {
    case 'workouts': screen = <WorkoutList go={go} />; break;
    case 'edit': screen = <TemplateEditor key={arg} id={arg} go={go} />; break;
    case 'start': screen = <StartWorkout templateId={arg} go={go} />; break;
    case 'workout': screen = active ? <ActiveWorkout go={go} /> : <Home go={go} />; break;
    case 'summary': screen = <Summary id={arg} go={go} />; break;
    case 'session': screen = <SessionDetail key={arg} id={arg} go={go} />; break;
    case 'progress': screen = <AnalysisScreen />; break;
    case 'coach': screen = <CoachScreen />; break;
    case 'settings': screen = <SettingsScreen go={go} />; break;
    default: screen = <Home go={go} />;
  }

  return (
    <>
      <div className={`app ${inWorkout ? 'workout' : ''}`}>
        {active && !inWorkout && (
          <button className="btn primary block" style={{ marginBottom: 12 }} onClick={() => go('workout')}>Workout in progress — tap to resume</button>
        )}
        {screen}
      </div>
      {!inWorkout && (
        <nav className="nav" aria-label="Main">
          <div className="nav-inner">
            {TABS.map(t => (
              <button key={t.id} className={t.match(head) ? 'on' : ''} onClick={() => go(t.id)} aria-current={t.match(head) ? 'page' : undefined}>
                <Icon name={t.icon} />{t.label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </>
  );
}
