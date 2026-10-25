import { createSynth } from "./music-synthesis";
import { getMusicTrack } from "../src/audio/music-tracks";
const { beat, bars, stereo, random, voice, drum, delay, reverb, render } =
  await createSynth(getMusicTrack("coastlines"));
const harmony = [
  { root: 38, notes: [57, 62, 66, 73, 76] }, // Dmaj9
  { root: 37, notes: [57, 61, 64, 69, 71] }, // Aadd9/C#
  { root: 35, notes: [54, 59, 62, 66, 69] }, // Bm11
  { root: 31, notes: [55, 59, 62, 66, 69] }, // Gmaj9
  { root: 30, notes: [57, 62, 66, 69, 76] }, // D/F#
  { root: 40, notes: [55, 59, 62, 66, 71] }, // Em9
  { root: 31, notes: [55, 59, 62, 66, 69] }, // Gmaj9
  { root: 33, notes: [57, 62, 64, 69, 71] }, // Asus4(add9)
];
type Note = [number, number, number]; // beat, MIDI pitch, duration in beats
const theme: Note[][] = [
  [
    [0.5, 78, 1.25],
    [2, 76, 0.7],
    [3, 74, 1.8],
  ],
  [
    [2, 69, 1.3],
    [3.5, 71, 0.6],
  ],
  [
    [0.5, 73, 1.5],
    [2.5, 76, 1.4],
  ],
  [[1, 73, 2.3]],
  [
    [0.5, 74, 1.25],
    [2, 78, 0.7],
    [3, 81, 1.5],
  ],
  [
    [1, 78, 1],
    [2.5, 76, 1.2],
  ],
  [
    [0.5, 74, 2],
    [3, 71, 0.8],
  ],
  [[1, 69, 2.4]],
];

const foundation = stereo(),
  air = stereo(),
  pulse = stereo();
for (let bar = 0; bar < bars; bar++) {
  const phrase = Math.floor(bar / 16),
    local = bar % 16;
  const chord = harmony[Math.floor(local / 2)];
  const time = bar * 4 * beat;
  const open = phrase === 1 || phrase === 3;
  if (bar % 2 === 0) {
    chord.notes.forEach((note, i) => {
      voice(
        foundation,
        time - 0.32,
        8 * beat - 0.3,
        note - 12,
        0.034,
        (i - 2) * 0.32,
        "pad",
      );
      voice(
        foundation,
        time + i * 0.027,
        3.6 * beat,
        note,
        0.051 - i * 0.004,
        (i - 2) * 0.23,
        "keys",
      );
    });
    voice(
      foundation,
      time + 0.012,
      3.2 * beat,
      chord.root + 12,
      0.054,
      -0.12,
      "keys",
    );
  } else {
    [1.5, 2.75].forEach((step, i) =>
      voice(
        foundation,
        time + step * beat,
        beat * 1.4,
        chord.notes[(local + i + phrase) % chord.notes.length],
        0.027,
        i ? 0.32 : -0.25,
        "keys",
      ),
    );
  }
  // Let the motif breathe: statement, answer, alternate statement, open reprise.
  if (local < 8 || phrase === 3 || (phrase === 2 && local >= 12)) {
    for (const [step, pitch, hold] of theme[local % 8]) {
      const note = phrase === 2 ? pitch - 12 : pitch;
      voice(
        foundation,
        time + step * beat + (random() - 0.5) * 0.012,
        hold * beat,
        note - 12,
        0.068 * (0.9 + random() * 0.15),
        -0.08,
        "keys",
      );
      if (phrase !== 2)
        voice(
          air,
          time + step * beat + 0.018,
          hold * beat,
          note,
          0.046 * (local % 2 ? 0.82 : 1),
          0.12,
          "bell",
        );
    }
  }
  // The second half supplies a counter-melody rather than another lead competing with it.
  if (local >= 8 && phrase !== 2) {
    const pattern = open ? [0, 1.5, 2.5, 3.5] : [0.5, 2.5];
    pattern.forEach((step, i) =>
      voice(
        air,
        time + step * beat,
        0.85 * beat,
        chord.notes[(i * 2 + bar) % chord.notes.length] + 12,
        0.025,
        i % 2 ? -0.5 : 0.5,
        "bell",
      ),
    );
  }
  if (local === 14) voice(air, time, 6 * beat, 81, 0.015, 0.55, "pad");
  // Humanized eighths, ghost notes, and eight-bar fills; no hard dance drop.
  const sparse = phrase === 2 && local < 8;
  for (const step of sparse ? [0, 2.5] : [0, 1.75, 2.5]) {
    drum(pulse, time + step * beat, "kick", step === 0 ? 0.27 : 0.18);
  }
  for (const step of [1, 3]) {
    drum(
      pulse,
      time + step * beat + 0.012,
      sparse ? "rim" : "snare",
      sparse ? 0.022 : 0.095,
      0.07,
    );
    if (!sparse) drum(pulse, time + step * beat + 0.014, "rim", 0.025, -0.16);
  }
  for (let step = 0; step < 8; step++) {
    if (sparse && step % 2) continue;
    drum(
      pulse,
      time + (step * beat) / 2 + (step % 2 ? 0.028 : 0),
      "hat",
      (step % 2 ? 0.027 : 0.018) * (0.86 + random() * 0.28),
      step % 2 ? 0.5 : -0.4,
    );
  }
  if (bar % 8 === 7 && !sparse) {
    [3.25, 3.5, 3.75].forEach((step, i) =>
      drum(pulse, time + step * beat, "rim", 0.021 + i * 0.005, (i - 1) * 0.4),
    );
  }
  for (const [step, hold, octave] of [
    [0, 1.35, 0],
    [1.75, 0.45, 0],
    [2.5, 0.85, 12],
  ] as const) {
    voice(
      pulse,
      time + step * beat + 0.008,
      hold * beat,
      chord.root + octave,
      sparse ? 0.1 : 0.15,
      0,
      "bass",
    );
  }
}
console.log(
  "Composed 64 bars: felt keys, drifting pads, glass melody, brushed rhythm, warm bass.",
);
delay(foundation, 0.75, 0.13);
reverb(foundation, 0.7);
delay(air, 0.75, 0.34);
reverb(air, 0.95);
reverb(pulse, 0.12);

await render([foundation, air, pulse]);
if (!process.argv.includes("--coastlines-only")) {
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      `${import.meta.dir}/compose-additional-soundtracks.ts`,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await child.exited) !== 0)
    throw new Error("Additional soundtrack rendering failed");
}
