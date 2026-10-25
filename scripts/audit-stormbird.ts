// Read saved CAD transfer/export data only. This never runs aircraft or flight physics.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const bundled = resolve(root, "../.venv-cad312/bin/python");
const python =
  process.env.STORMBIRD_PYTHON ?? (existsSync(bundled) ? bundled : "python3");
const result = Bun.spawnSync(
  [python, "assets/stormbird/checks/design_geometry.py"],
  {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  },
);
if (result.exitCode) process.exit(result.exitCode);
const read = (path: string) => readFileSync(resolve(root, path));
const geometry = JSON.parse(read("src/aircraft/stormbird/stormbird-geometry.json").toString());
const file = read("public/assets/stormbird-hx40.glb");
const document = JSON.parse(
  file.subarray(20, 20 + file.readUInt32LE(12)).toString(),
);
const nodes = new Map<string, { extras?: { hinge_glTF?: number[] } }>(
  document.nodes.map((node: { name: string }) => [node.name, node]),
);
for (const wheel of geometry.wheels) {
  const pivot = nodes.get(wheel.name)?.extras?.hinge_glTF;
  if (
    !pivot ||
    pivot.some((value, index) => Math.abs(value - wheel.center[index]) > 1e-7)
  )
    throw new Error(`Exported tire pivot differs from CAD: ${wheel.name}`);
}
const sha256 = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");
const transferSha256 = sha256(read("assets/stormbird/GLB/cad-transfer.json"));
if (transferSha256 !== geometry.transferSha256)
  throw new Error("Stale geometry manifest");
const report = {
  transferSha256,
  gameGlbSha256: sha256(file),
  wheelPivotsMatched: geometry.wheels.length,
  triangles: document.accessors
    .filter((a: { componentType: number }) => a.componentType === 5125)
    .reduce((sum: number, a: { count: number }) => sum + a.count / 3, 0),
  flightTestsRun: false,
  runtimeMechanismsExercised: false,
};
writeFileSync(
  resolve(root, "assets/stormbird/validation/export-audit.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
