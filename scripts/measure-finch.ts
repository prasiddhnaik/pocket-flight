import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Box3, Mesh, Vector3 } from "three";
import { createHash } from "node:crypto";

// Geometry-only loading keeps this repeatable in Bun without a browser image decoder.
export async function measureFinch() {
  const bytes = await Bun.file(
    new URL("../public/assets/finch-u2.glb", import.meta.url),
  ).arrayBuffer();
  const view = new DataView(bytes);
  const jsonLength = view.getUint32(12, true);
  const data = JSON.parse(
    new TextDecoder().decode(bytes.slice(20, 20 + jsonLength)),
  );
  delete data.images;
  delete data.textures;
  delete data.samplers;
  delete data.materials;
  for (const mesh of data.meshes)
    for (const primitive of mesh.primitives) delete primitive.material;
  const json = new TextEncoder().encode(JSON.stringify(data));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const binaryChunk = new Uint8Array(bytes, 20 + jsonLength);
  const geometryOnly = new Uint8Array(20 + paddedLength + binaryChunk.length);
  const header = new DataView(geometryOnly.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, geometryOnly.length, true);
  header.setUint32(12, paddedLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  geometryOnly.fill(32, 20, 20 + paddedLength);
  geometryOnly.set(json, 20);
  geometryOnly.set(binaryChunk, 20 + paddedLength);
  const { scene } = await new GLTFLoader().parseAsync(geometryOnly.buffer, "");
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
    sha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
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
  if (Bun.argv.includes("--save")) await Bun.write(new URL("../docs/finch-geometry.json", import.meta.url), `${json}\n`);
  else console.log(json);
}
