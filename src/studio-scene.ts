import { Euler, Quaternion, MathUtils, Vector3 } from "three";
export type Vec3 = [number, number, number];
export type Ease = "linear" | "smooth" | "hold";
export type Transform = { position: Vec3; rotation: Vec3; scale: Vec3 };
export type TransformKey = { t: number; transform: Transform; ease: Ease };
export type CameraKey = {
  t: number;
  position: Vec3;
  target: Vec3;
  fov: number;
  ease: Ease;
};
export type ObjectKind =
  | "cube"
  | "sphere"
  | "cylinder"
  | "torus"
  | "plane"
  | "light"
  | "asset"
  | "image";
export type SceneObject = {
  id: string;
  name: string;
  kind: ObjectKind;
  assetId?: string;
  anchor: "world" | "aircraft";
  transform: Transform;
  keys: TransformKey[];
  start: number;
  end: number | null;
  visible: boolean;
  locked: boolean;
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  intensity: number;
  animation: number;
  animationSpeed: number;
  loop: boolean;
};
export type SoundLayer = {
  id: string;
  assetId: string;
  name: string;
  start: number;
  end: number | null;
  offset: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
};
export type StudioScene = {
  objects: SceneObject[];
  sounds: SoundLayer[];
  exposure: number;
  lighting: "recorded" | "day" | "night";
  render: { size: "720p" | "1080p"; fps: 30 | 60 };
};
export const newScene = (): StudioScene => ({
  objects: [],
  sounds: [],
  exposure: 1.05,
  lighting: "recorded",
  render: { size: "1080p", fps: 30 },
});
export const newObject = (kind: ObjectKind, position: Vec3): SceneObject => ({
  id: crypto.randomUUID(),
  name:
    kind === "asset" ? "Imported model" : kind[0].toUpperCase() + kind.slice(1),
  kind,
  anchor: "world",
  transform: { position: [...position], rotation: [0, 0, 0], scale: [1, 1, 1] },
  keys: [],
  start: 0,
  end: null,
  visible: true,
  locked: false,
  color: kind === "light" ? "#ffdf9c" : "#ece4c9",
  roughness: 0.55,
  metalness: 0.1,
  opacity: 1,
  intensity: 150,
  animation: -1,
  animationSpeed: 1,
  loop: true,
});
export function setTransformKey(
  object: SceneObject,
  t: number,
  transform: Transform,
  ease: Ease,
): SceneObject {
  const key = {
    t: Math.round(Math.max(0, t) * 1000) / 1000,
    transform: structuredClone(transform),
    ease,
  };
  return {
    ...object,
    keys: [
      ...object.keys.filter((k) => Math.abs(k.t - key.t) > 0.001),
      key,
    ].sort((a, b) => a.t - b.t),
  };
}
export function setCameraKey(keys: CameraKey[], key: CameraKey) {
  return [...keys.filter((k) => Math.abs(k.t - key.t) > 0.001), key].sort(
    (a, b) => a.t - b.t,
  );
}
function segment<T extends { t: number; ease: Ease }>(keys: T[], time: number) {
  if (time <= keys[0].t) return { a: keys[0], b: keys[0], mix: 0 };
  for (let i = 1; i < keys.length; i++)
    if (time <= keys[i].t) {
      const a = keys[i - 1],
        b = keys[i],
        t = (time - a.t) / (b.t - a.t);
      return {
        a,
        b,
        mix:
          t === 1
            ? 1
            : a.ease === "hold"
              ? 0
              : a.ease === "smooth"
                ? t * t * (3 - 2 * t)
                : t,
      };
    }
  return { a: keys.at(-1)!, b: keys.at(-1)!, mix: 0 };
}
const blend = (a: Vec3, b: Vec3, t: number): Vec3 =>
  a.map((n, i) => n + (b[i] - n) * t) as Vec3;
export function sampleTransform(object: SceneObject, time: number): Transform {
  if (!object.keys.length) return object.transform;
  const { a, b, mix } = segment(object.keys, time);
  if (a === b || mix === 0) return a.transform;
  if (mix === 1) return b.transform;
  const qa = new Quaternion().setFromEuler(
    new Euler(...(a.transform.rotation.map(MathUtils.degToRad) as Vec3)),
  );
  const qb = new Quaternion().setFromEuler(
    new Euler(...(b.transform.rotation.map(MathUtils.degToRad) as Vec3)),
  );
  const e = new Euler().setFromQuaternion(qa.slerp(qb, mix));
  return {
    position: blend(a.transform.position, b.transform.position, mix),
    scale: blend(a.transform.scale, b.transform.scale, mix),
    rotation: [e.x, e.y, e.z].map(MathUtils.radToDeg) as Vec3,
  };
}
export function sampleCamera(keys: CameraKey[], time: number) {
  if (!keys.length) return null;
  const { a, b, mix } = segment(keys, time);
  return {
    position: blend(a.position, b.position, mix),
    target: blend(a.target, b.target, mix),
    fov: a.fov + (b.fov - a.fov) * mix,
  };
}
export const vec = (v: unknown): v is Vec3 =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e6);
export const validTransform = (v: Transform) =>
  !!v &&
  vec(v.position) &&
  vec(v.rotation) &&
  vec(v.scale) &&
  v.scale.every((n) => n >= 0.001 && n <= 10000);
const range = (v: number, a: number, b: number) =>
  Number.isFinite(v) && v >= a && v <= b;
const ease = (v: unknown) => v === "linear" || v === "smooth" || v === "hold";
const ordered = (keys: { t: number }[]) =>
  keys.every(
    (k, i) => k && range(k.t, 0, 86400) && (i === 0 || k.t > keys[i - 1].t),
  );
export function validCameraKeys(value: unknown): value is CameraKey[] {
  return (
    Array.isArray(value) &&
    ordered(value) &&
    value.every(
      (k) =>
        vec(k.position) &&
        vec(k.target) &&
        range(k.fov, 10, 120) &&
        ease(k.ease),
    )
  );
}
export function validateScene(value: unknown): value is StudioScene {
  if (!value || typeof value !== "object") return false;
  const s = value as StudioScene;
  return (
    range(s.exposure, 0.1, 4) &&
    ["recorded", "day", "night"].includes(s.lighting) &&
    !!s.render &&
    ["720p", "1080p"].includes(s.render.size) &&
    [30, 60].includes(s.render.fps) &&
    Array.isArray(s.objects) &&
    s.objects.every(
      (o) =>
        o &&
        typeof o.id === "string" &&
        typeof o.name === "string" &&
        [
          "cube",
          "sphere",
          "cylinder",
          "torus",
          "plane",
          "light",
          "asset",
          "image",
        ].includes(o.kind) &&
        ((o.kind !== "asset" && o.kind !== "image") ||
          typeof o.assetId === "string") &&
        ["world", "aircraft"].includes(o.anchor) &&
        validTransform(o.transform) &&
        Array.isArray(o.keys) &&
        ordered(o.keys) &&
        o.keys.every((k) => validTransform(k.transform) && ease(k.ease)) &&
        range(o.start, 0, 86400) &&
        (o.end === null || range(o.end, o.start + 0.01, 86400)) &&
        typeof o.visible === "boolean" &&
        typeof o.locked === "boolean" &&
        /^#[0-9a-f]{6}$/i.test(o.color) &&
        [o.roughness, o.metalness, o.opacity].every((v) => range(v, 0, 1)) &&
        range(o.intensity, 0, 10000) &&
        Number.isInteger(o.animation) &&
        o.animation >= -1 &&
        range(o.animationSpeed, 0.1, 4) &&
        typeof o.loop === "boolean",
    ) &&
    new Set(s.objects.map((o) => o.id)).size === s.objects.length &&
    Array.isArray(s.sounds) &&
    s.sounds.every(
      (a) =>
        a &&
        typeof a.id === "string" &&
        typeof a.assetId === "string" &&
        typeof a.name === "string" &&
        range(a.start, 0, 86400) &&
        (a.end === null || range(a.end, a.start + 0.01, 86400)) &&
        range(a.offset, 0, 86400) &&
        range(a.volume, 0, 1) &&
        range(a.fadeIn, 0, 60) &&
        range(a.fadeOut, 0, 60) &&
        typeof a.loop === "boolean",
    ) &&
    new Set(s.sounds.map((a) => a.id)).size === s.sounds.length
  );
}
export const sceneAssetIds = (scene?: StudioScene) => [
  ...new Set([
    ...(scene?.objects.flatMap((o) => (o.assetId ? [o.assetId] : [])) ?? []),
    ...(scene?.sounds.map((a) => a.assetId) ?? []),
  ]),
];

export function convertAnchor(
  transform: Transform,
  from: "world" | "aircraft",
  to: "world" | "aircraft",
  origin: number[],
  subject: number[],
  quaternion: number[],
): Transform {
  if (from === to) return transform;
  const q = new Quaternion().fromArray(quaternion).normalize(),
    rotation = new Quaternion().setFromEuler(
      new Euler(...(transform.rotation.map(MathUtils.degToRad) as Vec3)),
    );
  const position = new Vector3().fromArray(transform.position);
  if (from === "aircraft") {
    position.applyQuaternion(q).add(new Vector3().fromArray(subject));
    rotation.premultiply(q);
  } else position.add(new Vector3().fromArray(origin));
  if (to === "aircraft") {
    position
      .sub(new Vector3().fromArray(subject))
      .applyQuaternion(q.clone().invert());
    rotation.premultiply(q.clone().invert());
  } else position.sub(new Vector3().fromArray(origin));
  const e = new Euler().setFromQuaternion(rotation);
  return {
    position: position.toArray() as Vec3,
    rotation: [e.x, e.y, e.z].map(MathUtils.radToDeg) as Vec3,
    scale: [...transform.scale],
  };
}
