export class JetAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private oscillator: OscillatorNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private roar: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  enabled = false;
  async toggle() {
    this.enabled = !this.enabled;
    if (!this.context) {
      const c = (this.context = new AudioContext());
      this.master = c.createGain();
      this.master.gain.value = 0;
      this.master.connect(c.destination);
      this.oscillator = c.createOscillator();
      this.oscillator.type = "sine";
      const whine = c.createGain();
      whine.gain.value = 0.045;
      this.oscillator.connect(whine).connect(this.master);
      this.oscillator.start();
      const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate),
        data = buffer.getChannelData(0);
      let last = 0;
      for (let j = 0; j < data.length; j++) {
        last = (last + (Math.random() * 2 - 1) * 0.025) / 1.025;
        data[j] = last * 8;
      }
      this.noise = c.createBufferSource();
      this.noise.buffer = buffer;
      this.noise.loop = true;
      this.filter = c.createBiquadFilter();
      this.filter.type = "lowpass";
      this.roar = c.createGain();
      this.noise.connect(this.filter).connect(this.roar).connect(this.master);
      this.noise.start();
    }
    if (this.enabled) await this.context.resume();
    return this.enabled;
  }
  update(rpm: number, burner: number, paused: boolean) {
    const c = this.context;
    if (!c || !this.master) return;
    this.master.gain.setTargetAtTime(
      this.enabled && !paused ? Math.min(0.24, rpm * 0.2) : 0,
      c.currentTime,
      0.12,
    );
    this.oscillator!.frequency.setTargetAtTime(
      80 + rpm * 640,
      c.currentTime,
      0.15,
    );
    this.filter!.frequency.setTargetAtTime(
      180 + rpm * 1200 + burner * 1100,
      c.currentTime,
      0.2,
    );
    this.roar!.gain.setTargetAtTime(0.3 + burner * 0.65, c.currentTime, 0.2);
  }
}
