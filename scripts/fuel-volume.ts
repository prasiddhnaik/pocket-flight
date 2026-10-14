import * as T from "three";
export type Triangles = T.Vector3[][];

/** Signed tetrahedral volume integrals, including the full second-moment tensor. */
export function volumeProperties(triangles: Triangles) {
  const origin = new T.Box3()
    .setFromPoints(triangles.flat())
    .getCenter(new T.Vector3());
  let volume = 0;
  const first = new T.Vector3(),
    second = Array(9).fill(0);
  for (const [a, b, c] of triangles) {
    const v =
      a
        .clone()
        .sub(origin)
        .dot(b.clone().sub(origin).cross(c.clone().sub(origin))) / 6;
    const vertices = [origin, a, b, c],
      sum = vertices.reduce((s, p) => s.add(p), new T.Vector3());
    volume += v;
    first.addScaledVector(sum, v / 4);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        second[i * 3 + j] +=
          (v / 20) *
          (sum.getComponent(i) * sum.getComponent(j) +
            vertices.reduce(
              (s, p) => s + p.getComponent(i) * p.getComponent(j),
              0,
            ));
  }
  if (Math.abs(volume) < 1e-12)
    return { volume: 0, center: [0, 0, 0], second: Array(9).fill(0) };
  return {
    volume: Math.abs(volume),
    center: first.divideScalar(volume).toArray(),
    second: second.map((x) => x / volume),
  };
}

export function belowLevel(triangles: Triangles, level: number): Triangles {
  const result: Triangles = [],
    segments: T.Vector3[][] = [];
  for (const triangle of triangles) {
    const polygon: T.Vector3[] = [],
      crossings: T.Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      const a = triangle[i],
        b = triangle[(i + 1) % 3],
        inside = a.y <= level;
      if (inside) polygon.push(a);
      if (inside !== b.y <= level) {
        const p = a.clone().lerp(b, (level - a.y) / (b.y - a.y));
        polygon.push(p);
        crossings.push(p);
      }
    }
    for (let i = 1; i < polygon.length - 1; i++)
      result.push([polygon[0], polygon[i], polygon[i + 1]]);
    if (
      crossings.length === 2 &&
      crossings[0].distanceToSquared(crossings[1]) > 1e-18
    )
      segments.push(crossings);
  }
  const key = (p: T.Vector3) =>
    [p.x, p.z].map((v) => Math.round(v * 1e7)).join(",");
  const links = new Map<string, { point: T.Vector3; other: string }[]>();
  for (const [a, b] of segments)
    for (const [p, q] of [
      [a, b],
      [b, a],
    ]) {
      const k = key(p),
        list = links.get(k) ?? [];
      list.push({ point: p, other: key(q) });
      links.set(k, list);
    }
  while (links.size) {
    const start = links.keys().next().value!,
      points: T.Vector3[] = [];
    let at = start,
      previous = "";
    for (let step = 0; step <= segments.length + 1; step++) {
      const list = links.get(at);
      if (!list) throw Error("Open clipped fuel surface");
      points.push(list[0].point);
      const next = list.find((x) => x.other !== previous)?.other;
      links.delete(at);
      if (!next) throw Error("Fuel cap has no continuation");
      if (next === start) break;
      previous = at;
      at = next;
    }
    const contour = points.map((p) => new T.Vector2(p.x, p.z));
    for (const face of T.ShapeUtils.triangulateShape(contour, [])) {
      const t = face.map((i) => points[i]);
      if (t[1].clone().sub(t[0]).cross(t[2].clone().sub(t[0])).y < 0)
        t.reverse();
      result.push(t);
    }
  }
  return result;
}

export function inertiaPerKg(center: number[], second: number[]) {
  const covariance = second.map(
    (v, i) => v - center[Math.floor(i / 3)] * center[i % 3],
  );
  const trace = covariance[0] + covariance[4] + covariance[8];
  return covariance.map((v, i) => (i % 4 === 0 ? trace : 0) - v);
}

export function fuelTable(
  triangles: Triangles,
  displacement = 0.03,
  unusableFraction = 0.03,
) {
  // Standardize outward winding before adding horizontal free-surface caps.
  const signed = triangles.reduce(
    (s, [a, b, c]) => s + a.dot(b.clone().cross(c)) / 6,
    0,
  );
  const oriented =
    signed < 0 ? triangles.map((t) => [...t].reverse()) : triangles;
  const full = volumeProperties(oriented),
    bounds = new T.Box3().setFromPoints(oriented.flat());
  const free = 1 - displacement,
    filledVolume = full.volume / 1.02,
    heelVolume = filledVolume * unusableFraction;
  function filled(volume: number) {
    let low = bounds.min.y,
      high = bounds.max.y;
    for (let i = 0; i < 30; i++) {
      const level = (low + high) / 2,
        got = volumeProperties(belowLevel(oriented, level));
      if (got.volume < volume) low = level;
      else high = level;
    }
    const level = (low + high) / 2;
    return { ...volumeProperties(belowLevel(oriented, level)), level };
  }
  const heel = filled(heelVolume),
    usableVolume = filledVolume - heelVolume;
  const samples = Array.from({ length: 33 }, (_, i) => {
    const fraction = i / 32,
      total = filled(heelVolume + usableVolume * fraction),
      v = total.volume - heel.volume;
    const center =
      v < 1e-10
        ? heel.center
        : total.center.map(
            (x, j) => (x * total.volume - heel.center[j] * heel.volume) / v,
          );
    const second =
      v < 1e-10
        ? heel.second
        : total.second.map(
            (x, j) => (x * total.volume - heel.second[j] * heel.volume) / v,
          );
    return {
      fraction,
      level: total.level,
      center,
      inertiaPerKg: inertiaPerKg(center, second),
    };
  });
  return {
    envelopeLitres: full.volume * 1000,
    displacementLitres: full.volume * displacement * 1000,
    expansionLitres: (full.volume - filledVolume) * free * 1000,
    usableLitres: usableVolume * free * 1000,
    unusableLitres: heel.volume * free * 1000,
    size: bounds.getSize(new T.Vector3()).toArray(),
    samples,
    residual: {
      center: heel.center,
      inertiaPerKg: inertiaPerKg(heel.center, heel.second),
    },
    assumptions:
      "Level settled liquid; 3% estimated structure displacement and 3% estimated trapped fuel. Two percent expansion relative to fill capacity. No slosh or adverse-attitude feed certification.",
  };
}
