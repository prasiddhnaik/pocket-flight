import * as T from "three";
import { aircraftCatalog } from "../lab/aircraft";
import { controlSurfaces } from "../src/aircraft/finch/control-surfaces";
import { JetEffects, initialJetInput } from "../src/aircraft/jet-effects";
import { stormbirdLayout } from "../src/aircraft/stormbird/stormbird-config";
import { loadGeometryOnly } from "./geometry-loader";

export const otherAircraft = ["finch", "peregrine", "stormbird"] as const;
export type OtherAircraft = (typeof otherAircraft)[number];
export const bodyMesh = {
  finch: "Fuselage_•_Paint",
  peregrine: "Sculpted_pressure_fuselage",
  stormbird: "Airframe_mesh_2",
} as const;
export const neutralFleetPose = () => ({
  gear: 1,
  compression: 0,
  roll: 0,
  pitch: 0,
  yaw: 0,
  flaps: 0,
  canopy: 0,
  phase: 0,
});
export type FleetAttachmentPose = ReturnType<typeof neutralFleetPose>;

// JetEffects' production transform path only needs these texture-factory stubs
// offline. No renderer is created; glow sprites and exhaust are excluded below.
function headlessGlowFactory() {
  if (typeof document !== "undefined") return;
  Object.defineProperty(globalThis, "devicePixelRatio", {
    value: 1,
    configurable: true,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement(tag: string) {
        if (tag !== "canvas")
          throw new Error(`Unexpected offline DOM request: ${tag}`);
        return {
          width: 64,
          height: 64,
          getContext: () => ({
            createRadialGradient: () => ({ addColorStop() {} }),
            fillRect() {},
            fillStyle: null,
          }),
        };
      },
    },
  });
}

export async function loadFleetAttachmentModel(id: OtherAircraft) {
  const config = aircraftCatalog[id];
  const loaded = await loadGeometryOnly(
    new URL(`../public/assets/${config.asset}`, import.meta.url),
  );
  const root = loaded.scene;
  root.scale.setScalar(config.scale);
  root.position.y = config.offsetY;
  root.updateMatrixWorld(true);
  const controls = new Map<string, T.Object3D>();
  root.traverse((node) => controls.set(node.name, node));
  const surfaces = controlSurfaces(controls);
  const carriers = [
    "Suspension_Main_Left",
    "Suspension_Main_Right",
    "Suspension_Nose",
  ].map((name) => ({
    node: controls.get(name),
    rest: controls.get(name)?.position.clone(),
  }));
  let effects: JetEffects | undefined;
  if (id !== "finch") {
    headlessGlowFactory();
    effects = new JetEffects(
      root,
      id === "stormbird" ? stormbirdLayout : undefined,
    );
    // Only actual aircraft meshes count as physical attachments. Sprites,
    // exhaust plumes and smoke aren't airframe parts.
    effects.group.removeFromParent();
  }
  function apply(pose: FleetAttachmentPose) {
    if (id === "finch") {
      surfaces.apply(pose);
      root.getObjectByName("Propeller")!.rotation.z = pose.phase;
      root.getObjectByName("Front_Wheel_Steering")!.rotation.y = pose.yaw * 0.4;
      // Matches makeAircraft.setSuspension: restore before every absolute pose.
      const travel = T.MathUtils.clamp(pose.compression, 0, 1) * 0.16;
      for (const { node, rest } of carriers) {
        if (!node || !rest) throw new Error("Missing Finch suspension carrier");
        node.position.copy(rest);
        node.position.y += travel;
        if (node.name !== "Suspension_Nose")
          node.position.x +=
            (node.name.endsWith("Left") ? 1 : -1) * travel * 0.65;
      }
      for (const side of ["Left", "Right"]) {
        const flap = controls.get(`Flap_${side}`);
        if (flap) flap.rotation.x = pose.flaps * 0.48; // Lab-only flap inspection range.
      }
    } else {
      const motion = effects!.motion;
      Object.assign(motion, {
        gear: pose.gear,
        canopy: pose.canopy,
        roll: pose.roll,
        pitch: pose.pitch,
        yaw: pose.yaw,
        flaps: pose.flaps,
        gearSteering: pose.yaw,
        rotorAngle: pose.phase,
        wheelAngle: pose.phase,
      });
      effects!.setSuspension(id === "stormbird" ? pose.compression * 0.16 : 0);
      // dt=0 freezes the dynamics while the actual production pose code runs.
      effects!.update(0, initialJetInput());
    }
    root.updateMatrixWorld(true);
  }
  return { ...loaded, root, apply };
}
