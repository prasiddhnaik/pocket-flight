import { sampleFrames } from "../replay/replay-data";
import {
  clipDuration,
  locateClip,
  type StudioClip,
  type StudioProject,
} from "./studio-model";
import {
  convertAnchor,
  newScene,
  type SceneObject,
  type Transform,
  type Vec3,
} from "./studio-scene";

export function editClip(
  project: StudioProject,
  clip: StudioClip,
  values: Partial<StudioClip>,
): StudioProject {
  if (
    values.cameraAnchor &&
    values.cameraAnchor !== (clip.cameraAnchor ?? "aircraft")
  ) {
    const from = clip.cameraAnchor ?? "aircraft",
      to = values.cameraAnchor;
    const origin = project.sources[project.clips[0].replayId].frames[0].p;
    const frames = project.sources[clip.replayId].frames;
    values = {
      ...values,
      cameraKeys: (clip.cameraKeys ?? []).map((key) => {
        const pose = sampleFrames(frames, key.t);
        const subject = pose.a.p.map(
          (n, i) => n + (pose.b.p[i] - n) * pose.mix,
        );
        const convert = (position: Vec3) =>
          convertAnchor(
            { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
            from,
            to,
            origin,
            subject,
            [0, 0, 0, 1],
          ).position;
        return {
          ...key,
          position: convert(key.position),
          target: convert(key.target),
        };
      }),
    };
  }
  return {
    ...project,
    clips: project.clips.map((c) =>
      c.id === clip.id ? { ...c, ...values } : c,
    ),
  };
}

export function moveClip(
  project: StudioProject,
  clip: StudioClip,
  delta: number,
) {
  const list = [...project.clips],
    i = list.indexOf(clip),
    target = i + delta;
  if (target < 0 || target >= list.length) return null;
  [list[i], list[target]] = [list[target], list[i]];
  return { project: { ...project, clips: list }, index: target };
}

export function splitClip(project: StudioProject, time: number) {
  const point = locateClip(project, time);
  if (
    !point ||
    point.sourceTime - point.clip.in < 0.1 ||
    point.clip.out - point.sourceTime < 0.1
  )
    return null;
  const list = [...project.clips];
  list.splice(
    point.index,
    1,
    { ...point.clip, out: point.sourceTime },
    { ...point.clip, id: crypto.randomUUID(), in: point.sourceTime },
  );
  return {
    project: { ...project, clips: list },
    selected: list[point.index + 1].id,
  };
}

export function duplicateClip(
  project: StudioProject,
  clip: StudioClip,
): StudioProject {
  const list = [...project.clips],
    i = list.indexOf(clip);
  list.splice(i + 1, 0, { ...clip, id: crypto.randomUUID() });
  return { ...project, clips: list };
}

export function removeClip(
  project: StudioProject,
  clip: StudioClip,
): StudioProject {
  const list = project.clips.filter((c) => c.id !== clip.id);
  const keys = new Set(list.map((c) => c.replayId));
  return {
    ...project,
    clips: list,
    sources: Object.fromEntries(
      Object.entries(project.sources).filter(([key]) => keys.has(key)),
    ),
  };
}

export function changeSceneObject(
  project: StudioProject,
  id: string,
  values: Partial<SceneObject>,
  time: number,
) {
  const scene = project.scene ?? newScene();
  if (
    values.anchor &&
    values.anchor !== scene.objects.find((o) => o.id === id)?.anchor
  ) {
    const object = scene.objects.find((o) => o.id === id),
      first = project.clips[0];
    if (object && first) {
      const convert = (transform: Transform, t: number) => {
        const point = locateClip(project, t);
        if (!point) return transform;
        const frame = sampleFrames(point.source.frames, point.sourceTime);
        const position = frame.a.p.map(
          (n, i) => n + (frame.b.p[i] - n) * frame.mix,
        );
        return convertAnchor(
          transform,
          object.anchor,
          values.anchor!,
          project.sources[first.replayId].frames[0].p,
          position,
          frame.a.q,
        );
      };
      values = {
        ...values,
        transform: convert(object.transform, time),
        keys: object.keys.map((k) => ({
          ...k,
          transform: convert(k.transform, k.t),
        })),
      };
    }
  }
  return {
    ...scene,
    objects: scene.objects.map((o) => (o.id === id ? { ...o, ...values } : o)),
  };
}

export function sceneSpawnPosition(project: StudioProject, time: number): Vec3 {
  const point = locateClip(project, time),
    first = project.clips[0];
  if (!point || !first) return [8, 3, 0];
  const origin = project.sources[first.replayId].frames[0].p;
  const pose = sampleFrames(point.source.frames, point.sourceTime);
  return pose.a.p.map(
    (n, i) =>
      n +
      (pose.b.p[i] - n) * pose.mix -
      origin[i] +
      (i === 0 ? 8 : i === 1 ? 2 : 0),
  ) as Vec3;
}

export function duplicateSceneObject(object: SceneObject): SceneObject {
  return {
    ...structuredClone(object),
    keys: object.keys.map((k) => ({
      ...structuredClone(k),
      transform: {
        ...structuredClone(k.transform),
        position: [
          k.transform.position[0] + 4,
          k.transform.position[1],
          k.transform.position[2],
        ] as Vec3,
      },
    })),
    id: crypto.randomUUID(),
    name: `${object.name} copy`,
    transform: {
      ...object.transform,
      position: [
        object.transform.position[0] + 4,
        ...object.transform.position.slice(1),
      ] as Vec3,
    },
  };
}

export function cameraFilmTime(
  project: StudioProject,
  clip: StudioClip,
  sourceTime: number,
) {
  const start = project.clips
    .slice(0, project.clips.indexOf(clip))
    .reduce((t, c) => t + clipDuration(c), 0);
  return (
    start +
    (Math.max(clip.in, Math.min(sourceTime, clip.out)) - clip.in) / clip.speed
  );
}
