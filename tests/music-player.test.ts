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
  const releases: (() => void)[] = [];
  const requested: string[] = [];
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
  const makeElement = () => {
    const events = new Map<string, () => void>();
    const element = {
      duration: 0,
      currentTime: 0,
      loop: false,
      playing: false,
      released: false,
      url: "",
      addEventListener: (name: string, listener: () => void) =>
        events.set(name, listener),
      removeEventListener: (name: string) => events.delete(name),
      play: async () => {
        element.playing = true;
      },
      pause() {
        element.playing = false;
      },
      load() {},
      removeAttribute() {
        element.released = true;
      },
      set src(url: string) {
        element.url = url;
        requested.push(url);
        const id = url.split("/audio/")[1].split("/")[0];
        element.duration = trackDuration(getMusicTrack(id));
        const ready = () => events.get("canplay")?.();
        if (id === hold) releases.push(ready);
        else queueMicrotask(ready);
      },
    };
    elements.push(element);
    return element;
  };
  const elements: ReturnType<typeof makeElement>[] = [];
  const connected: { element: ReturnType<typeof makeElement> }[] = [];
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
    createMediaElementSource: (element: ReturnType<typeof makeElement>) => {
      connected.push({ element });
      return node();
    },
  };
  const player = new FlightMusic(
    context as unknown as AudioContext,
    node() as unknown as AudioNode,
    () => makeElement() as unknown as HTMLAudioElement,
  );
  cleanup.push(() => player.dispose());
  return { player, context, connected, elements, releases, requested, saved };
}

describe("soundtrack switching", () => {
  it("plays each song's three layers on a loop and retires the previous song", async () => {
    const { player, connected, saved } = setup();
    player.update(state, true);
    await settle();
    expect(player.getState().activeTrackId).toBe("coastlines");
    expect(connected).toHaveLength(3);
    expect(connected.every(({ element }) => element.playing && element.loop)).toBe(true);
    player.selectTrack("blue-hour");
    expect(player.getState().activeTrackId).toBe("coastlines");
    await settle();
    expect(player.getState().activeTrackId).toBe("blue-hour");
    expect(saved.get("pocket-flight-music-track")).toBe("blue-hour");
    expect(connected).toHaveLength(6);
    expect(connected.slice(3).every(({ element }) => element.playing)).toBe(true);
    // The old song is still fading out, then its streams are released.
    expect(connected.slice(0, 3).every(({ element }) => element.playing)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1250));
    expect(connected.slice(0, 3).every(({ element }) => element.released)).toBe(true);
  });
  it("ignores stale loads when the user changes songs rapidly", async () => {
    const { player, connected, elements, releases } = setup("blue-hour");
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
    expect(connected).toHaveLength(6);
    expect(
      elements.filter((element) => element.url.includes("blue-hour")).every((element) => element.released),
    ).toBe(true);
  });
  it("realigns a stem that drifts from the others", async () => {
    const { player, connected, context } = setup();
    player.update(state, true);
    await settle();
    connected[0].element.currentTime = 40;
    connected[1].element.currentTime = 40.02;
    connected[2].element.currentTime = 41;
    context.currentTime += 2;
    player.update(state, true);
    expect(connected[1].element.currentTime).toBe(40.02);
    expect(connected[2].element.currentTime).toBe(40);
  });
  it("does not request songs at zero volume and cancels loading on disposal", async () => {
    const { player, connected, elements, releases, requested } = setup("blue-hour");
    player.setVolume(0);
    player.update(state, true);
    player.selectTrack("blue-hour");
    expect(requested).toHaveLength(0);
    player.setVolume(0.62);
    await settle();
    player.dispose();
    releases.forEach((release) => release());
    await settle();
    expect(connected).toHaveLength(0);
    expect(elements.every((element) => element.released)).toBe(true);
  });
});
