import { Box3, Mesh, Vector3 } from "three";
import {
  runtimeAircraftCatalog as aircraftCatalog,
  zeroLiftEstimate,
  type LabAircraftId,
} from "../lab/aircraft";
import { loadGeometryOnly } from "./geometry-loader";
import { measureFinch } from "./measure-finch";
import stormbirdDesign from "../docs/stormbird-design.json";

async function measureAircraft(id: LabAircraftId) {
  const config = aircraftCatalog[id];
  const url = new URL(`../public/assets/${config.asset}`, import.meta.url);
  const { scene, sha256 } = await loadGeometryOnly(url);
  scene.scale.setScalar(config.scale);
  scene.position.y = config.offsetY;
  scene.updateMatrixWorld(true);
  const dimensions = new Box3()
    .setFromObject(scene)
    .getSize(new Vector3())
    .toArray();
  const meshes: Mesh[] = [];
  for (const side of ["Left", "Right"])
    scene.getObjectByName(`Wing_${side}`)!.traverse((node) => {
      const name = String(node.userData.name ?? node.name);
      if (
        node instanceof Mesh &&
        !/Hardware|titanium|seals|(?:^|[ _•|])Frame(?:$|[ _•|])|Livery/i.test(
          name,
        ) &&
        !(id === "peregrine" && /Panels.*lower/i.test(name)) &&
        !(id === "stormbird" && /Wing_.*_mesh_2$/.test(name)) &&
        /Wing|Aileron|Flap/i.test(name)
      )
        meshes.push(node);
    });
  if (!meshes.length)
    throw new Error(`No lifting-surface meshes found for ${id}.`);
  const triangles: Vector3[][] = [];
  const bounds = new Box3();
  for (const mesh of meshes) {
    const vertices = mesh.geometry.getAttribute("position"),
      indices = mesh.geometry.index;
    for (let i = 0; i < (indices?.count ?? vertices.count); i += 3) {
      const triangle = [0, 1, 2].map((j) =>
        new Vector3()
          .fromBufferAttribute(vertices, indices ? indices.getX(i + j) : i + j)
          .applyMatrix4(mesh.matrixWorld),
      );
      triangle.forEach((v) => bounds.expandByPoint(v));
      triangles.push(triangle);
    }
  }
  const rightVertices = triangles.flat().filter((v) => v.x > 0.01);
  const rootX = Math.min(...rightVertices.map((v) => v.x)) + 0.001;
  const tipX = bounds.max.x - 0.002;
  function section(x: number) {
    const points: Vector3[] = [];
    for (const vertices of triangles)
      for (let i = 0; i < 3; i++) {
        const a = vertices[i],
          b = vertices[(i + 1) % 3];
        if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x))
          points.push(a.clone().lerp(b, (x - a.x) / (b.x - a.x)));
      }
    if (!points.length)
      throw new Error(`${id}: missing wing cross-section at ${x}.`);
    const leading = Math.min(...points.map((p) => p.z)),
      trailing = Math.max(...points.map((p) => p.z));
    const nose = points.filter((p) => p.z < leading + 0.001);
    return {
      x: Math.abs(x),
      y: nose.reduce((s, p) => s + p.y, 0) / nose.length,
      leading,
      chord: trailing - leading,
      zeroLiftAlpha: zeroLiftEstimate(config.camber),
    };
  }
  // Stormbird's exported root is cut away where the fuselage occupies the wing.
  // Its gross planform is declared in the CAD design sheet. Verify exported outer
  // boundaries, then reconstruct the covered wing rather than treating that void
  // or the separate inlet/root fairing as a lifting section.
  const positive =
    id === "stormbird"
      ? stormbirdDesign.geometry.wing.mainWingStationsCAD.map(
          ([x, leading, chord, y]) => ({
            x,
            y: y + config.offsetY,
            leading: -leading,
            chord,
            zeroLiftAlpha: zeroLiftEstimate(config.camber),
          }),
        )
      : Array.from({ length: 65 }, (_, i) =>
          section(rootX + ((tipX - rootX) * i) / 64),
        );
  if (id === "stormbird") {
    for (const s of positive.slice(1)) {
      const actual = section(Math.min(s.x + 0.001, tipX));
      if (
        Math.abs(actual.chord - s.chord) > 0.15 ||
        Math.abs(actual.leading - s.leading) > 0.15
      )
        throw new Error(
          "Stormbird main-wing design stations disagree with its exported mesh.",
        );
    }
  }
  const stations = [{ ...positive[0], x: 0 }, ...positive];
  const asymmetry = Math.max(
    ...positive.map((s) => {
      const x = Math.min(Math.max(s.x, rootX), tipX);
      return Math.abs(section(x).chord - section(-x).chord);
    }),
  );
  return {
    id,
    name: config.name,
    revision: sha256,
    dimensions,
    scale: config.scale,
    offsetY: config.offsetY,
    maxChordAsymmetry: asymmetry,
    meshNames: meshes.map((m) => m.name),
    stations,
    assumptions: [
      "Main-wing and neutral control-surface outer chord envelope extracted from the runtime export. Root fillets included where merged. Decorative hardware and seals excluded.",
      ...(id === "stormbird"
        ? [
            "Gross main-wing stations come from the CAD design sheet, verified against exported outer sections. Covered wing reconstructed across fuselage cutouts; separate inlet/root fairings excluded.",
          ]
        : []),
      `Runtime scale ${config.scale}, vertical offset ${config.offsetY} m. Centreline-covered strip reconstructed using measured root chord.`,
      `Symmetric wing reconstruction; maximum sampled left/right chord difference ${asymmetry.toExponential(3)} m.`,
      "Leading-edge height as lifting-surface datum; zero geometric twist/incidence assumed. No separate winglet panels.",
      config.section,
      "One chordwise horseshoe row, cosine span spacing, straight fixed wake. Steady incompressible attached flow.",
      "Wing only: fuselage, tail, gear, engines, viscous drag, stall and chamber walls excluded.",
    ],
  };
}

const fleet = [];
for (const id of Object.keys(aircraftCatalog) as LabAircraftId[]) {
  if (id === "finch") {
    const measured = await measureFinch(),
      config = aircraftCatalog.finch;
    fleet.push({
      id,
      name: config.name,
      revision: measured.sha256,
      dimensions: [
        measured.dimensions.span,
        measured.dimensions.height,
        measured.dimensions.length,
      ],
      scale: 1,
      offsetY: 0,
      maxChordAsymmetry: measured.wing.maxChordAsymmetry,
      meshNames: measured.wing.meshes,
      stations: measured.wing.solverStations.map((s) => ({
        x: s.x,
        y: s.leadingY,
        leading: s.leading,
        chord: s.chord,
        zeroLiftAlpha: zeroLiftEstimate(config.camber),
      })),
      assumptions: [
        measured.wing.convention,
        config.section,
        "Leading-edge height as lifting-surface datum; zero twist/incidence assumed. Symmetric reconstruction.",
        "One chordwise horseshoe row, cosine spacing, straight wake, incompressible attached flow.",
        "Wing only; fuselage, tail, gear, propeller, viscous drag, stall and chamber walls excluded.",
      ],
    });
  } else fleet.push(await measureAircraft(id));
  console.log(`${id}: extracted ${fleet.at(-1)!.stations.length} sections`);
}
await Bun.write(
  new URL("../lab/fleet-geometry.json", import.meta.url),
  `${JSON.stringify(fleet, null, 2)}\n`,
);
