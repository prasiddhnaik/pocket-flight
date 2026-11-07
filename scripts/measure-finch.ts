import { loadGeometryOnly } from "./geometry-loader";
import { Box3, Mesh, Vector3 } from "three";

// Geometry-only loading keeps this repeatable in Bun without a browser image decoder.
export async function measureFinch() {
  const { scene, sha256 } = await loadGeometryOnly(
    new URL("../public/assets/finch-u2.glb", import.meta.url),
  );
  scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(scene);
  const dimensions = bounds.getSize(new Vector3());
  const wingMeshes: Mesh[] = [];
  for (const side of ["Left", "Right"]) {
    scene.getObjectByName(`Wing_${side}`)!.traverse((node) => {
      if (
        node instanceof Mesh &&
        /^(Wing_(Left|Right).*Paint$|Wing_(Left|Right)_skin$|Flap_(Left|Right)_skin$|Aileron_(Left|Right)_skin$)/.test(
          node.name,
        )
      )
        wingMeshes.push(node);
    });
  }
  const triangles: Vector3[][] = [];
  for (const mesh of wingMeshes) {
    const position = mesh.geometry.getAttribute("position");
    const indices = mesh.geometry.index;
    for (let i = 0; i < (indices?.count ?? position.count); i += 3) {
      const vertices = [0, 1, 2].map((j) =>
        new Vector3()
          .fromBufferAttribute(position, indices ? indices.getX(i + j) : i + j)
          .applyMatrix4(mesh.matrixWorld),
      );
      triangles.push(vertices);
    }
  }
  const section = (x: number) => {
    const points: Vector3[] = [];
    for (const vertices of triangles)
      for (let i = 0; i < 3; i++) {
        const a = vertices[i],
          b = vertices[(i + 1) % 3];
        if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x))
          points.push(a.clone().lerp(b, (x - a.x) / (b.x - a.x)));
      }
    if (!points.length) throw new Error(`No Finch wing section at x=${x}`);
    const leading = Math.min(...points.map((p) => p.z));
    const trailing = Math.max(...points.map((p) => p.z));
    const leadingPoints = points.filter((p) => p.z < leading + 0.001);
    const leadingY =
      leadingPoints.reduce((sum, p) => sum + p.y, 0) / leadingPoints.length;
    return { x, leading, trailing, chord: trailing - leading, leadingY };
  };
  const stations = [
    0.501, 0.8, 1.7, 2.8, 3.8, 4.8, 5.15, 5.3, 5.4, 5.46, 5.485,
  ].map(section);
  const root = stations[0];
  const slices = 800;
  const dx = (5.49 - 0.5) / slices;
  let exposedArea = 0;
  let chordSquaredIntegral = root.chord ** 2;
  let quarterChordIntegral = root.chord * (root.leading + root.chord / 4);
  for (let i = 0; i < slices; i++) {
    const s = section(0.5 + (i + 0.5) * dx);
    exposedArea += 2 * s.chord * dx;
    chordSquaredIntegral += 2 * s.chord ** 2 * dx;
    quarterChordIntegral += 2 * s.chord * (s.leading + s.chord / 4) * dx;
  }
  const referenceArea = exposedArea + root.chord;
  const solverStations = [
    { ...root, x: 0 },
    ...Array.from({ length: 65 }, (_, i) => section(0.501 + (5.488 - 0.501) * i / 64)),
  ];
  const maxChordAsymmetry = Math.max(...solverStations.slice(1).map((s) => Math.abs(s.chord - section(-s.x).chord)));
  const wheels = ["Wheel_Main_Left", "Wheel_Main_Right", "Wheel_Front"].map(
    (name) => ({
      name,
      center: scene
        .getObjectByName(name)!
        .getWorldPosition(new Vector3())
        .toArray(),
    }),
  );
  return {
    asset: "public/assets/finch-u2.glb",
    sha256,
    frame: "metres: X right, Y up, -Z forward",
    scale: 1,
    dimensions: {
      span: dimensions.x,
      length: dimensions.z,
      height: dimensions.y,
    },
    wing: {
      meshes: wingMeshes.map((m) => m.name),
      exposedArea,
      referenceArea,
      aspectRatio: dimensions.x ** 2 / referenceArea,
      meanAerodynamicChord: chordSquaredIntegral / referenceArea,
      quarterChordZ: quarterChordIntegral / referenceArea,
      stations,
      solverStations,
      maxChordAsymmetry,
      convention:
        "Spanwise integration of the exported main-wing/control-surface outer chord envelope (includes merged root fillets), plus a 1 m fuselage-covered strip at the measured root chord. 800 midpoint slices per half-wing; internal chordwise hinge gaps filled; spanwise control gaps remain.",
    },
    wheels,
  };
}

if (import.meta.main) {
  const json = JSON.stringify(await measureFinch(), null, 2);
  if (Bun.argv.includes("--save")) await Bun.write(new URL("../docs/aircraft/finch-geometry.json", import.meta.url), `${json}\n`);
  else console.log(json);
}
