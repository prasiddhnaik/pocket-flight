import type { FuelTank } from "../flight/fuel-loading";

// SI units; +X right, +Y up, +Z aft.
export type MassComponent = {
  name: string;
  mass: number;
  center: readonly number[];
  size: readonly number[];
  category: "empty" | "fuel" | "payload";
  fuelTank?: FuelTank;
  inertiaPerKg?: readonly number[];
  trappedFuel?: boolean;
};
export const part = (
  name: string,
  mass: number,
  center: number[],
  size: number[],
  category: MassComponent["category"] = "empty",
): MassComponent => ({ name, mass, center, size, category });
