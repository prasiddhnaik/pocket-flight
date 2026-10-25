import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, MathUtils, Mesh, Object3D } from "three";

const nozzlePart = /^(?:(?:Convergent_petal|Divergent_petal|Nozzle_actuator|Nozzle_link|Nozzle_hinge)_(Left|Right)_\d+|(?:Nozzle_throat|Nozzle_exit|Afterburner_liner)_(Left|Right))$/;
const rotorPart = /^(?:Gun_(?:barrel|muzzle_face)_[1-6]|M61_(?:front_retainer|rear_retainer|center_hub))$/;
const smooth = (z: number, a: number, b: number) => {
  const t = MathUtils.clamp((z - a) / (b - a), 0, 1);
  return [t * t * (3 - 2 * t), 6 * t * (1 - t) / (b - a)];
};
export function nozzleAperture(power: number, burner: number) {
  // Estimated visual travel; the production engine's area-control schedule is
  // not simulated. Preserve rest at shutdown, contract dry, then open in AB.
  const dry = MathUtils.smoothstep(power, .05, .88), wet = MathUtils.clamp(burner, 0, 1);
  return { throat: MathUtils.lerp(-.012 * dry, .025, wet), exit: MathUtils.lerp(-.035 * dry, .035, wet) };
}
type NozzleMesh = {
  mesh: Mesh; original: BufferGeometry; geometry: BufferGeometry;
  positions: BufferAttribute; normals: BufferAttribute;
  rest: Float32Array; restNormals: Float32Array; profile: Float32Array;
};
export class F15CPowerplantRig {
  readonly rotor = new Group();
  readonly movingRoots: Object3D[] = [];
  private nozzles: NozzleMesh[] = [];
  private rotorParents: { mesh: Object3D; parent: Object3D }[] = [];
  private throat = NaN;
  private exit = NaN;
  constructor(root: Object3D) {
    const nodes: Object3D[] = [];
    root.traverse(node => nodes.push(node));
    for (const node of nodes) {
      const match = node.name.match(nozzlePart);
      if (!(node instanceof Mesh) || !match) continue;
      const original = node.geometry, geometry = original.clone();
      node.geometry = geometry;
      const positions = geometry.getAttribute("position") as BufferAttribute;
      const normals = geometry.getAttribute("normal") as BufferAttribute;
      positions.setUsage(DynamicDrawUsage); normals.setUsage(DynamicDrawUsage);
      const rest = Float32Array.from(positions.array), restNormals = Float32Array.from(normals.array);
      const profile = new Float32Array(positions.count * 7);
      const centerX = (match[1] ?? match[2]) === "Right" ? 1.025 : -1.025;
      for (let i = 0; i < positions.count; i++) {
        const x = rest[i * 3] - centerX, y = rest[i * 3 + 1] + .125, z = rest[i * 3 + 2];
        const r = Math.hypot(x, y), [a, da] = smooth(z, 8.63, 8.98), [b, db] = smooth(z, 8.98, 9.431);
        profile.set([x / r, y / r, r, a * (1 - b), b, da * (1 - b) - a * db, db], i * 7);
      }
      geometry.computeBoundingBox(); geometry.boundingBox!.expandByScalar(.036);
      geometry.computeBoundingSphere(); geometry.boundingSphere!.radius += .036;
      this.nozzles.push({ mesh: node, original, geometry, positions, normals, rest, restNormals, profile });
      this.movingRoots.push(node);
    }
    const barrels = nodes.filter(node => rotorPart.test(node.name) && node.parent);
    this.rotor.name = "F15C_gun_rotor";
    if (barrels.length) {
      barrels[0].parent!.add(this.rotor);
      this.rotor.position.set(2, .66, -2.05);
      root.updateWorldMatrix(true, true);
      for (const mesh of barrels) {
        this.rotorParents.push({ mesh, parent: mesh.parent! });
        this.rotor.attach(mesh);
      }
      this.movingRoots.push(this.rotor);
    }
    this.apply(0, 0, 0);
  }
  apply(power: number, burner: number, gunAngle: number) {
    this.rotor.rotation.z = -gunAngle;
    const { throat, exit } = nozzleAperture(power, burner);
    if (throat === this.throat && exit === this.exit) return;
    this.throat = throat; this.exit = exit;
    for (const { positions, normals, rest, restNormals, profile } of this.nozzles) {
      for (let i = 0; i < positions.count; i++) {
        const j = i * 3, k = i * 7;
        if (throat === 0 && exit === 0) {
          positions.setXYZ(i, rest[j], rest[j + 1], rest[j + 2]);
          normals.setXYZ(i, restNormals[j], restNormals[j + 1], restNormals[j + 2]);
          continue;
        }
        const ux = profile[k], uy = profile[k + 1], r = profile[k + 2];
        const d = profile[k + 3] * throat + profile[k + 4] * exit;
        const dz = profile[k + 5] * throat + profile[k + 6] * exit;
        positions.setXYZ(i, rest[j] + ux * d, rest[j + 1] + uy * d, rest[j + 2]);
        // Inverse-transpose Jacobian keeps the authored faceted/smooth normals.
        const nr = restNormals[j] * ux + restNormals[j + 1] * uy;
        const nt = (-restNormals[j] * uy + restNormals[j + 1] * ux) / (1 + d / r);
        const nx = nr * ux - nt * uy, ny = nr * uy + nt * ux, nz = restNormals[j + 2] - dz * nr;
        const length = Math.hypot(nx, ny, nz);
        normals.setXYZ(i, nx / length, ny / length, nz / length);
      }
      positions.needsUpdate = true; normals.needsUpdate = true;
    }
  }
  dispose() {
    for (const { mesh, original, geometry } of this.nozzles) { mesh.geometry = original; geometry.dispose(); }
    this.rotor.rotation.set(0, 0, 0);
    this.rotor.updateWorldMatrix(true, true);
    for (const { mesh, parent } of this.rotorParents) parent.attach(mesh);
    this.rotor.removeFromParent();
    this.nozzles = []; this.rotorParents = [];
  }
}
