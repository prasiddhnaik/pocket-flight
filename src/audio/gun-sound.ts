// The gun as a continuous rip of 100 shots a second, with a barrel whir and an
// echoing tail. Everything is synthesised, so there are no sound files to load.
const unit = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
/** How long after the last shot the rip keeps going. Physics steps can bunch up at low frame rates. */
const HOLD_SECONDS = 0.08;

export const gunSilent = (lastShot: number, now: number, active: boolean) => !active || now - lastShot > HOLD_SECONDS;

export function gunWhir(spool: number) {
  const speed = unit(spool);
  return { hz: 55 + speed * 170, gain: 0.1 * speed ** 1.3 };
}

/** A tap barely echoes; a long burst leaves a full tail. */
export const gunTailLevel = (burstSeconds: number) => 0.3 + 0.7 * unit(burstSeconds / 0.4);

/** Recordings keep the barrel speed but not the trigger: rising or holding speed means firing. */
export const gunFiringFromSpool = (previous: number, spool: number) => spool > 0.05 && spool >= previous - 1e-4;

/** One second of shots, each a sharp crack over a short low thud, slightly uneven like the real thing. */
export function gunLoop(length: number, sampleRate: number, rounds: number, random = Math.random) {
  const loop = new Float32Array(length);
  const spacing = length / rounds;
  const shotLength = Math.round(sampleRate * 0.0075);
  for (let round = 0; round < rounds; round++) {
    const start = Math.round(round * spacing + (random() - 0.5) * sampleRate * 0.0005);
    const loudness = 0.8 + random() * 0.2;
    let phase = random() * Math.PI * 2;
    for (let i = 0; i < shotLength; i++) {
      const time = i / sampleRate;
      phase += ((70 + 130 * Math.exp(-time * 400)) * Math.PI * 2) / sampleRate;
      const crack = (random() * 2 - 1) * Math.exp(-time * 900);
      const thud = Math.sin(phase) * Math.exp(-time * 320);
      loop[(start + i + length) % length] += loudness * (crack * 0.75 + thud);
    }
  }
  const peak = loop.reduce((a, b) => Math.max(a, Math.abs(b)), 1e-6);
  return loop.map((sample) => (sample / peak) * 0.9);
}

export class GunSound {
  private readonly gate: GainNode;
  private readonly rip: AudioBufferSourceNode;
  private readonly whirTone: OscillatorNode;
  private readonly whir: GainNode;
  private readonly tail: AudioBuffer;
  private readonly bus: GainNode;
  private open = false;
  private burstStart = 0;
  private lastShot = -Infinity;

  constructor(private readonly context: BaseAudioContext, output: AudioNode) {
    const c = context;
    this.bus = c.createGain();
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.bus.connect(limiter).connect(output);

    const shots = c.createBuffer(1, c.sampleRate, c.sampleRate);
    shots.getChannelData(0).set(gunLoop(shots.length, c.sampleRate, 100));
    this.rip = c.createBufferSource();
    this.rip.buffer = shots;
    this.rip.loop = true;
    const tone = c.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3600;
    const body = c.createBiquadFilter();
    body.type = "lowshelf";
    body.frequency.value = 170;
    body.gain.value = 5;
    this.gate = c.createGain();
    this.gate.gain.value = 0;
    const level = c.createGain();
    level.gain.value = 0.52;
    this.rip.connect(tone).connect(body).connect(this.gate).connect(level).connect(this.bus);
    this.rip.start();

    this.whirTone = c.createOscillator();
    this.whirTone.type = "sawtooth";
    this.whirTone.frequency.value = 55;
    const whirFilter = c.createBiquadFilter();
    whirFilter.type = "bandpass";
    whirFilter.frequency.value = 620;
    whirFilter.Q.value = 0.8;
    this.whir = c.createGain();
    this.whir.gain.value = 0;
    this.whirTone.connect(whirFilter).connect(this.whir).connect(this.bus);
    this.whirTone.start();

    // Low rumble with one faint echo, as the sound rolls away from the aircraft.
    this.tail = c.createBuffer(1, Math.round(c.sampleRate * 0.7), c.sampleRate);
    const tail = this.tail.getChannelData(0);
    const echo = Math.round(c.sampleRate * 0.11);
    let low = 0;
    for (let i = 0; i < tail.length; i++) {
      low += ((Math.random() * 2 - 1) - low) * 0.05;
      tail[i] += low * 2.2 * Math.exp((-i / c.sampleRate) * 5.5);
      if (i >= echo) tail[i] += tail[i - echo] * 0.28;
    }
  }

  /** Called for each physics step that fired. The first shot of a burst is heard at once. */
  fired() {
    const now = this.context.currentTime;
    this.lastShot = now;
    if (this.open) return;
    this.open = true;
    this.burstStart = now;
    // The rip climbs as the barrels come up to speed.
    this.rip.playbackRate.setValueAtTime(0.74, now);
    this.rip.playbackRate.setTargetAtTime(1, now, 0.07);
    this.gate.gain.setTargetAtTime(1, now, 0.002);
  }

  /** @param spool barrel speed as a fraction of full speed. */
  update(spool: number, active: boolean) {
    const now = this.context.currentTime;
    const whir = gunWhir(active ? spool : 0);
    this.whirTone.frequency.setTargetAtTime(whir.hz, now, 0.05);
    this.whir.gain.setTargetAtTime(whir.gain, now, 0.05);
    if (!this.open || !gunSilent(this.lastShot, now, active)) return;
    this.open = false;
    this.gate.gain.setTargetAtTime(0, now, 0.012);
    if (active) this.echo(gunTailLevel(this.lastShot - this.burstStart));
  }

  private echo(level: number) {
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.tail;
    gain.gain.value = 0.75 * level;
    source.connect(gain).connect(this.bus);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }
}
