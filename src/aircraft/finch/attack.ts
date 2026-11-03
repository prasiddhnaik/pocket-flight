import * as T from "three";
import type { StoreLayout, StoreLoad } from "../aircraft-stores";

// Finch A-2: the light-attack variant of the U-2 trainer. It loads the same
// airframe; only the finish, markings and underwing stores differ. The stores
// are visual: the flight model still uses the trainer's mass budget.

export type FinchVariant = "trainer" | "attack";

/** The variant's root node name, which selects its finish in aircraft-finish. */
export const FINCH_ATTACK_ROOT = "Finch_A2";

export type Hardpoint = {
  id: string;
  /** Store attachment point under the pylon, glTF metres: X right, Y up, −Z forward. */
  position: [number, number, number];
  /** Store ids this station accepts. */
  loads: string[];
};

// Ahead of the flaps, outboard of the main gear and propeller disc.
export const finchAttackHardpoints: Hardpoint[] = [
  { id: "left-outer", position: [-3.2, -0.2, -0.12], loads: ["rocket-pod-7", "bomb-250"] },
  { id: "left-inner", position: [-1.95, -0.27, -0.2], loads: ["bomb-250", "rocket-pod-7", "air-to-air"] },
  { id: "right-inner", position: [1.95, -0.27, -0.2], loads: ["bomb-250", "rocket-pod-7", "air-to-air"] },
  { id: "right-outer", position: [3.2, -0.2, -0.12], loads: ["rocket-pod-7", "bomb-250"] },
];

/** Which store hangs on each hardpoint; null leaves the pylon empty. */
export type Loadout = Record<string, StoreLoad | null>;

export const finchAttackLoadout: Loadout = {
  "left-outer": "rocket-pod-7",
  "left-inner": "bomb-250",
  "right-inner": "bomb-250",
  "right-outer": "rocket-pod-7",
};

export function finchAttackStores(loadout: Loadout = finchAttackLoadout): StoreLayout {
  return {
    airframe: FINCH_ATTACK_ROOT,
    floor: -0.9,
    pylon: { length: 0.85, drop: 0.16 },
    tipRails: false,
    tipLights: false,
    fuselage: [],
    blades: [
      { z: 1.35, size: 0.2 },
      { z: 2.35, size: 0.16 },
    ],
    pitots: [],
    pylons: finchAttackHardpoints.map((h) => {
      const load = loadout[h.id] ?? null;
      if (load && !h.loads.includes(load)) throw new Error(`Hardpoint ${h.id} cannot carry ${load}.`);
      return { id: h.id, x: Math.abs(h.position[0]), z: h.position[2], side: h.position[0] < 0 ? -1 : 1, load };
    }),
  };
}

export const finchAttackPaints = [
  { name: "Low-vis gray", body: "#646c71", accent: "#4a5257" },
  { name: "Olive", body: "#4c5239", accent: "#363b29" },
  { name: "Desert", body: "#958160", accent: "#6f5e45" },
];

/** Two-tone tactical scheme: the trainer's livery areas take the darker tone and
 * its white registration lettering is painted out in the body colour. */
export function paintFinchAttack(root: T.Object3D, index: number) {
  const scheme = finchAttackPaints[index] ?? finchAttackPaints[0];
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof T.MeshStandardMaterial)) continue;
      const body = /^(Paint|Markings) •/.test(material.name);
      if (!body && !material.name.startsWith("Livery •")) continue;
      material.color.set(body ? scheme.body : scheme.accent);
      material.roughness = Math.max(material.roughness, 0.62);
      material.envMapIntensity = 0.6;
      if (material instanceof T.MeshPhysicalMaterial) material.clearcoat = Math.min(material.clearcoat, 0.08);
    }
  });
}

// The trainer's raised "PF-U2" registration letters behind the canopy, both
// sides, inside the shared frame mesh (|x|, y, z in glTF metres).
const REGISTRATION = new T.Box3(new T.Vector3(0.3, 0.25, 1.05), new T.Vector3(0.55, 0.37, 1.55));

/** Drops the civil registration letters; the rest of the frame mesh stays. */
export function removeRegistration(root: T.Object3D) {
  const frame = root.getObjectByName("Fuselage_•_Frame");
  if (!(frame instanceof T.Mesh) || !frame.geometry.index) return;
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert().multiply(frame.matrixWorld);
  const position = frame.geometry.getAttribute("position");
  const index = frame.geometry.index;
  const vertex = new T.Vector3(),
    centre = new T.Vector3();
  const kept: number[] = [];
  for (let k = 0; k < index.count; k += 3) {
    centre.set(0, 0, 0);
    for (let m = 0; m < 3; m++) centre.add(vertex.fromBufferAttribute(position, index.getX(k + m)));
    centre.divideScalar(3).applyMatrix4(toRoot);
    centre.x = Math.abs(centre.x);
    if (!REGISTRATION.containsPoint(centre)) kept.push(index.getX(k), index.getX(k + 1), index.getX(k + 2));
  }
  frame.geometry.setIndex(kept);
}
