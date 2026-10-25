import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { aircraftCatalog } from "../lab/aircraft";
import { orderFleetAttachmentChecks } from "./fleet-attachment-order";
import { AttachmentChecker, attachmentTolerance } from "./aurelia-attachments";
import {
  bodyMesh,
  loadFleetAttachmentModel,
  neutralFleetPose,
  otherAircraft,
  type OtherAircraft,
} from "./fleet-attachment-model";

const option = (name: string, fallback: string) => {
  const at = Bun.argv.indexOf(name);
  return at < 0 ? fallback : Bun.argv[at + 1];
};
const id = option("--aircraft", "finch");
if (!otherAircraft.includes(id as OtherAircraft))
  throw new Error(`Unknown aircraft: ${id}`);
const aircraft = id as OtherAircraft;
const output = resolve(option("--out", "output/fleet-attachment-check"));
const steps = Number(option("--steps", "100"));
if (!Number.isInteger(steps) || steps < 2 || steps > 1000)
  throw new Error("steps must be an integer in 2..1000");
await mkdir(output, { recursive: true });
const model = await loadFleetAttachmentModel(aircraft);
orderFleetAttachmentChecks(model.root);
const checker = new AttachmentChecker();
model.apply(neutralFleetPose());
const rest = checker.check(model.root, false, bodyMesh[aircraft]);
const measured = checker.measureDetached(model.root, rest.detached);
await Bun.write(
  resolve(output, `${aircraft}-rest.json`),
  JSON.stringify({ sha256: model.sha256, ...rest, measured }, null, 2),
);
console.log(aircraft, "rest", rest.detached.length, "disconnected groups");
const allFlags = new Map<
  string,
  { firstPose: string; poses: number; initiallyDetached: boolean }
>();
const restFlags = new Set(rest.detached.flat());
const results = [];
const inspect = (name: string, pose: ReturnType<typeof neutralFleetPose>) => {
  model.apply(pose);
  const result = checker.check(model.root, false, bodyMesh[aircraft]);
  for (const path of result.detached.flat()) {
    const prior = allFlags.get(path);
    allFlags.set(path, {
      firstPose: prior?.firstPose ?? name,
      poses: (prior?.poses ?? 0) + 1,
      initiallyDetached: restFlags.has(path),
    });
  }
  results.push({
    name,
    pose,
    disconnectedGroups: result.detached.length,
    disconnectedSurfaces: result.surfaces - result.mainSurfaces,
  });
};
inspect("neutral", neutralFleetPose());
for (const channel of (aircraft === "finch"
  ? ["compression", "roll", "pitch", "yaw", "flaps", "phase"]
  : [
      "gear",
      "compression",
      "roll",
      "pitch",
      "yaw",
      "flaps",
      "canopy",
      "phase",
    ]) as (keyof ReturnType<typeof neutralFleetPose>)[]) {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const value =
      channel === "phase"
        ? t * Math.PI * 2
        : ["roll", "pitch", "yaw"].includes(channel)
          ? t * 2 - 1
          : t;
    inspect(`${channel}=${value.toFixed(4)}`, {
      ...neutralFleetPose(),
      [channel]: value,
    });
    if (i % 25 === 0) console.log(aircraft, channel, `${i}/${steps}`);
    if (i % 10 === 0) {
      await Bun.sleep(0);
      Bun.gc(true);
    }
  }
  console.log(aircraft, channel, "complete");
  await Bun.write(
    resolve(output, `${aircraft}-progress.json`),
    JSON.stringify(
      {
        sha256: model.sha256,
        completedChannel: channel,
        results,
        flags: [...allFlags],
      },
      null,
      2,
    ),
  );
}
for (let i = 0; i <= 24; i++) {
  const t = i / 24;
  inspect(`combined-${i}`, {
    gear: aircraft === "finch" ? 1 : t,
    compression: 1 - t,
    roll: Math.sin(i),
    pitch: Math.cos(i),
    yaw: Math.sin(i / 2),
    flaps: t,
    canopy: 1 - t,
    phase: i,
  });
  if (i % 5 === 0) {
    await Bun.sleep(0);
    Bun.gc(true);
  }
}
model.apply(neutralFleetPose());
const repeated = checker.check(model.root, false, bodyMesh[aircraft]);
if (JSON.stringify(rest.detached) !== JSON.stringify(repeated.detached))
  throw new Error("Neutral state did not restore after scrubbing");
const flags = [...allFlags].map(([surface, detail]) => ({
  surface,
  ...detail,
}));
const report = {
  aircraft,
  name: aircraftCatalog[aircraft].name,
  sha256: model.sha256,
  toleranceMetres: attachmentTolerance,
  steps,
  poses: results.length,
  pass: flags.length === 0,
  meshes: rest.meshes,
  surfaces: rest.surfaces,
  neutralDisconnectedGroups: rest.detached.length,
  neutralDisconnectedSurfaces: rest.surfaces - rest.mainSurfaces,
  maximumDisconnectedGroups: Math.max(
    ...results.map((r) => r.disconnectedGroups),
  ),
  uniqueFlaggedSurfaces: flags.length,
  newlyDetachedDuringMovement: flags.filter((f) => !f.initiallyDetached).length,
  measured,
  flags,
  results,
  scope:
    "CPU geometry and actual game pose functions; not a rendered browser or flight-dynamics check. All physical asset meshes included, even if a rig hides them while stowed. Surface contact is required within 10 micrometres; closed-solid containment and cosmetic offsets need review, not automatic exemption.",
};
await Bun.write(
  resolve(output, `${aircraft}.json`),
  JSON.stringify(report, null, 2),
);
console.log(
  "FLEET_ATTACHMENT_AUDIT",
  JSON.stringify({
    ...report,
    flags: undefined,
    results: undefined,
    measured: undefined,
  }),
);
if (!report.pass) process.exitCode = 1;
