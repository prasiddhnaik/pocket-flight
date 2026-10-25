import * as T from "three";
import { CockpitDisplays } from "./cockpit-displays";
import { refineAircraftMaterials as prepareAircraftMaterials } from "./aircraft-materials";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { AureliaEffects } from "./aurelia/aurelia-effects";
import { JetEffects } from "./jet-effects";
import { STORMBIRD_CENTER, stormbirdLayout } from "./stormbird/stormbird-config";
export type AircraftId = "finch" | "peregrine" | "aurelia" | "stormbird" | "heron" | "f15c";
import { F15CEffects } from "./f15c/effects";
import { f15cControlSurfaces } from "./f15c/mechanisms";
export const isPropellerAircraft = (id: AircraftId) => id === "finch" || id === "heron";
export const JET_SCALE = 0.7;
export const JET_CENTER = 2.3;
import { controlSurfaces } from "./finch/control-surfaces";
import { propellerAnimation } from "./finch/propeller";
export const paints = [
  { name: "Sunrise", color: "#eab34c", dark: "#bc702f" },
  { name: "Lagoon", color: "#48b9b1", dark: "#1f746e" },
  { name: "Coral", color: "#e67862", dark: "#a64335" },
  { name: "Cloud", color: "#e8e4d8", dark: "#7b898b" },
  { name: "Midnight", color: "#526980", dark: "#2a3b50" },
];
export const AIRCRAFT_URL = "/assets/finch-u2.glb";
export { refineAircraftMaterials as prepareAircraftMaterials } from "./aircraft-materials";
export function disposeAircraft(root: T.Object3D, disposeTextures = true) {
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  root.traverse((object) => {
    if (!(
      object instanceof T.Mesh ||
      object instanceof T.Points ||
      object instanceof T.Sprite
    ))
      return;
    if (!(object instanceof T.Sprite)) object.geometry.dispose();
    for (const m of Array.isArray(object.material)
      ? object.material
      : [object.material])
      materials.add(m);
  });
  for (const material of materials) {
    for (const value of Object.values(material))
      if (value instanceof T.Texture) textures.add(value);
    material.dispose();
  }
  if (disposeTextures) textures.forEach((texture) => texture.dispose());
}
export function makeAircraft(paintIndex = 0, id: AircraftId = "finch") {
  const group = new T.Group();
  group.name = `PocketFlight_${id}`;
  let selectedPaint = paintIndex;
  let disposed = false;
  const livery = new Set<T.MeshStandardMaterial>();
  const restPositions = new Map<string, T.Vector3>();
  const controls = new Map<string, T.Object3D>();
  const f15Surfaces = f15cControlSurfaces(controls);
  const model = {
    group,
    id,
    displays: null as CockpitDisplays | null,
    effects: null as JetEffects | AureliaEffects | F15CEffects | null,
    cameraScale: id === "f15c" ? 1.9 : id === "aurelia" ? 1.8 : id === "heron" ? 1.55 : id === "finch" ? 1 : 1.4,
    wings: [new T.Group(), new T.Group()] as T.Object3D[],
    gear: new T.Group() as T.Object3D,
    propeller: new T.Group() as T.Object3D,
    propellerMotion: propellerAnimation(id === "heron" ? { radius: 1.32, blades: 4, idleRpm: 600, maxRpm: 1900 } : undefined),
    ready: Promise.resolve(),
    controls,
    surfaces: id === "f15c" ? f15Surfaces : controlSurfaces(controls),
    setConfiguration(flaps: number, steering = 0) {
      if (id === "f15c") {
        f15Surfaces.setFlaps(flaps);
        return;
      }
      if (id !== "heron") return;
      for (const name of ["Flap_Left", "Flap_Right"]) {
        const node = controls.get(name);
        if (node) node.rotation.x = T.MathUtils.degToRad(35 * T.MathUtils.clamp(flaps, 0, 1));
      }
      const nose = controls.get("Front_Wheel_Steering");
      if (nose) nose.rotation.y = T.MathUtils.degToRad(25 * steering);
    },
    setPaint(index: number) {
      selectedPaint = index;
      livery.forEach((material) => material.color.set(paints[index].color));
    },
    bodyCompression(meters: number, suspensionResolved = false) {
      if (suspensionResolved) return 0;
      // Finch has authored telescoping carriers. Stormbird contact already
      // includes its oleo stroke; the other jets have rigid exported legs.
      return id === "finch" ? T.MathUtils.clamp(meters, 0, 0.16) : 0;
    },
    setSuspension(meters: number) {
      if (id === "heron") return; // Rigid fixed legs; contact datums match the CAD.
      const travel = T.MathUtils.clamp(meters, 0, 0.16);
      if (model.effects) {
        model.effects.setSuspension(id === "stormbird" ? travel : 0);
        return;
      }
      for (const name of [
        "Suspension_Main_Left",
        "Suspension_Main_Right",
        "Suspension_Nose",
      ]) {
        const node = model.controls.get(name),
          rest = restPositions.get(name);
        if (!node || !rest) continue;
        node.position.copy(rest);
        node.position.y += travel;
        if (name !== "Suspension_Nose")
          node.position.x += (name.endsWith("Left") ? 1 : -1) * travel * 0.65;
      }
    },
    dispose() {
      disposed = true;
      model.displays?.dispose();
      if (model.effects instanceof F15CEffects) model.effects.dispose();
      disposeAircraft(group);
    },
  };
  model.ready = new GLTFLoader()
    .loadAsync(
      id === "f15c"
        ? "/assets/f15c-eagle.glb"
        : id === "heron"
        ? "/assets/heron-ut9.glb"
        : id === "stormbird"
        ? "/assets/stormbird-hx40.gltf"
        : id === "aurelia"
          ? "/assets/aurelia-flight.glb"
          : id === "peregrine"
            ? "/assets/peregrine-hx27.glb"
            : AIRCRAFT_URL,
    )
    .then((gltf) => {
      if (disposed) {
        disposeAircraft(gltf.scene);
        return;
      }
      prepareAircraftMaterials(gltf.scene);
      model.displays = new CockpitDisplays(gltf.scene, id);
      group.add(gltf.scene);
      const part = (name: string) => {
        const node = gltf.scene.getObjectByName(name);
        if (!node) throw new Error(`The ${id} aircraft is missing ${name}.`);
        return node;
      };
      model.wings = [part("Wing_Left"), part("Wing_Right")];
      model.gear = part("LandingGear");
      if (id === "f15c") {
        for (const name of ["Aileron_Left", "Aileron_Right", "Flap_Left", "Flap_Right", "Stabilator_Left", "Stabilator_Right", "Rudder_Left", "Rudder_Right", "Canopy", "Airbrake", "Gear_Nose", "Gear_Left", "Gear_Right"])
          controls.set(name, part(name));
        model.effects = new F15CEffects(gltf.scene);
        model.effects.reset();
        return;
      }
      if (id === "stormbird") {
        gltf.scene.position.y = -STORMBIRD_CENTER;
        model.effects = new JetEffects(gltf.scene, stormbirdLayout);
        return;
      }
      if (id === "aurelia") {
        gltf.scene.scale.setScalar(0.55);
        gltf.scene.position.y = -2.3 * 0.55;
        model.effects = new AureliaEffects(gltf.scene, gltf.animations);
        return;
      }
      if (id === "peregrine") {
        gltf.scene.scale.setScalar(JET_SCALE);
        gltf.scene.position.y = -JET_CENTER * JET_SCALE;
        gltf.scene.traverse((node) => {
          if (node instanceof T.Mesh) {
            for (const material of Array.isArray(node.material)
              ? node.material
              : [node.material]) {
              if (
                material instanceof T.MeshStandardMaterial &&
                material.name.startsWith("Glass")
              ) {
                material.side = T.FrontSide;
                material.opacity = 0.22;
              }
            }
          }
        });
        model.effects = new JetEffects(gltf.scene);
        return;
      }
      model.propeller = part("Propeller");
      model.propellerMotion.bind(model.propeller);
      for (const name of [
        "Aileron_Left",
        "Aileron_Right",
        "Flap_Left",
        "Flap_Right",
        "Elevator",
        "Rudder",
        "Wheel_Main_Left",
        "Wheel_Main_Right",
        "Wheel_Front",
        "Front_Wheel_Steering",
        "Suspension_Main_Left",
        "Suspension_Main_Right",
        "Suspension_Nose",
      ])
        model.controls.set(name, part(name));
      gltf.scene.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          if (
            material instanceof T.MeshStandardMaterial &&
            material.name.startsWith("Livery • coastal")
          )
            livery.add(material);
        }
      });
      for (const [name, node] of model.controls)
        restPositions.set(name, node.position.clone());
      model.surfaces.apply(model.surfaces.snapshot());
      model.setPaint(selectedPaint);
    });
  return model;
}
export type AircraftModel = ReturnType<typeof makeAircraft>;
