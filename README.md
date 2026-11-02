# Promise — progressive overload gym tracker

A mobile-first, offline-first PWA: live workouts with a rest timer, automatic double progression,
4-week+ gaining phases with deloads, daily weight and calorie check-ins, charts, and a weekly coach.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (also on your LAN IP for testing on a phone)
npm test           # progression / phase / goal-tracking unit tests
npm run build      # production build in dist/
```

## Put it on your phone

The app must be served over **HTTPS** to install and work offline. Deploy the `dist/` folder to any
static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages), open the URL on your phone, then
**Add to Home Screen** (Safari share menu on iPhone, browser menu on Android).

All data lives on the device (IndexedDB). Use **Settings → Export backup** regularly.

## Where things live

- `src/engine/progression.ts` — double progression rules (replayed from history, so edits recalculate)
- `src/engine/phases.ts` — phases, plateau analysis, deload prescription, rotation, break detection
- `src/engine/stats.ts` — moving average, goal on-track status, calorie adjustment
- `src/engine/coach.ts` / `aiCoach.ts` — weekly report (rules offline; Claude when an API key is set)
- `src/data/store.ts` — app state (zustand, persisted to IndexedDB)
- `src/screens/` — Home, Workouts, ActiveWorkout, Session, Analysis, Coach, Settings

## Notes and limits

- Reminders: a web app can only notify reliably while it's open. Settings can add daily weigh-in
  and calorie reminders to your phone calendar (.ics) for guaranteed alerts.
- Rest timer: it's timestamp-based, so it stays accurate if you lock the phone, and "keep screen on"
  is enabled by default. iOS may delay the end-of-rest alert while the screen is locked.
- AI coach: paste your own Anthropic API key in Settings. It's stored only on the device, sent only
  to Anthropic, and excluded from exports.
