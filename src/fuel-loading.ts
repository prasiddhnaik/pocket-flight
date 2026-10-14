import calibration from "./fuel-mass-calibration.json";
import type { AircraftId } from "./aircraft";
import type { MassComponent, Loading } from "./aircraft-design";
export type FuelTank = (typeof calibration.aircraft.finch.tanks)[number];
export function fuelInstallation(id: AircraftId) {
  return calibration.aircraft[id];
}

export function tankState(tank: FuelTank, fraction: number) {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
    throw RangeError("Invalid tank fill fraction");
  const index = Math.min(
    tank.samples.length - 2,
    Math.floor(fraction * (tank.samples.length - 1)),
  );
  const a = tank.samples[index],
    b = tank.samples[index + 1],
    t = (fraction - a.fraction) / (b.fraction - a.fraction);
  return {
    center: a.center.map((v, i) => v + (b.center[i] - v) * t),
    inertiaPerKg: a.inertiaPerKg.map((v, i) => v + (b.inertiaPerKg[i] - v) * t),
  };
}

export function tankFractions(
  parts: readonly MassComponent[],
  loading: Loading,
) {
  const fuel = parts.filter((p) => p.fuelTank),
    result: Record<string, number> = {};
  let remaining = fuel.reduce((sum, p) => sum + p.mass, 0) * loading.fuel;
  for (const priority of [
    ...new Set(fuel.map((p) => p.fuelTank!.fillPriority)),
  ].sort((a, b) => a - b)) {
    const group = fuel.filter((p) => p.fuelTank!.fillPriority === priority),
      capacity = group.reduce((sum, p) => sum + p.mass, 0);
    const fraction = Math.min(1, remaining / capacity);
    for (const p of group) result[p.fuelTank!.id] = fraction;
    remaining = Math.max(0, remaining - capacity);
  }
  for (const [id, fraction] of Object.entries(loading.tanks ?? {})) {
    if (
      !Object.hasOwn(result, id) ||
      !Number.isFinite(fraction) ||
      fraction < 0 ||
      fraction > 1
    )
      throw RangeError(`Invalid fuel load for tank ${id}`);
    result[id] = fraction;
  }
  return result;
}

export function consumeTankFuel(
  tanks: readonly FuelTank[],
  fuel: Record<string, number>,
  burnKg: number,
) {
  if (!Number.isFinite(burnKg) || burnKg < 0)
    throw RangeError("Invalid fuel consumption");
  const next = { ...fuel };
  for (const tank of tanks) {
    const kg = next[tank.id];
    if (
      !Number.isFinite(kg) ||
      kg < 0 ||
      kg > tank.usableLitres * tank.densityKgPerLitre * (1 + 1e-10)
    )
      throw RangeError(`Invalid fuel quantity in ${tank.id}`);
  }
  for (const priority of [...new Set(tanks.map((t) => t.fillPriority))].sort(
    (a, b) => b - a,
  )) {
    const group = tanks.filter((t) => t.fillPriority === priority),
      available = group.reduce((sum, t) => sum + (next[t.id] ?? 0), 0);
    const take = Math.min(burnKg, available);
    if (available > 0)
      for (const tank of group)
        next[tank.id] = Math.max(0, next[tank.id] * (1 - take / available));
    burnKg = Math.max(0, burnKg - take);
  }
  return next;
}

export function calibratedMassBudget(
  id: AircraftId,
  base: readonly MassComponent[],
): MassComponent[] {
  const data = fuelInstallation(id);
  const parts = base
    .filter((p) => p.category !== "fuel")
    .map((p) => ({ ...p }));
  for (const installation of data.installations) {
    const source = parts.find((p) => p.name === installation.source);
    if (!source || source.mass < installation.mass)
      throw Error(`Invalid mass allocation: ${id} ${installation.name}`);
    source.mass -= installation.mass;
    parts.push({
      name: installation.name,
      mass: installation.mass,
      center: installation.center,
      size: installation.size,
      category: "empty",
    });
  }
  for (const tank of data.tanks) {
    parts.push({
      name: `${tank.name}: unusable fuel`,
      mass: tank.unusableLitres * tank.densityKgPerLitre,
      center: tank.residual.center,
      size: tank.size,
      category: "empty",
      inertiaPerKg: tank.residual.inertiaPerKg,
      trappedFuel: true,
    });
    parts.push({
      name: `${tank.name}: usable fuel`,
      mass: tank.usableLitres * tank.densityKgPerLitre,
      center: tank.samples.at(-1)!.center,
      size: tank.size,
      category: "fuel",
      fuelTank: tank,
    });
  }
  return parts;
}
