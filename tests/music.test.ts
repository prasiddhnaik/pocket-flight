import { describe, expect, it } from "bun:test";
import { musicMix, musicStems } from "../src/music-mix";
import { getMusicTrack, musicTracks, trackDuration } from "../src/music-tracks";
import { createHash } from "node:crypto";
import type { MusicState } from "../src/music-mix";

const menu: MusicState = {
  mode: "menu",
  speed: 0,
  grounded: true,
  night: false,
  warning: false,
  visible: true,
};
const cruise: MusicState = {
  ...menu,
  mode: "playing",
  grounded: false,
  speed: 60,
};

describe("Coastlines adaptive score", () => {
  it("opens up after takeoff and keeps percussion out of the menu and pause", () => {
    const idle = musicMix(menu),
      runway = musicMix({ ...cruise, grounded: true }),
      flight = musicMix(cruise);
    expect(idle.pulse).toBe(0);
    expect(runway.pulse).toBeGreaterThan(idle.pulse);
    expect(flight.pulse).toBeGreaterThan(runway.pulse);
    expect(flight.air).toBeGreaterThan(runway.air);
    const pause = musicMix({ ...cruise, mode: "paused" });
    expect(pause.pulse).toBe(0);
    expect(pause.foundation).toBeLessThan(idle.foundation);
  });
  it("softens nighttime, ducks flight warnings, and silences every layer when hidden", () => {
    const day = musicMix(cruise),
      night = musicMix({ ...cruise, night: true });
    expect(night.cutoff).toBeLessThan(day.cutoff);
    expect(night.air).toBeLessThan(day.air);
    expect(night.pulse).toBeLessThan(day.pulse);
    const warning = musicMix({ ...cruise, warning: true });
    for (const stem of musicStems)
      expect(warning[stem]).toBeCloseTo(day[stem] * 0.4);
    const hidden = musicMix({ ...cruise, visible: false });
    for (const stem of musicStems) expect(hidden[stem]).toBe(0);
  });
  it("contains invalid speed and keeps replay arrangements consistent with flight", () => {
    for (const speed of [NaN, Infinity, -100, 0, 1e9]) {
      const mix = musicMix({ ...cruise, speed });
      for (const stem of musicStems) {
        expect(Number.isFinite(mix[stem])).toBe(true);
        expect(mix[stem]).toBeGreaterThanOrEqual(0);
        expect(mix[stem]).toBeLessThanOrEqual(1);
      }
    }
    expect(musicMix({ ...cruise, mode: "replay" })).toEqual(musicMix(cruise));
  });
  it("ships three distinct songs with matching loop stems and different musical identities", async () => {
    const hashes = new Set<string>();
    expect(new Set(musicTracks.map((track) => track.bpm)).size).toBe(3);
    expect(new Set(musicTracks.map((track) => track.key)).size).toBe(3);
    for (const track of musicTracks) {
      const root = `${import.meta.dir}/../public/audio/${track.id}`;
      const score = await Bun.file(`${root}/score.json`).json();
      expect(score.title).toBe(track.title);
      expect(score.bpm).toBe(track.bpm);
      expect(score.beatsPerBar).toBe(track.beatsPerBar);
      expect(score.duration).toBe(trackDuration(track));
      expect(score.frames).toBe(
        Math.round(trackDuration(track) * score.sampleRate),
      );
      expect(score.stems).toEqual([...musicStems]);
      expect(score.fullMixPeakDb).toBeLessThan(-1);
      for (const stem of musicStems)
        for (const extension of ["ogg", "mp3"]) {
          expect(Bun.file(`${root}/${stem}.${extension}`).size).toBeGreaterThan(
            100000,
          );
        }
      hashes.add(
        createHash("sha256")
          .update(
            new Uint8Array(
              await Bun.file(`${root}/${track.id}-listening.mp3`).arrayBuffer(),
            ),
          )
          .digest("hex"),
      );
    }
    expect(hashes.size).toBe(3);
    expect(getMusicTrack("bad saved preference").id).toBe("coastlines");
  });
});
