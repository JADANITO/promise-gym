// Sound, vibration and system notifications. All best-effort: browsers differ in what they allow.

let ctx: AudioContext | null = null;
const ICON = `${import.meta.env.BASE_URL}icon-192.png`;

/** Must be called from a user gesture once so iOS lets us play sound later. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* no audio */ }
}

export function beep(times = 3) {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, now + i * 0.35);
      g.gain.exponentialRampToValueAtTime(0.25, now + i * 0.35 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.35 + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.35);
      o.stop(now + i * 0.35 + 0.3);
    }
  } catch { /* no audio */ }
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
