import { Camera, Vector3 } from "three";
import { LOCK_TIME, type CombatSimulation } from "../flight/combat/simulation";
import type { WeaponKind } from "../flight/combat/loadout";

const LOCK_COLOUR = "#ff5a4d";
const GROUND_LABEL_RANGE = 800;

export class CombatHud {
  private root = document.createElement("div");
  private status = document.createElement("div");
  private markers = document.createElement("div");
  private buttons: HTMLButtonElement[] = [];
  private aim = document.createElement("div");
  private seeker = document.createElement("div");
  private box = document.createElement("div");
  private pipper = document.createElement("div");
  private inputs = { gun: false, rocket: false, missile: false };
  constructor(container: HTMLElement) {
    this.root.dataset.combatHud = "true";
    Object.assign(this.root.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "7",
      color: "#fff0c7",
      font: "12px system-ui",
      display: "none",
    });
    Object.assign(this.status.style, {
      position: "absolute",
      top: "200px",
      left: "16px",
      padding: "8px 12px",
      borderRadius: "6px",
      background: "#101b22cc",
      textAlign: "center",
      width: "min(420px, calc(100% - 32px))",
      whiteSpace: "pre-line",
    });
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    Object.assign(this.aim.style, {
      position: "absolute",
      transform: "translate(-50%,-50%)",
      fontSize: "22px",
    });
    this.aim.textContent = "+";
    // The seeker circle marks the cone a drone must sit inside to lock.
    Object.assign(this.seeker.style, {
      position: "absolute",
      transform: "translate(-50%,-50%)",
      borderRadius: "50%",
      border: "1.5px dashed #fff0c766",
      display: "none",
    });
    Object.assign(this.box.style, {
      position: "absolute",
      border: "2px solid #ffd98a",
      display: "none",
    });
    // Rocket pipper: where a rocket fired now would land.
    Object.assign(this.pipper.style, {
      position: "absolute",
      width: "18px",
      height: "18px",
      transform: "translate(-50%,-50%)",
      borderRadius: "50%",
      border: "2px solid #ffba6b",
      background: "radial-gradient(circle, #ffba6b 0 2px, transparent 2.5px)",
      display: "none",
    });
    this.seeker.dataset.combatSeeker = "true";
    this.box.dataset.combatLockBox = "true";
    this.pipper.dataset.combatPipper = "true";
    this.root.append(this.status, this.markers, this.seeker, this.box, this.pipper, this.aim);
    const controls = document.createElement("div");
    Object.assign(controls.style, {
      position: "absolute",
      bottom: "250px",
      right: "16px",
      display: "flex",
      gap: "8px",
      pointerEvents: "auto",
    });
    for (const kind of ["rocket", "missile", "gun"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent =
        kind === "rocket"
          ? "Rocket · K"
          : kind === "missile"
            ? "Missile · L"
            : "Gun · J";
      Object.assign(button.style, {
        padding: "10px",
        border: "1px solid #f2d79c",
        borderRadius: "5px",
        background: "#17232de6",
        color: "#fff0c7",
        touchAction: "none",
      });
      button.onpointerdown = (event) => {
        event.stopPropagation();
        button.setPointerCapture(event.pointerId);
        this.inputs[kind] = true;
      };
      const release = () => {
        this.inputs[kind] = false;
      };
      button.onpointerup =
        button.onpointercancel =
        button.onlostpointercapture =
          release;
      button.onkeydown = (event) => {
        if (event.code === "Space" || event.code === "Enter") {
          event.stopPropagation();
          event.preventDefault();
          this.inputs[kind] = true;
        }
      };
      button.onkeyup = (event) => {
        if (event.code === "Space" || event.code === "Enter") {
          event.stopPropagation();
          this.inputs[kind] = false;
        }
      };
      button.onblur = release;
      this.buttons.push(button);
      controls.append(button);
    }
    this.root.append(controls);
    container.append(this.root);
  }
  pressed(kind: WeaponKind | "gun") {
    return this.inputs[kind];
  }
  hide() {
    this.root.style.display = "none";
    this.suspend();
  }
  suspend() {
    this.inputs = { gun: false, rocket: false, missile: false };
  }
  render(
    visible: boolean,
    simulation: CombatSimulation | null,
    ammunition: number | null,
    camera: Camera,
    position: Vector3,
    aim: Vector3 | null,
    seekerEdge: Vector3 | null,
    rocketImpact: Vector3 | null,
    feedback: string,
    rearming: number,
  ) {
    this.root.style.display = visible ? "block" : "none";
    if (!visible || !simulation) {
      this.suspend();
      return;
    }
    const locked = simulation.locked;
    const missiles = simulation.ammunition("missile");
    const rockets = simulation.ammunition("rocket");
    const seeker = !missiles
      ? "NO MISSILES"
      : locked
        ? "LOCKED · L TO FIRE"
        : simulation.lock
          ? `ACQUIRING ${Math.round((simulation.lockTime / LOCK_TIME) * 100)}%`
          : "SEARCHING";
    const tracking = simulation.projectiles.filter((round) => round.kind === "missile" && round.target).length;
    const advice = rearming
      ? `REARMING ${rearming}s · hold the brakes`
      : !missiles && !rockets && !ammunition
        ? "WINCHESTER · land and stop on a runway to rearm"
        : "Land and stop on a runway to rearm";
    const gun = ammunition === null ? "" : `GUN ${ammunition} · `;
    const label = `WEAPONS SANDBOX · ${gun}ROCKET ${rockets} · MISSILE ${missiles}\nHITS ${simulation.hits} · DESTROYED ${simulation.destroyed} · SEEKER ${seeker}${tracking ? ` · ${tracking} TRACKING` : ""}\n${feedback || advice}`;
    if (this.status.textContent !== label) this.status.textContent = label;
    this.buttons[2].disabled = ammunition === null || ammunition === 0;
    this.buttons[0].disabled = rockets === 0;
    this.buttons[1].disabled = missiles === 0 || !locked;
    const place = (point: Vector3) => {
      const projected = point.clone().project(camera);
      if (projected.z < -1 || projected.z > 1) return null;
      return { x: (projected.x + 1) * 50, y: (1 - projected.y) * 50, ndc: projected };
    };
    this.markers.replaceChildren(
      ...simulation.targets
        .filter((target) => target.health > 0)
        .flatMap((target) => {
          const at = place(target.position);
          if (!at || Math.abs(at.ndc.x) > 1 || Math.abs(at.ndc.y) > 1) return [];
          const range = target.position.distanceTo(position);
          if (target.kind === "ground" && range > GROUND_LABEL_RANGE) return [];
          const marker = document.createElement("div");
          marker.dataset.combatTarget = target.id;
          const selected = target.id === simulation.lock;
          marker.textContent = `${target.kind === "air" ? "DRONE" : (target.model ?? "GROUND").toUpperCase()} ${Math.round(range)}m · ${target.health}/${target.maxHealth ?? 3}`;
          Object.assign(marker.style, {
            position: "absolute",
            left: `${at.x}%`,
            top: `${at.y}%`,
            transform: "translate(-50%, 22px)",
            color: selected && locked ? LOCK_COLOUR : target.kind === "ground" ? "#ffba6b" : "#9eeaff",
            background: "#101820a0",
            padding: "2px 4px",
            whiteSpace: "nowrap",
          });
          return [marker];
        }),
    );
    // Target box: closes in on the drone as the seeker settles, then turns red.
    const held = simulation.lock ? simulation.targets.find((target) => target.id === simulation.lock) : null;
    const boxAt = held && missiles ? place(held.position) : null;
    this.box.style.display = boxAt ? "block" : "none";
    if (boxAt) {
      const settle = Math.min(1, simulation.lockTime / LOCK_TIME);
      const size = locked ? 34 : 74 - 40 * settle;
      Object.assign(this.box.style, {
        left: `${boxAt.x}%`,
        top: `${boxAt.y}%`,
        width: `${size}px`,
        height: `${size}px`,
        borderColor: locked ? LOCK_COLOUR : "#ffd98a",
        transform: `translate(-50%,-50%) rotate(${locked ? 45 : 0}deg)`,
        opacity: locked || Math.floor(settle * 8) % 2 === 0 ? "1" : ".45",
      });
    }
    this.aim.style.display = "none";
    this.seeker.style.display = "none";
    const aimAt = aim && place(aim);
    if (aimAt) {
      this.aim.style.display = "block";
      this.aim.style.left = `${aimAt.x}%`;
      this.aim.style.top = `${aimAt.y}%`;
      const edgeAt = seekerEdge && place(seekerEdge);
      if (edgeAt && missiles) {
        const width = this.root.clientWidth || 1, height = this.root.clientHeight || 1;
        const radius = Math.hypot(((edgeAt.x - aimAt.x) / 100) * width, ((edgeAt.y - aimAt.y) / 100) * height);
        Object.assign(this.seeker.style, {
          display: "block",
          left: `${aimAt.x}%`,
          top: `${aimAt.y}%`,
          width: `${radius * 2}px`,
          height: `${radius * 2}px`,
          borderColor: locked ? LOCK_COLOUR : simulation.lock ? "#ffd98a" : "#fff0c766",
        });
      }
    }
    const impactAt = rocketImpact && place(rocketImpact);
    this.pipper.style.display = impactAt ? "block" : "none";
    if (impactAt) {
      this.pipper.style.left = `${impactAt.x}%`;
      this.pipper.style.top = `${impactAt.y}%`;
    }
  }
  dispose() {
    this.root.remove();
  }
}
