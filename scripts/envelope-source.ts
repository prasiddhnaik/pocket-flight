import { createHash } from "node:crypto";
import { aircraftDefinitionSources } from "./aircraft-source";
export const sourceFiles = [
  ...aircraftDefinitionSources,
  "src/flight/aerodynamics.ts",
  "src/aircraft/aircraft-design.ts",
  "src/flight/engine-map.ts",
  "src/flight/flight-reference-data.ts",
  "src/flight/physics.ts",
  "src/flight/flight-trim.ts",
  "src/flight/rigid-body.ts",
  "src/aircraft/finch/finch-design.ts",
  "src/flight/flight-profiles.ts",
  "src/world/terrain.ts",
  "src/aircraft/landing-gear.ts",
  "src/aircraft/stormbird/stormbird-contact.ts",
  "src/aircraft/stormbird/stormbird-geometry.json",
  "src/aircraft/stormbird/stormbird-kinematics.ts",
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
