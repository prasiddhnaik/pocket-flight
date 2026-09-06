/** Bounded flight history: 30 minutes at 15 samples/second, without shifting arrays. */
export class ReplayTimeline<T extends { t: number }> {
  private frames: (T | undefined)[];
  private head = 0;
  length = 0;
  trimmed = false;
  constructor(
    readonly capacity = 30 * 60 * 15 + 1,
    readonly maxDuration = 30 * 60,
  ) {
    if (capacity < 2) throw new Error("A replay needs at least two frames.");
    this.frames = new Array(capacity);
  }
  at(index: number): T {
    if (index < 0 || index >= this.length)
      throw new RangeError("Replay frame out of range");
    return this.frames[(this.head + index) % this.capacity]!;
  }
  push(frame: T) {
    if (!Number.isFinite(frame.t)) throw new Error("Invalid replay timestamp");
    if (this.length && frame.t <= this.at(this.length - 1).t) {
      if (frame.t < this.at(this.length - 1).t)
        throw new Error("Replay time moved backwards");
      this.frames[(this.head + this.length - 1) % this.capacity] = frame;
      return;
    }
    if (this.length === this.capacity) {
      this.frames[this.head] = frame;
      this.head = (this.head + 1) % this.capacity;
      this.trimmed = true;
    } else this.frames[(this.head + this.length++) % this.capacity] = frame;
    while (
      this.length > 1 &&
      frame.t - this.at(0).t > this.maxDuration + 1e-6
    ) {
      this.frames[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.length--;
      this.trimmed = true;
    }
  }
  get duration() {
    return this.length > 1 ? this.at(this.length - 1).t - this.at(0).t : 0;
  }
  sample(elapsed: number) {
    if (this.length < 2) return null;
    const t = this.at(0).t + Math.max(0, Math.min(elapsed, this.duration));
    let lo = 1,
      hi = this.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.at(mid).t < t) lo = mid + 1;
      else hi = mid;
    }
    const a = this.at(lo - 1),
      b = this.at(lo);
    return { a, b, mix: (t - a.t) / (b.t - a.t) };
  }
  clear() {
    this.frames = new Array(this.capacity);
    this.head = this.length = 0;
    this.trimmed = false;
  }
}
