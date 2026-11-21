/** Frame rates offered in settings; 100 is the hard ceiling. */
export const FPS_LIMITS = [30, 60, 100] as const;
export type FpsLimit = (typeof FPS_LIMITS)[number];

/**
 * Frame cap gate. Call once per rAF tick with the tick time; returns whether to run this frame.
 * Keeps a schedule (not "time since last frame") so a 120 Hz screen capped at 100 really
 * gives ~100 fps instead of dropping every other vsync down to 60.
 */
export class FrameCap {
  private next = 0;
  constructor(public limit: number = 100) {}

  shouldRun(t: number): boolean {
    const step = 1000 / Math.min(this.limit, 100);
    // 1 ms slack: vsync timestamps jitter around the exact period
    if (t < this.next - 1) return false;
    // never bank more than one step, so a long stall does not cause a burst of frames
    this.next = Math.max(this.next + step, t);
    return true;
  }
}
