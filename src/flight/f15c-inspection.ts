import { F15C_NOZZLE } from "../aircraft/f15c/design";
import { F15C_MUZZLE } from "./cannon";
import { Mesh, Object3D, PerspectiveCamera, Quaternion, Vector3 } from "three";
import type { AircraftModel } from "../aircraft/aircraft";
import type { FlightPhysics } from "./physics";

export function measuredNozzleDiameter(root: Object3D, side: "Left" | "Right") {
  const ring = root.getObjectByName(`Nozzle_exit_${side}`);
  if (!(ring instanceof Mesh)) return NaN;
  const positions = ring.geometry.getAttribute("position"), center = side === "Right" ? F15C_NOZZLE.x : -F15C_NOZZLE.x;
  let radius = Infinity;
  for (let i = 0; i < positions.count; i++) if (positions.getZ(i) > F15C_NOZZLE.exit - .0005)
    radius = Math.min(radius, Math.hypot(positions.getX(i) - center, positions.getY(i) - F15C_NOZZLE.y));
  return radius * 2;
}

export function inspectionShot(root: Object3D, view: "gun" | "nozzle") {
  const nozzle = view === "nozzle";
  return {
    position: root.localToWorld(nozzle ? new Vector3(3, .9, 10.8) : new Vector3(F15C_MUZZLE.x + .45, F15C_MUZZLE.y + .18, F15C_MUZZLE.z - .9)),
    // localToWorld overwrites its argument, and the muzzle is shared with the cannon.
    target: root.localToWorld(nozzle ? new Vector3(0, -.24, 7.5) : F15C_MUZZLE.clone()),
  };
}

// Opt-in developer instrumentation observes the live aircraft. It never drives
// physics, cannon state or animation poses, and is excluded from normal play.
export class F15CFlightInspection {
  private panel = document.createElement("section");
  private output = document.createElement("pre");
  private view = document.createElement("select");
  constructor(container: HTMLElement) {
    this.panel.setAttribute("aria-label", "F-15C live flight inspection");
    Object.assign(this.panel.style, { position: "absolute", top: "190px", left: "16px", zIndex: "50", padding: "10px", borderRadius: "6px", color: "#fff", background: "#102c35e8", font: "12px/1.5 monospace" });
    this.view.setAttribute("aria-label", "Flight inspection view");
    for (const [value, label] of [["flight", "Normal flight camera"], ["nozzle", "Flying nozzle close-up"], ["gun", "Flying gun close-up"]])
      this.view.add(new Option(label, value));
    this.view.addEventListener("change", () => this.view.blur());
    this.panel.append(this.view, this.output); container.append(this.panel);
  }
  update(aircraft: AircraftModel, camera: PerspectiveCamera, physics: FlightPhysics, mode: string, rounds: number, firing: boolean) {
    this.panel.hidden = aircraft.id !== "f15c";
    if (this.panel.hidden) return;
    const root = aircraft.group, motion = aircraft.effects?.motion;
    const rotor = root.getObjectByName("F15C_gun_rotor");
    if (!motion || !rotor) return;
    const diameter = (side: "Left" | "Right") => measuredNozzleDiameter(root, side).toFixed(4);
    this.output.textContent = `${mode} · ${physics.grounded ? "grounded" : "airborne"}${physics.crashed ? " · CRASHED" : ""}\n` +
      `flight ${physics.flightTime.toFixed(2)} s · altitude ${physics.position.y.toFixed(1)} m\n` +
      `airspeed ${(physics.airspeed * 1.94384).toFixed(1)} kt · bank ${(physics.roll * 180 / Math.PI).toFixed(1)}°\n` +
      `power ${(motion.rpm * 100).toFixed(1)}% · AB ${(motion.burner * 100).toFixed(1)}%\n` +
      `mesh nozzle L ${diameter("Left")} / R ${diameter("Right")} m\n` +
      `gun ${(motion.gunSpeed * 30 / Math.PI).toFixed(1)} rpm · phase ${(-rotor.rotation.z * 180 / Math.PI).toFixed(2)}°\n` +
      `rotor ${rotor.children.length} parts · pose error ${Math.abs(rotor.rotation.z + motion.gunAngle).toExponential(1)} rad\n` +
      `rounds ${rounds} · ${firing ? "FIRING" : "released"}`;
    if (this.view.value === "flight" || mode === "menu" || mode === "replay") return;
    root.updateWorldMatrix(true, true);
    const shot = inspectionShot(root, this.view.value === "nozzle" ? "nozzle" : "gun");
    camera.position.copy(shot.position);
    camera.up.set(0, 1, 0).applyQuaternion(root.getWorldQuaternion(new Quaternion()));
    camera.lookAt(shot.target);
    camera.fov = 35; camera.near = .01; camera.updateProjectionMatrix();
  }
  dispose() { this.panel.remove(); }
}
