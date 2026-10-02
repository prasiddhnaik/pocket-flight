import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  sampleTransform,
  type SceneObject,
  type StudioScene,
  type Transform,
} from "./studio-scene";
import type { StudioAsset } from "./studio-assets";
type LoadedModel = { group: T.Group; animations: T.AnimationClip[] };
function disposeObject(root: T.Object3D, geometry = true, textures = true) {
  const materials = new Set<T.Material>(),
    geometries = new Set<T.BufferGeometry>(),
    maps = new Set<T.Texture>();
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      if (geometry) geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        if (textures)
          for (const value of Object.values(m))
            if (value instanceof T.Texture) maps.add(value);
      }
    }
  });
  maps.forEach((map) => {
    const image = map.image;
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
      image.close();
    map.dispose();
  });
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}
function standard() {
  return new T.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.55,
    metalness: 0.1,
  });
}
export async function loadAssetModel(asset: StudioAsset): Promise<LoadedModel> {
  const urls: string[] = [],
    manager = new T.LoadingManager();
  const resolve = (name: string) => {
    if (name.startsWith("data:") || name.startsWith("blob:")) return name;
    const path = decodeURIComponent(name)
      .replace(/^\.\//, "")
      .replaceAll("\\", "/");
    const matches = asset.files.filter(
      (f) => f.name === path || f.name.endsWith("/" + path),
    );
    const leaf = path.split("/").at(-1),
      file =
        matches[0] ??
        asset.files.find((f) => f.name.split("/").at(-1) === leaf);
    if (!file || /^https?:/i.test(path))
      throw new Error(
        `Missing local texture or buffer: ${name}. Select the glTF and its companion files together.`,
      );
    const type =
      file.type ||
      (
        {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
        } as Record<string, string>
      )[file.name.split(".").at(-1)!] ||
      "application/octet-stream";
    const url = URL.createObjectURL(new Blob([file.data], { type }));
    urls.push(url);
    return url;
  };
  manager.setURLModifier(resolve);
  const group = new T.Group();
  let animations: T.AnimationClip[] = [];
  try {
    const main = asset.files[0];
    if (asset.kind === "glb" || asset.kind === "gltf") {
      const data =
        asset.kind === "glb" ? main.data : new TextDecoder().decode(main.data);
      const gltf = await new GLTFLoader(manager).parseAsync(data, "");
      group.add(gltf.scene);
      animations = gltf.animations;
    } else if (asset.kind === "obj") {
      const model = new OBJLoader(manager).parse(
        new TextDecoder().decode(main.data),
      );
      const converted = new Map<T.Material, T.MeshStandardMaterial>();
      model.traverse((node) => {
        if (!(node instanceof T.Mesh)) return;
        const convert = (original: T.Material) => {
          let material = converted.get(original);
          if (!material) {
            const source = original as T.MeshPhongMaterial;
            material = new T.MeshStandardMaterial({
              color: source.color,
              vertexColors: source.vertexColors,
              flatShading: source.flatShading,
              map: source.map,
              opacity: source.opacity,
              transparent: source.transparent,
              side: source.side,
              roughness: 0.65,
            });
            converted.set(original, material);
          }
          return material;
        };
        node.material = Array.isArray(node.material)
          ? node.material.map(convert)
          : convert(node.material);
      });
      for (const original of converted.keys()) original.dispose();
      group.add(model);
    } else if (asset.kind === "stl") {
      const geometry = new STLLoader(manager).parse(main.data);
      geometry.computeVertexNormals();
      group.add(new T.Mesh(geometry, standard()));
    } else if (asset.kind === "image") {
      const url = URL.createObjectURL(
        new Blob([main.data], { type: main.type || "image/png" }),
      );
      urls.push(url);
      const texture = await new T.TextureLoader().loadAsync(url);
      texture.colorSpace = T.SRGBColorSpace;
      const image = texture.image as HTMLImageElement;
      const aspect = image.width / image.height;
      group.add(
        new T.Mesh(
          new T.PlaneGeometry(6, 6 / aspect),
          new T.MeshStandardMaterial({
            map: texture,
            transparent: true,
            side: T.DoubleSide,
            roughness: 1,
          }),
        ),
      );
    } else throw new Error("Audio belongs on a soundtrack layer.");
    group.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(group),
      size = box.getSize(new T.Vector3()),
      center = box.getCenter(new T.Vector3());
    if (
      box.isEmpty() ||
      ![size.x, size.y, size.z].every(Number.isFinite) ||
      Math.max(size.x, size.y, size.z) <= 0
    )
      throw new Error("This asset has no visible mesh geometry.");
    const wrapper = new T.Group();
    wrapper.add(group);
    group.position.sub(center);
    wrapper.scale.setScalar(6 / Math.max(size.x, size.y, size.z));
    wrapper.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return { group: wrapper, animations };
  } catch (e) {
    disposeObject(group);
    throw new Error(
      `${asset.name}: ${e instanceof Error ? e.message : "Unable to import this model."} Export an uncompressed GLB from Blender if a decoder is required.`,
    );
  } finally {
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}
function primitive(kind: SceneObject["kind"]) {
  const group = new T.Group();
  if (kind === "light") {
    group.add(new T.PointLight(0xffdf9c, 150, 200, 2));
    const marker = new T.Mesh(
      new T.SphereGeometry(0.3, 12, 8),
      new T.MeshBasicMaterial({ color: 0xffdf9c }),
    );
    marker.userData.editorOnly = true;
    group.add(marker);
    return group;
  }
  const geometry =
    kind === "sphere"
      ? new T.SphereGeometry(2, 32, 20)
      : kind === "cylinder"
        ? new T.CylinderGeometry(1.5, 1.5, 4, 32)
        : kind === "torus"
          ? new T.TorusGeometry(2, 0.5, 16, 48)
          : kind === "plane"
            ? new T.PlaneGeometry(6, 6)
            : new T.BoxGeometry(4, 4, 4);
  const material = standard();
  material.side = T.DoubleSide;
  const mesh = new T.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}
type Instance = {
  anchor: T.Group;
  group: T.Group;
  assetId?: string;
  kind: SceneObject["kind"];
  mixer: T.AnimationMixer | null;
  animation: number;
  actions: T.AnimationAction[];
  materials: {
    material: T.MeshStandardMaterial;
    base: T.Color;
    transparent: boolean;
    opacity: number;
  }[];
  appearance: string;
};
export class StudioSceneRenderer {
  private models = new Map<string, Promise<LoadedModel>>();
  private instances = new Map<string, Instance>();
  private disposed = false;
  constructor(private scene: T.Scene) {}
  async loadAsset(asset: StudioAsset) {
    let promise = this.models.get(asset.id);
    if (!promise) {
      promise = loadAssetModel(asset);
      this.models.set(asset.id, promise);
      promise
        .then((model) => {
          if (this.disposed) disposeObject(model.group);
        })
        .catch(() => this.models.delete(asset.id));
    }
    return promise;
  }
  async prepare(
    settings: StudioScene | undefined,
    assets: Map<string, StudioAsset>,
  ) {
    for (const object of settings?.objects ?? []) {
      if (!object.assetId) continue;
      const asset = assets.get(object.assetId);
      if (!asset)
        throw new Error(
          `${object.name}: asset is missing. Restore a project backup or import the asset again.`,
        );
      await this.loadAsset(asset);
    }
    for (const object of settings?.objects ?? []) {
      const existing = this.instances.get(object.id);
      if (
        existing &&
        existing.assetId === object.assetId &&
        existing.kind === object.kind
      )
        continue;
      if (existing) this.remove(object.id);
      const loaded = object.assetId
        ? await this.models.get(object.assetId)!
        : null;
      if (this.disposed) return;
      // Another preparation may have finished while the model was loading.
      const current = this.instances.get(object.id);
      if (
        current &&
        current.assetId === object.assetId &&
        current.kind === object.kind
      )
        continue;
      if (current) this.remove(object.id);
      const content = loaded
          ? (clone(loaded.group) as T.Group)
          : primitive(object.kind),
        group = new T.Group(),
        anchor = new T.Group();
      group.add(content);
      anchor.add(group);
      this.scene.add(anchor);
      const materials: Instance["materials"] = [];
      group.traverse((node) => {
        node.userData.sceneObjectId = object.id;
        if (node instanceof T.Mesh) {
          node.material = Array.isArray(node.material)
            ? node.material.map((m) => m.clone())
            : node.material.clone();
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material])
            if (material instanceof T.MeshStandardMaterial)
              materials.push({
                material,
                base: material.color.clone(),
                transparent: material.transparent,
                opacity: material.opacity,
              });
        }
      });
      const mixer = loaded?.animations.length
        ? new T.AnimationMixer(group)
        : null;
      const actions = loaded?.animations.map((c) => mixer!.clipAction(c)) ?? [];
      this.instances.set(object.id, {
        anchor,
        group,
        assetId: object.assetId,
        kind: object.kind,
        mixer,
        animation: -1,
        actions,
        materials,
        appearance: "",
      });
    }
  }
  update(
    settings: StudioScene | undefined,
    time: number,
    duration: number,
    origin: T.Vector3,
    subject: T.Object3D,
    editing: boolean,
    draggingId: string | null,
  ) {
    const ids = new Set(settings?.objects.map((o) => o.id));
    for (const id of this.instances.keys()) if (!ids.has(id)) this.remove(id);
    for (const object of settings?.objects ?? []) {
      const instance = this.instances.get(object.id);
      if (!instance) continue;
      const active =
        object.visible &&
        time >= object.start &&
        time <= Math.min(object.end ?? duration, duration);
      instance.anchor.visible = active;
      if (!active) continue;
      instance.anchor.position.copy(
        object.anchor === "aircraft" ? subject.position : origin,
      );
      instance.anchor.quaternion.copy(
        object.anchor === "aircraft" ? subject.quaternion : new T.Quaternion(),
      );
      if (object.id !== draggingId) {
        const pose = sampleTransform(object, time);
        instance.group.position.fromArray(pose.position);
        instance.group.rotation.set(
          ...(pose.rotation.map(T.MathUtils.degToRad) as [
            number,
            number,
            number,
          ]),
        );
        instance.group.scale.fromArray(pose.scale);
      }
      const appearance = `${object.color}:${object.opacity}:${object.metalness}:${object.roughness}`;
      if (instance.appearance !== appearance) {
        instance.appearance = appearance;
        for (const {
          material,
          base,
          transparent,
          opacity,
        } of instance.materials) {
          material.color.copy(base).multiply(new T.Color(object.color));
          material.opacity = opacity * object.opacity;
          material.transparent = object.opacity < 1 || transparent;
          material.roughness = object.roughness;
          material.metalness = object.metalness;
          material.needsUpdate = true;
        }
      }
      instance.group.traverse((node) => {
        if (node.userData.editorOnly) node.visible = editing;
        if (node instanceof T.PointLight) {
          node.color.set(object.color);
          node.intensity = object.intensity;
        }
      });
      if (instance.mixer) {
        if (instance.animation !== object.animation) {
          instance.actions.forEach((a) => a.stop());
          instance.animation = object.animation;
          const action = instance.actions[object.animation];
          if (action) action.play();
        }
        const action = instance.actions[object.animation];
        if (action) {
          action.paused = false;
          const length = action.getClip().duration;
          const t = Math.max(0, time - object.start) * object.animationSpeed;
          instance.mixer.setTime(
            object.loop
              ? t % Math.max(0.001, length)
              : Math.min(t, Math.max(0, length - 0.00001)),
          );
        }
      }
    }
  }
  getObject(id: string) {
    return this.instances.get(id)?.group ?? null;
  }
  transform(id: string): Transform | null {
    const object = this.getObject(id);
    return object
      ? {
          position: object.position.toArray() as [number, number, number],
          rotation: [
            object.rotation.x,
            object.rotation.y,
            object.rotation.z,
          ].map(T.MathUtils.radToDeg) as [number, number, number],
          scale: object.scale.toArray() as [number, number, number],
        }
      : null;
  }
  pick(ray: T.Raycaster) {
    const roots = [...this.instances.values()]
      .filter((i) => i.anchor.visible)
      .map((i) => i.group);
    const hit = ray.intersectObjects(roots, true)[0];
    return hit?.object.userData.sceneObjectId as string | undefined;
  }
  private remove(id: string) {
    const i = this.instances.get(id);
    if (!i) return;
    i.anchor.removeFromParent();
    i.mixer?.stopAllAction();
    disposeObject(i.group, !i.assetId, false);
    this.instances.delete(id);
  }
  dispose() {
    this.disposed = true;
    for (const id of this.instances.keys()) this.remove(id);
    for (const promise of this.models.values())
      void promise.then((model) => disposeObject(model.group)).catch(() => {});
    this.models.clear();
  }
}
