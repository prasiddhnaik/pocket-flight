import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { trackDuration } from "../src/audio/music-tracks";
import type { MusicTrack } from "../src/audio/music-tracks";

export async function createSynth(track: MusicTrack, initialSeed = 0x51c0a57) {
  const rate = 44100,
    bpm = track.bpm,
    beat = 60 / bpm,
    bars = track.bars;
  const duration = trackDuration(track),
    length = Math.round(duration * rate);
  const output = join(import.meta.dir, "../public/audio", track.id);
  const masters = join(import.meta.dir, "../output/soundtrack", track.id);
  await Promise.all([
    mkdir(output, { recursive: true }),
    mkdir(masters, { recursive: true }),
  ]);
  type Stereo = [Float32Array, Float32Array];
  const stereo = (): Stereo => [
    new Float32Array(length),
    new Float32Array(length),
  ];
  let seed = initialSeed;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const hz = (note: number) => 440 * 2 ** ((note - 69) / 12);
  const tau = 2 * Math.PI;
  const smooth = (x: number) => {
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
  };

  function voice(
    bus: Stereo,
    seconds: number,
    sustain: number,
    note: number,
    volume: number,
    pan: number,
    kind:
      | "keys"
      | "pad"
      | "bell"
      | "bass"
      | "rhodes"
      | "guitar"
      | "strings"
      | "analog"
      | "wood",
  ) {
    const frequency = hz(note),
      start = Math.round(seconds * rate);
    const tail =
      kind === "pad" ? 3 : kind === "keys" ? 3.8 : kind === "bell" ? 3.4 : 0.6;
    const count = Math.ceil((sustain + tail) * rate);
    const left = Math.cos(((pan + 1) * Math.PI) / 4) * volume;
    const right = Math.sin(((pan + 1) * Math.PI) / 4) * volume;
    const phase = random() * tau;
    for (let i = 0; i < count; i++) {
      const t = i / rate,
        w = tau * frequency * t;
      let sample: number;
      if (kind === "keys") {
        const decay = Math.exp(-t / (1.8 + (80 - note) * 0.025));
        const release = Math.exp(-Math.max(0, t - sustain) * 2.1);
        sample =
          (Math.sin(w) +
            0.3 * Math.sin(w * 2.001) * Math.exp(-t * 1.2) +
            0.13 * Math.sin(w * 3.004) * Math.exp(-t * 2) +
            0.08 * Math.sin(w * 4.011) * Math.exp(-t * 3) +
            0.045 * Math.sin(w * 7.025) * Math.exp(-t * 6)) *
          decay *
          release *
          smooth(t / 0.006);
      } else if (kind === "pad") {
        const envelope = smooth(t / 1.3) * (1 - smooth((t - sustain) / tail));
        sample =
          (0.54 * Math.sin(w + phase) +
            0.22 * Math.sin(w * 1.002 + phase) +
            0.14 * Math.sin(w * 0.998 - phase) +
            0.07 * Math.sin(w * 2) +
            0.03 * Math.sin(w * 3)) *
          envelope *
          (0.94 + 0.06 * Math.sin(t * tau * 0.17 + phase));
      } else if (kind === "bell") {
        sample =
          (Math.sin(w + 0.75 * Math.sin(w * 2) * Math.exp(-t * 3)) +
            0.1 * Math.sin(w * 3)) *
          Math.exp(-t * 1.2) *
          Math.exp(-Math.max(0, t - sustain) * 1.8) *
          smooth(t / 0.009);
      } else if (kind === "rhodes") {
        sample =
          (Math.sin(w + 0.65 * Math.sin(w * 2) * Math.exp(-t * 2.7)) +
            0.09 * Math.sin(w * 3)) *
          smooth(t / 0.009) *
          Math.exp(-t / 2.1) *
          Math.exp(-Math.max(0, t - sustain) * 2.3);
      } else if (kind === "guitar") {
        sample =
          (Math.sin(w) +
            0.42 * Math.sin(w * 2.001) * Math.exp(-t * 1.8) +
            0.22 * Math.sin(w * 3.003) * Math.exp(-t * 2.5) +
            0.14 * Math.sin(w * 4.006) * Math.exp(-t * 3.2) +
            0.06 * Math.sin(w * 5.01) * Math.exp(-t * 4.7)) *
          smooth(t / 0.004) *
          Math.exp(-t * 1.9) *
          Math.exp(-Math.max(0, t - sustain) * 2);
      } else if (kind === "strings") {
        const envelope = smooth(t / 0.5) * (1 - smooth((t - sustain) / 0.6));
        const vibrato = 0.12 * Math.sin(t * tau * 4.7) * smooth(t / 1.2);
        sample =
          (0.56 * Math.sin(w + vibrato) +
            0.25 * Math.sin(w * 1.003 + phase + vibrato) +
            0.15 * Math.sin(w * 2 + vibrato) +
            0.08 * Math.sin(w * 3)) *
          envelope;
      } else if (kind === "analog") {
        const brightness = Math.exp(-t * 3.8),
          envelope =
            smooth(t / 0.007) *
            Math.exp(-t * 1.7) *
            (1 - smooth((t - sustain) / 0.6));
        sample =
          (Math.sin(w) +
            0.34 * brightness * Math.sin(w * 2) +
            0.22 * brightness * Math.sin(w * 3) +
            0.13 * brightness * Math.sin(w * 4) +
            0.09 * brightness * Math.sin(w * 5) +
            0.18 * Math.sin(w * 1.004 + phase)) *
          envelope;
      } else if (kind === "wood") {
        sample =
          (Math.sin(w + 1.2 * Math.sin(w * 4) * Math.exp(-t * 18)) +
            0.17 * Math.sin(w * 3)) *
          smooth(t / 0.003) *
          Math.exp(-t * 4.4);
      } else {
        sample =
          (Math.sin(w) + 0.12 * Math.sin(w * 2) + 0.045 * Math.sin(w * 3)) *
          smooth(t / 0.015) *
          Math.exp(-t * 0.9) *
          (1 - smooth((t - sustain) / tail));
      }
      const index = (start + i + length) % length;
      bus[0][index] += sample * left;
      bus[1][index] += sample * right;
    }
  }

  function drum(
    bus: Stereo,
    seconds: number,
    kind: "kick" | "snare" | "hat" | "rim",
    volume: number,
    pan = 0,
  ) {
    const count = Math.round(
      rate * (kind === "kick" ? 0.6 : kind === "snare" ? 0.28 : 0.12),
    );
    const start = Math.round(seconds * rate);
    let low = 0,
      phase = 0;
    for (let i = 0; i < count; i++) {
      const t = i / rate,
        noise = random() * 2 - 1;
      low += (noise - low) * 0.16;
      let sample: number;
      if (kind === "kick") {
        phase += (tau * (48 + 90 * Math.exp(-t * 34))) / rate;
        sample = Math.sin(phase) * Math.exp(-t * 8) * smooth(t / 0.003);
      } else if (kind === "snare") {
        sample =
          (low * 0.75 + Math.sin(t * tau * 185) * Math.exp(-t * 45) * 0.22) *
          Math.exp(-t * 19) *
          smooth(t / 0.002);
      } else if (kind === "rim") {
        sample =
          (Math.sin(t * tau * 840) + Math.sin(t * tau * 1240) * 0.4) *
          Math.exp(-t * 90) *
          smooth(t / 0.001);
      } else {
        sample = (noise - low) * Math.exp(-t * 45) * smooth(t / 0.002);
      }
      const index = (start + i + length) % length;
      bus[0][index] += sample * volume * Math.cos(((pan + 1) * Math.PI) / 4);
      bus[1][index] += sample * volume * Math.sin(((pan + 1) * Math.PI) / 4);
    }
  }

  // Circular delays include the previous cycle's tails at the loop boundary.
  function delay(bus: Stereo, beats: number, wet: number) {
    const offset = Math.round(beats * beat * rate);
    const original: Stereo = [bus[0].slice(), bus[1].slice()];
    for (let i = 0; i < length; i++) {
      for (let tap = 1; tap <= 4; tap++) {
        const index = (i - offset * tap + length * 4) % length;
        const gain = wet * 0.43 ** (tap - 1);
        bus[0][i] += original[tap % 2][index] * gain;
        bus[1][i] += original[1 - (tap % 2)][index] * gain;
      }
    }
  }

  function reverb(bus: Stereo, wet: number) {
    for (let channel = 0; channel < 2; channel++) {
      const input = bus[channel].slice(),
        reverberated = new Float32Array(length);
      for (const seconds of [0.0371, 0.0437, 0.0533, 0.0617, 0.0719, 0.0839]) {
        const size = Math.round((seconds + channel * 0.0017) * rate),
          line = new Float32Array(size);
        const feedback = 10 ** ((-3 * seconds) / 2.8);
        let cursor = 0,
          damped = 0;
        // Prime from the final eight seconds rather than fading every loop to zero.
        for (let i = length - rate * 8; i < length * 1; i++) {
          damped += (line[cursor] - damped) * 0.22;
          line[cursor] = input[i] + damped * feedback;
          cursor = (cursor + 1) % size;
        }
        for (let i = 0; i < length; i++) {
          const sample = line[cursor];
          damped += (sample - damped) * 0.22;
          line[cursor] = input[i] + damped * feedback;
          cursor = (cursor + 1) % size;
          reverberated[i] += sample / 6;
        }
      }
      // Two all-pass diffusion stages soften the individual early reflections.
      for (const seconds of [0.0053, 0.0017]) {
        const size = Math.round(seconds * rate),
          line = new Float32Array(size);
        let cursor = 0;
        for (let i = -rate; i < length; i++) {
          const index = (i + length) % length,
            x = reverberated[index];
          const delayed = line[cursor],
            y = delayed - x * 0.55;
          line[cursor] = x + y * 0.55;
          cursor = (cursor + 1) % size;
          if (i >= 0) reverberated[i] = y;
        }
      }
      for (let i = 0; i < length; i++) bus[channel][i] += reverberated[i] * wet;
    }
  }

  async function render(buses: [Stereo, Stereo, Stereo]) {
    const [foundation, air, pulse] = buses;
    const mix = stereo();
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < length; i++) {
        mix[c][i] = foundation[c][i] + air[c][i] + pulse[c][i];
      }
    let peak = 0,
      squares = 0;
    for (let c = 0; c < 2; c++)
      for (const value of mix[c]) {
        peak = Math.max(peak, Math.abs(value));
        squares += value * value;
      }
    const masterGain = Math.min(1.5, 0.78 / peak);
    async function wav(name: string, bus: Stereo) {
      const data = Buffer.alloc(44 + length * 4);
      data.write("RIFF");
      data.writeUInt32LE(data.length - 8, 4);
      data.write("WAVEfmt ", 8);
      data.writeUInt32LE(16, 16);
      data.writeUInt16LE(1, 20);
      data.writeUInt16LE(2, 22);
      data.writeUInt32LE(rate, 24);
      data.writeUInt32LE(rate * 4, 28);
      data.writeUInt16LE(4, 32);
      data.writeUInt16LE(16, 34);
      data.write("data", 36);
      data.writeUInt32LE(length * 4, 40);
      let renderedPeak = 0,
        seam = 0;
      for (let i = 0; i < length; i++)
        for (let c = 0; c < 2; c++) {
          const value = bus[c][i] * masterGain;
          if (!Number.isFinite(value) || Math.abs(value) > 1)
            throw new Error(`${name}: invalid audio at ${i}`);
          renderedPeak = Math.max(renderedPeak, Math.abs(value));
          data.writeInt16LE(
            Math.round(
              Math.max(-1, Math.min(1, value + (random() - random()) / 65536)) *
                32767,
            ),
            44 + i * 4 + c * 2,
          );
        }
      for (let c = 0; c < 2; c++)
        seam = Math.max(
          seam,
          Math.abs(bus[c][0] - bus[c][length - 1]) * masterGain,
        );
      const path = join(masters, `${name}.wav`);
      await Bun.write(path, data);
      console.log(
        `${name}: ${duration.toFixed(3)}s, peak ${20 * Math.log10(renderedPeak)} dBFS, seam ${seam.toFixed(6)}`,
      );
      return path;
    }
    for (const [name, bus] of [
      ["foundation", foundation],
      ["air", air],
      ["pulse", pulse],
    ] as const) {
      const path = await wav(name, bus);
      for (const [extension, codec] of [
        ["ogg", ["-c:a", "libopus", "-b:a", "128k", "-vbr", "on"]],
        ["mp3", ["-c:a", "libmp3lame", "-b:a", "160k"]],
      ] as const) {
        const process = Bun.spawn(
          [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            path,
            ...codec,
            "-metadata",
            `title=${track.title} — ${name}`,
            join(output, `${name}.${extension}`),
          ],
          { stdout: "inherit", stderr: "inherit" },
        );
        if ((await process.exited) !== 0)
          throw new Error(`Encoding ${name}.${extension} failed`);
      }
    }
    await wav(track.id, mix);
    // A listening edition introduces the layers deliberately and resolves to a fade.
    const preview = Bun.spawn(
      [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        join(masters, "foundation.wav"),
        "-i",
        join(masters, "air.wav"),
        "-i",
        join(masters, "pulse.wav"),
        "-filter_complex",
        `[0:a]afade=t=in:d=2[f];[1:a]afade=t=in:st=16:d=10[a];[2:a]afade=t=in:st=30:d=12[p];[f][a][p]amix=inputs=3:normalize=0,afade=t=out:st=${duration - 8}:d=8[out]`,
        "-map",
        "[out]",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "256k",
        "-metadata",
        `title=${track.title}`,
        "-metadata",
        "album=Pocket Flight",
        join(output, `${track.id}-listening.mp3`),
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
    if ((await preview.exited) !== 0)
      throw new Error("Listening edition failed");
    await Bun.write(
      join(output, "score.json"),
      JSON.stringify(
        {
          title: track.title,
          bpm,
          bars,
          beatsPerBar: track.beatsPerBar,
          key: track.key,
          duration,
          sampleRate: rate,
          frames: length,
          stems: ["foundation", "air", "pulse"],
          fullMixPeakDb: 20 * Math.log10(peak * masterGain),
          fullMixRmsDb:
            20 * Math.log10(Math.sqrt(squares / (length * 2)) * masterGain),
          composition:
            "Original deterministic synthesis; no third-party recordings or samples.",
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `Saved ${track.title}: synchronized loops and listening edition.`,
    );
  }
  return {
    rate,
    bpm,
    beat,
    bars,
    length,
    duration,
    stereo,
    random,
    voice,
    drum,
    delay,
    reverb,
    render,
  };
}
