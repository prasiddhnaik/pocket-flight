import { FlightMusic } from "./flight-music";
import { GunSound, gunFiringFromSpool } from "./gun-sound";
import { BUSINESS_JET, FIGHTER, JetEngineSound } from "./jet-engine-sound";
import { PropEngineSound } from "./prop-engine-sound";
import type { MusicState } from "./music-mix";
import type { MusicTrackId } from "./music-tracks";

export type EngineVoice = "fighter" | "business-jet" | "piston" | "turboprop";
export function engineVoice(id: string): EngineVoice {
  if (id === "finch") return "piston";
  if (id === "heron") return "turboprop";
  return id === "aurelia" ? "business-jet" : "fighter";
}

export class FlightAudio {
  private context: AudioContext | null = null;
  private windGain: GainNode | null = null;
  private capture: MediaStreamAudioDestinationNode | null = null;
  private master: GainNode | null = null;
  music: FlightMusic | null = null;
  enabled = false;
  private cannonNoise: AudioBuffer | null = null;
  private jetEngine: JetEngineSound | null = null;
  private propEngine: PropEngineSound | null = null;
  private gun: GunSound | null = null;
  private previousSpool = 0;
  voice: EngineVoice = "piston";
  private voiceGain: GainNode | null = null;
  private voiceSources: AudioBufferSourceNode[] = [];
  private voiceCache = new Map<string, Promise<AudioBuffer | null>>();
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
    if (!this.context || !this.windGain || !this.enabled)
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
  cannonBurst() {
    if (!this.enabled || !this.context || !this.master) return;
    const ctx = this.context;
    // launch() falls back on this buffer until the first blast has made its own.
    if (!this.cannonNoise) {
      this.cannonNoise = ctx.createBuffer(1, Math.round(ctx.sampleRate * .045), ctx.sampleRate);
      const samples = this.cannonNoise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        const envelope = (1 - i / samples.length) ** 2;
        samples[i] = ((Math.random() * 2 - 1) * .7 + Math.sin(i / ctx.sampleRate * 700) * .3) * envelope;
      }
    }
    this.gun ??= new GunSound(ctx, this.master);
    this.gun.fired();
  }
  private blastNoise?: AudioBuffer;
  private seekerTone?: { oscillator: OscillatorNode; gain: GainNode };
  /** Seeker tone: a low growl while searching, a steady high tone once locked. */
  seeker(state: "off" | "search" | "lock", time: number) {
    if (!this.enabled || !this.context || !this.master) state = "off";
    if (!this.context || !this.master) return;
    if (!this.seekerTone) {
      const oscillator = this.context.createOscillator(), gain = this.context.createGain();
      oscillator.type = "triangle";
      gain.gain.value = 0;
      oscillator.connect(gain).connect(this.master);
      oscillator.start();
      this.seekerTone = { oscillator, gain };
    }
    const { oscillator, gain } = this.seekerTone;
    const now = this.context.currentTime;
    oscillator.frequency.setTargetAtTime(state === "lock" ? 1320 : 260 + Math.sin(time * 22) * 45, now, .012);
    gain.gain.setTargetAtTime(state === "off" ? 0 : state === "lock" ? .05 : .035, now, .02);
  }
  /** A low thump that falls off with distance and arrives with the speed of sound. */
  blast(distance: number) {
    if (!this.enabled || !this.context || !this.master) return;
    const ctx = this.context;
    if (!this.blastNoise) {
      this.blastNoise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 1.4), ctx.sampleRate);
      const samples = this.blastNoise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length) ** 3;
    }
    const source = ctx.createBufferSource(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    source.buffer = this.blastNoise;
    filter.type = "lowpass";
    filter.frequency.value = Math.max(160, 1100 - distance * .5);
    gain.gain.value = Math.min(.5, 240 / (distance + 240));
    source.connect(filter).connect(gain).connect(this.master);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(ctx.currentTime + Math.min(3, distance / 343));
  }
  /** The rush of a motor leaving the rail. */
  launch() {
    if (!this.enabled || !this.context || !this.master || !this.cannonNoise && !this.blastNoise) return;
    const ctx = this.context;
    const source = ctx.createBufferSource(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    source.buffer = this.blastNoise ?? this.cannonNoise!;
    filter.type = "bandpass";
    filter.frequency.value = 1500;
    gain.gain.value = .14;
    source.connect(filter).connect(gain).connect(this.master);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start();
  }
  // Voice clips are optional; a missing or undecodable file resolves to null.
  loadVoice(url: string) {
    const ctx = this.context;
    if (!ctx) return Promise.resolve(null);
    let clip = this.voiceCache.get(url);
    if (!clip) {
      clip = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => null);
      this.voiceCache.set(url, clip);
    }
    return clip;
  }
  playVoice(buffers: AudioBuffer[]) {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    this.stopVoice();
    if (!this.voiceGain) {
      this.voiceGain = ctx.createGain();
      this.voiceGain.gain.value = 0.9;
      this.voiceGain.connect(this.master);
    }
    let at = ctx.currentTime + 0.02;
    this.voiceSources = buffers.map((buffer) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.voiceGain!);
      source.start(at);
      at += buffer.duration;
      return source;
    });
  }
  stopVoice() {
    for (const source of this.voiceSources) {
      try {
        source.stop();
      } catch {
        /* Already stopped. */
      }
    }
    this.voiceSources = [];
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
  /** @param inferGun recordings have no trigger, so firing is read from the barrel speed. */
  update(
    throttle: number,
    speed: number,
    active: boolean,
    volume = 1,
    { burner = 0, gunSpool = 0, inferGun = false } = {},
  ) {
    if (!this.context || !this.windGain) return;
    const t = this.context.currentTime;
    const on = this.enabled && active;
    const voice = this.voice;
    const propeller = voice === "piston" || voice === "turboprop";
    if (propeller) {
      this.propEngine ??= new PropEngineSound(this.context, this.master!);
      this.propEngine.update(voice, throttle, on ? volume : 0);
      this.jetEngine?.update(0, 0, 0, 0);
    } else {
      this.jetEngine ??= new JetEngineSound(this.context, this.master!);
      this.jetEngine.update(throttle, burner, speed, on ? volume : 0, voice === "business-jet" ? BUSINESS_JET : FIGHTER);
      this.propEngine?.update("piston", 0, 0);
    }
    if (inferGun && on && gunFiringFromSpool(this.previousSpool, gunSpool)) this.cannonBurst();
    this.previousSpool = gunSpool;
    this.gun?.update(gunSpool, on);
    this.windGain.gain.setTargetAtTime(
      on && propeller ? Math.min(0.09, speed * 0.0012) * volume : 0,
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
