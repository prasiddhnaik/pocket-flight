import { createHash } from "node:crypto";
export const sourceFiles = [
  "src/aerodynamics.ts",
  "src/aircraft-design.ts",
  "src/engine-map.ts",
  "src/flight-reference-data.ts",
  "src/physics.ts",
  "src/flight-trim.ts",
  "src/rigid-body.ts",
  "src/finch-design.ts",
  "src/flight-profiles.ts",
  "src/terrain.ts",
  "src/landing-gear.ts",
  "src/stormbird-contact.ts",
  "src/stormbird-geometry.json",
  "src/stormbird-kinematics.ts",
  "lab/validation.ts",
  "lab/validation.worker.ts",
  "lab/ValidationBench.tsx",
  "lab/App.tsx",
];
export async function envelopeFingerprint() {
  return Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [
        file,
        createHash("sha256")
          .update(new Uint8Array(await Bun.file(file).arrayBuffer()))
          .digest("hex"),
      ]),
    ),
  );
}
