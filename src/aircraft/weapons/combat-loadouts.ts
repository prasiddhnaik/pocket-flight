import { Box3, Object3D, Vector3 } from "three";
import { finchAttackHardpoints } from "../finch/attack";
import { F15C_MUZZLE } from "../../flight/cannon";
import {
  validateLoadout,
  type Hardpoint,
  type Loadout,
} from "../../flight/combat/loadout";

export type CombatAircraft = {
  hardpoints: Hardpoint[];
  loadout: Loadout;
  gun: [number, number, number] | null;
  /** Stores the model already shows, left on the aircraft instead of a stand-in. */
  keepStores?: string[];
};
const registered = new Map<string, CombatAircraft>();
export function supportsCombat(id: string) {
  return (
    ["f15c", "peregrine", "stormbird", "finch-attack"].includes(id) ||
    registered.has(id)
  );
}
/** The attack-Finch owner can register its declared hardpoints and default loadout here. */
export function registerCombatAircraft(
  id: string,
  configuration: CombatAircraft,
) {
  const errors = validateLoadout(
    configuration.hardpoints,
    configuration.loadout,
  );
  if (errors.length) throw new Error(errors.join("; "));
  registered.set(id, configuration);
}

export function combatAircraft(
  id: string,
  root: Object3D,
): CombatAircraft | null {
  const supplied = registered.get(id);
  if (supplied) return supplied;
  if (id === "finch-attack")
    return {
      hardpoints: finchAttackHardpoints,
      // Rocket pods outboard, a missile on each inner pylon where the bombs hang
      // until bomb release exists.
      loadout: finchAttackHardpoints.map((point) => ({
        hardpoint: point.id,
        store: point.id.endsWith("outer") ? "rocket-pod-7" : "air-to-air",
      })),
      gun: null,
      keepStores: ["rocket-pod-7"],
    };
  if (!["f15c", "peregrine", "stormbird"].includes(id)) return null;
  // Reuse the measured mounts, including model scaling/CG offsets, rather than
  // duplicating model-space coordinates. The resulting data is in aircraft metres.
  root.updateWorldMatrix(true, true);
  const hardpoints: Hardpoint[] = [];
  root.traverse((node) => {
    if (node.userData.weaponStore !== true) return;
    // A stand-in hangs from its centre, but a stock missile's origin is its nose.
    const box = new Box3().setFromObject(node);
    const position = root.worldToLocal(box.isEmpty() ? node.getWorldPosition(new Vector3()) : box.getCenter(new Vector3()));
    hardpoints.push({
      id: `station-${hardpoints.length + 1}`,
      position: [position.x, position.y, position.z],
      loads: ["rocket", "air-to-air"],
    });
  });
  if (!hardpoints.length) return null;
  const rocketStations = new Set<string>();
  for (const side of [-1, 1]) {
    const point = hardpoints.find(
      (point) => Math.sign(point.position[0]) === side,
    );
    if (point) rocketStations.add(point.id);
  }
  return {
    hardpoints,
    loadout: hardpoints.map((point) => ({
      hardpoint: point.id,
      store: rocketStations.has(point.id) ? "rocket" : "air-to-air",
    })),
    gun:
      id === "f15c"
        ? [F15C_MUZZLE.x, F15C_MUZZLE.y, F15C_MUZZLE.z]
        : // Just outside the skin at z = -4, measured from each model.
          id === "peregrine" ? [1.6, 0.3, -4] : [1, 0, -4],
  };
}
