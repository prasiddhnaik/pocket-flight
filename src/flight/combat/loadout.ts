export type Hardpoint = {
  id: string;
  /** Aircraft frame, metres: X right, Y up, -Z forward. */
  position: [number, number, number];
  loads: string[];
};
export type Loadout = { hardpoint: string; store: string }[];
export type WeaponKind = "rocket" | "missile";
export type Store = {
  kind: WeaponKind;
  rounds: number;
  massKg: number;
  dragArea: number;
  speed: number;
  lifetime: number;
  damage: number;
};
// Training approximations, not manufacturer flight or firing tables.
export const stores: Readonly<Record<string, Store>> = {
  rocket: {
    kind: "rocket",
    rounds: 4,
    massKg: 60,
    dragArea: 0.035,
    speed: 350,
    lifetime: 8,
    damage: 3,
  },
  "rocket-pod-7": {
    kind: "rocket",
    rounds: 7,
    massKg: 85,
    dragArea: 0.045,
    speed: 350,
    lifetime: 8,
    damage: 3,
  },
  "air-to-air": {
    kind: "missile",
    rounds: 1,
    massKg: 85,
    dragArea: 0.015,
    speed: 520,
    lifetime: 12,
    damage: 3,
  },
};
export const STORE_PHYSICS_ENABLED = false;

export function validateLoadout(
  hardpoints: readonly Hardpoint[],
  loadout: readonly Loadout[number][],
): string[] {
  const errors: string[] = [];
  const stations = new Set<string>();
  for (const point of hardpoints) {
    if (!point.id || stations.has(point.id))
      errors.push(`Duplicate or empty hardpoint: ${point.id}`);
    if (point.position.length !== 3 || !point.position.every(Number.isFinite))
      errors.push(`Invalid position: ${point.id}`);
    stations.add(point.id);
  }
  const seen = new Set<string>();
  for (const load of loadout) {
    const station = hardpoints.find((point) => point.id === load.hardpoint);
    if (seen.has(load.hardpoint))
      errors.push(`Duplicate station: ${load.hardpoint}`);
    seen.add(load.hardpoint);
    if (
      !station ||
      !station.loads.includes(load.store) ||
      !Object.hasOwn(stores, load.store)
    )
      errors.push(`Invalid store: ${load.hardpoint}/${load.store}`);
  }
  return errors;
}

/** Metadata only. The game never applies this to aircraft mass or aerodynamics. */
export function storePhysicsDelta(
  loadout: readonly Loadout[number][],
  enabled = STORE_PHYSICS_ENABLED,
) {
  return loadout.reduce(
    (sum, load) => {
      const store = stores[load.store];
      if (enabled && Object.hasOwn(stores, load.store)) {
        sum.massKg += store.massKg;
        sum.dragArea += store.dragArea;
      }
      return sum;
    },
    { massKg: 0, dragArea: 0 },
  );
}
