export type AvionicsPose = { gear: number; flaps: number };
/** Map coordinates use the game's metres: +X east, -Z north, +Y altitude. */
export type MapPoint = Readonly<{ x: number; z: number }>;
export type AureliaNavigation = Readonly<{
  position: MapPoint;
  rangeNm: number;
  orientation: "north-up" | "heading-up";
  desiredTrackDeg: number;
  route: readonly (MapPoint & { readonly id: string })[];
  runways: readonly {
    readonly id: string;
    readonly start: MapPoint;
    readonly end: MapPoint;
  }[];
  terrain: readonly {
    readonly color: string;
    readonly points: readonly MapPoint[];
  }[];
}>;
export type AureliaEngine = Readonly<{
  n1: number;
  n2: number;
  ittC: number;
  oilPsi: number;
  oilC: number;
  fuelLb: number;
}>;
/** An immutable sensor snapshot. Increment revision whenever any supplied data changes. */
export type AureliaAvionicsState = Readonly<
  AvionicsPose & {
    time: number;
    revision: number;
    source: "demo" | "flight" | "replay";
    speedKt: number;
    groundSpeedKt: number;
    altitudeFt: number;
    verticalSpeedFpm: number;
    headingDeg: number;
    roll: number;
    pitch: number;
    utcSeconds: number;
    busVoltage: number;
    engines: readonly [AureliaEngine, AureliaEngine];
    navigation: AureliaNavigation;
    guidance: Readonly<{
      verticalMode: string;
      lateralMode: string;
      autopilot: boolean;
      yawDamper: boolean;
      selectedAltitudeFt: number;
      directorPitchRad: number;
      directorRollRad: number;
    }>;
    radio: Readonly<{
      com1MHz: number;
      baroInHg: number;
      transponderCode: string;
      transponderMode: string;
    }>;
  }
>;

export type AureliaFlightTelemetry = Readonly<
  AvionicsPose & {
    time: number;
    revision: number;
    position: Readonly<{ x: number; y: number; z: number }>;
    velocity: Readonly<{ x: number; y: number; z: number }>;
    indicatedAirspeedMps: number;
    /** Pocket Flight yaw: positive turns toward -X; radians throughout attitude. */
    yaw: number;
    pitch: number;
    roll: number;
  }
>;
export type AureliaAvionicsSystems = Pick<
  AureliaAvionicsState,
  "utcSeconds" | "busVoltage" | "engines" | "guidance" | "radio"
>;

/** Feed simulator telemetry and its map into the same renderer used by the viewer. */
export function aureliaAvionicsFromFlight(
  flight: AureliaFlightTelemetry,
  systems: AureliaAvionicsSystems,
  map: Omit<AureliaNavigation, "position">,
): AureliaAvionicsState {
  return {
    ...systems,
    time: flight.time,
    revision: flight.revision,
    source: "flight",
    speedKt: flight.indicatedAirspeedMps / (1852 / 3600),
    groundSpeedKt:
      Math.hypot(flight.velocity.x, flight.velocity.z) / (1852 / 3600),
    altitudeFt: flight.position.y / 0.3048,
    verticalSpeedFpm: (flight.velocity.y * 60) / 0.3048,
    headingDeg: ((((-flight.yaw * 180) / Math.PI) % 360) + 360) % 360,
    pitch: flight.pitch,
    roll: flight.roll,
    gear: flight.gear,
    flaps: flight.flaps,
    navigation: {
      ...map,
      position: { x: flight.position.x, z: flight.position.z },
    },
  };
}

/** Pixels relative to ownship; rangeNm is the outer (140 px) ring's radius. */
export function projectAureliaMap(
  point: MapPoint,
  navigation: AureliaNavigation,
  headingDeg: number,
) {
  const x = point.x - navigation.position.x;
  const z = point.z - navigation.position.z;
  const angle =
    navigation.orientation === "heading-up" ? (headingDeg * Math.PI) / 180 : 0;
  const scale = 140 / (Math.max(0.01, navigation.rangeNm) * 1852);
  return [
    234 + (x * Math.cos(angle) + z * Math.sin(angle)) * scale,
    276 + (-x * Math.sin(angle) + z * Math.cos(angle)) * scale,
  ];
}

export function shouldRenderAureliaAvionics(
  previous: AureliaAvionicsState | null,
  next: AureliaAvionicsState,
  elapsed: number,
  focused: boolean,
) {
  if (
    !previous ||
    next.time < previous.time ||
    next.gear !== previous.gear ||
    next.flaps !== previous.flaps
  )
    return true;
  return (
    (next.revision !== previous.revision || next.time !== previous.time) &&
    elapsed >= (focused ? 0.05 : 0.5)
  );
}

export function avionicsUtc(seconds: number) {
  const day = ((Math.floor(seconds) % 86400) + 86400) % 86400;
  return (
    [Math.floor(day / 3600), Math.floor(day / 60) % 60, day % 60]
      .map((value) => String(value).padStart(2, "0"))
      .join(":") + "Z"
  );
}
