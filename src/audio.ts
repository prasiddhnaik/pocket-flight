export class FlightAudio {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private capture: MediaStreamAudioDestinationNode | null = null;
  enabled = false;
  jet = false;
  start() {
    if (!this.context) {
      const ctx = (this.context = new AudioContext());
      const osc = (this.oscillator = ctx.createOscillator());
      osc.type = "sawtooth";
      const filter = (this.engineFilter = ctx.createBiquadFilter());
      filter.type = "lowpass";
      filter.frequency.value = 280;
      const gain = (this.gain = ctx.createGain());
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(ctx.destination);
      osc.start();
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + Math.random() * 0.04 - 0.02) / 1.02;
        data[i] = last * 3;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const windGain = (this.windGain = ctx.createGain());
      windGain.gain.value = 0;
      noise.connect(windGain).connect(ctx.destination);
      noise.start();
    }
    void this.context.resume();
    this.enabled = true;
  }
  captureTrack() {
    if (!this.context || !this.gain || !this.windGain || !this.enabled)
      return null;
    if (!this.capture) {
      this.capture = this.context.createMediaStreamDestination();
      this.gain.connect(this.capture);
      this.windGain.connect(this.capture);
    }
    void this.context.resume();
    return this.capture.stream.getAudioTracks()[0].clone();
  }
  toggle() {
    if (!this.enabled) this.start();
    else {
      this.enabled = false;
      if (this.gain) this.gain.gain.value = 0;
      if (this.windGain) this.windGain.gain.value = 0;
    }
    return this.enabled;
  }
  update(throttle: number, speed: number, active: boolean) {
    if (!this.context || !this.gain || !this.oscillator || !this.windGain)
      return;
    const t = this.context.currentTime;
    this.oscillator.type = this.jet ? "sine" : "sawtooth";
    this.engineFilter?.frequency.setTargetAtTime(
      this.jet ? 1600 : 280,
      t,
      0.15,
    );
    this.oscillator.frequency.setTargetAtTime(
      this.jet ? 100 + throttle * 480 : 24 + throttle * 49 + speed * 0.2,
      t,
      0.15,
    );
    this.gain.gain.setTargetAtTime(
      this.enabled && active ? 0.016 + throttle * 0.035 : 0,
      t,
      0.1,
    );
    this.windGain.gain.setTargetAtTime(
      this.enabled && active
        ? this.jet
          ? 0.04 + throttle * 0.15
          : Math.min(0.09, speed * 0.0012)
        : 0,
      t,
      0.1,
    );
  }
  chime(success = true) {
    if (!this.enabled || !this.context) return;
    const ctx = this.context;
    [0, 0.12, 0.24].forEach((delay, i) => {
      const osc = ctx.createOscillator(),
        g = ctx.createGain();
      osc.frequency.value = (success ? [523, 659, 784] : [220, 174, 130])[i];
      g.gain.setValueAtTime(0.055, ctx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.4);
      osc.connect(g).connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.4);
    });
  }
  dispose() {
    void this.context?.close();
  }
}
