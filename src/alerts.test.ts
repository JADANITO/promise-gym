import { describe, expect, it, vi } from 'vitest';

// A stand-in sound player: records when tones start and whether they were cancelled.
class FakeCtx {
  static last: FakeCtx;
  state = 'suspended';
  currentTime = 10;
  starts: number[] = [];
  cancelled = 0;
  destination = {};
  constructor() { FakeCtx.last = this; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x }; }
  createOscillator() {
    const self = this;
    return { type: '', frequency: { value: 0 }, connect: (x: unknown) => x, start(t: number) { self.starts.push(t); },
      stop(t?: number) { if (t === undefined) self.cancelled++; } };
  }
}
vi.stubGlobal('AudioContext', FakeCtx);

describe('rest beep', () => {
  it('wakes a sleeping sound player before beeping instead of playing into nothing', async () => {
    const { beep } = await import('./alerts');
    beep();
    const c = FakeCtx.last;
    expect(c.starts.length).toBe(0);        // asleep: nothing scheduled yet
    await Promise.resolve(); await Promise.resolve();
    expect(c.state).toBe('running');
    expect(c.starts.length).toBe(3);        // woke, then beeped
  });

  it('books the beep for the end of the rest, and cancels it if the rest changes', async () => {
    const { bookBeep } = await import('./alerts');
    const c = FakeCtx.last; c.starts = [];
    const cancel = bookBeep(Date.now() + 90_000)!;
    expect(c.starts.length).toBe(3);
    expect(Math.round(c.starts[0] - c.currentTime)).toBe(90); // 90 s ahead on the sound clock
    cancel();
    expect(c.cancelled).toBe(3);
  });

  it("can't book while the sound player is asleep, so the timer beeps itself", async () => {
    const { bookBeep } = await import('./alerts');
    FakeCtx.last.state = 'suspended';
    expect(bookBeep(Date.now() + 60_000)).toBeNull();
  });
});
