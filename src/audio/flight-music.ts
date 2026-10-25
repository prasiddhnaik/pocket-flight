import { musicMix, musicStems } from "./music-mix";
import type { MusicState } from "./music-mix";
import { getMusicTrack, trackDuration } from "./music-tracks";
import type { MusicTrack, MusicTrackId } from "./music-tracks";

const defaultState: MusicState = {
  mode: "menu",
  speed: 0,
  grounded: true,
  night: false,
  warning: false,
  visible: true,
};
const preferenceKey = "pocket-flight-music-volume";

export class FlightMusic {
  private readonly bus: GainNode;
  private readonly filter: BiquadFilterNode;
  private abort: AbortController | null = null;
  private requestId = 0;
  private retiring = new Map<AudioBufferSourceNode, GainNode>();
  private playingTrack: MusicTrack | null = null;
  track = getMusicTrack("coastlines");
  private gains: GainNode[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private disposed = false;
  private active = false;
  private state = defaultState;
  private targets: number[] = [];
  private startedAt = 0;
  volume = 0.62;
  status: "idle" | "loading" | "ready" | "error" = "idle";
  error: string | null = null;

  constructor(
    private readonly context: AudioContext,
    output: AudioNode,
  ) {
    try {
      this.track = getMusicTrack(
        localStorage.getItem("pocket-flight-music-track"),
      );
      const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? "null");
      if (typeof saved === "number" && Number.isFinite(saved))
        this.volume = Math.max(0, Math.min(1, saved));
    } catch {
      /* Audio also works when storage is unavailable. */
    }
    this.bus = context.createGain();
    this.bus.gain.value = 0;
    this.filter = context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 14000;
    this.filter.Q.value = 0.45;
    this.filter.connect(this.bus).connect(output);
  }

  setVolume(value: number) {
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(this.volume));
    } catch {
      /* Optional persistence. */
    }
    if (this.status === "error" && this.volume > 0) this.status = "idle";
    this.update(this.state, this.active);
  }

  selectTrack(id: MusicTrackId) {
    const track = getMusicTrack(id);
    if (track.id === this.track.id && this.status !== "error") return;
    this.track = track;
    this.requestId++;
    this.abort?.abort();
    this.status = "idle";
    this.error = null;
    try {
      localStorage.setItem("pocket-flight-music-track", track.id);
    } catch {
      /* Optional persistence. */
    }
    this.update(this.state, this.active);
  }

  update(state: MusicState, enabled: boolean) {
    if (this.disposed) return;
    this.state = state;
    this.active = enabled;
    if (enabled && state.visible && this.volume > 0 && this.status === "idle")
      void this.load();
    const mix = musicMix(state);
    const next = [
      ...musicStems.map((stem) => mix[stem]),
      enabled && state.visible ? this.volume : 0,
      mix.cutoff,
    ];
    const parameters = [
      ...this.gains.map((gain) => gain.gain),
      this.bus.gain,
      this.filter.frequency,
    ];
    // Only automate material changes; keep the audio queue bounded.
    if (this.gains.length === 3)
      parameters.forEach((parameter, i) => {
        if (
          this.targets[i] !== undefined &&
          Math.abs(this.targets[i] - next[i]) < (i === 4 ? 1 : 0.015)
        )
          return;
        const immediateMute = i === 3 && next[i] === 0;
        parameter.setTargetAtTime(
          next[i],
          this.context.currentTime,
          immediateMute ? 0.04 : i === 4 ? 1.2 : 0.8,
        );
        this.targets[i] = next[i];
      });
    else if (this.targets[3] !== next[3]) {
      this.bus.gain.setTargetAtTime(
        next[3],
        this.context.currentTime,
        next[3] === 0 ? 0.04 : 0.8,
      );
      this.targets[3] = next[3];
    }
  }

  private async load() {
    this.status = "loading";
    this.error = null;
    const track = this.track,
      duration = trackDuration(track),
      request = this.requestId;
    const abort = (this.abort = new AbortController());
    try {
      const buffers = await Promise.all(
        musicStems.map(async (stem) => {
          let failure: unknown;
          for (const extension of ["ogg", "mp3"]) {
            try {
              const url = `${import.meta.env?.BASE_URL ?? "/"}audio/${track.id}/${stem}.${extension}`;
              const response = await fetch(url, { signal: abort.signal });
              if (!response.ok)
                throw new Error(`Music request failed (${response.status})`);
              const buffer = await this.context.decodeAudioData(
                await response.arrayBuffer(),
              );
              if (Math.abs(buffer.duration - duration) > 0.08)
                throw new Error(
                  "Soundtrack loop duration does not match the score.",
                );
              return buffer;
            } catch (error) {
              if (abort.signal.aborted) throw error;
              failure = error;
            }
          }
          throw failure;
        }),
      );
      if (this.disposed || request !== this.requestId) return;
      const at = this.context.currentTime + 0.08;
      this.sources.forEach((source, i) => {
        const gain = this.gains[i];
        gain.gain.cancelScheduledValues(this.context.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, this.context.currentTime);
        gain.gain.linearRampToValueAtTime(0, at + 1.1);
        this.retiring.set(source, gain);
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
          this.retiring.delete(source);
        };
        source.stop(at + 1.2);
      });
      this.sources = [];
      this.gains = [];
      buffers.forEach((buffer) => {
        const source = this.context.createBufferSource(),
          gain = this.context.createGain();
        source.buffer = buffer;
        source.loop = true;
        source.loopStart = 0;
        source.loopEnd = duration;
        gain.gain.value = 0;
        source.connect(gain).connect(this.filter);
        source.start(at);
        this.sources.push(source);
        this.gains.push(gain);
      });
      this.startedAt = at;
      this.playingTrack = track;
      this.status = "ready";
      this.targets = [];
      this.update(this.state, this.active);
    } catch (error) {
      if (this.disposed || request !== this.requestId || abort.signal.aborted)
        return;
      this.status = "error";
      this.error =
        error instanceof Error
          ? error.message
          : "The soundtrack could not load.";
      // Never interrupt flight or engine audio if a music request fails.
      console.warn(this.error);
    }
  }

  getState() {
    return {
      title: this.playingTrack?.title ?? this.track.title,
      trackId: this.track.id,
      activeTrackId: this.playingTrack?.id ?? null,
      status: this.status,
      volume: this.volume,
      error: this.error,
      playing:
        this.sources.length === 3 &&
        this.active &&
        this.context.state === "running" &&
        this.state.visible &&
        this.volume > 0,
      elapsed: this.playingTrack
        ? Math.max(0, this.context.currentTime - this.startedAt) %
          trackDuration(this.playingTrack)
        : 0,
      mix: musicMix(this.state),
      context: this.context.state,
    };
  }

  dispose() {
    this.disposed = true;
    this.abort?.abort();
    for (const [source, gain] of this.retiring) {
      source.stop();
      source.disconnect();
      gain.disconnect();
    }
    this.retiring.clear();
    for (const source of this.sources) {
      source.stop();
      source.disconnect();
    }
    for (const gain of this.gains) gain.disconnect();
    this.sources = [];
    this.gains = [];
    this.filter.disconnect();
    this.bus.disconnect();
  }
}
