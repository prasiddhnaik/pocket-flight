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
  return Math.sin(time * Math.PI / 8) ** 3;
}
