import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dir, ".."), cad = resolve(root, "assets/f15c"), out = resolve(root, "lab/public/f15c");
mkdirSync(out, { recursive: true });
const specs = [
  ["fuselage", "Fuselage and nose", "fuselage", []],
  ["intakes", "Twin intakes and ducts", "airframe_intakes", ["parts/intakes/checks/results.json"]],
  ["wings", "Main wings and controls", "airframe_wings", ["parts/wings/checks/results.json", "parts/wings/checks/motion-results.json", "parts/wings/checks/lab-results.json", "parts/wings/checks/root-blend-results.json"]],
  ["tails", "Fins and stabilators", "airframe_tails", ["parts/tails/checks/tails-results.json", "checks/wing_tail_clearance-results.json"]],
  ["exhausts", "Twin exhausts", "airframe_exhausts", ["checks/exhausts-results.json", "checks/exhausts-functional-results.json"]],
  ["cockpit", "Cockpit and canopy", "airframe_cockpit", ["checks/cockpit-results.json", "checks/cockpit-functional-results.json", "checks/cockpit-refinement-results.json"]],
  ["gear", "Landing gear and doors", "airframe_gear", ["parts/gear/checks/results.json", "checks/gear-intake-travel-results.json", "checks/gear-intake-geometry-results.json"]],
  ["complete", "Detailed aircraft", "f15c", ["checks/details-results.json", "checks/details-functional-results.json", "checks/gun-results.json"]],
] as const;
type Check = { name?: string; part?: string; angleDegrees?: number; retract?: number; pass: boolean };
type Evidence = { checks: Check[]; failed: number; sha256: string; artifactSha256?: string; dimensionsM: number[]; [key: string]: unknown };
const stages = [];
const lastStage = process.argv[2];
if (lastStage && !specs.some(([id]) => id === lastStage)) throw new Error(`Unknown final stage: ${lastStage}`);
for (const [id, label, model, evidenceFiles] of specs) {
  const modelFile = resolve(cad, `GLB/${model}.glb`), reportFile = resolve(cad, `checks/${id === "exhausts" || id === "cockpit" ? `${id}-assembly` : id}-results.json`);
  if (!existsSync(modelFile) || !existsSync(reportFile)) break;
  const report: Evidence = JSON.parse(readFileSync(reportFile, "utf8"));
  if (report.failed) throw new Error(`Unaccepted ${id} stage has ${report.failed} failed checks.`);
  const actualHash = createHash("sha256").update(readFileSync(resolve(cad, `STEP/${model}.step`))).digest("hex");
  if (report.sha256 !== actualHash) throw new Error(`${id} saved STEP changed after its checks; rerun validation.`);
  const sources = [{ artifact: report.artifact, sha256: report.sha256 }];
  for (const file of evidenceFiles) {
    const more: Evidence = JSON.parse(readFileSync(resolve(cad, file), "utf8"));
    if (more.failed) throw new Error(`${file} still has failing checks`);
    if (file.startsWith("checks/gear-intake-") && more.artifactSha256 !== actualHash)
      throw new Error(`${file} refers to an older gear assembly; rerun validation.`);
    sources.push({ artifact: more.artifact ?? file, sha256: more.sha256 ?? more.artifactSha256 ?? "" });
    report.checks.push(...more.checks.map(check => ({ ...check, name: check.name ??
      (check.retract === undefined ? `${check.part} at ${check.angleDegrees}°` : `Gear/body/intake clearance at retraction ${check.retract}`) })));
  }
  report.passed = report.checks.filter(check => check.pass).length;
  report.failed = report.checks.filter(check => !check.pass).length;
  report.evidence = sources;
  const asset = `${id}.glb`, checks = `${id}-results.json`;
  const runtimeFile = resolve(root, "public/assets/f15c-eagle.glb");
  let mechanisms = false;
  if (id === "complete" && existsSync(runtimeFile)) {
    const bytes = readFileSync(runtimeFile);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
    mechanisms = gltf.nodes.some((node: { extras?: { stepSha256?: string } }) => node.extras?.stepSha256 === actualHash);
  }
  copyFileSync(mechanisms ? runtimeFile : modelFile, resolve(out, asset));
  writeFileSync(resolve(out, checks), `${JSON.stringify(report, null, 2)}\n`);
  stages.push({ id, label, asset, checks, mechanisms });
  if (id === lastStage) break;
}
writeFileSync(resolve(out, "stages.json"), `${JSON.stringify({ stages }, null, 2)}\n`);
const wingLab = resolve(cad, "parts/wings/checks/lab-results.json");
if (existsSync(wingLab)) copyFileSync(wingLab, resolve(out, "wing-lab.json"));
console.log(`Published ${stages.length} validated F-15C stages to the private construction lab.`);
