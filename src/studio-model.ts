import { validateReplay, type SavedReplay } from "./replay-data";
import {
  validateScene,
  validCameraKeys,
  type StudioScene,
  type CameraKey,
} from "./studio-scene";
export type Shot = "custom" | "chase" | "orbit" | "side" | "front" | "wide";
export type StudioClip = {
  id: string;
  replayId: string;
  in: number;
  out: number;
  speed: number;
  camera: Shot;
  title: string;
  volume: number;
  cameraKeys?: CameraKey[];
  cameraAnchor?: "aircraft" | "world";
};
export type StudioProject = {
  schemaVersion: 1;
  id: string;
  name: string;
  updatedAt: number;
  clips: StudioClip[];
  sources: Record<string, SavedReplay>;
  scene?: StudioScene;
};
export const shots: Record<Shot, string> = {
  custom: "Keyframed camera",
  chase: "Follow",
  orbit: "Orbit",
  side: "Side profile",
  front: "Front tracking",
  wide: "Wide aerial",
};
export const newProject = (): StudioProject => ({
  schemaVersion: 1,
  id: crypto.randomUUID(),
  name: "Untitled flight film",
  updatedAt: Date.now(),
  clips: [],
  sources: {},
});
export const clipDuration = (clip: StudioClip) =>
  (clip.out - clip.in) / clip.speed;
export const projectDuration = (p: StudioProject) =>
  p.clips.reduce((n, c) => n + clipDuration(c), 0);
export function addReplayClip(
  project: StudioProject,
  replay: SavedReplay,
): StudioProject {
  const key = `${replay.id}:${replay.updatedAt}`;
  return {
    ...project,
    updatedAt: Date.now(),
    sources: { ...project.sources, [key]: structuredClone(replay) },
    clips: [
      ...project.clips,
      {
        id: crypto.randomUUID(),
        replayId: key,
        in: 0,
        out: replay.duration,
        speed: 1,
        camera: "orbit",
        title: "",
        volume: 1,
      },
    ],
  };
}
export function trimClip(
  clip: StudioClip,
  start: number,
  end: number,
  duration: number,
): StudioClip {
  const min = 0.1,
    from = Math.max(
      0,
      Math.min(Number.isFinite(start) ? start : 0, duration - min),
    );
  return {
    ...clip,
    in: from,
    out: Math.max(
      from + min,
      Math.min(Number.isFinite(end) ? end : duration, duration),
    ),
  };
}
export function locateClip(project: StudioProject, time: number) {
  let start = 0;
  for (let index = 0; index < project.clips.length; index++) {
    const clip = project.clips[index],
      duration = clipDuration(clip);
    if (time < start + duration || index === project.clips.length - 1)
      return {
        clip,
        index,
        source: project.sources[clip.replayId],
        sourceTime:
          clip.in + Math.max(0, Math.min(time - start, duration)) * clip.speed,
        start,
        duration,
      };
    start += duration;
  }
  return null;
}
export function validateProject(p: unknown): p is StudioProject {
  if (!p || typeof p !== "object") return false;
  const v = p as StudioProject;
  return (
    v.schemaVersion === 1 &&
    (v.scene === undefined || validateScene(v.scene)) &&
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.name === "string" &&
    Number.isFinite(v.updatedAt) &&
    !!v.sources &&
    typeof v.sources === "object" &&
    !Array.isArray(v.sources) &&
    Object.values(v.sources).every(validateReplay) &&
    Array.isArray(v.clips) &&
    v.clips.every(
      (c) =>
        c &&
        typeof c === "object" &&
        typeof c.id === "string" &&
        Object.hasOwn(v.sources, c.replayId) &&
        Number.isFinite(c.in) &&
        Number.isFinite(c.out) &&
        c.in >= 0 &&
        c.out - c.in >= 0.099 &&
        c.out <= v.sources[c.replayId].duration + 0.001 &&
        [0.25, 0.5, 1, 1.5, 2].includes(c.speed) &&
        Object.hasOwn(shots, c.camera) &&
        (c.cameraKeys === undefined || validCameraKeys(c.cameraKeys)) &&
        (c.cameraAnchor === undefined ||
          c.cameraAnchor === "world" ||
          c.cameraAnchor === "aircraft") &&
        typeof c.title === "string" &&
        c.title.length <= 100 &&
        Number.isFinite(c.volume) &&
        c.volume >= 0 &&
        c.volume <= 1,
    ) &&
    new Set(v.clips.map((c) => c.id)).size === v.clips.length
  );
}
