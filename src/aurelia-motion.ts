// Exact critically damped response: stable at different rendering frame rates.
export class Actuator {
  value = 0;
  velocity = 0;
  step(target: number, dt: number, frequency = 9) {
    const displacement = this.value - target;
    const impulse = this.velocity + frequency * displacement;
    const decay = Math.exp(-frequency * dt);
    this.value = target + (displacement + impulse * dt) * decay;
    this.velocity = (this.velocity - frequency * impulse * dt) * decay;
    return this.value;
  }
}
export function controlCheck(time: number) {
  // A slow, continuous inspection sweep that returns to neutral every 16 seconds.
  return Math.sin((time * Math.PI) / 8) ** 3;
}
// The native curves finish folding below the cabin before the doors close.
// Frame 123 at 24 fps is the sealed endpoint used by flight and inspection.
export const AURELIA_GEAR_STOW_TIME = 123 / 24;

function gearRamp(value: number, start: number, end: number) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

/** Shared by the offline native curves and the flight contact geometry. */
export function aureliaGearFold(extension: number, nose: boolean) {
  return (
    ((-(nose ? 77.1 : 72.5) * Math.PI) / 180) *
    gearRamp(1 - extension, 0.1, 0.78)
  );
}

export function aureliaDoorAngle(extension: number, side: number) {
  return ((side * 95 * Math.PI) / 180) * (1 - gearRamp(1 - extension, 0.84, 1));
}
