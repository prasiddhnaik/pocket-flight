import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AttachmentChecker,
  attachmentTolerance,
  floorDatum,
} from "./aurelia-attachments";
import { loadGeometryOnly } from "./geometry-loader";
import {
  neutralExteriorPose,
  poseAureliaExterior,
  type ExteriorPose,
} from "../src/aircraft/aurelia/exterior-mechanisms";

const args = Bun.argv.slice(2);
const option = (name: string, fallback: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const asset = resolve(
  option("--asset", "public/assets/aurelia-phenom300e.glb"),
);
const output = resolve(option("--out", "output/aurelia-attachment-check"));
const { scene, sha256 } = await loadGeometryOnly(pathToFileURL(asset));
const checker = new AttachmentChecker();
const poses: { label: string; pose: ExteriorPose }[] = [
  { label: "neutral", pose: neutralExteriorPose() },
];
if (!args.includes("--quick")) {
  for (const channel of [
    "gear",
    "entry",
    "cockpitDoor",
    "flaps",
    "roll",
    "pitch",
    "yaw",
    "steering",
    "fan",
  ] as const)
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const value =
        channel === "fan"
          ? t * Math.PI * 2
          : ["roll", "pitch", "yaw", "steering"].includes(channel)
            ? t * 2 - 1
            : t;
      poses.push({
        label: `${channel}=${value}`,
        pose: { ...neutralExteriorPose(), [channel]: value },
      });
    }
  // Deterministic simultaneous poses exercise interaction between independent mechanisms.
  for (let i = 0; i <= 24; i++)
    poses.push({
      label: `combined-${i}`,
      pose: {
        gear: i / 24,
        entry: (24 - i) / 24,
        cockpitDoor: i / 24,
        flaps: i / 24,
        roll: Math.sin(i),
        pitch: Math.cos(i),
        yaw: Math.sin(i / 2),
        steering: Math.cos(i / 2),
        fan: i,
      },
    });
}
const results = [];
for (const { label, pose } of poses) {
  poseAureliaExterior(scene, pose);
  const result = checker.check(scene),
    structural = checker.check(scene, true),
    floor = floorDatum(scene);
  results.push({
    label,
    pose,
    ...result,
    withoutCosmeticSupport: structural,
    floor,
  });
  if (
    result.detached.length ||
    structural.detached.length ||
    floor.spread > attachmentTolerance ||
    floor.maximumError > attachmentTolerance
  )
    console.log(
      "FAIL",
      label,
      JSON.stringify({
        detached: result.detached.map((group) => group[0]),
        withoutCosmeticSupport: structural.detached.map((group) => group[0]),
        floor,
      }),
    );
  else if (results.length % 50 === 1)
    console.log("PASS", label, result.meshes, "meshes");
}
const failed = results.filter(
  (r) =>
    r.detached.length ||
    r.withoutCosmeticSupport.detached.length ||
    r.floor.spread > attachmentTolerance ||
    r.floor.maximumError > attachmentTolerance,
);
await mkdir(output, { recursive: true });
const report = {
  asset,
  sha256,
  toleranceMetres: attachmentTolerance,
  poses: results.length,
  failedPoses: failed.length,
  pass: failed.length === 0,
  results,
};
await Bun.write(
  resolve(output, "attachments.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    sha256,
    poses: results.length,
    failedPoses: failed.length,
    pass: report.pass,
    report: resolve(output, "attachments.json"),
  }),
);
if (failed.length) process.exitCode = 1;
