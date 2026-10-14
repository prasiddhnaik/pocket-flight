import { describe, expect, test } from "bun:test";
import { Betty, bettyFiles, CHIME_SECONDS, idleCallouts, planCallout } from "../src/betty";
import { FlightAudio } from "../src/audio";

const len = () => 1.2;

describe("betty scheduling", () => {
  test("a new warning plays with the master-caution chime", () => {
    const r = planCallout(idleCallouts(), ["stall"], 0, len);
    expect(r.callout).toEqual({ id: "stall", chime: true });
    expect(r.state.busyUntil).toBeCloseTo(1.2 + CHIME_SECONDS);
  });
  test("repeating warnings wait for their interval and skip the chime", () => {
    let r = planCallout(idleCallouts(), ["stall"], 0, len);
    r = planCallout(r.state, ["stall"], 1.0, len);
    expect(r.callout).toBeNull();
    r = planCallout(r.state, ["stall"], 2.0, len);
    expect(r.callout).toEqual({ id: "stall", chime: false });
  });
  test("one-shot warnings play once while they stay active", () => {
    let r = planCallout(idleCallouts(), ["fuelLow"], 0, len);
    expect(r.callout?.id).toBe("fuelLow");
    r = planCallout(r.state, ["fuelLow"], 10, len);
    expect(r.callout).toBeNull();
  });
  test("a higher-priority warning interrupts a lower one", () => {
    let r = planCallout(idleCallouts(), ["bankAngle"], 0, len);
    r = planCallout(r.state, ["pullUp", "bankAngle"], 0.3, len);
    expect(r.stop).toBe(true);
    expect(r.callout).toEqual({ id: "pullUp", chime: true });
  });
  test("a lower-priority warning never interrupts", () => {
    let r = planCallout(idleCallouts(), ["pullUp"], 0, len);
    r = planCallout(r.state, ["pullUp", "fuelLow"], 0.5, len);
    expect(r.callout).toBeNull();
    expect(r.stop).toBe(false);
  });
  test("fresh damage plays between stall repeats", () => {
    let r = planCallout(idleCallouts(), ["stall"], 0, len);
    r = planCallout(r.state, ["stall"], 2, len);
    expect(r.callout).toEqual({ id: "stall", chime: false });
    r = planCallout(r.state, ["stall", "damage"], 3.3, len);
    expect(r.callout).toEqual({ id: "damage", chime: true });
    expect(r.stop).toBe(false);
  });
  test("fresh damage waits for a playing stall to finish", () => {
    let r = planCallout(idleCallouts(), ["stall"], 0, len);
    r = planCallout(r.state, ["stall", "damage"], 0.5, len);
    expect(r.callout).toBeNull();
    expect(r.stop).toBe(false);
    expect(r.state.announced).toEqual(["stall"]);
  });
  test("clearing warnings stops the voice even after its deadline", () => {
    let r = planCallout(idleCallouts(), ["stall"], 0, len);
    r = planCallout(r.state, [], 2, len);
    expect(r.stop).toBe(true);
    expect(r.state.playing).toBeNull();
    expect(r.state.announced).toEqual([]);
    r = planCallout(r.state, [], 3, len);
    expect(r.stop).toBe(false);
  });
  test("clearing all warnings stops the voice and forgets announcements", () => {
    let r = planCallout(idleCallouts(), ["stall"], 0, len);
    r = planCallout(r.state, [], 0.5, len);
    expect(r.stop).toBe(true);
    expect(r.state.announced).toEqual([]);
    r = planCallout(r.state, ["stall"], 0.6, len);
    expect(r.callout).toEqual({ id: "stall", chime: true });
  });
});

// AudioBuffer construction requires a browser; these tests only consume duration.
const buffer = (duration: number) => ({ duration }) as AudioBuffer;

const flushPreload = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("Betty playback", () => {
  test("a one-shot waits silently for its voice buffer even with a loaded chime", async () => {
    const audio = new FlightAudio();
    audio.enabled = true;
    const chime = buffer(0.4);
    const voice = buffer(1.2);
    let decode = (_clip: AudioBuffer | null) => {};
    const pending = new Promise<AudioBuffer | null>((resolve) => { decode = resolve; });
    audio.loadVoice = async (url) => url.endsWith("damage.mp3") ? pending : url.endsWith("chime.mp3") ? chime : null;
    const played: AudioBuffer[][] = [];
    audio.playVoice = (clips) => { played.push(clips); };
    const betty = new Betty(audio);
    betty.update([], 0);
    await flushPreload();
    betty.update(["damage"], 0.25);
    betty.update(["damage"], 0.5);
    expect(played).toEqual([]);
    decode(voice);
    await flushPreload();
    betty.update(["damage"], 1);
    expect(played).toEqual([[chime, voice]]);
    betty.update(["damage"], 10);
    expect(played).toHaveLength(1);
  });

  test("missing clips stay silent and preload retries once audio is ready", async () => {
    const audio = new FlightAudio();
    audio.enabled = true;
    let ready = false;
    const urls: string[] = [];
    const played: AudioBuffer[][] = [];
    audio.loadVoice = async (url) => {
      urls.push(url);
      return ready ? buffer(url.endsWith("chime.mp3") ? 0.4 : 1.2) : null;
    };
    audio.playVoice = (clips) => { played.push(clips); };
    const betty = new Betty(audio);
    betty.update(["stall"], 0);
    await flushPreload();
    expect(played).toEqual([]);
    expect(urls).toEqual(Object.values(bettyFiles).map((file) => `/audio/betty/${file}.mp3`));
    ready = true;
    betty.silence();
    betty.update([], 1);
    await flushPreload();
    betty.update(["stall"], 2);
    expect(urls).toHaveLength(18);
    expect(played[0].map((clip) => clip.duration)).toEqual([0.4, 1.2]);
    betty.update(["stall"], 4);
    expect(played[1].map((clip) => clip.duration)).toEqual([1.2]);
    expect(urls).toHaveLength(18);
  });

  test("disable and silence stop playback and re-arm fresh callouts", async () => {
    const audio = new FlightAudio();
    audio.enabled = true;
    audio.loadVoice = async () => buffer(0.4);
    let stops = 0;
    const played: AudioBuffer[][] = [];
    audio.stopVoice = () => { stops++; };
    audio.playVoice = (clips) => { played.push(clips); };
    const betty = new Betty(audio);
    betty.update([], 0);
    await flushPreload();
    betty.update(["stall"], 1);
    betty.enabled = false;
    betty.update(["stall"], 1.1);
    expect(stops).toBe(1);
    betty.enabled = true;
    audio.enabled = false;
    betty.update(["stall"], 1.2);
    expect(played).toHaveLength(1);
    audio.enabled = true;
    betty.update(["stall"], 1.3);
    expect(played[1]).toHaveLength(2);
    betty.silence();
    expect(stops).toBe(2);
    betty.update(["stall"], 1.4);
    expect(played[2]).toHaveLength(2);
  });
});

describe("FlightAudio voice methods", () => {
  test("no context resolves silently without caching a premature miss", async () => {
    const audio = new FlightAudio();
    expect(await audio.loadVoice("data:audio/mpeg;base64,AA==")).toBeNull();
    const decoded = buffer(1.2);
    Reflect.set(audio, "context", { decodeAudioData: async () => decoded });
    const clip = audio.loadVoice("data:audio/mpeg;base64,AA==");
    expect(audio.loadVoice("data:audio/mpeg;base64,AA==")).toBe(clip);
    expect(await clip).toBe(decoded);
    expect(await audio.loadVoice("unsupported-protocol://missing")).toBeNull();
    Reflect.set(audio, "context", { decodeAudioData: async () => { throw new Error("Bad clip"); } });
    expect(await audio.loadVoice("data:audio/mpeg;base64,AQ==")).toBeNull();
  });

  test("clips schedule sequentially through master gain and stopping is safe", () => {
    const audio = new FlightAudio();
    const master = {};
    const connections: unknown[] = [];
    const starts: number[] = [];
    let stops = 0;
    let gains = 0;
    const voiceGain = { gain: { value: 0 }, connect: (node: unknown) => connections.push(node) };
    Reflect.set(audio, "master", master);
    Reflect.set(audio, "context", {
      currentTime: 10,
      createGain: () => { gains++; return voiceGain; },
      createBufferSource: () => ({
        buffer: null,
        connect: (node: unknown) => connections.push(node),
        start: (at: number) => starts.push(at),
        stop: () => { stops++; throw new Error("Already stopped"); },
      }),
    });
    audio.playVoice([buffer(0.4), buffer(1.2)]);
    expect(voiceGain.gain.value).toBe(0.9);
    expect(connections).toEqual([master, voiceGain, voiceGain]);
    expect(starts[0]).toBeCloseTo(10.02);
    expect(starts[1]).toBeCloseTo(10.42);
    audio.playVoice([buffer(1.2)]);
    expect(stops).toBe(2);
    expect(gains).toBe(1);
    audio.stopVoice();
    audio.stopVoice();
    expect(stops).toBe(3);
  });
});
