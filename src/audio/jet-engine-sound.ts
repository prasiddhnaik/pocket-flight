// A jet engine built from noise and two tones, with no sound files to load. The
// mix is a plain function of engine state, so it can be tested without audio.
const unit = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
/** Airspeed in metres per second at which the wind noise stops growing. */
const WIND_FULL_SPEED = 320;
const LIT = 0.05;
const OUT = 0.02;

/** What sets one kind of jet apart: its fan's pitch and how much of each sound it makes. */
export type JetVoice = { whineHz: number; whineSpan: number; whine: number; rumble: number; roar: number };
export const FIGHTER: JetVoice = { whineHz: 380, whineSpan: 2100, whine: 1, rumble: 1, roar: 1 };
/** Big quiet fans: much more whine, much less jet blast. */
export const BUSINESS_JET: JetVoice = { whineHz: 700, whineSpan: 3000, whine: 3, rumble: 0.62, roar: 0.6 };

export function jetEngineMix(rpm: number, burner: number, speed: number, voice: JetVoice = FIGHTER) {
  const power = unit(rpm);
  // A burner cannot run without its engine, whatever the recording says.
  const lit = unit(burner) * Math.min(1, power * 2);
  const air = unit(speed / WIND_FULL_SPEED);
  return {
    whineHz: voice.whineHz + power * voice.whineSpan,
    whineGain: voice.whine * 0.009 * power ** 1.2,
    rumbleHz: 80 + power * 170 + lit * 60,
    rumbleGain: voice.rumble * (0.26 * power ** 0.9 + 0.13 * lit),
    roarHz: 380 + power * 1250 + lit * 420,
    roarGain: voice.roar * (0.055 * power ** 2 + 0.02 * lit),
    burnerGain: 0.16 * lit,
    crackleGain: 0.04 * lit,
    windHz: 300 + air * 1500,
    windGain: 0.035 * air ** 1.6,
  };
}

/** The light-off thump plays once, and waits for the burner to go out before re-arming.
 * While silent (paused, muted) nothing changes, so resuming cannot thump by itself. */
export function burnerLitEdge(armed: boolean, burner: number, audible = true) {
  if (!audible) return { armed, fire: false };
  if (armed && burner >= LIT) return { armed: false, fire: true };
  return { armed: armed || burner < OUT, fire: false };
}

/** Brown noise whose tail is faded into its head, so the loop point cannot click. */
export function loopedBrownNoise(length: number, fade: number, random = Math.random) {
  const raw = new Float32Array(length + fade);
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    last = (last + (random() * 2 - 1) * 0.04) / 1.02;
    raw[i] = last;
  }
  const noise = raw.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const mix = i / fade;
    noise[i] = raw[i] * mix + raw[length + i] * (1 - mix);
  }
  const peak = noise.reduce((a, b) => Math.max(a, Math.abs(b)), 1e-6);
  return noise.map((sample) => sample / peak);
}

/** Separate short pops at random times; some are much louder, as in a real burner. */
export function crackleNoise(length: number, sampleRate: number, popsPerSecond: number, random = Math.random) {
  const crackle = new Float32Array(length);
  const pops = Math.round((length / sampleRate) * popsPerSecond);
  for (let pop = 0; pop < pops; pop++) {
    const start = Math.floor(random() * length);
    const loudness = random() ** 3;
    const samples = Math.round(sampleRate * (0.0012 + random() * 0.005));
    for (let i = 0; i < samples; i++) {
      const at = (start + i) % length;
      const value = crackle[at] + (random() * 2 - 1) * loudness * (1 - i / samples) ** 2;
      crackle[at] = Math.max(-1, Math.min(1, value));
    }
  }
  return crackle;
}

export class JetEngineSound {
  private readonly bus: GainNode;
  private readonly whineLow: OscillatorNode;
  private readonly whineHigh: OscillatorNode;
  private readonly whine: GainNode;
  private readonly rumbleFilter: BiquadFilterNode;
  private readonly rumble: GainNode;
  private readonly roarFilter: BiquadFilterNode;
  private readonly roar: GainNode;
  private readonly burner: GainNode;
  private readonly crackle: GainNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly wind: GainNode;
  private readonly thumpSound: AudioBuffer;
  private armed = true;

  constructor(private readonly context: BaseAudioContext, output: AudioNode) {
    const c = context;
    this.bus = c.createGain();
    this.bus.gain.value = 0;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.2;
    this.bus.connect(limiter).connect(output);

    const brown = c.createBuffer(1, c.sampleRate * 6, c.sampleRate);
    brown.getChannelData(0).set(loopedBrownNoise(brown.length, Math.round(c.sampleRate * 0.25)));
    const hiss = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const hissData = hiss.getChannelData(0);
    for (let i = 0; i < hissData.length; i++) hissData[i] = Math.random() * 2 - 1;
    const crackle = c.createBuffer(1, c.sampleRate * 5, c.sampleRate);
    crackle.getChannelData(0).set(crackleNoise(crackle.length, c.sampleRate, 34));
    // Each voice starts at its own point in the loop, so they never line up.
    const loop = (buffer: AudioBuffer, offset: number, rate = 1) => {
      const source = c.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = rate;
      source.start(0, offset);
      return source;
    };
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

    this.whine = gain();
    this.whine.connect(this.bus);
    this.whineLow = c.createOscillator();
    this.whineLow.type = "sine";
    this.whineHigh = c.createOscillator();
    this.whineHigh.type = "triangle";
    this.whineHigh.detune.value = 7;
    const highTone = gain(0.35);
    this.whineLow.connect(this.whine);
    this.whineHigh.connect(highTone).connect(this.whine);
    this.whineLow.start();
    this.whineHigh.start();

    this.rumbleFilter = filter("lowpass", 120);
    this.rumble = gain();
    loop(brown, 0).connect(this.rumbleFilter).connect(this.rumble).connect(this.bus);

    this.roarFilter = filter("bandpass", 800, 0.45);
    this.roar = gain();
    loop(hiss, 0.4).connect(this.roarFilter).connect(this.roar).connect(this.bus);

    // The burner's chugging: a very slow copy of the noise wobbles its loudness.
    this.burner = gain();
    const flutter = gain(1);
    const flutterDepth = gain(0.55);
    loop(brown, 2.2, 0.35).connect(filter("lowpass", 11)).connect(flutterDepth).connect(flutter.gain);
    loop(brown, 3.7, 1.35).connect(filter("lowpass", 620, 0.9)).connect(flutter).connect(this.burner).connect(this.bus);

    this.crackle = gain();
    loop(crackle, 1.1).connect(filter("highpass", 850)).connect(this.crackle).connect(this.bus);

    this.windFilter = filter("bandpass", 400, 0.6);
    this.wind = gain();
    loop(hiss, 1.9, 0.82).connect(this.windFilter).connect(this.wind).connect(this.bus);

    this.thumpSound = c.createBuffer(1, Math.round(c.sampleRate * 0.7), c.sampleRate);
    const thump = this.thumpSound.getChannelData(0);
    let phase = 0, low = 0;
    for (let i = 0; i < thump.length; i++) {
      const time = i / c.sampleRate;
      phase += ((38 + 62 * Math.exp(-time * 9)) * Math.PI * 2) / c.sampleRate;
      low += ((Math.random() * 2 - 1) - low) * 0.06;
      const attack = Math.min(1, time / 0.006);
      thump[i] = attack * (Math.sin(phase) * Math.exp(-time * 6) + low * 1.4 * Math.exp(-time * 11));
    }
  }

  /** @param level 0 when muted or inactive, otherwise the caller's volume. */
  update(rpm: number, burner: number, speed: number, level: number, voice: JetVoice = FIGHTER) {
    const mix = jetEngineMix(rpm, burner, speed, voice);
    const t = this.context.currentTime;
    const glide = (param: AudioParam, value: number, seconds = 0.14) => param.setTargetAtTime(value, t, seconds);
    glide(this.bus.gain, unit(level), 0.1);
    glide(this.whineLow.frequency, mix.whineHz);
    glide(this.whineHigh.frequency, mix.whineHz * 1.41);
    glide(this.whine.gain, mix.whineGain);
    glide(this.rumbleFilter.frequency, mix.rumbleHz);
    glide(this.rumble.gain, mix.rumbleGain);
    glide(this.roarFilter.frequency, mix.roarHz);
    glide(this.roar.gain, mix.roarGain);
    glide(this.burner.gain, mix.burnerGain, 0.09);
    glide(this.crackle.gain, mix.crackleGain, 0.2);
    glide(this.windFilter.frequency, mix.windHz, 0.25);
    glide(this.wind.gain, mix.windGain, 0.25);
    const edge = burnerLitEdge(this.armed, burner, level > 0 && rpm > 0);
    this.armed = edge.armed;
    if (edge.fire) this.thump();
  }

  private thump() {
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.thumpSound;
    gain.gain.value = 0.2;
    source.connect(gain).connect(this.bus);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }
}
