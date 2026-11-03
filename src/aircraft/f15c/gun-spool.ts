import { MathUtils, type AnimationClip } from "three";

// The M61's barrel speed over time comes from clips made in Blender
// (scripts/build-f15c-skin.py). The game only chooses when they play.
/** 100 rounds per second from six barrels, in radians per second. */
export const GUN_FULL_SPEED = (100 / 6) * Math.PI * 2;
export const GUN_SHAKE_PERIOD = 0.1;
/** Curve points: time in seconds, fraction of full speed. */
type Curve = readonly (readonly [number, number])[];
export type GunCurves = { up: Curve; down: Curve; shake: readonly (readonly [number, number, number])[] };

const eased = (seconds: number, from: number, to: number): Curve =>
  Array.from({ length: 21 }, (_, i) => {
    const t = i / 20;
    return [t * seconds, from + (to - from) * t * t * (3 - 2 * t)] as const;
  });
// Used when a model has no clips, such as in tests and old assets.
const FALLBACK: GunCurves = {
  up: eased(1 / 3, 0, 1),
  down: eased(1, 1, 0),
  shake: [[0, 0, 0], [0.025, 0.0022, 0.0012], [0.05, 0, -0.0016], [0.075, -0.0022, 0.0012], [0.1, 0, 0]],
};

function scaleCurve(clip: AnimationClip | undefined): Curve | null {
  const track = clip?.tracks.find((candidate) => candidate.name.endsWith(".scale"));
  if (!track) return null;
  return Array.from(track.times, (time, i) => [time, track.values[i * 3]] as const);
}

export function gunCurves(clips: readonly AnimationClip[]): GunCurves {
  const named = (name: string) => clips.find((clip) => clip.name === name);
  const shake = named("Gun_muzzle_shake")?.tracks.find((track) => track.name.endsWith(".position"));
  return {
    up: scaleCurve(named("Gun_spin_up")) ?? FALLBACK.up,
    down: scaleCurve(named("Gun_wind_down")) ?? FALLBACK.down,
    shake: shake
      ? Array.from(shake.times, (time, i) => [time, shake.values[i * 3], shake.values[i * 3 + 1]] as const)
      : FALLBACK.shake,
  };
}

function sample(curve: Curve, time: number) {
  if (time <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (time <= curve[i][0]) {
      const [t0, v0] = curve[i - 1],
        [t1, v1] = curve[i];
      return v0 + ((v1 - v0) * (time - t0)) / (t1 - t0);
    }
  }
  return curve[curve.length - 1][1];
}

/** The curve's time at a given speed, so either clip can pick up from any speed. */
function timeAt(curve: Curve, value: number) {
  for (let i = 1; i < curve.length; i++) {
    const [t0, v0] = curve[i - 1],
      [t1, v1] = curve[i];
    if ((value >= Math.min(v0, v1) && value <= Math.max(v0, v1)) && v1 !== v0)
      return t0 + ((value - v0) / (v1 - v0)) * (t1 - t0);
  }
  return value <= Math.min(curve[0][1], curve[curve.length - 1][1]) === curve[0][1] < curve[curve.length - 1][1]
    ? curve[0][0]
    : curve[curve.length - 1][0];
}

/** Fully blurred before the barrels pass 30 degrees a frame at 30 fps, where they start to look reversed. */
export function gunBlur(speed: number) {
  const degreesPerFrame = MathUtils.radToDeg(speed) / 60;
  return MathUtils.smoothstep(degreesPerFrame, 8, 14);
}

/** A little shake once the barrels are near full speed, timed from their angle so replays match. */
export function gunShake(curves: GunCurves, speed: number, angle: number): [number, number] {
  const strength = MathUtils.smoothstep(speed / GUN_FULL_SPEED, 0.8, 1);
  if (!strength) return [0, 0];
  const time = (((angle / GUN_FULL_SPEED) % GUN_SHAKE_PERIOD) + GUN_SHAKE_PERIOD) % GUN_SHAKE_PERIOD;
  for (let i = 1; i < curves.shake.length; i++) {
    if (time <= curves.shake[i][0]) {
      const a = curves.shake[i - 1],
        b = curves.shake[i],
        mix = (time - a[0]) / (b[0] - a[0]);
      return [(a[1] + (b[1] - a[1]) * mix) * strength, (a[2] + (b[2] - a[2]) * mix) * strength];
    }
  }
  return [0, 0];
}

export class GunSpool {
  private current = 0;
  constructor(private readonly curves: GunCurves = FALLBACK) {}
  get speed() {
    return this.current;
  }
  get blur() {
    return gunBlur(this.current);
  }
  /** Sets the speed directly, such as from a recorded replay value. */
  seek(speed: number) {
    this.current = speed;
  }
  step(dt: number, firing: boolean) {
    if (dt <= 0) return;
    const curve = firing ? this.curves.up : this.curves.down;
    const fraction = this.current / GUN_FULL_SPEED;
    this.current = sample(curve, timeAt(curve, fraction) + dt) * GUN_FULL_SPEED;
  }
}
