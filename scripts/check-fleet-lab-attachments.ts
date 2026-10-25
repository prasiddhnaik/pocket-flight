import { resolve } from "node:path";
import { aircraftCatalog } from "../lab/aircraft";
import { AircraftMechanics, mechanismPose } from "../lab/mechanics";
import { AttachmentChecker } from "./aurelia-attachments";
import {
  bodyMesh,
  neutralFleetPose,
  otherAircraft,
} from "./fleet-attachment-model";
import { loadGeometryOnly } from "./geometry-loader";
import { orderFleetAttachmentChecks } from "./fleet-attachment-order";

const index = Bun.argv.indexOf("--aircraft");
const id = index < 0 ? "finch" : Bun.argv[index + 1];
if (!otherAircraft.includes(id as (typeof otherAircraft)[number]))
  throw new Error("Unknown aircraft");
const aircraft = id as (typeof otherAircraft)[number];
const outIndex = Bun.argv.indexOf("--out");
const output = resolve(
  outIndex < 0 ? "output/fleet-attachment-check" : Bun.argv[outIndex + 1],
);
const { scene, animations, sha256 } = await loadGeometryOnly(
  new URL(
    `../public/assets/${aircraftCatalog[aircraft].asset}`,
    import.meta.url,
  ),
  true,
);
scene.scale.setScalar(aircraftCatalog[aircraft].scale);
scene.position.y = aircraftCatalog[aircraft].offsetY;
const mechanics = new AircraftMechanics(scene, aircraft, animations);
orderFleetAttachmentChecks(scene);
const checker = new AttachmentChecker();
const inspect = (time: number) => {
  const pose =
    time < 0 ? { ...neutralFleetPose(), power: 0 } : mechanismPose(time, "all");
  mechanics.apply(pose, Math.max(0, time));
  const result = checker.check(scene, false, bodyMesh[aircraft]);
  return {
    time,
    pose,
    meshes: result.meshes,
    surfaces: result.surfaces,
    disconnectedGroups: result.detached.length,
    detached: result.detached,
  };
};
const results = [inspect(-1)];
// The complete 36 s inspection programme, sampled once per second.
if (!Bun.argv.includes("--neutral-only"))
  for (let i = 0; i <= 36; i++) {
    results.push(inspect(i));
    if (i % 6 === 0) {
      await Bun.sleep(0);
      Bun.gc(true);
    }
    if (i % 6 === 0) console.log(aircraft, "lab programme", i, "/ 36 seconds");
  }
if (
  JSON.stringify(inspect(-1).detached) !== JSON.stringify(results[0].detached)
)
  throw new Error("Lab rig did not restore neutral contacts");
const flags = [...new Set(results.flatMap((r) => r.detached.flat()))];
const report = {
  aircraft,
  sha256,
  pass: flags.length === 0,
  poses: results.length,
  neutralDisconnectedGroups: results[0].disconnectedGroups,
  maximumDisconnectedGroups: Math.max(
    ...results.map((r) => r.disconnectedGroups),
  ),
  uniqueFlaggedSurfaces: flags.length,
  flags,
  diagnostics: mechanics.diagnostics(),
  results,
  scope:
    "Separate wind-tunnel inspection rig including generated cockpit and instanced mechanical hardware; the all-mechanisms programme is sampled every second. Not a rendered or flight-dynamics check.",
};
await Bun.write(
  resolve(output, `${aircraft}-lab.json`),
  JSON.stringify(report, null, 2),
);
console.log(
  "FLEET_LAB_ATTACHMENT_AUDIT",
  JSON.stringify({
    ...report,
    flags: undefined,
    results: undefined,
    diagnostics: undefined,
  }),
);
if (!report.pass) process.exitCode = 1;
