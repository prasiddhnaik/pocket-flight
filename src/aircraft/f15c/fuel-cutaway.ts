import { DoubleSide, Mesh, MeshStandardMaterial, Plane, Vector3, type Material, type Object3D } from "three";
import type { FuelTank } from "../../flight/fuel-loading";
import { f15cFuel } from "./fuel";

type LevelledSample = FuelTank["samples"][number] & { level: number };

/** Height of the fuel surface when a wing tank is this full, from the flight model's samples. */
export function fuelLevelAt(tank: FuelTank, fraction: number) {
  const samples = tank.samples as LevelledSample[];
  const position = Math.max(0, Math.min(1, fraction)) * (samples.length - 1);
  const index = Math.min(samples.length - 2, Math.floor(position));
  return samples[index].level + (samples[index + 1].level - samples[index].level) * (position - index);
}

const SKIN = /^(Wing_fixed_(Left|Right)|Flap_(Left|Right)_skin|Aileron_(Left|Right)_skin)$/;
const BLADDER = /^Wing_fuel_cell_(Left|Right)_\d$/;
const PLUMBING = /^Wing_fuel_(line_(Left|Right)_\d|feed_(Left|Right))$/;

/** Viewer cutaway: the wing skin turns to glass, showing the bladders and how full they are. */
export class F15CFuelCutaway {
  private enabled = false;
  private level = 1;
  private skin: { mesh: Mesh; material: Mesh["material"] }[] = [];
  private bladders: { mesh: Mesh; material: Mesh["material"] }[] = [];
  private plumbing: Mesh[] = [];
  private liquid: Mesh[] = [];
  private surface = new Plane(new Vector3(0, -1, 0), 0);
  private normal = new Vector3();
  private point = new Vector3();
  private glass = new MeshStandardMaterial({ name: "Cutaway • wing skin", color: "#b9c6cf", roughness: 0.3, transparent: true, opacity: 0.07, depthWrite: false, side: DoubleSide, envMapIntensity: 0.2 });
  private shell = new MeshStandardMaterial({ name: "Cutaway • empty bladder", color: "#dcd8cc", roughness: 0.9, transparent: true, opacity: 0.1, envMapIntensity: 0, depthWrite: false, side: DoubleSide });
  private fuel = new MeshStandardMaterial({ name: "Cutaway • fuel", color: "#e07d0c", emissive: "#5a2c02", roughness: 0.9, metalness: 0, envMapIntensity: 0, transparent: true, side: DoubleSide, clippingPlanes: [this.surface] });

  constructor(private readonly root: Object3D) {
    root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      if (SKIN.test(node.name)) this.skin.push({ mesh: node, material: node.material });
      else if (BLADDER.test(node.name)) this.bladders.push({ mesh: node, material: node.material });
      else if (PLUMBING.test(node.name)) this.plumbing.push(node);
    });
    for (const { mesh } of this.bladders) {
      const liquid = new Mesh(mesh.geometry, this.fuel);
      liquid.name = `${mesh.name}_fuel`;
      mesh.add(liquid);
      this.liquid.push(liquid);
    }
    this.apply();
  }
  get surfaceHeight() {
    return fuelLevelAt(f15cFuel.tanks.find((tank) => tank.id === "right")!, this.level);
  }
  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.apply();
  }
  setLevel(fraction: number) {
    this.level = fraction;
    // Fuel lies in a thin sheet, so from above it covers the bladder at any level. Fading it shows how much is left.
    this.fuel.opacity = 0.3 + 0.7 * fraction;
    this.updateSurface();
  }
  private apply() {
    for (const { mesh, material } of this.skin) mesh.material = this.enabled ? this.glass : material;
    for (const { mesh, material } of this.bladders) {
      mesh.visible = this.enabled;
      mesh.material = this.enabled ? this.shell : material;
    }
    for (const mesh of this.plumbing) mesh.visible = this.enabled;
    this.updateSurface();
  }
  /** Clipping works in world space, so the surface follows the aircraft. */
  private updateSurface() {
    if (!this.enabled) return;
    this.root.updateWorldMatrix(true, false);
    this.normal.set(0, -1, 0).transformDirection(this.root.matrixWorld);
    this.point.set(0, this.surfaceHeight, 0).applyMatrix4(this.root.matrixWorld);
    this.surface.setFromNormalAndCoplanarPoint(this.normal, this.point);
  }
  update() {
    this.updateSurface();
  }
  dispose() {
    this.setEnabled(false);
    for (const liquid of this.liquid) liquid.removeFromParent();
    const materials: Material[] = [this.glass, this.shell, this.fuel];
    for (const material of materials) material.dispose();
  }
}
