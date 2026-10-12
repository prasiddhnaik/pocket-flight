import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { musicStems } from "../src/music-mix";
import { musicTracks, trackDuration } from "../src/music-tracks";

const report: unknown[] = [];
for (const track of musicTracks) {
  const root = join(import.meta.dir, "../public/audio", track.id);
  const musicDuration = trackDuration(track);
  for (const stem of musicStems)
    for (const extension of ["ogg", "mp3"]) {
      const path = join(root, `${stem}.${extension}`);
      const process = Bun.spawn(
        [
          "ffmpeg",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          path,
          "-f",
          "f32le",
          "-ar",
          "44100",
          "-ac",
          "2",
          "pipe:1",
        ],
        { stdout: "pipe", stderr: "inherit" },
      );
      const bytes = await new Response(process.stdout).arrayBuffer();
      if ((await process.exited) !== 0)
        throw new Error(`Cannot decode ${path}`);
      const data = new Float32Array(bytes),
        frames = data.length / 2;
      let peak = 0,
        squares = 0;
      for (const sample of data) {
        if (!Number.isFinite(sample))
          throw new Error(`${stem}.${extension} has invalid samples`);
        peak = Math.max(peak, Math.abs(sample));
        squares += sample * sample;
      }
      if (peak >= 0.98 || peak < 0.02)
        throw new Error(
          `${stem}.${extension} is clipped or unexpectedly silent`,
        );
      if (Math.abs(frames - Math.round(musicDuration * 44100)) > 1)
        throw new Error(
          `${track.id}/${stem}.${extension} has a misaligned loop (${frames} frames)`,
        );
      let seam = 0,
        boundaryStep = 0;
      for (let c = 0; c < 2; c++) {
        seam = Math.max(seam, Math.abs(data[c] - data[data.length - 2 + c]));
        for (let i = 2; i < 4410; i += 2) {
          boundaryStep = Math.max(
            boundaryStep,
            Math.abs(data[i + c] - data[i - 2 + c]),
            Math.abs(data[data.length - i + c] - data[data.length - i - 2 + c]),
          );
        }
      }
      if (seam > Math.max(0.012, boundaryStep * 1.5))
        throw new Error(`${stem}.${extension} has an abrupt loop boundary`);
      report.push({
        file: `${track.id}/${stem}.${extension}`,
        frames,
        duration: frames / 44100,
        peakDb: 20 * Math.log10(peak),
        rmsDb: 20 * Math.log10(Math.sqrt(squares / data.length)),
        loopBoundaryStep: seam,
        adjacentMaximumStep: boundaryStep,
      });
    }
}
const output = join(import.meta.dir, "../output/soundtrack");
await mkdir(output, { recursive: true });
await Bun.write(
  join(output, "verification.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
console.log(
  "All eighteen encoded stems decode, align, remain finite, and pass peak and loop-boundary checks.",
);
