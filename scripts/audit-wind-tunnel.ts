import { Box3, Matrix4, Vector3, Mesh } from "three";
import { aircraftCatalog, type LabAircraftId } from "../lab/aircraft";
import { wingForAircraft } from "../lab/catalog";
import {
  convergenceCheck,
  runSweep,
  experimentRecord,
} from "../lab/experiments";
import { solveWing, type WingGeometry } from "../lab/solver";
import { loadGeometryOnly } from "./geometry-loader";
import manifest from "../lab/assets/tunnel-manifest.json";

const { scene: chamberScene } = await loadGeometryOnly(new URL("../lab/public/tunnel.glb", import.meta.url));
chamberScene.updateMatrixWorld(true);
let meshCount = 0, triangles = 0;
chamberScene.traverse((o) => {
  if (!(o instanceof Mesh)) return;
  meshCount++; const positions = o.geometry.getAttribute("position");
  triangles += (o.geometry.index?.count ?? positions.count) / 3;
  if (!Array.from(positions.array).every(Number.isFinite)) throw new Error("Nonfinite chamber vertices.");
});
if (meshCount !== manifest.meshObjects) throw new Error("Chamber export does not match the modeled mesh count.");
for (const name of manifest.cutawayGroups) {
  const section = chamberScene.getObjectByName(name);
  if (!section?.children.length || !section.visible)
    throw new Error(`${name} must contain visible geometry in the complete export.`);
}
for (const [name, expected] of [["Pitch_Rig", manifest.aircraftPivot], ["Fan_Rotor", manifest.fanPivot]] as const) {
  const node = chamberScene.getObjectByName(name);
  if (!node || node.getWorldPosition(new Vector3()).distanceTo(new Vector3(...expected)) > 1e-5) throw new Error(`${name} export datum is incorrect.`);
}
const chamberExport = { meshCount, triangles, dimensions: new Box3().setFromObject(chamberScene).getSize(new Vector3()).toArray() };
const conditions = { speed: 30, density: 1.225, alpha: 4 };
const fleet = [];
for (const id of Object.keys(aircraftCatalog) as LabAircraftId[]) {
  const config = aircraftCatalog[id],
    geometry = wingForAircraft(id);
  const { scene, sha256 } = await loadGeometryOnly(
    new URL(`../public/assets/${config.asset}`, import.meta.url),
  );
  if (sha256 !== geometry.revision)
    throw new Error(
      `${id} geometry revision is stale; run bun run lab:geometry.`,
    );
  scene.scale.setScalar(config.scale);
  scene.position.y = config.offsetY;
  scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(scene),
    corners: Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z])
        corners.push(new Vector3(x, y, z));
  const clearance = [-8, 0, 8].map((alpha) => {
    const matrix = new Matrix4().makeRotationX((alpha * Math.PI) / 180);
    const rotated = new Box3().setFromPoints(
      corners.map((p) =>
        p
          .clone()
          .applyMatrix4(matrix)
          .add(new Vector3(...manifest.aircraftPivot)),
      ),
    );
    const { width, height, length } = manifest.testSection;
    const margin = {
      side:
        width / 2 - Math.max(Math.abs(rotated.min.x), Math.abs(rotated.max.x)),
      floor: rotated.min.y,
      ceiling: height - rotated.max.y,
      ends:
        length / 2 - Math.max(Math.abs(rotated.min.z), Math.abs(rotated.max.z)),
    };
    if (Object.values(margin).some((value) => value < 0))
      throw new Error(
        `${id} does not fit chamber at ${alpha}°: ${JSON.stringify(margin)}`,
      );
    return { alpha, margin };
  });
  const solution = solveWing(geometry, conditions, 96),
    convergence = convergenceCheck(geometry, conditions);
  if (convergence.liftChangePercent > 1 || convergence.dragChangePercent > 1)
    throw new Error(`${id} reference condition is not converged within 1%.`);
  const experiment = experimentRecord(runSweep(geometry, conditions));
  const compactExperiment = {
    ...experiment,
    results: experiment.results.map(({ spanLoading, ...row }) => row),
  };
  fleet.push({
    id,
    asset: config.asset,
    revision: sha256,
    clearance,
    convergence,
    experiment: compactExperiment,
    referenceResult: {
      cl: solution.cl,
      cdi: solution.cdi,
      lift: solution.lift,
      inducedDrag: solution.inducedDrag,
    },
  });
  scene.traverse((o: any) => o.geometry?.dispose());
}
const ellipse: WingGeometry = {
  name: "Elliptical wing AR 8",
  revision: "analytic-benchmark",
  assumptions: ["Flat, symmetric, incompressible lifting line comparison"],
  stations: Array.from({ length: 81 }, (_, i) => {
    const x = (4 * i) / 80,
      chord = Math.max(0.001, (4 / Math.PI) * Math.sqrt(1 - (x / 4) ** 2));
    return { x, y: 0, leading: -chord / 4, chord, zeroLiftAlpha: 0 };
  }),
};
const benchmark = solveWing(ellipse, conditions, 96);
const theoreticalSlope = (2 * Math.PI) / (1 + 2 / benchmark.aspectRatio),
  idealDrag = benchmark.cl ** 2 / (Math.PI * benchmark.aspectRatio);
if (
  Math.abs(
    benchmark.cl / ((conditions.alpha * Math.PI) / 180) / theoreticalSlope - 1,
  ) > 0.08 ||
  Math.abs(benchmark.cdi / idealDrag - 1) > 0.08
)
  throw new Error("Analytic benchmark exceeds 8% tolerance.");
const evidence = {
  generatedAt: new Date().toISOString(),
  chamber: manifest,
  chamberExport,
  benchmark: {
    cl: benchmark.cl,
    cdi: benchmark.cdi,
    liftSlopeErrorPercent:
      Math.abs(
        benchmark.cl / ((conditions.alpha * Math.PI) / 180) / theoreticalSlope -
          1,
      ) * 100,
    inducedDragErrorPercent: Math.abs(benchmark.cdi / idealDrag - 1) * 100,
  },
  fleet,
};
await Bun.write(
  new URL("../lab/evidence.json", import.meta.url),
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      benchmark: evidence.benchmark,
      fleet: fleet.map((f) => ({
        id: f.id,
        ...f.referenceResult,
        convergence: f.convergence,
        clearance: f.clearance,
      })),
    },
    null,
    2,
  ),
);
