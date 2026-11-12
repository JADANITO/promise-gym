// Sound, vibration and system notifications. All best-effort: browsers differ in what they allow.

let ctx: AudioContext | null = null;
const ICON = `${import.meta.env.BASE_URL}icon-192.png`;

/**
 * Wakes the sound player. Phones put it to sleep when the screen locks, when music starts or stops, or after a
 * while; asleep, a beep plays into nothing. Called on every tap (see main.tsx), which is when phones allow it.
 */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state !== 'running') void ctx.resume().catch(() => { /* not allowed yet */ });
  } catch { /* no audio */ }
}

/** Three beeps, `delaySec` from now on the sound player's own clock. Returns the tones so they can be cancelled. */
function tones(c: AudioContext, times: number, delaySec: number): OscillatorNode[] {
  const start = c.currentTime + 0.05 + Math.max(0, delaySec);
  const out: OscillatorNode[] = [];
  for (let i = 0; i < times; i++) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, start + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.25, start + i * 0.35 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + i * 0.35 + 0.25);
    o.connect(g).connect(c.destination);
    o.start(start + i * 0.35);
    o.stop(start + i * 0.35 + 0.3);
    out.push(o);
  }
  return out;
}

/** Beep now. Wakes the sound player first if it fell asleep, instead of playing into nothing. */
export function beep(times = 3) {
  try {
    ctx ??= new AudioContext();
    const c = ctx;
    if (c.state === 'running') { tones(c, times, 0); return; }
    void c.resume().then(() => { tones(c, times, 0); }).catch(() => { /* not allowed without a tap */ });
  } catch { /* no audio */ }
}

/**
 * Book the end-of-rest beep ahead, on the sound player's clock: it plays on time even when the page's own timers
 * are slowed down. Returns a cancel function, or null if sound isn't on (the timer's own beep is the fallback).
 */
export function bookBeep(atMs: number, times = 3): (() => void) | null {
  try {
    if (!ctx || ctx.state !== 'running') return null;
    const nodes = tones(ctx, times, (atMs - Date.now()) / 1000);
    return () => nodes.forEach(o => { try { o.stop(); } catch { /* already stopped */ } });
  } catch { return null; }
}

export function vibrate(pattern: number[] = [300, 150, 300, 150, 300]) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

export function notificationsSupported() {
  return typeof Notification !== 'undefined';
}

export async function requestNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

export async function notify(title: string, body: string, tag: string) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, tag, icon: ICON, badge: ICON });
    else new Notification(title, { body, tag, icon: ICON });
  } catch { /* ignore */ }
}

/** A daily recurring calendar event — the most reliable reminder on phones without a push server. */
export function reminderIcs(title: string, hhmm: string, description: string): string {
  const [h, m] = hhmm.split(':');
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const uidStr = `${title.replace(/\W/g, '')}-${Date.now()}@promise`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Promise//Gym//EN', 'BEGIN:VEVENT',
    `UID:${uidStr}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
    `DTSTART:${date}T${h}${m}00`,
    'DURATION:PT5M',
    'RRULE:FREQ=DAILY',
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
