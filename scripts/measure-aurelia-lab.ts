import { Box3, Mesh, Vector3 } from "three";
import { aircraftCatalog, zeroLiftEstimate } from "../lab/aircraft";
import { loadGeometryOnly } from "./geometry-loader";

/** Measure the lab's reference export without overwriting game calibration. */
export async function measureAureliaLab() {
  const config = aircraftCatalog.aurelia;
  const { scene, sha256 } = await loadGeometryOnly(
    new URL(`../public/assets/${config.asset}`, import.meta.url),
  );
  scene.scale.setScalar(config.scale);
  scene.position.y = config.offsetY;
  scene.updateMatrixWorld(true);
  const dimensions = new Box3()
    .setFromObject(scene)
    .getSize(new Vector3())
    .toArray();
  const triangles: Vector3[][] = [],
    meshNames: string[] = [];
  const bounds = new Box3();
  scene.traverse((node) => {
    // Exclude winglets, flap fairings, bearings and brackets from the planar wing.
    if (
      !(node instanceof Mesh) ||
      !/^(Wing_skin_(Left|Right)_\d+|(Aileron|Flap)_skin_(Left|Right))$/.test(
        node.name,
      )
    )
      return;
    meshNames.push(node.name);
    const vertices = node.geometry.getAttribute("position"),
      index = node.geometry.index;
    for (let i = 0; i < (index?.count ?? vertices.count); i += 3) {
      const triangle = [0, 1, 2].map((j) =>
        new Vector3()
          .fromBufferAttribute(vertices, index ? index.getX(i + j) : i + j)
          .applyMatrix4(node.matrixWorld),
      );
      triangles.push(triangle);
      triangle.forEach((v) => bounds.expandByPoint(v));
    }
  });
  if (meshNames.length !== 24)
    throw new Error(
      `Expected 24 Aurelia wing/control skins; found ${meshNames.length}`,
    );
  const rootX = Math.min(
    ...triangles
      .flat()
      .filter((v) => v.x > 0)
      .map((v) => v.x),
  );
  function section(x: number) {
    const points: Vector3[] = [];
    for (const triangle of triangles)
      for (let i = 0; i < 3; i++) {
        const a = triangle[i],
          b = triangle[(i + 1) % 3];
        if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x))
          points.push(a.clone().lerp(b, (x - a.x) / (b.x - a.x)));
      }
    if (!points.length) throw new Error(`Missing Aurelia wing section at ${x}`);
    const leading = Math.min(...points.map((p) => p.z));
    const nose = points.filter((p) => p.z < leading + 1e-5);
    return {
      x: Math.abs(x),
      y: nose.reduce((sum, p) => sum + p.y, 0) / nose.length,
      leading,
      chord: Math.max(...points.map((p) => p.z)) - leading,
      zeroLiftAlpha: zeroLiftEstimate(config.camber),
      incidence: 0,
    };
  }
  const positive = Array.from({ length: 65 }, (_, i) => {
    const x = rootX + ((bounds.max.x - rootX) * i) / 64;
    return {
      ...section(Math.max(rootX + 1e-5, Math.min(bounds.max.x - 1e-5, x))),
      x,
    };
  });
  const maxChordAsymmetry = Math.max(
    ...positive.map((s) => {
      const x = Math.max(rootX + 1e-5, Math.min(bounds.max.x - 1e-5, s.x));
      return Math.abs(section(x).chord - section(-x).chord);
    }),
  );
  return {
    id: "aurelia",
    name: config.name,
    asset: config.asset,
    revision: sha256,
    dimensions,
    scale: config.scale,
    offsetY: config.offsetY,
    mainWingSpan: bounds.max.x - bounds.min.x,
    maxChordAsymmetry,
    meshNames,
    stations: [{ ...positive[0], x: 0 }, ...positive],
    assumptions: [
      "Current Aurelia Phenom reference export, including its authored 1.155 root scale. No additional legacy scale or offset.",
      "Neutral main-wing and control-surface chord envelope sampled directly from 24 exported skin meshes. Narrow control gaps remain in the measured envelope.",
      "The fuselage-covered centre strip uses the measured root chord. Winglets are excluded; planar lifting span is shorter than the full airframe span.",
      "Leading-edge height as lifting datum; authored zero geometric incidence and twist.",
      config.section,
      "One chordwise horseshoe row, cosine spacing, straight wake and incompressible attached flow. Fuselage, tail, engines, viscous drag, stall and walls excluded.",
      "Flight, loading and fuel benches retain the game aircraft's separate legacy calibration; this wing extraction is for the new lab model.",
    ],
  };
}

if (import.meta.main) {
  const measured = await measureAureliaLab();
  await Bun.write(
    new URL("../lab/aurelia-geometry.json", import.meta.url),
    JSON.stringify(measured, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      asset: measured.asset,
      sha256: measured.revision,
      dimensions: measured.dimensions,
      mainWingSpan: measured.mainWingSpan,
      asymmetry: measured.maxChordAsymmetry,
    }),
  );
}
