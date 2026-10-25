import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { FlightMusic } from "../src/audio/flight-music";
import { getMusicTrack, trackDuration } from "../src/audio/music-tracks";

const state = {
  mode: "menu",
  speed: 0,
  grounded: true,
  night: false,
  warning: false,
  visible: true,
} as const;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const action of cleanup.splice(0)) action();
});

function setup(hold?: string) {
  const saved = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    },
  });
  cleanup.push(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const releases: (() => void)[] = [],
    signals: AbortSignal[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async (input, options) => {
      const id = String(input).split("/audio/")[1].split("/")[0];
      if (options?.signal) signals.push(options.signal);
      const response = () =>
        new Response(String(trackDuration(getMusicTrack(id))));
      if (id === hold)
        return new Promise<Response>((resolve) =>
          releases.push(() => resolve(response())),
        );
      return response();
    },
  );
  cleanup.push(() => fetch.mockRestore());
  const parameter = () => ({
    value: 0,
    setTargetAtTime(value: number) {
      this.value = value;
    },
    setValueAtTime(value: number) {
      this.value = value;
    },
    linearRampToValueAtTime(value: number) {
      this.value = value;
    },
    cancelScheduledValues() {},
  });
  const node = () => ({
    disconnected: false,
    connect(target: unknown) {
      return target;
    },
    disconnect() {
      this.disconnected = true;
    },
  });
  const source = () => ({
    ...node(),
    buffer: null as { duration: number } | null,
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    started: null as number | null,
    stopped: null as number | null,
    onended: null as (() => void) | null,
    start(at: number) {
      this.started = at;
    },
    stop(at = 0) {
      this.stopped = at;
    },
  });
  const sources: ReturnType<typeof source>[] = [];
  const context = {
    currentTime: 10,
    state: "running",
    createGain: () => ({ ...node(), gain: parameter() }),
    createBiquadFilter: () => ({
      ...node(),
      frequency: parameter(),
      Q: parameter(),
      type: "lowpass",
    }),
    decodeAudioData: async (data: ArrayBuffer) => ({
      duration: Number(new TextDecoder().decode(data)),
    }),
    createBufferSource: () => {
      const next = source();
      sources.push(next);
      return next;
    },
  };
  const player = new FlightMusic(
    context as unknown as AudioContext,
    node() as unknown as AudioNode,
  );
  cleanup.push(() => player.dispose());
  return { player, context, sources, releases, fetch, saved, signals };
}

describe("soundtrack switching", () => {
  it("starts each song's three layers together and fades out the previous song", async () => {
    const { player, sources, context, saved } = setup();
    player.update(state, true);
    await settle();
    expect(player.getState().activeTrackId).toBe("coastlines");
    expect(sources).toHaveLength(3);
    expect(new Set(sources.map((source) => source.started)).size).toBe(1);
    context.currentTime = 20;
    player.selectTrack("blue-hour");
    expect(player.getState().activeTrackId).toBe("coastlines");
    await settle();
    expect(player.getState().activeTrackId).toBe("blue-hour");
    expect(saved.get("pocket-flight-music-track")).toBe("blue-hour");
    expect(sources).toHaveLength(6);
    expect(new Set(sources.slice(3).map((source) => source.started)).size).toBe(
      1,
    );
    expect(sources.slice(3).every((source) => source.loopEnd === 120)).toBe(
      true,
    );
    expect(
      sources
        .slice(0, 3)
        .every((source) => source.stopped! > context.currentTime),
    ).toBe(true);
    sources.slice(0, 3).forEach((source) => source.onended?.());
    expect(sources.slice(0, 3).every((source) => source.disconnected)).toBe(
      true,
    );
  });
  it("ignores stale loads when the user changes songs rapidly", async () => {
    const { player, sources, releases, signals } = setup("blue-hour");
    player.update(state, true);
    await settle();
    player.selectTrack("blue-hour");
    await settle();
    player.selectTrack("sunward");
    await settle();
    releases.forEach((release) => release());
    await settle();
    expect(player.getState().activeTrackId).toBe("sunward");
    expect(player.status).toBe("ready");
    expect(sources).toHaveLength(6);
    expect(signals.slice(3, 6).every((signal) => signal.aborted)).toBe(true);
  });
  it("does not download songs at zero volume and cancels loading on disposal", async () => {
    const { player, fetch, releases, sources, signals } = setup("blue-hour");
    player.setVolume(0);
    player.update(state, true);
    player.selectTrack("blue-hour");
    expect(fetch).not.toHaveBeenCalled();
    player.setVolume(0.62);
    await settle();
    player.dispose();
    releases.forEach((release) => release());
    await settle();
    expect(sources).toHaveLength(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
