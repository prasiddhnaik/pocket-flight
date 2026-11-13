import * as T from "three";
import {
  aureliaExteriorReference as reference,
} from "./exterior-reference";
import { type ExteriorKit, material } from "./exterior-kit";

/** Wings with flaps, ailerons, flap tracks and fairings, winglets and navigation lights. */
export function buildWings(kit: ExteriorKit) {
  const { root, white, blue, silver, group, mesh, rod, supported, bearing, controlHinges, skin, foil } = kit;
  const wingStations = [
    [0.78, 1.16, -1.02, 3.12],
    [2, 1.21, -0.56, 2.55],
    [4.3, 1.37, 0.42, 1.72],
    [6.75, 1.56, 1.56, 0.94],
    [7.26, 1.62, 1.85, 0.67],
  ] as const;
  function wingSection(
    x: number,
    side: number,
  ): [number, number, number, number] {
    let i = 0;
    while (i < wingStations.length - 2 && x > wingStations[i + 1][0]) i++;
    const a = wingStations[i],
      b = wingStations[i + 1],
      t = (x - a[0]) / (b[0] - a[0]);
    return [
      side * x,
      T.MathUtils.lerp(a[1], b[1], t),
      T.MathUtils.lerp(a[2], b[2], t),
      T.MathUtils.lerp(a[3], b[3], t),
    ];
  }
  for (const side of [-1, 1]) {
    const label = side < 0 ? "Left" : "Right",
      wing = group(`Wing_${label}`);
    const cuts = [0.78, 1, 1.02, 2, 2.14, 4.15, 4.3, 4.4, 6.6, 6.75, 7.26];
    for (let i = 0; i < cuts.length - 1; i++) {
      const low = cuts[i],
        high = cuts[i + 1],
        flap = low >= 1 && high <= 4.15,
        aileron = low >= 4.4 && high <= 6.6;
      const section = [wingSection(low, side), wingSection(high, side)];
      foil(
        `Wing_skin_${label}_${i}`,
        section,
        0.12,
        white,
        wing,
        0,
        flap ? 0.71 : aileron ? 0.72 : 1,
      );
    }
    for (const [kind, low, high, hinge] of [
      ["Flap", 1, 4.15, 0.72],
      ["Aileron", 4.4, 6.6, 0.76],
    ] as const) {
      const sections = [
        low + 0.045,
        ...(kind === "Flap" ? [2] : []),
        high - 0.045,
      ].map((x) => wingSection(x, side));
      const a = sections[0],
        b = sections.at(-1)!;
      const pivot = new T.Vector3(a[0], a[1], a[2] + a[3] * hinge),
        end = new T.Vector3(b[0], b[1], b[2] + b[3] * hinge);
      const g = group(`${kind}_${label}`, wing, pivot.toArray());
      const axis = end.sub(pivot).normalize().multiplyScalar(side);
      g.userData.hingeAxis = axis.toArray();
      g.userData.restPosition = pivot.toArray();
      foil(`${kind}_skin_${label}`, sections, 0.12, white, g, hinge, 1, pivot);
    }
    const aileron = root.getObjectByName(`Aileron_${label}`)!;
    controlHinges(
      `Aileron_hinge_${label}`,
      aileron,
      wing,
      [4.65, 5.45, 6.35].map((x) => {
        const section = wingSection(x, side);
        return new T.Vector3(
          section[0],
          section[1],
          section[2] + section[3] * 0.7,
        );
      }),
      `Wing_skin_${label}`,
      `Aileron_skin_${label}`,
    );
    const movingFlap = root.getObjectByName(`Flap_${label}`)!;
    const flapAxis = new T.Vector3()
      .fromArray(movingFlap.userData.hingeAxis as number[])
      .normalize();
    const trackDirection = new T.Vector3(0, -0.045, 0.18);
    const trackNormal = flapAxis.clone().cross(trackDirection).normalize();
    if (trackNormal.y > 0) trackNormal.negate();
    for (const [i, x] of [1.06, 4.09].entries()) {
      const along = (side * x - movingFlap.position.x) / flapAxis.x;
      const hingePoint = movingFlap.position
        .clone()
        .addScaledVector(flapAxis, along);
      const outside = flapAxis
        .clone()
        .multiplyScalar((side * (i === 0 ? -0.04 : 0.035)) / flapAxis.x);
      const rest = hingePoint
        .clone()
        .add(outside)
        // The short root carriage fits between the wing root and flap inside
        // the hollow fairing. The outboard carriage hangs beneath its hinge.
        .add(new T.Vector3(0, i === 0 ? 0.015 : -0.1, 0));
      const carriage = group(
        `Flap_carriage_${label}_${i}`,
        wing,
        rest.toArray(),
      );
      carriage.userData.restPosition = rest.toArray();
      const pinName = `Flap_hinge_pin_${label}_${i}`;
      supported(
        rod(
          pinName,
          hingePoint
            .clone()
            .sub(rest)
            .addScaledVector(flapAxis, -0.055)
            .toArray(),
          hingePoint
            .clone()
            .sub(rest)
            .addScaledVector(flapAxis, 0.055)
            .toArray(),
          i === 0 ? 0.012 : 0.007,
          silver,
          carriage,
        ),
        "sliding flap hinge pin",
        [`Flap_hinge_knuckle_${label}_${i}`],
      );
      bearing(
        `Flap_hinge_knuckle_${label}_${i}`,
        hingePoint.clone().sub(movingFlap.position),
        flapAxis,
        i === 0 ? 0.017 : 0.01,
        movingFlap,
        [pinName, `Flap_skin_${label}`],
        i === 0 ? 0.006 : 0.004,
      );
      supported(
        rod(
          `Flap_carriage_upright_${label}_${i}`,
          [0, 0, 0],
          hingePoint.clone().add(outside).sub(rest).toArray(),
          0.012,
          silver,
          carriage,
        ),
        "flap carriage upright",
        [pinName, `Flap_track_roller_${label}_${i}`],
      );
      supported(
        rod(
          `Flap_track_roller_${label}_${i}`,
          flapAxis
            .clone()
            .multiplyScalar(i === 0 ? -0.016 : -0.047)
            .toArray(),
          flapAxis
            .clone()
            .multiplyScalar(i === 0 ? 0.016 : 0.047)
            .toArray(),
          0.014,
          silver,
          carriage,
          trackNormal,
        ),
        "captured flap track roller",
        [`Flap_track_rail_${label}_${i}`],
      );
      for (const railSide of [-1, 1]) {
        const offset = flapAxis
          .clone()
          .multiplyScalar(railSide * (i === 0 ? 0.01 : 0.032))
          .addScaledVector(trackNormal, 0.014 + 0.009);
        const start = rest
          .clone()
          .add(offset)
          .addScaledVector(trackDirection, -0.08);
        const finish = rest
          .clone()
          .add(offset)
          .addScaledVector(trackDirection, 1.08);
        const railName = `Flap_track_rail_${label}_${i}_${railSide}`;
        supported(
          rod(
            railName,
            start.toArray(),
            finish.toArray(),
            0.009,
            silver,
            wing,
            trackNormal.clone().negate(),
          ),
          "fixed flap track",
          [`Flap_track_roller_${label}_${i}`],
        );
        const section = wingSection(Math.abs(rest.x + offset.x), side);
        const anchor = new T.Vector3(
          section[0],
          section[1],
          section[2] + section[3] * 0.69,
        );
        supported(
          rod(
            `Flap_track_bracket_${label}_${i}_${railSide}`,
            start.toArray(),
            anchor.toArray(),
            0.014,
            silver,
            wing,
          ),
          "wing flap-track bracket",
          [railName, `Wing_skin_${label}`],
        );
      }
    }
    foil(
      `Winglet_${label}`,
      [
        [side * 7.26, 1.62, 1.85, 0.67],
        [side * 7.48, 2.03, 2.12, 0.52],
        [side * (reference.span / 2), 2.67, 2.55, 0.24],
      ],
      0.09,
      blue,
      wing,
    );
    const flap = root.getObjectByName(`Flap_${label}`)!;
    const flapSkin = root.getObjectByName(`Flap_skin_${label}`) as T.Mesh;
    root.updateMatrixWorld(true);
    for (const [x, z] of [
      [2.1, 1.83],
      [3.1, 1.99],
      [4, 2.13],
    ]) {
      const centreY = wingSection(x, side)[1] - 0.14;
      const geometry = new T.SphereGeometry(1, 16, 10)
        .scale(0.065, 0.1, 0.48)
        .translate(side * x, centreY, z);
      const positions = geometry.getAttribute("position");
      // Fit the housing's upper saddle to the actual underside triangles, rather
      // than leaving an ellipsoid below the wing centreline. A 3 mm overlap seals
      // the joint; the housing is carried by the flap throughout its travel.
      for (let i = 0; i < positions.count; i++) {
        const upper = (positions.getY(i) - centreY) / 0.1;
        if (upper <= 0.3) continue;
        const ray = new T.Raycaster(
          new T.Vector3(positions.getX(i), -1, positions.getZ(i)),
          new T.Vector3(0, 1, 0),
          0,
          4,
        );
        const skin = ray.intersectObject(flapSkin, false)[0];
        if (skin)
          positions.setY(
            i,
            T.MathUtils.lerp(
              positions.getY(i),
              skin.point.y + 0.003,
              T.MathUtils.smoothstep(upper, 0.3, 0.75),
            ),
          );
      }
      geometry.translate(-flap.position.x, -flap.position.y, -flap.position.z);
      geometry.computeVertexNormals();
      mesh(`Flap_track_fairing_${label}_${x}`, geometry, white, flap);
    }
    const navigation = material(
      `Navigation_${label}`,
      side < 0 ? "#ec2727" : "#29ca79",
      0.12,
    );
    navigation.emissive.copy(navigation.color);
    navigation.emissiveIntensity = 0.65;
    const lamp = mesh(
      `Wingtip_light_${label}`,
      new T.SphereGeometry(0.028, 12, 8),
      navigation,
      wing,
    );
    lamp.position.set(side * 7.74, 2.55, 2.63);
  }
}
