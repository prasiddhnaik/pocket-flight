// Propeller engines from pulses, noise and tones, with no sound files to load. Finch
// has a four-cylinder piston engine and Heron a turboprop, so they share only the
// propeller's buzz and its roar. Wind noise stays in FlightAudio.
import { loopedBrownNoise } from "./jet-engine-sound";

export type PropKind = "piston" | "turboprop";
const unit = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
const ENGINES = {
  piston: { idleRpm: 800, maxRpm: 2500, blades: 3 },
  turboprop: { idleRpm: 600, maxRpm: 1900, blades: 4 },
};
/** Pulses per second the firing loop holds when played at normal speed. */
const LOOP_PULSES_PER_SECOND = 40;

export function propEngineMix(kind: PropKind, power: number) {
  const p = unit(power);
  const { idleRpm, maxRpm, blades } = ENGINES[kind];
  const rpm = idleRpm + p * (maxRpm - idleRpm);
  const running = p > 0 ? 1 : 0;
  const piston = kind === "piston" ? running : 0;
  const turbine = kind === "turboprop" ? running : 0;
  return {
    bladeHz: (rpm / 60) * blades,
    // Four cylinders fire twice per crank revolution.
    firingHz: (rpm / 60) * 2,
    firingGain: piston * (0.085 + 0.2 * p ** 1.3),
    firingToneHz: 260 + p * 1000,
    buzzGain: running * (kind === "piston" ? 0.012 + 0.036 * p : 0.018 + 0.05 * p),
    buzzToneHz: 300 + p * (kind === "piston" ? 650 : 1000),
    roarGain: running * (kind === "piston" ? 0.016 + 0.08 * p ** 1.5 : 0.015 + 0.075 * p ** 1.5),
    roarHz: 360 + p * 1100,
    whineGain: turbine * (0.006 + 0.013 * p),
    whineHz: 1700 + p * 2300,
  };
}

/** Exhaust pulses: each cylinder a little different, so the engine sounds lumpy and alive. */
export function firingLoop(length: number, pulses: number, sampleRate: number, random = Math.random) {
  const loop = new Float32Array(length);
  const spacing = length / pulses;
  const cylinders = [1, 0.84, 0.95, 0.78];
  const pulseLength = Math.round(spacing * 0.9);
  for (let pulse = 0; pulse < pulses; pulse++) {
    const start = Math.round(pulse * spacing);
    const loudness = cylinders[pulse % cylinders.length] * (0.9 + random() * 0.1);
    let low = 0;
    for (let i = 0; i < pulseLength; i++) {
      const time = i / sampleRate;
      low += ((random() * 2 - 1) - low) * 0.22;
      const bang = Math.sin(time * 2 * Math.PI * 92) * Math.exp(-time * 150);
      loop[(start + i) % length] += loudness * (bang + low * 1.5 * Math.exp(-time * 240));
    }
  }
  const peak = loop.reduce((a, b) => Math.max(a, Math.abs(b)), 1e-6);
  return loop.map((sample) => (sample / peak) * 0.95);
}

export class PropEngineSound {
  private readonly bus: GainNode;
  private readonly firingSource: AudioBufferSourceNode;
  private readonly firingFilter: BiquadFilterNode;
  private readonly firing: GainNode;
  private readonly bladeTone: OscillatorNode;
  private readonly buzzFilter: BiquadFilterNode;
  private readonly buzz: GainNode;
  private readonly roarFilter: BiquadFilterNode;
  private readonly roar: GainNode;
  private readonly whineTone: OscillatorNode;
  private readonly whine: GainNode;

  constructor(private readonly context: BaseAudioContext, output: AudioNode) {
    const c = context;
    const gain = (value = 0) => {
      const node = c.createGain();
      node.gain.value = value;
      return node;
    };
    const filter = (type: BiquadFilterType, frequency: number, Q = 0.7) => {
      const node = c.createBiquadFilter();
      node.type = type;
      node.frequency.value = frequency;
      node.Q.value = Q;
      return node;
    };
    this.bus = gain();
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.2;
    this.bus.connect(limiter).connect(output);

    const pulses = c.createBuffer(1, c.sampleRate, c.sampleRate);
    pulses.getChannelData(0).set(firingLoop(pulses.length, LOOP_PULSES_PER_SECOND, c.sampleRate));
    this.firingSource = c.createBufferSource();
    this.firingSource.buffer = pulses;
    this.firingSource.loop = true;
    this.firingFilter = filter("lowpass", 400);
    this.firing = gain();
    this.firingSource.connect(this.firingFilter).connect(this.firing).connect(this.bus);
    this.firingSource.start();

    this.bladeTone = c.createOscillator();
    this.bladeTone.type = "sawtooth";
    this.buzzFilter = filter("lowpass", 500, 1.1);
    this.buzz = gain();
    this.bladeTone.connect(this.buzzFilter).connect(this.buzz).connect(this.bus);
    this.bladeTone.start();

    const brown = c.createBuffer(1, c.sampleRate * 5, c.sampleRate);
    brown.getChannelData(0).set(loopedBrownNoise(brown.length, Math.round(c.sampleRate * 0.25)));
    const noise = c.createBufferSource();
    noise.buffer = brown;
    noise.loop = true;
    noise.playbackRate.value = 2.4;
    this.roarFilter = filter("bandpass", 700, 0.5);
    this.roar = gain();
    noise.connect(this.roarFilter).connect(this.roar).connect(this.bus);
    noise.start();

    this.whineTone = c.createOscillator();
    this.whineTone.type = "sine";
    this.whine = gain();
    this.whineTone.connect(this.whine).connect(this.bus);
    this.whineTone.start();
  }

  /** @param level 0 when muted or inactive, otherwise the caller's volume. */
  update(kind: PropKind, power: number, level: number) {
    const mix = propEngineMix(kind, power);
    const t = this.context.currentTime;
    const glide = (param: AudioParam, value: number, seconds = 0.16) => param.setTargetAtTime(value, t, seconds);
    glide(this.bus.gain, unit(level), 0.1);
    glide(this.firingSource.playbackRate, mix.firingHz / LOOP_PULSES_PER_SECOND);
    glide(this.firingFilter.frequency, mix.firingToneHz);
    glide(this.firing.gain, mix.firingGain);
    glide(this.bladeTone.frequency, mix.bladeHz);
    glide(this.buzzFilter.frequency, mix.buzzToneHz);
    glide(this.buzz.gain, mix.buzzGain);
    glide(this.roarFilter.frequency, mix.roarHz);
    glide(this.roar.gain, mix.roarGain);
    glide(this.whineTone.frequency, mix.whineHz);
    glide(this.whine.gain, mix.whineGain);
  }
}
