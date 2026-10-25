// One-off fetch of the Betty voice clips from public cockpit-warning videos.
// The game only ever loads the committed mp3 files. Needs yt-dlp and ffmpeg on PATH.
// Usage: bun run betty:fetch
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { bettyFiles } from "../src/audio/betty";
import type { WarningId } from "../src/hud/warnings";

type Cut = { video: string; from: number; to: number; says: string };
// YouTube video id and the seconds holding each callout.
const cuts: Record<WarningId | "chime", Cut> = {
  pullUp: { video: "Jqt2kg7IUt8", from: 3.22, to: 4.33, says: "Pull up, pull up (F/A-18)" },
  stall: { video: "RwNKP_vVKJw", from: 2.85, to: 4.3, says: "Stall, stall (Airbus)" },
  overspeed: { video: "8kafXP3s1jo", from: 0.48, to: 2.48, says: "overspeed clacker (737NG)" },
  landingGear: { video: "r0AK4yxBGnM", from: 28.68, to: 29.72, says: "Landing gear (717)" },
  bankAngle: { video: "tp5qNbYyxZ4", from: 17.85, to: 20.3, says: "Bank angle, bank angle (757)" },
  bingoFuel: { video: "Jqt2kg7IUt8", from: 16.85, to: 19.25, says: "Bingo, bingo (F/A-18)" },
  damage: { video: "Jqt2kg7IUt8", from: 11.68, to: 14.22, says: "Flight controls, flight controls (F/A-18)" },
  fuelLow: { video: "Jqt2kg7IUt8", from: 14.79, to: 15.9, says: "Fuel low (F/A-18)" },
  chime: { video: "Jqt2kg7IUt8", from: 28.33, to: 28.73, says: "caution tone (F/A-18)" },
};
// Trim rumble and hiss, even out loudness, limit peaks clear of 0 dBFS, and fade edges so cuts never click.
const FILTER = "highpass=f=200,lowpass=f=6000,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=22050,alimiter=limit=0.6:level=false,afade=t=in:d=0.01,areverse,afade=t=in:d=0.04,areverse";

const out = fileURLToPath(new URL("../public/audio/betty/", import.meta.url));
const cache = `${tmpdir()}/betty-src/`;
await mkdir(out, { recursive: true });
await mkdir(cache, { recursive: true });

async function run(cmd: string[]) {
  const child = Bun.spawn(cmd, { stdout: "ignore", stderr: "inherit" });
  if (await child.exited) throw new Error(`failed: ${cmd.join(" ")}`);
}

for (const video of new Set(Object.values(cuts).map((c) => c.video))) {
  if (await Bun.file(`${cache}${video}.wav`).exists()) continue;
  await run(["yt-dlp", "-q", "--no-update", "-x", "--audio-format", "wav", "-o", `${cache}%(id)s.%(ext)s`, `https://www.youtube.com/watch?v=${video}`]);
}
for (const [id, c] of Object.entries(cuts) as [WarningId | "chime", Cut][]) {
  await run([
    "ffmpeg", "-y", "-loglevel", "error", "-ss", String(c.from), "-to", String(c.to), "-i", `${cache}${c.video}.wav`,
    "-ac", "1", "-ar", "22050", "-af", FILTER, "-b:a", "48k", `${out}${bettyFiles[id]}.mp3`,
  ]);
  console.log(`wrote ${bettyFiles[id]}.mp3: ${c.says}`);
}
