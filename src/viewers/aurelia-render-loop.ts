type Clock = {
  frame: (callback: (now: number) => void) => number;
  cancelFrame: (id: number) => void;
  delay: (callback: () => void, milliseconds: number) => number;
  cancelDelay: (id: number) => void;
};

/** Render on input; sleep between animation samples and stop entirely when idle. */
export function createAureliaRenderLoop(
  draw: (now: number) => number | null,
  clock: Clock = {
    frame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
    delay: (callback, ms) => window.setTimeout(callback, ms),
    cancelDelay: (id) => clearTimeout(id),
  },
) {
  let frame: number | null = null,
    timer: number | null = null;
  let visible = true,
    suspended = false,
    disposed = false;
  function cancel() {
    if (frame !== null) clock.cancelFrame(frame);
    if (timer !== null) clock.cancelDelay(timer);
    frame = timer = null;
  }
  function invalidate() {
    if (!visible || suspended || disposed) return;
    if (timer !== null) clock.cancelDelay(timer);
    timer = null;
    if (frame !== null) return;
    frame = clock.frame((now) => {
      frame = null;
      const wait = draw(now);
      // Orbit damping can request the next frame while draw is running.
      if (wait !== null && frame === null && visible && !suspended && !disposed)
        timer = clock.delay(() => {
          timer = null;
          invalidate();
        }, wait);
    });
  }
  return {
    invalidate,
    setVisible(value: boolean) {
      visible = value;
      if (visible) invalidate();
      else cancel();
    },
    suspend() {
      suspended = true;
      cancel();
    },
    resume() {
      suspended = false;
      invalidate();
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
