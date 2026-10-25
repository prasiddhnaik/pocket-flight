import { createSynth } from "./music-synthesis";
import { getMusicTrack } from "../src/audio/music-tracks";

// Blue Hour: a nocturnal 3/4 miniature. The descending string phrase and
// electric-piano suspensions supply an entirely different identity to Coastlines.
async function blueHour() {
  const synth = await createSynth(getMusicTrack("blue-hour"), 0xb10e7203);
  const { beat, bars, stereo, voice, drum, delay, reverb, render } = synth;
  const foundation = stereo(),
    air = stereo(),
    pulse = stereo();
  const chords = [
    { root: 40, notes: [55, 59, 62, 66] }, // Em9
    { root: 45, notes: [55, 59, 61, 64] }, // A9 (Dorian major IV)
    { root: 36, notes: [55, 59, 62, 64] }, // Cmaj9
    { root: 35, notes: [54, 57, 62, 66] }, // Bm7
    { root: 40, notes: [54, 59, 62, 67] }, // Em9 with minor color
    { root: 42, notes: [57, 61, 64, 69] }, // F#m7
    { root: 45, notes: [55, 59, 61, 66] }, // A13
    { root: 35, notes: [57, 59, 62, 66] }, // Bm7
  ];
  const melody: [number, number, number][][] = [
    [[0, 71, 2.5]],
    [
      [0.5, 69, 1],
      [1.75, 66, 1],
    ],
    [
      [0, 67, 1.4],
      [1.5, 64, 1.3],
    ],
    [[1, 62, 1.8]],
    [[0.25, 64, 2]],
    [
      [0.5, 66, 1],
      [1.75, 69, 1],
    ],
    [
      [0, 73, 1.5],
      [1.75, 71, 1],
    ],
    [[0.5, 66, 2.3]],
  ];
  for (let bar = 0; bar < bars; bar++) {
    const section = Math.floor(bar / 16),
      local = bar % 16;
    const chord = chords[Math.floor(local / 2)],
      time = bar * 3 * beat;
    if (bar % 2 === 0)
      chord.notes.forEach((note, i) => {
        voice(
          foundation,
          time + i * 0.021,
          4.2 * beat,
          note,
          0.06 - i * 0.004,
          (i - 1.5) * 0.25,
          "rhodes",
        );
      });
    // Alternating plucks outline triple meter, leaving space between the bowed phrases.
    for (const [step, index] of [
      [0.5, 0],
      [1.5, 2],
      [2.25, 3],
    ]) {
      voice(
        foundation,
        time + step * beat,
        0.8 * beat,
        chord.notes[(index + section) % 4] + (section === 2 ? 12 : 0),
        section === 1 ? 0.038 : 0.045,
        index % 2 ? 0.45 : -0.4,
        "guitar",
      );
    }
    if (section !== 1 || local >= 8) {
      for (const [step, note, hold] of melody[local % 8]) {
        voice(
          air,
          time + step * beat,
          hold * beat,
          note + (section === 2 && local < 8 ? 12 : 0),
          0.073,
          0.15,
          "strings",
        );
      }
    } else if (local % 2 === 0) {
      voice(
        air,
        time + beat,
        2.3 * beat,
        chord.notes[3] + 12,
        0.045,
        -0.25,
        "strings",
      );
    }
    voice(pulse, time, 1.9 * beat, chord.root - 12, 0.17, 0, "bass");
    if (bar % 4 !== 3) drum(pulse, time, "kick", 0.13);
    drum(pulse, time + 2 * beat + 0.025, "rim", 0.027, -0.2);
    for (const step of [0.5, 1.5, 2.5])
      drum(
        pulse,
        time + step * beat + 0.026,
        "hat",
        0.015,
        step === 1.5 ? -0.55 : 0.55,
      );
    if (bar % 8 === 7)
      voice(pulse, time + 2 * beat, 0.7 * beat, chord.root, 0.08, 0, "bass");
  }
  delay(foundation, 1, 0.17);
  reverb(foundation, 0.65);
  delay(air, 1.5, 0.12);
  reverb(air, 0.85);
  reverb(pulse, 0.16);
  console.log(
    "Blue Hour: E Dorian, 72 BPM, 3/4, electric piano / plucked strings / bowed melody.",
  );
  await render([foundation, air, pulse]);
}

// Sunward: bright A-major forward motion. Sixteenth-note analog ostinato,
// syncopated wooden lead, four-on-the-floor pulse, and deliberate breakdowns.
async function sunward() {
  const { beat, bars, stereo, voice, drum, delay, reverb, render } =
    await createSynth(getMusicTrack("sunward"), 0x50118118);
  const foundation = stereo(),
    air = stereo(),
    pulse = stereo();
  const chords = [
    { root: 33, notes: [57, 61, 64, 71] }, // Aadd9
    { root: 37, notes: [56, 61, 64, 68] }, // C#m7
    { root: 38, notes: [57, 62, 66, 69] }, // D6
    { root: 40, notes: [56, 59, 64, 66] }, // Eadd9
    { root: 42, notes: [57, 61, 66, 68] }, // F#m9
    { root: 38, notes: [57, 61, 62, 66] }, // Dmaj7
    { root: 35, notes: [57, 59, 62, 66] }, // Bm7
    { root: 40, notes: [56, 59, 64, 68] }, // E
  ];
  const melody: [number, number, number][][] = [
    [
      [0, 76, 0.65],
      [0.75, 73, 0.4],
      [1.5, 76, 0.8],
      [3, 81, 0.7],
    ],
    [
      [0.5, 80, 0.7],
      [2, 76, 1],
    ],
    [
      [0.25, 78, 0.5],
      [1, 76, 0.6],
      [2.5, 73, 1],
    ],
    [
      [0.5, 71, 1],
      [2, 76, 1.5],
    ],
    [
      [0, 73, 0.6],
      [1, 76, 0.6],
      [1.75, 80, 0.7],
      [3, 78, 0.6],
    ],
    [
      [0.5, 78, 0.7],
      [2, 76, 1.3],
    ],
    [
      [0.25, 74, 0.6],
      [1.25, 73, 0.6],
      [2.5, 71, 0.9],
    ],
    [
      [0, 71, 1.25],
      [2, 68, 1.5],
    ],
  ];
  for (let bar = 0; bar < bars; bar++) {
    const section = Math.floor(bar / 16),
      local = bar % 16;
    const chord = chords[Math.floor(local / 2)],
      time = bar * 4 * beat;
    const breakDown = section === 2 && local < 8;
    if (bar % 2 === 0)
      chord.notes.forEach((note, i) =>
        voice(
          foundation,
          time - 0.12,
          6.7 * beat,
          note - 12,
          0.026,
          (i - 1.5) * 0.35,
          "strings",
        ),
      );
    const steps = breakDown ? 4 : section === 3 ? 16 : 8;
    const arp = [0, 2, 1, 3, 2, 1, 3, 2];
    for (let step = 0; step < steps; step++) {
      const pitch =
        chord.notes[arp[(step + local) % 8]] + (step % 4 === 3 ? 12 : 0);
      voice(
        foundation,
        time + ((step * 4) / steps) * beat,
        0.24 * beat,
        pitch,
        steps === 16 ? 0.04 : 0.056,
        step % 2 ? 0.35 : -0.35,
        "analog",
      );
    }
    if (!breakDown && (local < 8 || section === 3))
      for (const [step, note, hold] of melody[local % 8]) {
        voice(air, time + step * beat, hold * beat, note, 0.12, 0.1, "wood");
        if (section === 3 && step === 0)
          voice(
            air,
            time + step * beat + 0.012,
            hold * beat,
            note - 12,
            0.027,
            -0.2,
            "analog",
          );
      }
    if (breakDown)
      voice(
        air,
        time + beat,
        2 * beat,
        chord.notes[3] + 12,
        0.035,
        0.2,
        "analog",
      );
    for (let step = 0; step < 4; step++) {
      if (!breakDown || step === 0)
        drum(pulse, time + step * beat, "kick", breakDown ? 0.14 : 0.24);
      voice(
        pulse,
        time + (step + 0.5) * beat,
        0.32 * beat,
        chord.root + (step === 3 ? 12 : 0),
        0.17,
        0,
        "analog",
      );
      if (step % 2) {
        drum(pulse, time + step * beat + 0.008, "snare", 0.12, 0.1);
        drum(pulse, time + step * beat + 0.019, "rim", 0.034, -0.25);
      }
      if (!breakDown)
        drum(pulse, time + (step + 0.5) * beat, "hat", 0.036, 0.5);
    }
    if (!breakDown)
      for (let step = 0; step < 16; step++)
        drum(
          pulse,
          time + (step * beat) / 4,
          "hat",
          step % 2 ? 0.01 : 0.018,
          step % 2 ? -0.55 : 0.25,
        );
    if (local % 8 === 7 && !breakDown)
      [3.25, 3.5, 3.75].forEach((step, i) =>
        drum(
          pulse,
          time + step * beat,
          "snare",
          0.025 + i * 0.013,
          (i - 1) * 0.4,
        ),
      );
  }
  delay(foundation, 0.75, 0.15);
  reverb(foundation, 0.24);
  delay(air, 0.75, 0.28);
  reverb(air, 0.36);
  reverb(pulse, 0.07);
  console.log(
    "Sunward: A major, 118 BPM, 4/4, analog arpeggios / wooden lead / driving rhythm.",
  );
  await render([foundation, air, pulse]);
}

await blueHour();
await sunward();
