import { FlightMusic } from "./flight-music";
import type { MusicState } from "./music-mix";
import type { MusicTrackId } from "./music-tracks";

export class FlightAudio {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private capture: MediaStreamAudioDestinationNode | null = null;
  private master: GainNode | null = null;
  music: FlightMusic | null = null;
  enabled = false;
  jet = false;
  start() {
    if (!this.context) {
      const ctx = (this.context = new AudioContext());
      const master = (this.master = ctx.createGain());
      master.connect(ctx.destination);
      this.music = new FlightMusic(ctx, master);
      this.enabled = true;
      try {
        this.enabled =
          localStorage.getItem("pocket-flight-audio-muted") !== "true";
      } catch {
        /* Optional persistence. */
      }
      master.gain.value = this.enabled ? 1 : 0;
      const osc = (this.oscillator = ctx.createOscillator());
      osc.type = "sawtooth";
      const filter = (this.engineFilter = ctx.createBiquadFilter());
      filter.type = "lowpass";
      filter.frequency.value = 280;
      const gain = (this.gain = ctx.createGain());
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(master);
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
      noise.connect(windGain).connect(master);
      noise.start();
    }
    void this.context.resume();
  }
  captureTrack() {
    if (!this.context || !this.gain || !this.windGain || !this.enabled)
      return null;
    if (!this.capture) {
      this.capture = this.context.createMediaStreamDestination();
      this.master!.connect(this.capture);
    }
    void this.context.resume();
    return this.capture.stream.getAudioTracks()[0].clone();
  }
  toggle() {
    const enabled = !this.enabled;
    this.start();
    this.enabled = enabled;
    this.master!.gain.setTargetAtTime(
      enabled ? 1 : 0,
      this.context!.currentTime,
      0.025,
    );
    try {
      localStorage.setItem("pocket-flight-audio-muted", String(!enabled));
    } catch {
      /* Optional persistence. */
    }
    return this.enabled;
  }
  setMusicVolume(value: number) {
    this.start();
    this.music?.setVolume(value);
  }
  selectMusicTrack(id: MusicTrackId) {
    this.start();
    this.music?.selectTrack(id);
  }
  updateMusic(state: MusicState) {
    this.music?.update(state, this.enabled);
  }
  setVisible(visible: boolean) {
    if (!this.context) return;
    if (!visible) void this.context.suspend();
    else void this.context.resume();
  }
  update(throttle: number, speed: number, active: boolean, volume = 1) {
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
      this.enabled && active ? (0.016 + throttle * 0.035) * volume : 0,
      t,
      0.1,
    );
    this.windGain.gain.setTargetAtTime(
      this.enabled && active
        ? this.jet
          ? (0.04 + throttle * 0.15) * volume
          : Math.min(0.09, speed * 0.0012) * volume
        : 0,
      t,
      0.1,
    );
  }
  chime(success = true) {
    if (!this.enabled || !this.context) return;
    const ctx = this.context;
    [0, 0.18, 0.36].forEach((delay, i) => {
      const osc = ctx.createOscillator(),
        g = ctx.createGain();
      osc.frequency.value = (
        success ? [587.33, 739.99, 880] : [293.66, 246.94, 220]
      )[i];
      g.gain.setValueAtTime(0.001, ctx.currentTime + delay);
      g.gain.linearRampToValueAtTime(0.035, ctx.currentTime + delay + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.7);
      osc.connect(g).connect(this.master!);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.7);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
    });
  }
  dispose() {
    this.music?.dispose();
    void this.context?.close();
  }
}
