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
const maxStemDrift = 0.06;
type Stem = {
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
};

function releaseElement(element: HTMLAudioElement) {
  element.pause();
  element.removeAttribute("src");
  element.load();
}

function closeStem({ element, source, gain }: Stem) {
  releaseElement(element);
  source.disconnect();
  gain.disconnect();
}

export class FlightMusic {
  private readonly bus: GainNode;
  private readonly filter: BiquadFilterNode;
  private abort: AbortController | null = null;
  private requestId = 0;
  private retiring = new Map<Stem, ReturnType<typeof setTimeout>>();
  private playingTrack: MusicTrack | null = null;
  track = getMusicTrack("coastlines");
  private stems: Stem[] = [];
  private disposed = false;
  private active = false;
  private state = defaultState;
  private targets: number[] = [];
  private lastSync = 0;
  volume = 0.62;
  status: "idle" | "loading" | "ready" | "error" = "idle";
  error: string | null = null;

  constructor(
    private readonly context: AudioContext,
    output: AudioNode,
    private readonly createElement: () => HTMLAudioElement = () => new Audio(),
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
      ...this.stems.map((stem) => stem.gain.gain),
      this.bus.gain,
      this.filter.frequency,
    ];
    // Only automate material changes; keep the audio queue bounded.
    this.keepStemsTogether();
    if (this.stems.length === 3)
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

  // Stems play from separate elements, so correct any drift between them.
  private keepStemsTogether() {
    if (this.stems.length !== 3 || !this.playingTrack) return;
    if (Math.abs(this.context.currentTime - this.lastSync) < 1) return;
    this.lastSync = this.context.currentTime;
    const duration = trackDuration(this.playingTrack),
      lead = this.stems[0].element;
    for (const { element } of this.stems.slice(1)) {
      const apart = Math.abs(element.currentTime - lead.currentTime);
      if (Math.min(apart, duration - apart) > maxStemDrift)
        element.currentTime = lead.currentTime;
    }
  }

  // Streaming keeps a few megabytes per stem; decoding a song takes about 190 MB.
  private openStem(url: string, duration: number, signal: AbortSignal) {
    return new Promise<HTMLAudioElement>((resolve, reject) => {
      const element = this.createElement();
      const finish = (failure?: unknown) => {
        element.removeEventListener("canplay", ready);
        element.removeEventListener("error", failed);
        signal.removeEventListener("abort", aborted);
        if (failure === undefined) return resolve(element);
        releaseElement(element);
        reject(failure);
      };
      const ready = () =>
        finish(
          Math.abs(element.duration - duration) > 0.08
            ? new Error("Soundtrack loop duration does not match the score.")
            : undefined,
        );
      const failed = () => finish(new Error(`Music request failed: ${url}`));
      const aborted = () => finish(signal.reason ?? new Error("Aborted"));
      element.addEventListener("canplay", ready);
      element.addEventListener("error", failed);
      signal.addEventListener("abort", aborted);
      element.loop = true;
      element.preload = "auto";
      element.src = url;
    });
  }

  private retire(stem: Stem) {
    this.retiring.set(
      stem,
      setTimeout(() => {
        this.retiring.delete(stem);
        closeStem(stem);
      }, 1200),
    );
  }

  private async load() {
    this.status = "loading";
    this.error = null;
    const track = this.track,
      duration = trackDuration(track),
      request = this.requestId;
    const abort = (this.abort = new AbortController());
    let opened: HTMLAudioElement[] = [];
    try {
      const results = await Promise.allSettled(
        musicStems.map(async (stem) => {
          let failure: unknown;
          for (const extension of ["ogg", "mp3"]) {
            try {
              return await this.openStem(
                `${import.meta.env?.BASE_URL ?? "/"}audio/${track.id}/${stem}.${extension}`,
                duration,
                abort.signal,
              );
            } catch (error) {
              if (abort.signal.aborted) throw error;
              failure = error;
            }
          }
          throw failure;
        }),
      );
      opened = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      for (const result of results)
        if (result.status === "rejected") throw result.reason;
      if (this.disposed || request !== this.requestId) {
        opened.forEach(releaseElement);
        return;
      }
      const now = this.context.currentTime;
      for (const stem of this.stems) {
        const gain = stem.gain.gain;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(gain.value, now);
        gain.linearRampToValueAtTime(0, now + 1.1);
        this.retire(stem);
      }
      this.stems = opened.map((element) => {
        const source = this.context.createMediaElementSource(element),
          gain = this.context.createGain();
        gain.gain.value = 0;
        source.connect(gain).connect(this.filter);
        return { element, source, gain };
      });
      await Promise.all(opened.map((element) => element.play()));
      if (this.disposed || request !== this.requestId) return;
      this.playingTrack = track;
      this.status = "ready";
      this.targets = [];
      this.update(this.state, this.active);
    } catch (error) {
      if (this.disposed || request !== this.requestId || abort.signal.aborted) {
        if (!this.stems.some(({ element }) => opened.includes(element)))
          opened.forEach(releaseElement);
        return;
      }
      opened.forEach(releaseElement);
      this.stems = this.stems.filter(({ element }) => !opened.includes(element));
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
        this.stems.length === 3 &&
        this.active &&
        this.context.state === "running" &&
        this.state.visible &&
        this.volume > 0,
      elapsed: this.playingTrack ? (this.stems[0]?.element.currentTime ?? 0) : 0,
      mix: musicMix(this.state),
      context: this.context.state,
    };
  }

  dispose() {
    this.disposed = true;
    this.abort?.abort();
    for (const [stem, timer] of this.retiring) {
      clearTimeout(timer);
      closeStem(stem);
    }
    this.retiring.clear();
    this.stems.forEach(closeStem);
    this.stems = [];
    this.filter.disconnect();
    this.bus.disconnect();
  }
}
